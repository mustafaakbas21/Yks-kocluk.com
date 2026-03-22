/**
 * Kurucu paneli — analitik, koç tablosu, Chart.js, operasyonlar
 */
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
  getCountFromServer,
  getDocs,
  Timestamp,
  updateDoc,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db, auth, coachCreatorAuth as secondaryAuth, studentCreatorAuth as tertiaryAuth } from "./firebase-config.js";

const EMAIL_DOMAIN = "@sistem.com";

let coachesUnsub = null;
let studentsUnsub = null;
let adminLoginChart = null;
let lastCoachDocs = [];
let cachedStudentTotal = 0;

function sanitizeUsername(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function escapeHtml(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function toJsDate(v) {
  if (!v) return null;
  if (v instanceof Timestamp) return v.toDate();
  if (typeof v.toDate === "function") return v.toDate();
  if (v.seconds) return new Date(v.seconds * 1000);
  return null;
}

function formatLastLogin(v) {
  var d = toJsDate(v);
  if (!d || isNaN(d.getTime())) return "—";
  return d.toLocaleString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function showFormMsg(ok, text) {
  var el = document.getElementById("formCoachMsg");
  if (!el) return;
  el.textContent = text;
  el.className = ok ? "is-ok" : "is-err";
}

/** Son 7 gün için tarih anahtarları (YYYY-MM-DD, yerel) */
function last7DayKeys() {
  var keys = [];
  var now = new Date();
  for (var i = 6; i >= 0; i--) {
    var d = new Date(now);
    d.setDate(d.getDate() - i);
    d.setHours(0, 0, 0, 0);
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    keys.push(y + "-" + m + "-" + day);
  }
  return keys;
}

function labelForDayKey(key) {
  var p = key.split("-");
  var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
  return d.toLocaleDateString("tr-TR", { weekday: "short", day: "numeric", month: "short" });
}

async function fetchLoginLogByDay() {
  var keys = last7DayKeys();
  var start = new Date(keys[0]);
  start.setHours(0, 0, 0, 0);
  var startTs = Timestamp.fromDate(start);

  var dayToCoaches = {};
  keys.forEach(function (k) {
    dayToCoaches[k] = new Set();
  });

  try {
    var q = query(collection(db, "coachLoginLog"), where("at", ">=", startTs), orderBy("at", "asc"));
    var snap = await getDocs(q);
    snap.forEach(function (docSnap) {
      var data = docSnap.data();
      var at = toJsDate(data.at);
      if (!at) return;
      var y = at.getFullYear();
      var m = String(at.getMonth() + 1).padStart(2, "0");
      var day = String(at.getDate()).padStart(2, "0");
      var k = y + "-" + m + "-" + day;
      if (dayToCoaches[k] && data.coachId) dayToCoaches[k].add(data.coachId);
    });
  } catch (e) {
    console.warn("[super-admin] coachLoginLog:", e);
    /* index yoksa veya koleksiyon boş — grafik sıfırla */
  }

  return keys.map(function (k) {
    return dayToCoaches[k] ? dayToCoaches[k].size : 0;
  });
}

function renderOrUpdateChart(labels, values) {
  var canvas = document.getElementById("adminLoginChart");
  if (!canvas || typeof Chart === "undefined") return;

  var grad = null;
  try {
    var ctx = canvas.getContext("2d");
    grad = ctx.createLinearGradient(0, 0, 0, 280);
    grad.addColorStop(0, "rgba(168, 85, 247, 0.45)");
    grad.addColorStop(1, "rgba(52, 245, 197, 0.08)");
  } catch (_) {}

  if (adminLoginChart) {
    adminLoginChart.destroy();
    adminLoginChart = null;
  }

  adminLoginChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Aktif koç",
          data: values,
          fill: true,
          backgroundColor: grad || "rgba(168, 85, 247, 0.15)",
          borderColor: "#a855f7",
          borderWidth: 2,
          tension: 0.4,
          pointBackgroundColor: "#34f5c5",
          pointBorderColor: "#0a0a10",
          pointBorderWidth: 2,
          pointRadius: 5,
          pointHoverRadius: 7,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: "index" },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: "rgba(10, 10, 16, 0.95)",
          titleColor: "#e8edf5",
          bodyColor: "#34f5c5",
          borderColor: "rgba(168, 85, 247, 0.4)",
          borderWidth: 1,
          padding: 12,
          callbacks: {
            label: function (ctx) {
              return " " + ctx.parsed.y + " koç";
            },
          },
        },
      },
      scales: {
        x: {
          grid: { color: "rgba(255,255,255,0.04)" },
          ticks: { color: "#8b95a8", maxRotation: 45 },
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, color: "#8b95a8" },
          grid: { color: "rgba(255,255,255,0.04)" },
        },
      },
    },
  });
}

async function refreshKpisAndChart(coachDocs) {
  var coaches = coachDocs.filter(function (d) {
    return (d.data().role || "") === "coach";
  });

  document.getElementById("kpiTotalCoaches").textContent = String(coaches.length);

  var now = Date.now();
  var day24 = now - 24 * 60 * 60 * 1000;
  var activeToday = 0;
  coaches.forEach(function (d) {
    var lu = toJsDate(d.data().lastLogin);
    if (lu && lu.getTime() >= day24) activeToday++;
  });
  document.getElementById("kpiActiveToday").textContent = String(activeToday);

  try {
    var totalSnap = await getCountFromServer(query(collection(db, "users"), where("role", "==", "student")));
    cachedStudentTotal = totalSnap.data().count;
    document.getElementById("kpiTotalStudents").textContent = String(cachedStudentTotal);
  } catch (e) {
    document.getElementById("kpiTotalStudents").textContent = "—";
    console.warn(e);
  }

  var cpu = 8 + Math.floor(Math.random() * 11);
  var reads = 1200 + Math.floor(Math.random() * 800) + coaches.length * 15 + cachedStudentTotal * 2;
  document.getElementById("kpiSystemLoad").textContent = "%" + cpu + " CPU";
  document.getElementById("kpiSystemLoadSub").textContent =
    "~" + reads.toLocaleString("tr-TR") + " tahm. okuma (mock)";

  var keys = last7DayKeys();
  var chartLabels = keys.map(labelForDayKey);
  var chartValues = await fetchLoginLogByDay();
  renderOrUpdateChart(chartLabels, chartValues);
}

async function countStudentsForCoach(username) {
  var uname = (username || "").trim();
  if (!uname) return 0;
  try {
    var q = query(collection(db, "users"), where("role", "==", "student"), where("coach_id", "==", uname));
    var snap = await getCountFromServer(q);
    return snap.data().count;
  } catch (e) {
    console.warn("[count]", uname, e);
    return 0;
  }
}

async function renderCoachesTable(docs) {
  lastCoachDocs = docs.slice();
  var tb = document.getElementById("coachesTableBody");
  if (!tb) return;

  var coachDocs = docs.filter(function (d) {
    return (d.data().role || "") === "coach";
  });

  if (coachDocs.length === 0) {
    tb.innerHTML =
      '<tr><td colspan="6" class="mono" style="padding:1.75rem">Henüz koç yok.</td></tr>';
    await refreshKpisAndChart([]);
    return;
  }

  tb.innerHTML =
    '<tr><td colspan="6" class="mono" style="padding:1.75rem">Öğrenci sayıları yükleniyor…</td></tr>';

  var rows = await Promise.all(
    coachDocs.map(async function (d) {
      var x = d.data();
      var uname = x.username || "—";
      var inst = x.institutionName || "—";
      var pkg = x.packageType || "—";
      var badge = pkg === "Pro" ? "badge--pro" : "badge--bas";
      var frozen = x.frozen === true;
      var n = await countStudentsForCoach(uname);
      var last = formatLastLogin(x.lastLogin);
      var uid = d.id;
      var email = sanitizeUsername(uname) + EMAIL_DOMAIN;

      return {
        html:
          '<tr class="' +
          (frozen ? "is-frozen" : "") +
          '" data-uid="' +
          escapeHtml(uid) +
          '" data-user="' +
          escapeHtml(uname) +
          '" data-email="' +
          escapeHtml(email) +
          '">' +
          '<td class="cell-coach"><strong>' +
          escapeHtml(uname) +
          '</strong><span>' +
          escapeHtml(inst) +
          "</span></td>" +
          '<td><span class="stat-pill"><i class="fa-solid fa-graduation-cap" style="opacity:.8"></i> ' +
          n +
          "</span></td>" +
          '<td class="mono">' +
          escapeHtml(last) +
          "</td>" +
          '<td><span class="badge ' +
          badge +
          '">' +
          escapeHtml(pkg) +
          "</span></td>" +
          "<td>" +
          (frozen
            ? '<span class="badge badge--frozen">Donduruldu</span>'
            : '<span class="mono" style="color:#34f5c5">Aktif</span>') +
          "</td>" +
          '<td class="actions-cell">' +
          '<button type="button" class="btn-action btn-action--key" data-act="pwd" data-uid="' +
          escapeHtml(uid) +
          '" data-email="' +
          escapeHtml(email) +
          '" title="Şifre sıfırla">🔑</button>' +
          '<button type="button" class="btn-action btn-action--freeze" data-act="freeze" data-uid="' +
          escapeHtml(uid) +
          '" data-frozen="' +
          (frozen ? "1" : "0") +
          '" title="' +
          (frozen ? "Hesabı aç" : "Hesabı dondur") +
          '">' +
          (frozen ? "✅" : "🛑") +
          "</button>" +
          '<button type="button" class="btn-action btn-action--eye" data-act="imp" data-user="' +
          escapeHtml(uname) +
          '" title="Panele sız (impersonate)">👁️</button>' +
          "</td></tr>",
      };
    })
  );

  tb.innerHTML = rows.map(function (r) {
    return r.html;
  }).join("");

  await refreshKpisAndChart(coachDocs);

  tb.querySelectorAll(".btn-action").forEach(function (btn) {
    btn.addEventListener("click", onTableAction);
  });

  populateStudentCoachSelect();
}

function populateStudentCoachSelect() {
  var sel = document.getElementById("studentCoachSelect");
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="">— Koç seçin —</option>';
  lastCoachDocs.forEach(function (d) {
    if ((d.data().role || "") !== "coach") return;
    var u = d.data().username || "";
    if (!u) return;
    var o = document.createElement("option");
    o.value = u;
    o.textContent = u + (d.data().institutionName ? " · " + d.data().institutionName : "");
    sel.appendChild(o);
  });
  if (
    cur &&
    Array.prototype.some.call(sel.options, function (opt) {
      return opt.value === cur;
    })
  ) {
    sel.value = cur;
  }
}

function renderStudentsTable(snap) {
  var tb = document.getElementById("studentsTableBody");
  if (!tb) return;
  var docs = snap.docs.slice().sort(function (a, b) {
    return (a.data().username || "").localeCompare(b.data().username || "", "tr", { sensitivity: "base" });
  });
  if (docs.length === 0) {
    tb.innerHTML =
      '<tr><td colspan="5" class="mono" style="padding:1.75rem">Henüz kayıtlı öğrenci yok.</td></tr>';
    return;
  }
  tb.innerHTML = docs
    .map(function (d) {
      var x = d.data();
      var uid = d.id;
      var uname = x.username || "—";
      var full = (x.fullName || "").trim();
      var coach = x.coach_id || "—";
      var lastLogin = formatLastLogin(x.lastLogin);
      var lastPwd = formatLastLogin(x.lastPasswordChangeAt);
      var email = sanitizeUsername(uname) + EMAIL_DOMAIN;
      return (
        '<tr data-uid="' +
        escapeHtml(uid) +
        '">' +
        '<td class="cell-coach"><strong>' +
        escapeHtml(uname) +
        "</strong>" +
        (full ? '<span>' + escapeHtml(full) + "</span>" : "") +
        "</td>" +
        '<td class="mono">' +
        escapeHtml(coach) +
        "</td>" +
        '<td class="mono">' +
        escapeHtml(lastLogin) +
        "</td>" +
        '<td class="mono">' +
        escapeHtml(lastPwd) +
        "</td>" +
        '<td class="actions-cell">' +
        '<button type="button" class="btn-action btn-action--key" data-student-act="pwd" data-uid="' +
        escapeHtml(uid) +
        '" data-email="' +
        escapeHtml(email) +
        '" title="Şifre değiştir (mevcut şifre gerekir)">🔑</button>' +
        '<button type="button" class="btn-action btn-action--mail" data-student-act="mail" data-email="' +
        escapeHtml(email) +
        '" title="E-posta ile sıfırlama bağlantısı gönder">📧</button>' +
        "</td></tr>"
      );
    })
    .join("");
  tb.querySelectorAll("[data-student-act]").forEach(function (btn) {
    btn.addEventListener("click", onStudentTableAction);
  });
}

function subscribeStudentsList() {
  if (studentsUnsub) studentsUnsub();
  var q = query(collection(db, "users"), where("role", "==", "student"));
  studentsUnsub = onSnapshot(
    q,
    renderStudentsTable,
    function (err) {
      console.error(err);
      var tb = document.getElementById("studentsTableBody");
      if (tb) tb.innerHTML = "<tr><td colspan='5'>" + escapeHtml(err.message || "Hata") + "</td></tr>";
    }
  );
}

async function studentChangePassword(uid, email) {
  var oldPw = window.prompt(
    "Öğrencinin mevcut şifresi (güvenlik için zorunlu):\n" + email,
    ""
  );
  if (oldPw === null) return;
  var newPw = window.prompt("Yeni şifre (en az 6 karakter):", "");
  if (newPw === null) return;
  if (newPw.length < 6) {
    alert("Şifre en az 6 karakter olmalı.");
    return;
  }
  try {
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(tertiaryAuth, email, oldPw);
    await updatePassword(tertiaryAuth.currentUser, newPw);
    await signOut(tertiaryAuth);
    await updateDoc(doc(db, "users", uid), { lastPasswordChangeAt: serverTimestamp() });
    alert("Şifre güncellendi. Son şifre işlemi sütunu güncellenecek.");
  } catch (err) {
    console.error(err);
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    var msg = err.message || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
      msg = "Mevcut şifre hatalı.";
    alert(msg);
  }
}

async function studentSendPasswordEmail(email) {
  if (
    !window.confirm(
      "Firebase, " +
        email +
        " adresine şifre sıfırlama bağlantısı gönderir.\n\n@sistem.com gerçek bir posta kutusu değilse e-posta ulaşmaz; bu durumda 🔑 ile mevcut şifreyi bilerek değiştirin veya Firebase Console üzerinden sıfırlayın."
    )
  )
    return;
  try {
    await sendPasswordResetEmail(auth, email);
    alert("İstek gönderildi. Öğrenci gelen kutusunu (varsa) kontrol etsin.");
  } catch (e) {
    alert((e && e.message) || String(e));
  }
}

function onStudentTableAction(ev) {
  var btn = ev.currentTarget;
  var act = btn.getAttribute("data-student-act");
  var uid = btn.getAttribute("data-uid");
  var email = btn.getAttribute("data-email");
  if (act === "pwd" && uid && email) {
    studentChangePassword(uid, email);
    return;
  }
  if (act === "mail" && email) {
    studentSendPasswordEmail(email);
  }
}

function onTableAction(ev) {
  var btn = ev.currentTarget;
  var act = btn.getAttribute("data-act");
  var uid = btn.getAttribute("data-uid");
  var email = btn.getAttribute("data-email");
  var user = btn.getAttribute("data-user");

  if (act === "pwd") {
    var pw = window.prompt(
      "Yeni geçici şifre (min. 6 karakter).\n\nNot: Tarayıcıda başka kullanıcının şifresini değiştirmek için Firebase Admin SDK veya Cloud Function gerekir. Bu buton şimdilik yönergeyi gösterir.",
      ""
    );
    if (pw == null) return;
    if (pw.length < 6) {
      alert("Şifre en az 6 karakter olmalı.");
      return;
    }
    alert(
      "Üretimde: adminSetPassword(uid, şifre) Cloud Function ile uygulayın.\n\nŞimdilik Firebase Console → Authentication → " +
        email +
        " → şifre sıfırlayın.\n\nÖnerilen geçici şifre (kopyalayın): " +
        pw
    );
    return;
  }

  if (act === "freeze" && uid) {
    var fr = btn.getAttribute("data-frozen") === "1";
    var msg = fr
      ? "Bu koç hesabının dondurmasını kaldırmak istiyor musunuz?"
      : "Bu koç hesabı dondurulsun mu? Giriş engellenecek.";
    if (!window.confirm(msg)) return;
    updateDoc(doc(db, "users", uid), { frozen: !fr })
      .then(function () {})
      .catch(function (e) {
        alert(e.message || String(e));
      });
    return;
  }

  if (act === "imp" && user) {
    if (!window.confirm("Koç paneline kurucu olarak bu koçun verileriyle girmek istiyor musunuz?")) return;
    try {
      sessionStorage.setItem("superAdminViewAsCoach", user.trim());
    } catch (e) {
      alert("sessionStorage kullanılamıyor.");
      return;
    }
    window.location.href = "koc-panel.html";
  }
}

function subscribeCoachesList() {
  if (coachesUnsub) coachesUnsub();
  var q = query(collection(db, "users"), where("role", "==", "coach"));
  coachesUnsub = onSnapshot(
    q,
    function (snap) {
      renderCoachesTable(snap.docs);
    },
    function (err) {
      console.error(err);
      var tb = document.getElementById("coachesTableBody");
      if (tb) tb.innerHTML = "<tr><td colspan='6'>" + escapeHtml(err.message || "Hata") + "</td></tr>";
    }
  );
}

function showStudentFormMsg(ok, text) {
  var el = document.getElementById("formStudentMsg");
  if (!el) return;
  el.textContent = text;
  el.className = ok ? "is-ok" : "is-err";
  el.style.display = "block";
}

document.getElementById("formCreateStudent") &&
  document.getElementById("formCreateStudent").addEventListener("submit", async function (e) {
    e.preventDefault();
    var coachId = (document.getElementById("studentCoachSelect") && document.getElementById("studentCoachSelect").value) || "";
    var u = sanitizeUsername(document.getElementById("studentUsername").value);
    var pass = document.getElementById("studentPassword").value;
    var full = (document.getElementById("studentFullName").value || "").trim();
    var btn = document.getElementById("btnCreateStudent");
    showStudentFormMsg(true, "");
    var msgEl = document.getElementById("formStudentMsg");
    if (msgEl) {
      msgEl.className = "";
      msgEl.style.display = "none";
    }
    if (!coachId) {
      showStudentFormMsg(false, "Bağlı koç seçin.");
      return;
    }
    if (!u) {
      showStudentFormMsg(false, "Öğrenci kullanıcı adı sadece a-z, 0-9 ve _ içerebilir.");
      return;
    }
    if (pass.length < 6) {
      showStudentFormMsg(false, "Şifre en az 6 karakter olmalı.");
      return;
    }
    btn.disabled = true;
    try {
      var email = u + EMAIL_DOMAIN;
      var cred = await createUserWithEmailAndPassword(tertiaryAuth, email, pass);
      await setDoc(doc(db, "users", cred.user.uid), {
        username: u,
        role: "student",
        coach_id: coachId,
        fullName: full || null,
        frozen: false,
        createdAt: serverTimestamp(),
        lastPasswordChangeAt: serverTimestamp(),
      });
      await signOut(tertiaryAuth);
      showStudentFormMsg(true, "Öğrenci hesabı oluşturuldu: " + u + " (koç: " + coachId + "). Giriş: Öğrenci sekmesi.");
      e.target.reset();
    } catch (err) {
      console.error(err);
      var msg = err.message || String(err);
      if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kayıtlı.";
      showStudentFormMsg(false, msg);
      try {
        await signOut(tertiaryAuth);
      } catch (_) {}
    } finally {
      btn.disabled = false;
    }
  });

document.getElementById("formCreateCoach").addEventListener("submit", async function (e) {
  e.preventDefault();
  var u = sanitizeUsername(document.getElementById("coachUsername").value);
  var pass = document.getElementById("coachPassword").value;
  var inst = (document.getElementById("coachInstitution").value || "").trim();
  var phone = (document.getElementById("coachPhone").value || "").trim();
  var pkg = document.getElementById("coachPackage").value;
  var btn = document.getElementById("btnCreateCoach");
  showFormMsg(true, "");
  document.getElementById("formCoachMsg").className = "";
  document.getElementById("formCoachMsg").style.display = "none";
  if (!u) {
    showFormMsg(false, "Kullanıcı adı sadece a-z, 0-9 ve _ içerebilir.");
    return;
  }
  if (pass.length < 6) {
    showFormMsg(false, "Şifre en az 6 karakter olmalı.");
    return;
  }
  if (!inst) {
    showFormMsg(false, "Kurum adı zorunlu.");
    return;
  }
  btn.disabled = true;
  try {
    var email = u + EMAIL_DOMAIN;
    var cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      username: u,
      role: "coach",
      institutionName: inst,
      phone: phone || null,
      packageType: pkg,
      frozen: false,
      createdAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
    showFormMsg(true, "Koç hesabı oluşturuldu: " + u + " — giriş: kullanıcı adı + şifre.");
    document.getElementById("formCoachMsg").style.display = "block";
    e.target.reset();
  } catch (err) {
    console.error(err);
    var msg = err.message || String(err);
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kayıtlı.";
    showFormMsg(false, msg);
    document.getElementById("formCoachMsg").style.display = "block";
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnLogout").addEventListener("click", async function () {
  if (!confirm("Çıkış yapılsın mı?")) return;
  localStorage.removeItem("currentUser");
  await signOut(auth);
  window.location.replace("login.html");
});

onAuthStateChanged(auth, async function (user) {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  var snap = await getDoc(doc(db, "users", user.uid));
  var profile = snap.data();
  if (!profile || profile.role !== "admin") {
    await signOut(auth);
    window.location.replace("login.html");
    return;
  }
  localStorage.setItem("currentUser", profile.username || "admin1");
  subscribeCoachesList();
  subscribeStudentsList();
});
