/**
 * Deneme Analizi — Premium Karne (Appwrite: exams + ExamResults, mock yok)
 * Chart.js: radar + öğrenci vs kurum ortalaması (koçun tüm denemelerinden)
 */
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  updateDoc,
  deleteDoc,
  doc,
  db,
  auth,
  isAppwriteWriteSoftFailure,
  serverTimestamp,
  Timestamp,
} from "./appwrite-compat.js";
import { APPWRITE_COLLECTION_EXAM_RESULTS } from "./appwrite-config.js";
import {
  YKS_TYT_BRANCHES,
  YKS_AYT_BY_ALAN,
  netFromDyWithRule,
  yks2026DersKeys,
  yks2026KonuOptionsForDers,
} from "./yks-mufredat.js";

(function (global) {
  "use strict";

  var chartRadar = null;
  var chartBar = null;

  /** koc-panel.js getCoachIdResolved ile aynı mantık: localStorage boşsa oturum e-postası */
  function getCoachId() {
    try {
      var imp = sessionStorage.getItem("superAdminViewAsCoach");
      if (imp && String(imp).trim()) return String(imp).trim();
    } catch (e) {}
    var cu = (localStorage.getItem("currentUser") || "").trim();
    if (cu) return cu;
    try {
      var u = auth.currentUser;
      if (u && u.email) {
        var part = String(u.email)
          .split("@")[0]
          .trim()
          .toLowerCase()
          .replace(/[^a-z0-9_]/g, "");
        if (part) return part;
      }
    } catch (e2) {}
    return "";
  }

  /** UI / DB uyumu: esit_agirlik veya ea aynı anahtara indirgenir. */
  function normalizeAytAlanKey(a) {
    var k = String(a == null ? "sayisal" : a)
      .trim()
      .toLowerCase();
    if (k === "ea" || k === "esit_agirlik" || k === "eşit_ağırlık") return "esit_agirlik";
    if (k === "sayisal") return "sayisal";
    if (k === "sozel" || k === "sözel") return "sozel";
    if (k === "dil") return "dil";
    return k;
  }

  function aytAlanDisplayLabel(alanNorm) {
    var n = normalizeAytAlanKey(alanNorm);
    if (n === "esit_agirlik") return "Eşit Ağırlık";
    if (n === "sayisal") return "Sayısal";
    if (n === "sozel") return "Sözel";
    if (n === "dil") return "Dil";
    return String(alanNorm || "");
  }

  function clampDy(soru, d, y) {
    var s = Number(soru);
    if (isNaN(s) || s <= 0) return { d: 0, y: 0 };
    var dd = Number(d != null ? d : 0);
    var yy = Number(y != null ? y : 0);
    if (isNaN(dd)) dd = 0;
    if (isNaN(yy)) yy = 0;
    dd = Math.max(0, Math.min(s, dd));
    yy = Math.max(0, Math.min(s - dd, yy));
    return { d: dd, y: yy };
  }

  function branchNetFromRow(r) {
    if (!r || !r.soru) return 0;
    var cl = clampDy(r.soru, r.d, r.y);
    return netFromDyWithRule(cl.d, cl.y, "osym");
  }

  function labelForRowKey(key, examMode, aytAlan) {
    var k = String(key || "");
    if (examMode === "TYT") {
      for (var i = 0; i < YKS_TYT_BRANCHES.length; i++) {
        var br = YKS_TYT_BRANCHES[i];
        if (br.id === k) return br.label;
        if (br.alt && br.alt.length) {
          for (var j = 0; j < br.alt.length; j++) {
            if (br.id + "_" + br.alt[j].id === k) return br.label + " · " + br.alt[j].label;
          }
        }
      }
      return k;
    }
    var alanKey = normalizeAytAlanKey(aytAlan);
    var alan = YKS_AYT_BY_ALAN[alanKey] || YKS_AYT_BY_ALAN.sayisal;
    if (alan && alan.branches) {
      for (var b = 0; b < alan.branches.length; b++) {
        if ("ayt_" + alan.branches[b].id === k) return alan.branches[b].label;
      }
    }
    return k.replace(/^ayt_/, "");
  }

  function rowsFromYksDetail(detail, examMode, aytAlan) {
    var out = [];
    if (!detail || !detail.rows || typeof detail.rows !== "object") return out;
    Object.keys(detail.rows).forEach(function (k) {
      var r = detail.rows[k];
      if (!r || !r.soru) return;
      var cl = clampDy(r.soru, r.d, r.y);
      var b = Math.max(0, r.soru - cl.d - cl.y);
      var net = netFromDyWithRule(cl.d, cl.y, "osym");
      var basari = r.soru > 0 ? (cl.d / r.soru) * 100 : 0;
      out.push({
        ders: labelForRowKey(k, examMode, aytAlan),
        soru: r.soru,
        d: cl.d,
        y: cl.y,
        b: b,
        net: net,
        basari: basari,
      });
    });
    return out;
  }

  function weakTopicsFromDetail(detail) {
    var w = (detail && detail.weakTopics) || [];
    if (!Array.isArray(w) || !w.length) return [];
    return w.map(function (t) {
      var s = String(t || "").trim();
      return { branch: "", topic: s, yanlis: "—", bos: "" };
    });
  }

  function tytRadarFromRows(rows) {
    if (!rows) return { labels: ["Türkçe", "Matematik", "Sosyal", "Fen"], student: [0, 0, 0, 0] };
    function bn(key) {
      return branchNetFromRow(rows[key]);
    }
    var fenNet = bn("fen_fizik") + bn("fen_kimya") + bn("fen_biyo");
    var sosNet =
      bn("sosyal_tarih") + bn("sosyal_cografya") + bn("sosyal_felsefe") + bn("sosyal_din");
    return {
      labels: ["Türkçe", "Matematik", "Fen", "Sosyal"],
      student: [bn("turkce"), bn("matematik"), fenNet, sosNet],
    };
  }

  function aytRadarFromRows(rows, aytAlan) {
    var alanKey = normalizeAytAlanKey(aytAlan);
    var alan = YKS_AYT_BY_ALAN[alanKey] || YKS_AYT_BY_ALAN.sayisal;
    if (!alan || !alan.branches) return { labels: [], student: [] };
    var labels = [];
    var student = [];
    alan.branches.forEach(function (br) {
      labels.push(br.label);
      student.push(branchNetFromRow(rows["ayt_" + br.id]));
    });
    return { labels: labels, student: student };
  }

  function examDocDate(e) {
    var d = e.date || e.examDate || "";
    if (d && typeof d.toDate === "function") {
      try {
        return d.toDate().toISOString().slice(0, 10);
      } catch (err) {}
    }
    return String(d).slice(0, 10);
  }

  function normalizeExamDoc(raw, source) {
    var yks = raw.yksBranchDetail;
    if (yks && typeof yks === "string") {
      try {
        yks = JSON.parse(yks);
      } catch (e) {
        yks = null;
      }
    }
    return {
      id: raw.id,
      source: source,
      examName: raw.examName || "Deneme",
      date: examDocDate(raw),
      examType: String(raw.examType || raw.tur || "TYT").toUpperCase(),
      net: parseFloat(String(raw.net || "").replace(",", ".")) || 0,
      yksBranchDetail: yks,
      coach_id: raw.coach_id,
    };
  }

  function normalizeExamResultDoc(raw) {
    var detail = {};
    try {
      var dj = raw.detail_json;
      if (typeof dj === "string") detail = JSON.parse(dj || "{}");
      else if (dj && typeof dj === "object") detail = dj;
    } catch (e) {
      detail = {};
    }
    var mode = String(detail.examMode || "TYT").toUpperCase();
    var saved = raw.saved_at;
    var dateStr = "";
    if (saved && typeof saved.toDate === "function") {
      try {
        dateStr = saved.toDate().toISOString().slice(0, 10);
      } catch (e) {}
    } else if (typeof saved === "string") dateStr = saved.slice(0, 10);

    return {
      id: raw.id,
      source: "ExamResults",
      examName: raw.exam_name || "Deneme",
      date: dateStr,
      examType: mode,
      net: detail.computed && typeof detail.computed.totalNet === "number" ? detail.computed.totalNet : 0,
      yksBranchDetail: detail.rows ? detail : null,
      coach_id: raw.coach_id,
    };
  }

  async function fetchStudentsForCoach(coachId) {
    if (!coachId) return [];
    var snap = await getDocs(query(collection(db, "students"), where("coach_id", "==", coachId)));
    var out = [];
    snap.forEach(function (d) {
      var x = typeof d.data === "function" ? d.data() : {};
      out.push({
        id: d.id,
        name: x.name || x.studentName || "Öğrenci",
      });
    });
    out.sort(function (a, b) {
      return String(a.name).localeCompare(String(b.name), "tr");
    });
    return out;
  }

  async function fetchExamDocuments(studentId, coachId) {
    var list = [];
    var q1 = query(collection(db, "exams"), where("studentId", "==", studentId));
    var snap1 = await getDocs(q1);
    snap1.forEach(function (d) {
      var x = typeof d.data === "function" ? d.data() : {};
      if (coachId && String(x.coach_id || "") !== String(coachId)) return;
      list.push(normalizeExamDoc(Object.assign({ id: d.id }, x), "exams"));
    });

    var q2 = query(collection(db, APPWRITE_COLLECTION_EXAM_RESULTS), where("student_id", "==", studentId));
    var snap2 = await getDocs(q2);
    snap2.forEach(function (d) {
      var x = typeof d.data === "function" ? d.data() : {};
      if (coachId && String(x.coach_id || "") !== String(coachId)) return;
      list.push(normalizeExamResultDoc(Object.assign({ id: d.id }, x)));
    });

    list.sort(function (a, b) {
      return String(b.date || "").localeCompare(String(a.date || ""));
    });
    return list;
  }

  async function fetchAllCoachExams(coachId) {
    if (!coachId) return [];
    var snap = await getDocs(query(collection(db, "exams"), where("coach_id", "==", coachId)));
    var out = [];
    snap.forEach(function (d) {
      var x = typeof d.data === "function" ? d.data() : {};
      out.push(normalizeExamDoc(Object.assign({ id: d.id }, x), "exams"));
    });
    return out;
  }

  function pickLatestForMode(docs, mode, aytKey) {
    var filtered = docs.filter(function (e) {
      var tur = String(e.examType || "").toUpperCase();
      if (mode === "TYT") return tur === "TYT";
      if (mode === "AYT") {
        if (tur !== "AYT") return false;
        var det = e.yksBranchDetail || {};
        var alan = normalizeAytAlanKey(det.aytAlan || "sayisal");
        return alan === normalizeAytAlanKey(aytKey || "sayisal");
      }
      return false;
    });
    filtered.sort(function (a, b) {
      var c = String(b.date || "").localeCompare(String(a.date || ""));
      if (c !== 0) return c;
      return String(b.examName || "").localeCompare(String(a.examName || ""));
    });
    return filtered[0] || null;
  }

  function buildViewModelFromExam(exam, mode, aytKey) {
    var det = exam.yksBranchDetail;
    if (!det || !det.rows || typeof det.rows !== "object" || !Object.keys(det.rows).length) return null;
    var em = String(det.examMode || mode).toUpperCase();
    var alan = normalizeAytAlanKey(det.aytAlan || aytKey || "sayisal");
    var rows = det.rows;
    var branches = rowsFromYksDetail(det, em, alan);
    var weakTopics = weakTopicsFromDetail(det);
    var totalNet = 0;
    if (det.computed && typeof det.computed.totalNet === "number") totalNet = det.computed.totalNet;
    else {
      Object.keys(rows).forEach(function (k) {
        totalNet += branchNetFromRow(rows[k]);
      });
    }

    var radar =
      em === "AYT" ? aytRadarFromRows(rows, alan) : tytRadarFromRows(rows);
    var bar = {
      labels: radar.labels.slice(),
      student: radar.student.slice(),
      institution: radar.student.slice(),
    };

    return {
      exam: {
        name: exam.examName || "Deneme",
        date: exam.date || "—",
        institution: "Appwrite · " + (exam.source || "kayıt"),
        examType: em === "AYT" ? "AYT · " + aytAlanDisplayLabel(alan) : "TYT",
      },
      kpis: {
        totalNet: totalNet,
        scoreLabel: em === "TYT" ? "TYT toplam net" : "AYT toplam net",
        scoreValue: String(totalNet).replace(".", ","),
        kurumRank: { place: "—", total: "—" },
        genelRank: { place: "—", total: "—" },
      },
      branches: branches,
      weakTopics: weakTopics,
      radar: radar,
      bar: bar,
    };
  }

  function averageRadarFromCoachPool(allExams, mode, aytKey) {
    var nets = [];
    allExams.forEach(function (ex) {
      var pick = pickLatestForMode([ex], mode, aytKey);
      if (!pick || !pick.yksBranchDetail || !pick.yksBranchDetail.rows) return;
      var det = pick.yksBranchDetail;
      var em = String(det.examMode || mode).toUpperCase();
      var alan = normalizeAytAlanKey(det.aytAlan || aytKey || "sayisal");
      var rows = det.rows;
      var r =
        em === "AYT" ? aytRadarFromRows(rows, alan) : tytRadarFromRows(rows);
      if (r.student && r.student.length) nets.push(r.student);
    });
    if (!nets.length) return null;
    var len = nets[0].length;
    var avg = [];
    for (var i = 0; i < len; i++) {
      var sum = 0;
      var n = 0;
      for (var j = 0; j < nets.length; j++) {
        if (nets[j][i] != null && !isNaN(nets[j][i])) {
          sum += nets[j][i];
          n++;
        }
      }
      avg.push(n > 0 ? sum / n : 0);
    }
    return avg;
  }

  function mergeBarInstitution(view, coachExams, mode, aytKey) {
    if (!view || !view.bar) return;
    var avg = averageRadarFromCoachPool(coachExams, mode, aytKey);
    if (avg && avg.length === view.bar.student.length) {
      view.bar.institution = avg;
    }
  }

  function destroyCharts() {
    try {
      if (chartRadar && typeof chartRadar.destroy === "function") chartRadar.destroy();
    } catch (e) {}
    try {
      if (chartBar && typeof chartBar.destroy === "function") chartBar.destroy();
    } catch (e) {}
    chartRadar = null;
    chartBar = null;
  }

  function pctClass(pct) {
    if (pct < 50) return "dk-premium__pct dk-premium__pct--low";
    if (pct >= 80) return "dk-premium__pct dk-premium__pct--high";
    return "dk-premium__pct";
  }

  function formatNum(n) {
    if (typeof n !== "number" || isNaN(n)) return "—";
    return String(n).replace(".", ",");
  }

  function formatIntTr(n) {
    if (typeof n !== "number" || isNaN(n)) return "—";
    return n.toLocaleString("tr-TR");
  }

  function renderTableRows(branches) {
    return branches
      .map(function (row) {
        return (
          "<tr>" +
          '<td class="dk-premium__td-lesson">' +
          escapeHtml(row.ders) +
          "</td>" +
          '<td class="dk-premium__td-num">' +
          row.soru +
          "</td>" +
          '<td class="dk-premium__td-num">' +
          row.d +
          "</td>" +
          '<td class="dk-premium__td-num dk-premium__td-w">' +
          row.y +
          "</td>" +
          '<td class="dk-premium__td-num dk-premium__td-b">' +
          row.b +
          "</td>" +
          '<td class="dk-premium__td-num dk-premium__td-net">' +
          formatNum(row.net) +
          "</td>" +
          '<td class="' +
          pctClass(row.basari) +
          '">' +
          formatNum(row.basari) +
          "%</td>" +
          "</tr>"
        );
      })
      .join("");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function renderWeakTopics(items) {
    if (!items || !items.length) {
      return '<p class="dk-premium__empty-topics">Bu denemede işaretlenmiş zayıf konu yok.</p>';
    }
    return (
      '<ul class="dk-premium__topic-list">' +
      items
        .map(function (it) {
          return (
            '<li class="dk-premium__topic-item">' +
            '<span class="dk-premium__topic-ico" aria-hidden="true"><i class="fa-solid fa-triangle-exclamation"></i></span>' +
            '<div class="dk-premium__topic-body">' +
            (it.branch ? "<strong>" + escapeHtml(it.branch) + "</strong> — " : "") +
            escapeHtml(it.topic) +
            '<span class="dk-premium__topic-meta"> · ' +
            escapeHtml(String(it.yanlis)) +
            " Yanlış" +
            (it.bos ? ", " + escapeHtml(String(it.bos)) + " Boş" : "") +
            "</span>" +
            "</div>" +
            "</li>"
          );
        })
        .join("") +
      "</ul>"
    );
  }

  function buildRadarChart(canvas, radar) {
    if (!canvas || typeof Chart === "undefined" || !radar || !radar.labels || !radar.labels.length) return;
    var maxV = 0;
    (radar.student || []).forEach(function (v) {
      if (v > maxV) maxV = v;
    });
    var sugMax = Math.max(10, Math.ceil(maxV / 5) * 5 + 5);
    chartRadar = new Chart(canvas, {
      type: "radar",
      data: {
        labels: radar.labels,
        datasets: [
          {
            label: "Öğrenci net (branş)",
            data: radar.student,
            borderColor: "rgba(30, 64, 175, 1)",
            backgroundColor: "rgba(37, 99, 235, 0.22)",
            borderWidth: 2,
            pointBackgroundColor: "#2563eb",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          r: {
            min: 0,
            max: sugMax,
            ticks: { color: "#64748b", backdropColor: "transparent" },
            grid: { color: "rgba(148, 163, 184, 0.28)" },
            pointLabels: { color: "#334155", font: { size: 11, weight: "600" } },
          },
        },
        plugins: {
          legend: { display: true, position: "bottom" },
        },
      },
    });
  }

  function buildBarChart(canvas, bar) {
    if (!canvas || typeof Chart === "undefined" || !bar || !bar.labels || !bar.labels.length) return;
    var ds = [
      {
        label: "Öğrenci net",
        data: bar.student,
        backgroundColor: "rgba(37, 99, 235, 0.75)",
        borderColor: "rgba(30, 64, 175, 1)",
        borderWidth: 1,
        borderRadius: 6,
      },
    ];
    if (bar.institution && bar.institution.length === bar.student.length) {
      ds.push({
        label: "Kurum ortalaması (koçtaki tüm denemeler)",
        data: bar.institution,
        backgroundColor: "rgba(148, 163, 184, 0.55)",
        borderColor: "rgba(100, 116, 139, 0.9)",
        borderWidth: 1,
        borderRadius: 6,
      });
    }
    chartBar = new Chart(canvas, {
      type: "bar",
      data: {
        labels: bar.labels,
        datasets: ds,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            position: "top",
            labels: { usePointStyle: true, padding: 16, font: { size: 12, weight: "600" } },
          },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.92)",
            titleColor: "#f8fafc",
            bodyColor: "#e2e8f0",
            borderColor: "rgba(37, 99, 235, 0.45)",
            borderWidth: 1,
            padding: 12,
          },
        },
        scales: {
          x: {
            ticks: { color: "#64748b", maxRotation: 35, minRotation: 0, font: { size: 10 } },
            grid: { display: false },
          },
          y: {
            beginAtZero: true,
            ticks: { color: "#64748b" },
            grid: { color: "rgba(148, 163, 184, 0.15)" },
          },
        },
      },
    });
  }

  function mount(root, data) {
    var ex = data.exam;
    var kp = data.kpis;
    var kr = kp.kurumRank;
    var gr = kp.genelRank;

    root.innerHTML =
      '<header class="dk-premium__identity">' +
      '<div class="dk-premium__identity-main">' +
      "<h1>" +
      escapeHtml(ex.name) +
      "</h1>" +
      '<div class="dk-premium__identity-meta">' +
      '<span><i class="fa-regular fa-calendar" aria-hidden="true"></i> ' +
      escapeHtml(ex.date) +
      "</span>" +
      '<span><i class="fa-solid fa-building-columns" aria-hidden="true"></i> ' +
      escapeHtml(ex.institution) +
      "</span>" +
      '<span class="dk-premium__badge-type">' +
      escapeHtml(ex.examType) +
      "</span>" +
      "</div>" +
      "</div>" +
      "</header>" +
      '<div class="dk-premium__kpi-row">' +
      '<article class="dk-premium__kpi dk-premium__kpi--net"><span class="dk-premium__kpi-label">Toplam net</span>' +
      '<p class="dk-premium__kpi-value">' +
      formatNum(kp.totalNet) +
      "</p></article>" +
      '<article class="dk-premium__kpi dk-premium__kpi--score"><span class="dk-premium__kpi-label">' +
      escapeHtml(kp.scoreLabel) +
      "</span>" +
      '<p class="dk-premium__kpi-value dk-premium__kpi-value--sm">' +
      escapeHtml(kp.scoreValue) +
      "</p></article>" +
      '<article class="dk-premium__kpi dk-premium__kpi--inst"><span class="dk-premium__kpi-label">Kurum sıralaması</span>' +
      '<p class="dk-premium__kpi-value">' +
      kr.place +
      " / " +
      kr.total +
      "</p>" +
      '<p class="dk-premium__kpi-hint">Veri girildiğinde</p></article>' +
      '<article class="dk-premium__kpi dk-premium__kpi--gen"><span class="dk-premium__kpi-label">Genel sıralama</span>' +
      '<p class="dk-premium__kpi-value dk-premium__kpi-value--sm">' +
      formatIntTr(typeof gr.place === "number" ? gr.place : NaN) +
      " / " +
      formatIntTr(typeof gr.total === "number" ? gr.total : NaN) +
      "</p>" +
      '<p class="dk-premium__kpi-hint">Henüz hesaplanmadı</p></article>' +
      "</div>" +
      '<section class="dk-premium__section" aria-labelledby="dk-premium-branches-title">' +
      '<div class="dk-premium__section-head">' +
      '<h2 id="dk-premium-branches-title">Branş bazlı net analizi</h2>' +
      "<p>Doğru · Yanlış · Boş · Net ve başarı yüzdesi (Appwrite)</p>" +
      "</div>" +
      '<div class="dk-premium__table-wrap">' +
      "<table class=\"dk-premium__table\">" +
      "<thead><tr>" +
      "<th>Ders adı</th>" +
      "<th>Soru</th>" +
      "<th>Doğru</th>" +
      "<th>Yanlış</th>" +
      "<th>Boş</th>" +
      "<th>Net</th>" +
      "<th>Başarı %</th>" +
      "</tr></thead>" +
      "<tbody>" +
      renderTableRows(data.branches) +
      "</tbody></table></div></section>" +
      '<div class="dk-premium__split">' +
      '<section class="dk-premium__panel dk-premium__panel--topics" aria-labelledby="dk-premium-topics-title">' +
      '<div class="dk-premium__panel-head">' +
      '<h2 id="dk-premium-topics-title"><i class="fa-solid fa-bullseye" aria-hidden="true"></i> Dikkat edilmesi gereken konular (Hatalı / Boş)</h2>' +
      "</div>" +
      '<div class="dk-premium__panel-body">' +
      renderWeakTopics(data.weakTopics) +
      "</div></section>" +
      '<div class="dk-premium__charts">' +
      '<div class="dk-premium__chart-card">' +
      "<h3>Branş dengesi (radar)</h3>" +
      '<p class="dk-premium__chart-sub">TYT: temel dört alan · AYT: alan dersleri</p>' +
      '<div class="dk-premium__chart-canvas"><canvas id="dkPremiumRadarCanvas" aria-label="Radar grafik"></canvas></div></div>' +
      '<div class="dk-premium__chart-card">' +
      "<h3>Öğrenci vs kurum ortalaması</h3>" +
      '<p class="dk-premium__chart-sub">Kurum: koç hesabındaki tüm denemelerden aynı türde ortalama</p>' +
      '<div class="dk-premium__chart-canvas"><canvas id="dkPremiumBarCanvas" aria-label="Bar grafik"></canvas></div></div>' +
      "</div></div>";

    destroyCharts();
    requestAnimationFrame(function () {
      var c1 = document.getElementById("dkPremiumRadarCanvas");
      var c2 = document.getElementById("dkPremiumBarCanvas");
      buildRadarChart(c1, data.radar);
      buildBarChart(c2, data.bar);
    });
  }

  function mountEmpty(root, message) {
    destroyCharts();
    root.innerHTML =
      '<div class="dk-premium__empty-state">' +
      '<div class="dk-premium__empty-state-inner">' +
      '<i class="fa-solid fa-chart-simple" aria-hidden="true"></i>' +
      "<p>" +
      escapeHtml(message || "Veri yok.") +
      "</p>" +
      "</div></div>";
  }

  function readModeFromUi(root) {
    var mode = "TYT";
    var ayt = root.querySelector('[name="dk-premium-mode"][value="AYT"]');
    if (ayt && ayt.checked) mode = "AYT";
    var alan = "sayisal";
    var sel = root.querySelector("#dkPremiumAytAlan");
    if (sel && mode === "AYT") alan = sel.value || "sayisal";
    return { mode: mode, aytKey: alan };
  }

  function getSelectedStudentId(root) {
    var sel = root.querySelector("#dkPremiumStudentSelect");
    return sel && sel.value ? String(sel.value).trim() : "";
  }

  var fetchState = { loading: false, lastStudent: "", coachExams: [] };

  function renderToolbar(root) {
    var wrap = root.querySelector(".dk-premium__toolbar-inner");
    if (!wrap) return;
    wrap.innerHTML =
      '<label class="dk-premium__field dk-premium__field--student"><span>Öğrenci</span>' +
      '<select id="dkPremiumStudentSelect" class="dk-premium__select">' +
      '<option value="">— Öğrenci seçin —</option>' +
      "</select></label>" +
      '<div class="dk-premium__exam-tabs" role="tablist" aria-label="Sınav türü">' +
      '<label class="dk-premium__tab"><input type="radio" name="dk-premium-mode" value="TYT" checked /> TYT</label>' +
      '<label class="dk-premium__tab"><input type="radio" name="dk-premium-mode" value="AYT" /> AYT</label>' +
      "</div>" +
      '<div class="dk-premium__ayt-tools" id="dkPremiumAytTools" hidden>' +
      '<label class="dk-premium__field"><span>Alan</span>' +
      '<select id="dkPremiumAytAlan" class="dk-premium__select">' +
      '<option value="sayisal">Sayısal</option>' +
      '<option value="esit_agirlik">Eşit Ağırlık</option>' +
      '<option value="sozel">Sözel</option>' +
      "</select></label></div>";
  }

  async function populateStudentSelect(root) {
    var sel = root.querySelector("#dkPremiumStudentSelect");
    if (!sel) return;
    var cid = getCoachId();
    var students = await fetchStudentsForCoach(cid);
    var keep = sel.value;
    sel.innerHTML = '<option value="">— Öğrenci seçin —</option>';
    students.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name;
      sel.appendChild(o);
    });
    if (keep && students.some(function (x) { return x.id === keep; })) sel.value = keep;
  }

  async function loadAndRender(root) {
    var content = root.querySelector("#dkPremiumContent");
    if (!content) return;
    var sid = getSelectedStudentId(root);
    var m = readModeFromUi(root);
    var aytTools = root.querySelector("#dkPremiumAytTools");
    if (aytTools) aytTools.hidden = m.mode !== "AYT";

    if (!sid) {
      mountEmpty(content, "Analiz için önce bir öğrenci seçin.");
      return;
    }

    if (fetchState.loading) return;
    fetchState.loading = true;
    content.innerHTML =
      '<p class="dk-premium__loading"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Deneme verileri yükleniyor…</p>';

    try {
      var cid = getCoachId();
      var docs = await fetchExamDocuments(sid, cid);
      if (!fetchState.coachExams.length) {
        fetchState.coachExams = await fetchAllCoachExams(cid);
      }
      var latest = pickLatestForMode(docs, m.mode, m.aytKey);
      if (
        !latest ||
        !latest.yksBranchDetail ||
        !latest.yksBranchDetail.rows ||
        typeof latest.yksBranchDetail.rows !== "object" ||
        !Object.keys(latest.yksBranchDetail.rows).length
      ) {
        mountEmpty(
          content,
          docs.length
            ? "Son denemelerin branş detayı (D/Y) kaydı yok. Optik veya manuel girişle tamamlayın."
            : "Bu öğrenciye ait henüz deneme verisi bulunmamaktadır."
        );
        return;
      }
      var view = buildViewModelFromExam(latest, m.mode, m.aytKey);
      if (!view) {
        mountEmpty(content, "Deneme kaydı okunamadı.");
        return;
      }
      mergeBarInstitution(view, fetchState.coachExams, m.mode, m.aytKey);
      mount(content, view);
    } catch (err) {
      console.error("[deneme-analizi]", err);
      mountEmpty(content, "Veriler yüklenirken bir hata oluştu. Bağlantınızı kontrol edin.");
    } finally {
      fetchState.loading = false;
    }
  }

  function bindToolbar(root) {
    var content = root.querySelector("#dkPremiumContent");
    if (!content) return;

    function refresh() {
      void loadAndRender(root);
    }

    if (!root.dataset.dkToolbarBound) {
      root.dataset.dkToolbarBound = "1";
      root.addEventListener("change", function (ev) {
        var t = ev.target;
        if (!t || !t.id) return;
        if (
          t.id === "dkPremiumStudentSelect" ||
          t.name === "dk-premium-mode" ||
          t.id === "dkPremiumAytAlan"
        ) {
          if (t.id === "dkPremiumStudentSelect") {
            fetchState.coachExams = [];
          }
          refresh();
        }
      });
    }
    refresh();
  }

  function initDenemeAnaliziPremium() {
    var root = document.getElementById("denemeAnaliziPremiumRoot");
    if (!root) return;
    renderToolbar(root);
    void populateStudentSelect(root).then(function () {
      bindToolbar(root);
    });
  }

  function destroyDenemeAnaliziPremium() {
    destroyCharts();
  }

  /* ——— Denemeler: koç planlama (exams + recordType coach_exam_plan) ——— */
  var DNM_RECORD = "coach_exam_plan";
  var dnmPlanBound = false;
  var dnmPlansCache = [];
  var dnmAiExamFile = null;
  var dnmAiKeyFile = null;
  var dnmMatrixBusy = false;
  var dnmXimFile = null;
  var dnmXimUiBound = false;

  function dnmMufredatExamKey(tur) {
    var t = String(tur || "TYT").toUpperCase();
    if (t === "LGS") return "TYT";
    var keys = yks2026DersKeys(t);
    if (keys && keys.length) return t;
    return "TYT";
  }

  function dnmToggleAiUploadSection() {
    var sec = document.getElementById("dnmAiUploadSection");
    var st = document.getElementById("dnmPlanSinavTuru");
    if (!sec || !st) return;
    sec.hidden = !String(st.value || "").trim();
  }

  function dnmClearMatrixUi() {
    var tbody = document.getElementById("dnmMatrixBody");
    var tbl = document.getElementById("dnmMatrixTable");
    if (tbody) tbody.innerHTML = "";
    if (tbl) tbl.hidden = true;
  }

  function dnmSimulateMatrixRows(n, examKey) {
    var dersList = yks2026DersKeys(examKey);
    if (!dersList || !dersList.length) dersList = ["TYT Türkçe"];
    var letters = ["A", "B", "C", "D", "E"];
    var rows = [];
    for (var i = 1; i <= n; i++) {
      var ders = dersList[(i - 1) % dersList.length];
      var topics = yks2026KonuOptionsForDers(examKey, ders);
      var konu = topics.length ? topics[Math.abs((i * 7) % topics.length)].value : "Genel";
      rows.push({
        questionNo: i,
        ders: ders,
        konu: konu,
        answer: letters[(i + 2) % 5],
      });
    }
    return rows;
  }

  function dnmRenderMatrixRows(rows, examKey) {
    var tbody = document.getElementById("dnmMatrixBody");
    var tbl = document.getElementById("dnmMatrixTable");
    if (!tbody || !tbl || !rows || !rows.length) return;
    tbody.innerHTML = "";
    var dersList = yks2026DersKeys(examKey);
    if (!dersList || !dersList.length) dersList = ["TYT Türkçe"];
    rows.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.dataset.dnmQ = String(r.questionNo);
      var tdN = document.createElement("td");
      tdN.className = "dnm-col-n";
      tdN.textContent = String(r.questionNo);
      var tdD = document.createElement("td");
      var selD = document.createElement("select");
      selD.className = "dnm-matrix-select js-dnm-mx-ders";
      selD.setAttribute("aria-label", "Soru " + r.questionNo + " ders");
      dersList.forEach(function (dk) {
        var o = document.createElement("option");
        o.value = dk;
        o.textContent = dk;
        if (dk === r.ders) o.selected = true;
        selD.appendChild(o);
      });
      tdD.appendChild(selD);
      var tdK = document.createElement("td");
      var selK = document.createElement("select");
      selK.className = "dnm-matrix-select js-dnm-mx-konu";
      selK.setAttribute("aria-label", "Soru " + r.questionNo + " konu");
      tdK.appendChild(selK);
      var tdA = document.createElement("td");
      tdA.className = "dnm-col-ans";
      var selA = document.createElement("select");
      selA.className = "dnm-matrix-select js-dnm-mx-ans";
      selA.setAttribute("aria-label", "Soru " + r.questionNo + " doğru şık");
      "ABCDE".split("").forEach(function (L) {
        var o = document.createElement("option");
        o.value = L;
        o.textContent = L;
        if (L === String(r.answer || "A").toUpperCase().charAt(0)) o.selected = true;
        selA.appendChild(o);
      });
      tdA.appendChild(selA);
      tr.appendChild(tdN);
      tr.appendChild(tdD);
      tr.appendChild(tdK);
      tr.appendChild(tdA);
      tbody.appendChild(tr);
      function refillKonu() {
        var dval = selD.value;
        selK.innerHTML = "";
        yks2026KonuOptionsForDers(examKey, dval).forEach(function (ko) {
          var o = document.createElement("option");
          o.value = ko.value;
          o.textContent = ko.text;
          selK.appendChild(o);
        });
        var want = String(r.konu || "").trim();
        if (want && Array.prototype.some.call(selK.options, function (op) { return op.value === want; })) {
          selK.value = want;
        } else if (selK.options[0]) selK.selectedIndex = 0;
      }
      refillKonu();
      selD.addEventListener("change", refillKonu);
    });
    tbl.hidden = false;
  }

  function dnmCollectMatrixFromDom() {
    var tbody = document.getElementById("dnmMatrixBody");
    var tbl = document.getElementById("dnmMatrixTable");
    if (!tbody || !tbl || tbl.hidden) return [];
    var out = [];
    tbody.querySelectorAll("tr[data-dnm-q]").forEach(function (tr) {
      var q = parseInt(tr.getAttribute("data-dnm-q"), 10);
      var d = tr.querySelector(".js-dnm-mx-ders");
      var k = tr.querySelector(".js-dnm-mx-konu");
      var a = tr.querySelector(".js-dnm-mx-ans");
      if (!d || !k || !a || isNaN(q)) return;
      out.push({
        questionNo: q,
        ders: String(d.value || "").trim(),
        konu: String(k.value || "").trim(),
        answer: String(a.value || "A").trim().toUpperCase().charAt(0),
      });
    });
    out.sort(function (x, y) {
      return x.questionNo - y.questionNo;
    });
    return out;
  }

  function dnmRunAiAnalysisSimulated() {
    if (dnmMatrixBusy) return;
    if (!(dnmAiExamFile && dnmAiKeyFile)) return;
    var turEl = document.getElementById("dnmPlanSinavTuru");
    if (!turEl || !String(turEl.value || "").trim()) return;
    var examKey = dnmMufredatExamKey(turEl.value);
    var nEl = document.getElementById("dnmQCount");
    var n = parseInt(String(nEl && nEl.value ? nEl.value : "40"), 10);
    if (isNaN(n) || n < 1) n = 40;
    n = Math.min(200, Math.max(1, n));
    dnmMatrixBusy = true;
    var ov = document.getElementById("dnmPdfAnalyzingOverlay");
    var saveBtn = document.getElementById("btnDnmSave");
    if (ov) ov.hidden = false;
    if (saveBtn) saveBtn.disabled = true;
    window.setTimeout(function () {
      try {
        var rows = dnmSimulateMatrixRows(n, examKey);
        dnmRenderMatrixRows(rows, examKey);
        var det = document.getElementById("dnmDetailsAdvanced");
        if (det) det.open = true;
        if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
          global.YKSPanel.toast("Örnek matris oluşturuldu. Ders/konu/şıkları kontrol edin.");
        }
      } catch (e) {
        console.error("[dnm ai]", e);
        alert("Matris oluşturulamadı.");
      } finally {
        dnmMatrixBusy = false;
        if (ov) ov.hidden = true;
        if (saveBtn) saveBtn.disabled = false;
      }
    }, 1850);
  }

  function dnmTryRunDualPdfAnalysis() {
    dnmRunAiAnalysisSimulated();
  }

  function dnmBuildMatrixManual() {
    var turEl = document.getElementById("dnmPlanSinavTuru");
    if (!turEl || !String(turEl.value || "").trim()) {
      alert("Önce sınav türü seçin.");
      return;
    }
    var examKey = dnmMufredatExamKey(turEl.value);
    var nEl = document.getElementById("dnmQCount");
    var n = parseInt(String(nEl && nEl.value ? nEl.value : "40"), 10);
    if (isNaN(n) || n < 1) n = 40;
    n = Math.min(200, Math.max(1, n));
    var dersList = yks2026DersKeys(examKey);
    var firstD = (dersList && dersList[0]) || "TYT Türkçe";
    var topics = yks2026KonuOptionsForDers(examKey, firstD);
    var firstK = topics[0] ? topics[0].value : "Genel";
    var rows = [];
    for (var i = 1; i <= n; i++) {
      rows.push({ questionNo: i, ders: firstD, konu: firstK, answer: "A" });
    }
    dnmRenderMatrixRows(rows, examKey);
    var det = document.getElementById("dnmDetailsAdvanced");
    if (det) det.open = true;
  }

  function dnmWireFileDrop(zoneId, inputId, labelId, onFile) {
    var z = document.getElementById(zoneId);
    var inp = document.getElementById(inputId);
    var lab = document.getElementById(labelId);
    if (!z || !inp) return;
    function apply(f) {
      if (!f) return;
      if (lab) lab.textContent = f.name;
      onFile(f);
    }
    z.addEventListener("click", function () {
      inp.click();
    });
    z.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        inp.click();
      }
    });
    inp.addEventListener("change", function () {
      var f = inp.files && inp.files[0];
      apply(f);
    });
    ["dragenter", "dragover"].forEach(function (ev) {
      z.addEventListener(ev, function (e) {
        e.preventDefault();
        z.classList.add("is-dragover");
      });
    });
    z.addEventListener("dragleave", function () {
      z.classList.remove("is-dragover");
    });
    z.addEventListener("drop", function (e) {
      e.preventDefault();
      z.classList.remove("is-dragover");
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) apply(f);
    });
  }

  function dnmBindAiMatrixUi() {
    dnmWireFileDrop("dnmAiDropExam", "dnmAiFileExam", "dnmAiExamFileLabel", function (f) {
      dnmAiExamFile = f;
      dnmTryRunDualPdfAnalysis();
    });
    dnmWireFileDrop("dnmAiDropKey", "dnmAiFileKey", "dnmAiKeyFileLabel", function (f) {
      dnmAiKeyFile = f;
      dnmTryRunDualPdfAnalysis();
    });
    var st = document.getElementById("dnmPlanSinavTuru");
    if (st) {
      st.addEventListener("change", function () {
        dnmToggleAiUploadSection();
      });
    }
    var b = document.getElementById("btnDnmBuildMatrix");
    if (b) {
      b.addEventListener("click", function () {
        dnmBuildMatrixManual();
      });
    }
  }

  var DNM_YAYIN_LABELS = {
    "3d": "3D Yayınları",
    bilgi_sarmal: "Bilgi Sarmal",
    "345": "345 Yayınları",
    acil: "Acil Yayınları",
    paraf: "Paraf Yayınları",
    tonguc: "Tonguç Akademi",
    ens: "En Sınav",
    ozdebir: "Özdebir",
    dig: "Diğer",
  };

  function dnmYayinLabel(key) {
    return DNM_YAYIN_LABELS[key] || key || "—";
  }

  function dnmXimToast(msg, variant) {
    if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
      global.YKSPanel.toast(msg, { variant: variant || "success" });
    } else {
      alert(msg);
    }
  }

  function dnmNormHeaderKeyExcel(h) {
    return String(h || "")
      .toLowerCase()
      .replace(/ç/g, "c")
      .replace(/ğ/g, "g")
      .replace(/ı/g, "i")
      .replace(/ö/g, "o")
      .replace(/ş/g, "s")
      .replace(/ü/g, "u")
      .replace(/İ/g, "i")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function dnmPublisherKeyFromExcelCell(raw) {
    var t = String(raw == null ? "" : raw).trim();
    if (!t) return "dig";
    if (DNM_YAYIN_LABELS[t]) return t;
    var low = t.toLowerCase();
    for (var k in DNM_YAYIN_LABELS) {
      if (!Object.prototype.hasOwnProperty.call(DNM_YAYIN_LABELS, k)) continue;
      var lab = String(DNM_YAYIN_LABELS[k]).toLowerCase();
      if (low === lab) return k;
      if (lab && low.indexOf(lab) !== -1) return k;
      if (low && lab.indexOf(low) !== -1) return k;
    }
    if (low.indexOf("3d") !== -1 && low.indexOf("345") === -1) return "3d";
    if (low.indexOf("345") !== -1) return "345";
    if (low.indexOf("sarmal") !== -1) return "bilgi_sarmal";
    if (low.indexOf("acil") !== -1) return "acil";
    if (low.indexOf("paraf") !== -1) return "paraf";
    if (low.indexOf("tongu") !== -1) return "tonguc";
    if (low.indexOf("en s") !== -1 || /^ens(\s|$)/.test(low)) return "ens";
    if (low.indexOf("özdebir") !== -1 || low.indexOf("ozdebir") !== -1) return "ozdebir";
    return "dig";
  }

  function dnmPad2(n) {
    var x = Number(n);
    if (!isFinite(x)) return "00";
    var s = String(Math.floor(x));
    return s.length < 2 ? "0" + s : s;
  }

  function dnmParseExcelDateToIso(val) {
    if (val instanceof Date && !isNaN(val.getTime())) {
      return (
        val.getFullYear() + "-" + dnmPad2(val.getMonth() + 1) + "-" + dnmPad2(val.getDate())
      );
    }
    if (
      typeof val === "number" &&
      isFinite(val) &&
      typeof XLSX !== "undefined" &&
      XLSX.SSF &&
      typeof XLSX.SSF.parse_date_code === "function"
    ) {
      var u = XLSX.SSF.parse_date_code(val);
      if (u && u.y != null) {
        return u.y + "-" + dnmPad2(u.m) + "-" + dnmPad2(u.d);
      }
    }
    var s = String(val == null ? "" : val).trim();
    var m = s.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/);
    if (m) return m[3] + "-" + dnmPad2(m[2]) + "-" + dnmPad2(m[1]);
    if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
    return "";
  }

  function dnmNormSinavTurExcel(raw) {
    var u = String(raw || "").trim().toUpperCase();
    if (!u) return "";
    if (u.indexOf("TYT") !== -1) return "TYT";
    if (u.indexOf("AYT") !== -1) return "AYT";
    if (u.indexOf("YDT") !== -1) return "YDT";
    if (u.indexOf("LGS") !== -1) return "LGS";
    return "";
  }

  function dnmNormDifficultyExcel(raw) {
    var s = String(raw || "").trim().toLowerCase();
    if (s.indexOf("kolay") !== -1) return "kolay";
    if (s.indexOf("zor") !== -1) return "zor";
    return "orta";
  }

  function dnmExtractExamFieldsFromExcelRow(obj) {
    var examName = "";
    var turRaw = "";
    var pubRaw = "";
    var dateRaw = "";
    var diffRaw = "";
    Object.keys(obj).forEach(function (key) {
      var nh = dnmNormHeaderKeyExcel(key);
      var val = obj[key];
      if (val == null) val = "";
      if (nh.indexOf("deneme") !== -1 && (nh.indexOf("ad") !== -1 || nh.indexOf("isim") !== -1)) {
        examName = String(val).trim();
      } else if (
        (nh.indexOf("sinav") !== -1 && nh.indexOf("tur") !== -1) ||
        nh === "tur" ||
        nh.indexOf("sinav turu") !== -1
      ) {
        turRaw = val;
      } else if (nh.indexOf("yayin") !== -1) {
        pubRaw = val;
      } else if (nh.indexOf("zorluk") !== -1) {
        diffRaw = val;
      } else if (
        nh.indexOf("uygulama") !== -1 ||
        (nh.indexOf("tarih") !== -1 && nh.indexOf("zorluk") === -1)
      ) {
        dateRaw = val;
      }
    });
    return {
      examName: examName,
      tur: dnmNormSinavTurExcel(turRaw),
      publisher: dnmPublisherKeyFromExcelCell(pubRaw),
      dateIso: dnmParseExcelDateToIso(dateRaw),
      difficulty: dnmNormDifficultyExcel(diffRaw),
    };
  }

  function dnmDownloadExamExcelTemplate() {
    if (typeof XLSX === "undefined") {
      dnmXimToast("Excel kütüphanesi yüklenemedi. Sayfayı yenileyin.", "danger");
      return;
    }
    var headers = [
      "Deneme Adı",
      "Sınav Türü (TYT/AYT)",
      "Yayın Evi",
      "Uygulama Tarihi (GG.AA.YYYY)",
      "Zorluk (Kolay/Orta/Zor)",
    ];
    var row1 = ["Örnek Genel Deneme", "TYT", "Özdebir", "15.03.2026", "Orta"];
    var ws = XLSX.utils.aoa_to_sheet([headers, row1]);
    ws["!cols"] = [{ wch: 30 }, { wch: 26 }, { wch: 18 }, { wch: 32 }, { wch: 28 }];
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Denemeler");
    XLSX.writeFile(wb, "deneme_toplu_sablon.xlsx");
  }

  async function dnmBulkImportExamsFromExcel(file) {
    var cid = getCoachId();
    if (!cid) throw new Error("Koç oturumu bulunamadı.");
    if (typeof XLSX === "undefined") throw new Error("Excel kütüphanesi yüklenemedi.");
    var buf = await file.arrayBuffer();
    var wb = XLSX.read(buf, { type: "array", cellDates: true });
    var sn = wb.SheetNames[0];
    if (!sn) throw new Error("Çalışma sayfası bulunamadı.");
    var ws = wb.Sheets[sn];
    var rows = XLSX.utils.sheet_to_json(ws, { defval: "", raw: true });
    if (!rows.length) throw new Error("Dosyada veri satırı yok.");
    var ok = 0;
    var fail = 0;
    var failMsgs = [];
    for (var i = 0; i < rows.length; i++) {
      var ex = dnmExtractExamFieldsFromExcelRow(rows[i]);
      if (String(ex.examName || "").trim() === "Örnek Genel Deneme") continue;
      if (!ex.examName || !ex.tur || !ex.publisher || !ex.dateIso) {
        fail++;
        if (failMsgs.length < 6) {
          failMsgs.push("Satır " + (i + 2) + ": zorunlu alan eksik veya tarih/geçersiz.");
        }
        continue;
      }
      var dateStr = ex.dateIso;
      var examDateTs = Timestamp.fromDate(new Date(dateStr + "T12:00:00"));
      var payload = {
        coach_id: cid,
        recordType: DNM_RECORD,
        isCoachExamPlan: true,
        examName: ex.examName,
        type: ex.tur,
        examType: ex.tur,
        tur: ex.tur,
        publisher: ex.publisher,
        yayin_evi: ex.publisher,
        date: dateStr,
        examDate: examDateTs,
        difficulty: ex.difficulty,
        planStatus: "Bekliyor",
        status: "Bekliyor",
        aiExtractionMeta: {
          bulkImport: true,
          source: "excel",
          rowIndex: i,
          fileName: file.name,
          importedAtIso: new Date().toISOString(),
        },
      };
      try {
        payload.createdAt = serverTimestamp();
        var wr = await addDoc(collection(db, "exams"), payload);
        if (isAppwriteWriteSoftFailure(wr)) {
          fail++;
          if (failMsgs.length < 6) {
            failMsgs.push("Satır " + (i + 2) + ": Appwrite kayıt reddedildi.");
          }
        } else {
          ok++;
        }
      } catch (err) {
        fail++;
        if (failMsgs.length < 6) {
          failMsgs.push("Satır " + (i + 2) + ": " + ((err && err.message) || String(err)));
        }
      }
    }
    return { ok: ok, fail: fail, failMsgs: failMsgs };
  }

  function dnmGetExcelImportModal() {
    return document.getElementById("dnmExcelImportModal");
  }

  function dnmSetXimUploadLoading(on) {
    var up = document.getElementById("btnDnmXimUpload");
    if (!up) return;
    var idle = up.querySelector(".dnm-xim-upload__idle");
    var busy = up.querySelector(".dnm-xim-upload__busy");
    if (idle) idle.hidden = !!on;
    if (busy) busy.hidden = !on;
    up.disabled = on ? true : !dnmXimFile;
  }

  function dnmOpenExcelImportModal() {
    var m = dnmGetExcelImportModal();
    if (!m) return;
    dnmXimFile = null;
    var err = document.getElementById("dnmXimErr");
    var fn = document.getElementById("dnmXimFileName");
    var inp = document.getElementById("dnmXimFileInput");
    var up = document.getElementById("btnDnmXimUpload");
    var z = document.getElementById("dnmXimDropzone");
    if (err) {
      err.hidden = true;
      err.textContent = "";
    }
    if (fn) fn.textContent = "";
    if (inp) inp.value = "";
    if (up) up.disabled = true;
    if (z) z.classList.remove("is-dragover");
    dnmSetXimUploadLoading(false);
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function dnmCloseExcelImportModal() {
    var m = dnmGetExcelImportModal();
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    var planM = dnmGetModalEl();
    document.body.style.overflow = planM && !planM.hidden ? "hidden" : "";
    dnmXimFile = null;
    var inp = document.getElementById("dnmXimFileInput");
    var fn = document.getElementById("dnmXimFileName");
    var up = document.getElementById("btnDnmXimUpload");
    if (inp) inp.value = "";
    if (fn) fn.textContent = "";
    if (up) up.disabled = true;
    dnmSetXimUploadLoading(false);
    var err = document.getElementById("dnmXimErr");
    if (err) err.hidden = true;
  }

  function dnmApplyXimFile(f) {
    dnmXimFile = f || null;
    var fn = document.getElementById("dnmXimFileName");
    var up = document.getElementById("btnDnmXimUpload");
    var err = document.getElementById("dnmXimErr");
    if (err) err.hidden = true;
    if (fn) fn.textContent = f ? f.name : "";
    if (up) up.disabled = !f;
    dnmSetXimUploadLoading(false);
  }

  function dnmBindExcelImportUi() {
    if (dnmXimUiBound) return;
    var btnOpen = document.getElementById("btnDnmExcelImport");
    var m = dnmGetExcelImportModal();
    if (!btnOpen || !m) return;
    dnmXimUiBound = true;
    btnOpen.addEventListener("click", function () {
      dnmOpenExcelImportModal();
    });
    m.querySelectorAll("[data-dnm-xim-close]").forEach(function (el) {
      el.addEventListener("click", function () {
        dnmCloseExcelImportModal();
      });
    });
    var btnT = document.getElementById("btnDnmXimTemplate");
    if (btnT) {
      btnT.addEventListener("click", function () {
        dnmDownloadExamExcelTemplate();
      });
    }
    var z = document.getElementById("dnmXimDropzone");
    var inp = document.getElementById("dnmXimFileInput");
    if (z && inp) {
      z.addEventListener("click", function () {
        inp.click();
      });
      z.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inp.click();
        }
      });
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0];
        dnmApplyXimFile(f);
      });
      ["dragenter", "dragover"].forEach(function (ev) {
        z.addEventListener(ev, function (e) {
          e.preventDefault();
          e.stopPropagation();
          z.classList.add("is-dragover");
        });
      });
      z.addEventListener("dragleave", function (e) {
        e.preventDefault();
        z.classList.remove("is-dragover");
      });
      z.addEventListener("drop", function (e) {
        e.preventDefault();
        e.stopPropagation();
        z.classList.remove("is-dragover");
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) dnmApplyXimFile(f);
      });
    }
    var btnUp = document.getElementById("btnDnmXimUpload");
    if (btnUp) {
      btnUp.addEventListener("click", function () {
        if (!dnmXimFile) return;
        var errEl = document.getElementById("dnmXimErr");
        if (errEl) {
          errEl.hidden = true;
          errEl.textContent = "";
        }
        dnmSetXimUploadLoading(true);
        void (async function () {
          try {
            var res = await dnmBulkImportExamsFromExcel(dnmXimFile);
            if (!res.ok) {
              if (errEl) {
                errEl.textContent = res.failMsgs.length
                  ? res.failMsgs.join(" ")
                  : "Geçerli satır bulunamadı.";
                errEl.hidden = false;
              }
              dnmXimToast(
                "Hiçbir deneme eklenemedi" + (res.fail ? " (" + res.fail + " satır)." : "."),
                "danger"
              );
              return;
            }
            dnmXimToast(
              "Başarıyla " +
                res.ok +
                " deneme eklendi" +
                (res.fail ? " · " + res.fail + " satır atlandı." : "."),
              "success"
            );
            dnmCloseExcelImportModal();
            await dnmReloadList();
          } catch (err) {
            console.error("[dnm xim]", err);
            var msg = (err && err.message) || String(err);
            if (errEl) {
              errEl.textContent = msg;
              errEl.hidden = false;
            }
            dnmXimToast(msg, "danger");
          } finally {
            dnmSetXimUploadLoading(false);
            var up2 = document.getElementById("btnDnmXimUpload");
            if (up2 && dnmXimFile) up2.disabled = false;
          }
        })();
      });
    }
  }

  function dnmFormatDate(s) {
    if (!s) return "—";
    var d = String(s).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(d)) {
      var p = d.split("-");
      return p[2] + "." + p[1] + "." + p[0];
    }
    return s;
  }

  function dnmExamDateToIso(data) {
    var v = data.examDate;
    if (v && typeof v.toDate === "function") {
      try {
        return v.toDate().toISOString().slice(0, 10);
      } catch (e) {}
    }
    if (typeof v === "string" && v.length >= 10) return v.slice(0, 10);
    var d = data.date;
    if (typeof d === "string" && d.length >= 10) return d.slice(0, 10);
    return "";
  }

  function dnmZorlukLabel(z) {
    var k = String(z || "orta").toLowerCase();
    if (k === "kolay") return "Kolay";
    if (k === "zor") return "Zor";
    return "Orta";
  }

  function dnmIsCoachPlan(x) {
    return x && (x.recordType === DNM_RECORD || x.isCoachExamPlan === true);
  }

  async function dnmFetchPlans(coachId) {
    if (!coachId) return [];
    function collectFromSnap(snap, bucket) {
      snap.forEach(function (d) {
        var x = typeof d.data === "function" ? d.data() : {};
        var row = Object.assign({ id: d.id }, x);
        if (String(row.coach_id || "") !== String(coachId)) return;
        if (!dnmIsCoachPlan(row)) return;
        bucket.push(row);
      });
    }
    var out = [];
    var snapEq = await getDocs(query(collection(db, "exams"), where("coach_id", "==", coachId)));
    collectFromSnap(snapEq, out);
    if (out.length === 0) {
      var snapAll = await getDocs(collection(db, "exams"));
      collectFromSnap(snapAll, out);
    }
    out.sort(function (a, b) {
      var da = dnmExamDateToIso(a) || "";
      var db = dnmExamDateToIso(b) || "";
      return db.localeCompare(da);
    });
    return out;
  }

  function dnmSinavBadgeClass(tur) {
    var t = String(tur || "").toUpperCase();
    if (t === "TYT") return "dnm-badge-exam dnm-badge-exam--tyt";
    if (t === "AYT") return "dnm-badge-exam dnm-badge-exam--ayt";
    if (t === "YDT") return "dnm-badge-exam dnm-badge-exam--ydt";
    if (t === "LGS") return "dnm-badge-exam dnm-badge-exam--lgs";
    return "dnm-badge-exam dnm-badge-exam--muted";
  }

  function dnmStatusPillClass(st) {
    var s = String(st || "Bekliyor");
    if (s === "Uygulandı" || s === "Uygulandi") return "dnm-pill dnm-pill--done";
    return "dnm-pill dnm-pill--plan";
  }

  function dnmZorlukMiniClass(z) {
    var k = String(z || "orta").toLowerCase();
    if (k === "kolay") return "dnm-zmini dnm-zmini--kolay";
    if (k === "zor") return "dnm-zmini dnm-zmini--zor";
    return "dnm-zmini dnm-zmini--orta";
  }

  function dnmRenderTable() {
    var tbody = document.getElementById("dnmTableBody");
    var wrap = document.getElementById("dnmTableWrap");
    var block = document.getElementById("dnmTableBlock");
    var empty = document.getElementById("dnmEmptyState");
    if (!tbody || !wrap) return;
    tbody.innerHTML = "";
    if (!dnmPlansCache.length) {
      if (block) block.hidden = true;
      if (empty) empty.hidden = false;
      wrap.classList.add("dnm-table-wrap--empty");
      return;
    }
    if (block) block.hidden = false;
    if (empty) empty.hidden = true;
    wrap.classList.remove("dnm-table-wrap--empty");
    dnmPlansCache.forEach(function (row) {
      var tur = String(row.type || row.examType || row.tur || "TYT").toUpperCase();
      var st = row.planStatus || row.status || "Bekliyor";
      if (st === "Planlandı") st = "Bekliyor";
      var tr = document.createElement("tr");
      tr.className = "dnm-tr";
      tr.dataset.dnmId = row.id;
      tr.innerHTML =
        '<td class="dnm-td dnm-td--name"><span class="dnm-cell-title" title="' +
        escapeHtml(row.examName || "") +
        '">' +
        escapeHtml(row.examName || "—") +
        "</span></td>" +
        '<td class="dnm-td"><span class="' +
        dnmSinavBadgeClass(tur) +
        '">' +
        escapeHtml(tur) +
        "</span></td>" +
        '<td class="dnm-td dnm-td--muted">' +
        escapeHtml(dnmYayinLabel(row.publisher || row.yayin_evi)) +
        "</td>" +
        '<td class="dnm-td dnm-td--muted">' +
        escapeHtml(dnmFormatDate(dnmExamDateToIso(row))) +
        "</td>" +
        '<td class="dnm-td"><span class="' +
        dnmZorlukMiniClass(row.difficulty) +
        '">' +
        escapeHtml(dnmZorlukLabel(row.difficulty)) +
        "</span></td>" +
        '<td class="dnm-td"><span class="' +
        dnmStatusPillClass(st) +
        '"><span class="dnm-pill__dot" aria-hidden="true">●</span> ' +
        escapeHtml(st) +
        "</span></td>" +
        '<td class="dnm-td dnm-td--actions">' +
        '<button type="button" class="dnm-icon-btn dnm-icon-btn--edit" data-dnm-edit="' +
        escapeHtml(row.id) +
        '" title="Düzenle" aria-label="Düzenle"><i class="fa-solid fa-pen"></i></button>' +
        '<button type="button" class="dnm-icon-btn dnm-icon-btn--del" data-dnm-del="' +
        escapeHtml(row.id) +
        '" title="Sil" aria-label="Sil"><i class="fa-solid fa-trash"></i></button>' +
        "</td>";
      tbody.appendChild(tr);
    });
  }

  function dnmSetZorlukPills(val) {
    var hid = document.getElementById("dnmPlanZorluk");
    if (hid) hid.value = val || "orta";
    document.querySelectorAll("[data-dnm-zorluk]").forEach(function (b) {
      var on = b.getAttribute("data-dnm-zorluk") === val;
      b.classList.toggle("is-selected", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
  }

  function dnmGetModalEl() {
    return document.getElementById("denemePlanlaModal") || document.getElementById("dnmModal");
  }

  function dnmOpenModal(isEdit) {
    var m = dnmGetModalEl();
    var t = document.getElementById("dnmModalTitle");
    if (!m) return;
    if (t) t.textContent = isEdit ? "Denemeyi düzenle" : "Yeni Deneme Planla";
    m.hidden = false;
    m.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }

  function dnmCloseModal() {
    var m = dnmGetModalEl();
    if (!m) return;
    m.hidden = true;
    m.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
    var err = document.getElementById("dnmModalFetchErr");
    if (err) err.hidden = true;
  }

  function dnmResetPlanForm() {
    var eid = document.getElementById("dnmEditingDocId");
    if (eid) eid.value = "";
    var n = document.getElementById("dnmPlanName");
    if (n) n.value = "";
    var st = document.getElementById("dnmPlanSinavTuru");
    if (st) st.value = "";
    var y = document.getElementById("dnmPlanYayin");
    if (y) y.value = "";
    var d = document.getElementById("dnmPlanDate");
    if (d) d.value = new Date().toISOString().slice(0, 10);
    dnmSetZorlukPills("orta");
    dnmAiExamFile = null;
    dnmAiKeyFile = null;
    var le = document.getElementById("dnmAiExamFileLabel");
    var lk = document.getElementById("dnmAiKeyFileLabel");
    if (le) le.textContent = "";
    if (lk) lk.textContent = "";
    var fe = document.getElementById("dnmAiFileExam");
    var fk = document.getElementById("dnmAiFileKey");
    if (fe) fe.value = "";
    if (fk) fk.value = "";
    dnmClearMatrixUi();
    dnmToggleAiUploadSection();
    var ov = document.getElementById("dnmPdfAnalyzingOverlay");
    if (ov) ov.hidden = true;
    dnmMatrixBusy = false;
    var saveBtn = document.getElementById("btnDnmSave");
    if (saveBtn) saveBtn.disabled = false;
  }

  function dnmFillFormFromRow(row) {
    var eid = document.getElementById("dnmEditingDocId");
    if (eid) eid.value = row.id || "";
    var n = document.getElementById("dnmPlanName");
    if (n) n.value = row.examName || "";
    var st = document.getElementById("dnmPlanSinavTuru");
    if (st) st.value = String(row.type || row.examType || row.tur || "TYT").toUpperCase();
    var y = document.getElementById("dnmPlanYayin");
    if (y) y.value = row.publisher || "";
    var d = document.getElementById("dnmPlanDate");
    if (d) d.value = dnmExamDateToIso(row) || new Date().toISOString().slice(0, 10);
    dnmSetZorlukPills(row.difficulty || "orta");
    dnmAiExamFile = null;
    dnmAiKeyFile = null;
    var le = document.getElementById("dnmAiExamFileLabel");
    var lk = document.getElementById("dnmAiKeyFileLabel");
    if (le) le.textContent = "";
    if (lk) lk.textContent = "";
    var fe = document.getElementById("dnmAiFileExam");
    var fk = document.getElementById("dnmAiFileKey");
    if (fe) fe.value = "";
    if (fk) fk.value = "";
    dnmClearMatrixUi();
    dnmToggleAiUploadSection();
    var rawMx = row.answerKeyMatrix;
    if (!rawMx && row.answer_key_matrix) rawMx = row.answer_key_matrix;
    if (Array.isArray(rawMx) && rawMx.length && st) {
      var ek = dnmMufredatExamKey(st.value);
      var normalized = rawMx.map(function (x, idx) {
        return {
          questionNo: x.questionNo != null ? Number(x.questionNo) : idx + 1,
          ders: String(x.ders || x.subject || "").trim(),
          konu: String(x.konu || x.topic || "").trim(),
          answer: String(x.answer || x.correct || "A")
            .trim()
            .toUpperCase()
            .charAt(0),
        };
      });
      dnmRenderMatrixRows(normalized, ek);
      var det = document.getElementById("dnmDetailsAdvanced");
      if (det) det.open = true;
    }
    dnmToggleAiUploadSection();
  }

  async function dnmReloadList() {
    var load = document.getElementById("dnmLoading");
    var errEl = document.getElementById("dnmError");
    var cid = getCoachId();
    if (errEl) errEl.hidden = true;
    if (!cid) {
      dnmPlansCache = [];
      dnmRenderTable();
      if (errEl) {
        errEl.textContent =
          "Koç oturumu çözülemedi. Çıkış yapıp yeniden giriş yapın veya panelde kullanıcı adınızın kayıtlı olduğundan emin olun.";
        errEl.hidden = false;
      }
      return;
    }
    if (load) load.hidden = false;
    try {
      dnmPlansCache = await dnmFetchPlans(cid);
      dnmRenderTable();
    } catch (err) {
      console.error("[dnm]", err);
      if (errEl) {
        errEl.textContent = "Denemeler yüklenemedi. Bağlantı veya koleksiyon izinlerini kontrol edin.";
        errEl.hidden = false;
      }
    } finally {
      if (load) load.hidden = true;
    }
  }

  async function dnmSavePlan() {
    var cid = getCoachId();
    if (!cid) {
      alert("Oturum bulunamadı.");
      return;
    }
    var nameEl = document.getElementById("dnmPlanName");
    var turEl = document.getElementById("dnmPlanSinavTuru");
    var yayEl = document.getElementById("dnmPlanYayin");
    var dateEl = document.getElementById("dnmPlanDate");
    var zEl = document.getElementById("dnmPlanZorluk");
    var editEl = document.getElementById("dnmEditingDocId");
    var errBox = document.getElementById("dnmModalFetchErr");
    var examName = nameEl ? String(nameEl.value || "").trim() : "";
    var tur = turEl ? String(turEl.value || "").trim().toUpperCase() : "";
    var pub = yayEl ? String(yayEl.value || "").trim() : "";
    var dateStr = dateEl ? String(dateEl.value || "").trim() : "";
    var diff = zEl ? String(zEl.value || "orta").toLowerCase() : "orta";
    if (!examName || !tur || !pub || !dateStr) {
      if (errBox) {
        errBox.textContent = "Tüm zorunlu alanları doldurun.";
        errBox.hidden = false;
      }
      return;
    }
    if (errBox) errBox.hidden = true;
    if (dnmMatrixBusy) {
      if (errBox) {
        errBox.textContent = "PDF analizi devam ediyor; tamamlanana kadar bekleyin.";
        errBox.hidden = false;
      }
      return;
    }
    var examDateTs = Timestamp.fromDate(new Date(dateStr + "T12:00:00"));
    var editId = editEl ? String(editEl.value || "").trim() : "";
    var matrix = dnmCollectMatrixFromDom();
    var payload = {
      coach_id: cid,
      recordType: DNM_RECORD,
      isCoachExamPlan: true,
      examName: examName,
      type: tur,
      examType: tur,
      tur: tur,
      publisher: pub,
      yayin_evi: pub,
      date: dateStr,
      examDate: examDateTs,
      difficulty: diff,
      planStatus: "Bekliyor",
      status: "Bekliyor",
    };
    if (matrix.length) {
      payload.answerKeyMatrix = matrix;
      payload.answer_key_matrix = matrix;
    }
    payload.aiExtractionMeta = {
      simulated: true,
      examPdfFileName: dnmAiExamFile ? dnmAiExamFile.name : null,
      answerKeyFileName: dnmAiKeyFile ? dnmAiKeyFile.name : null,
      matrixRowCount: matrix.length,
      savedAtIso: new Date().toISOString(),
    };
    try {
      if (editId) {
        payload.updatedAt = serverTimestamp();
        var _dnmU = await updateDoc(doc(db, "exams", editId), payload);
        if (isAppwriteWriteSoftFailure(_dnmU)) {
          if (errBox) {
            errBox.textContent = "Güncelleme reddedildi (Appwrite izin veya exams şeması).";
            errBox.hidden = false;
          }
          return;
        }
      } else {
        payload.createdAt = serverTimestamp();
        var _dnmA = await addDoc(collection(db, "exams"), payload);
        if (isAppwriteWriteSoftFailure(_dnmA)) {
          if (errBox) {
            errBox.textContent = "Kayıt reddedildi (Appwrite izin veya exams şeması).";
            errBox.hidden = false;
          }
          return;
        }
      }
      dnmCloseModal();
      dnmResetPlanForm();
      await dnmReloadList();
      if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
        global.YKSPanel.toast(editId ? "Deneme güncellendi." : "Deneme planı kaydedildi.");
      }
    } catch (err) {
      console.error("[dnm save]", err);
      if (errBox) {
        errBox.textContent = (err && err.message) || String(err);
        errBox.hidden = false;
      }
    }
  }

  function dnmBindOnce() {
    if (dnmPlanBound) return;
    var root = document.getElementById("view-deneme-analiz-denemeler");
    var modalHost = dnmGetModalEl();
    if (!root && !modalHost) return;
    dnmPlanBound = true;

    function wireOpenDenemeModal(btn) {
      if (!btn || btn.dataset.dnmOpenBound) return;
      btn.dataset.dnmOpenBound = "1";
      btn.addEventListener("click", function () {
        dnmResetPlanForm();
        dnmOpenModal(false);
      });
    }
    wireOpenDenemeModal(document.getElementById("btnDnmNewExam"));
    wireOpenDenemeModal(document.getElementById("btnOpenDenemeModal"));
    dnmBindExcelImportUi();
    dnmBindAiMatrixUi();

    document.getElementById("btnDnmSave") &&
      document.getElementById("btnDnmSave").addEventListener("click", function () {
        void dnmSavePlan();
      });

    if (modalHost) {
      modalHost.querySelectorAll("[data-dnm-close]").forEach(function (el) {
        el.addEventListener("click", function () {
          dnmCloseModal();
        });
      });
    }

    document.querySelectorAll("[data-dnm-zorluk]").forEach(function (b) {
      b.addEventListener("click", function () {
        dnmSetZorlukPills(b.getAttribute("data-dnm-zorluk") || "orta");
      });
    });

    if (root) {
      root.addEventListener("click", function (ev) {
        var ed = ev.target.closest && ev.target.closest("[data-dnm-edit]");
        if (ed) {
          var id = ed.getAttribute("data-dnm-edit");
          var row = dnmPlansCache.find(function (r) {
            return r.id === id;
          });
          if (row) {
            dnmFillFormFromRow(row);
            dnmOpenModal(true);
          }
          return;
        }
        var del = ev.target.closest && ev.target.closest("[data-dnm-del]");
        if (del) {
          var did = del.getAttribute("data-dnm-del");
          if (!did || !confirm("Bu deneme planını silmek istediğinize emin misiniz?")) return;
          void (async function () {
            try {
              await deleteDoc(doc(db, "exams", did));
              await dnmReloadList();
              if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
                global.YKSPanel.toast("Silindi.");
              }
            } catch (e) {
              console.error(e);
              alert((e && e.message) || String(e));
            }
          })();
        }
      });
    }

    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var xim = dnmGetExcelImportModal();
      if (xim && !xim.hidden) {
        dnmCloseExcelImportModal();
        return;
      }
      var m = dnmGetModalEl();
      if (!m || m.hidden) return;
      dnmCloseModal();
    });
  }

  function initDenemePlanlamaPage() {
    dnmBindOnce();
    void dnmReloadList();
  }

  function registerDenemePlanlamaNav() {
    function hook() {
      if (!global.YKSPanel || typeof global.YKSPanel.onNavigate !== "function") return false;
      global.YKSPanel.onNavigate(function (view) {
        if (view === "deneme-analiz-denemeler" || view === "deneme-analiz-takvim") initDenemePlanlamaPage();
      });
      return true;
    }
    if (!hook()) {
      var n = 0;
      var t = setInterval(function () {
        if (hook() || ++n > 100) clearInterval(t);
      }, 50);
    }
  }

  registerDenemePlanlamaNav();

  global.initDenemePlanlamaPage = initDenemePlanlamaPage;

  global.initDenemeAnaliziPremium = initDenemeAnaliziPremium;
  global.destroyDenemeAnaliziPremium = destroyDenemeAnaliziPremium;
})(typeof window !== "undefined" ? window : globalThis);
