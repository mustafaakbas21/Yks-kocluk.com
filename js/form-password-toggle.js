/**
 * Form şifre göster/gizle — .form-pw-wrap içindeki input + .form-pw-toggle
 * login.html / panel-admin-auth.html giriş alanına dokunulmaz (id’ler farklıysa ayrı init gerekir).
 */
(function () {
  function applyVisibility(input, btn, iconPlain, iconSlashed, isPlainVisible) {
    input.type = isPlainVisible ? "text" : "password";
    btn.setAttribute("aria-pressed", isPlainVisible ? "true" : "false");
    btn.setAttribute("aria-label", isPlainVisible ? "Şifreyi gizle" : "Şifreyi göster");
    if (iconPlain && iconSlashed) {
      iconPlain.hidden = isPlainVisible;
      iconSlashed.hidden = !isPlainVisible;
    }
  }

  function wireWrap(wrap) {
    var input = wrap.querySelector("input.form-pw-wrap__input");
    var btn = wrap.querySelector(".form-pw-toggle");
    if (!input || !btn || btn.getAttribute("data-pw-toggle-bound") === "1") return;
    btn.setAttribute("data-pw-toggle-bound", "1");
    var iconPlain = btn.querySelector(".form-pw-toggle__icon--plain");
    var iconSlashed = btn.querySelector(".form-pw-toggle__icon--slashed");

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var showPlain = input.type === "password";
      applyVisibility(input, btn, iconPlain, iconSlashed, showPlain);
    });

    applyVisibility(input, btn, iconPlain, iconSlashed, false);
  }

  function init() {
    document.querySelectorAll(".form-pw-wrap").forEach(wireWrap);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
