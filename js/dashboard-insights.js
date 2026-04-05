/**
 * Dashboard — Insight Motoru: risk tablosu, düşüş / temas analizi
 */

import { parseDocDateAny, meetingLogEventDate } from "./dashboard-charts.js";

let _insightDeps = {
  getStudents: null,
  getExams: null,
  getAppointments: null,
  getMeetingLogs: null,
  openStudentDetail: null,
  escapeHtml: null,
};

export function configureDashboardInsights(d) {
  _insightDeps = { ..._insightDeps, ...d };
}

function esc(s) {
  var fn = _insightDeps.escapeHtml;
  return fn ? fn(s) : String(s || "");
}

function examTime(ex) {
  return (
    parseDocDateAny(ex.examDate) ||
    parseDocDateAny(ex.date) ||
    parseDocDateAny(ex.$createdAt) ||
    null
  );
}

function examTypeUpper(ex) {
  return String(ex.examType || ex.tur || ex.type || "")
    .toUpperCase()
    .trim();
}

function parseNet(ex) {
  var v = parseFloat(String(ex.net != null ? ex.net : "").replace(",", "."), 10);
  return isNaN(v) ? null : v;
}

function studentName(sid, students) {
  var id = String(sid || "").trim();
  var st = (students || []).find(function (s) {
    return String(s.id) === id;
  });
  if (!st) return "Öğrenci";
  return String(st.name || st.studentName || "Öğrenci").trim() || "Öğrenci";
}

function appointmentTouchMs(ap, sortTimeFn) {
  if (!ap || typeof sortTimeFn !== "function") return 0;
  var t = sortTimeFn(ap);
  return typeof t === "number" && t > 0 ? t : 0;
}

/**
 * Son temas: randevu, görüşme logu veya deneme kaydı (max tarih)
 */
function lastTouchMsForStudent(studentId, appointments, exams, meetingRows, sortTimeFn) {
  var sid = String(studentId || "").trim();
  var maxT = 0;
  (appointments || []).forEach(function (ap) {
    if (String(ap.studentId || ap.student_id || "") !== sid) return;
    var ms = appointmentTouchMs(ap, sortTimeFn);
    if (ms > maxT) maxT = ms;
  });
  (exams || []).forEach(function (ex) {
    if (String(ex.studentId || ex.student_id || "") !== sid) return;
    var d = examTime(ex);
    if (d && !isNaN(d.getTime())) maxT = Math.max(maxT, d.getTime());
  });
  (meetingRows || []).forEach(function (raw) {
    if (String(raw.student_id || raw.studentId || "") !== sid) return;
    var d = meetingLogEventDate(raw) || parseDocDateAny(raw.$createdAt);
    if (d && !isNaN(d.getTime())) maxT = Math.max(maxT, d.getTime());
  });
  return maxT;
}

function computeDecliningStudents(students, exams) {
  var byStudent = {};
  (exams || []).forEach(function (ex) {
    var sid = String(ex.studentId || ex.student_id || "").trim();
    if (!sid) return;
    var typ = examTypeUpper(ex);
    if (typ.indexOf("TYT") !== 0 && typ !== "TYT") return;
    var t = examTime(ex);
    if (!t) return;
    var net = parseNet(ex);
    if (net == null) return;
    if (!byStudent[sid]) byStudent[sid] = [];
    byStudent[sid].push({ t: t.getTime(), net: net, ex: ex });
  });
  var out = [];
  Object.keys(byStudent).forEach(function (sid) {
    var arr = byStudent[sid].sort(function (a, b) {
      return b.t - a.t;
    });
    if (arr.length < 2) return;
    var latest = arr[0];
    var prev = arr[1];
    var drop = prev.net - latest.net;
    if (drop > 0.5) {
      out.push({
        studentId: sid,
        name: studentName(sid, students),
        latestNet: latest.net,
        prevNet: prev.net,
        drop: drop,
      });
    }
  });
  out.sort(function (a, b) {
    return b.drop - a.drop;
  });
  return out.slice(0, 12);
}

function computeNeglectedStudents(students, appointments, exams, meetingRows, sortTimeFn, days) {
  var msLimit = days * 86400000;
  var now = Date.now();
  var out = [];
  (students || []).forEach(function (s) {
    if ((s.status || "Aktif") === "Pasif") return;
    var sid = String(s.id || "").trim();
    if (!sid) return;
    var last = lastTouchMsForStudent(sid, appointments, exams, meetingRows, sortTimeFn);
    if (last <= 0 || now - last > msLimit) {
      var daysAgo =
        last > 0 ? Math.floor((now - last) / 86400000) : null;
      out.push({
        studentId: sid,
        name: String(s.name || s.studentName || "Öğrenci").trim() || "Öğrenci",
        lastTouchMs: last,
        daysAgo: daysAgo,
      });
    }
  });
  out.sort(function (a, b) {
    var ta = a.lastTouchMs || 0;
    var tb = b.lastTouchMs || 0;
    return ta - tb;
  });
  return out.slice(0, 15);
}

export function renderDashboardInsightTable() {
  var host = document.getElementById("dashboardInsightPanels");
  if (!host) return;
  var gs = _insightDeps.getStudents && _insightDeps.getStudents();
  var ge = _insightDeps.getExams && _insightDeps.getExams();
  var ga = _insightDeps.getAppointments && _insightDeps.getAppointments();
  var gm = (_insightDeps.getMeetingLogs && _insightDeps.getMeetingLogs()) || [];
  var sortFn = _insightDeps.appointmentSortTime;
  var declining = computeDecliningStudents(gs, ge);
  var neglected = computeNeglectedStudents(gs, ga, ge, gm, sortFn, 7);

  var openFn = _insightDeps.openStudentDetail;
  function btnDetail(id) {
    var i = esc(id);
    return (
      '<button type="button" class="dashboard-insight-btn" data-insight-student="' +
      i +
      '"><i class="fa-solid fa-arrow-up-right-from-square"></i> Aç</button>'
    );
  }

  host.innerHTML =
    '<div class="dashboard-insight-grid">' +
    '<div class="dashboard-insight-card">' +
    '<h3 class="dashboard-insight-card__title"><i class="fa-solid fa-arrow-trend-down"></i> Düşüşte olan öğrenciler</h3>' +
    '<p class="dashboard-insight-card__sub">Son iki <strong>TYT</strong> denemesinde net düşen adaylar (ilk 12).</p>' +
    (declining.length === 0
      ? '<p class="dashboard-insight-empty">Şu an TYT düşüşü tespit edilmedi. Daha fazla deneme kaydı ekleyin.</p>'
      : '<div class="table-wrap dashboard-insight-table-wrap"><table class="data-table dashboard-insight-table"><thead><tr><th>Öğrenci</th><th>Son net</th><th>Önceki</th><th>Düşüş</th><th></th></tr></thead><tbody>' +
        declining
          .map(function (r) {
            return (
              "<tr><td>" +
              esc(r.name) +
              "</td><td>" +
              r.latestNet.toFixed(1) +
              "</td><td>" +
              r.prevNet.toFixed(1) +
              '</td><td><span class="dashboard-insight-badge dashboard-insight-badge--risk">-' +
              r.drop.toFixed(1) +
              "</span></td><td>" +
              btnDetail(r.studentId) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>") +
    "</div>" +
    '<div class="dashboard-insight-card">' +
    '<h3 class="dashboard-insight-card__title"><i class="fa-solid fa-user-clock"></i> Son 1 haftadır görüşülmeyenler</h3>' +
    '<p class="dashboard-insight-card__sub">Randevu, görüşme veya deneme aktivitesi <strong>7 günü</strong> aşan aktif öğrenciler.</p>' +
    (neglected.length === 0
      ? '<p class="dashboard-insight-empty">Tüm aktif öğrenciler son 7 günde en az bir temas kaydına sahip görünüyor.</p>'
      : '<div class="table-wrap dashboard-insight-table-wrap"><table class="data-table dashboard-insight-table"><thead><tr><th>Öğrenci</th><th>Son temas</th><th></th></tr></thead><tbody>' +
        neglected
          .map(function (r) {
            var touch =
              r.daysAgo == null
                ? "Hiç kayıt yok"
                : r.daysAgo === 0
                  ? "Bugün"
                  : r.daysAgo + " gün önce";
            return (
              "<tr><td>" +
              esc(r.name) +
              "</td><td>" +
              esc(touch) +
              "</td><td>" +
              btnDetail(r.studentId) +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>") +
    "</div>" +
    "</div>";

  if (typeof openFn !== "function") return;
  host.querySelectorAll("[data-insight-student]").forEach(function (b) {
    b.addEventListener("click", function () {
      var id = b.getAttribute("data-insight-student");
      if (id) openFn(id);
    });
  });
}
