/**
 * YKS Koçluk — Koç ve öğrenci girişi (kullanıcı adı → @sistem.com). Kurucu: panel-admin-auth.html.
 */
import {
  signInWithEmailAndPassword,
  signOut,
  doc,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp,
  db,
  auth,
  verifyAppwriteAccount,
  getAppSettings,
} from "./appwrite-compat.js";
import "./appwrite-config.js";
import { Query as AQuery } from "./appwrite-browser.js";
import { databases, APPWRITE_DATABASE_ID } from "./appwrite-config.js";

/** Koç, öğrenci ve kurucu girişinde kullanıcı adı bu alan adıyla e-postaya çevrilir (Appwrite createEmailPasswordSession). @koc.com vb. kullanılmaz. */
const EMAIL_DOMAIN = "@sistem.com";
const RATE_LIMIT_TR_MESSAGE =
  "Çok fazla hatalı deneme yaptınız. Lütfen 15 dakika bekleyin veya internetinizi değiştirip tekrar deneyin.";

function setSubmitBusy(isBusy) {
  var btn = document.getElementById("loginSubmit");
  if (!btn) return;
  btn.disabled = !!isBusy;
  var label = btn.querySelector("span");
  if (label) label.textContent = isBusy ? "Giriş Yapılıyor..." : "Giriş yap";
}

function usernameToEmailCandidates(username) {
  var raw = String(username || "").trim().toLowerCase();
  if (!raw) throw new Error("Geçerli bir kullanıcı adı girin (a-z, 0-9, _).");

  // Geriye dönük uyumluluk: kullanıcı tam e-posta yazarsa bozma.
  if (raw.indexOf("@") !== -1) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      throw new Error("Geçerli bir kullanıcı adı girin (a-z, 0-9, _).");
    }
    return [raw];
  }

  var base = raw.replace(/\s+/g, "");
  var legacy = raw.replace(/[^a-z0-9_]/g, "");
  var candidates = [];
  if (/^[a-z0-9._-]+$/.test(base)) candidates.push(base + EMAIL_DOMAIN);
  if (legacy) candidates.push(legacy + EMAIL_DOMAIN);
  candidates = candidates.filter(function (v, i, arr) {
    return arr.indexOf(v) === i;
  });
  if (!candidates.length) throw new Error("Geçerli bir kullanıcı adı girin (a-z, 0-9, _).");
  return candidates;
}

async function signInWithUsernameCandidates(password, emailCandidates, seciliRol) {
  var lastErr = null;
  for (var i = 0; i < emailCandidates.length; i++) {
    var olusturulanMail = emailCandidates[i];
    console.log("Giriş Denemesi - Rol:", seciliRol != null ? seciliRol : "?", "Mail:", olusturulanMail);
    try {
      await signInWithEmailAndPassword(auth, olusturulanMail, password);
      return olusturulanMail;
    } catch (e) {
      lastErr = e;
      var em = e && e.message != null ? String(e.message) : "";
      console.error("[login] signInWithEmailAndPassword hata:", em, e);
      var code = e && e.code ? String(e.code) : "";
      var msg = em.toLowerCase();
      var isInvalidCred =
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found" ||
        /invalid credentials|wrong password|user.*not found/.test(msg);
      if (!isInvalidCred) throw e;
    }
  }
  if (lastErr && lastErr.message) {
    console.error("[login] Tüm adaylar başarısız. Son hata mesajı:", String(lastErr.message));
  }
  throw lastErr || new Error("Giriş başarısız.");
}

function sanitizeUsernameForDb(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function inferUsernameFromEmail(email) {
  var local = String(email || "").split("@")[0] || "";
  return sanitizeUsernameForDb(local);
}

async function findProfileFromDatabase(authUser, fallbackUsername) {
  var uid = authUser && authUser.uid ? String(authUser.uid) : "";
  var email = authUser && authUser.email ? String(authUser.email).toLowerCase() : "";
  var uname = sanitizeUsernameForDb(fallbackUsername || inferUsernameFromEmail(email));

  try {
    var usersById = await databases.listDocuments(APPWRITE_DATABASE_ID, "users", [AQuery.equal("$id", uid), AQuery.limit(1)]);
    if (usersById && usersById.documents && usersById.documents.length) return usersById.documents[0];
  } catch (e) {
    console.warn("Tablo okuma atlandı:", e && e.message != null ? e.message : String(e));
  }

  if (uname) {
    try {
      var usersByUsername = await databases.listDocuments(APPWRITE_DATABASE_ID, "users", [
        AQuery.equal("username", uname),
        AQuery.limit(1),
      ]);
      if (usersByUsername && usersByUsername.documents && usersByUsername.documents.length) return usersByUsername.documents[0];
    } catch (e2) {
      console.warn("Tablo okuma atlandı:", e2 && e2.message != null ? e2.message : String(e2));
    }
  }

  if (uname) {
    try {
      var coachesByUsername = await databases.listDocuments(APPWRITE_DATABASE_ID, "coaches", [
        AQuery.equal("username", uname),
        AQuery.limit(1),
      ]);
      if (coachesByUsername && coachesByUsername.documents && coachesByUsername.documents.length) {
        var coachDoc = coachesByUsername.documents[0];
        return {
          username: uname,
          role: "coach",
          fullName: coachDoc.fullName || coachDoc.name || null,
          coach_id: uname,
        };
      }
    } catch (e3) {
      console.warn("Tablo okuma atlandı:", e3 && e3.message != null ? e3.message : String(e3));
    }
  }

  return null;
}

async function ensureProfileSynchronized(authUser, loginMode, rawUser) {
  var existing = await findProfileFromDatabase(authUser, rawUser);
  if (existing && existing.role) return existing;

  var uid = authUser && authUser.uid ? String(authUser.uid) : "";
  var email = authUser && authUser.email ? String(authUser.email).toLowerCase() : "";
  var username = sanitizeUsernameForDb(rawUser || inferUsernameFromEmail(email));
  var role = loginMode === "student" ? "student" : "coach";
  /* users şeması: yalnızca tanımlı alanlar (email Appwrite’da yoksa Unknown attribute üretir) */
  var payload = {
    username: username || "kullanici",
    role: role,
    fullName: null,
    coach_id: role === "student" ? null : username || null,
    createdAt: new Date().toISOString(),
    lastLogin: serverTimestamp(),
  };
  try {
    await databases.createDocument(APPWRITE_DATABASE_ID, "users", uid, payload);
  } catch (e) {
    var msg = e && e.message != null ? String(e.message) : "";
    console.error("[login] createDocument (users) hata mesajı:", msg, e);
    if (!/already exists|document_already_exists/i.test(msg)) throw e;
  }
  var created = await findProfileFromDatabase(authUser, rawUser);
  if (created && created.role) return created;
  return payload;
}

function showError(msg) {
  var el = document.getElementById("loginError");
  if (el) {
    el.textContent = msg;
    el.classList.add("is-visible");
  } else alert(msg);
}

function hideError() {
  var el = document.getElementById("loginError");
  if (el) el.classList.remove("is-visible");
}

/** Appwrite İngilizce hata metinlerini Türkçe göster */
/** Appwrite Auth reddi — rol bazlı açıklama (Invalid credentials) */
function messageForInvalidCredentials(loginMode) {
  if (loginMode === "student") {
    return (
      "Kullanıcı adı veya şifre hatalı. Öğrenci hesabı yalnızca kurucu panelinden «Öğrenci oluştur» ile açılır; " +
      "girişte e-posta otomatik olarak kullaniciadi@sistem.com olur. " +
      "Şifreyi hesabı oluştururken belirlenen şifre ile aynı girdiğinizden emin olun veya kurumunuzdaki koç/kurucudan şifre sıfırlamasını isteyin."
    );
  }
  if (loginMode === "coach") {
    return (
      "Kullanıcı adı veya şifre hatalı. Koç hesabı kurucu panelinden oluşturulmuş olmalıdır; " +
      "e-posta biçimi kullaniciadi@sistem.com şeklindedir."
    );
  }
  return "Kullanıcı adı veya şifre hatalı.";
}

function translateAppwriteLoginError(msg) {
  var m = String(msg || "");
  if (/rate limit|too many requests|429|general_rate_limit_exceeded/i.test(m)) return RATE_LIMIT_TR_MESSAGE;
  if (/password/i.test(m) && (/8|256|between/i.test(m) || /characters/i.test(m)))
    return "Şifre 8 ile 256 karakter arasında olmalıdır.";
  if (/Invalid `email` param|email.*invalid/i.test(m)) return "E-posta biçimi geçersiz.";
  if (/user.*not found|no user/i.test(m)) return "Kullanıcı bulunamadı.";
  if (/invalid credentials|wrong password/i.test(m)) return "Kullanıcı adı veya şifre hatalı.";
  return m || "Giriş başarısız.";
}

/** Not: otomatik admin bootstrap login akışını etkilememesi için kaldırıldı. */

var loginMode = "coach";
var sessionChecked = false;

function isKurucuRole(role) {
  return role === "admin" || role === "kurucu" || role === "admin_roster";
}

async function resolveAndRedirectByProfile(user) {
  try {
    var profile = await ensureProfileSynchronized(user, "coach", "");
    if (!profile || !profile.role) return;
    if (profile.role === "student") {
      window.location.replace("/ogrenci-panel");
      return;
    }
    if (isKurucuRole(profile.role)) {
      window.location.replace("/super-admin");
      return;
    }
    window.location.replace("/koc-panel");
  } catch (e) {
    var msg = e && e.message != null ? String(e.message) : "";
    console.error("[login] resolveAndRedirectByProfile hata mesajı:", msg, e);
    if (/zaman aşımı/i.test(msg)) {
      showError("Profil yüklenemedi (zaman aşımı). Ağı kontrol edip yenileyin.");
    } else {
      showError("Oturum doğrulanamadı. Tekrar deneyin.");
    }
  }
}

async function initSessionCheck() {
  if (sessionChecked) return;
  sessionChecked = true;
  setSubmitBusy(true);
  try {
    var vr = await verifyAppwriteAccount(5000);
    if (!vr.ok || !vr.user) {
      return;
    }
    var fakeUser = {
      uid: vr.user.$id,
      email: vr.user.email || "",
      getIdToken: function () {
        return Promise.resolve("appwrite-session");
      },
    };
    await resolveAndRedirectByProfile(fakeUser);
  } catch (e) {
    var msg = e && e.message != null ? String(e.message) : "";
    console.error("[login] initSessionCheck hata mesajı:", msg, e);
    showError("Oturum doğrulanamadı. Tekrar deneyin.");
  } finally {
    setSubmitBusy(false);
  }
}

function setMode(mode) {
  loginMode = mode;
  document.querySelectorAll(".login-tabs button").forEach(function (btn) {
    var active = btn.getAttribute("data-mode") === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  var hint = document.getElementById("modeHint");
  if (hint) {
    if (mode === "student") {
      hint.innerHTML =
        "Hesap <strong>kurucu panelinden</strong> (Öğrenci oluştur) açılmış olmalıdır. Sadece kullanıcı adını yazın; sistem otomatik olarak " +
        "<strong>@sistem.com</strong> ekler. Şifre, hesap oluşturulurken verilen şifre ile aynı olmalıdır.";
    } else {
      hint.innerHTML =
        "Koç hesabınızla giriş yapın. Sadece <strong>kullanıcı adı</strong> ve şifre yeterlidir.";
    }
  }
}

document.getElementById("tabCoach") &&
  document.getElementById("tabCoach").addEventListener("click", function () {
    setMode("coach");
  });
document.getElementById("tabStudent") &&
  document.getElementById("tabStudent").addEventListener("click", function () {
    setMode("student");
  });

/** Şifre göster/gizle — Koç / Öğrenci sekmeleri ortak */
function initLoginPasswordToggle() {
  var btn = document.getElementById("loginPasswordToggle");
  var input = document.getElementById("loginPassword");
  if (!btn || !input) return;
  var iconPlain = btn.querySelector(".login-password-toggle__icon--plain");
  var iconSlashed = btn.querySelector(".login-password-toggle__icon--slashed");

  /** @param {boolean} isPlainVisible — şifre metin olarak görünüyor mu */
  function applyVisibility(isPlainVisible) {
    input.type = isPlainVisible ? "text" : "password";
    btn.setAttribute("aria-pressed", isPlainVisible ? "true" : "false");
    btn.setAttribute("aria-label", isPlainVisible ? "Şifreyi gizle" : "Şifreyi göster");
    if (iconPlain && iconSlashed) {
      iconPlain.hidden = isPlainVisible;
      iconSlashed.hidden = !isPlainVisible;
    }
  }

  btn.addEventListener("click", function () {
    applyVisibility(input.type === "password");
  });
}

initLoginPasswordToggle();

var loginFormEl = document.getElementById("loginForm");
if (loginFormEl) {
loginFormEl.addEventListener("submit", async function (e) {
  e.preventDefault();
  hideError();
  var userEl = document.getElementById("loginUsername");
  var passEl = document.getElementById("loginPassword");
  var submitBtn = document.getElementById("loginSubmit");
  var rawUser = (userEl && userEl.value) || "";
  var password = (passEl && passEl.value) || "";
  if (!password) {
    showError("Şifre girin.");
    return;
  }
  if (password.length < 8) {
    showError("Şifre en az 8 karakter olmalıdır.");
    return;
  }
  if (password.length > 256) {
    showError("Şifre en fazla 256 karakter olabilir.");
    return;
  }
  var emailCandidates;
  try {
    emailCandidates = usernameToEmailCandidates(rawUser);
  } catch (err) {
    showError(err.message || "Kullanıcı adı geçersiz.");
    return;
  }
  setSubmitBusy(true);
  try {
    await signInWithUsernameCandidates(password, emailCandidates, loginMode);
    var u = auth.currentUser;
    if (!u) throw new Error("Oturum açılamadı.");
    var profile = await ensureProfileSynchronized(u, loginMode, rawUser);
    if (!profile || !profile.role) {
      await signOut(auth);
      showError("Hesap yapılandırılmamış. Yönetici ile iletişime geçin.");
      return;
    }
    try {
      var appSettings = await getAppSettings();
      if (appSettings.maintenance && !isKurucuRole(profile.role)) {
        await signOut(auth);
        showError("Bakımdayız. Şu an yalnızca kurucu hesabı giriş yapabilir.");
        return;
      }
    } catch (se) {
      console.warn("[login] settings:", se);
    }
    if (profile.frozen === true) {
      await signOut(auth);
      showError("Bu hesap dondurulmuş. Kurucu ile iletişime geçin.");
      return;
    }
    if (loginMode === "coach" && profile.role !== "coach") {
      await signOut(auth);
      showError("Bu hesap koç değil. Öğrenci sekmesini kullanın.");
      return;
    }
    if (loginMode === "student" && profile.role !== "student") {
      await signOut(auth);
      showError("Bu hesap öğrenci değil. Koç sekmesini kullanın.");
      return;
    }
    var displayUsername = profile.username || rawUser.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
    localStorage.setItem("currentUser", displayUsername);
    try {
      localStorage.setItem("yksRole", profile.role || "");
      localStorage.setItem("yksStudentName", profile.fullName || profile.displayName || "");
      localStorage.setItem("yksCoachId", profile.coach_id || profile.coachId || "");
    } catch (e) {}
    if (profile.role === "student") {
      try {
        await updateDoc(doc(db, "users", u.uid), { lastLogin: serverTimestamp() });
      } catch (e) {
        console.warn("[login] student lastLogin:", e);
      }
      window.location.replace("/ogrenci-panel");
      return;
    }
    if (isKurucuRole(profile.role)) {
      try {
        var saMail = u.email || "";
        if (saMail && password) {
          sessionStorage.setItem("dp_sa_reauth_email", String(saMail).toLowerCase());
          sessionStorage.setItem("dp_sa_reauth_pw", password);
        }
      } catch (e) {}
      window.location.replace("/super-admin");
    } else {
      try {
        sessionStorage.removeItem("superAdminViewAsCoach");
      } catch (_) {}
      try {
        await updateDoc(doc(db, "users", u.uid), { lastLogin: serverTimestamp() });
      } catch (e) {
        console.warn("[login] lastLogin:", e);
      }
      try {
        await addDoc(collection(db, "coachLoginLog"), {
          coachId: u.uid,
          username: displayUsername,
          at: serverTimestamp(),
        });
      } catch (e) {
        console.warn("[login] coachLoginLog:", e);
      }
      window.location.replace("/koc-panel");
    }
  } catch (err) {
    var rawMsg = err && err.message != null ? String(err.message) : "";
    console.error("[login] form submit hata mesajı:", rawMsg, err);
    var code = err && err.code;
    var messageLower = rawMsg.toLowerCase();
    var statusCode = err && (err.code || err.status || err.responseCode);
    var statusText = String(statusCode || "").toLowerCase();
    if (/^429$/.test(statusText) || /too-many-requests|rate limit|general_rate_limit_exceeded/.test(messageLower)) {
      showError(RATE_LIMIT_TR_MESSAGE);
    } else if (
      code === "auth/invalid-credential" ||
      code === "auth/wrong-password" ||
      code === "auth/user-not-found" ||
      /invalid credentials|invalid credential|wrong password|user.*not found/.test(messageLower)
    ) {
      showError(messageForInvalidCredentials(loginMode));
    } else if (code === "auth/too-many-requests") {
      showError(RATE_LIMIT_TR_MESSAGE);
    } else if (/password/i.test(rawMsg) && /(at least 8|min(?:imum)? length.*8|too short|between 8 and 256)/i.test(rawMsg)) {
      showError("Şifre en az 8 karakter olmalıdır.");
    } else {
      showError(translateAppwriteLoginError(rawMsg));
    }
  } finally {
    setSubmitBusy(false);
  }
});
}

initSessionCheck();

try {
  var loginFlash = localStorage.getItem("loginFlashError");
  if (loginFlash) {
    localStorage.removeItem("loginFlashError");
    showError(loginFlash);
  }
} catch (e) {}
