/**
 * YKS Koçluk — Koç Paneli
 * Oturum: localStorage isLoggedIn (Firebase Auth kullanılmıyor)
 * Veri: Firestore (CDN) — aynen devam
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  serverTimestamp,
  Timestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

/* Firebase Auth devre dışı — eski oturum kontrolü (yorum):
import { getAuth, onAuthStateChanged, signOut } from "...firebase-auth.js";
onAuthStateChanged(auth, function (user) {
  if (!user) { window.location.href = "index.html"; return; }
  updateCoachProfile(user);
  subscribeFirestore();
});
*/

if (localStorage.getItem("isLoggedIn") !== "true") {
  window.location.replace("index.html");
} else {
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

const LOGIN_PATH = "index.html";

let firestoreUnsubs = [];

function clearFirestoreListeners() {
  firestoreUnsubs.forEach(function (unsub) {
    try {
      unsub();
    } catch (e) {
      /* ignore */
    }
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
      const dd = parseInt(parts[0], 10);
      const mm = parseInt(parts[1], 10) - 1;
      const yy = parseInt(parts[2], 10);
      return new Date(yy, mm, dd);
    }
  }
  return null;
}

function appointmentSortTime(data) {
  const d = toDate(data.scheduledAt) || toDate(data.date);
  if (d && data.time && typeof data.time === "string") {
    const m = data.time.match(/(\d{1,2})[.:](\d{2})/);
    if (m) {
      d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    }
  }
  return d ? d.getTime() : 0;
}

function formatAppointmentMeta(data) {
  const d = toDate(data.scheduledAt) || toDate(data.date);
  const timeStr =
    data.time ||
    (d && !isNaN(d.getTime())
      ? String(d.getHours()).padStart(2, "0") +
        ":" +
        String(d.getMinutes()).padStart(2, "0")
      : "");
  if (d && !isNaN(d.getTime())) {
    const opts = { day: "numeric", month: "long", year: "numeric" };
    return (
      d.toLocaleDateString("tr-TR", opts) + (timeStr ? " · " + timeStr : "")
    );
  }
  return (data.date || "") + (data.time ? " · " + data.time : "") || "Tarih belirtilmedi";
}

function renderAppointments(docs) {
  const row = document.getElementById("appointmentsRow");
  if (!row) return;

  const items = docs
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

  const top = items.slice(0, 3);

  if (top.length === 0) {
    row.innerHTML =
      '<p class="empty-hint"><i class="fa-solid fa-calendar-xmark"></i> Yaklaşan randevu yok. Firestore <code>appointments</code> koleksiyonuna kayıt ekleyin.</p>';
    return;
  }

  row.innerHTML = top
    .map(function (ap) {
      const name =
        ap.studentName || ap.ogrenciAdi || ap.name || "Öğrenci";
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
        "</p>" +
        "</div>" +
        '<button type="button" class="appt-card__more" aria-label="Menü"><i class="fa-solid fa-ellipsis-vertical"></i></button>' +
        "</article>"
      );
    })
    .join("");
}

function examDateSort(data) {
  const d = toDate(data.examDate) || toDate(data.date) || toDate(data.createdAt);
  return d ? d.getTime() : 0;
}

function renderExams(docs) {
  const tbody = document.getElementById("denemeTableBody");
  if (!tbody) return;

  const rows = docs
    .map(function (docSnap) {
      return { ...docSnap.data(), id: docSnap.id };
    })
    .sort(function (a, b) {
      return examDateSort(b) - examDateSort(a);
    })
    .slice(0, 15);

  if (rows.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="table-empty">Henüz deneme kaydı yok. <code>exams</code> koleksiyonuna veri ekleyin.</td></tr>';
    return;
  }

  tbody.innerHTML = rows
    .map(function (row) {
      const ogrenci =
        row.studentName || row.ogrenciAdi || row.name || "—";
      const tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
      const badgeClass = tur === "TYT" ? "badge-tyt" : "badge-ayt";
      const net = row.net != null ? String(row.net) : "—";
      const d = toDate(row.examDate) || toDate(row.date);
      const tarih =
        d && !isNaN(d.getTime())
          ? d.toLocaleDateString("tr-TR")
          : String(row.date || "—");
      const durum = row.status || row.durum || "—";
      const isOk =
        /tamamlandı|rapor|hazır/i.test(durum) || row.analyzed === true;
      const statusHtml = isOk
        ? '<span class="status-ok"><i class="fa-solid fa-circle-check"></i> ' +
          escapeHtml(durum) +
          "</span>"
        : escapeHtml(durum);

      return (
        "<tr data-exam-id=\"" +
        escapeHtml(row.id) +
        "\">" +
        "<td><strong>" +
        escapeHtml(ogrenci) +
        "</strong></td>" +
        '<td><span class="' +
        badgeClass +
        '">' +
        escapeHtml(tur === "AYT" ? "AYT" : "TYT") +
        "</span></td>" +
        "<td>" +
        escapeHtml(net) +
        " net</td>" +
        "<td>" +
        escapeHtml(tarih) +
        "</td>" +
        "<td>" +
        statusHtml +
        ' <button type="button" class="btn-detail" data-id="' +
        escapeHtml(row.id) +
        '">Detay</button></td>' +
        "</tr>"
      );
    })
    .join("");
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
      '%" title="' +
      counts[i] +
      ' randevu"></div>' +
      '<span class="bar-chart__label">' +
      escapeHtml(label) +
      "</span>" +
      "</div>"
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
  if (countEl) countEl.textContent = String(docs.length);

  if (!list) return;

  const top = docs.slice(0, 5);
  if (top.length === 0) {
    list.innerHTML =
      '<li class="mini-list__empty">Öğrenci yok. <code>students</code> koleksiyonuna ekleyin veya &quot;Yeni Öğrenci Ekle&quot; kullanın.</li>';
    return;
  }

  list.innerHTML = top
    .map(function (docSnap) {
      const s = docSnap.data();
      const name = s.name || s.studentName || "Öğrenci";
      const seed = s.avatarSeed || name;
      const img =
        "https://api.dicebear.com/7.x/avataaars/svg?seed=" +
        encodeURIComponent(String(seed));
      const track = s.track || s.paket || "TYT + AYT";
      return (
        "<li>" +
        '<img src="' +
        img +
        '" alt="" width="36" height="36" loading="lazy" />' +
        '<div class="mini-list__info">' +
        '<div class="mini-list__name">' +
        escapeHtml(name) +
        "</div>" +
        '<div class="mini-list__role">' +
        escapeHtml(track) +
        "</div>" +
        "</div>" +
        '<span class="mini-follow mini-follow--static">Aktif</span>' +
        "</li>"
      );
    })
    .join("");
}

function updateCoachProfile() {
  const greet = document.querySelector(".profile-card__greet");
  const role = localStorage.getItem("role") || "admin";
  const display = role === "admin" ? "Admin" : "Koç";
  if (greet) {
    const h = new Date().getHours();
    const part =
      h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
    greet.innerHTML =
      part + ", <strong>" + escapeHtml(display) + "</strong>";
  }
}

function subscribeFirestore() {
  clearFirestoreListeners();

  const apptCol = collection(db, "appointments");
  const unsubAppt = onSnapshot(
    apptCol,
    function (snap) {
      renderAppointments(snap.docs);
      renderAppointmentDensityChart(snap.docs);
    },
    function (err) {
      console.error("appointments", err);
      const row = document.getElementById("appointmentsRow");
      if (row)
        row.innerHTML =
          '<p class="empty-hint empty-hint--error">Randevular yüklenemedi. Firestore kuralları ve koleksiyon adını kontrol edin.</p>';
    }
  );
  firestoreUnsubs.push(unsubAppt);

  const examsCol = collection(db, "exams");
  const unsubExams = onSnapshot(
    examsCol,
    function (snap) {
      renderExams(snap.docs);
    },
    function (err) {
      console.error("exams", err);
      const tbody = document.getElementById("denemeTableBody");
      if (tbody)
        tbody.innerHTML =
          '<tr><td colspan="5" class="table-empty table-empty--error">Denemeler yüklenemedi.</td></tr>';
    }
  );
  firestoreUnsubs.push(unsubExams);

  const studentsCol = collection(db, "students");
  const unsubStudents = onSnapshot(
    studentsCol,
    function (snap) {
      renderStudentsList(snap.docs);
    },
    function (err) {
      console.error("students", err);
    }
  );
  firestoreUnsubs.push(unsubStudents);
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

function handleLogout(e) {
  if (e) e.preventDefault();
  clearFirestoreListeners();
  localStorage.removeItem("isLoggedIn");
  localStorage.removeItem("role");
  window.location.href = LOGIN_PATH;
}

async function handleNewStudent() {
  const name = window.prompt("Yeni öğrenci adı:");
  if (!name || !String(name).trim()) return;
  try {
    await addDoc(collection(db, "students"), {
      name: String(name).trim(),
      createdAt: serverTimestamp(),
      track: "TYT + AYT",
    });
  } catch (err) {
    console.error(err);
    alert(
      "Öğrenci eklenemedi. Firestore kurallarını kontrol edin (giriş artık Firebase Auth değil; kurallar request.auth gerektiriyorsa yazma reddedilir)."
    );
  }
}

document.addEventListener("click", function (e) {
  const btn = e.target.closest(".btn-detail");
  if (btn && btn.dataset.id) {
    e.preventDefault();
    alert("Deneme ID: " + btn.dataset.id + " (detay sayfası sonraki aşamada).");
  }
});

function bindNewStudentButtons() {
  const handler = function () {
    handleNewStudent();
  };
  const btnNew = document.getElementById("btnNewStudent");
  const quick = document.getElementById("quickAddStudent");
  if (btnNew) btnNew.addEventListener("click", handler);
  if (quick) quick.addEventListener("click", handler);
}
bindNewStudentButtons();

const btnLogout = document.getElementById("btnLogout");
if (btnLogout) btnLogout.addEventListener("click", handleLogout);

initSidebar();
updateCoachProfile();
subscribeFirestore();

} /* isLoggedIn */
