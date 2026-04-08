/**
 * Koç paneli — merkezi oturum: account.get (verifyAppwriteAccount), rol/coach doğrulama, kalıcı durum.
 */
import { verifyAppwriteAccount, signOut, auth, getAppSettings } from "./appwrite-compat.js";
import { fetchAppwriteUserProfile, sanitizeUsernameForDb, inferUsernameFromEmail } from "./derece-profile-resolve.js";

export const DP_LOGIN_PATH = "/login.html";
/** Vitrin ve `login.js` ile aynı yol (çoğu sunucuda uzantısız yönlendirme) */
export const DP_STUDENT_PANEL_PATH = "/ogrenci-panel";
export const DP_SUPER_ADMIN_PATH = "/super-admin";

var gatePromise = null;
/** @type {{ compatUser: { uid: string, email: string, getIdToken: () => Promise<string> }, profile: object, appwriteUser: object } | null} */
var lastGateResult = null;

function getInitialKocViewFromUrl() {
  try {
    var p = new URLSearchParams(window.location.search);
    var view = (p.get("view") || "").trim();
    if (view === "gorusme-odasi") return "gorusme-odasi";
    var h = (window.location.hash || "").replace(/^#\/?/, "").trim();
    if (h === "gorusme-odasi" || h === "view=gorusme-odasi") return "gorusme-odasi";
    var t = (p.get("tool") || "").trim();
    if (t === "net-sihirbazi" || t === "yks-puan" || t === "tercih-sihirbazi") return t;
    var tm = (p.get("tmOpen") || "").trim();
    if (tm === "testmaker") return "testmaker";
  } catch (e) {}
  return "";
}

function isKurucuRole(role) {
  return role === "admin" || role === "kurucu" || role === "admin_roster";
}

function toCompatUser(appwriteUser) {
  return {
    uid: appwriteUser.$id,
    email: appwriteUser.email || "",
    getIdToken: function () {
      return Promise.resolve("appwrite-session");
    },
  };
}

function setDerecePanelAuthState(patch) {
  try {
    window.DerecePanelAuth = Object.assign({}, window.DerecePanelAuth || {}, patch, {
      updatedAt: Date.now(),
    });
  } catch (e) {}
}

/**
 * Kimlik göstergeleri (şifre saklanmaz). Oturum Appwrite çerez/session ile kalır.
 * @param {{ $id: string, email?: string }} accountUser
 * @param {object} profile
 * @param {{ minimal?: boolean }} [opts] — yalnızca `dp_appwrite_user_id` (kurucu vekil görünümü vb.)
 */
export function persistDereceAuthIdentity(accountUser, profile, opts) {
  opts = opts || {};
  try {
    if (accountUser && accountUser.$id) {
      localStorage.setItem("dp_appwrite_user_id", String(accountUser.$id));
    }
    if (opts.minimal) return;
    var displayUsername =
      (profile && profile.username) || inferUsernameFromEmail((accountUser && accountUser.email) || "");
    displayUsername = sanitizeUsernameForDb(displayUsername);
    if (displayUsername) localStorage.setItem("currentUser", displayUsername);
    if (profile) {
      localStorage.setItem("yksRole", profile.role || "");
      localStorage.setItem("yksStudentName", profile.fullName || profile.displayName || "");
      localStorage.setItem("yksCoachId", profile.coach_id || profile.coachId || "");
      var tenantId = profile.institutionId != null ? String(profile.institutionId).trim() : "";
      if (tenantId) {
        try {
          sessionStorage.setItem("dp_institution_id", tenantId);
        } catch (_s) {}
        localStorage.setItem("yksInstitutionId", tenantId);
      } else {
        try {
          sessionStorage.removeItem("dp_institution_id");
        } catch (_s2) {}
        try {
          localStorage.removeItem("yksInstitutionId");
        } catch (_l) {}
      }
    }
  } catch (e) {}
}

function releaseAuthGuardShell() {
  try {
    document.documentElement.classList.remove("auth-guard-pending");
    document.documentElement.classList.add("auth-guard-released");
  } catch (e) {}
}

function blockForever() {
  return new Promise(function () {});
}

function redirectTo(path) {
  try {
    window.location.replace(path);
  } catch (e) {}
  return blockForever();
}

function showNetworkGateOverlay(message) {
  releaseAuthGuardShell();
  try {
    var existing = document.getElementById("dp-coach-auth-gate-overlay");
    if (existing) existing.remove();
    var ov = document.createElement("div");
    ov.id = "dp-coach-auth-gate-overlay";
    ov.setAttribute("role", "alert");
    ov.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;" +
      "background:linear-gradient(160deg,#1e1b4b 0%,#312e81 40%,#0f172a 100%);color:#e0e7ff;" +
      "font-family:system-ui,-apple-system,sans-serif;padding:1.5rem;text-align:center;";
    ov.innerHTML =
      '<div style="max-width:420px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);' +
      "border-radius:16px;padding:1.75rem 1.5rem;box-shadow:0 24px 64px rgba(0,0,0,0.45);\">" +
      "<h1 style=\"margin:0 0 0.75rem;font-size:1.15rem;font-weight:800;\">Bağlantı sorunu</h1>" +
      "<p style=\"margin:0 0 1.25rem;font-size:0.95rem;line-height:1.5;opacity:0.92;\">" +
      (message || "Oturum sunucusu yanıt vermiyor. İnternetinizi kontrol edin.") +
      "</p>" +
      "<div style=\"display:flex;flex-wrap:wrap;gap:0.65rem;justify-content:center;\">" +
      "<button type=\"button\" id=\"dpGateRetry\" style=\"cursor:pointer;padding:0.55rem 1.1rem;border-radius:10px;" +
      "border:none;background:#a78bfa;color:#1e1b4b;font-weight:700;font-size:0.9rem;\">Yenile</button>" +
      "<a href=\"" +
      DP_LOGIN_PATH +
      "\" style=\"display:inline-flex;align-items:center;padding:0.55rem 1.1rem;border-radius:10px;" +
      "background:transparent;color:#c4b5fd;font-weight:600;font-size:0.9rem;border:1px solid rgba(196,181,253,0.5);\">Giriş</a>" +
      "</div></div>";
    document.body.appendChild(ov);
    var btn = document.getElementById("dpGateRetry");
    if (btn) btn.addEventListener("click", function () {
      void retryCoachPanelGate();
    });
  } catch (e) {}
}

function showUnauthorizedOverlay(title, detail) {
  releaseAuthGuardShell();
  try {
    var app = document.querySelector(".app");
    if (app) app.style.visibility = "hidden";
  } catch (e) {}
  try {
    var existing = document.getElementById("dp-coach-auth-gate-overlay");
    if (existing) existing.remove();
    var ov = document.createElement("div");
    ov.id = "dp-coach-auth-gate-overlay";
    ov.setAttribute("role", "alert");
    ov.style.cssText =
      "position:fixed;inset:0;z-index:2147483646;display:flex;align-items:center;justify-content:center;" +
      "background:linear-gradient(160deg,#450a0a 0%,#7f1d1d 45%,#0f172a 100%);color:#fecaca;" +
      "font-family:system-ui,-apple-system,sans-serif;padding:1.5rem;text-align:center;";
    ov.innerHTML =
      '<div style="max-width:440px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.14);' +
      "border-radius:16px;padding:1.75rem 1.5rem;box-shadow:0 24px 64px rgba(0,0,0,0.45);\">" +
      "<h1 style=\"margin:0 0 0.75rem;font-size:1.2rem;font-weight:800;\">" +
      (title || "Yetkisiz erişim") +
      "</h1>" +
      "<p style=\"margin:0 0 1.25rem;font-size:0.95rem;line-height:1.55;opacity:0.92;\">" +
      (detail || "Bu alanı yalnızca doğrulanmış koç hesapları kullanabilir.") +
      "</p>" +
      "<div style=\"display:flex;flex-wrap:wrap;gap:0.65rem;justify-content:center;\">" +
      "<a href=\"" +
      DP_LOGIN_PATH +
      "\" style=\"display:inline-flex;align-items:center;padding:0.55rem 1.1rem;border-radius:10px;" +
      "border:none;background:#f87171;color:#450a0a;font-weight:700;font-size:0.9rem;text-decoration:none;\">Giriş sayfası</a>" +
      "</div></div>";
    document.body.appendChild(ov);
  } catch (e) {}
}

async function verifyAccountWithRetries() {
  var timeouts = [12000, 10000];
  var lastVr = /** @type {{ ok: boolean, user?: object, error?: Error }} */ ({ ok: false });
  for (var i = 0; i < timeouts.length; i++) {
    lastVr = await verifyAppwriteAccount(timeouts[i]);
    if (lastVr.ok && lastVr.user) return lastVr;
    var msg = lastVr.error && lastVr.error.message ? String(lastVr.error.message) : "";
    var networkish =
      /zaman aşımı|timeout|timed out|failed to fetch|network|aborted|load failed/i.test(msg);
    if (networkish && i < timeouts.length - 1) continue;
    return lastVr;
  }
  return lastVr;
}

export function getLastCoachGateResult() {
  return lastGateResult;
}

/**
 * Koç paneli modülü yüklenmeden önce çağrılır (top-level await).
 */
export function getCoachPanelGate() {
  if (!gatePromise) gatePromise = runCoachPanelGate();
  return gatePromise;
}

/**
 * Tam sayfa yenileme (F5) olmadan oturum kapısını yeniden dener (SPA uyumu).
 * Ağ hatası örtüsündeki «Yenile» butonu bunu kullanır.
 */
export function retryCoachPanelGate() {
  try {
    var existing = document.getElementById("dp-coach-auth-gate-overlay");
    if (existing) existing.remove();
  } catch (e) {}
  gatePromise = null;
  return getCoachPanelGate();
}

async function runCoachPanelGate() {
  var vr = await verifyAccountWithRetries();
  if (!vr.ok || !vr.user) {
    var err = vr.error;
    var msg = err && err.message ? String(err.message) : "";
    var networkish =
      /zaman aşımı|timeout|timed out|failed to fetch|network|aborted|load failed/i.test(msg);
    if (networkish) {
      showNetworkGateOverlay(msg);
      return blockForever();
    }
    return redirectTo(DP_LOGIN_PATH);
  }

  var appwriteUser = vr.user;
  var compatUser = toCompatUser(appwriteUser);
  var profile = await fetchAppwriteUserProfile(compatUser, "");

  if (!profile || !profile.role) {
    await signOut(auth);
    try {
      localStorage.setItem("loginFlashError", "Hesap kaydı bulunamadı. Kurumunuzdaki yönetici ile iletişime geçin.");
    } catch (e) {}
    return redirectTo(DP_LOGIN_PATH);
  }

  var viewAs = "";
  try {
    viewAs = (sessionStorage.getItem("superAdminViewAsCoach") || "").trim();
  } catch (e) {}

  if (profile.role === "student") {
    return redirectTo(DP_STUDENT_PANEL_PATH);
  }

  if (isKurucuRole(profile.role)) {
    if (viewAs) {
      persistDereceAuthIdentity(appwriteUser, profile, { minimal: true });
      lastGateResult = { compatUser: compatUser, profile: profile, appwriteUser: appwriteUser };
      setDerecePanelAuthState({
        compatUser: compatUser,
        profile: profile,
        appwriteUser: appwriteUser,
        gate: "admin_impersonate",
      });
      releaseAuthGuardShell();
      return undefined;
    }
    var analyticsTool = getInitialKocViewFromUrl();
    if (
      analyticsTool === "net-sihirbazi" ||
      analyticsTool === "yks-puan" ||
      analyticsTool === "tercih-sihirbazi"
    ) {
      persistDereceAuthIdentity(appwriteUser, profile, { minimal: true });
      lastGateResult = { compatUser: compatUser, profile: profile, appwriteUser: appwriteUser };
      setDerecePanelAuthState({
        compatUser: compatUser,
        profile: profile,
        appwriteUser: appwriteUser,
        gate: "admin_tools",
      });
      releaseAuthGuardShell();
      return undefined;
    }
    return redirectTo(DP_SUPER_ADMIN_PATH);
  }

  if (profile.role !== "coach") {
    await signOut(auth);
    showUnauthorizedOverlay(
      "Yetkisiz erişim",
      "Bu panel yalnızca <strong>koç</strong> rolüne açıktır. Hesabınız farklı bir rol ile tanımlı."
    );
    return blockForever();
  }

  var appSettings = await getAppSettings();
  var maint = !!appSettings.maintenance;
  var impersonate = false;
  try {
    impersonate = !!(sessionStorage.getItem("superAdminViewAsCoach") || "").trim();
  } catch (e) {}
  if (maint && !impersonate) {
    await signOut(auth);
    try {
      localStorage.setItem("loginFlashError", "Bakımdayız. Şu an yalnızca kurucu girişi açıktır.");
    } catch (e2) {}
    return redirectTo(DP_LOGIN_PATH);
  }

  persistDereceAuthIdentity(appwriteUser, profile, {});
  var uname = profile.username;
  if (!uname && compatUser.email) uname = compatUser.email.split("@")[0];
  try {
    localStorage.setItem("currentUser", (uname || "").trim());
  } catch (e3) {}

  lastGateResult = { compatUser: compatUser, profile: profile, appwriteUser: appwriteUser };
  setDerecePanelAuthState({
    compatUser: compatUser,
    profile: profile,
    appwriteUser: appwriteUser,
    gate: "coach",
  });
  releaseAuthGuardShell();
  return undefined;
}
