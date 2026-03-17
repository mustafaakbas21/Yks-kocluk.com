/**
 * YKS Koçluk — Panel (Firestore + tüm butonlar)
 * Menüye özellik eklemek için: window.YKSPanel.onNavigate(fn) veya data-nav ile navigate
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

(function () {
  var el = document.getElementById("appointmentsRow");
  if (el) el.dataset.panelOk = "1";
})();

const firebaseConfig = {
  apiKey: "AIzaSyD3RUiCIlcysC6S7TFMbChD8h0cfHeroP8",
  authDomain: "yks-kocluk-8f7c6.firebaseapp.com",
  projectId: "yks-kocluk-8f7c6",
  storageBucket: "yks-kocluk-8f7c6.firebasestorage.app",
  messagingSenderId: "928738467961",
  appId: "1:928738467961:web:7e023f5b8f0ae3637874a8",
  measurementId: "G-GGYN4VBFPR",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

let firestoreUnsubs = [];
let cachedAppointments = [];
let cachedExams = [];
let cachedStudents = [];
let apptCarouselOffset = 0;
let examTypeFilter = "all";
let examsPageFilter = "all";
let searchQuery = "";
const navigateCallbacks = [];

let currentView = "dashboard";

function clearFirestoreListeners() {
  firestoreUnsubs.forEach(function (unsub) {
    try {
      unsub();
    } catch (e) {}
  });
  firestoreUnsubs = [];
}

function escapeHtml(text) {
  if (text == null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value.toDate === "function") return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
    const parts = value.split(/[./]/);
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
  }
  return null;
}

function appointmentSortTime(data) {
  const d = toDate(data.scheduledAt) || toDate(data.date);
  if (d && data.time && typeof data.time === "string") {
    const m = data.time.match(/(\d{1,2})[.:](\d{2})/);
    if (m) d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  }
  return d ? d.getTime() : 0;
}

function formatAppointmentMeta(data) {
  const d = toDate(data.scheduledAt) || toDate(data.date);
  const timeStr =
    data.time ||
    (d && !isNaN(d.getTime())
      ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
      : "");
  if (d && !isNaN(d.getTime())) {
    return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) + (timeStr ? " · " + timeStr : "");
  }
  return (data.date || "") + (data.time ? " · " + data.time : "") || "Tarih belirtilmedi";
}

function buildAppointmentList(docs) {
  return docs
    .map(function (docSnap) {
      return { ...docSnap.data(), id: docSnap.id };
    })
    .sort(function (a, b) {
      return appointmentSortTime(a) - appointmentSortTime(b);
    })
    .filter(function (x) {
      const t = appointmentSortTime(x);
      return t >= Date.now() - 86400000 || t === 0;
    });
}

function appointmentCardHtml(ap) {
  const name = ap.studentName || ap.ogrenciAdi || ap.name || "Öğrenci";
  const title = ap.title || ap.type || ap.note || "Randevu";
  return (
    '<article class="appt-card">' +
    '<div class="appt-card__icon"><i class="fa-solid fa-bell"></i></div>' +
    '<div class="appt-card__body">' +
    '<p class="appt-card__meta">' +
    escapeHtml(formatAppointmentMeta(ap)) +
    "</p>" +
    '<h3 class="appt-card__student">' +
    escapeHtml(name) +
    "</h3>" +
    '<p class="appt-card__type">' +
    escapeHtml(title) +
    "</p></div>" +
    '<button type="button" class="appt-card__more appt-card__menu-btn" data-appt-id="' +
    escapeHtml(ap.id) +
    '" aria-label="Randevu seçenekleri"><i class="fa-solid fa-ellipsis-vertical"></i></button></article>'
  );
}

function filterApptsBySearch(list) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return list;
  return list.filter(function (ap) {
    const name = (ap.studentName || ap.ogrenciAdi || ap.name || "") + " " + (ap.title || ap.type || "");
    return name.toLowerCase().indexOf(q) !== -1;
  });
}

function renderDashboardAppointments() {
  const row = document.getElementById("appointmentsRow");
  if (!row) return;
  const filtered = filterApptsBySearch(cachedAppointments);
  const n = filtered.length;
  if (apptCarouselOffset >= n) apptCarouselOffset = Math.max(0, n - 3);
  if (apptCarouselOffset < 0) apptCarouselOffset = 0;
  const top = filtered.slice(apptCarouselOffset, apptCarouselOffset + 3);

  if (top.length === 0) {
    row.innerHTML =
      '<p class="empty-hint"><i class="fa-solid fa-calendar-xmark"></i> Randevu yok veya aramanızla eşleşmedi.</p>';
  } else {
    row.innerHTML = top.map(appointmentCardHtml).join("");
  }
  const prev = document.getElementById("btnApptPrev");
  const next = document.getElementById("btnApptNext");
  if (prev) prev.disabled = apptCarouselOffset <= 0;
  if (next) next.disabled = apptCarouselOffset + 3 >= filtered.length;
}

function examDateSort(data) {
  const d = toDate(data.examDate) || toDate(data.date) || toDate(data.createdAt);
  return d ? d.getTime() : 0;
}

function examMatchesFilters(row) {
  const tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
  if (examTypeFilter === "TYT" && tur !== "TYT") return false;
  if (examTypeFilter === "AYT" && tur !== "AYT") return false;
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    const blob =
      (row.studentName || row.ogrenciAdi || row.name || "") +
      " " +
      tur +
      " " +
      (row.status || row.durum || "");
    if (blob.toLowerCase().indexOf(q) === -1) return false;
  }
  return true;
}

function examRowHtml(row, colspan) {
  const ogrenci = row.studentName || row.ogrenciAdi || row.name || "—";
  const tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
  const badgeClass = tur === "TYT" ? "badge-tyt" : "badge-ayt";
  const net = row.net != null ? String(row.net) : "—";
  const d = toDate(row.examDate) || toDate(row.date);
  const tarih = d && !isNaN(d.getTime()) ? d.toLocaleDateString("tr-TR") : String(row.date || "—");
  const durum = row.status || row.durum || "—";
  const isOk = /tamamlandı|rapor|hazır/i.test(durum) || row.analyzed === true;
  const statusHtml = isOk
    ? '<span class="status-ok"><i class="fa-solid fa-circle-check"></i> ' + escapeHtml(durum) + "</span>"
    : escapeHtml(durum);
  const c = colspan || 5;
  return (
    "<tr data-exam-id=\"" +
    escapeHtml(row.id) +
    "\"><td><strong>" +
    escapeHtml(ogrenci) +
    "</strong></td><td><span class=\"" +
    badgeClass +
    "\">" +
    escapeHtml(tur === "AYT" ? "AYT" : "TYT") +
    "</span></td><td>" +
    escapeHtml(net) +
    " net</td><td>" +
    escapeHtml(tarih) +
    "</td><td>" +
    statusHtml +
    ' <button type="button" class="btn-detail" data-id="' +
    escapeHtml(row.id) +
    '">Detay</button></td></tr>'
  );
}

function renderDashboardExams() {
  const tbody = document.getElementById("denemeTableBody");
  if (!tbody) return;
  const plain = cachedExams.slice().sort(function (a, b) {
    return examDateSort(b) - examDateSort(a);
  });
  const filtered = plain.filter(examMatchesFilters);
  const slice = filtered.slice(0, 15);
  if (slice.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="table-empty">Kayıt yok veya filtreye uymuyor.</td></tr>';
    return;
  }
  tbody.innerHTML = slice.map(function (row) {
    return examRowHtml(row, 5);
  }).join("");
}

function renderExamsFullPage() {
  const tbody = document.getElementById("examsPageBody");
  if (!tbody) return;
  const plain = cachedExams.slice().sort(function (a, b) {
    return examDateSort(b) - examDateSort(a);
  });
  let filtered = plain;
  if (examsPageFilter === "TYT") filtered = plain.filter(function (r) {
    return (r.examType || r.type || r.tur || "TYT").toUpperCase() === "TYT";
  });
  else if (examsPageFilter === "AYT") filtered = plain.filter(function (r) {
    return (r.examType || r.type || r.tur || "").toUpperCase() === "AYT";
  });
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Deneme kaydı yok.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map(function (row) {
      const ogrenci = row.studentName || row.ogrenciAdi || row.name || "—";
      const tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
      const badgeClass = tur === "TYT" ? "badge-tyt" : "badge-ayt";
      const net = row.net != null ? String(row.net) : "—";
      const d = toDate(row.examDate) || toDate(row.date);
      const tarih = d && !isNaN(d.getTime()) ? d.toLocaleDateString("tr-TR") : "—";
      const durum = row.status || row.durum || "—";
      return (
        "<tr><td><strong>" +
        escapeHtml(ogrenci) +
        "</strong></td><td><span class=\"" +
        badgeClass +
        "\">" +
        escapeHtml(tur) +
        "</span></td><td>" +
        escapeHtml(net) +
        "</td><td>" +
        escapeHtml(tarih) +
        "</td><td>" +
        escapeHtml(durum) +
        "</td><td><button type=\"button\" class=\"btn-detail\" data-id=\"" +
        escapeHtml(row.id) +
        "\">Detay</button></td></tr>"
      );
    })
    .join("");
}

function renderStudentsPage() {
  const grid = document.getElementById("studentsPageGrid");
  if (!grid) return;
  if (cachedStudents.length === 0) {
    grid.innerHTML = '<p class="page-desc">Henüz öğrenci yok. <strong>Yeni Öğrenci</strong> ile ekleyin.</p>';
    return;
  }
  grid.innerHTML = cachedStudents
    .map(function (s) {
      const name = s.name || s.studentName || "Öğrenci";
      const seed = s.avatarSeed || name;
      const img = "https://api.dicebear.com/7.x/avataaars/svg?seed=" + encodeURIComponent(String(seed));
      const track = s.track || s.paket || "TYT + AYT";
      return (
        '<div class="student-card">' +
        '<img src="' +
        img +
        '" alt="" width="64" height="64" />' +
        "<h3>" +
        escapeHtml(name) +
        "</h3>" +
        "<p>" +
        escapeHtml(track) +
        '</p><button type="button" class="btn btn--xs btn--outline student-open-btn" data-student-id="' +
        escapeHtml(s.id) +
        '">Detay</button></div>'
      );
    })
    .join("");
}

function renderAppointmentsPage() {
  const row = document.getElementById("appointmentsPageRow");
  if (!row) return;
  const list = cachedAppointments;
  if (list.length === 0) {
    row.innerHTML = '<p class="empty-hint">Randevu kaydı yok.</p>';
    return;
  }
  row.innerHTML = list.map(appointmentCardHtml).join("");
}

const WEEK_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];

function renderAppointmentDensityChart(docs) {
  const container = document.getElementById("barChart");
  if (!container) return;
  const counts = [0, 0, 0, 0, 0, 0, 0];
  const now = new Date();
  const weekStart = new Date(now);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  docs.forEach(function (docSnap) {
    const ap = docSnap.data();
    const t = appointmentSortTime(ap);
    if (!t) return;
    const dt = new Date(t);
    if (dt < weekStart || dt > weekStart.getTime() + 7 * 86400000 * 2) return;
    const diff = Math.floor((dt - weekStart) / 86400000);
    if (diff >= 0 && diff < 7) counts[diff]++;
  });
  const max = Math.max.apply(null, counts.concat([1]));
  container.innerHTML = WEEK_LABELS.map(function (label, i) {
    const pct = Math.round((counts[i] / max) * 100);
    return (
      '<div class="bar-chart__col">' +
      '<div class="bar-chart__bar" style="height:0%" data-h="' +
      pct +
      '%"></div>' +
      '<span class="bar-chart__label">' +
      escapeHtml(label) +
      "</span></div>"
    );
  }).join("");
  requestAnimationFrame(function () {
    container.querySelectorAll(".bar-chart__bar").forEach(function (bar) {
      bar.style.height = bar.getAttribute("data-h");
    });
  });
}

function renderStudentsList(docs) {
  const list = document.getElementById("activeStudentsList");
  const countEl = document.getElementById("activeStudentCount");
  if (countEl) countEl.textContent = String(cachedStudents.length);
  if (!list) return;
  const top = docs.slice(0, 5);
  if (top.length === 0) {
    list.innerHTML = '<li class="mini-list__empty">Öğrenci yok.</li>';
    return;
  }
  list.innerHTML = top
    .map(function (docSnap) {
      const s = docSnap.data ? docSnap.data() : docSnap;
      const name = s.name || s.studentName || "Öğrenci";
      const seed = s.avatarSeed || name;
      const img = "https://api.dicebear.com/7.x/avataaars/svg?seed=" + encodeURIComponent(String(seed));
      const track = s.track || s.paket || "TYT + AYT";
      return (
        "<li><img src=\"" +
        img +
        '" alt="" width="36" height="36" loading="lazy" /><div class="mini-list__info"><div class="mini-list__name">' +
        escapeHtml(name) +
        '</div><div class="mini-list__role">' +
        escapeHtml(track) +
        '</div></div><span class="mini-follow mini-follow--static">Aktif</span></li>'
      );
    })
    .join("");
}

function updateCoachProfile() {
  const greet = document.querySelector(".profile-card__greet");
  if (greet) {
    const h = new Date().getHours();
    const part = h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
    greet.innerHTML = part + ", <strong>Koç</strong>";
  }
}

function firestoreErrorHtml(err) {
  const code = err && err.code ? String(err.code) : "";
  if (code === "permission-denied")
    return "<strong>Erişim reddedildi.</strong> Firestore Rules kontrol edin.";
  return escapeHtml((err && err.message) || code || "Hata");
}

function onAppointmentsSnap(snap) {
  cachedAppointments = buildAppointmentList(snap.docs);
  apptCarouselOffset = 0;
  renderDashboardAppointments();
  renderAppointmentDensityChart(snap.docs);
  renderAppointmentsPage();
}

function onExamsSnap(snap) {
  cachedExams = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderDashboardExams();
  renderExamsFullPage();
}

function onStudentsSnap(snap) {
  cachedStudents = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderStudentsList(snap.docs);
  renderStudentsPage();
  fillStudentSelects();
}

/** ERP öğrenci formu — koc-panel.html 3 sütun */
var STUDENT_FORM_FIELDS = [
  "name",
  "phone",
  "email",
  "yksAlan",
  "targetUniversityDepartment",
  "currentTytNet",
  "targetTytNet",
  "parentName",
  "parentPhone",
  "monthlyCoachingFee",
  "installmentDay",
];

function fillStudentSelects() {
  ["ap_student", "pay_student", "ex_student"].forEach(function (sid) {
    var sel = document.getElementById(sid);
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML =
      sid === "ap_student"
        ? '<option value="">— Öğrenci seçin —</option>'
        : '<option value="">— Seçin —</option>';
    cachedStudents.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name || s.studentName || "Öğrenci (" + s.id.slice(0, 6) + ")";
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  });
}

/** Tek seferde yalnızca bir modal açık — HTML id'leri ile eşleşir */
var MODAL_IDS = ["studentModal", "appointmentModal", "testModal", "financeModal", "examModal"];

function closeAllModals() {
  var o = document.getElementById("modalOverlay");
  if (!o) return;
  MODAL_IDS.forEach(function (id) {
    var m = document.getElementById(id);
    if (m) m.hidden = true;
  });
  o.classList.remove("is-open");
  o.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

/** Sadece bu modalı kapat; başka açık modal yoksa overlay'i de kapatır */
function closeModal(modalId) {
  var m = document.getElementById(modalId);
  var o = document.getElementById("modalOverlay");
  if (!m || !o) return;
  m.hidden = true;
  var anyStillOpen = MODAL_IDS.some(function (id) {
    var el = document.getElementById(id);
    return el && !el.hidden;
  });
  if (!anyStillOpen) {
    o.classList.remove("is-open");
    o.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
}

function openModal(modalId) {
  closeAllModals();
  var o = document.getElementById("modalOverlay");
  var m = document.getElementById(modalId);
  if (!o || !m) return;
  m.hidden = false;
  o.classList.add("is-open");
  o.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function openStudentModal(editId) {
  var form = document.getElementById("formStudent");
  if (!form) return;
  form.reset();
  document.getElementById("studentEditId").value = editId || "";
  var sub = document.getElementById("modalStudentSubtitle");
  var title = document.getElementById("modalStudentTitle");
  if (editId) {
    var s = cachedStudents.find(function (x) {
      return x.id === editId;
    });
    if (sub) sub.textContent = "Kayıt güncelleniyor. Öğrenci ID: " + editId.slice(0, 8) + "…";
    if (title) title.innerHTML = '<i class="fa-solid fa-user-pen"></i> Öğrenci düzenle';
    if (s) {
      STUDENT_FORM_FIELDS.forEach(function (key) {
        var el = form.elements[key];
        var val = s[key];
        if (key === "targetUniversityDepartment" && (val == null || val === ""))
          val = s.targetDepartment || "";
        if (el && val != null && val !== "") el.value = String(val);
      });
    }
  } else {
    if (sub) sub.textContent = "Kişisel · akademik · veli & muhasebe bilgilerini girin.";
    if (title) title.innerHTML = '<i class="fa-solid fa-id-card"></i> Yeni öğrenci kaydı';
  }
  openModal("studentModal");
}

async function submitStudentForm(e) {
  e.preventDefault();
  var form = e.target;
  var editId = (document.getElementById("studentEditId") || {}).value || "";
  var fd = new FormData(form);
  var data = {};
  fd.forEach(function (val, key) {
    if (key === "editId") return;
    if (val !== "" && val != null) data[key] = typeof val === "string" ? val.trim() : val;
  });
  if (!data.name) {
    showToast("Ad Soyad zorunludur.");
    return;
  }
  if (!data.phone) {
    showToast("Öğrenci telefonu zorunludur.");
    return;
  }
  if (data.monthlyCoachingFee !== undefined && data.monthlyCoachingFee !== "") {
    var fee = parseFloat(String(data.monthlyCoachingFee).replace(",", "."), 10);
    data.monthlyCoachingFee = isNaN(fee) ? data.monthlyCoachingFee : fee;
  }
  if (data.installmentDay !== undefined && data.installmentDay !== "") {
    var day = parseInt(data.installmentDay, 10);
    if (!isNaN(day)) data.installmentDay = Math.min(31, Math.max(1, day));
  }
  if (!editId) {
    data.track = data.track || "TYT + AYT";
    data.status = data.status || "Aktif";
  }
  try {
    if (editId) {
      data.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "students", editId), data);
      showToast("Öğrenci başarıyla güncellendi.");
    } else {
      data.createdAt = serverTimestamp();
      await addDoc(collection(db, "students"), data);
      showToast("Öğrenci başarıyla eklendi.");
    }
    closeAllModals();
  } catch (err) {
    console.error(err);
    alert("Kayıt hatası: " + (err.message || err));
  }
}

async function submitAppointmentForm(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  var sid = fd.get("studentId");
  var st = cachedStudents.find(function (x) {
    return x.id === sid;
  });
  if (!st) {
    showToast("Öğrenci seçin.");
    return;
  }
  var d = fd.get("appointmentDate");
  var t = fd.get("appointmentTime");
  try {
    var combined = new Date(d + "T" + t);
    await addDoc(collection(db, "appointments"), {
      studentId: sid,
      studentName: st.name || st.studentName || "",
      scheduledAt: Timestamp.fromDate(combined),
      date: d,
      time: t,
      durationMin: parseInt(fd.get("durationMin"), 10) || 45,
      meetingType: fd.get("meetingType") || "",
      topic: fd.get("topic") || "",
      internalNotes: fd.get("internalNotes") || "",
      locationOrLink: fd.get("locationOrLink") || "",
      createdAt: serverTimestamp(),
    });
    showToast("Randevu kaydedildi.");
    closeAllModals();
    e.target.reset();
  } catch (err) {
    console.error(err);
    alert(err.message || err);
  }
}

function getTestMakerPayload() {
  var ders = document.getElementById("tm_ders");
  var konu = document.getElementById("tm_konu");
  var zorluk = document.getElementById("tm_zorluk");
  var soru = document.getElementById("tm_soru");
  var baslik = document.getElementById("tm_testAd");
  var layout = document.querySelector('input[name="tm_layout"]:checked');
  var font = document.querySelector('input[name="tm_font"]:checked');
  var theme = document.querySelector('input[name="tm_theme"]:checked');
  return {
    title: (baslik && baslik.value.trim()) || "Adsız test taslağı",
    subject: ders ? ders.value : "",
    topic: konu ? konu.value.trim() : "",
    difficulty: zorluk ? zorluk.value : "Orta",
    questionCount: soru ? parseInt(soru.value, 10) || 40 : 40,
    layout: layout ? layout.value : "yks_cift_sutun",
    layoutLabel:
      layout && layout.value === "yks_cift_sutun"
        ? "YKS Orijinal (Çift Sütun)"
        : layout && layout.value === "tek_sutun_bank"
          ? "Soru Bankası (Tek Sütun)"
          : "Kurumsal Deneme (Kapaklı)",
    fontFamily: font ? font.value : "Times New Roman",
    colorTheme: theme ? theme.value : "matbaa_bw",
    colorThemeLabel:
      theme && theme.value === "matbaa_bw"
        ? "Siyah-Beyaz (Matbaa)"
        : theme && theme.value === "kurumsal_mor"
          ? "Kurumsal (Mavi/Mor)"
          : "Renkli (Soru Bankası)",
  };
}

function initTestMakerTabs() {
  var root = document.getElementById("testMakerRoot");
  if (!root) return;
  root.querySelectorAll(".tm-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var n = tab.getAttribute("data-tm-tab");
      root.querySelectorAll(".tm-tab").forEach(function (t) {
        t.classList.toggle("is-active", t.getAttribute("data-tm-tab") === n);
        t.setAttribute("aria-selected", t.getAttribute("data-tm-tab") === n ? "true" : "false");
      });
      root.querySelectorAll(".tm-panel").forEach(function (p, i) {
        var on = p.id === "tmPanel" + n;
        p.classList.toggle("is-active", on);
        p.hidden = !on;
      });
    });
  });
}

function resetTestMakerModal() {
  var root = document.getElementById("testMakerRoot");
  if (!root) return;
  var first = root.querySelector('.tm-tab[data-tm-tab="1"]');
  if (first) first.click();
}

async function onPdfTaslakClick() {
  var payload = getTestMakerPayload();
  console.log("[TestMaker] PDF taslağı seçimleri:", JSON.stringify(payload, null, 2));
  try {
    await addDoc(collection(db, "tests"), {
      ...payload,
      module: "TestMakerPro",
      pdfDraft: true,
      status: "Taslak",
      createdAt: serverTimestamp(),
    });
    showToast("Test taslağı kaydedildi — PDF için veriler konsolda.");
    closeAllModals();
  } catch (err) {
    console.error(err);
    showToast("Kayıt hatası: " + (err.message || err));
  }
}

async function submitPaymentForm(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  var sid = fd.get("studentId");
  var st = cachedStudents.find(function (x) {
    return x.id === sid;
  });
  if (!st) {
    showToast("Öğrenci seçin.");
    return;
  }
  try {
    await addDoc(collection(db, "payments"), {
      studentId: sid,
      studentName: st.name || st.studentName || "",
      amount: parseFloat(fd.get("amount")) || 0,
      paymentDate: fd.get("paymentDate") || new Date().toISOString().slice(0, 10),
      paymentMethod: fd.get("paymentMethod") || "",
      description: fd.get("description") || "",
      invoiceNote: fd.get("invoiceNote") || "",
      createdAt: serverTimestamp(),
    });
    showToast("Tahsilat kaydedildi (payments).");
    closeAllModals();
    e.target.reset();
  } catch (err) {
    console.error(err);
    alert(err.message || err);
  }
}

async function submitExamForm(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  var sid = fd.get("studentId");
  var st = cachedStudents.find(function (x) {
    return x.id === sid;
  });
  if (!st) {
    showToast("Öğrenci seçin.");
    return;
  }
  var exD = fd.get("examDate");
  var examDateTs = null;
  if (exD) examDateTs = Timestamp.fromDate(new Date(exD));
  try {
    await addDoc(collection(db, "exams"), {
      studentId: sid,
      studentName: st.name || st.studentName || "",
      examType: fd.get("examType"),
      tur: fd.get("examType"),
      net: fd.get("net"),
      examDate: examDateTs,
      date: exD || "",
      examName: fd.get("examName") || "",
      subjectBreakdown: fd.get("subjectBreakdown") || "",
      status: fd.get("status") || "Kayıt girildi",
      coachExamNote: fd.get("coachExamNote") || "",
      createdAt: serverTimestamp(),
    });
    showToast("Deneme kaydı eklendi.");
    closeAllModals();
    e.target.reset();
  } catch (err) {
    console.error(err);
    alert(err.message || err);
  }
}

function initModals() {
  var overlay = document.getElementById("modalOverlay");
  if (!overlay) return;
  overlay.addEventListener("click", function (ev) {
    var closeBtn = ev.target.closest && ev.target.closest("[data-close-modal]");
    if (closeBtn && overlay.contains(closeBtn)) {
      var modalHost = closeBtn.closest(".modal");
      if (modalHost && modalHost.id) {
        ev.preventDefault();
        closeModal(modalHost.id);
        return;
      }
    }
    if (ev.target === overlay) closeAllModals();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeAllModals();
  });
  var fs = document.getElementById("formStudent");
  if (fs) fs.addEventListener("submit", submitStudentForm);
  var fa = document.getElementById("formAppointment");
  if (fa) fa.addEventListener("submit", submitAppointmentForm);
  initTestMakerTabs();
  var btnPdf = document.getElementById("btnPdfTaslak");
  if (btnPdf) btnPdf.addEventListener("click", onPdfTaslakClick);
  var fp = document.getElementById("formPayment");
  if (fp) fp.addEventListener("submit", submitPaymentForm);
  var fe = document.getElementById("formExam");
  if (fe) fe.addEventListener("submit", submitExamForm);
}

function subscribeFirestore() {
  clearFirestoreListeners();
  firestoreUnsubs.push(
    onSnapshot(
      collection(db, "appointments"),
      onAppointmentsSnap,
      function (err) {
        console.error(err);
        const row = document.getElementById("appointmentsRow");
        if (row) row.innerHTML = '<p class="empty-hint empty-hint--error">' + firestoreErrorHtml(err) + "</p>";
      }
    )
  );
  firestoreUnsubs.push(
    onSnapshot(
      collection(db, "exams"),
      onExamsSnap,
      function (err) {
        const tbody = document.getElementById("denemeTableBody");
        if (tbody)
          tbody.innerHTML =
            '<tr><td colspan="5" class="table-empty table-empty--error">' + firestoreErrorHtml(err) + "</td></tr>";
      }
    )
  );
  firestoreUnsubs.push(
    onSnapshot(
      collection(db, "students"),
      onStudentsSnap,
      function (err) {
        const list = document.getElementById("activeStudentsList");
        if (list) list.innerHTML = "<li class='mini-list__empty'>" + firestoreErrorHtml(err) + "</li>";
      }
    )
  );
}

function showToast(msg) {
  const t = document.getElementById("panelToast");
  if (!t) {
    alert(msg);
    return;
  }
  t.textContent = msg;
  t.hidden = false;
  t.classList.add("toast--show");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(function () {
    t.classList.remove("toast--show");
    t.hidden = true;
  }, 2800);
}

function navigateTo(view) {
  if (!view) return;
  var previous = currentView;
  currentView = view;
  document.querySelectorAll(".main-view").forEach(function (el) {
    const v = el.getAttribute("data-view");
    const on = v === view;
    el.classList.toggle("is-active", on);
    el.hidden = !on;
  });
  document.querySelectorAll("button.sidebar__link[data-nav]").forEach(function (btn) {
    btn.classList.toggle("sidebar__link--active", btn.getAttribute("data-nav") === view);
  });
  var brand = document.querySelector(".sidebar__brand-btn");
  if (brand) brand.classList.toggle("sidebar__brand-btn--active", view === "dashboard");
  navigateCallbacks.forEach(function (fn) {
    try {
      fn(view, { previous: previous });
    } catch (e) {
      console.error(e);
    }
  });
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar && overlay && window.innerWidth <= 992) {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  if (view === "denemeler") renderExamsFullPage();
  if (view === "ogrenciler") renderStudentsPage();
  if (view === "randevu") renderAppointmentsPage();
  window.dispatchEvent(new CustomEvent("yks:navigate", { detail: { view: view } }));
}

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const toggle = document.getElementById("menuToggle");
  const close = document.getElementById("sidebarClose");

  function open() {
    sidebar.classList.add("is-open");
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }
  function shut() {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  if (toggle) toggle.addEventListener("click", open);
  if (close) close.addEventListener("click", shut);
  if (overlay) overlay.addEventListener("click", shut);
  window.addEventListener("resize", function () {
    if (window.innerWidth > 992) shut();
  });
}

function initNavigation() {
  document.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function () {
      navigateTo(el.getAttribute("data-nav"));
    });
  });
}

function cycleExamFilter() {
  if (examTypeFilter === "all") examTypeFilter = "TYT";
  else if (examTypeFilter === "TYT") examTypeFilter = "AYT";
  else examTypeFilter = "all";
  const labels = { all: "Tümü", TYT: "TYT", AYT: "AYT" };
  const lab = document.getElementById("searchFilterLabel");
  if (lab) {
    lab.hidden = examTypeFilter === "all";
    lab.textContent = "Deneme: " + labels[examTypeFilter];
  }
  showToast("Liste filtresi: " + labels[examTypeFilter]);
  renderDashboardExams();
  apptCarouselOffset = 0;
  renderDashboardAppointments();
}

function cycleExamsPageFilter() {
  if (examsPageFilter === "all") examsPageFilter = "TYT";
  else if (examsPageFilter === "TYT") examsPageFilter = "AYT";
  else examsPageFilter = "all";
  const labels = { all: "Tümü", TYT: "TYT", AYT: "AYT" };
  const btn = document.getElementById("btnExamsFilter");
  if (btn) btn.innerHTML = '<i class="fa-solid fa-filter"></i> Filtre: ' + labels[examsPageFilter];
  renderExamsFullPage();
  showToast("Sayfa filtresi: " + labels[examsPageFilter]);
}

function initAllButtons() {
  function openApptModal() {
    fillStudentSelects();
    var d = document.getElementById("ap_date");
    if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
    openModal("appointmentModal");
  }
  function openPayModal() {
    fillStudentSelects();
    var d = document.getElementById("pay_date");
    if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
    openModal("financeModal");
  }

  var elNewSt = document.getElementById("btnNewStudent");
  if (elNewSt)
    elNewSt.addEventListener("click", function () {
      openStudentModal(null);
    });
  var elQuickSt = document.getElementById("quickAddStudent");
  if (elQuickSt)
    elQuickSt.addEventListener("click", function () {
      openStudentModal(null);
    });
  var elPageSt = document.getElementById("btnPageAddStudent");
  if (elPageSt)
    elPageSt.addEventListener("click", function () {
      openStudentModal(null);
    });

  document.getElementById("btnApptPrev") &&
    document.getElementById("btnApptPrev").addEventListener("click", function () {
      apptCarouselOffset = Math.max(0, apptCarouselOffset - 1);
      renderDashboardAppointments();
    });
  document.getElementById("btnApptNext") &&
    document.getElementById("btnApptNext").addEventListener("click", function () {
      apptCarouselOffset += 1;
      renderDashboardAppointments();
    });

  var searchEl = document.getElementById("searchInput");
  if (searchEl) {
    var debounce;
    searchEl.addEventListener("input", function () {
      searchQuery = searchEl.value || "";
      apptCarouselOffset = 0;
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        renderDashboardExams();
        renderDashboardAppointments();
      }, 200);
    });
  }
  document.getElementById("btnSearchFilter") &&
    document.getElementById("btnSearchFilter").addEventListener("click", cycleExamFilter);

  document.getElementById("btnSeeAllExams") &&
    document.getElementById("btnSeeAllExams").addEventListener("click", function () {
      navigateTo("denemeler");
    });
  document.getElementById("btnExamsFilter") &&
    document.getElementById("btnExamsFilter").addEventListener("click", cycleExamsPageFilter);
  document.getElementById("btnAddExamRecord") &&
    document.getElementById("btnAddExamRecord").addEventListener("click", function () {
      fillStudentSelects();
      var ed = document.getElementById("ex_date");
      if (ed && !ed.value) ed.value = new Date().toISOString().slice(0, 10);
      openModal("examModal");
    });

  var elQuickAppt = document.getElementById("quickRandevu");
  if (elQuickAppt) elQuickAppt.addEventListener("click", openApptModal);
  var elQuickTest = document.getElementById("quickTest");
  if (elQuickTest)
    elQuickTest.addEventListener("click", function () {
      resetTestMakerModal();
      openModal("testModal");
    });
  var elAllSt = document.getElementById("btnAllStudents");
  if (elAllSt)
    elAllSt.addEventListener("click", function () {
      navigateTo("ogrenciler");
    });

  var elNewAppt = document.getElementById("btnNewAppointment");
  if (elNewAppt) elNewAppt.addEventListener("click", openApptModal);
  var elCreateTest = document.getElementById("btnCreateTest");
  if (elCreateTest)
    elCreateTest.addEventListener("click", function () {
      resetTestMakerModal();
      openModal("testModal");
    });
  document.getElementById("btnTestBank") &&
    document.getElementById("btnTestBank").addEventListener("click", function () {
      showToast("Soru bankası: sorular Firestore’da ayrı koleksiyonda tutulacak (sonraki adım).");
    });
  document.getElementById("btnTestPublish") &&
    document.getElementById("btnTestPublish").addEventListener("click", function () {
      navigateTo("testmaker");
      showToast("Yayınlı testler — tests koleksiyonunda status ≠ Taslak kayıtlar listelenecek.");
    });

  document.getElementById("btnNewPayment") &&
    document.getElementById("btnNewPayment").addEventListener("click", openPayModal);
  document.getElementById("btnStatIncome") &&
    document.getElementById("btnStatIncome").addEventListener("click", function () {
      showToast("Aylık tahsilat raporu yakında.");
    });
  document.getElementById("btnStatPending") &&
    document.getElementById("btnStatPending").addEventListener("click", function () {
      showToast("Bekleyen ödemeler listesi yakında.");
    });

  document.getElementById("btnProfileMenu") &&
    document.getElementById("btnProfileMenu").addEventListener("click", function () {
      showToast("Profil menüsü — ayarlar yakında.");
    });
  document.getElementById("btnNotify") &&
    document.getElementById("btnNotify").addEventListener("click", function () {
      showToast("Bildirimler yakında.");
    });
  document.getElementById("btnProfileSettings") &&
    document.getElementById("btnProfileSettings").addEventListener("click", function () {
      showToast("Ayarlar yakında.");
    });
  document.getElementById("btnMessages") &&
    document.getElementById("btnMessages").addEventListener("click", function () {
      showToast("Mesajlar yakında.");
    });

  document.getElementById("btnLogout") &&
    document.getElementById("btnLogout").addEventListener("click", function (e) {
      e.preventDefault();
      if (confirm("Çıkış yapılsın mı?")) {
        window.location.href = "index.html";
      }
    });

  document.addEventListener("click", function (e) {
    const det = e.target.closest(".btn-detail");
    if (det && det.dataset.id) {
      e.preventDefault();
      showToast("Deneme detayı (ID: " + det.dataset.id + ")");
    }
    const apptMenu = e.target.closest(".appt-card__menu-btn");
    if (apptMenu && apptMenu.dataset.apptId) {
      e.preventDefault();
      showToast("Randevu seçenekleri — ID: " + apptMenu.dataset.apptId);
    }
    const st = e.target.closest(".student-open-btn");
    if (st && st.dataset.studentId) {
      e.preventDefault();
      openStudentModal(st.dataset.studentId);
    }
  });
}

window.YKSPanel = {
  navigate: navigateTo,
  getView: function () {
    return currentView;
  },
  onNavigate: function (fn) {
    if (typeof fn === "function") navigateCallbacks.push(fn);
  },
  toast: showToast,
  openStudentForm: openStudentModal,
  openAppointmentForm: function () {
    fillStudentSelects();
    openModal("appointmentModal");
  },
  closeModals: closeAllModals,
  closeModal: closeModal,
};

function showLoadTimeoutWarning() {
  const row = document.getElementById("appointmentsRow");
  const tbody = document.getElementById("denemeTableBody");
  if (row && row.querySelector(".empty-hint--loading")) {
    row.innerHTML =
      '<p class="empty-hint empty-hint--error">Sayfayı <code>http://</code> ile açın (Live Server).</p>';
  }
  if (tbody && /Yükleniyor/i.test(tbody.textContent || "")) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="table-empty table-empty--error">HTTP ile açın.</td></tr>';
  }
}

initSidebar();
initNavigation();
initModals();
initAllButtons();
updateCoachProfile();
subscribeFirestore();
navigateTo("dashboard");
setTimeout(showLoadTimeoutWarning, 12000);
