/**
 * Kurucu paneli — analitik, koç tablosu, Chart.js, operasyonlar
 */
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updatePassword,
  updateEmail,
  deleteUser,
  sendPasswordResetEmail,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
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
let quotesUnsub = null;
let settingsUnsub = null;
let adminLoginChart = null;
let lastCoachDocs = [];
let cachedStudentTotal = 0;
let saStudentCtx = { uid: "", origUsername: "" };
let saCoachCtx = { uid: "", origUsername: "" };

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

/** Kurucu panelinde silme için; oluşturma / şifre değişiminde güncellenir (Firebase şifreyi geri vermez). */
function plainPasswordLine(data) {
  var p = data && data.plainPassword != null ? String(data.plainPassword).trim() : "";
  if (!p) {
    return '<span class="mono" style="font-size:0.76rem;color:#8b95a8;display:block;margin-top:0.2rem">Şifre: —</span>';
  }
  return (
    '<span class="mono" style="font-size:0.76rem;color:#c4b5fd;display:block;margin-top:0.2rem">Şifre: ' +
    escapeHtml(p) +
    "</span>"
  );
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

function saSetModalMsg(elId, ok, text) {
  var el = document.getElementById(elId);
  if (!el) return;
  if (!text) {
    el.textContent = "";
    el.className = "sa-modal__msg";
    el.style.display = "none";
    return;
  }
  el.textContent = text;
  el.className = "sa-modal__msg " + (ok ? "is-ok" : "is-err");
  el.style.display = "block";
}

function saCloseModals() {
  var a = document.getElementById("saModalStudent");
  var b = document.getElementById("saModalCoach");
  if (a) a.hidden = true;
  if (b) b.hidden = true;
}

function fillSaStCoachSelect(selectedCoach) {
  var sel = document.getElementById("saStCoach");
  if (!sel) return;
  sel.innerHTML = "";
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
    selectedCoach &&
    Array.prototype.some.call(sel.options, function (opt) {
      return opt.value === selectedCoach;
    })
  ) {
    sel.value = selectedCoach;
  }
}

function saBindStEmailPreview() {
  var inp = document.getElementById("saStUsername");
  var ro = document.getElementById("saStEmailRo");
  if (!inp || !ro) return;
  var u = sanitizeUsername(inp.value);
  ro.textContent = u ? u + EMAIL_DOMAIN : "—";
}

async function openStudentEditModal(uid) {
  saSetModalMsg("saStMsg", true, "");
  var snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists) {
    alert("Kayıt bulunamadı.");
    return;
  }
  var x = snap.data();
  if ((x.role || "") !== "student") {
    alert("Bu kayıt öğrenci değil.");
    return;
  }
  saStudentCtx.uid = uid;
  saStudentCtx.origUsername = sanitizeUsername(x.username || "");
  var un = document.getElementById("saStUsername");
  var fn = document.getElementById("saStFullName");
  var np = document.getElementById("saStNewPw");
  var cp = document.getElementById("saStCurPw");
  if (un) un.value = saStudentCtx.origUsername;
  if (fn) fn.value = (x.fullName || "").trim();
  if (np) np.value = "";
  if (cp) cp.value = "";
  fillSaStCoachSelect(x.coach_id || "");
  saBindStEmailPreview();
  var modal = document.getElementById("saModalStudent");
  if (modal) modal.hidden = false;
}

async function openCoachEditModal(uid) {
  saSetModalMsg("saCoMsg", true, "");
  var snap = await getDoc(doc(db, "users", uid));
  if (!snap.exists) {
    alert("Kayıt bulunamadı.");
    return;
  }
  var x = snap.data();
  if ((x.role || "") !== "coach") {
    alert("Bu kayıt koç değil.");
    return;
  }
  saCoachCtx.uid = uid;
  saCoachCtx.origUsername = sanitizeUsername(x.username || "");
  var un = document.getElementById("saCoUsername");
  var inst = document.getElementById("saCoInst");
  var ph = document.getElementById("saCoPhone");
  var pkg = document.getElementById("saCoPkg");
  var np = document.getElementById("saCoNewPw");
  var cp = document.getElementById("saCoCurPw");
  var em = document.getElementById("saCoEmailRo");
  if (un) un.value = saCoachCtx.origUsername;
  if (inst) inst.value = (x.institutionName || "").trim();
  if (ph) ph.value = (x.phone || "").trim();
  if (pkg) pkg.value = x.packageType === "Pro" ? "Pro" : "Başlangıç";
  if (np) np.value = "";
  if (cp) cp.value = "";
  if (em) em.textContent = saCoachCtx.origUsername ? saCoachCtx.origUsername + EMAIL_DOMAIN : "—";
  var modal = document.getElementById("saModalCoach");
  if (modal) modal.hidden = false;
}

async function saveStudentEdit() {
  saSetModalMsg("saStMsg", true, "");
  var uid = saStudentCtx.uid;
  var origU = saStudentCtx.origUsername;
  if (!uid || !origU) return;
  var newU = sanitizeUsername(document.getElementById("saStUsername") && document.getElementById("saStUsername").value);
  var full = (document.getElementById("saStFullName") && document.getElementById("saStFullName").value) || "";
  var coachId = (document.getElementById("saStCoach") && document.getElementById("saStCoach").value) || "";
  var newPw = (document.getElementById("saStNewPw") && document.getElementById("saStNewPw").value) || "";
  var curPw = (document.getElementById("saStCurPw") && document.getElementById("saStCurPw").value) || "";
  var origEmail = origU + EMAIL_DOMAIN;

  if (!newU) {
    saSetModalMsg("saStMsg", false, "Geçerli bir kullanıcı adı girin.");
    return;
  }
  if (!coachId) {
    saSetModalMsg("saStMsg", false, "Bağlı koç seçin.");
    return;
  }
  if (newPw && newPw.length < 6) {
    saSetModalMsg("saStMsg", false, "Yeni şifre en az 6 karakter olmalı.");
    return;
  }

  var needAuth = newU !== origU || (newPw.length > 0);
  if (needAuth && !curPw) {
    saSetModalMsg("saStMsg", false, "Kullanıcı adı veya şifre değişikliği için mevcut şifreyi girin.");
    return;
  }

  var btn = document.getElementById("saStSave");
  if (btn) btn.disabled = true;
  try {
    if (!needAuth) {
      await updateDoc(doc(db, "users", uid), {
        fullName: full.trim() || null,
        coach_id: coachId,
      });
      saSetModalMsg("saStMsg", true, "Kaydedildi.");
      setTimeout(saCloseModals, 600);
      return;
    }

    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(tertiaryAuth, origEmail, curPw);
    if (tertiaryAuth.currentUser.uid !== uid) throw new Error("Oturum kullanıcısı eşleşmedi.");
    var uref = tertiaryAuth.currentUser;
    if (newU !== origU) {
      await updateEmail(uref, newU + EMAIL_DOMAIN);
    }
    if (newPw.length >= 6) {
      await updatePassword(uref, newPw);
    }
    var stPayload = {
      username: newU,
      fullName: full.trim() || null,
      coach_id: coachId,
    };
    if (newPw.length >= 6) {
      stPayload.lastPasswordChangeAt = serverTimestamp();
      stPayload.plainPassword = newPw;
    }
    await updateDoc(doc(db, "users", uid), stPayload);
    await signOut(tertiaryAuth);
    saStudentCtx.origUsername = newU;
    saSetModalMsg("saStMsg", true, "Güncellendi.");
    setTimeout(saCloseModals, 650);
  } catch (err) {
    console.error(err);
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Mevcut şifre hatalı.";
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı (e-posta) zaten kullanılıyor.";
    saSetModalMsg("saStMsg", false, msg);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteStudentAccount(uid, origUsername) {
  var origEmail = origUsername + EMAIL_DOMAIN;
  if (!window.confirm("Öğrenci hem Firebase Authentication hem Firestore’dan silinecek. Emin misiniz?")) return;
  try {
    var usnap = await getDoc(doc(db, "users", uid));
    var pw =
      usnap.exists && usnap.data().plainPassword != null
        ? String(usnap.data().plainPassword).trim()
        : "";
    if (!pw) {
      alert(
        "Bu hesap için şifre bu panelde kayıtlı değil. Silmek için Firebase Console → Authentication kullanın veya düzenle ile yeni şifre kaydedin."
      );
      return;
    }
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(tertiaryAuth, origEmail, pw);
    if (tertiaryAuth.currentUser.uid !== uid) throw new Error("Kimlik doğrulanamadı.");
    await deleteUser(tertiaryAuth.currentUser);
    await signOut(tertiaryAuth);
    await deleteDoc(doc(db, "users", uid));
    alert("Öğrenci hesabı silindi.");
    saCloseModals();
  } catch (err) {
    console.error(err);
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Şifre hatalı.";
    alert(msg);
  }
}

async function saveCoachEdit() {
  saSetModalMsg("saCoMsg", true, "");
  var uid = saCoachCtx.uid;
  var origU = saCoachCtx.origUsername;
  if (!uid || !origU) return;
  var newU = sanitizeUsername(document.getElementById("saCoUsername") && document.getElementById("saCoUsername").value);
  var inst = (document.getElementById("saCoInst") && document.getElementById("saCoInst").value.trim()) || "";
  var ph = (document.getElementById("saCoPhone") && document.getElementById("saCoPhone").value.trim()) || "";
  var pkg = (document.getElementById("saCoPkg") && document.getElementById("saCoPkg").value) || "Başlangıç";
  var newPw = (document.getElementById("saCoNewPw") && document.getElementById("saCoNewPw").value) || "";
  var curPw = (document.getElementById("saCoCurPw") && document.getElementById("saCoCurPw").value) || "";
  var origEmail = origU + EMAIL_DOMAIN;

  if (!newU) {
    saSetModalMsg("saCoMsg", false, "Geçerli bir kullanıcı adı girin.");
    return;
  }
  if (!inst) {
    saSetModalMsg("saCoMsg", false, "Kurum adı zorunlu.");
    return;
  }
  if (newPw && newPw.length < 6) {
    saSetModalMsg("saCoMsg", false, "Yeni şifre en az 6 karakter olmalı.");
    return;
  }

  var needAuth = newU !== origU || newPw.length > 0;
  if (needAuth && !curPw) {
    saSetModalMsg("saCoMsg", false, "Kullanıcı adı veya şifre değişikliği için mevcut şifreyi girin.");
    return;
  }

  var btn = document.getElementById("saCoSave");
  if (btn) btn.disabled = true;
  try {
    if (!needAuth) {
      await updateDoc(doc(db, "users", uid), {
        institutionName: inst,
        phone: ph || null,
        packageType: pkg,
      });
      saSetModalMsg("saCoMsg", true, "Kaydedildi.");
      setTimeout(saCloseModals, 600);
      return;
    }

    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(secondaryAuth, origEmail, curPw);
    if (secondaryAuth.currentUser.uid !== uid) throw new Error("Oturum kullanıcısı eşleşmedi.");
    var uref = secondaryAuth.currentUser;
    if (newU !== origU) {
      await updateEmail(uref, newU + EMAIL_DOMAIN);
    }
    if (newPw.length >= 6) {
      await updatePassword(uref, newPw);
    }
    var coPayload = {
      username: newU,
      institutionName: inst,
      phone: ph || null,
      packageType: pkg,
    };
    if (newPw.length >= 6) coPayload.plainPassword = newPw;
    await updateDoc(doc(db, "users", uid), coPayload);
    await signOut(secondaryAuth);
    saCoachCtx.origUsername = newU;
    var em = document.getElementById("saCoEmailRo");
    if (em) em.textContent = newU + EMAIL_DOMAIN;
    saSetModalMsg("saCoMsg", true, "Güncellendi.");
    setTimeout(saCloseModals, 650);
  } catch (err) {
    console.error(err);
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Mevcut şifre hatalı.";
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kullanılıyor.";
    saSetModalMsg("saCoMsg", false, msg);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteCoachAccount(uid, origUsername) {
  var n = await countStudentsForCoach(origUsername);
  if (n > 0) {
    if (
      !window.confirm(
        "Bu koça bağlı " +
          n +
          " öğrenci var. Yine de koç hesabını silmek istiyor musunuz? (Öğrenci kayıtları kalır; coach_id elle güncellenmeli.)"
      )
    ) {
      return;
    }
  }
  var origEmail = origUsername + EMAIL_DOMAIN;
  if (!window.confirm("Koç hem Firebase Authentication hem Firestore’dan silinecek. Emin misiniz?")) return;
  try {
    var usnap = await getDoc(doc(db, "users", uid));
    var pw =
      usnap.exists && usnap.data().plainPassword != null
        ? String(usnap.data().plainPassword).trim()
        : "";
    if (!pw) {
      alert(
        "Bu hesap için şifre bu panelde kayıtlı değil. Silmek için Firebase Console → Authentication kullanın veya düzenle ile yeni şifre kaydedin."
      );
      return;
    }
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(secondaryAuth, origEmail, pw);
    if (secondaryAuth.currentUser.uid !== uid) throw new Error("Kimlik doğrulanamadı.");
    await deleteUser(secondaryAuth.currentUser);
    await signOut(secondaryAuth);
    await deleteDoc(doc(db, "users", uid));
    alert("Koç hesabı silindi.");
    saCloseModals();
  } catch (err) {
    console.error(err);
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Şifre hatalı.";
    alert(msg);
  }
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
          "</strong>" +
          plainPasswordLine(x) +
          '<span>' +
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
          '<button type="button" class="btn-action btn-action--edit" data-act="edit" data-uid="' +
          escapeHtml(uid) +
          '" title="Düzenle"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>' +
          '<button type="button" class="btn-action btn-action--del" data-act="del" data-uid="' +
          escapeHtml(uid) +
          '" data-user="' +
          escapeHtml(uname) +
          '" title="Sil"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
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
        plainPasswordLine(x) +
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
        '<button type="button" class="btn-action btn-action--edit" data-student-act="edit" data-uid="' +
        escapeHtml(uid) +
        '" title="Düzenle"><i class="fa-solid fa-pen" aria-hidden="true"></i></button>' +
        '<button type="button" class="btn-action btn-action--del" data-student-act="del" data-uid="' +
        escapeHtml(uid) +
        '" data-username="' +
        escapeHtml(uname) +
        '" title="Sil"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
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

function renderQuotesTable(docs) {
  var tb = document.getElementById("quotesTableBody");
  var badge = document.getElementById("saQuoteBadge");
  if (!tb) return;
  var newCount = 0;
  docs.forEach(function (d) {
    if ((d.data().status || "new") === "new") newCount++;
  });
  if (badge) {
    if (newCount > 0) {
      badge.textContent = newCount > 99 ? "99+" : String(newCount);
      badge.hidden = false;
    } else {
      badge.hidden = true;
    }
  }
  if (docs.length === 0) {
    tb.innerHTML =
      '<tr><td colspan="9" class="mono" style="padding:1.75rem">Henüz teklif talebi yok.</td></tr>';
    return;
  }
  tb.innerHTML = docs
    .map(function (d) {
      var x = d.data();
      var id = d.id;
      var created = formatLastLogin(x.createdAt);
      var st = x.status || "new";
      var inst = (x.institutionName || "").trim() || "—";
      var msg = (x.message || "").trim();
      var shortMsg = msg.length > 100 ? msg.slice(0, 100) + "…" : msg;
      var msgCell =
        '<td class="mono" style="max-width:240px;font-size:0.8rem;word-break:break-word">' +
        (msg
          ? '<span' +
            (msg.length > 100 ? ' title="' + escapeHtml(msg).replace(/"/g, "&quot;") + '"' : "") +
            ">" +
            escapeHtml(shortMsg) +
            "</span>"
          : "—") +
        "</td>";
      var sel =
        '<select class="sa-quote-status" data-id="' +
        escapeHtml(id) +
        '" data-was="' +
        escapeHtml(st) +
        '" aria-label="Durum">' +
        '<option value="new"' +
        (st === "new" ? " selected" : "") +
        ">Yeni</option>" +
        '<option value="reviewed"' +
        (st === "reviewed" ? " selected" : "") +
        ">İncelendi</option>" +
        '<option value="closed"' +
        (st === "closed" ? " selected" : "") +
        ">Kapatıldı</option>" +
        "</select>";
      return (
        "<tr>" +
        '<td class="mono">' +
        escapeHtml(created) +
        "</td>" +
        "<td>" +
        escapeHtml(x.packageName || "—") +
        "</td>" +
        "<td>" +
        escapeHtml(inst) +
        "</td>" +
        "<td>" +
        escapeHtml((x.contactName || "").trim() || "—") +
        "</td>" +
        '<td class="mono" style="font-size:0.8rem">' +
        escapeHtml((x.email || "").trim() || "—") +
        "</td>" +
        "<td>" +
        escapeHtml((x.phone || "").trim() || "—") +
        "</td>" +
        msgCell +
        "<td>" +
        sel +
        "</td>" +
        '<td class="actions-cell">' +
        '<button type="button" class="btn-action btn-action--del" data-sa-quote-del="' +
        escapeHtml(id) +
        '" title="Teklifi sil"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

function subscribeQuoteRequests() {
  if (quotesUnsub) quotesUnsub();
  var q = query(collection(db, "quoteRequests"), orderBy("createdAt", "desc"));
  quotesUnsub = onSnapshot(
    q,
    function (snap) {
      renderQuotesTable(snap.docs);
    },
    function (err) {
      console.error(err);
      var tb = document.getElementById("quotesTableBody");
      if (tb)
        tb.innerHTML =
          "<tr><td colspan='9' class='mono' style='padding:1.75rem'>" +
          escapeHtml(err.message || "Teklifler yüklenemedi. Firestore indeks/kurallarını kontrol edin.") +
          "</td></tr>";
      var badge = document.getElementById("saQuoteBadge");
      if (badge) badge.hidden = true;
    }
  );
}

document.addEventListener("change", async function (e) {
  var t = e.target;
  if (!t || !t.classList || !t.classList.contains("sa-quote-status")) return;
  var id = t.getAttribute("data-id");
  var was = t.getAttribute("data-was") || "new";
  var v = t.value;
  if (!id) return;
  t.disabled = true;
  try {
    await updateDoc(doc(db, "quoteRequests", id), {
      status: v,
      updatedAt: serverTimestamp(),
    });
    t.setAttribute("data-was", v);
  } catch (err) {
    console.error(err);
    t.value = was;
    alert((err && err.message) || String(err));
  } finally {
    t.disabled = false;
  }
});

document.addEventListener("click", async function (e) {
  var del = e.target.closest && e.target.closest("[data-sa-quote-del]");
  if (!del) return;
  var id = del.getAttribute("data-sa-quote-del");
  if (!id) return;
  if (!window.confirm("Bu teklif kaydı kalıcı olarak silinsin mi?")) return;
  del.disabled = true;
  try {
    await deleteDoc(doc(db, "quoteRequests", id));
  } catch (err) {
    console.error(err);
    alert((err && err.message) || String(err));
  } finally {
    del.disabled = false;
  }
});

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
  var uname = btn.getAttribute("data-username");
  if (act === "edit" && uid) {
    openStudentEditModal(uid);
    return;
  }
  if (act === "del" && uid && uname) {
    deleteStudentAccount(uid, uname);
    return;
  }
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

  if (act === "edit" && uid) {
    openCoachEditModal(uid);
    return;
  }

  if (act === "del" && uid) {
    var cun = btn.getAttribute("data-user");
    if (cun) deleteCoachAccount(uid, cun);
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
        plainPassword: pass,
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
      plainPassword: pass,
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

document.querySelectorAll("[data-sa-close]").forEach(function (el) {
  el.addEventListener("click", saCloseModals);
});
var saStSaveEl = document.getElementById("saStSave");
if (saStSaveEl) saStSaveEl.addEventListener("click", saveStudentEdit);
var saStDeleteEl = document.getElementById("saStDelete");
if (saStDeleteEl)
  saStDeleteEl.addEventListener("click", function () {
    if (saStudentCtx.uid && saStudentCtx.origUsername) {
      deleteStudentAccount(saStudentCtx.uid, saStudentCtx.origUsername);
    }
  });
var saCoSaveEl = document.getElementById("saCoSave");
if (saCoSaveEl) saCoSaveEl.addEventListener("click", saveCoachEdit);
var saCoDeleteEl = document.getElementById("saCoDelete");
if (saCoDeleteEl)
  saCoDeleteEl.addEventListener("click", function () {
    if (saCoachCtx.uid && saCoachCtx.origUsername) {
      deleteCoachAccount(saCoachCtx.uid, saCoachCtx.origUsername);
    }
  });
var saStUsernameEl = document.getElementById("saStUsername");
if (saStUsernameEl) saStUsernameEl.addEventListener("input", saBindStEmailPreview);

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
  subscribeQuoteRequests();
  subscribeMaintenanceSettings();
});

function subscribeMaintenanceSettings() {
  if (settingsUnsub) settingsUnsub();
  settingsUnsub = onSnapshot(
    doc(db, "settings", "app"),
    function (snap) {
      var el = document.getElementById("saMaintenanceStatus");
      if (!el) return;
      var on = snap.exists && snap.data() && snap.data().maintenance === true;
      el.textContent = on
        ? "Durum: BAKIM AÇIK — koç ve öğrenci girişleri kapalı."
        : "Durum: Normal — tüm roller giriş yapabilir.";
      el.style.color = on ? "#fca5a5" : "#34f5c5";
    },
    function (err) {
      console.error(err);
      var el = document.getElementById("saMaintenanceStatus");
      if (el) el.textContent = "Ayarlar okunamadı (Firestore kuralları / ağ).";
    }
  );
}

document.getElementById("btnMaintenanceStart") &&
  document.getElementById("btnMaintenanceStart").addEventListener("click", async function () {
    if (!window.confirm("Bakım modu açılsın mı? Koç ve öğrenci girişleri engellenecek.")) return;
    try {
      await setDoc(
        doc(db, "settings", "app"),
        { maintenance: true, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
      alert((e && e.message) || String(e));
    }
  });

document.getElementById("btnMaintenanceStop") &&
  document.getElementById("btnMaintenanceStop").addEventListener("click", async function () {
    if (!window.confirm("Bakım modu kapatılsın mı?")) return;
    try {
      await setDoc(
        doc(db, "settings", "app"),
        { maintenance: false, updatedAt: serverTimestamp() },
        { merge: true }
      );
    } catch (e) {
      console.error(e);
      alert((e && e.message) || String(e));
    }
  });

var btnScrollQuotes = document.getElementById("btnScrollQuotes");
if (btnScrollQuotes) {
  btnScrollQuotes.addEventListener("click", function () {
    var el = document.getElementById("saSectionQuotes");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  });
}
