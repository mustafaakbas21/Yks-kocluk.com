/**
 * Deneme Analizi — Premium Karne (Appwrite: exams + ExamResults, mock yok)
 * Chart.js: radar + öğrenci vs kurum ortalaması (koçun tüm denemelerinden)
 */
import { collection, query, where, getDocs, db } from "./appwrite-compat.js";
import { APPWRITE_COLLECTION_EXAM_RESULTS } from "./appwrite-config.js";
import { YKS_TYT_BRANCHES, YKS_AYT_BY_ALAN, netFromDyWithRule } from "./yks-exam-structure.js";

(function (global) {
  "use strict";

  var chartRadar = null;
  var chartBar = null;

  function getCoachId() {
    try {
      var imp = sessionStorage.getItem("superAdminViewAsCoach");
      if (imp && String(imp).trim()) return String(imp).trim();
    } catch (e) {}
    return (localStorage.getItem("currentUser") || "").trim();
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
    if (!det || !det.rows) return null;
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
      if (!latest || !latest.yksBranchDetail || !latest.yksBranchDetail.rows) {
        mountEmpty(content, "Bu öğrenciye ait henüz deneme verisi bulunmamaktadır.");
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

  global.initDenemeAnaliziPremium = initDenemeAnaliziPremium;
  global.destroyDenemeAnaliziPremium = destroyDenemeAnaliziPremium;
})(typeof window !== "undefined" ? window : globalThis);
