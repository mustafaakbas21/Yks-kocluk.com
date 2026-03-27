/**
 * Ultra-Detaylı Karne V2 — Appwrite ExamResults, ApexCharts, sahte veri yok.
 * Trend ekseni: döküman `exam_name` + `saved_at` (Exams koleksiyonu etiket için zorunlu değil).
 */
import { Query } from "./appwrite-browser.js";
import {
  databases,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_EXAM_RESULTS,
} from "./appwrite-config.js";
import { logAppwriteError } from "./appwrite-compat.js";

var apexTrend = null;
var apexRadar = null;

function getApexCharts() {
  return typeof window !== "undefined" && window.ApexCharts ? window.ApexCharts : null;
}

/**
 * Ders adından TYT radar kolu (Matematik / Türkçe / Fen / Sosyal).
 * @param {string} name
 * @returns {"matematik"|"turkce"|"fen"|"sosyal"|null}
 */
export function danaKarneV2LessonToRadarBranch(name) {
  var n = String(name || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (/turkce|turk\s|edebiyat|dil\s*ve\s*anlatim|paragraf/.test(n)) return "turkce";
  if (/matematik|mat\.|geometri|sayisal/.test(n)) return "matematik";
  if (/fen|fizik|kimya|biyoloji|biyo/.test(n)) return "fen";
  if (/sosyal|tarih|cografya|felsefe|din|inkilap/.test(n)) return "sosyal";
  return null;
}

function esc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function parseDetailJson(raw) {
  if (raw == null || String(raw).trim() === "") return null;
  try {
    return JSON.parse(String(raw));
  } catch (e) {
    return null;
  }
}

function savedAtMs(doc) {
  var t = doc.saved_at || doc.savedAt || doc.$createdAt || "";
  var d = t ? new Date(t).getTime() : 0;
  return isNaN(d) ? 0 : d;
}

/**
 * @param {string} studentId
 * @param {string} coachId
 * @returns {Promise<object[]>}
 */
async function fetchExamResultsForStudent(studentId, coachId) {
  var sid = String(studentId || "").trim();
  if (!sid) return [];
  var queries = [Query.equal("student_id", sid), Query.orderDesc("saved_at"), Query.limit(40)];
  if (coachId) queries.unshift(Query.equal("coach_id", coachId));
  try {
    var res = await databases.listDocuments(
      APPWRITE_DATABASE_ID,
      APPWRITE_COLLECTION_EXAM_RESULTS,
      queries
    );
    var docs = (res && res.documents) || [];
    if (coachId) {
      docs = docs.filter(function (d) {
        var c = d.coach_id != null ? d.coach_id : d.coachId;
        return String(c || "").trim() === coachId;
      });
    }
    docs.sort(function (a, b) {
      return savedAtMs(b) - savedAtMs(a);
    });
    return docs;
  } catch (err) {
    if (coachId) {
      try {
        var res2 = await databases.listDocuments(
          APPWRITE_DATABASE_ID,
          APPWRITE_COLLECTION_EXAM_RESULTS,
          [Query.equal("student_id", sid), Query.orderDesc("saved_at"), Query.limit(40)]
        );
        var docs2 = ((res2 && res2.documents) || []).filter(function (d) {
          var c = d.coach_id != null ? d.coach_id : d.coachId;
          return String(c || "").trim() === coachId;
        });
        docs2.sort(function (a, b) {
          return savedAtMs(b) - savedAtMs(a);
        });
        return docs2;
      } catch (e2) {
        logAppwriteError("dana-karne-v2/fetchExamResults fallback", e2);
        throw err;
      }
    }
    throw err;
  }
}

/**
 * Öğrencinin ExamResults listesinde en az bir kayıtta topicPerformance var mı (tam konu analizi).
 */
function examResultsDocsHaveTopicPerformance(docs) {
  for (var i = 0; i < (docs || []).length; i++) {
    var det = parseDetailJson(docs[i].detail_json || docs[i].detailJson);
    if (det && Array.isArray(det.topicPerformance) && det.topicPerformance.length > 0) return true;
  }
  return false;
}

function trendFromDocs(docs) {
  var slice = docs.slice(0, 5).reverse();
  var labels = [];
  var vals = [];
  slice.forEach(function (d, ix) {
    var det = parseDetailJson(d.detail_json || d.detailJson);
    var net = det && det.totals && det.totals.net != null ? Number(det.totals.net) : NaN;
    if (isNaN(net)) return;
    var name = String(d.exam_name || d.examName || "").trim();
    if (!name && det && det.examName) name = String(det.examName).trim();
    if (!name) name = "Deneme";
    var t = String(d.saved_at || d.$createdAt || "").trim();
    var shortD = "";
    try {
      shortD = t ? new Date(t).toLocaleDateString("tr-TR", { day: "2-digit", month: "short" }) : "";
    } catch (e) {
      void e;
    }
    labels.push(shortD ? name + " · " + shortD : name || "D" + (ix + 1));
    vals.push(net);
  });
  return { labels: labels, vals: vals };
}

function radarFromLatestDoc(latestDoc) {
  var det = parseDetailJson(latestDoc && (latestDoc.detail_json || latestDoc.detailJson));
  if (!det || !Array.isArray(det.perLesson)) {
    return { matematik: null, turkce: null, fen: null, sosyal: null, hasData: false };
  }
  /** @type {Record<string, number[]>} */
  var acc = { matematik: [], turkce: [], fen: [], sosyal: [] };
  det.perLesson.forEach(function (pl) {
    var label = pl.lessonName || pl.lessonId || "";
    var br = danaKarneV2LessonToRadarBranch(label);
    if (!br) return;
    var n = Number(pl.net);
    if (isNaN(n)) return;
    acc[br].push(n);
  });
  function avg(arr) {
    if (!arr.length) return null;
    return arr.reduce(function (s, x) {
      return s + x;
    }, 0) / arr.length;
  }
  var has =
    acc.matematik.length ||
    acc.turkce.length ||
    acc.fen.length ||
    acc.sosyal.length;
  return {
    matematik: avg(acc.matematik),
    turkce: avg(acc.turkce),
    fen: avg(acc.fen),
    sosyal: avg(acc.sosyal),
    hasData: !!has,
  };
}

/**
 * Tüm kayıtlardan konu bazlı toplam D/Y/B ve başarı %.
 * @param {object[]} docs — ExamResults documents
 */
function aggregateTopicRows(docs) {
  /** @type {Record<string, { lessonName: string, topicName: string, correct: number, wrong: number, empty: number }>} */
  var map = {};
  docs.forEach(function (d) {
    var det = parseDetailJson(d.detail_json || d.detailJson);
    if (!det) return;
    var tp = det.topicPerformance;
    if (Array.isArray(tp) && tp.length) {
      tp.forEach(function (row) {
        var tid = String(row.topicId || "").trim();
        if (!tid) return;
        if (!map[tid]) {
          map[tid] = {
            lessonName: row.lessonName || "—",
            topicName: row.topicName || tid,
            correct: 0,
            wrong: 0,
            empty: 0,
          };
        }
        map[tid].correct += Number(row.correct) || 0;
        map[tid].wrong += Number(row.wrong) || 0;
        map[tid].empty += Number(row.empty) || 0;
        if (row.lessonName && map[tid].lessonName === "—") map[tid].lessonName = row.lessonName;
        if (row.topicName) map[tid].topicName = row.topicName;
      });
      return;
    }
    var wb = det.wrongByTopic;
    if (Array.isArray(wb)) {
      wb.forEach(function (w) {
        var tid = String(w.topicId || "").trim();
        if (!tid) return;
        if (!map[tid]) {
          map[tid] = {
            lessonName: "—",
            topicName: w.topicName || tid,
            correct: 0,
            wrong: 0,
            empty: 0,
          };
        }
        var wc = Array.isArray(w.wrongQuestions) ? w.wrongQuestions.length : 0;
        map[tid].wrong += wc;
      });
    }
  });
  return Object.keys(map).map(function (tid) {
    var x = map[tid];
    var t = x.correct + x.wrong + x.empty;
    var pct = t > 0 ? Math.round((x.correct / t) * 1000) / 10 : x.wrong > 0 ? 0 : null;
    return {
      topicId: tid,
      lessonName: x.lessonName,
      topicName: x.topicName,
      correct: x.correct,
      wrong: x.wrong,
      empty: x.empty,
      total: t,
      successPct: pct,
      legacyOnlyWrong: t === 0 && x.wrong > 0,
    };
  });
}

function badgeClassForPct(pct, legacyOnlyWrong) {
  if (legacyOnlyWrong || pct == null) {
    return { cls: "dk2-badge dk2-badge--muted", label: "Kısıtlı veri" };
  }
  if (pct > 75) return { cls: "dk2-badge dk2-badge--safe", label: "Güvenli" };
  if (pct >= 40) return { cls: "dk2-badge dk2-badge--warn", label: "Dikkat" };
  return { cls: "dk2-badge dk2-badge--crit", label: "Kritik eksik" };
}

function renderTopicTable(host, rows, toast, examDocs) {
  if (!host) return;
  host.innerHTML = "";
  if (!rows.length) {
    host.innerHTML =
      '<div class="dk2-table-empty">Bu öğrenci için ExamResults kaydı yok veya konu dökümü bulunmuyor. Akıllı Optik ile kayıt oluşturun.</div>';
    return;
  }
  var showLegacyTopicNote =
    Array.isArray(examDocs) &&
    examDocs.length > 0 &&
    !examResultsDocsHaveTopicPerformance(examDocs);
  rows.sort(function (a, b) {
    var la = String(a.lessonName || "").localeCompare(String(b.lessonName || ""), "tr");
    if (la !== 0) return la;
    return String(a.topicName || "").localeCompare(String(b.topicName || ""), "tr");
  });
  var wrap = document.createElement("div");
  wrap.className = "dk2-table-wrap";
  if (showLegacyTopicNote) {
    var note = document.createElement("p");
    note.className = "dk2-table-legacy-note";
    note.setAttribute("role", "note");
    note.textContent =
      "Not: Eski ExamResults kayıtlarında topicPerformance yoksa tablo yalnızca yanlış sayıları ile sınırlı olabilir; tam analiz için Akıllı Optik’ten yeni kayıt (güncellenmiş detail_json) gerekir.";
    wrap.appendChild(note);
  }
  var table = document.createElement("table");
  table.className = "dk2-table";
  table.innerHTML =
    "<thead><tr class=\"dk2-table__head-row\">" +
    "<th>Ders</th><th>Konu</th>" +
    "<th class=\"dk2-table__num\">Yanlış</th><th class=\"dk2-table__num\">Boş</th>" +
    "<th class=\"dk2-table__num\">Başarı %</th><th>Durum</th><th class=\"dk2-table__action\">Aksiyon</th></tr></thead>";
  var tb = document.createElement("tbody");
  rows.forEach(function (r) {
    var badge = badgeClassForPct(r.successPct, r.legacyOnlyWrong);
    var isCritical = r.successPct != null && r.successPct < 40;
    var tr = document.createElement("tr");
    tr.className = "dk2-table__row";
    var pctStr = r.successPct != null ? String(r.successPct).replace(".", ",") + "%" : "—";
    var actionCell = "";
    if (isCritical) {
      actionCell =
        '<button type="button" class="dk2-telafi-btn" data-topic="' +
        esc(r.topicName) +
        "\" data-lesson=\"" +
        esc(r.lessonName) +
        '">AI Telafi Etüdü Bas</button>';
    } else {
      actionCell = '<span class="dk2-table__dash">—</span>';
    }
    tr.innerHTML =
      "<td class=\"dk2-table__lesson\">" +
      esc(r.lessonName) +
      "</td><td>" +
      esc(r.topicName) +
      "</td><td class=\"dk2-table__num dk2-table__wrong\">" +
      r.wrong +
      "</td><td class=\"dk2-table__num\">" +
      r.empty +
      "</td><td class=\"dk2-table__num dk2-table__pct\">" +
      pctStr +
      "</td><td><span class=\"" +
      badge.cls +
      "\">" +
      esc(badge.label) +
      "</span></td><td class=\"dk2-table__action\">" +
      actionCell +
      "</td>";
    tb.appendChild(tr);
  });
  table.appendChild(tb);
  wrap.appendChild(table);
  host.appendChild(wrap);

  host.querySelectorAll(".dk2-telafi-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (typeof toast === "function") toast("Etüt hazırlanıyor…", { variant: "success" });
    });
  });
}

function setGate(overlay, shell, on) {
  if (overlay) overlay.hidden = !on;
  if (shell) {
    shell.classList.toggle("is-locked", on);
    shell.setAttribute("aria-hidden", on ? "true" : "false");
  }
}

function setSkeleton(el, show) {
  if (!el) return;
  el.hidden = !show;
}

export function destroyDanaKarneV2Charts() {
  try {
    if (apexTrend && typeof apexTrend.destroy === "function") {
      apexTrend.destroy();
    }
  } catch (e) {
    void e;
  }
  apexTrend = null;
  try {
    if (apexRadar && typeof apexRadar.destroy === "function") {
      apexRadar.destroy();
    }
  } catch (e2) {
    void e2;
  }
  apexRadar = null;
}

/**
 * @param {object} opt
 * @param {string} [opt.studentId]
 * @param {object|null} [opt.student] — { name, studentName }
 * @param {function} [opt.showToast]
 * @param {function} [opt.getCoachId]
 * @param {function} [opt.onTopicsForTelafi] — (rows for generateAITelafiTest shape)
 */
export async function renderDanaKarneV2(opt) {
  opt = opt || {};
  var showToast = typeof opt.showToast === "function" ? opt.showToast : function () {};
  var getCoachId =
    typeof opt.getCoachId === "function"
      ? opt.getCoachId
      : function () {
          return "";
        };
  var sid = String(opt.studentId || "").trim();
  var ApexChartsCtor = getApexCharts();

  var elTrend = document.getElementById("danaKarneApexTrend");
  var elRadar = document.getElementById("danaKarneApexRadar");
  var elTable = document.getElementById("danaKarneTopicTableHost");
  var skel = document.getElementById("danaKarneV2Skeleton");
  var gate = document.getElementById("danaKarneBlurOverlay");
  var shell = document.getElementById("danaKarneChartBlurShell");

  destroyDanaKarneV2Charts();

  if (!elTrend || !elRadar || !elTable) {
    console.warn("[dana-karne-v2] DOM eksik.");
    return;
  }

  elTrend.innerHTML = "";
  elRadar.innerHTML = "";
  elTable.innerHTML = "";

  if (!sid) {
    setGate(gate, shell, true);
    setSkeleton(skel, false);
    if (typeof opt.onTopicsForTelafi === "function") opt.onTopicsForTelafi([]);
    return { trendVals: [], trendLabels: [], agg: [], radar: null };
  }

  setGate(gate, shell, false);
  setSkeleton(skel, true);

  if (!ApexChartsCtor) {
    setSkeleton(skel, false);
    showToast("ApexCharts yüklenemedi.", { variant: "danger" });
    return { trendVals: [], trendLabels: [], agg: [], radar: null };
  }

  var coachId = String(getCoachId() || "").trim();
  var docs = [];
  try {
    docs = await fetchExamResultsForStudent(sid, coachId);
  } catch (err) {
    logAppwriteError("dana-karne-v2/render fetch", err);
    setSkeleton(skel, false);
    showToast(
      "ExamResults yüklenemedi: " + (err && err.message ? err.message : String(err)),
      { variant: "danger" }
    );
    return { trendVals: [], trendLabels: [], agg: [], radar: null };
  }

  setSkeleton(skel, false);

  var trend = trendFromDocs(docs);
  var tMin = trend.vals.length ? Math.min.apply(null, trend.vals) : 0;
  var tMax = trend.vals.length ? Math.max.apply(null, trend.vals) : 0;

  if (trend.vals.length >= 1) {
    apexTrend = new ApexChartsCtor(elTrend, {
      chart: {
        type: "line",
        height: 280,
        toolbar: { show: false },
        zoom: { enabled: false },
        fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif",
        dropShadow: {
          enabled: true,
          top: 2,
          left: 0,
          blur: 8,
          opacity: 0.35,
          color: "#6C5CE7",
        },
      },
      series: [{ name: "Toplam net", data: trend.vals }],
      colors: ["#6C5CE7"],
      stroke: { curve: "smooth", width: 3 },
      fill: {
        type: "gradient",
        gradient: {
          shade: "light",
          type: "vertical",
          shadeIntensity: 0.35,
          opacityFrom: 0.55,
          opacityTo: 0.06,
          stops: [0, 100],
        },
      },
      dataLabels: { enabled: false },
      markers: {
        size: 5,
        colors: ["#fff"],
        strokeColors: "#6C5CE7",
        strokeWidth: 2,
        hover: { size: 7 },
      },
      xaxis: {
        categories: trend.labels,
        labels: { style: { colors: "#64748b", fontSize: "11px", fontWeight: 600 } },
        axisBorder: { show: false },
      },
      yaxis: {
        labels: { style: { colors: "#64748b", fontSize: "11px" } },
        min: trend.vals.length ? Math.floor(tMin - 1) : undefined,
        max: trend.vals.length ? Math.ceil(tMax + 1) : undefined,
      },
      grid: { borderColor: "rgba(148, 163, 184, 0.2)", strokeDashArray: 4 },
      tooltip: {
        theme: "light",
        y: { formatter: function (val) {
          return val != null ? String(val).replace(".", ",") : "";
        } },
      },
    });
    apexTrend.render();
  } else {
    elTrend.innerHTML =
      '<div class="dk2-chart-empty">Trend için en az bir ExamResults kaydı gerekir.</div>';
  }

  var radarData = docs.length ? radarFromLatestDoc(docs[0]) : { hasData: false };
  var rVals = [
    radarData.matematik != null ? Math.round(radarData.matematik * 100) / 100 : 0,
    radarData.turkce != null ? Math.round(radarData.turkce * 100) / 100 : 0,
    radarData.fen != null ? Math.round(radarData.fen * 100) / 100 : 0,
    radarData.sosyal != null ? Math.round(radarData.sosyal * 100) / 100 : 0,
  ];
  var radarHas =
    radarData.hasData &&
    (radarData.matematik != null ||
      radarData.turkce != null ||
      radarData.fen != null ||
      radarData.sosyal != null);

  if (radarHas) {
    var mx = Math.max.apply(null, rVals.concat([5]));
    mx = Math.ceil(mx * 1.15 * 10) / 10;
    apexRadar = new ApexChartsCtor(elRadar, {
      chart: { type: "radar", height: 320, fontFamily: "Plus Jakarta Sans, Inter, system-ui, sans-serif", toolbar: { show: false } },
      series: [{ name: "Ders neti (son deneme)", data: rVals }],
      colors: ["#6C5CE7"],
      fill: { opacity: 0.35, colors: ["#6C5CE7"] },
      stroke: { width: 2, colors: ["#6C5CE7"] },
      markers: { size: 4, hover: { size: 6 } },
      xaxis: {
        categories: ["Matematik", "Türkçe", "Fen", "Sosyal"],
        labels: { style: { colors: "#475569", fontSize: "12px", fontWeight: 600 } },
      },
      yaxis: {
        show: true,
        min: 0,
        max: mx,
        tickAmount: 5,
        labels: {
          style: { colors: "#94a3b8", fontSize: "10px" },
          formatter: function (v) {
            return String(v).replace(".", ",");
          },
        },
      },
      plotOptions: {
        radar: {
          polygons: {
            strokeColors: "rgba(108, 92, 231, 0.25)",
            fill: { colors: ["rgba(250, 245, 255, 0.6)", "rgba(255,255,255,0.9)"] },
          },
        },
      },
      tooltip: {
        y: {
          formatter: function (val) {
            return "Net: " + String(val).replace(".", ",");
          },
        },
      },
    });
    apexRadar.render();
  } else {
    elRadar.innerHTML =
      '<div class="dk2-chart-empty dk2-chart-empty--tall">Son denemede ders neti (perLesson) bulunamadı.</div>';
  }

  var agg = aggregateTopicRows(docs);
  renderTopicTable(elTable, agg, showToast, docs);

  if (typeof opt.onTopicsForTelafi === "function") {
    var tel = agg.map(function (r) {
      var pct = r.successPct != null ? r.successPct : r.legacyOnlyWrong ? 30 : 50;
      var br = danaKarneV2LessonToRadarBranch(r.lessonName) || "matematik";
      return {
        pct: pct,
        topicName: r.topicName,
        shortLabel: r.topicName,
        fullLabel: r.lessonName + " → " + r.topicName,
        branch: br,
        unit: "TYT",
      };
    });
    opt.onTopicsForTelafi(tel);
  }

  return {
    trendVals: trend.vals,
    trendLabels: trend.labels,
    agg: agg,
    radar: radarData,
  };
}
