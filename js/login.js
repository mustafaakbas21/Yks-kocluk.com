/**
 * YKS Koçluk — Basit giriş (Firebase Auth devre dışı)
 * Kullanıcı: admin | Şifre: admin123
 */

(function () {
  "use strict";

  const PANEL_PATH = "koc-panel.html";

  if (localStorage.getItem("isLoggedIn") === "true") {
    window.location.replace(PANEL_PATH);
    return;
  }

  const form = document.getElementById("loginForm");
  const errEl = document.getElementById("loginError");
  const submitBtn = document.getElementById("loginSubmit");
  const userInput = document.getElementById("loginUser");
  const passInput = document.getElementById("loginPassword");

  function showError(msg) {
    if (errEl) {
      errEl.textContent = msg;
      errEl.classList.add("is-visible");
    } else {
      alert(msg);
    }
  }

  function hideError() {
    if (errEl) errEl.classList.remove("is-visible");
  }

  if (!form || !userInput || !passInput) return;

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    hideError();

    const user = String(userInput.value).trim().toLowerCase();
    const password = passInput.value;

    if (user === "admin" && password === "admin123") {
      localStorage.setItem("isLoggedIn", "true");
      localStorage.setItem("role", "admin");
      window.location.href = PANEL_PATH;
      return;
    }

    showError("Hatalı giriş");
    if (submitBtn) submitBtn.disabled = false;
  });
})();
