/**
 * Dashboard — görüşme logları + deneme sonuçlarından son aktiviteler akışı
 */

import {
  meetingLogEventDate,
  parseDocDateAny,
  prepareMeetingChartLoadingState,
  setDashboardMeetingLogsCache,
} from "./dashboard-charts.js";

let _actDeps = {
  db: null,
  getCoachId: null,
  getStudents: null,
  collection: null,
  query: null,
  where: null,
  getDocs: null,
  escapeHtml: null,
  APPWRITE_COLLECTION_MEETING_LOGS: "",
  APPWRITE_COLLECTION_EXAM_RESULTS: "",
};

export function configureDashboardActivities(d) {
  _actDeps = { ..._actDeps, ...d };
}

function formatRelativeTimeTr(date) {
  if (!date || isNaN(date.getTime())) return "—";
  var sec = Math.floor((Date.now() - date.getTime()) / 1000);
  if (sec < 45) return "Az önce";
  if (sec < 3600) return Math.floor(sec / 60) + " dakika önce";
  if (sec < 86400) return Math.floor(sec / 3600) + " saat önce";
  if (sec < 604800) return Math.floor(sec / 86400) + " gün önce";
  if (sec < 2592000) return Math.floor(sec / 604800) + " hafta önce";
  if (sec < 31536000) return Math.floor(sec / 2592000) + " ay önce";
  return Math.floor(sec / 31536000) + " yıl önce";
}

function studentDisplayNameById(studentId, students) {
  var sid = String(studentId || "").trim();
  if (!sid) return "Öğrenci";
  var st = (students || []).find(function (s) {
    return String(s.id) === sid;
  });
  if (st) return String(st.name || st.studentName || "Öğrenci").trim() || "Öğrenci";
  return "Öğrenci";
}

export function renderDashboardActivityFeed(meetingRows, examRows, students) {
  var ul = document.getElementById("dashboardActivityFeed");
  var emptyP = document.getElementById("dashboardActivityEmpty");
  var esc = _actDeps.escapeHtml || function (s) {
    return String(s || "");
  };
  if (!ul) return;
  var items = [];
  (meetingRows || []).forEach(function (row) {
    var t = parseDocDateAny(row.ts);
    if (!t) return;
    items.push({
      type: "meeting",
      ts: t,
      text:
        "<strong>" +
        esc(row.studentName || "Öğrenci") +
        "</strong> ile görüşme notu kaydedildi.",
      icon: "fa-clipboard-list",
    });
  });
  (students || []).forEach(function (s) {
    var t = parseDocDateAny(s.$createdAt);
    if (!t) return;
    var nm = String(s.name || s.studentName || "Öğrenci").trim() || "Öğrenci";
    items.push({
      type: "student",
      ts: t,
      text: "Yeni öğrenci eklendi: <strong>" + esc(nm) + "</strong>.",
      icon: "fa-user-plus",
    });
  });
  (examRows || []).forEach(function (ex) {
    var t = parseDocDateAny(ex.saved_at || ex.$createdAt);
    if (!t) return;
    var sn = studentDisplayNameById(ex.student_id, students);
    var en = String(ex.exam_name || "Deneme").trim() || "Deneme";
    items.push({
      type: "exam",
      ts: t,
      text:
        "<strong>" +
        esc(sn) +
        "</strong> için yeni deneme sonucu <strong>" +
        esc(en) +
        "</strong> kaydedildi.",
      icon: "fa-file-lines",
    });
  });
  items.sort(function (a, b) {
    return b.ts.getTime() - a.ts.getTime();
  });
  items = items.slice(0, 25);
  if (items.length === 0) {
    ul.innerHTML = "";
    if (emptyP) {
      emptyP.hidden = false;
      emptyP.textContent = "Henüz koçluk aktivitesi bulunmamaktadır.";
    }
    return;
  }
  if (emptyP) emptyP.hidden = true;
  ul.innerHTML = items
    .map(function (it) {
      return (
        '<li class="dash-activity-item">' +
        '<div class="dash-activity-item__icon' +
        (it.type === "exam" ? " dash-activity-item__icon--muted" : "") +
        '"><i class="fa-solid ' +
        it.icon +
        '" aria-hidden="true"></i></div>' +
        '<div class="dash-activity-item__body">' +
        '<p class="dash-activity-item__text">' +
        it.text +
        "</p>" +
        '<p class="dash-activity-item__time">' +
        esc(formatRelativeTimeTr(it.ts)) +
        "</p>" +
        "</div>" +
        "</li>"
      );
    })
    .join("");
}

export async function refreshDashboardMeetingActivity() {
  var cid = _actDeps.getCoachId && _actDeps.getCoachId();
  var canvas = document.getElementById("meetingAnalysisChart");
  var ul = document.getElementById("dashboardActivityFeed");
  if (!canvas) return;
  if (!cid) {
    setDashboardMeetingLogsCache([], { emptyMessage: "Koç oturumu bulunamadı. Görüşme grafiği için tekrar giriş yapın." });
    if (ul) ul.innerHTML = "";
    var emptyAct = document.getElementById("dashboardActivityEmpty");
    if (emptyAct) {
      emptyAct.hidden = false;
      emptyAct.textContent = "Aktiviteler için oturum gerekli.";
    }
    return;
  }
  prepareMeetingChartLoadingState();
  if (ul) {
    ul.innerHTML =
      '<li class="dash-activity-item dash-activity-item--loading" aria-busy="true"><div class="dash-activity-item__body"><p class="dash-activity-item__text">Aktiviteler yükleniyor…</p></div></li>';
  }
  try {
    var mSnap = await _actDeps.getDocs(
      _actDeps.query(
        _actDeps.collection(_actDeps.db, _actDeps.APPWRITE_COLLECTION_MEETING_LOGS),
        _actDeps.where("coach_id", "==", cid)
      )
    );
    var rawRows = mSnap.docs.map(function (d) {
      return typeof d.data === "function" ? d.data() : {};
    });
    setDashboardMeetingLogsCache(rawRows);
    var meetingForFeed = rawRows
      .map(function (raw) {
        return {
          ts: meetingLogEventDate(raw) || parseDocDateAny(raw.$createdAt),
          studentName: String(raw.student_name || "").trim() || "Öğrenci",
        };
      })
      .filter(function (row) {
        return row.ts != null;
      });
    var eSnap = await _actDeps.getDocs(
      _actDeps.query(
        _actDeps.collection(_actDeps.db, _actDeps.APPWRITE_COLLECTION_EXAM_RESULTS),
        _actDeps.where("coach_id", "==", cid)
      )
    );
    var examDocs = eSnap.docs.map(function (d) {
      return typeof d.data === "function" ? d.data() : {};
    });
    var students = (_actDeps.getStudents && _actDeps.getStudents()) || [];
    renderDashboardActivityFeed(meetingForFeed, examDocs, students);
  } catch (err) {
    console.warn("[dashboard meeting activity]", err);
    setDashboardMeetingLogsCache([], {
      emptyMessage: "Görüşme verileri yüklenemedi. Bağlantı veya Appwrite izinlerini kontrol edin.",
    });
    renderDashboardActivityFeed([], [], []);
  } finally {
    if (ul && /Aktiviteler yükleniyor/i.test(ul.textContent || "")) {
      ul.innerHTML =
        '<li class="dash-activity-item"><div class="dash-activity-item__body"><p class="dash-activity-item__text">Aktivite verisi alınamadı.</p></div></li>';
    }
  }
}
