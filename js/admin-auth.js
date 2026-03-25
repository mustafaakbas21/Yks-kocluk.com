/**
 * Gizli kurucu girişi — yalnızca panel-admin-auth.html ile kullanılır.
 * Başarılı oturumda super-admin.html yönlendirmesi.
 */
import {
  signInWithEmailAndPassword,
  signOut,
  doc,
  updateDoc,
  db,
  auth,
  verifyAppwriteAccount,
  getAppSettings,
  serverTimestamp,
} from "./appwrite-compat.js";
import "./appwrite-config.js";
import { databases, APPWRITE_DATABASE_ID } from "./appwrite-config.js";
import { Query as AQuery } from "./appwrite-browser.js";

const RATE_LIMIT_TR_MESSAGE =
  "Çok fazla hatalı deneme yaptınız. Lütfen 15 dakika bekleyin veya internetinizi değiştirip tekrar deneyin.";

function isKurucuRole(role) {
  return role === "admin" || role === "kurucu" || role === "admin_roster";
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
    var usersById = await databases.listDocuments(APPWRITE_DATABASE_ID, "users", [
      AQuery.equal("$id", uid),
      AQuery.limit(1),
    ]);
    if (usersById && usersById.documents && usersById.documents.length) return usersById.documents[0];
  } catch (e) {
    console.warn("[admin-auth] users by id:", e && e.message);
  }

  if (uname) {
    try {
      var usersByUsername = await databases.listDocuments(APPWRITE_DATABASE_ID, "users", [
        AQuery.equal("username", uname),
        AQuery.limit(1),
      ]);
      if (usersByUsername && usersByUsername.documents && usersByUsername.documents.length) {
        return usersByUsername.documents[0];
      }
    } catch (e2) {
      console.warn("[admin-auth] users by username:", e2 && e2.message);
    }
  }

  return null;
}

function setSubmitBusy(isBusy) {
  var btn = document.getElementById("adminAuthSubmit");
  if (!btn) return;
  btn.disabled = !!isBusy;
  var label = btn.querySelector("span");
  if (label) label.textContent = isBusy ? "Giriş yapılıyor…" : "Giriş yap";
}

function showError(msg) {
  var el = document.getElementById("adminAuthError");
  if (el) {
    el.textContent = msg;
    el.classList.add("is-visible");
  } else alert(msg);
}

function hideError() {
  var el = document.getElementById("adminAuthError");
  if (el) el.classList.remove("is-visible");
}

function translateAppwriteLoginError(msg) {
  var m = String(msg || "");
  if (/rate limit|too many requests|429|general_rate_limit_exceeded/i.test(m)) return RATE_LIMIT_TR_MESSAGE;
  if (/password/i.test(m) && (/8|256|between/i.test(m) || /characters/i.test(m)))
    return "Şifre 8 ile 256 karakter arasında olmalıdır.";
  if (/Invalid `email` param|email.*invalid/i.test(m)) return "E-posta biçimi geçersiz.";
  if (/invalid credentials|wrong password/i.test(m)) return "E-posta veya şifre hatalı.";
  return m || "Giriş başarısız.";
}

function initAdminPasswordToggle() {
  var btn = document.getElementById("adminAuthPasswordToggle");
  var input = document.getElementById("adminAuthPassword");
  if (!btn || !input) return;
  var iconPlain = btn.querySelector(".login-password-toggle__icon--plain");
  var iconSlashed = btn.querySelector(".login-password-toggle__icon--slashed");

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

async function redirectIfAdminSession() {
  try {
    var vr = await verifyAppwriteAccount(5000);
    if (!vr.ok || !vr.user) return;
    var fakeUser = {
      uid: vr.user.$id,
      email: vr.user.email || "",
      getIdToken: function () {
        return Promise.resolve("appwrite-session");
      },
    };
    var profile = await findProfileFromDatabase(fakeUser, "");
    if (profile && isKurucuRole(profile.role)) {
      window.location.replace("super-admin.html");
    }
  } catch (e) {
    console.warn("[admin-auth] session check:", e);
  }
}

var form = document.getElementById("adminAuthForm");
if (form) {
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    hideError();
    var emailEl = document.getElementById("adminAuthEmail");
    var passEl = document.getElementById("adminAuthPassword");
    var email = (emailEl && emailEl.value && String(emailEl.value).trim().toLowerCase()) || "";
    var password = (passEl && passEl.value) || "";
    if (!email) {
      showError("E-posta girin.");
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      showError("Geçerli bir e-posta adresi girin.");
      return;
    }
    if (!password) {
      showError("Şifre girin.");
      return;
    }
    if (password.length < 8 || password.length > 256) {
      showError("Şifre 8 ile 256 karakter arasında olmalıdır.");
      return;
    }

    setSubmitBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      var u = auth.currentUser;
      if (!u) throw new Error("Oturum açılamadı.");

      var profile = await findProfileFromDatabase(u, inferUsernameFromEmail(u.email || email));
      if (!profile || !profile.role) {
        await signOut(auth);
        showError("Hesap yapılandırılmamış. Yönetici ile iletişime geçin.");
        return;
      }
      if (!isKurucuRole(profile.role)) {
        await signOut(auth);
        showError("Bu hesap kurucu yetkisine sahip değil.");
        return;
      }

      try {
        var appSettings = await getAppSettings();
        if (appSettings.maintenance && !isKurucuRole(profile.role)) {
          await signOut(auth);
          showError("Bakımdayız.");
          return;
        }
      } catch (se) {
        console.warn("[admin-auth] settings:", se);
      }

      if (profile.frozen === true) {
        await signOut(auth);
        showError("Bu hesap dondurulmuş.");
        return;
      }

      var displayUsername = profile.username || inferUsernameFromEmail(u.email || email);
      localStorage.setItem("currentUser", displayUsername);
      try {
        localStorage.setItem("yksRole", profile.role || "");
      } catch (_) {}

      try {
        var saMail = u.email || email;
        if (saMail && password) {
          sessionStorage.setItem("dp_sa_reauth_email", String(saMail).toLowerCase());
          sessionStorage.setItem("dp_sa_reauth_pw", password);
        }
      } catch (_) {}

      try {
        await updateDoc(doc(db, "users", u.uid), { lastLogin: serverTimestamp() });
      } catch (e) {
        console.warn("[admin-auth] lastLogin:", e);
      }

      window.location.replace("super-admin.html");
    } catch (err) {
      var rawMsg = err && err.message != null ? String(err.message) : "";
      var messageLower = rawMsg.toLowerCase();
      var code = err && err.code;
      if (/^429$/.test(String(code || "")) || /too-many-requests|rate limit|general_rate_limit_exceeded/.test(messageLower)) {
        showError(RATE_LIMIT_TR_MESSAGE);
      } else if (
        code === "auth/invalid-credential" ||
        code === "auth/wrong-password" ||
        code === "auth/user-not-found" ||
        /invalid credentials|wrong password|user.*not found/.test(messageLower)
      ) {
        showError("E-posta veya şifre hatalı. Kurucu hesabınızın doğru olduğundan emin olun.");
      } else {
        showError(translateAppwriteLoginError(rawMsg));
      }
    } finally {
      setSubmitBusy(false);
    }
  });
}

initAdminPasswordToggle();
redirectIfAdminSession();
