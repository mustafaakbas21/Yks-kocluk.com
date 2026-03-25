/**
 * Kurucu paneli — analitik, koç tablosu, Chart.js, operasyonlar
 */
import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndRestoreAdmin,
  signInWithEmailAndPassword,
  updatePassword,
  updateEmail,
  updateAccountName,
  blockCurrentAccount,
  sendPasswordResetEmail,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  addDoc,
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
  db,
  auth,
  coachCreatorAuth as secondaryAuth,
  studentCreatorAuth as tertiaryAuth,
  verifyAppwriteAccount,
} from "./appwrite-compat.js";
import {
  storage,
  APPWRITE_BUCKET_DESTEK,
  APPWRITE_ADMIN_ROSTER_ROLE,
  APPWRITE_COLLECTION_QUOTE_REQUESTS,
  databases,
  APPWRITE_DATABASE_ID,
  client,
  APPWRITE_COLLECTION_SORU_HAVUZU,
  APPWRITE_BUCKET_SORU_HAVUZU,
} from "./appwrite-config.js";
import { Query } from "./appwrite-browser.js";
import { parseFlexibleDate, formatDateTimeTr } from "./date-format.js";

const EMAIL_DOMAIN = "@sistem.com";

/** Girişte (login.js) yazılır; kurucu çıkışında silinir. Koç/öğrenci oluştururken prompt yerine kullanılır. */
var SA_REAUTH_EMAIL_KEY = "dp_sa_reauth_email";
var SA_REAUTH_PW_KEY = "dp_sa_reauth_pw";

function clearSaReauthCache() {
  try {
    sessionStorage.removeItem(SA_REAUTH_EMAIL_KEY);
    sessionStorage.removeItem(SA_REAUTH_PW_KEY);
  } catch (e) {}
}

/** Oturumdaki kurucu e-postası ile eşleşen, girişte saklanan şifre (yoksa ""). */
function takeSaReauthPasswordForCreate() {
  try {
    var em = sessionStorage.getItem(SA_REAUTH_EMAIL_KEY);
    var pw = sessionStorage.getItem(SA_REAUTH_PW_KEY);
    var cur =
      auth.currentUser && auth.currentUser.email ? String(auth.currentUser.email).toLowerCase().trim() : "";
    if (!pw || !em || String(em).toLowerCase().trim() !== cur) return "";
    return String(pw);
  } catch (e) {
    return "";
  }
}

let coachesUnsub = null;
let studentsUnsub = null;
let quotesUnsub = null;
let settingsUnsub = null;
let adminLoginChart = null;
let lastCoachDocs = [];
/** Öğrenci snapshot (günlük analiz için) */
let lastStudentDocs = [];
let cachedStudentTotal = 0;
let saStudentCtx = { uid: "", origUsername: "" };
let saCoachCtx = { uid: "", origUsername: "" };
let saAuthBootstrapped = false;
/** Appwrite: geçici çıkış / hesap değiştirme sırasında login'e yönlendirmeyi kapat */
let saTransientAuth = false;

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

/** Kurucu panelinde silme için; oluşturma / şifre değişiminde güncellenir. */
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
  return parseFlexibleDate(v);
}

function formatLastLogin(v) {
  return formatDateTimeTr(v, { withSeconds: true });
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

function saEnsureLoadingOverlay() {
  var el = document.getElementById("saAuthLoading");
  if (el) return el;
  el = document.createElement("div");
  el.id = "saAuthLoading";
  el.style.cssText =
    "position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;" +
    "background:rgba(3,3,6,0.88);backdrop-filter:blur(2px);color:#e8edf5;font-weight:700;font-size:1.05rem;";
  el.textContent = "Yükleniyor...";
  document.body.appendChild(el);
  return el;
}

function saSetLoading(active, text) {
  var el = saEnsureLoadingOverlay();
  if (text) el.textContent = text;
  el.style.display = active ? "flex" : "none";
}

function saHideLoadingOverlay() {
  var el = document.getElementById("saAuthLoading");
  if (el) el.style.display = "none";
}

function normalizeRoleName(role) {
  var r = String(role || "")
    .trim()
    .toLowerCase();
  if (
    r === "admin" ||
    r === "kurucu" ||
    r === "superadmin" ||
    r === "super-admin" ||
    r === "admin_roster"
  )
    return "admin";
  if (r === "coach" || r === "koç" || r === "koc") return "coach";
  if (r === "student" || r === "ogrenci" || r === "öğrenci") return "student";
  return r;
}

async function waitForProfile(uid, maxTry, delayMs) {
  for (var i = 0; i < maxTry; i++) {
    try {
      var snap = await getDoc(doc(db, "users", uid));
      var data = snap && typeof snap.data === "function" ? snap.data() : null;
      if (data && data.role) return data;
    } catch (e) {
      console.error("VERI CEKME HATASI:", e);
    }
    await new Promise(function (resolve) {
      setTimeout(resolve, delayMs);
    });
  }
  return null;
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
  if (newPw && newPw.length < 8) {
    saSetModalMsg("saStMsg", false, "Yeni şifre en az 8 karakter olmalıdır.");
    return;
  }

  var needAuth = newU !== origU || (newPw.length > 0);
  if (needAuth && !curPw) {
    saSetModalMsg("saStMsg", false, "Kullanıcı adı veya şifre değişikliği için mevcut şifreyi girin.");
    return;
  }

  var btn = document.getElementById("saStSave");
  if (btn) btn.disabled = true;
  var adminEmailRestore = "";
  var adminPwRestore = "";
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

    adminEmailRestore = auth.currentUser && auth.currentUser.email;
    if (!adminEmailRestore) {
      saSetModalMsg("saStMsg", false, "Oturum e-postası bulunamadı.");
      return;
    }
    adminPwRestore = window.prompt("Kurucu şifreniz (düzenleme bitince oturumunuz açılır):");
    if (adminPwRestore === null) {
      saSetModalMsg("saStMsg", false, "İşlem iptal edildi.");
      return;
    }
    if (String(adminPwRestore).trim() === "") {
      saSetModalMsg("saStMsg", false, "Kurucu şifresi gerekli.");
      return;
    }
    adminPwRestore = String(adminPwRestore).trim();
    saTransientAuth = true;

    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(tertiaryAuth, origEmail, curPw);
    if (tertiaryAuth.currentUser.uid !== uid) throw new Error("Oturum kullanıcısı eşleşmedi.");
    if (newU !== origU) {
      await updateEmail(newU + EMAIL_DOMAIN, curPw);
    }
    if (newPw.length >= 8) {
      await updatePassword(newPw, curPw);
    }
    var stPayload = {
      username: newU,
      fullName: full.trim() || null,
      coach_id: coachId,
    };
    if (newPw.length >= 8) {
      stPayload.lastPasswordChangeAt = serverTimestamp();
      stPayload.plainPassword = newPw;
    }
    await updateDoc(doc(db, "users", uid), stPayload);
    await signOut(tertiaryAuth);
    await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
    saStudentCtx.origUsername = newU;
    saSetModalMsg("saStMsg", true, "Güncellendi.");
    setTimeout(saCloseModals, 650);
  } catch (err) {
    console.error(err);
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    try {
      if (adminEmailRestore && adminPwRestore) {
        await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
      }
    } catch (_e) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Mevcut şifre hatalı.";
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı (e-posta) zaten kullanılıyor.";
    saSetModalMsg("saStMsg", false, msg);
  } finally {
    saTransientAuth = false;
    if (btn) btn.disabled = false;
  }
}

async function deleteStudentAccount(uid, origUsername) {
  var origEmail = origUsername + EMAIL_DOMAIN;
  if (!window.confirm("Öğrenci hesabı ve verisi silinecek. Emin misiniz?")) return;
  var adminEmailRestore = "";
  var adminPwRestore = "";
  try {
    var usnap = await getDoc(doc(db, "users", uid));
    var pw =
      usnap.exists && usnap.data().plainPassword != null
        ? String(usnap.data().plainPassword).trim()
        : "";
    if (!pw) {
      alert(
        "Bu hesap için şifre bu panelde kayıtlı değil. Silmek için kullanıcı yönetim ekranını kullanın veya düzenle ile yeni şifre kaydedin."
      );
      return;
    }

    adminEmailRestore = auth.currentUser && auth.currentUser.email;
    if (!adminEmailRestore) {
      alert("Oturum e-postası bulunamadı.");
      return;
    }
    adminPwRestore = window.prompt("Kurucu şifreniz (işlem sonunda oturumunuz açılır):");
    if (adminPwRestore === null) {
      alert("İşlem iptal edildi.");
      return;
    }
    if (String(adminPwRestore).trim() === "") {
      alert("Kurucu şifresi gerekli.");
      return;
    }
    adminPwRestore = String(adminPwRestore).trim();
    saTransientAuth = true;

    var docDeleted = false;
    try {
      await deleteDoc(doc(db, "users", uid));
      docDeleted = true;
    } catch (eDel) {
      console.warn("[deleteStudent] deleteDoc (kurucu oturumu):", eDel);
    }

    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(tertiaryAuth, origEmail, pw);
    if (tertiaryAuth.currentUser.uid !== uid) throw new Error("Kimlik doğrulanamadı.");

    if (!docDeleted) {
      try {
        await deleteDoc(doc(db, "users", uid));
      } catch (eDel2) {
        console.warn("[deleteStudent] deleteDoc (öğrenci oturumu):", eDel2);
      }
    }

    await blockCurrentAccount();
    await signOut(tertiaryAuth);
    await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
    alert("Öğrenci kaydı silindi ve giriş hesabı kalıcı olarak engellendi.");
    saCloseModals();
  } catch (err) {
    console.error(err);
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    try {
      if (adminEmailRestore && adminPwRestore) {
        await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
      }
    } catch (_e) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Şifre hatalı.";
    if (err.code === 401 || err.code === 400) msg = msg || "İşlem reddedildi (şifre veya oturum).";
    alert(msg);
  } finally {
    saTransientAuth = false;
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
  if (newPw && newPw.length < 8) {
    saSetModalMsg("saCoMsg", false, "Yeni şifre en az 8 karakter olmalıdır.");
    return;
  }

  var needAuth = newU !== origU || newPw.length > 0;
  if (needAuth && !curPw) {
    saSetModalMsg("saCoMsg", false, "Kullanıcı adı veya şifre değişikliği için mevcut şifreyi girin.");
    return;
  }

  var btn = document.getElementById("saCoSave");
  if (btn) btn.disabled = true;
  var adminEmailRestoreCo = "";
  var adminPwRestoreCo = "";
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

    adminEmailRestoreCo = auth.currentUser && auth.currentUser.email;
    if (!adminEmailRestoreCo) {
      saSetModalMsg("saCoMsg", false, "Oturum e-postası bulunamadı.");
      return;
    }
    adminPwRestoreCo = window.prompt("Kurucu şifreniz (düzenleme bitince oturumunuz açılır):");
    if (adminPwRestoreCo === null) {
      saSetModalMsg("saCoMsg", false, "İşlem iptal edildi.");
      return;
    }
    if (String(adminPwRestoreCo).trim() === "") {
      saSetModalMsg("saCoMsg", false, "Kurucu şifresi gerekli.");
      return;
    }
    adminPwRestoreCo = String(adminPwRestoreCo).trim();
    saTransientAuth = true;

    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(secondaryAuth, origEmail, curPw);
    if (secondaryAuth.currentUser.uid !== uid) throw new Error("Oturum kullanıcısı eşleşmedi.");
    if (newU !== origU) {
      await updateEmail(newU + EMAIL_DOMAIN, curPw);
    }
    if (newPw.length >= 8) {
      await updatePassword(newPw, curPw);
    }
    var coPayload = {
      username: newU,
      institutionName: inst,
      phone: ph || null,
      packageType: pkg,
    };
    if (newPw.length >= 8) coPayload.plainPassword = newPw;
    await updateDoc(doc(db, "users", uid), coPayload);
    await signOut(secondaryAuth);
    await signInWithEmailAndPassword(auth, adminEmailRestoreCo, adminPwRestoreCo);
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
    try {
      if (adminEmailRestoreCo && adminPwRestoreCo) {
        await signInWithEmailAndPassword(auth, adminEmailRestoreCo, adminPwRestoreCo);
      }
    } catch (_e) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Mevcut şifre hatalı.";
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kullanılıyor.";
    saSetModalMsg("saCoMsg", false, msg);
  } finally {
    saTransientAuth = false;
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
  if (!window.confirm("Koç hesabı ve verisi silinecek. Emin misiniz?")) return;
  var adminEmailRestoreDel = "";
  var adminPwRestoreDel = "";
  try {
    var usnap = await getDoc(doc(db, "users", uid));
    var pw =
      usnap.exists && usnap.data().plainPassword != null
        ? String(usnap.data().plainPassword).trim()
        : "";
    if (!pw) {
      alert(
        "Bu hesap için şifre bu panelde kayıtlı değil. Silmek için kullanıcı yönetim ekranını kullanın veya düzenle ile yeni şifre kaydedin."
      );
      return;
    }

    adminEmailRestoreDel = auth.currentUser && auth.currentUser.email;
    if (!adminEmailRestoreDel) {
      alert("Oturum e-postası bulunamadı.");
      return;
    }
    adminPwRestoreDel = window.prompt("Kurucu şifreniz (işlem sonunda oturumunuz açılır):");
    if (adminPwRestoreDel === null) {
      alert("İşlem iptal edildi.");
      return;
    }
    if (String(adminPwRestoreDel).trim() === "") {
      alert("Kurucu şifresi gerekli.");
      return;
    }
    adminPwRestoreDel = String(adminPwRestoreDel).trim();
    saTransientAuth = true;

    var docDeleted = false;
    try {
      await deleteDoc(doc(db, "users", uid));
      docDeleted = true;
    } catch (eDel) {
      console.warn("[deleteCoach] deleteDoc (kurucu oturumu):", eDel);
    }

    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(secondaryAuth, origEmail, pw);
    if (secondaryAuth.currentUser.uid !== uid) throw new Error("Kimlik doğrulanamadı.");

    if (!docDeleted) {
      try {
        await deleteDoc(doc(db, "users", uid));
      } catch (eDel2) {
        console.warn("[deleteCoach] deleteDoc (koç oturumu):", eDel2);
      }
    }

    await blockCurrentAccount();
    await signOut(secondaryAuth);
    await signInWithEmailAndPassword(auth, adminEmailRestoreDel, adminPwRestoreDel);
    alert("Koç kaydı silindi ve giriş hesabı kalıcı olarak engellendi.");
    saCloseModals();
  } catch (err) {
    console.error(err);
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    try {
      if (adminEmailRestoreDel && adminPwRestoreDel) {
        await signInWithEmailAndPassword(auth, adminEmailRestoreDel, adminPwRestoreDel);
      }
    } catch (_e) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential") msg = "Şifre hatalı.";
    if (err.code === 401 || err.code === 400) msg = msg || "İşlem reddedildi (şifre veya oturum).";
    alert(msg);
  } finally {
    saTransientAuth = false;
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

function saLocalDayBoundsMs() {
  var start = new Date();
  start.setHours(0, 0, 0, 0);
  var end = new Date();
  end.setHours(23, 59, 59, 999);
  return { start: start.getTime(), end: end.getTime() };
}

function saCountDocsWithLastLoginToday(docs) {
  var b = saLocalDayBoundsMs();
  var n = 0;
  for (var i = 0; i < docs.length; i++) {
    var lu = toJsDate(docs[i].data().lastLogin);
    if (!lu) continue;
    var t = lu.getTime();
    if (t >= b.start && t <= b.end) n++;
  }
  return n;
}

function refreshDailyHomeStats() {
  var elS = document.getElementById("saHomeStudentsToday");
  var elC = document.getElementById("saHomeCoachesToday");
  var elD = document.getElementById("saHomeDateLabel");
  if (!elS || !elC) return;
  var coachList = lastCoachDocs.filter(function (d) {
    return (d.data().role || "") === "coach";
  });
  elC.textContent = String(saCountDocsWithLastLoginToday(coachList));
  elS.textContent = String(saCountDocsWithLastLoginToday(lastStudentDocs));
  if (elD) {
    elD.textContent = new Date().toLocaleDateString("tr-TR", {
      weekday: "long",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  }
}

async function updateKpiCardsAndTotals(coachDocs) {
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
}

async function updateAdminLoginChart() {
  var keys = last7DayKeys();
  var chartLabels = keys.map(labelForDayKey);
  var chartValues = await fetchLoginLogByDay();
  renderOrUpdateChart(chartLabels, chartValues);
}

async function refreshKpisAndChart(coachDocs) {
  await updateKpiCardsAndTotals(coachDocs);
  refreshDailyHomeStats();
  if (saCanonicalRoute() === "grafik") {
    await updateAdminLoginChart();
  }
}

function saCanonicalRoute() {
  var raw = (location.hash || "").replace(/^#/, "").trim();
  var k = raw.toLowerCase();
  if (!k) return "home";
  var legacy = {
    anasayfa: "home",
    home: "home",
    "sa-section-kpi": "ozet",
    sasectionmaintenance: "bakim",
    sasectionquotes: "teklifler",
    "sa-section-chart": "grafik",
    "sa-section-create-coach": "yeni-koc",
    "sa-section-create-student": "yeni-ogrenci",
    "sa-section-students": "ogrenciler",
    "sa-section-coaches": "koclar",
  };
  if (legacy[k]) return legacy[k];
  var pages = [
    "home",
    "ozet",
    "bakim",
    "teklifler",
    "grafik",
    "yeni-koc",
    "yeni-ogrenci",
    "ogrenciler",
    "koclar",
    "arac-net",
    "arac-yks",
    "destek",
    "admin-yonetimi",
    "sistem",
  ];
  if (pages.indexOf(k) >= 0) return k;
  return "home";
}

var saDestekCache = [];
var saDestekWired = false;

function saDestekCategoryLabel(k) {
  var m = {
    sistem_bug: "Sistem Hatası (Bug)",
    tasarim: "Tasarım / Görsel",
    ozellik: "Yeni Özellik Önerisi",
    diger: "Diğer",
  };
  return m[k] || k || "—";
}

function saDestekPriorityWeight(p) {
  if (p === "acil") return 3;
  if (p === "normal") return 2;
  if (p === "dusuk") return 1;
  return 0;
}

function saDestekPriorityBadge(oncelik) {
  var o = String(oncelik || "normal");
  var cls = "sa-pri sa-pri--normal";
  var label = "Normal";
  if (o === "acil") {
    cls = "sa-pri sa-pri--acil";
    label = "Acil";
  } else if (o === "dusuk") {
    cls = "sa-pri sa-pri--dusuk";
    label = "Düşük";
  }
  return '<span class="' + cls + '">' + escapeHtml(label) + "</span>";
}

function saDestekDocCreatedMs(raw) {
  if (!raw) return 0;
  var iso = raw.$createdAt ? raw.$createdAt : "";
  var d = parseFlexibleDate(iso);
  return d ? d.getTime() : 0;
}

function getSaDestekFilters() {
  var q = saNormLower(document.getElementById("saDestekSearch") && document.getElementById("saDestekSearch").value);
  var sortDate = (document.getElementById("saDestekSortDate") && document.getElementById("saDestekSortDate").value) || "new";
  var pri = (document.getElementById("saDestekFilterPriority") && document.getElementById("saDestekFilterPriority").value) || "all";
  return { q: q, sortDate: sortDate, pri: pri };
}

function renderSaDestekTable() {
  var tb = document.getElementById("saDestekTableBody");
  if (!tb) return;
  var f = getSaDestekFilters();

  var rows = saDestekCache.slice().filter(function (item) {
    var raw = item.data;
    var ad = saNormLower(raw.ad_soyad || "");
    var ku = saNormLower(raw.kullanici_eposta || "");
    var det = saNormLower(raw.detay || "");
    var sy = saNormLower(raw.sayfa_yolu || "");
    var matchQ =
      !f.q || ad.indexOf(f.q) !== -1 || ku.indexOf(f.q) !== -1 || det.indexOf(f.q) !== -1 || sy.indexOf(f.q) !== -1;
    var matchPri = f.pri !== "acil" || String(raw.oncelik || "") === "acil";
    return matchQ && matchPri;
  });

  rows.sort(function (a, b) {
    var ra = a.data;
    var rb = b.data;
    if (f.pri === "sort_pri") {
      var diff = saDestekPriorityWeight(rb.oncelik) - saDestekPriorityWeight(ra.oncelik);
      if (diff !== 0) return diff;
    }
    var ta = saDestekDocCreatedMs(ra);
    var tbMs = saDestekDocCreatedMs(rb);
    if (f.sortDate === "old") return ta - tbMs;
    return tbMs - ta;
  });

  if (rows.length === 0) {
    tb.innerHTML =
      '<tr><td colspan="8" class="mono" style="padding:1.75rem">Kayıt yok veya filtreye uyan talep bulunamadı.</td></tr>';
    return;
  }

  tb.innerHTML = rows
    .map(function (item) {
      var raw = item.data;
      var when = formatDateTimeTr(raw.$createdAt || raw.$updatedAt, { withSeconds: true });
      var sender =
        "<strong>" +
        escapeHtml(raw.ad_soyad || "—") +
        '</strong><br/><span class="mono" style="font-size:0.78rem;color:var(--muted)">' +
        escapeHtml(raw.kullanici_eposta || "—") +
        "</span>";
      var cat = saDestekCategoryLabel(raw.kategori);
      var pri = saDestekPriorityBadge(raw.oncelik);
      var sp = String(raw.sayfa_yolu || "—");
      var page =
        '<span class="mono" title="' +
        escapeHtml(sp) +
        '">' +
        escapeHtml(sp.length > 52 ? sp.slice(0, 52) + "…" : sp) +
        "</span>";
      var det = String(raw.detay || "");
      var detShort = det.length > 160 ? det.slice(0, 160) + "…" : det;
      var hasReply = raw.admin_cevabi != null && String(raw.admin_cevabi).trim() !== "";
      var durumLabel = hasReply ? "Çözüldü" : String(raw.durum || "Açık");
      var durumHtml =
        '<span class="mono" style="font-size:0.82rem">' + escapeHtml(durumLabel) + "</span>";
      var fid = String(raw.ekran_goruntu_file_id || "").trim();
      var imgCell = "";
      if (fid) {
        try {
          var url = String(storage.getFileView(APPWRITE_BUCKET_DESTEK, fid) || "");
          if (url) {
            imgCell =
              '<a href="' +
              escapeHtml(url) +
              '" target="_blank" rel="noopener noreferrer" class="sa-destek-thumb-wrap"><img src="' +
              escapeHtml(url) +
              '" alt="Ek" class="sa-destek-thumb" loading="lazy"/></a>';
          }
        } catch (e) {
          imgCell = '<span class="mono">Dosya: ' + escapeHtml(fid.slice(0, 14)) + "…</span>";
        }
      }
      return (
        "<tr>" +
        '<td class="mono">' +
        escapeHtml(when) +
        "</td>" +
        "<td>" +
        sender +
        "</td>" +
        "<td>" +
        escapeHtml(cat) +
        "</td>" +
        "<td>" +
        pri +
        "</td>" +
        "<td>" +
        durumHtml +
        "</td>" +
        "<td>" +
        page +
        "</td>" +
        '<td><div class="sa-destek-detail" title="' +
        escapeHtml(det) +
        '">' +
        escapeHtml(detShort) +
        "</div>" +
        (imgCell ? '<div class="sa-destek-imgcell">' + imgCell + "</div>" : "") +
        "</td>" +
        '<td><button type="button" class="btn-ghost sa-destek-reply-btn" data-sa-destek-id="' +
        escapeHtml(String(item.id)) +
        '">Cevapla</button></td>' +
        "</tr>"
      );
    })
    .join("");
}

async function loadSaDestekTickets(force) {
  var tb = document.getElementById("saDestekTableBody");
  if (!tb) return;
  if (!force && saDestekCache.length) {
    renderSaDestekTable();
    return;
  }
  tb.innerHTML = '<tr><td colspan="8" class="mono" style="padding:1.75rem">Yükleniyor…</td></tr>';
  try {
    var snap = await getDocs(collection(db, "hata_bildirimleri"));
    saDestekCache = snap.docs.map(function (d) {
      return { id: d.id, data: d.data() };
    });
    renderSaDestekTable();
  } catch (e) {
    console.warn("[destek]", e);
    tb.innerHTML =
      '<tr><td colspan="8" class="mono" style="padding:1.75rem;color:#fca5a5">Liste yüklenemedi. Appwrite’da <code>hata_bildirimleri</code> koleksiyonu ve okuma izinleri kontrol edilmelidir.</td></tr>';
  }
}

function wireSaDestekOnce() {
  if (saDestekWired) return;
  saDestekWired = true;
  var s = document.getElementById("saDestekSearch");
  var sd = document.getElementById("saDestekSortDate");
  var sp = document.getElementById("saDestekFilterPriority");
  var rf = document.getElementById("saDestekRefresh");
  if (s) s.addEventListener("input", renderSaDestekTable);
  if (sd) sd.addEventListener("change", renderSaDestekTable);
  if (sp) sp.addEventListener("change", renderSaDestekTable);
  if (rf)
    rf.addEventListener("click", function () {
      saDestekCache = [];
      loadSaDestekTickets(true);
    });
  var tb = document.getElementById("saDestekTableBody");
  if (tb && !tb.dataset.saReplyBound) {
    tb.dataset.saReplyBound = "1";
    tb.addEventListener("click", function (ev) {
      var btn = ev.target.closest && ev.target.closest(".sa-destek-reply-btn[data-sa-destek-id]");
      if (!btn) return;
      ev.preventDefault();
      var id = btn.getAttribute("data-sa-destek-id");
      if (id) saOpenDestekReplyModal(id);
    });
  }
  var drm = document.getElementById("saDestekReplyModal");
  if (drm && !drm.dataset.saBound) {
    drm.dataset.saBound = "1";
    drm.querySelectorAll("[data-sa-destek-reply-close]").forEach(function (el) {
      el.addEventListener("click", function () {
        saCloseDestekReplyModal();
      });
    });
    var sub = document.getElementById("saDestekReplySubmit");
    if (sub) {
      sub.addEventListener("click", function () {
        void saSubmitDestekReply();
      });
    }
  }
}

var saDestekReplyDocId = "";

function saOpenDestekReplyModal(docId) {
  saDestekReplyDocId = String(docId || "");
  var item = saDestekCache.find(function (x) {
    return x.id === saDestekReplyDocId;
  });
  var hint = document.getElementById("saDestekReplyHint");
  var ta = document.getElementById("saDestekReplyText");
  var modal = document.getElementById("saDestekReplyModal");
  var msg = document.getElementById("saDestekReplyMsg");
  if (msg) {
    msg.textContent = "";
    msg.className = "sa-modal__msg";
  }
  if (ta && item && item.data) {
    var raw = item.data;
    ta.value = String(raw.admin_cevabi || "").trim();
    if (hint) {
      var s = String(raw.detay || "").trim();
      hint.innerHTML =
        "<strong>Gönderen:</strong> " +
        escapeHtml(raw.ad_soyad || "—") +
        "<br/><strong>Talep:</strong> " +
        escapeHtml(s.length > 280 ? s.slice(0, 280) + "…" : s || "—");
    }
  } else {
    if (ta) ta.value = "";
    if (hint) hint.textContent = "";
  }
  if (modal) modal.hidden = false;
}

function saCloseDestekReplyModal() {
  var modal = document.getElementById("saDestekReplyModal");
  if (modal) modal.hidden = true;
  saDestekReplyDocId = "";
}

async function saSubmitDestekReply() {
  var id = saDestekReplyDocId;
  var ta = document.getElementById("saDestekReplyText");
  var msg = document.getElementById("saDestekReplyMsg");
  var text = ta ? String(ta.value || "").trim() : "";
  if (!id) return;
  if (text.length < 2) {
    if (msg) {
      msg.textContent = "Lütfen yanıt metni girin.";
      msg.className = "sa-modal__msg is-err";
    }
    return;
  }
  var btn = document.getElementById("saDestekReplySubmit");
  if (btn) btn.disabled = true;
  try {
    await updateDoc(doc(db, "hata_bildirimleri", id), {
      admin_cevabi: text,
      durum: "Çözüldü",
      okundu_mu: false,
    });
    saCloseDestekReplyModal();
    saDestekCache = [];
    await loadSaDestekTickets(true);
  } catch (e) {
    console.error(e);
    if (msg) {
      msg.textContent = e && e.message ? String(e.message) : "Kayıt başarısız.";
      msg.className = "sa-modal__msg is-err";
    }
  } finally {
    if (btn) btn.disabled = false;
  }
}

function saApplyRoute() {
  var route = saCanonicalRoute();
  document.querySelectorAll(".sa-view").forEach(function (el) {
    var p = el.getAttribute("data-sa-page");
    el.classList.toggle("is-active", p === route);
  });
  document.querySelectorAll(".sa-nav-link[data-sa-route]").forEach(function (a) {
    var r = a.getAttribute("data-sa-route");
    a.classList.toggle("is-active", r === route);
  });
  try {
    window.scrollTo(0, 0);
  } catch (e) {}
  if (route === "grafik") {
    updateAdminLoginChart().catch(function (err) {
      console.warn("[super-admin] chart:", err);
    });
  }
  if (route === "destek") {
    wireSaDestekOnce();
    loadSaDestekTickets(false);
  }
  if (route === "admin-yonetimi") {
    wireSaAdminsOnce();
    loadSaAdminsList(false);
  }
  if (route === "sistem") {
    loadSaSystemStatusOnce();
  }
}

var saAdminsCache = [];
var saAdminsWired = false;
var saAdminsToastTm = null;

function saToast(ok, message) {
  var el = document.getElementById("saAppToast");
  if (!el) {
    alert(message);
    return;
  }
  clearTimeout(saAdminsToastTm);
  el.textContent = message;
  el.className = "sa-app-toast " + (ok ? "sa-app-toast--ok" : "sa-app-toast--err");
  el.hidden = false;
  saAdminsToastTm = setTimeout(function () {
    try {
      el.hidden = true;
    } catch (e) {}
  }, 3800);
}

function saYetkiLabel(v) {
  var x = String(v || "").toLowerCase();
  if (x === "tam") return "Tam yetki";
  if (x === "orta") return "Orta (sınırlı)";
  if (x === "salt_okunur") return "Salt okunur";
  return v ? String(v) : "—";
}

/** Appwrite `users` şemasına uygun yetki kodları (packageType). */
var SA_ADMIN_PKG = { tam: "Admin_Tam", orta: "Admin_Orta", salt_okunur: "Admin_Salt" };
var SA_ADMIN_TABLE_COLSPAN = 6;

function saAdminPkgToSelect(pkg) {
  var p = String(pkg || "");
  if (p === "Admin_Tam" || p === "tam") return "tam";
  if (p === "Admin_Orta" || p === "orta") return "orta";
  if (p === "Admin_Salt" || p === "salt_okunur") return "salt_okunur";
  return "tam";
}

function saAdminYetkiLabelFromRaw(raw) {
  return saYetkiLabel(saAdminPkgToSelect(raw && (raw.packageType || raw.yetki_seviyesi)));
}

function saAdminNameFromRaw(raw) {
  return String((raw && (raw.ad_soyad || raw.adSoyad || raw.fullName)) || "—")
    .trim() || "—";
}

/** E-posta: şemada ayrı alan yoksa institutionName (yetkili satırlarında iletişim). */
function saAdminEmailFromRaw(raw) {
  if (!raw) return "";
  var e = String(raw.email || "").trim();
  if (e) return e;
  var inst = String(raw.institutionName || "").trim();
  if (inst.indexOf("@") !== -1) return inst.toLowerCase();
  return inst;
}

/** Kayıt notu şifresi (users.plainPassword; kurucu panelinde görünür). */
function saAdminPlainPasswordDisplay(raw) {
  var p = raw && raw.plainPassword != null ? String(raw.plainPassword).trim() : "";
  if (!p) return "—";
  return p;
}

function saAdminCompatError(err) {
  var m = err && err.message != null ? String(err.message) : String(err);
  if (/Unknown attribute|Invalid document structure/i.test(m)) {
    return (
      "Appwrite şeması: " +
      m +
      " Yalnızca tanımlı kullanıcı alanları kullanılıyor (ör. fullName, username, institutionName, packageType)."
    );
  }
  return m;
}

async function loadSaAdminsList(force) {
  var tb = document.getElementById("saAdminTableBody");
  if (!tb) return;
  if (!force && saAdminsCache.length) {
    renderSaAdminsTable();
    return;
  }
  tb.innerHTML =
    '<tr><td colspan="' +
    SA_ADMIN_TABLE_COLSPAN +
    '" class="mono" style="padding:1.75rem">Yükleniyor…</td></tr>';
  try {
    var qUsers = query(collection(db, "users"), where("role", "==", APPWRITE_ADMIN_ROSTER_ROLE));
    var snap = await getDocs(qUsers);
    saAdminsCache = snap.docs.map(function (d) {
      return { id: d.id, data: typeof d.data === "function" ? d.data() : {} };
    });
    renderSaAdminsTable();
  } catch (e) {
    console.warn("[admin-roster]", e);
    saAdminsCache = [];
    tb.innerHTML =
      '<tr><td colspan="' +
      SA_ADMIN_TABLE_COLSPAN +
      '" class="mono" style="padding:1.75rem;color:#fca5a5">Liste yüklenemedi. <code>users</code> koleksiyonunda <code>role</code> alanı ve okuma izinlerini kontrol edin. (Hata: ' +
      escapeHtml((e && e.message) || String(e)) +
      ")</td></tr>";
  }
}

function renderSaAdminsTable() {
  var tb = document.getElementById("saAdminTableBody");
  if (!tb) return;
  var q = saNormLower(document.getElementById("saAdminSearch") && document.getElementById("saAdminSearch").value);
  var rows = saAdminsCache.filter(function (item) {
    var raw = item.data || {};
    var un = saNormLower(raw.username || "");
    var ad = saNormLower(raw.ad_soyad || raw.adSoyad || raw.fullName || "");
    var em = saNormLower(saAdminEmailFromRaw(raw));
    var y = saNormLower(saAdminYetkiLabelFromRaw(raw));
    var pkg = saNormLower(String(raw.packageType || ""));
    var pw = saNormLower(saAdminPlainPasswordDisplay(raw));
    if (pw === "—") pw = "";
    if (!q) return true;
    return (
      un.indexOf(q) !== -1 ||
      ad.indexOf(q) !== -1 ||
      em.indexOf(q) !== -1 ||
      y.indexOf(q) !== -1 ||
      pkg.indexOf(q) !== -1 ||
      (pw && pw.indexOf(q) !== -1)
    );
  });
  if (rows.length === 0) {
    tb.innerHTML =
      '<tr><td colspan="' +
      SA_ADMIN_TABLE_COLSPAN +
      '" class="mono sa-empty-filter" style="padding:1.75rem">Kayıt yok veya aramaya uygun satır bulunamadı.</td></tr>';
    return;
  }
  tb.innerHTML = rows
    .map(function (item) {
      var raw = item.data || {};
      var uDisp = escapeHtml(String(raw.username || "—").trim() || "—");
      var ad = escapeHtml(saAdminNameFromRaw(raw));
      var em = escapeHtml(String(saAdminEmailFromRaw(raw) || "—").trim() || "—");
      var pwDisp = saAdminPlainPasswordDisplay(raw);
      var pwHtml =
        pwDisp === "—"
          ? '<span style="color:#8b95a8">—</span>'
          : '<span class="mono" style="font-size:0.8rem;word-break:break-word">' +
            escapeHtml(pwDisp) +
            "</span>";
      var yv = saAdminYetkiLabelFromRaw(raw);
      return (
        "<tr>" +
        '<td class="mono" style="font-size:0.85rem">' +
        uDisp +
        "</td>" +
        "<td><strong>" +
        ad +
        "</strong></td>" +
        '<td class="mono" style="font-size:0.85rem">' +
        em +
        "</td>" +
        '<td style="max-width:14rem;line-height:1.35">' +
        pwHtml +
        "</td>" +
        "<td>" +
        escapeHtml(yv) +
        "</td>" +
        '<td><div class="sa-admin-actions">' +
        '<button type="button" class="btn-ghost sa-admin-edit" data-sa-admin-id="' +
        escapeHtml(String(item.id)) +
        '"><i class="fa-solid fa-pen"></i> Düzenle</button> ' +
        '<button type="button" class="btn-danger sa-admin-del" data-sa-admin-id="' +
        escapeHtml(String(item.id)) +
        '"><i class="fa-solid fa-trash"></i> Sil</button>' +
        "</div></td>" +
        "</tr>"
      );
    })
    .join("");
}

function saCloseAdminModals() {
  var a = document.getElementById("saModalAdminCreate");
  var b = document.getElementById("saModalAdminEdit");
  if (a) a.hidden = true;
  if (b) b.hidden = true;
}

function saCloseProfileModal() {
  var p = document.getElementById("saModalSaProfile");
  if (p) p.hidden = true;
}

function wireSaAdminsOnce() {
  if (saAdminsWired) return;
  saAdminsWired = true;
  var s = document.getElementById("saAdminSearch");
  if (s) s.addEventListener("input", renderSaAdminsTable);
  var rf = document.getElementById("saAdminRefresh");
  if (rf)
    rf.addEventListener("click", function () {
      saAdminsCache = [];
      loadSaAdminsList(true);
    });
  var openC = document.getElementById("btnSaAdminOpenCreate");
  if (openC) {
    openC.addEventListener("click", function () {
      saSetModalMsg("saAdCreateMsg", true, "");
      var n = document.getElementById("saAdCreateName");
      var u = document.getElementById("saAdCreateUsername");
      var e = document.getElementById("saAdCreateEmail");
      var p = document.getElementById("saAdCreatePw");
      var y = document.getElementById("saAdCreateYetki");
      if (n) n.value = "";
      if (u) u.value = "";
      if (e) e.value = "";
      if (p) p.value = "";
      if (y) y.value = "tam";
      var m = document.getElementById("saModalAdminCreate");
      if (m) m.hidden = false;
    });
  }
  document.querySelectorAll("[data-sa-admin-close]").forEach(function (el) {
    el.addEventListener("click", saCloseAdminModals);
  });
  var subC = document.getElementById("saAdCreateSubmit");
  if (subC) {
    subC.addEventListener("click", async function () {
      var n = (document.getElementById("saAdCreateName") && document.getElementById("saAdCreateName").value) || "";
      var un = sanitizeUsername(
        document.getElementById("saAdCreateUsername") && document.getElementById("saAdCreateUsername").value
      );
      var em = (document.getElementById("saAdCreateEmail") && document.getElementById("saAdCreateEmail").value) || "";
      var pw = (document.getElementById("saAdCreatePw") && document.getElementById("saAdCreatePw").value) || "";
      var y = (document.getElementById("saAdCreateYetki") && document.getElementById("saAdCreateYetki").value) || "tam";
      n = String(n).trim();
      em = String(em).trim().toLowerCase();
      if (!n || !em) {
        saSetModalMsg("saAdCreateMsg", false, "Ad soyad ve e-posta zorunludur.");
        return;
      }
      if (!un) {
        saSetModalMsg("saAdCreateMsg", false, "Kullanıcı adı zorunludur (yalnızca a-z, 0-9, _).");
        return;
      }
      if (pw.length < 8) {
        saSetModalMsg(
          "saAdCreateMsg",
          false,
          "Giriş için Appwrite hesabı açılır: şifre en az 8 karakter olmalıdır (kurucu ile aynı mantık: kullaniciadi@sistem.com)."
        );
        return;
      }
      var adminEmail = auth.currentUser && auth.currentUser.email;
      if (!adminEmail) {
        saSetModalMsg("saAdCreateMsg", false, "Oturum e-postası bulunamadı.");
        return;
      }
      var adminPw = takeSaReauthPasswordForCreate();
      if (!adminPw) {
        saSetModalMsg(
          "saAdCreateMsg",
          false,
          "Kurucu şifresi bu oturumda hazır değil. Çıkış yapıp kurucu olarak yeniden giriş yaptıktan sonra tekrar deneyin."
        );
        return;
      }
      var loginEmail = un + EMAIL_DOMAIN;
      subC.disabled = true;
      saTransientAuth = true;
      try {
        var cred = await createUserWithEmailAndRestoreAdmin(
          tertiaryAuth,
          adminEmail,
          String(adminPw).trim(),
          loginEmail,
          pw
        );
        var payloadAd = {
          role: APPWRITE_ADMIN_ROSTER_ROLE,
          username: un,
          fullName: n,
          institutionName: em,
          packageType: SA_ADMIN_PKG[y] || SA_ADMIN_PKG.tam,
          frozen: false,
          plainPassword: pw,
          createdAt: serverTimestamp(),
        };
        await setDoc(doc(db, "users", cred.user.uid), payloadAd);
        saCloseAdminModals();
        saToast(true, "Yetkili kaydedildi. Giriş: Kurucu sekmesi, kullanıcı adı «" + un + "», aynı şifre.");
        saAdminsCache = [];
        await loadSaAdminsList(true);
      } catch (err) {
        console.error(err);
        var msg = saAdminCompatError(err);
        if (err && err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten Appwrite’da kayıtlı (başka rol veya eski hesap).";
        saSetModalMsg("saAdCreateMsg", false, msg);
      } finally {
        saTransientAuth = false;
        subC.disabled = false;
      }
    });
  }
  var subE = document.getElementById("saAdEditSubmit");
  if (subE) {
    subE.addEventListener("click", async function () {
      var id = (document.getElementById("saAdEditDocId") && document.getElementById("saAdEditDocId").value) || "";
      var un = sanitizeUsername(
        document.getElementById("saAdEditUsername") && document.getElementById("saAdEditUsername").value
      );
      var n = (document.getElementById("saAdEditName") && document.getElementById("saAdEditName").value) || "";
      var em = (document.getElementById("saAdEditEmail") && document.getElementById("saAdEditEmail").value) || "";
      var y = (document.getElementById("saAdEditYetki") && document.getElementById("saAdEditYetki").value) || "tam";
      var np = (document.getElementById("saAdEditNewPw") && document.getElementById("saAdEditNewPw").value) || "";
      n = String(n).trim();
      em = String(em).trim().toLowerCase();
      if (!id) return;
      if (!n) {
        saSetModalMsg("saAdEditMsg", false, "Ad soyad boş olamaz.");
        return;
      }
      if (!un) {
        saSetModalMsg("saAdEditMsg", false, "Kullanıcı adı zorunludur (yalnızca a-z, 0-9, _).");
        return;
      }
      if (!em) {
        saSetModalMsg("saAdEditMsg", false, "E-posta (iletişim) zorunludur.");
        return;
      }
      if (np.length > 0 && np.length < 8) {
        saSetModalMsg("saAdEditMsg", false, "Yeni şifre en az 8 karakter olmalıdır (veya boş bırakın).");
        return;
      }
      subE.disabled = true;
      try {
        var payload = {
          fullName: n,
          username: un,
          institutionName: em,
          packageType: SA_ADMIN_PKG[y] || SA_ADMIN_PKG.tam,
        };
        if (np.length >= 8) payload.plainPassword = np;
        await updateDoc(doc(db, "users", id), payload);
        saCloseAdminModals();
        saToast(true, "Kayıt güncellendi.");
        saAdminsCache = [];
        await loadSaAdminsList(true);
      } catch (err) {
        console.error(err);
        saSetModalMsg("saAdEditMsg", false, saAdminCompatError(err));
      } finally {
        subE.disabled = false;
      }
    });
  }
  var tb = document.getElementById("saAdminTableBody");
  if (tb) {
    tb.addEventListener("click", function (ev) {
      var editBtn = ev.target.closest && ev.target.closest(".sa-admin-edit");
      var delBtn = ev.target.closest && ev.target.closest(".sa-admin-del");
      if (editBtn) {
        var eid = editBtn.getAttribute("data-sa-admin-id");
        var item = saAdminsCache.find(function (x) {
          return x.id === eid;
        });
        if (!item) return;
        var raw = item.data || {};
        document.getElementById("saAdEditDocId").value = item.id;
        var uEd = document.getElementById("saAdEditUsername");
        if (uEd) uEd.value = String(raw.username || "").trim();
        document.getElementById("saAdEditName").value = String(
          raw.ad_soyad || raw.adSoyad || raw.fullName || ""
        ).trim();
        var emIn = document.getElementById("saAdEditEmail");
        if (emIn) emIn.value = saAdminEmailFromRaw(raw);
        var ysel = document.getElementById("saAdEditYetki");
        if (ysel) ysel.value = saAdminPkgToSelect(raw.packageType || raw.yetki_seviyesi);
        var np = document.getElementById("saAdEditNewPw");
        if (np) np.value = "";
        saSetModalMsg("saAdEditMsg", true, "");
        var me = document.getElementById("saModalAdminEdit");
        if (me) me.hidden = false;
        return;
      }
      if (delBtn) {
        var did = delBtn.getAttribute("data-sa-admin-id");
        if (!did || !confirm("Bu yetkili kaydını silmek istediğinize emin misiniz?")) return;
        (async function () {
          try {
            await deleteDoc(doc(db, "users", did));
            saToast(true, "Kayıt silindi.");
            saAdminsCache = [];
            await loadSaAdminsList(true);
          } catch (err) {
            console.error(err);
            saToast(false, (err && err.message) || "Silinemedi.");
          }
        })();
      }
    });
  }
}

document.getElementById("btnSaProfileSettings") &&
  document.getElementById("btnSaProfileSettings").addEventListener("click", async function () {
    var m = document.getElementById("saModalSaProfile");
    var msg = document.getElementById("saProfileMsg");
    if (msg) {
      msg.textContent = "";
      msg.className = "sa-modal__msg";
      msg.style.display = "none";
    }
    var n = document.getElementById("saProfileName");
    var em = document.getElementById("saProfileEmailRo");
    var c1 = document.getElementById("saProfileCurPw");
    var p1 = document.getElementById("saProfileNewPw");
    var p2 = document.getElementById("saProfileNewPw2");
    if (c1) c1.value = "";
    if (p1) p1.value = "";
    if (p2) p2.value = "";
    try {
      var vr = await verifyAppwriteAccount(6000);
      if (vr.ok && vr.user) {
        if (n) n.value = String(vr.user.name || "").trim();
        if (em) em.textContent = String(vr.user.email || auth.currentUser.email || "—");
      } else if (auth.currentUser && auth.currentUser.email && em) {
        em.textContent = auth.currentUser.email;
      }
    } catch (e) {
      console.warn(e);
    }
    if (m) m.hidden = false;
  });

document.querySelectorAll("[data-sa-profile-close]").forEach(function (el) {
  el.addEventListener("click", saCloseProfileModal);
});

var saProfileSubmitEl = document.getElementById("saProfileSubmit");
if (saProfileSubmitEl) {
  saProfileSubmitEl.addEventListener("click", async function () {
    var msg = document.getElementById("saProfileMsg");
    var name = (document.getElementById("saProfileName") && document.getElementById("saProfileName").value) || "";
    name = String(name).trim();
    var cur = (document.getElementById("saProfileCurPw") && document.getElementById("saProfileCurPw").value) || "";
    var np = (document.getElementById("saProfileNewPw") && document.getElementById("saProfileNewPw").value) || "";
    var np2 = (document.getElementById("saProfileNewPw2") && document.getElementById("saProfileNewPw2").value) || "";
    if (!name) {
      if (msg) {
        msg.textContent = "Görünen ad boş olamaz.";
        msg.className = "sa-modal__msg is-err";
        msg.style.display = "block";
      }
      return;
    }
    var passCh = np.length > 0 || np2.length > 0;
    if (passCh) {
      if (np.length < 8) {
        if (msg) {
          msg.textContent = "Yeni şifre en az 8 karakter olmalıdır.";
          msg.className = "sa-modal__msg is-err";
          msg.style.display = "block";
        }
        return;
      }
      if (np !== np2) {
        if (msg) {
          msg.textContent = "Yeni şifreler eşleşmiyor.";
          msg.className = "sa-modal__msg is-err";
          msg.style.display = "block";
        }
        return;
      }
      if (!cur) {
        if (msg) {
          msg.textContent = "Şifre değişikliği için mevcut şifrenizi girin.";
          msg.className = "sa-modal__msg is-err";
          msg.style.display = "block";
        }
        return;
      }
    }
    saProfileSubmitEl.disabled = true;
    try {
      await verifyAppwriteAccount(4000);
      await updateAccountName(name);
      if (passCh) {
        await updatePassword(np, cur);
      }
      await verifyAppwriteAccount(4000);
      saCloseProfileModal();
      saToast(true, "Bilgileriniz güncellendi.");
    } catch (err) {
      console.error(err);
      if (msg) {
        msg.textContent = (err && err.message) || "Güncelleme başarısız.";
        msg.className = "sa-modal__msg is-err";
        msg.style.display = "block";
      }
    } finally {
      saProfileSubmitEl.disabled = false;
    }
  });
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

function saPkgKeyFromLabel(pkg) {
  var p = String(pkg || "").trim();
  if (p === "Pro") return "pro";
  if (p === "Başlangıç") return "bas";
  return "other";
}

function saCoachPkgForUsername(username) {
  var u = String(username || "").trim();
  if (!u || !lastCoachDocs || !lastCoachDocs.length) return "other";
  for (var i = 0; i < lastCoachDocs.length; i++) {
    var d = lastCoachDocs[i];
    if ((d.data().role || "") !== "coach") continue;
    if (String(d.data().username || "") === u) return saPkgKeyFromLabel(d.data().packageType);
  }
  return "other";
}

function saNormLower(s) {
  return String(s || "")
    .toLowerCase()
    .trim();
}

var saCoachFiltersWired = false;
var saStudentFiltersWired = false;

function wireSaCoachFiltersOnce() {
  if (saCoachFiltersWired) return;
  saCoachFiltersWired = true;
  var s = document.getElementById("saCoachSearch");
  var p = document.getElementById("saCoachFilterPkg");
  var st = document.getElementById("saCoachFilterStatus");
  if (s) s.addEventListener("input", applySaCoachFilters);
  if (p) p.addEventListener("change", applySaCoachFilters);
  if (st) st.addEventListener("change", applySaCoachFilters);
}

function wireSaStudentFiltersOnce() {
  if (saStudentFiltersWired) return;
  saStudentFiltersWired = true;
  var s = document.getElementById("saStudentSearch");
  var c = document.getElementById("saStudentFilterCoach");
  var p = document.getElementById("saStudentFilterPkg");
  if (s) s.addEventListener("input", applySaStudentFilters);
  if (c) c.addEventListener("change", applySaStudentFilters);
  if (p) p.addEventListener("change", applySaStudentFilters);
}

function applySaCoachFilters() {
  wireSaCoachFiltersOnce();
  var tb = document.getElementById("coachesTableBody");
  if (!tb) return;
  var q = saNormLower(document.getElementById("saCoachSearch") && document.getElementById("saCoachSearch").value);
  var fp =
    (document.getElementById("saCoachFilterPkg") && document.getElementById("saCoachFilterPkg").value) || "all";
  var fs =
    (document.getElementById("saCoachFilterStatus") && document.getElementById("saCoachFilterStatus").value) ||
    "all";
  var rows = tb.querySelectorAll("tr.sa-coach-row");
  var emptyEl = document.getElementById("saCoachEmptyFilter");
  var n = 0;
  rows.forEach(function (tr) {
    var u = saNormLower(tr.getAttribute("data-sa-user") || "");
    var inst = saNormLower(tr.getAttribute("data-sa-inst") || "");
    var pkg = tr.getAttribute("data-sa-pkg") || "";
    var fr = tr.getAttribute("data-sa-frozen") === "1";
    var matchQ = !q || u.indexOf(q) !== -1 || inst.indexOf(q) !== -1;
    var matchP = fp === "all" || fp === pkg;
    var matchS =
      fs === "all" || (fs === "active" && !fr) || (fs === "frozen" && fr);
    var show = matchQ && matchP && matchS;
    tr.classList.toggle("is-filtered-out", !show);
    if (show) n++;
  });
  if (emptyEl) {
    emptyEl.hidden = rows.length === 0 || n > 0;
  }
}

function populateSaStudentCoachFilter() {
  var sel = document.getElementById("saStudentFilterCoach");
  if (!sel) return;
  var cur = sel.value;
  sel.innerHTML = '<option value="all">Tüm koçlar</option>';
  if (lastCoachDocs && lastCoachDocs.length) {
    lastCoachDocs.forEach(function (d) {
      if ((d.data().role || "") !== "coach") return;
      var u = d.data().username || "";
      if (!u) return;
      var o = document.createElement("option");
      o.value = u;
      o.textContent = u + (d.data().institutionName ? " · " + d.data().institutionName : "");
      sel.appendChild(o);
    });
  }
  if (
    cur &&
    Array.prototype.some.call(sel.options, function (opt) {
      return opt.value === cur;
    })
  ) {
    sel.value = cur;
  }
}

function saRefreshStudentRowCoachPkgs() {
  var tb = document.getElementById("studentsTableBody");
  if (!tb) return;
  tb.querySelectorAll("tr.sa-student-row").forEach(function (tr) {
    var coach = String(tr.getAttribute("data-sa-coach") || "").trim();
    if (coach === "—") coach = "";
    tr.setAttribute("data-sa-coach-pkg", saCoachPkgForUsername(coach));
  });
}

function applySaStudentFilters() {
  wireSaStudentFiltersOnce();
  var tb = document.getElementById("studentsTableBody");
  if (!tb) return;
  var q = saNormLower(document.getElementById("saStudentSearch") && document.getElementById("saStudentSearch").value);
  var fc =
    (document.getElementById("saStudentFilterCoach") && document.getElementById("saStudentFilterCoach").value) ||
    "all";
  var fp =
    (document.getElementById("saStudentFilterPkg") && document.getElementById("saStudentFilterPkg").value) || "all";
  var rows = tb.querySelectorAll("tr.sa-student-row");
  var emptyEl = document.getElementById("saStudentEmptyFilter");
  var n = 0;
  rows.forEach(function (tr) {
    var user = saNormLower(tr.getAttribute("data-sa-user") || "");
    var em = saNormLower(tr.getAttribute("data-sa-email") || "");
    var full = saNormLower(tr.getAttribute("data-sa-full") || "");
    var coach = String(tr.getAttribute("data-sa-coach") || "").trim();
    var pkg = tr.getAttribute("data-sa-coach-pkg") || "";
    var matchQ =
      !q || user.indexOf(q) !== -1 || em.indexOf(q) !== -1 || full.indexOf(q) !== -1 || saNormLower(coach).indexOf(q) !== -1;
    var matchC = fc === "all" || coach === fc;
    var matchP = fp === "all" || fp === pkg;
    var show = matchQ && matchC && matchP;
    tr.classList.toggle("is-filtered-out", !show);
    if (show) n++;
  });
  if (emptyEl) {
    emptyEl.hidden = rows.length === 0 || n > 0;
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
      var pkgKey = saPkgKeyFromLabel(pkg);
      var badge = pkg === "Pro" ? "badge--pro" : "badge--bas";
      var frozen = x.frozen === true;
      var n = await countStudentsForCoach(uname);
      var last = formatLastLogin(x.lastLogin);
      var uid = d.id;
      var email = sanitizeUsername(uname) + EMAIL_DOMAIN;

      return {
        html:
          '<tr class="sa-coach-row ' +
          (frozen ? "is-frozen" : "") +
          '" data-sa-user="' +
          escapeHtml(uname) +
          '" data-sa-inst="' +
          escapeHtml(inst) +
          '" data-sa-pkg="' +
          pkgKey +
          '" data-sa-frozen="' +
          (frozen ? "1" : "0") +
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

  tb.innerHTML =
    rows.map(function (r) {
      return r.html;
    }).join("") +
    '<tr id="saCoachEmptyFilter" class="sa-empty-filter" hidden><td colspan="6" class="sa-empty-filter">Aranan kriterlere uygun koç bulunamadı.</td></tr>';

  await refreshKpisAndChart(coachDocs);

  tb.querySelectorAll(".btn-action").forEach(function (btn) {
    btn.addEventListener("click", onTableAction);
  });

  populateStudentCoachSelect();
  populateSaStudentCoachFilter();
  saRefreshStudentRowCoachPkgs();
  applySaStudentFilters();
  applySaCoachFilters();
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
  lastStudentDocs = docs;
  if (docs.length === 0) {
    tb.innerHTML =
      '<tr><td colspan="5" class="mono" style="padding:1.75rem">Henüz kayıtlı öğrenci yok.</td></tr>';
    refreshDailyHomeStats();
    return;
  }
  tb.innerHTML = docs
    .map(function (d) {
      var x = d.data();
      var uid = d.id;
      var uname = x.username || "—";
      var full = (x.fullName || "").trim();
      var coach = x.coach_id || "—";
      var coachPkgK = saCoachPkgForUsername(coach === "—" ? "" : coach);
      var lastLogin = formatLastLogin(x.lastLogin);
      var lastPwd = formatLastLogin(x.lastPasswordChangeAt);
      var email = sanitizeUsername(uname) + EMAIL_DOMAIN;
      return (
        '<tr class="sa-student-row" data-sa-user="' +
        escapeHtml(uname) +
        '" data-sa-email="' +
        escapeHtml(email) +
        '" data-sa-coach="' +
        escapeHtml(coach) +
        '" data-sa-coach-pkg="' +
        coachPkgK +
        '" data-sa-full="' +
        escapeHtml(full) +
        '" data-uid="' +
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
    .join("") +
    '<tr id="saStudentEmptyFilter" class="sa-empty-filter" hidden><td colspan="5" class="sa-empty-filter">Aranan kriterlere uygun öğrenci bulunamadı.</td></tr>';
  tb.querySelectorAll("[data-student-act]").forEach(function (btn) {
    btn.addEventListener("click", onStudentTableAction);
  });
  populateSaStudentCoachFilter();
  applySaStudentFilters();
  refreshDailyHomeStats();
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

/** Yalnızca Appwrite belge $id — asla $collectionId kullanılmaz. */
function saQuoteDocumentId(d) {
  var x = d && typeof d.data === "function" ? d.data() : {};
  return String((x && x.$id) || (d && d.id) || "")
    .trim();
}

function saQuoteCollectionId(x) {
  return String((x && x.$collectionId) || APPWRITE_COLLECTION_QUOTE_REQUESTS).trim();
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
      var docId = saQuoteDocumentId(d);
      var collId = saQuoteCollectionId(x);
      if (!docId) {
        console.warn("[quoteRequests] Satır atlandı: Appwrite $id yok", d);
        return "";
      }
      if (x && x.$collectionId && x.$id && String(x.$collectionId) === String(x.$id)) {
        console.warn("[quoteRequests] $id ile $collectionId çakışıyor; satır atlandı", x);
        return "";
      }
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
        '<select class="sa-quote-status" data-quote-doc-id="' +
        escapeHtml(docId) +
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
        '<tr data-quote-id="' +
        escapeHtml(docId) +
        '" data-quote-coll-id="' +
        escapeHtml(collId) +
        '">' +
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
        escapeHtml(docId) +
        '" title="Teklifi sil"><i class="fa-solid fa-trash" aria-hidden="true"></i></button>' +
        "</td>" +
        "</tr>"
      );
    })
    .join("");
}

function subscribeQuoteRequests() {
  if (quotesUnsub) quotesUnsub();
  var q = query(collection(db, APPWRITE_COLLECTION_QUOTE_REQUESTS), orderBy("createdAt", "desc"));
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
          escapeHtml(err.message || "Teklifler yüklenemedi. Appwrite indeks/izinlerini kontrol edin.") +
          "</td></tr>";
      var badge = document.getElementById("saQuoteBadge");
      if (badge) badge.hidden = true;
    }
  );
}

document.addEventListener("change", async function (e) {
  var t = e.target;
  if (!t || !t.classList || !t.classList.contains("sa-quote-status")) return;
  var id = String(t.getAttribute("data-quote-doc-id") || "").trim();
  var was = t.getAttribute("data-was") || "new";
  var v = t.value;
  if (!id) return;
  var tr = t.closest && t.closest("tr");
  var collId = String((tr && tr.getAttribute("data-quote-coll-id")) || APPWRITE_COLLECTION_QUOTE_REQUESTS).trim();
  t.disabled = true;
  try {
    await databases.updateDocument(APPWRITE_DATABASE_ID, collId, id, { status: v });
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
  var del =
    e.target.closest && e.target.closest("button[data-sa-quote-del]");
  if (!del) return;
  var tr = del.closest && del.closest("tr[data-quote-id]");
  var id = String(del.getAttribute("data-sa-quote-del") || (tr && tr.getAttribute("data-quote-id")) || "").trim();
  var collId = String((tr && tr.getAttribute("data-quote-coll-id")) || APPWRITE_COLLECTION_QUOTE_REQUESTS).trim();
  if (!id) {
    alert("Belge kimliği okunamadı. Sayfayı yenileyip tekrar deneyin.");
    return;
  }
  if (!window.confirm("Bu teklif kaydı kalıcı olarak silinsin mi?")) return;
  del.disabled = true;
  try {
    await databases.deleteDocument(APPWRITE_DATABASE_ID, collId, id);
  } catch (err) {
    console.error(err);
    alert((err && err.message) || String(err));
  } finally {
    del.disabled = false;
  }
});

async function coachChangePassword(uid, email) {
  var oldPw = window.prompt("Koçun mevcut şifresi:", "");
  if (oldPw === null) return;
  var newPw = window.prompt("Yeni şifre (en az 8 karakter):", "");
  if (newPw === null) return;
  if (newPw.length < 8) {
    alert("Şifre en az 8 karakter olmalıdır.");
    return;
  }
  var adminEmailRestore = auth.currentUser && auth.currentUser.email;
  if (!adminEmailRestore) {
    alert("Oturum e-postası bulunamadı.");
    return;
  }
  var adminPwRestore = window.prompt("Kurucu şifreniz (işlem sonunda oturumunuz açılır):");
  if (adminPwRestore === null) {
    alert("İşlem iptal edildi.");
    return;
  }
  if (String(adminPwRestore).trim() === "") {
    alert("Kurucu şifresi gerekli.");
    return;
  }
  adminPwRestore = String(adminPwRestore).trim();
  try {
    saTransientAuth = true;
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(secondaryAuth, email, oldPw);
    await updatePassword(newPw, oldPw);
    await updateDoc(doc(db, "users", uid), {
      plainPassword: newPw,
      lastPasswordChangeAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
    await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
    alert("Koç şifresi güncellendi.");
  } catch (err) {
    console.error(err);
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
    try {
      if (adminEmailRestore && adminPwRestore) {
        await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
      }
    } catch (_e) {}
    var msg = (err && err.message) || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
      msg = "Mevcut şifre hatalı.";
    alert(msg);
  } finally {
    saTransientAuth = false;
  }
}

async function studentChangePassword(uid, email) {
  var oldPw = window.prompt(
    "Öğrencinin mevcut şifresi (güvenlik için zorunlu):\n" + email,
    ""
  );
  if (oldPw === null) return;
  var newPw = window.prompt("Yeni şifre (en az 8 karakter):", "");
  if (newPw === null) return;
  if (newPw.length < 8) {
    alert("Şifre en az 8 karakter olmalıdır.");
    return;
  }
  var adminEmailRestore = auth.currentUser && auth.currentUser.email;
  if (!adminEmailRestore) {
    alert("Oturum e-postası bulunamadı.");
    return;
  }
  var adminPwRestore = window.prompt("Kurucu şifreniz (işlem sonunda oturumunuz açılır):");
  if (adminPwRestore === null) {
    alert("İşlem iptal edildi.");
    return;
  }
  if (String(adminPwRestore).trim() === "") {
    alert("Kurucu şifresi gerekli.");
    return;
  }
  adminPwRestore = String(adminPwRestore).trim();
  try {
    saTransientAuth = true;
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    await signInWithEmailAndPassword(tertiaryAuth, email, oldPw);
    await updatePassword(newPw, oldPw);
    await updateDoc(doc(db, "users", uid), {
      plainPassword: newPw,
      lastPasswordChangeAt: serverTimestamp(),
    });
    await signOut(tertiaryAuth);
    await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
    alert("Şifre güncellendi.");
  } catch (err) {
    console.error(err);
    try {
      await signOut(tertiaryAuth);
    } catch (_) {}
    try {
      if (adminEmailRestore && adminPwRestore) {
        await signInWithEmailAndPassword(auth, adminEmailRestore, adminPwRestore);
      }
    } catch (_e) {}
    var msg = err.message || String(err);
    if (err.code === "auth/wrong-password" || err.code === "auth/invalid-credential")
      msg = "Mevcut şifre hatalı.";
    alert(msg);
  } finally {
    saTransientAuth = false;
  }
}

async function studentSendPasswordEmail(email) {
  if (
    !window.confirm(
      "Sistem, " +
        email +
        " adresine şifre sıfırlama bağlantısı gönderir.\n\n@sistem.com gerçek bir posta kutusu değilse e-posta ulaşmaz; bu durumda 🔑 ile mevcut şifreyi bilerek değiştirin."
    )
  )
    return;
  try {
    await sendPasswordResetEmail(email);
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

  if (act === "pwd" && uid && email) {
    coachChangePassword(uid, email);
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
    var elU = document.getElementById("studentUsername");
    var elP = document.getElementById("studentPassword");
    var elF = document.getElementById("studentFullName");
    var u = sanitizeUsername(elU && elU.value);
    var pass = elP ? elP.value : "";
    var full = elF ? String(elF.value || "").trim() : "";
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
    if (pass.length < 8) {
      showStudentFormMsg(false, "Şifre en az 8 karakter olmalıdır.");
      return;
    }
    if (btn) btn.disabled = true;
    try {
      var adminEmail = auth.currentUser && auth.currentUser.email;
      if (!adminEmail) {
        showStudentFormMsg(false, "Oturum e-postası bulunamadı.");
        return;
      }
      var adminPw = takeSaReauthPasswordForCreate();
      if (!adminPw) {
        showStudentFormMsg(
          false,
          "Kurucu şifresi bu oturumda hazır değil. Çıkış yapıp kurucu olarak yeniden giriş yaptıktan sonra tekrar deneyin."
        );
        return;
      }
      var email = u + EMAIL_DOMAIN;
      saTransientAuth = true;
      var cred = await createUserWithEmailAndRestoreAdmin(
        tertiaryAuth,
        adminEmail,
        String(adminPw).trim(),
        email,
        pass
      );
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
      showStudentFormMsg(true, "Öğrenci hesabı oluşturuldu: " + u + " (koç: " + coachId + "). Giriş: Öğrenci sekmesi.");
      e.target.reset();
    } catch (err) {
      console.error(err);
      var msg = err.message || String(err);
      if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kayıtlı.";
      showStudentFormMsg(false, msg);
    } finally {
      saTransientAuth = false;
      if (btn) btn.disabled = false;
    }
  });

var formCreateCoachEl = document.getElementById("formCreateCoach");
if (formCreateCoachEl) {
  formCreateCoachEl.addEventListener("submit", async function (e) {
  e.preventDefault();
  var uEl = document.getElementById("coachUsername");
  var pEl = document.getElementById("coachPassword");
  var instEl = document.getElementById("coachInstitution");
  var phoneEl = document.getElementById("coachPhone");
  var pkgEl = document.getElementById("coachPackage");
  var u = sanitizeUsername(uEl && uEl.value);
  var pass = pEl ? pEl.value : "";
  var inst = instEl ? String(instEl.value || "").trim() : "";
  var phone = phoneEl ? String(phoneEl.value || "").trim() : "";
  var pkg = pkgEl ? pkgEl.value : "";
  var btn = document.getElementById("btnCreateCoach");
  var fcMsg = document.getElementById("formCoachMsg");
  showFormMsg(true, "");
  if (fcMsg) {
    fcMsg.className = "";
    fcMsg.style.display = "none";
  }
  if (!u) {
    showFormMsg(false, "Kullanıcı adı sadece a-z, 0-9 ve _ içerebilir.");
    return;
  }
  if (pass.length < 8) {
    showFormMsg(false, "Şifre en az 8 karakter olmalıdır.");
    return;
  }
  if (!inst) {
    showFormMsg(false, "Kurum adı zorunlu.");
    return;
  }
  if (btn) btn.disabled = true;
  try {
    var adminEmailCoach = auth.currentUser && auth.currentUser.email;
    if (!adminEmailCoach) {
      showFormMsg(false, "Oturum e-postası bulunamadı.");
      if (fcMsg) fcMsg.style.display = "block";
      return;
    }
    var adminPwCoach = takeSaReauthPasswordForCreate();
    if (!adminPwCoach) {
      showFormMsg(
        false,
        "Kurucu şifresi bu oturumda hazır değil. Çıkış yapıp kurucu olarak yeniden giriş yaptıktan sonra tekrar deneyin."
      );
      if (fcMsg) fcMsg.style.display = "block";
      return;
    }
    var email = u + EMAIL_DOMAIN;
    saTransientAuth = true;
    var cred = await createUserWithEmailAndRestoreAdmin(
      secondaryAuth,
      adminEmailCoach,
      String(adminPwCoach).trim(),
      email,
      pass
    );
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
    showFormMsg(true, "Koç hesabı oluşturuldu: " + u + " — giriş: kullanıcı adı + şifre.");
    if (fcMsg) fcMsg.style.display = "block";
    e.target.reset();
  } catch (err) {
    console.error(err);
    var msg = err.message || String(err);
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kayıtlı.";
    showFormMsg(false, msg);
    if (fcMsg) fcMsg.style.display = "block";
  } finally {
    saTransientAuth = false;
    if (btn) btn.disabled = false;
  }
});
}

var btnSaLogout = document.getElementById("btnLogout");
if (btnSaLogout) {
  btnSaLogout.addEventListener("click", async function () {
  if (!confirm("Çıkış yapılsın mı?")) return;
  clearSaReauthCache();
  localStorage.removeItem("currentUser");
  try {
    await signOut(auth);
  } catch (err) {
    console.error("[super-admin] signOut", err);
    try {
      alert("Bir sorun oluştu.");
    } catch (e2) {}
  }
  window.location.replace("panel-admin-auth.html");
  });
}

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

var saSessionGateDone = false;
var saGateRunning = false;

async function runSuperAdminSessionGate() {
  if (saSessionGateDone || saGateRunning) return;
  saGateRunning = true;
  saSetLoading(true, "Yükleniyor... Oturum doğrulanıyor.");
  try {
    var vr = await verifyAppwriteAccount(5000);
    if (!vr.ok || !vr.user) {
      try {
        await signOut(auth);
      } catch (_e) {}
      window.location.replace("panel-admin-auth.html");
      return;
    }
    var uid = vr.user.$id;
    saSetLoading(true, "Yükleniyor... Profil okunuyor.");
    var profile = await waitForProfile(uid, 8, 500);
    if (!profile) {
      console.error("VERI CEKME HATASI:", { reason: "Profil bulunamadı veya henüz yüklenmedi.", uid: uid });
      try {
        await signOut(auth);
      } catch (_e) {}
      window.location.replace("panel-admin-auth.html");
      return;
    }
    var normalizedRole = normalizeRoleName(profile.role);
    if (normalizedRole !== "admin") {
      console.error("[super-admin] Yetkisiz rol:", profile.role);
      try {
        await signOut(auth);
      } catch (_e) {}
      window.location.replace("panel-admin-auth.html");
      return;
    }
    saSessionGateDone = true;
    localStorage.setItem("currentUser", profile.username || "admin1");
    if (!saAuthBootstrapped) {
      saAuthBootstrapped = true;
      subscribeCoachesList();
      subscribeStudentsList();
      subscribeQuoteRequests();
      subscribeMaintenanceSettings();
    }
  } catch (err) {
    console.error("VERI CEKME HATASI:", err);
    try {
      await signOut(auth);
    } catch (_e) {}
    window.location.replace("panel-admin-auth.html");
  } finally {
    saGateRunning = false;
    saHideLoadingOverlay();
  }
}

function scheduleSuperAdminSessionGate() {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", runSuperAdminSessionGate);
  } else {
    runSuperAdminSessionGate();
  }
}
scheduleSuperAdminSessionGate();

onAuthStateChanged(auth, function (user) {
  console.log("Mevcut Kullanıcı Verisi:", user);
  if (!user && saSessionGateDone) {
    if (saTransientAuth) return;
    saHideLoadingOverlay();
    window.location.replace("panel-admin-auth.html");
  }
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
      console.error("VERI CEKME HATASI:", err);
      var el = document.getElementById("saMaintenanceStatus");
      if (el) el.textContent = "Ayarlar okunamadı (Appwrite izinleri / ağ).";
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
    location.hash = "#teklifler";
  });
}

/** Sistem analizi — yalnızca #sistem görünümüne girildiğinde bir kez (poll / interval yok). */
var saSystemStatusInFlight = false;
var SA_SYS_STORAGE_CAP_BYTES = 10 * 1024 * 1024 * 1024;
var SA_SYS_DB_DOC_CAP = 50000;

function saFormatSysBytes(n) {
  n = Number(n) || 0;
  if (n >= 1073741824) return (n / 1073741824).toFixed(2) + " GB";
  if (n >= 1048576) return (n / 1048576).toFixed(1) + " MB";
  if (n >= 1024) return (n / 1024).toFixed(0) + " KB";
  return String(n) + " B";
}

async function saListDocumentsTotalSafe(collectionId, queries) {
  var q = (queries || []).slice();
  q.push(Query.limit(1));
  try {
    var res = await databases.listDocuments({
      databaseId: APPWRITE_DATABASE_ID,
      collectionId: collectionId,
      queries: q,
      total: true,
    });
    return typeof res.total === "number" ? res.total : 0;
  } catch (e) {
    console.warn("[sa-system] listDocuments", collectionId, e);
    return 0;
  }
}

async function saSumBucketBytesSafe(bucketId) {
  var sum = 0;
  var offset = 0;
  var page = 100;
  var guard = 0;
  for (;;) {
    guard++;
    if (guard > 500) break;
    var res;
    try {
      res = await storage.listFiles({
        bucketId: bucketId,
        queries: [Query.limit(page), Query.offset(offset)],
      });
    } catch (e) {
      console.warn("[sa-system] listFiles", bucketId, e);
      break;
    }
    var files = res.files || [];
    for (var i = 0; i < files.length; i++) {
      var f = files[i];
      var sz = f.sizeOriginal != null ? f.sizeOriginal : f.size;
      sum += Number(sz) || 0;
    }
    if (files.length < page) break;
    offset += page;
  }
  return sum;
}

function saSysAnimateBarFill(fillEl, trackEl, pctLabelEl, pct, warnPct) {
  var p = Math.min(100, Math.max(0, Number(pct) || 0));
  var warn = p >= (warnPct != null ? warnPct : 80);
  if (pctLabelEl) pctLabelEl.textContent = p.toFixed(1) + "%";
  if (trackEl) trackEl.setAttribute("aria-valuenow", String(Math.round(p)));
  if (!fillEl) return;
  fillEl.classList.toggle("sa-sys-track__fill--warn", warn);
  fillEl.style.width = "0%";
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      fillEl.style.width = p + "%";
    });
  });
}

async function loadSaSystemStatusOnce() {
  if (saSystemStatusInFlight) return;
  if (!document.getElementById("saSysTotalSoru")) return;
  saSystemStatusInFlight = true;

  var elDot = document.getElementById("saSysDbDot");
  var elDbLabel = document.getElementById("saSysDbStatusText");
  var elSoru = document.getElementById("saSysTotalSoru");
  var elCoachSt = document.getElementById("saSysCoachStudent");
  var elCoachStSub = document.getElementById("saSysCoachStudentSub");
  var elAppt = document.getElementById("saSysTotalAppt");
  var fillSt = document.getElementById("saSysStorageBarFill");
  var trackSt = fillSt && fillSt.parentElement;
  var pctSt = document.getElementById("saSysStoragePct");
  var metaSt = document.getElementById("saSysStorageMeta");
  var fillDb = document.getElementById("saSysDbBarFill");
  var trackDb = fillDb && fillDb.parentElement;
  var pctDb = document.getElementById("saSysDbPct");
  var metaDb = document.getElementById("saSysDbMeta");
  var errBox = document.getElementById("saSysErr");

  if (elDot) {
    elDot.className = "sa-sys-dot sa-sys-dot--pending";
  }
  if (elDbLabel) elDbLabel.textContent = "Kontrol ediliyor…";
  if (elSoru) elSoru.textContent = "…";
  if (elCoachSt) elCoachSt.textContent = "…";
  if (elAppt) elAppt.textContent = "…";
  if (elCoachStSub) elCoachStSub.textContent = "";
  if (errBox) errBox.hidden = true;
  if (fillSt) {
    fillSt.style.width = "0%";
    fillSt.classList.remove("sa-sys-track__fill--warn");
  }
  if (fillDb) {
    fillDb.style.width = "0%";
    fillDb.classList.remove("sa-sys-track__fill--warn");
  }
  if (pctSt) pctSt.textContent = "…";
  if (pctDb) pctDb.textContent = "…";
  if (metaSt) metaSt.textContent = "Hesaplanıyor…";
  if (metaDb) metaDb.textContent = "Hesaplanıyor…";

  try {
    var pingOk = false;
    try {
      await client.ping();
      pingOk = true;
    } catch (_p) {}

    var counts = await Promise.all([
      saListDocumentsTotalSafe(APPWRITE_COLLECTION_SORU_HAVUZU, []),
      saListDocumentsTotalSafe("users", [Query.equal("role", "coach")]),
      saListDocumentsTotalSafe("users", [Query.equal("role", "student")]),
      saListDocumentsTotalSafe("appointments", []),
      saListDocumentsTotalSafe("users", []),
      saListDocumentsTotalSafe("students", []),
      saListDocumentsTotalSafe("exams", []),
    ]);
    var nSoru = counts[0];
    var nCoach = counts[1];
    var nStudent = counts[2];
    var nAppt = counts[3];
    var nUsersAll = counts[4];
    var nStudentsCol = counts[5];
    var nExams = counts[6];

    var bucketBytes = await Promise.all([
      saSumBucketBytesSafe(APPWRITE_BUCKET_SORU_HAVUZU),
      saSumBucketBytesSafe(APPWRITE_BUCKET_DESTEK),
    ]);
    var b1 = bucketBytes[0];
    var b2 = bucketBytes[1];

    if (elDot) {
      elDot.className = "sa-sys-dot sa-sys-dot--ok";
    }
    if (elDbLabel) {
      elDbLabel.textContent = pingOk ? "Çevrimiçi" : "Erişilebilir";
    }
    if (elSoru) elSoru.textContent = String(nSoru);
    if (elCoachSt) elCoachSt.textContent = String(nCoach + nStudent);
    if (elCoachStSub) {
      elCoachStSub.textContent =
        nCoach.toLocaleString("tr-TR") +
        " koç · " +
        nStudent.toLocaleString("tr-TR") +
        " öğrenci (users koleksiyonu)";
    }
    if (elAppt) elAppt.textContent = String(nAppt);

    var totalBytes = b1 + b2;
    var storagePct = SA_SYS_STORAGE_CAP_BYTES > 0 ? (totalBytes / SA_SYS_STORAGE_CAP_BYTES) * 100 : 0;
    if (metaSt) {
      metaSt.textContent =
        saFormatSysBytes(totalBytes) +
        " / " +
        saFormatSysBytes(SA_SYS_STORAGE_CAP_BYTES) +
        " — bucket: soru_havuzu + destek_ekranlari";
    }
    saSysAnimateBarFill(fillSt, trackSt, pctSt, storagePct, 80);

    var dbDocsTotal = nUsersAll + nSoru + nAppt + nStudentsCol + nExams;
    var dbPct = SA_SYS_DB_DOC_CAP > 0 ? (dbDocsTotal / SA_SYS_DB_DOC_CAP) * 100 : 0;
    if (metaDb) {
      metaDb.textContent =
        "~" +
        dbDocsTotal.toLocaleString("tr-TR") +
        " belge (users + soru_havuzu + appointments + students + exams) · referans limit " +
        SA_SYS_DB_DOC_CAP.toLocaleString("tr-TR");
    }
    saSysAnimateBarFill(fillDb, trackDb, pctDb, dbPct, 80);
  } catch (err) {
    console.warn("[sa-system]", err);
    if (elDot) elDot.className = "sa-sys-dot sa-sys-dot--err";
    if (elDbLabel) elDbLabel.textContent = "Hata";
    if (errBox) {
      errBox.textContent =
        "Veriler yüklenemedi. Oturum açtığınızdan ve Appwrite okuma izinlerinin tanımlı olduğundan emin olun.";
      errBox.hidden = false;
    }
  } finally {
    saSystemStatusInFlight = false;
  }
}

window.addEventListener("hashchange", saApplyRoute);
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", saApplyRoute);
} else {
  saApplyRoute();
}
