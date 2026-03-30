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

function renderDashboardInsightText(students, exams, weekApptCount, examCount) {
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
  parts.push(
    " Bu hafta <strong>" +
      weekApptCount +
      "</strong> randevu; panelde <strong>" +
      examCount +
      "</strong> deneme kaydı."
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
 * @param {{ getStudents: () => unknown[], getExams: () => unknown[], countWeekAppointments: () => number }} deps
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
  var nextNet = c > 0 ? (sum / c).toFixed(1) : "—";
  if (animate) {
    if (nextNet === "—") {
      setKpiTextAnimated(elN, "—", "dash");
    } else {
      setKpiTextAnimated(elN, nextNet, "avg");
    }
    setKpiTextAnimated(elE, String((exams || []).length), "int");
  } else {
    elN.textContent = nextNet;
    elE.textContent = String((exams || []).length);
    elN.setAttribute("data-kpi-last", nextNet);
    elE.setAttribute("data-kpi-last", String((exams || []).length));
  }
  renderDashboardInsightText(students, exams, deps.countWeekAppointments(), (exams || []).length);
}
