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
import {
  APPWRITE_COLLECTION_EXAM_RESULTS,
  APPWRITE_COLLECTION_MR_EXAM_DEFICIENCIES,
  APPWRITE_BUCKET_DENEME_DEPOSU,
  storage,
} from "./appwrite-config.js";
import {
  analyzeStudentDeficiencies,
  aggregateTopicDeficiencies,
  extractStudentAnswersFromExamDetail,
  buildMrDeficiencyWritePayloads,
} from "./deneme-mr-motor.js";
import { ID } from "./appwrite-browser.js?v=20260408-inst";
import {
  YKS_TYT_BRANCHES,
  YKS_AYT_BY_ALAN,
  netFromDyWithRule,
  yks2026DersKeys,
  yks2026KonuOptionsForDers,
} from "./yks-mufredat.js";
import { extractTextFromPDF, analyzeExamWithAI } from "./deneme-ai-pdf-matrix.js";

(function (global) {
  "use strict";

  var chartRadar = null;
  var chartBar = null;
  var karneModalChart = null;
  /** @type {Array<Record<string, unknown>>} */
  var karneKurumCache = [];
  var karneUiBound = false;
  var KARNE_DEMO_TREND = [34.75, 30, 31, 47.5, 48.75, 53.5];

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
        sube: String(x.sube || x.subclass || x.branch || x.sinif || "").trim() || "—",
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

  function destroyKarneModalChart() {
    try {
      if (karneModalChart && typeof karneModalChart.destroy === "function") karneModalChart.destroy();
    } catch (e) {}
    karneModalChart = null;
  }

  function dybFromRowKey(det, key) {
    var rows = det && det.rows;
    if (!rows || !rows[key]) return { d: 0, y: 0, b: 0, soru: 0 };
    var r = rows[key];
    var cl = clampDy(r.soru, r.d, r.y);
    var b = Math.max(0, r.soru - cl.d - cl.y);
    return { d: cl.d, y: cl.y, b: b, soru: r.soru };
  }

  function formatDyb(dyb) {
    return dyb.d + "/" + dyb.y + "/" + dyb.b;
  }

  function tytTotalNetFromDet(det) {
    if (!det || !det.rows) return 0;
    if (det.computed && typeof det.computed.totalNet === "number") return det.computed.totalNet;
    var sum = 0;
    Object.keys(det.rows).forEach(function (k) {
      sum += branchNetFromRow(det.rows[k]);
    });
    return sum;
  }

  function lastSixTytNetsFromDocs(docs) {
    var tyt = (docs || []).filter(function (e) {
      var tur = String(e.examType || "").toUpperCase();
      return tur === "TYT" && e.yksBranchDetail && e.yksBranchDetail.rows && typeof e.yksBranchDetail.rows === "object";
    });
    tyt.sort(function (a, b) {
      return String(a.date || "").localeCompare(String(b.date || ""));
    });
    var last = tyt.slice(-6);
    return last.map(function (e) {
      var det = e.yksBranchDetail;
      return tytTotalNetFromDet(det);
    });
  }

  function chartTrendValuesFromDocs(docs) {
    var nets = lastSixTytNetsFromDocs(docs);
    if (nets.length >= 6) return nets.slice(-6);
    return KARNE_DEMO_TREND.slice();
  }

  function pickLatestAytAny(docs) {
    var modes = ["sayisal", "esit_agirlik", "sozel", "dil"];
    for (var i = 0; i < modes.length; i++) {
      var p = pickLatestForMode(docs, "AYT", modes[i]);
      if (p) return p;
    }
    return null;
  }

  function renderKarnePdfBranchRows(branches) {
    if (!branches || !branches.length) {
      return '<tr><td colspan="6" class="px-3 py-4 text-center text-slate-400 text-sm">Kayıt yok</td></tr>';
    }
    return branches
      .map(function (row) {
        return (
          "<tr class=\"hover:bg-slate-50/90\">" +
          '<td class="px-3 py-2 font-medium text-slate-800">' +
          escapeHtml(row.ders) +
          "</td>" +
          '<td class="text-center px-2 py-2">' +
          row.soru +
          "</td>" +
          '<td class="text-center px-2 py-2 text-emerald-700 font-semibold">' +
          row.d +
          "</td>" +
          '<td class="text-center px-2 py-2 text-red-600 font-semibold">' +
          row.y +
          "</td>" +
          '<td class="text-center px-2 py-2 text-slate-500">' +
          row.b +
          "</td>" +
          '<td class="text-center px-2 py-2 font-bold text-violet-700">' +
          formatNum(row.net) +
          "</td></tr>"
        );
      })
      .join("");
  }

  function renderKarneTopicMatrixRows(branches) {
    if (!branches || !branches.length) {
      return '<tr><td colspan="3" class="px-3 py-4 text-center text-slate-400 text-sm">Konu / branş verisi yok</td></tr>';
    }
    return branches
      .map(function (row) {
        var clean = row.y === 0 && row.b === 0;
        var icon = clean
          ? '<span class="text-emerald-600 text-lg font-bold" aria-label="Başarılı">✓</span>'
          : '<span class="text-red-500 text-lg font-bold" aria-label="Eksik">✗</span>';
        var correctSummary = row.soru ? row.d + " / " + row.soru + " doğru" : "—";
        var perf = row.d + "D · " + row.y + "Y · " + row.b + "B";
        return (
          "<tr class=\"hover:bg-slate-50/80\">" +
          '<td class="px-3 py-2 font-medium text-slate-800">' +
          escapeHtml(row.ders) +
          "</td>" +
          '<td class="px-2 py-2 text-center text-slate-600">' +
          escapeHtml(correctSummary) +
          "</td>" +
          '<td class="px-2 py-2 text-center whitespace-nowrap">' +
          icon +
          ' <span class="text-slate-600 text-xs ml-1">' +
          escapeHtml(perf) +
          "</span></td></tr>"
        );
      })
      .join("");
  }

  function renderKarnePdfBarChart(values) {
    var canvas = document.getElementById("karnePdfChartCanvas");
    if (!canvas || typeof Chart === "undefined") return;
    destroyKarneModalChart();
    var labels = [];
    for (var i = 0; i < values.length; i++) labels.push("Sınav " + (i + 1));
    karneModalChart = new Chart(canvas, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Net (TYT)",
            data: values,
            backgroundColor: "rgba(99, 102, 241, 0.78)",
            borderColor: "rgba(67, 56, 202, 1)",
            borderWidth: 1,
            borderRadius: 8,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: "rgba(15, 23, 42, 0.92)",
            titleColor: "#f8fafc",
            bodyColor: "#e2e8f0",
            padding: 10,
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: { color: "#64748b" },
            grid: { color: "rgba(148, 163, 184, 0.2)" },
          },
          x: {
            ticks: { color: "#64748b", maxRotation: 0 },
            grid: { display: false },
          },
        },
      },
    });
  }

  function closeKarneModal() {
    var m = document.getElementById("karne-modal");
    if (!m) return;
    m.classList.add("hidden");
    m.setAttribute("aria-hidden", "true");
    var twRoot = document.getElementById("karne-modal-tailwind-root");
    if (twRoot) twRoot.setAttribute("aria-hidden", "true");
    destroyKarneModalChart();
    try {
      document.body.style.overflow = "";
    } catch (e2) {}
  }

  function openKarneModal(idx) {
    var payload = karneKurumCache[idx];
    if (!payload) return;
    var m = document.getElementById("karne-modal");
    if (!m) return;
    var titleEl = document.getElementById("karne-modal-title");
    var examNameEl = document.querySelector("[data-karne-exam-name]");
    var dateEl = document.querySelector("[data-karne-exam-date]");
    if (titleEl) titleEl.textContent = String(payload.studentName || "—");
    var tyt = payload.latestTyt;
    var exName = tyt && tyt.examName ? String(tyt.examName) : "Son deneme";
    var exDate = tyt && tyt.date ? String(tyt.date) : "—";
    if (examNameEl) examNameEl.textContent = exName;
    if (dateEl) dateEl.textContent = exDate ? "Tarih: " + exDate : "—";

    var puanEl = document.querySelector("[data-karne-pdf-puan]");
    var tytNetEl = document.querySelector("[data-karne-pdf-tytnet]");
    var aytNetEl = document.querySelector("[data-karne-pdf-aynet]");
    var kurumEl = document.querySelector("[data-karne-pdf-kurumsira]");
    var genelEl = document.querySelector("[data-karne-pdf-genelsira]");
    var total = karneKurumCache.length || 1;
    if (puanEl) puanEl.textContent = formatNum(payload.puan);
    if (tytNetEl) tytNetEl.textContent = formatNum(payload.tytNet);
    if (aytNetEl) aytNetEl.textContent = formatNum(payload.aytNet);
    if (kurumEl) kurumEl.textContent = payload.rank + " / " + total;
    if (genelEl) genelEl.textContent = "Kurum içi · " + payload.rank + " / " + total;

    var branchesTyt = [];
    var branchesAyt = [];
    if (tyt && tyt.yksBranchDetail) {
      var vmT = buildViewModelFromExam(tyt, "TYT", "sayisal");
      if (vmT && vmT.branches) branchesTyt = vmT.branches;
    }
    var ayt = payload.latestAyt;
    var secAyt = document.querySelector("[data-karne-section-ayt]");
    var bodyAyt = document.getElementById("karnePdfAytBody");
    if (ayt && ayt.yksBranchDetail) {
      var alan = normalizeAytAlanKey(ayt.yksBranchDetail.aytAlan || "sayisal");
      var vmA = buildViewModelFromExam(ayt, "AYT", alan);
      if (vmA && vmA.branches) branchesAyt = vmA.branches;
    }
    if (secAyt) secAyt.hidden = !branchesAyt.length;
    var bodyTyt = document.getElementById("karnePdfTytBody");
    if (bodyTyt) bodyTyt.innerHTML = renderKarnePdfBranchRows(branchesTyt);
    if (bodyAyt) bodyAyt.innerHTML = renderKarnePdfBranchRows(branchesAyt);

    var topicBody = document.getElementById("karnePdfTopicBody");
    var allBranches = branchesTyt.concat(branchesAyt);
    if (topicBody) topicBody.innerHTML = renderKarneTopicMatrixRows(allBranches);

    m.classList.remove("hidden");
    m.setAttribute("aria-hidden", "false");
    var twRootOpen = document.getElementById("karne-modal-tailwind-root");
    if (twRootOpen) twRootOpen.setAttribute("aria-hidden", "false");
    try {
      document.body.style.overflow = "hidden";
    } catch (e3) {}

    var vals = payload.chartValues && payload.chartValues.length ? payload.chartValues : KARNE_DEMO_TREND.slice();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        renderKarnePdfBarChart(vals);
      });
    });
  }

  function downloadKarnePdf() {
    var el = document.getElementById("pdf-content");
    var h2p = typeof html2pdf !== "undefined" ? html2pdf : global.html2pdf;
    if (!el || !h2p) {
      if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
        global.YKSPanel.toast("PDF kütüphanesi yüklenemedi. Sayfayı yenileyin.", { variant: "error" });
      } else {
        alert("PDF kütüphanesi yüklenemedi.");
      }
      return;
    }
    var nameEl = document.getElementById("karne-modal-title");
    var raw = nameEl ? String(nameEl.textContent || "").trim() : "Ogrenci";
    var fname = raw.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, "_") || "Ogrenci";
    var opt = {
      margin: [10, 10, 10, 10],
      filename: fname + "_Karne.pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true, logging: false, letterRendering: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
      pagebreak: { mode: ["avoid-all", "css", "legacy"] },
    };
    try {
      var chain = h2p().set(opt).from(el);
      var out = chain.save && chain.save();
      if (out && typeof out.catch === "function") {
        out.catch(function (err) {
          console.error("[karne-pdf]", err);
          if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
            global.YKSPanel.toast("PDF oluşturulamadı.", { variant: "error" });
          }
        });
      }
    } catch (err) {
      console.error("[karne-pdf]", err);
      if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
        global.YKSPanel.toast("PDF oluşturulamadı.", { variant: "error" });
      }
    }
  }

  function bindKarneSonuclarUiOnce() {
    if (karneUiBound) return;
    karneUiBound = true;
    document.addEventListener("click", function (ev) {
      var t = ev.target;
      if (!t || !t.closest) return;
      if (t.closest("[data-karne-close]")) {
        closeKarneModal();
        return;
      }
      var btn = t.closest("[data-karne-open]");
      if (btn) {
        var idx = parseInt(String(btn.getAttribute("data-karne-open") || ""), 10);
        if (!isNaN(idx)) openKarneModal(idx);
      }
    });
    var pdfBtn = document.getElementById("karne-btn-pdf-download");
    if (pdfBtn) {
      pdfBtn.addEventListener("click", function () {
        downloadKarnePdf();
      });
    }
    var refBtn = document.getElementById("karneKurumRefreshBtn");
    if (refBtn) {
      refBtn.addEventListener("click", function () {
        void refreshKarneSonuclariTable();
      });
    }
    document.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      var m = document.getElementById("karne-modal");
      if (m && !m.classList.contains("hidden")) closeKarneModal();
    });
  }

  async function refreshKarneSonuclariTable() {
    var tbody = document.getElementById("karneKurumTableBody");
    if (!tbody) return;
    bindKarneSonuclarUiOnce();
    var ph = document.getElementById("karneKurumTablePlaceholder");
    var cid = getCoachId();
    if (!cid) {
      tbody.innerHTML =
        '<tr><td colspan="9" class="px-4 py-10 text-center text-slate-500 text-sm">Oturum bulunamadı.</td></tr>';
      karneKurumCache = [];
      return;
    }
    tbody.innerHTML =
      '<tr><td colspan="9" class="px-4 py-10 text-center text-slate-500 text-sm"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Yükleniyor…</td></tr>';
    try {
      var students = await fetchStudentsForCoach(cid);
      karneKurumCache = [];
      var rows = [];
      for (var i = 0; i < students.length; i++) {
        var st = students[i];
        var docs = await fetchExamDocuments(st.id, cid);
        var tyt = pickLatestForMode(docs, "TYT", null);
        var ayt = pickLatestAytAny(docs);
        var tytDet = tyt && tyt.yksBranchDetail ? tyt.yksBranchDetail : null;
        var aytDet = ayt && ayt.yksBranchDetail ? ayt.yksBranchDetail : null;
        var turk = tytDet ? dybFromRowKey(tytDet, "turkce") : { d: 0, y: 0, b: 0, soru: 0 };
        var mat = tytDet ? dybFromRowKey(tytDet, "matematik") : { d: 0, y: 0, b: 0, soru: 0 };
        var tytNet = tytDet ? tytTotalNetFromDet(tytDet) : 0;
        var aytNet = 0;
        if (aytDet) {
          aytNet =
            aytDet.computed && typeof aytDet.computed.totalNet === "number"
              ? aytDet.computed.totalNet
              : tytTotalNetFromDet(aytDet);
        }
        var puan = Math.round((tytNet + aytNet) * 100) / 100;
        rows.push({
          studentId: st.id,
          studentName: st.name,
          sube: st.sube || "—",
          tytTurkceDyn: formatDyb(turk),
          tytMatDyn: formatDyb(mat),
          tytNet: tytNet,
          aytNet: aytNet,
          puan: puan,
          rank: 0,
          latestTyt: tyt,
          latestAyt: ayt,
          chartValues: chartTrendValuesFromDocs(docs),
        });
      }
      rows.sort(function (a, b) {
        if (b.puan !== a.puan) return b.puan - a.puan;
        return String(a.studentName).localeCompare(String(b.studentName), "tr");
      });
      for (var r = 0; r < rows.length; r++) {
        rows[r].rank = r + 1;
      }
      karneKurumCache = rows;
      if (!rows.length) {
        tbody.innerHTML =
          '<tr><td colspan="9" class="px-4 py-10 text-center text-slate-500 text-sm">Henüz öğrenci veya deneme kaydı yok.</td></tr>';
        return;
      }
      tbody.innerHTML = rows
        .map(function (row, idx) {
          return (
            "<tr class=\"hover:bg-violet-50/40 transition-colors\">" +
            '<td class="px-4 py-3 font-semibold text-slate-800">' +
            escapeHtml(row.studentName) +
            "</td>" +
            '<td class="px-3 py-3 text-slate-600">' +
            escapeHtml(String(row.sube)) +
            "</td>" +
            '<td class="px-3 py-3 text-center font-mono text-xs sm:text-sm text-slate-700">' +
            escapeHtml(row.tytTurkceDyn) +
            "</td>" +
            '<td class="px-3 py-3 text-center font-mono text-xs sm:text-sm text-slate-700">' +
            escapeHtml(row.tytMatDyn) +
            "</td>" +
            '<td class="px-3 py-3 text-center font-bold text-violet-700">' +
            formatNum(row.tytNet) +
            "</td>" +
            '<td class="px-3 py-3 text-center font-bold text-indigo-700">' +
            formatNum(row.aytNet) +
            "</td>" +
            '<td class="px-3 py-3 text-center font-extrabold text-slate-900">' +
            formatNum(row.puan) +
            "</td>" +
            '<td class="px-3 py-3 text-center"><span class="inline-flex min-w-[2.25rem] justify-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-bold text-slate-700">' +
            row.rank +
            "</span></td>" +
            '<td class="px-4 py-3 text-right">' +
            '<button type="button" class="inline-flex items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-xs sm:text-sm font-bold px-3 py-2 shadow-sm shadow-blue-600/20 transition-colors" data-karne-open="' +
            idx +
            '">Karneyi görüntüle</button>' +
            "</td></tr>"
          );
        })
        .join("");
      if (ph) ph.remove();
    } catch (err) {
      console.error("[karne-sonuclar]", err);
      tbody.innerHTML =
        '<tr><td colspan="9" class="px-4 py-10 text-center text-red-600 text-sm">Liste yüklenemedi. Bağlantıyı kontrol edin.</td></tr>';
      karneKurumCache = [];
    }
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
    bindKarneSonuclarUiOnce();
    void refreshKarneSonuclariTable();
    if (!root) return;
    renderToolbar(root);
    void populateStudentSelect(root).then(function () {
      bindToolbar(root);
    });
  }

  function destroyDenemeAnaliziPremium() {
    destroyCharts();
    destroyKarneModalChart();
    closeKarneModal();
  }

  /* ——— Denemeler: koç planlama (exams + recordType coach_exam_plan) ——— */
  var DNM_RECORD = "coach_exam_plan";
  var dnmPlanBound = false;
  var dnmPlansCache = [];
  var dnmAiExamFile = null;
  var dnmAiKeyFile = null;
  var dnmMatrixBusy = false;

  var DNM_PDF_OVERLAY_DEFAULT_TITLE = "PDF'ler analiz ediliyor…";
  var DNM_PDF_OVERLAY_DEFAULT_SUB = "Kazanımlar çıkarılıyor; satırlar birazdan listelenecek.";

  function dnmResetPdfAnalyzingOverlayCopy() {
    var t = document.getElementById("dnmPdfAnalyzingTitle");
    var s = document.getElementById("dnmPdfAnalyzingSub");
    if (t) t.textContent = DNM_PDF_OVERLAY_DEFAULT_TITLE;
    if (s) s.textContent = DNM_PDF_OVERLAY_DEFAULT_SUB;
  }

  function dnmSetPdfAnalyzingOverlayCopy(title, sub) {
    var t = document.getElementById("dnmPdfAnalyzingTitle");
    var s = document.getElementById("dnmPdfAnalyzingSub");
    if (t) t.textContent = title || DNM_PDF_OVERLAY_DEFAULT_TITLE;
    if (s) s.textContent = sub || DNM_PDF_OVERLAY_DEFAULT_SUB;
  }

  function dnmRefreshAiPdfMatrixButton() {
    var btn = document.getElementById("btnDnmAiPdfMatrix");
    if (!btn) return;
    dnmSyncPdfFilesFromInputs();
    var f = dnmAiExamFile;
    var ok = false;
    if (f && f.size) {
      var mime = String(f.type || "").toLowerCase();
      var name = String(f.name || "").toLowerCase();
      ok = mime.indexOf("pdf") !== -1 || name.endsWith(".pdf");
    }
    btn.disabled = !ok;
    if (ok) btn.removeAttribute("title");
    else btn.setAttribute("title", "Önce geçerli bir kitapçık PDF dosyası seçin");
  }

  async function dnmRunAiPdfMatrixExtract() {
    if (dnmMatrixBusy) return;
    dnmSyncPdfFilesFromInputs();
    var file = dnmAiExamFile;
    if (!file || !file.size) {
      alert("Önce deneme kitapçığı için bir PDF seçin.");
      return;
    }
    var mime = String(file.type || "").toLowerCase();
    var name = String(file.name || "").toLowerCase();
    if (mime.indexOf("pdf") === -1 && !name.endsWith(".pdf")) {
      alert("Sadece PDF kitapçığı bu işlem için kullanılabilir.");
      return;
    }
    var turEl = document.getElementById("dnmPlanSinavTuru");
    if (!turEl || !String(turEl.value || "").trim()) {
      alert("Önce sınav türü seçin.");
      return;
    }
    var tb = document.getElementById("dnmMatrixBody");
    if (tb && tb.querySelectorAll("tr.js-dnm-mx-dynamic-row").length) {
      if (!window.confirm("Mevcut soru–konu matrisi satırları AI çıktısı ile değiştirilsin mi?")) return;
    }
    var examKey = dnmMufredatExamKey(turEl.value);
    var nEl = document.getElementById("dnmQCount");
    var hint = parseInt(String(nEl && nEl.value ? nEl.value : ""), 10);
    if (isNaN(hint) || hint < 1) hint = 0;

    dnmMatrixBusy = true;
    var ov = document.getElementById("dnmPdfAnalyzingOverlay");
    var saveBtn = document.getElementById("btnDnmSave");
    var aiBtn = document.getElementById("btnDnmAiPdfMatrix");
    dnmSetPdfAnalyzingOverlayCopy(
      "Yapay Zeka denemeyi analiz ediyor…",
      "PDF metni okunuyor ve soru–konu eşlemesi üretiliyor; lütfen bekleyin."
    );
    if (ov) ov.hidden = false;
    if (saveBtn) saveBtn.disabled = true;
    if (aiBtn) aiBtn.disabled = true;

    try {
      var pdfText = await extractTextFromPDF(file);
      var result = await analyzeExamWithAI(pdfText, {
        examType: String(turEl.value || "").trim(),
        questionCountHint: hint > 0 ? hint : undefined,
      });
      var rows = result && result.rows ? result.rows : [];
      if (!rows.length) {
        throw new Error("AI yanıtında matris satırı yok.");
      }
      dnmRenderMatrixRows(rows, examKey);
      var det = document.getElementById("dnmDetailsAdvanced");
      if (det) det.open = true;
      if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
        global.YKSPanel.toast("Matris AI ile dolduruldu. Satırları mutlaka doğrulayın.");
      } else {
        alert("Matris AI ile dolduruldu. Satırları mutlaka doğrulayın.");
      }
    } catch (e) {
      console.error("[dnm-ai-pdf]", e);
      var errMsg =
        e && e.message
          ? String(e.message)
          : "AI şu an yoğun, lütfen sonra tekrar deneyin veya manuel doldurun";
      if (
        errMsg.indexOf("Failed to fetch") !== -1 ||
        errMsg.indexOf("NetworkError") !== -1 ||
        errMsg.indexOf("Load failed") !== -1
      ) {
        errMsg = "AI şu an yoğun, lütfen sonra tekrar deneyin veya manuel doldurun";
      }
      if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
        global.YKSPanel.toast(errMsg, { variant: "error" });
      } else {
        alert(errMsg);
      }
    } finally {
      dnmMatrixBusy = false;
      dnmResetPdfAnalyzingOverlayCopy();
      if (ov) ov.hidden = true;
      if (saveBtn) saveBtn.disabled = false;
      dnmRefreshAiPdfMatrixButton();
    }
  }
  var dnmXimFile = null;
  var dnmXimUiBound = false;
  /** @type {Record<string, string> | null} */
  var dnmStudentsCache = null;
  var dnmAccordionUiBound = false;
  /** ÖSYM YKS kitapçık türü onay kutuları (A–E) — `dnmBooklet*` id’leri ile eşleşir */
  var DNM_KITAPCIK_TUR_LETTERS = ["A", "B", "C", "D", "E"];
  /** Geçerli doğru şık harfi (YKS beş şıklı) */
  function dnmNormalizeAnswerKeyLetter(ch) {
    var c = String(ch != null ? ch : "A").trim().toUpperCase().charAt(0);
    return "ABCDE".indexOf(c) !== -1 ? c : "A";
  }

  function dnmMufredatExamKey(tur) {
    var t = String(tur || "TYT").toUpperCase();
    if (t === "LGS") return "TYT";
    var keys = yks2026DersKeys(t);
    if (keys && keys.length) return t;
    return "TYT";
  }

  function dnmToggleAiUploadSection() {
    /* PDF alanları her zaman görünür; eski davranış kaldırıldı */
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
    var letters = "ABCDE".split("");
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

  function dnmAppendMatrixRowDynamic(examKey, r) {
    r = r || {};
    var tbody = document.getElementById("dnmMatrixBody");
    var tbl = document.getElementById("dnmMatrixTable");
    if (!tbody || !tbl) return;
    var qno = r.questionNo != null ? Number(r.questionNo) : 1;
    if (isNaN(qno) || qno < 1) qno = 1;
    if (qno > 40) qno = 40;
    var tr = document.createElement("tr");
    tr.className = "js-dnm-mx-dynamic-row";
    tr.setAttribute("data-dnm-q", String(qno));
    var dersList = yks2026DersKeys(examKey);
    if (!dersList || !dersList.length) dersList = ["TYT Türkçe"];
    var selD = document.createElement("select");
    selD.className = "dnm-matrix-select js-dnm-mx-ders";
    selD.setAttribute("aria-label", "Ders");
    dersList.forEach(function (dk) {
      var o = document.createElement("option");
      o.value = dk;
      o.textContent = dk;
      if (String(r.ders || "").trim() === dk) o.selected = true;
      selD.appendChild(o);
    });
    var tdD = document.createElement("td");
    tdD.appendChild(selD);
    var tdQ = document.createElement("td");
    tdQ.className = "dnm-col-n";
    var selQ = document.createElement("select");
    selQ.className = "dnm-matrix-select js-dnm-mx-qno";
    selQ.setAttribute("aria-label", "Soru numarası");
    for (var qi = 1; qi <= 40; qi++) {
      var oq = document.createElement("option");
      oq.value = String(qi);
      oq.textContent = String(qi);
      if (qi === qno) oq.selected = true;
      selQ.appendChild(oq);
    }
    tdQ.appendChild(selQ);
    var selK = document.createElement("select");
    selK.className = "dnm-matrix-select js-dnm-mx-konu";
    selK.setAttribute("aria-label", "Konu");
    var tdK = document.createElement("td");
    tdK.appendChild(selK);
    var tdA = document.createElement("td");
    tdA.className = "dnm-col-ans";
    var selA = document.createElement("select");
    selA.className = "dnm-matrix-select js-dnm-mx-ans";
    var ansPick = dnmNormalizeAnswerKeyLetter(r.answer);
    "ABCDE".split("").forEach(function (L) {
      var o = document.createElement("option");
      o.value = L;
      o.textContent = L;
      if (L === ansPick) o.selected = true;
      selA.appendChild(o);
    });
    tdA.appendChild(selA);
    var tdRm = document.createElement("td");
    tdRm.className = "dnm-col-rm";
    var btnRm = document.createElement("button");
    btnRm.type = "button";
    btnRm.className = "dnm-icon-btn";
    btnRm.setAttribute("aria-label", "Satırı sil");
    btnRm.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    btnRm.addEventListener("click", function (e) {
      e.stopPropagation();
      tr.remove();
      var tb = document.getElementById("dnmMatrixBody");
      var tbx = document.getElementById("dnmMatrixTable");
      if (tb && (!tb.children || tb.children.length === 0) && tbx) tbx.hidden = true;
    });
    tdRm.appendChild(btnRm);
    tr.appendChild(tdD);
    tr.appendChild(tdQ);
    tr.appendChild(tdK);
    tr.appendChild(tdA);
    tr.appendChild(tdRm);
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
    function syncQAttr() {
      var v = parseInt(String(selQ.value || "1"), 10);
      if (!isNaN(v)) tr.setAttribute("data-dnm-q", String(v));
    }
    refillKonu();
    selD.addEventListener("change", refillKonu);
    selQ.addEventListener("change", syncQAttr);
    tbody.appendChild(tr);
    tbl.hidden = false;
  }

  function dnmRenderMatrixRows(rows, examKey) {
    dnmClearMatrixUi();
    if (!rows || !rows.length) return;
    rows.forEach(function (r) {
      dnmAppendMatrixRowDynamic(examKey, r);
    });
  }

  function dnmCollectMatrixFromDom() {
    var tbody = document.getElementById("dnmMatrixBody");
    var tbl = document.getElementById("dnmMatrixTable");
    if (!tbody || !tbl || tbl.hidden) return [];
    var out = [];
    tbody.querySelectorAll("tr.js-dnm-mx-dynamic-row").forEach(function (tr) {
      var d = tr.querySelector(".js-dnm-mx-ders");
      var qn = tr.querySelector(".js-dnm-mx-qno");
      var k = tr.querySelector(".js-dnm-mx-konu");
      var a = tr.querySelector(".js-dnm-mx-ans");
      if (!d || !qn || !k || !a) return;
      var q = parseInt(String(qn.value || tr.getAttribute("data-dnm-q") || "0"), 10);
      if (isNaN(q)) return;
      out.push({
        questionNo: q,
        ders: String(d.value || "").trim(),
        konu: String(k.value || "").trim(),
        answer: dnmNormalizeAnswerKeyLetter(a.value),
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

  function dnmGetExamKeyFromForm() {
    var turEl = document.getElementById("dnmPlanSinavTuru");
    if (!turEl || !String(turEl.value || "").trim()) return null;
    return dnmMufredatExamKey(turEl.value);
  }

  function dnmAddMatrixRowClick() {
    var ek = dnmGetExamKeyFromForm();
    if (!ek) {
      alert("Önce sınav türü seçin.");
      return;
    }
    var nextQ = 1;
    var tb = document.getElementById("dnmMatrixBody");
    if (tb && tb.querySelectorAll("tr.js-dnm-mx-dynamic-row").length) {
      var maxQ = 0;
      tb.querySelectorAll(".js-dnm-mx-qno").forEach(function (sel) {
        var v = parseInt(String(sel.value || "0"), 10);
        if (!isNaN(v) && v > maxQ) maxQ = v;
      });
      nextQ = Math.min(40, maxQ + 1);
    }
    dnmAppendMatrixRowDynamic(ek, { questionNo: nextQ, answer: "A" });
  }

  function dnmInitMatrixClick() {
    var ek = dnmGetExamKeyFromForm();
    if (!ek) {
      alert("Önce sınav türü seçin.");
      return;
    }
    var tb = document.getElementById("dnmMatrixBody");
    if (tb && tb.children && tb.children.length) {
      if (!window.confirm("Mevcut matris satırları silinsin mi?")) return;
    }
    dnmClearMatrixUi();
    dnmAppendMatrixRowDynamic(ek, { questionNo: 1, answer: "A" });
  }

  function dnmBuildMatrixBulk() {
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
      rows.push({ questionNo: Math.min(40, i), ders: firstD, konu: firstK, answer: "A" });
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

  function dnmSyncPdfFilesFromInputs() {
    var fb = document.getElementById("dnmFileBookletPdf");
    var fk = document.getElementById("dnmFileAnswerKeyPdf");
    var lb = document.getElementById("dnmFileBookletPdfLabel");
    var lk = document.getElementById("dnmFileAnswerKeyPdfLabel");
    var la = document.getElementById("dnmAiExamFileLabel");
    var lka = document.getElementById("dnmAiKeyFileLabel");
    if (fb && fb.files && fb.files[0]) {
      dnmAiExamFile = fb.files[0];
      if (lb) lb.textContent = dnmAiExamFile.name;
      if (la) la.textContent = dnmAiExamFile.name;
    }
    if (fk && fk.files && fk.files[0]) {
      dnmAiKeyFile = fk.files[0];
      if (lk) lk.textContent = dnmAiKeyFile.name;
      if (lka) lka.textContent = dnmAiKeyFile.name;
    }
  }

  function dnmCollectBookletTypes() {
    var out = [];
    DNM_KITAPCIK_TUR_LETTERS.forEach(function (L) {
      var el = document.getElementById("dnmBooklet" + L);
      if (el && el.checked) out.push(L);
    });
    return out;
  }

  function dnmSetBookletTypesFromRow(row) {
    var raw = row.bookletTypesJson || row.bookletVariants || "";
    var arr = [];
    try {
      if (raw && String(raw).charAt(0) === "[") arr = JSON.parse(raw);
      else if (raw) arr = String(raw).split(/[,\s]+/).filter(Boolean);
    } catch (e) {
      arr = [];
    }
    DNM_KITAPCIK_TUR_LETTERS.forEach(function (L) {
      var el = document.getElementById("dnmBooklet" + L);
      if (el) el.checked = arr.indexOf(L) !== -1;
    });
  }

  async function dnmMaybeUploadExamPdfs() {
    var ids = { bookletId: "", answerKeyId: "" };
    try {
      if (dnmAiExamFile && dnmAiExamFile.size) {
        var mime = String(dnmAiExamFile.type || "").toLowerCase();
        var name = String(dnmAiExamFile.name || "").toLowerCase();
        if (mime.indexOf("pdf") !== -1 || name.endsWith(".pdf")) {
          var fid = ID.unique();
          await storage.createFile({
            bucketId: APPWRITE_BUCKET_DENEME_DEPOSU,
            fileId: fid,
            file: dnmAiExamFile,
          });
          ids.bookletId = fid;
        }
      }
      if (dnmAiKeyFile && dnmAiKeyFile.size) {
        var mime2 = String(dnmAiKeyFile.type || "").toLowerCase();
        var name2 = String(dnmAiKeyFile.name || "").toLowerCase();
        if (mime2.indexOf("pdf") !== -1 || name2.endsWith(".pdf")) {
          var fid2 = ID.unique();
          await storage.createFile({
            bucketId: APPWRITE_BUCKET_DENEME_DEPOSU,
            fileId: fid2,
            file: dnmAiKeyFile,
          });
          ids.answerKeyId = fid2;
        }
      }
    } catch (e) {
      console.warn("[dnm] Storage:", e);
      if (global.YKSPanel && typeof global.YKSPanel.toast === "function") {
        global.YKSPanel.toast(
          "PDF dosyaları depoya yüklenemedi (izin veya ağ). Kayıt metadatası yine de saklanır.",
          { variant: "warning" }
        );
      }
    }
    return ids;
  }

  function dnmBindAiMatrixUi() {
    dnmWireFileDrop("dnmAiDropExam", "dnmFileBookletPdf", "dnmFileBookletPdfLabel", function (f) {
      dnmAiExamFile = f;
      var la = document.getElementById("dnmAiExamFileLabel");
      if (la) la.textContent = f ? f.name : "";
      dnmTryRunDualPdfAnalysis();
      dnmRefreshAiPdfMatrixButton();
    });
    dnmWireFileDrop("dnmAiDropKey", "dnmFileAnswerKeyPdf", "dnmFileAnswerKeyPdfLabel", function (f) {
      dnmAiKeyFile = f;
      var lka = document.getElementById("dnmAiKeyFileLabel");
      if (lka) lka.textContent = f ? f.name : "";
      dnmTryRunDualPdfAnalysis();
    });
    var fb = document.getElementById("dnmFileBookletPdf");
    var fk = document.getElementById("dnmFileAnswerKeyPdf");
    if (fb) {
      fb.addEventListener("change", function () {
        dnmSyncPdfFilesFromInputs();
        dnmTryRunDualPdfAnalysis();
        dnmRefreshAiPdfMatrixButton();
      });
    }
    if (fk) {
      fk.addEventListener("change", function () {
        dnmSyncPdfFilesFromInputs();
        dnmTryRunDualPdfAnalysis();
        dnmRefreshAiPdfMatrixButton();
      });
    }
    var st = document.getElementById("dnmPlanSinavTuru");
    if (st) {
      st.addEventListener("change", function () {
        dnmToggleAiUploadSection();
        dnmRefreshAiPdfMatrixButton();
      });
    }
    var bAdd = document.getElementById("btnDnmAddMatrixRow");
    if (bAdd) {
      bAdd.addEventListener("click", function () {
        dnmAddMatrixRowClick();
      });
    }
    var bInit = document.getElementById("btnDnmInitMatrix");
    if (bInit) {
      bInit.addEventListener("click", function () {
        dnmInitMatrixClick();
      });
    }
    var bBulk = document.getElementById("btnDnmBuildMatrixBulk");
    if (bBulk) {
      bBulk.addEventListener("click", function () {
        dnmBuildMatrixBulk();
      });
    }
    var bAiPdf = document.getElementById("btnDnmAiPdfMatrix");
    if (bAiPdf) {
      bAiPdf.addEventListener("click", function () {
        void dnmRunAiPdfMatrixExtract();
      });
    }
    dnmRefreshAiPdfMatrixButton();
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
    /* En yakın / en güncel tarih üstte (ISO string DESC) */
    out.sort(function (a, b) {
      var da = dnmExamDateToIso(a) || "";
      var db = dnmExamDateToIso(b) || "";
      return db.localeCompare(da);
    });
    return out;
  }

  /**
   * Eski optik akışında üretilen sahte student_id; Appwrite `students` belgesi değildir.
   * Yeni kayıtlar yalnızca eşleşen gerçek öğrenci $id ile yazılır (optik-okuma.js).
   */
  function dnmIsSyntheticExamResultStudentId(sid) {
    return /^optik_unmatched_/i.test(String(sid || "").trim());
  }

  async function dnmEnsureStudentsCache() {
    if (dnmStudentsCache) return dnmStudentsCache;
    dnmStudentsCache = {};
    var cid = getCoachId();
    if (!cid) return dnmStudentsCache;
    try {
      var list = await fetchStudentsForCoach(cid);
      list.forEach(function (s) {
        dnmStudentsCache[s.id] = s.name;
      });
    } catch (e) {
      console.warn("[dnm] öğrenci önbellek", e);
    }
    return dnmStudentsCache;
  }

  async function dnmFetchExamResultsForPlan(planRow) {
    if (!planRow || !planRow.id) return [];
    var cid = getCoachId();
    var out = [];
    try {
      var snap = await getDocs(
        query(collection(db, APPWRITE_COLLECTION_EXAM_RESULTS), where("exam_id", "==", planRow.id))
      );
      snap.forEach(function (d) {
        var x = typeof d.data === "function" ? d.data() : {};
        out.push({ id: d.id, data: x });
      });
    } catch (e) {
      console.warn("[dnm] ExamResults exam_id:", e);
    }
    if (!out.length && cid) {
      try {
        var snap2 = await getDocs(
          query(collection(db, APPWRITE_COLLECTION_EXAM_RESULTS), where("coach_id", "==", cid))
        );
        var wantName = String(planRow.examName || "")
          .trim()
          .toLowerCase();
        var wantDate = dnmExamDateToIso(planRow);
        snap2.forEach(function (d) {
          var x = typeof d.data === "function" ? d.data() : {};
          var en = String(x.exam_name || "")
            .trim()
            .toLowerCase();
          var saved = x.saved_at;
          var ds = "";
          if (saved && typeof saved.toDate === "function") {
            try {
              ds = saved.toDate().toISOString().slice(0, 10);
            } catch (e) {}
          } else if (typeof saved === "string") ds = saved.slice(0, 10);
          if (wantName && en === wantName && (!wantDate || ds === wantDate)) {
            out.push({ id: d.id, data: x });
          }
        });
      } catch (e2) {
        console.warn("[dnm] ExamResults yedek süzme:", e2);
      }
    }
    return out.filter(function (entry) {
      var x = entry && entry.data ? entry.data : {};
      var sid = x.student_id != null ? x.student_id : x.studentId;
      return !dnmIsSyntheticExamResultStudentId(sid);
    });
  }

  function dnmParseDetailJson(raw) {
    try {
      if (typeof raw === "string") return JSON.parse(raw || "{}");
      if (raw && typeof raw === "object") return raw;
    } catch (e) {}
    return {};
  }

  function dnmNormalizePlanMatrix(planRow) {
    var rawMx = planRow && (planRow.answerKeyMatrix || planRow.answer_key_matrix);
    if (!Array.isArray(rawMx) || !rawMx.length) return [];
    return rawMx.map(function (x, idx) {
      return {
        questionNo: x.questionNo != null ? Number(x.questionNo) : idx + 1,
        ders: String(x.ders || x.subject || "").trim(),
        konu: String(x.konu || x.topic || "").trim(),
        answer: dnmNormalizeAnswerKeyLetter(x.answer != null ? x.answer : x.correct),
      };
    });
  }

  function dnmApplyMrBadgesToStudentTable(trDetail, badgeByResultId) {
    var tb = trDetail.querySelector("[data-dnm-stu-rows]");
    if (!tb) return;
    tb.querySelectorAll("tr[data-dnm-result-id]").forEach(function (tr) {
      var rid = tr.getAttribute("data-dnm-result-id") || "";
      var cell = tr.querySelector(".dnm-stu-cell");
      if (!cell) return;
      cell.querySelectorAll(".dnm-mr-badge").forEach(function (el) {
        el.remove();
      });
      var b = badgeByResultId && badgeByResultId[rid];
      if (!b || !b.text) return;
      var span = document.createElement("span");
      span.className =
        "dnm-mr-badge " + (b.danger ? "dnm-mr-badge--danger" : "dnm-mr-badge--warn");
      span.setAttribute("role", "status");
      span.textContent = b.text;
      cell.appendChild(span);
    });
  }

  async function dnmMrDeleteDocumentsForStudentExam(studentId, examId) {
    var sid = String(studentId || "").trim();
    var eid = String(examId || "").trim();
    if (!sid || !eid) return;
    var cref = collection(db, APPWRITE_COLLECTION_MR_EXAM_DEFICIENCIES);
    var q = query(cref, where("student_id", "==", sid), where("exam_id", "==", eid));
    var snap = await getDocs(q);
    var ids = [];
    snap.forEach(function (d) {
      ids.push(d.id);
    });
    for (var i = 0; i < ids.length; i++) {
      var delR = await deleteDoc(doc(db, APPWRITE_COLLECTION_MR_EXAM_DEFICIENCIES, ids[i]));
      if (isAppwriteWriteSoftFailure(delR)) {
        console.warn("[dnm] MR satırı silinemedi:", delR && delR.message ? delR.message : delR);
      }
    }
  }

  async function dnmMrWriteDeficiencyPayloads(payloads) {
    var cref = collection(db, APPWRITE_COLLECTION_MR_EXAM_DEFICIENCIES);
    for (var j = 0; j < payloads.length; j++) {
      var wr = await addDoc(cref, payloads[j]);
      if (isAppwriteWriteSoftFailure(wr)) return false;
    }
    return true;
  }

  async function dnmRunMrAnalysisForAccordion(planRow, trDetail, results, matrix, runId) {
    var cid = getCoachId();
    var examId = String(planRow && planRow.id ? planRow.id : "").trim();
    if (!cid || !examId || !Array.isArray(matrix) || !matrix.length || !trDetail || !Array.isArray(results)) {
      return;
    }
    /** @type {Record<string, { text: string, danger: boolean }>} */
    var badgeByResultId = Object.create(null);
    var analyzedAt = new Date().toISOString();
    for (var i = 0; i < results.length; i++) {
      if (String(trDetail.dataset.dnmMrRunId || "") !== String(runId)) return;
      var entry = results[i];
      var x = entry.data || {};
      var sid = String(x.student_id || "").trim();
      if (!sid || dnmIsSyntheticExamResultStudentId(sid)) continue;
      var detail = dnmParseDetailJson(x.detail_json);
      var answers = extractStudentAnswersFromExamDetail(detail);
      if (!Object.keys(answers).length) continue;
      var deficiencies = analyzeStudentDeficiencies(answers, matrix);
      var aggregated = aggregateTopicDeficiencies(deficiencies, matrix);
      try {
        await dnmMrDeleteDocumentsForStudentExam(sid, examId);
        if (aggregated.length) {
          var payloads = buildMrDeficiencyWritePayloads({
            coachId: cid,
            examId: examId,
            studentId: sid,
            examResultId: entry.id,
            aggregated: aggregated,
            analyzedAtIso: analyzedAt,
          });
          var ok = await dnmMrWriteDeficiencyPayloads(payloads);
          if (ok) {
            var anyHigh = aggregated.some(function (r) {
              return r.severity_high;
            });
            badgeByResultId[entry.id] = {
              text: "MR raporu hazır · " + aggregated.length + " konu",
              danger: anyHigh,
            };
          }
        }
      } catch (err) {
        console.warn("[dnm] MR analiz:", err && err.message ? err.message : err);
      }
    }
    if (String(trDetail.dataset.dnmMrRunId || "") !== String(runId)) return;
    dnmApplyMrBadgesToStudentTable(trDetail, badgeByResultId);
  }

  function dnmStudentNetFromResultRow(entry, studentsMap) {
    var x = entry.data || {};
    var detail = dnmParseDetailJson(x.detail_json);
    var net =
      detail.computed && typeof detail.computed.totalNet === "number"
        ? detail.computed.totalNet
        : null;
    if (net == null && x.net != null) net = parseFloat(String(x.net).replace(",", "."), 10);
    if (isNaN(net)) net = "—";
    var sid = String(x.student_id || "").trim();
    var name = (studentsMap && studentsMap[sid]) || sid || "—";
    return { name: name, net: net, id: entry.id };
  }

  function dnmRenderAccordionPanels(planRow, trDetail, results, studentsMap) {
    var esc = String(planRow.id || "").replace(/[^a-zA-Z0-9_-]/g, "_");
    var kurumEl = trDetail.querySelector("[data-dnm-kurum-body]");
    var stuBody = trDetail.querySelector("[data-dnm-stu-body]");
    var n = results.length;
    var sum = 0;
    var cnt = 0;
    results.forEach(function (e) {
      var r = dnmStudentNetFromResultRow(e, studentsMap);
      if (typeof r.net === "number") {
        sum += r.net;
        cnt++;
      }
    });
    var avg = cnt ? Math.round((sum / cnt) * 10) / 10 : null;
    if (kurumEl) {
      kurumEl.innerHTML =
        n === 0
          ? '<p class="text-slate-500 text-sm m-0">Bu deneme için henüz kurum geneli sonuç özeti oluşturulabilecek kayıt yok.</p>'
          : '<ul class="list-none m-0 p-0 space-y-2 text-sm text-slate-700">' +
            "<li><strong>Girilen sonuç sayısı:</strong> " +
            n +
            "</li>" +
            (avg != null
              ? "<li><strong>Ortalama net:</strong> " + avg + "</li>"
              : "<li><strong>Ortalama net:</strong> hesaplanamadı (detay eksik)</li>") +
            "</ul>";
    }
    if (stuBody) {
      if (!n) {
        stuBody.innerHTML =
          '<p class="text-slate-500 text-sm m-0">Öğrenci sonucu bulunmuyor.</p>';
        return;
      }
      var rows = results
        .map(function (e) {
          return dnmStudentNetFromResultRow(e, studentsMap);
        })
        .sort(function (a, b) {
          return String(a.name).localeCompare(String(b.name), "tr");
        });
      var h =
        '<table class="min-w-full text-sm text-left border border-slate-200 rounded-lg overflow-hidden">' +
        '<thead class="bg-slate-100 text-slate-600 font-semibold">' +
        '<tr><th class="px-3 py-2">Öğrenci</th><th class="px-3 py-2">Net</th></tr></thead><tbody data-dnm-stu-rows="' +
        esc +
        '">';
      rows.forEach(function (r) {
        var nameLow = String(r.name).toLowerCase();
        var rid = escapeHtml(String(r.id || ""));
        h +=
          '<tr class="border-t border-slate-100" data-dnm-stu-name="' +
          escapeHtml(nameLow) +
          '" data-dnm-result-id="' +
          rid +
          '"><td class="px-3 py-2"><div class="dnm-stu-cell flex flex-col gap-1"><span class="dnm-stu-cell__name font-medium text-slate-800">' +
          escapeHtml(String(r.name)) +
          '</span></div></td><td class="px-3 py-2 font-medium tabular-nums">' +
          escapeHtml(String(r.net)) +
          "</td></tr>";
      });
      h += "</tbody></table>";
      stuBody.innerHTML = h;
    }
  }

  async function dnmHydrateAccordionDetail(planRow, trDetail) {
    if (trDetail.dataset.dnmHydrated === "1") return;
    trDetail.dataset.dnmHydrated = "1";
    var inner = trDetail.querySelector(".dnm-acc-inner");
    if (!inner) return;
    inner.innerHTML =
      '<div class="flex flex-wrap gap-2 border-b border-slate-200 pb-3 mb-4">' +
      '<button type="button" class="dnm-acc-tab px-4 py-2 rounded-lg text-sm font-semibold bg-violet-600 text-white" data-dnm-acc-tab="kurum">Kurum Sonuçları</button>' +
      '<button type="button" class="dnm-acc-tab px-4 py-2 rounded-lg text-sm font-semibold text-slate-600 bg-slate-100 hover:bg-slate-200" data-dnm-acc-tab="ogrenci">Öğrenci Sonuçları</button>' +
      "</div>" +
      '<div class="dnm-acc-panel" data-dnm-acc-panel="kurum">' +
      '<div class="text-sm text-slate-600" data-dnm-kurum-body><p class="text-slate-500 m-0">Yükleniyor…</p></div>' +
      "</div>" +
      '<div class="dnm-acc-panel hidden" data-dnm-acc-panel="ogrenci" hidden>' +
      '<input type="text" class="w-full max-w-md mb-3 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none" placeholder="Öğrenci Adı Ara..." data-dnm-stu-search />' +
      '<div class="dnm-acc-stu-table-wrap overflow-x-auto" data-dnm-stu-body></div>' +
      "</div>";
    await dnmEnsureStudentsCache();
    var results = await dnmFetchExamResultsForPlan(planRow);
    trDetail.dataset.dnmResultsJson = JSON.stringify(results.map(function (r) { return { id: r.id, data: r.data }; }));
    dnmRenderAccordionPanels(planRow, trDetail, results, dnmStudentsCache || {});
    var matrix = dnmNormalizePlanMatrix(planRow);
    var runId = String(Date.now()) + "_" + Math.random().toString(36).slice(2, 10);
    trDetail.dataset.dnmMrRunId = runId;
    if (matrix.length && results.length && getCoachId()) {
      void dnmRunMrAnalysisForAccordion(planRow, trDetail, results, matrix, runId);
    }
    var search = trDetail.querySelector("[data-dnm-stu-search]");
    if (search) {
      search.addEventListener("input", function () {
        var q = String(search.value || "")
          .trim()
          .toLocaleLowerCase("tr");
        var tb = trDetail.querySelector("[data-dnm-stu-rows]");
        if (!tb) return;
        tb.querySelectorAll("tr[data-dnm-stu-name]").forEach(function (tr) {
          var nm = tr.getAttribute("data-dnm-stu-name") || "";
          tr.hidden = q && nm.indexOf(q) === -1;
        });
      });
    }
  }

  function dnmBindAccordionTabs(root) {
    if (dnmAccordionUiBound || !root) return;
    dnmAccordionUiBound = true;
    root.addEventListener("click", function (ev) {
      var tab = ev.target.closest && ev.target.closest("[data-dnm-acc-tab]");
      if (!tab || !root.contains(tab)) return;
      var host = tab.closest("tr.dnm-tr--detail");
      if (!host) return;
      var t = tab.getAttribute("data-dnm-acc-tab");
      host.querySelectorAll(".dnm-acc-tab").forEach(function (b) {
        var on = b.getAttribute("data-dnm-acc-tab") === t;
        b.classList.toggle("bg-violet-600", on);
        b.classList.toggle("text-white", on);
        b.classList.toggle("text-slate-600", !on);
        b.classList.toggle("bg-slate-100", !on);
        b.classList.toggle("hover:bg-slate-200", !on);
      });
      host.querySelectorAll(".dnm-acc-panel").forEach(function (p) {
        var show = p.getAttribute("data-dnm-acc-panel") === t;
        p.hidden = !show;
        p.classList.toggle("hidden", !show);
      });
    });
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
      tr.className = "dnm-tr dnm-tr--main";
      tr.dataset.dnmId = row.id;
      tr.dataset.dnmPlanId = row.id;
      tr.innerHTML =
        '<td class="dnm-td dnm-td--chev" aria-hidden="true"><i class="fa-solid fa-chevron-right dnm-chevron"></i></td>' +
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
      var trD = document.createElement("tr");
      trD.className = "dnm-tr dnm-tr--detail";
      trD.hidden = true;
      trD.dataset.dnmDetailFor = row.id;
      trD.innerHTML =
        '<td colspan="8" class="dnm-td">' +
        '<div class="tw-important-root dnm-acc-inner p-4 sm:p-5 min-h-[120px]">' +
        '<p class="text-sm text-slate-500 m-0">Detaylar için satıra tıklayın.</p>' +
        "</div></td>";
      tbody.appendChild(trD);
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
    var fb = document.getElementById("dnmFileBookletPdf");
    var fkAns = document.getElementById("dnmFileAnswerKeyPdf");
    if (fb) fb.value = "";
    if (fkAns) fkAns.value = "";
    var lb = document.getElementById("dnmFileBookletPdfLabel");
    var lbf = document.getElementById("dnmFileAnswerKeyPdfLabel");
    if (lb) lb.textContent = "";
    if (lbf) lbf.textContent = "";
    var sh = document.getElementById("dnmStoredPdfHint");
    if (sh) {
      sh.hidden = true;
      sh.textContent = "";
    }
    DNM_KITAPCIK_TUR_LETTERS.forEach(function (L) {
      var el = document.getElementById("dnmBooklet" + L);
      if (el) el.checked = false;
    });
    dnmClearMatrixUi();
    dnmToggleAiUploadSection();
    var ov = document.getElementById("dnmPdfAnalyzingOverlay");
    if (ov) ov.hidden = true;
    dnmMatrixBusy = false;
    var saveBtn = document.getElementById("btnDnmSave");
    if (saveBtn) saveBtn.disabled = false;
    dnmResetPdfAnalyzingOverlayCopy();
    dnmRefreshAiPdfMatrixButton();
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
    dnmSetBookletTypesFromRow(row);
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
    var fb = document.getElementById("dnmFileBookletPdf");
    var fkAns = document.getElementById("dnmFileAnswerKeyPdf");
    if (fb) fb.value = "";
    if (fkAns) fkAns.value = "";
    var lb = document.getElementById("dnmFileBookletPdfLabel");
    var lbf = document.getElementById("dnmFileAnswerKeyPdfLabel");
    if (lb) lb.textContent = "";
    if (lbf) lbf.textContent = "";
    var sh = document.getElementById("dnmStoredPdfHint");
    var bid = row.bookletPdfFileId || row.denemeKitapcikFileId || (row.aiExtractionMeta && row.aiExtractionMeta.bookletPdfStorageId);
    var aid = row.answerKeyPdfFileId || row.cevapAnahtariFileId || (row.aiExtractionMeta && row.aiExtractionMeta.answerKeyPdfStorageId);
    if (sh) {
      if (bid || aid) {
        sh.hidden = false;
        sh.textContent =
          "Bu planda kayıtlı PDF" +
          (bid && aid ? "ler" : "") +
          " var. Yeni dosya seçerek güncelleyebilirsiniz.";
      } else {
        sh.hidden = true;
        sh.textContent = "";
      }
    }
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
          answer: dnmNormalizeAnswerKeyLetter(x.answer != null ? x.answer : x.correct),
        };
      });
      dnmRenderMatrixRows(normalized, ek);
      var det = document.getElementById("dnmDetailsAdvanced");
      if (det) det.open = true;
    }
    dnmRefreshAiPdfMatrixButton();
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
    dnmSyncPdfFilesFromInputs();
    var pdfIds = await dnmMaybeUploadExamPdfs();
    var bookletTypesArr = dnmCollectBookletTypes();
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
    if (pdfIds.bookletId) {
      payload.bookletPdfFileId = pdfIds.bookletId;
      payload.denemeKitapcikFileId = pdfIds.bookletId;
    }
    if (pdfIds.answerKeyId) {
      payload.answerKeyPdfFileId = pdfIds.answerKeyId;
      payload.cevapAnahtariFileId = pdfIds.answerKeyId;
    }
    if (bookletTypesArr.length) {
      payload.bookletTypesJson = JSON.stringify(bookletTypesArr);
      payload.bookletVariants = bookletTypesArr.join(",");
    }
    payload.aiExtractionMeta = {
      simulated: true,
      examPdfFileName: dnmAiExamFile ? dnmAiExamFile.name : null,
      answerKeyFileName: dnmAiKeyFile ? dnmAiKeyFile.name : null,
      matrixRowCount: matrix.length,
      bookletPdfStorageId: pdfIds.bookletId || null,
      answerKeyPdfStorageId: pdfIds.answerKeyId || null,
      bookletTypes: bookletTypesArr,
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
      dnmBindAccordionTabs(root);
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
          return;
        }
        var trMain = ev.target.closest && ev.target.closest("tr.dnm-tr--main");
        if (trMain && root.contains(trMain)) {
          if (ev.target.closest && ev.target.closest("button")) return;
          var pid = trMain.getAttribute("data-dnm-plan-id") || trMain.dataset.dnmPlanId;
          if (!pid) return;
          var tbody = trMain.parentElement;
          if (!tbody) return;
          var detail = tbody.querySelector('tr.dnm-tr--detail[data-dnm-detail-for="' + pid + '"]');
          var wasOpen = detail && !detail.hidden;
          tbody.querySelectorAll("tr.dnm-tr--detail").forEach(function (r) {
            r.hidden = true;
          });
          tbody.querySelectorAll("tr.dnm-tr--main .dnm-chevron").forEach(function (c) {
            c.style.transform = "";
          });
          if (!wasOpen && detail) {
            detail.hidden = false;
            var ch = trMain.querySelector(".dnm-chevron");
            if (ch) ch.style.transform = "rotate(90deg)";
            var planRow = dnmPlansCache.find(function (r) {
              return r.id === pid;
            });
            if (planRow) void dnmHydrateAccordionDetail(planRow, detail);
          }
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
        if (view === "deneme-analiz-denemeler") initDenemePlanlamaPage();
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
  global.refreshKarneSonuclariTable = refreshKarneSonuclariTable;
})(typeof window !== "undefined" ? window : globalThis);
