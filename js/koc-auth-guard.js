/**
 * Koç paneli: içerik görünmeden önce oturum doğrulama (isteğe bağlı gecikme / ağ toleransı).
 */
import { verifyAppwriteAccount } from "./appwrite-compat.js";

(function releaseGuard() {
  var root = document.documentElement;
  try {
    if (!root.classList.contains("auth-guard-pending")) {
      root.classList.add("auth-guard-released");
      return;
    }
  } catch (_e) {
    root.classList.add("auth-guard-released");
    return;
  }

  setTimeout(function () {
    if (root.classList.contains("auth-guard-pending")) {
      console.warn("[auth-guard] Oturum yanıtı gecikti; panel kilidi kaldırılıyor.");
      root.classList.remove("auth-guard-pending");
      root.classList.add("auth-guard-released");
    }
  }, 15000);

  verifyAppwriteAccount(10000)
    .then(function (vr) {
      if (!vr.ok) {
        var msg = (vr.error && vr.error.message) || "";
        if (/zaman aşımı|timeout|failed to fetch|network|aborted/i.test(msg)) {
          console.warn("[auth-guard] Oturum doğrulanamadı (ağ). Panel açılıyor; koc-panel.js yeniden deneyecek.");
          root.classList.remove("auth-guard-pending");
          root.classList.add("auth-guard-released");
          return;
        }
        window.location.replace("/login");
        return;
      }
      root.classList.remove("auth-guard-pending");
      root.classList.add("auth-guard-released");
    })
    .catch(function (e) {
      console.warn("[auth-guard]", e);
      root.classList.remove("auth-guard-pending");
      root.classList.add("auth-guard-released");
    });
})();
