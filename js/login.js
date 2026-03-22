/**
 * YKS Koçluk — Çoklu kiracı giriş (kullanıcı adı → @sistem.com)
 */
import {
  signInWithEmailAndPassword,
  signOut,
  fetchSignInMethodsForEmail,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  updateDoc,
  addDoc,
  collection,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db, auth } from "./firebase-config.js";

const EMAIL_DOMAIN = "@sistem.com";
const ADMIN_EMAIL = "admin1" + EMAIL_DOMAIN;
const ADMIN_PASSWORD = "admin123";

function usernameToEmail(username) {
  var u = String(username || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
  if (!u) throw new Error("Geçerli bir kullanıcı adı girin (a-z, 0-9, _).");
  return u + EMAIL_DOMAIN;
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

/** İlk kurulum: admin1@sistem.com yoksa oluştur + Firestore users */
async function ensureInitialAdmin() {
  try {
    var methods = await fetchSignInMethodsForEmail(auth, ADMIN_EMAIL);
    if (methods.length > 0) return;
    var cred = await createUserWithEmailAndPassword(auth, ADMIN_EMAIL, ADMIN_PASSWORD);
    await setDoc(doc(db, "users", cred.user.uid), {
      username: "admin1",
      role: "admin",
      createdAt: new Date().toISOString(),
    });
    await signOut(auth);
  } catch (e) {
    if (e && e.code === "auth/email-already-in-use") return;
    console.warn("[login] init admin:", e);
  }
}

var loginMode = "coach";

function setMode(mode) {
  loginMode = mode;
  document.querySelectorAll(".login-tabs button").forEach(function (btn) {
    var active = btn.getAttribute("data-mode") === mode;
    btn.classList.toggle("is-active", active);
    btn.setAttribute("aria-selected", active ? "true" : "false");
  });
  var hint = document.getElementById("modeHint");
  if (hint) {
    if (mode === "admin") {
      hint.innerHTML =
        "<strong>Kurucu</strong> hesabı ile giriş. Yeni koç ve öğrenci hesapları bu panelden oluşturulur.";
    } else if (mode === "student") {
      hint.innerHTML =
        "Kurucunun oluşturduğu <strong>öğrenci</strong> hesabı ile giriş. Kullanıcı adı ve şifre yeterlidir.";
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
document.getElementById("tabAdmin") &&
  document.getElementById("tabAdmin").addEventListener("click", function () {
    setMode("admin");
  });
document.getElementById("tabStudent") &&
  document.getElementById("tabStudent").addEventListener("click", function () {
    setMode("student");
  });

document.getElementById("loginForm").addEventListener("submit", async function (e) {
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
  var email;
  try {
    email = usernameToEmail(rawUser);
  } catch (err) {
    showError(err.message || "Kullanıcı adı geçersiz.");
    return;
  }
  if (submitBtn) submitBtn.disabled = true;
  try {
    await signInWithEmailAndPassword(auth, email, password);
    var u = auth.currentUser;
    if (!u) throw new Error("Oturum açılamadı.");
    var snap = await getDoc(doc(db, "users", u.uid));
    var profile = snap.data();
    if (!profile || !profile.role) {
      await signOut(auth);
      showError("Hesap yapılandırılmamış. Yönetici ile iletişime geçin.");
      return;
    }
    try {
      var settingsSnap = await getDoc(doc(db, "settings", "app"));
      var maint =
        settingsSnap.exists &&
        settingsSnap.data() &&
        settingsSnap.data().maintenance === true;
      if (maint && profile.role !== "admin") {
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
    if (loginMode === "admin" && profile.role !== "admin") {
      await signOut(auth);
      showError("Bu hesap kurucu değil. Koç girişi sekmesini kullanın.");
      return;
    }
    if (loginMode === "coach" && profile.role !== "coach") {
      await signOut(auth);
      showError("Bu hesap koç değil. Öğrenci veya Kurucu sekmesini kullanın.");
      return;
    }
    if (loginMode === "student" && profile.role !== "student") {
      await signOut(auth);
      showError("Bu hesap öğrenci değil. Koç veya Kurucu sekmesini kullanın.");
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
      window.location.replace("ogrenci-panel.html");
      return;
    }
    if (profile.role === "admin") {
      window.location.replace("super-admin.html");
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
      window.location.replace("koc-panel.html");
    }
  } catch (err) {
    console.error(err);
    var code = err && err.code;
    if (code === "auth/invalid-credential" || code === "auth/wrong-password" || code === "auth/user-not-found")
      showError("Kullanıcı adı veya şifre hatalı.");
    else if (code === "auth/too-many-requests") showError("Çok fazla deneme. Bir süre sonra tekrar deneyin.");
    else showError(err.message || "Giriş başarısız.");
  } finally {
    if (submitBtn) submitBtn.disabled = false;
  }
});

ensureInitialAdmin().catch(function (e) {
  console.error(e);
});

try {
  var loginFlash = localStorage.getItem("loginFlashError");
  if (loginFlash) {
    localStorage.removeItem("loginFlashError");
    showError(loginFlash);
  }
} catch (e) {}
