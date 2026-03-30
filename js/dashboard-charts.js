/**
 * Dashboard — Chart.js: randevu yoğunluğu, hedef net halka, görüşme analizi
 */

import { computeAvgNetAchievementPct } from "./dashboard-stats.js";

let _chartDeps = {
  coachQuery: null,
  getDocs: null,
  normalizeAppointmentDoc: null,
  appointmentSortTime: null,
};

export function configureDashboardCharts(deps) {
  _chartDeps = { ..._chartDeps, ...deps };
}

let randevuChartInstance = null;
let netBasariChartInstance = null;
let meetingAnalysisChartInstance = null;
let dashboardMeetingChartPeriod = "week";
let dashboardMeetingLogsCache = [];
let dashboardMeetingActivityBound = false;

export function setDashboardMeetingLogsCache(rows, opts) {
  dashboardMeetingLogsCache = Array.isArray(rows) ? rows : [];
  renderMeetingAnalysisChartFromCache(opts);
}

export function prepareMeetingChartLoadingState() {
  if (meetingAnalysisChartInstance) {
    meetingAnalysisChartInstance.destroy();
    meetingAnalysisChartInstance = null;
  }
  var canvas = document.getElementById("meetingAnalysisChart");
  var emptyEl = document.getElementById("meetingAnalysisChartEmpty");
  if (canvas) canvas.hidden = true;
  if (emptyEl) {
    emptyEl.hidden = false;
    emptyEl.textContent = "Yükleniyor…";
  }
}

export function parseDocDateAny(v) {
  if (v == null || v === "") return null;
  if (typeof v === "object" && typeof v.toDate === "function") {
    var d0 = v.toDate();
    return d0 && !isNaN(d0.getTime()) ? d0 : null;
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    var d1 = new Date(v);
    return isNaN(d1.getTime()) ? null : d1;
  }
  return null;
}

export function meetingLogEventDate(raw) {
  return (
    parseDocDateAny(raw.saved_at) ||
    parseDocDateAny(raw.date) ||
    parseDocDateAny(raw.$createdAt) ||
    null
  );
}

/** Bugünden başlayan 7 gün — grafik ekseni */
function buildRollingAppointmentChartAxis() {
  var start = new Date();
  start.setHours(0, 0, 0, 0);
  var startMs = start.getTime();
  function trTitle(s) {
    if (!s) return "";
    return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
  }
  function formatAxisLabel(d) {
    var dayNum = d.getDate();
    var monthStr = d.toLocaleDateString("tr-TR", { month: "long" });
    var wdStr = d.toLocaleDateString("tr-TR", { weekday: "long" });
    return dayNum + " " + trTitle(monthStr) + " " + trTitle(wdStr);
  }
  var labels = [];
  var longNames = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(startMs + i * 86400000);
    labels.push(formatAxisLabel(d));
    longNames.push(
      d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );
  }
  return { startMs: startMs, labels: labels, longNames: longNames };
}

function setRandevuChartChrome(opts) {
  var canvas = document.getElementById("randevuChart");
  var emptyEl = document.getElementById("randevuChartEmpty");
  var errEl = document.getElementById("randevuChartError");
  if (emptyEl) {
    emptyEl.hidden = !opts.showEmpty;
    if (opts.emptyMessage) emptyEl.textContent = opts.emptyMessage;
  }
  if (errEl) {
    errEl.hidden = !opts.showError;
    if (opts.errorMessage) errEl.textContent = opts.errorMessage;
  }
  if (canvas) {
    canvas.hidden = !!(opts.showEmpty || opts.showError);
  }
}

export async function fetchAndRenderAppointmentChart() {
  try {
    var qa = _chartDeps.coachQuery && _chartDeps.coachQuery("appointments");
    if (!qa) {
      setRandevuChartChrome({
        showEmpty: true,
        showError: false,
        emptyMessage: "Randevu koleksiyonu yüklenemedi.",
      });
      return;
    }
    var snap = await _chartDeps.getDocs(qa);
    renderAppointmentsChart(snap.docs);
  } catch (err) {
    console.error("[Chart] Randevu grafiği yenilenemedi:", err);
    if (randevuChartInstance) {
      randevuChartInstance.destroy();
      randevuChartInstance = null;
    }
    setRandevuChartChrome({
      showEmpty: false,
      showError: true,
      errorMessage: "Grafik yüklenirken hata oluştu. Bağlantıyı deneyin.",
    });
  }
}

export function renderAppointmentsChart(docs) {
  var canvas = document.getElementById("randevuChart");
  if (!canvas || typeof Chart === "undefined") return;
  var norm = _chartDeps.normalizeAppointmentDoc;
  var sortT = _chartDeps.appointmentSortTime;
  var roll = buildRollingAppointmentChartAxis();
  var labels = roll.labels;
  var longNames = roll.longNames;
  var counts = [0, 0, 0, 0, 0, 0, 0];
  (docs || []).forEach(function (docSnap) {
    var ap = norm ? norm(docSnap) : null;
    if (!ap) return;
    var t = sortT ? sortT(ap) : null;
    if (!t) return;
    var day = new Date(t);
    if (isNaN(day.getTime())) return;
    day.setHours(0, 0, 0, 0);
    var diff = Math.round((day.getTime() - roll.startMs) / 86400000);
    if (diff >= 0 && diff < 7) counts[diff]++;
  });
  var total = counts.reduce(function (a, b) {
    return a + b;
  }, 0);
  if (total === 0) {
    if (randevuChartInstance) {
      randevuChartInstance.destroy();
      randevuChartInstance = null;
    }
    setRandevuChartChrome({
      showEmpty: true,
      showError: false,
      emptyMessage: "Bu hafta kayıtlı randevu yok. Yoğunluk grafiği için randevu ekleyin.",
    });
    return;
  }
  setRandevuChartChrome({ showEmpty: false, showError: false });
  var ctx = canvas.getContext("2d");
  var maxCount = counts.reduce(function (a, b) {
    return Math.max(a, b);
  }, 0);
  if (randevuChartInstance) {
    randevuChartInstance.destroy();
    randevuChartInstance = null;
  }
  try {
    randevuChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Randevu",
            data: counts,
            backgroundColor: "rgba(124, 58, 237, 0.88)",
            hoverBackgroundColor: "rgba(109, 40, 217, 0.95)",
            borderRadius: 10,
            borderSkipped: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            callbacks: {
              title: function () {
                return "";
              },
              label: function (item) {
                var i = item.dataIndex;
                return (longNames[i] || labels[i]) + ": " + item.raw + " randevu";
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 10, weight: "600", family: "Inter, system-ui, sans-serif" },
              color: "#64748b",
              maxRotation: 48,
              minRotation: 0,
              autoSkip: false,
            },
          },
          y: {
            beginAtZero: true,
            suggestedMax: Math.max(4, maxCount + 1),
            ticks: {
              stepSize: 1,
              precision: 0,
              color: "#64748b",
              callback: function (val) {
                if (Number.isInteger(val)) return val;
              },
            },
            grid: { color: "rgba(124, 58, 237, 0.06)" },
          },
        },
      },
    });
  } catch (chartErr) {
    console.error("[Chart] Randevu grafiği:", chartErr);
    randevuChartInstance = null;
    setRandevuChartChrome({
      showEmpty: false,
      showError: true,
      errorMessage: "Grafik oluşturulamadı.",
    });
  }
}

export function renderNetBasariChart(getStudents) {
  var canvas = document.getElementById("netBasariChart");
  var pctEl = document.getElementById("netBasariPct");
  if (!canvas || typeof Chart === "undefined") return;
  var students = typeof getStudents === "function" ? getStudents() : [];
  var pct = computeAvgNetAchievementPct(students);
  if (netBasariChartInstance) {
    netBasariChartInstance.destroy();
    netBasariChartInstance = null;
  }
  if (pctEl) pctEl.textContent = pct != null ? pct + "%" : "—";
  var ctx = canvas.getContext("2d");
  if (pct == null) {
    netBasariChartInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [1],
            backgroundColor: ["#e2e8f0"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
    return;
  }
  var kalan = Math.max(0, 100 - pct);
  netBasariChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Hedefe ulaşma", "Kalan"],
      datasets: [
        {
          data: [pct, kalan],
          backgroundColor: ["#7c3aed", "#ede9fe"],
          borderWidth: 0,
          hoverBackgroundColor: ["#6d28d9", "#ddd6fe"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (item) {
              return item.label + ": %" + item.raw;
            },
          },
        },
      },
    },
  });
}

var DASH_WD_TR = ["Paz", "Pzt", "Sal", "Çar", "Per", "Cum", "Cmt"];
var DASH_MONTHS_TR = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];

function ymdKey(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function startOfDay(d) {
  var x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function aggregateMeetingsForChart(logs, period) {
  var now = new Date();
  var labels = [];
  var data = [];
  var i;
  var d;
  var counts;
  var key;
  if (period === "week") {
    counts = {};
    for (i = 6; i >= 0; i--) {
      d = new Date(now);
      d.setDate(d.getDate() - i);
      d = startOfDay(d);
      key = ymdKey(d);
      counts[key] = 0;
      labels.push(DASH_WD_TR[d.getDay()]);
    }
    (logs || []).forEach(function (raw) {
      var ev = meetingLogEventDate(raw);
      if (!ev) return;
      ev = startOfDay(ev);
      key = ymdKey(ev);
      if (Object.prototype.hasOwnProperty.call(counts, key)) counts[key]++;
    });
    labels = [];
    for (i = 6; i >= 0; i--) {
      d = new Date(now);
      d.setDate(d.getDate() - i);
      d = startOfDay(d);
      key = ymdKey(d);
      labels.push(DASH_WD_TR[d.getDay()]);
      data.push(counts[key] != null ? counts[key] : 0);
    }
    return { labels: labels, data: data };
  }
  if (period === "month") {
    var anchorM = startOfDay(now);
    var countsM = [0, 0, 0, 0];
    for (i = 0; i < 28; i++) {
      d = new Date(anchorM);
      d.setDate(d.getDate() - (27 - i));
      d = startOfDay(d);
      key = ymdKey(d);
      var bucket = Math.floor(i / 7);
      (logs || []).forEach(function (raw) {
        var ev = meetingLogEventDate(raw);
        if (!ev) return;
        ev = startOfDay(ev);
        if (ymdKey(ev) === key) countsM[bucket]++;
      });
    }
    labels = ["1. Hafta", "2. Hafta", "3. Hafta", "4. Hafta"];
    data = countsM;
    return { labels: labels, data: data };
  }
  labels = [];
  data = [];
  for (i = 11; i >= 0; i--) {
    d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    var ym = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
    labels.push(DASH_MONTHS_TR[d.getMonth()] + " " + String(d.getFullYear()).slice(-2));
    var cnt = 0;
    (logs || []).forEach(function (raw) {
      var ev = meetingLogEventDate(raw);
      if (!ev) return;
      var yk = ev.getFullYear() + "-" + String(ev.getMonth() + 1).padStart(2, "0");
      if (yk === ym) cnt++;
    });
    data.push(cnt);
  }
  return { labels: labels, data: data };
}

export function renderMeetingAnalysisChartFromCache(opts) {
  var canvas = document.getElementById("meetingAnalysisChart");
  var emptyEl = document.getElementById("meetingAnalysisChartEmpty");
  if (!canvas || typeof Chart === "undefined") return;
  var agg = aggregateMeetingsForChart(dashboardMeetingLogsCache, dashboardMeetingChartPeriod);
  var total = (agg.data || []).reduce(function (a, b) {
    return a + b;
  }, 0);
  if (meetingAnalysisChartInstance) {
    meetingAnalysisChartInstance.destroy();
    meetingAnalysisChartInstance = null;
  }
  if (total === 0) {
    canvas.hidden = true;
    if (emptyEl) {
      emptyEl.hidden = false;
      emptyEl.textContent =
        (opts && opts.emptyMessage) ||
        "Bu dönemde görüşme kaydı bulunmuyor.";
    }
    return;
  }
  canvas.hidden = false;
  if (emptyEl) emptyEl.hidden = true;
  var ctx = canvas.getContext("2d");
  meetingAnalysisChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: agg.labels,
      datasets: [
        {
          label: "Görüşme",
          data: agg.data,
          backgroundColor: "rgba(124, 58, 237, 0.85)",
          borderRadius: 8,
          borderSkipped: false,
          maxBarThickness: 36,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "#fff",
          titleColor: "#334155",
          bodyColor: "#475569",
          borderColor: "#e2e8f0",
          borderWidth: 1,
          padding: 10,
          callbacks: {
            label: function (item) {
              return "Görüşme: " + item.raw;
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: "#64748b", font: { weight: "600", size: 11 } },
        },
        y: {
          beginAtZero: true,
          suggestedMax: Math.max(4, Math.max.apply(null, (agg.data || []).concat([1])) + 1),
          ticks: {
            stepSize: 1,
            precision: 0,
            color: "#64748b",
            callback: function (val) {
              if (Number.isInteger(val)) return val;
            },
          },
          grid: { color: "rgba(124, 58, 237, 0.06)" },
        },
      },
    },
  });
}

export function initDashboardMeetingActivityToggles() {
  if (dashboardMeetingActivityBound) return;
  var host = document.querySelector(".dash-period-toggles");
  if (!host) return;
  dashboardMeetingActivityBound = true;
  host.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest ? e.target.closest("[data-meeting-period]") : null;
    if (!btn) return;
    var p = String(btn.getAttribute("data-meeting-period") || "").trim();
    if (p !== "week" && p !== "month" && p !== "year") return;
    dashboardMeetingChartPeriod = p;
    host.querySelectorAll("[data-meeting-period]").forEach(function (b) {
      var on = b === btn;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    });
    renderMeetingAnalysisChartFromCache();
  });
}
