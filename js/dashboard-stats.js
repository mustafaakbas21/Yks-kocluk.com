/**
 * Dashboard — KPI kartları, YKS geri sayım, performans özeti metni
 */

const DEFAULT_YKS_EXAM = Object.freeze({
  year: 2026,
  monthIndex: 5,
  day: 20,
  hour: 10,
  minute: 15,
});

function resolveCountdownTargetMs() {
  try {
    var raw = localStorage.getItem("yks_dashboard_exam_target_iso");
    if (raw) {
      var d = new Date(raw);
      if (!isNaN(d.getTime())) return d.getTime();
    }
  } catch (_e) {}
  var c = DEFAULT_YKS_EXAM;
  return new Date(c.year, c.monthIndex, c.day, c.hour, c.minute, 0).getTime();
}

export function initDashboardYksCountdownWidget() {
  var root = document.getElementById("yks-countdown-widget");
  if (!root || root.getAttribute("data-yks-widget-init") === "1") return;
  root.setAttribute("data-yks-widget-init", "1");
  var targetMs = resolveCountdownTargetMs();
  var elD = document.getElementById("yks-widget-days");
  var elH = document.getElementById("yks-widget-hours");
  var elM = document.getElementById("yks-widget-minutes");
  var elS = document.getElementById("yks-widget-seconds");
  function pulseEl(el) {
    if (!el) return;
    el.classList.remove("is-tick");
    void el.offsetWidth;
    el.classList.add("is-tick");
  }
  function setAnim(el, nextStr) {
    if (!el) return;
    if (el.textContent !== String(nextStr)) {
      el.textContent = String(nextStr);
      pulseEl(el);
    }
  }
  function tick() {
    var diff = targetMs - Date.now();
    if (diff <= 0) {
      setAnim(elD, "0");
      setAnim(elH, "00");
      setAnim(elM, "00");
      setAnim(elS, "00");
      return;
    }
    var totalSec = Math.floor(diff / 1000);
    var days = Math.floor(totalSec / 86400);
    totalSec %= 86400;
    var h = Math.floor(totalSec / 3600);
    totalSec %= 3600;
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    setAnim(elD, String(days));
    setAnim(elH, String(h).padStart(2, "0"));
    setAnim(elM, String(m).padStart(2, "0"));
    setAnim(elS, String(s).padStart(2, "0"));
  }
  tick();
  setInterval(tick, 1000);
}

/** KPI satırında iskelet / yükleniyor görünümü */
export function setDashboardKpisLoading(loading) {
  var row = document.querySelector(".dashboard-kpi-row");
  if (!row) return;
  row.classList.toggle("dashboard-kpi-row--loading", !!loading);
  row.setAttribute("aria-busy", loading ? "true" : "false");
}

const KPI_HIST_KEY = "dp_dashboard_kpi_hist_v1";

function parseExamTimeMs(v) {
  if (v == null || v === "") return null;
  if (typeof v === "object" && typeof v.toDate === "function") {
    var d0 = v.toDate();
    return d0 && !isNaN(d0.getTime()) ? d0.getTime() : null;
  }
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.getTime();
  if (typeof v === "string") {
    var d1 = new Date(v);
    return isNaN(d1.getTime()) ? null : d1.getTime();
  }
  return null;
}

function startOfWeekMondayMs(d) {
  var x = new Date(d);
  var day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

function thisCalendarWeekRangeMs() {
  var start = startOfWeekMondayMs(new Date());
  return { start: start, end: start + 7 * 86400000 };
}

function prevCalendarWeekRangeMs() {
  var tw = thisCalendarWeekRangeMs();
  return { start: tw.start - 7 * 86400000, end: tw.start };
}

function appointmentCountBetween(appointments, sortTimeFn, startMs, endMs) {
  if (typeof sortTimeFn !== "function") return 0;
  var n = 0;
  (appointments || []).forEach(function (ap) {
    var t = sortTimeFn(ap);
    if (!t || typeof t !== "number") return;
    if (t >= startMs && t < endMs) n++;
  });
  return n;
}

function examAggBetween(exams, startMs, endMs) {
      var count = 0;
      var tytSum = 0;
      var tytN = 0;
  (exams || []).forEach(function (ex) {
        var t =
          parseExamTimeMs(ex.examDate) ||
          parseExamTimeMs(ex.date) ||
          parseExamTimeMs(ex.$createdAt);
        if (t == null) return;
        if (t < startMs || t >= endMs) return;
        count++;
        var typ = String(ex.examType || ex.tur || ex.type || "")
          .toUpperCase()
          .trim();
        if (typ.indexOf("TYT") !== 0 && typ !== "TYT") return;
        var net = parseFloat(String(ex.net != null ? ex.net : "").replace(",", "."), 10);
        if (!isNaN(net)) {
          tytSum += net;
          tytN++;
        }
      });
  return { count: count, avgTyt: tytN > 0 ? tytSum / tytN : null };
}

function recordAndGetKpiHistory(activeStudents) {
  try {
    var now = Date.now();
    var arr = JSON.parse(localStorage.getItem(KPI_HIST_KEY) || "[]");
    if (!Array.isArray(arr)) arr = [];
    var dayKey = new Date().toDateString();
    var last = arr[arr.length - 1];
    if (!last || last.day !== dayKey || last.active !== activeStudents) {
      arr.push({ t: now, active: activeStudents, day: dayKey });
    }
    arr = arr.filter(function (x) {
      return x && now - x.t < 45 * 86400000;
    });
    localStorage.setItem(KPI_HIST_KEY, JSON.stringify(arr));
    return arr;
  } catch (_e) {
    return [];
  }
}

function nearestHistoryActive(history, targetMs, maxDeltaMs) {
  var best = null;
  (history || []).forEach(function (x) {
    if (!x || typeof x.active !== "number") return;
    var d = Math.abs(x.t - targetMs);
    if (d <= maxDeltaMs && (!best || d < best.d)) best = { v: x.active, d: d };
  });
  return best ? best.v : null;
}

/**
 * @returns {{ html: string, className: string }}
 */
function formatWeekOverWeekPct(cur, prev, opts) {
  var inv = !!(opts && opts.invertColors);
  if (prev == null || isNaN(prev)) {
    return { html: '<span class="dashboard-kpi-trend__muted">Önceki hafta veri yok</span>', className: "" };
  }
  if (prev === 0 && cur === 0) {
    return { html: '<span class="dashboard-kpi-trend__muted">Değişim yok</span>', className: "" };
  }
  if (prev === 0) {
    return {
      html:
        '<i class="fa-solid fa-arrow-trend-up" aria-hidden="true"></i> Yeni dönem verisi',
      className: inv ? "dashboard-kpi-trend dashboard-kpi-trend--down" : "dashboard-kpi-trend dashboard-kpi-trend--up",
    };
  }
  var p = ((cur - prev) / prev) * 100;
  var up = p >= 0;
  var good = inv ? !up : up;
  var icon = up ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
  var cls = good ? "dashboard-kpi-trend dashboard-kpi-trend--up" : "dashboard-kpi-trend dashboard-kpi-trend--down";
  return {
    html:
      '<i class="fa-solid ' +
      icon +
      '" aria-hidden="true"></i> Önceki haftaya göre <strong>' +
      (up ? "+" : "−") +
      Math.abs(p).toFixed(1) +
      "%</strong>",
    className: cls,
  };
}

function formatWeekOverWeekAbs(cur, prev, unit) {
  if (prev == null || isNaN(prev)) {
    return { html: '<span class="dashboard-kpi-trend__muted">Önceki hafta veri yok</span>', className: "" };
  }
  var diff = cur - prev;
  if (Math.abs(diff) < (unit === "net" ? 0.05 : 0.5)) {
    return { html: '<span class="dashboard-kpi-trend__muted">Önceki haftaya göre stabil</span>', className: "" };
  }
  var up = diff > 0;
  var icon = up ? "fa-arrow-trend-up" : "fa-arrow-trend-down";
  var cls =
    unit === "net"
      ? up
        ? "dashboard-kpi-trend dashboard-kpi-trend--up"
        : "dashboard-kpi-trend dashboard-kpi-trend--down"
      : up
        ? "dashboard-kpi-trend dashboard-kpi-trend--up"
        : "dashboard-kpi-trend dashboard-kpi-trend--down";
  var u = unit === "net" ? " net" : "";
  var magStr = unit === "net" ? Math.abs(diff).toFixed(1) : String(Math.round(Math.abs(diff)));
  return {
    html:
      '<i class="fa-solid ' +
      icon +
      '" aria-hidden="true"></i> Önceki haftaya göre <strong>' +
      (up ? "+" : "−") +
      magStr +
      u +
      "</strong>",
    className: cls,
  };
}

function setKpiTrendElement(idSuffix, formatted) {
  var el = document.getElementById("kpiTrend" + idSuffix);
  if (!el) return;
  el.className = "dashboard-kpi-card__trend " + (formatted.className || "");
  el.innerHTML = formatted.html;
}

export function computeAvgNetAchievementPct(students) {
  var pcts = [];
  (students || []).forEach(function (s) {
    var cur = parseFloat(String(s.currentTytNet != null ? s.currentTytNet : "").replace(",", "."), 10);
    var tgt = parseFloat(String(s.targetTytNet != null ? s.targetTytNet : "").replace(",", "."), 10);
    if (isNaN(cur) || isNaN(tgt) || tgt <= 0) return;
    pcts.push(Math.min(100, Math.round((cur / tgt) * 100)));
  });
  if (pcts.length === 0) return null;
  return Math.round(
    pcts.reduce(function (a, b) {
      return a + b;
    }, 0) / pcts.length
  );
}

function renderDashboardInsightText(students, exams, weekApptCount, examTotalCount, weekExamCount) {
  var insight = document.getElementById("dashboardInsightText");
  if (!insight) return;
  var pct = computeAvgNetAchievementPct(students);
  var parts = [];
  if (pct != null)
    parts.push(
      "Öğrenci kayıtlarına göre ortalama <strong>%" +
        pct +
        "</strong> hedef net düzeyine yaklaşım görülüyor."
    );
  else
    parts.push(
      "Net hedef grafiği için öğrencilerde <strong>güncel net</strong> ve <strong>hedef net</strong> alanlarını doldurun."
    );
  var wEx =
    weekExamCount != null ? weekExamCount : 0;
  parts.push(
    " Bu hafta <strong>" +
      weekApptCount +
      "</strong> randevu ve <strong>" +
      wEx +
      "</strong> yeni deneme; kurumda toplam <strong>" +
      examTotalCount +
      "</strong> deneme kaydı var."
  );
  insight.innerHTML = parts.join("");
}

function parseKpiNumber(el) {
  var t = el && el.textContent != null ? String(el.textContent).trim() : "";
  if (!t || t === "—") return null;
  var v = parseFloat(t.replace(",", "."), 10);
  return isNaN(v) ? null : v;
}

function tweenKpiValue(el, fromNum, toNum, decimals, durationMs) {
  if (!el) return;
  var d = durationMs != null ? durationMs : 420;
  var start = typeof performance !== "undefined" ? performance.now() : Date.now();
  function easeOut(t) {
    return t * (2 - t);
  }
  function frame(now) {
    var t = Math.min(1, (now - start) / d);
    var v = fromNum + (toNum - fromNum) * easeOut(t);
    el.textContent = decimals > 0 ? v.toFixed(decimals) : String(Math.round(v));
    if (t < 1) requestAnimationFrame(frame);
    else el.textContent = decimals > 0 ? toNum.toFixed(decimals) : String(Math.round(toNum));
  }
  requestAnimationFrame(frame);
}

function setKpiTextAnimated(el, nextStr, kind) {
  if (!el) return;
  var next = String(nextStr);
  var prevRaw = el.getAttribute("data-kpi-last");
  if (prevRaw == null || prevRaw === "") {
    el.textContent = next;
    el.setAttribute("data-kpi-last", next);
    return;
  }
  el.setAttribute("data-kpi-last", next);
  if (prevRaw === next) {
    el.textContent = next;
    return;
  }
  if (kind === "dash") {
    el.textContent = next;
    return;
  }
  var prevNum = parseFloat(String(prevRaw).replace(",", "."), 10);
  var nextNum = parseFloat(next.replace(",", "."), 10);
  if (isNaN(prevNum) || isNaN(nextNum)) {
    el.textContent = next;
    return;
  }
  var dec = kind === "avg" ? 1 : 0;
  tweenKpiValue(el, prevNum, nextNum, dec, 480);
}

/**
 * @param {{
 *   getStudents: () => unknown[],
 *   getExams: () => unknown[],
 *   countWeekAppointments: () => number,
 *   getAppointments?: () => unknown[],
 *   appointmentSortTime?: (ap: unknown) => number
 * }} deps
 * @param {{ animate?: boolean } | undefined} opts
 */
export function renderDashboardKpis(deps, opts) {
  var elS = document.getElementById("kpiActiveStudents");
  var elA = document.getElementById("kpiWeekAppointments");
  var elN = document.getElementById("kpiAvgTytNet");
  var elE = document.getElementById("kpiExamCount");
  if (!elS || !elA || !elN || !elE) return;
  var animate = !!(opts && opts.animate === true);
  var students = deps.getStudents();
  var exams = deps.getExams();
  var appointments = deps.getAppointments ? deps.getAppointments() : [];
  var sortAp = deps.appointmentSortTime;
  var tw = thisCalendarWeekRangeMs();
  var pw = prevCalendarWeekRangeMs();
  var active = (students || []).filter(function (s) {
    return (s.status || "Aktif") !== "Pasif";
  }).length;
  if (animate) {
    setKpiTextAnimated(elS, String(active), "int");
    setKpiTextAnimated(elA, String(deps.countWeekAppointments()), "int");
  } else {
    elS.textContent = String(active);
    elA.textContent = String(deps.countWeekAppointments());
    elS.setAttribute("data-kpi-last", String(active));
    elA.setAttribute("data-kpi-last", String(deps.countWeekAppointments()));
  }
  var exThis = examAggBetween(exams, tw.start, tw.end);
  var exPrev = examAggBetween(exams, pw.start, pw.end);

  var tytExams = (exams || []).filter(function (e) {
    var x = String(e.examType || e.type || e.tur || "")
      .toUpperCase()
      .trim();
    return x === "TYT" || x.indexOf("TYT") === 0;
  });
  var sum = 0;
  var c = 0;
  tytExams.forEach(function (e) {
    if (e.net == null || e.net === "") return;
    var v = parseFloat(String(e.net).replace(",", "."), 10);
    if (!isNaN(v)) {
      sum += v;
      c++;
    }
  });
  if (c === 0) {
    (students || []).forEach(function (s) {
      if (s.currentTytNet == null || s.currentTytNet === "") return;
      var v = parseFloat(String(s.currentTytNet).replace(",", "."), 10);
      if (!isNaN(v)) {
        sum += v;
        c++;
      }
    });
  }
  var nextNet;
  var nextNetNum;
  if (exThis.avgTyt != null) {
    nextNetNum = exThis.avgTyt;
    nextNet = nextNetNum.toFixed(1);
  } else {
    nextNet = c > 0 ? (sum / c).toFixed(1) : "—";
    nextNetNum = c > 0 ? sum / c : null;
  }
  if (animate) {
    if (nextNet === "—") {
      setKpiTextAnimated(elN, "—", "dash");
    } else {
      setKpiTextAnimated(elN, nextNet, "avg");
    }
    setKpiTextAnimated(elE, String(exThis.count), "int");
  } else {
    elN.textContent = nextNet;
    elE.textContent = String(exThis.count);
    elN.setAttribute("data-kpi-last", nextNet);
    elE.setAttribute("data-kpi-last", String(exThis.count));
  }

  var hist = recordAndGetKpiHistory(active);
  var prevActive = nearestHistoryActive(hist, Date.now() - 7 * 86400000, 80 * 3600000);
  var apThis = appointmentCountBetween(appointments, sortAp, tw.start, tw.end);
  var apPrev = appointmentCountBetween(appointments, sortAp, pw.start, pw.end);

  var curWeekApptCount =
    typeof deps.countWeekAppointments === "function" ? deps.countWeekAppointments() : apThis;

  var f1 = formatWeekOverWeekPct(active, prevActive, { invertColors: false });
  setKpiTrendElement("Students", f1);

  var f2 = formatWeekOverWeekPct(apThis, apPrev, { invertColors: false });
  setKpiTrendElement("Appts", f2);

  if (exThis.avgTyt != null && exPrev.avgTyt != null) {
    setKpiTrendElement("Net", formatWeekOverWeekAbs(exThis.avgTyt, exPrev.avgTyt, "net"));
  } else if (exThis.avgTyt != null) {
    setKpiTrendElement("Net", {
      html: '<span class="dashboard-kpi-trend__muted">Önceki hafta TYT denemesi yok — kıyas yok</span>',
      className: "",
    });
  } else if (nextNetNum != null) {
    setKpiTrendElement("Net", {
      html: '<span class="dashboard-kpi-trend__muted">Bu hafta TYT yok; kurum ortalaması gösteriliyor</span>',
      className: "",
    });
  } else {
    setKpiTrendElement("Net", {
      html: '<span class="dashboard-kpi-trend__muted">TYT net verisi girilmedi</span>',
      className: "",
    });
  }

  var f4 = formatWeekOverWeekPct(exThis.count, exPrev.count, { invertColors: false });
  setKpiTrendElement("Exams", f4);

  renderDashboardInsightText(
    students,
    exams,
    curWeekApptCount,
    (exams || []).length,
    exThis.count
  );
}
