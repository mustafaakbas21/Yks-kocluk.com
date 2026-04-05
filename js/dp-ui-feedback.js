/**
 * Panel — tutarlı toast, API geri bildirimi ve alan düzeyinde hata gösterimi
 */

export const DP_MSG_API_SUCCESS = "Başarıyla kaydedildi";

export function dpFormatApiError(err) {
  if (err == null) return "Bilinmeyen hata";
  if (typeof err === "string") return err;
  var msg = err.message || err.code || "";
  if (!msg && typeof err.toString === "function") msg = err.toString();
  return String(msg || "Bilinmeyen hata").trim() || "Bilinmeyen hata";
}

function getToastEl() {
  return document.getElementById("panelToast");
}

/**
 * Genel toast (mevcut 100+ çağrı ile uyumlu)
 * @param {string} msg
 * @param {{ variant?: 'success' | 'danger' }} [opts]
 */
export function showToast(msg, opts) {
  var t = getToastEl();
  if (!t) {
    window.alert(String(msg || ""));
    return;
  }
  t.textContent = String(msg || "");
  t.classList.remove("pulse-in");
  void t.offsetWidth;
  t.classList.add("pulse-in");
  t.classList.remove("toast--success", "toast--danger");
  if (opts && opts.variant === "success") t.classList.add("toast--success");
  else if (opts && opts.variant === "danger") t.classList.add("toast--danger");
  t.hidden = false;
  t.classList.add("toast--show");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(function () {
    t.classList.remove("toast--show", "toast--success", "toast--danger", "pulse-in");
    t.hidden = true;
  }, 3200);
}

export function dpToastApiSuccess(message) {
  showToast(message || DP_MSG_API_SUCCESS, { variant: "success" });
}

/** @param {string} detail — kısa hata özeti (prefix otomatik) */
export function dpToastApiError(detail) {
  var d = dpFormatApiError(detail);
  showToast("Bir sorun oluştu: " + d, { variant: "danger" });
}

export function showToastPersistent(msg) {
  var t = getToastEl();
  if (!t) {
    window.alert(String(msg || ""));
    return;
  }
  clearTimeout(showToast._tm);
  t.textContent = String(msg || "");
  t.classList.remove("toast--success", "toast--danger");
  t.hidden = false;
  t.classList.add("toast--show");
}

export function hidePanelToast() {
  var t = getToastEl();
  clearTimeout(showToast._tm);
  if (t) {
    t.classList.remove("toast--show", "toast--success", "toast--danger", "pulse-in");
    t.hidden = true;
  }
}

/**
 * @param {HTMLElement|string|null} root — form veya container
 */
export function dpClearFieldErrors(root) {
  if (!root || typeof root.querySelectorAll !== "function") return;
  root.querySelectorAll(".dp-field-msg").forEach(function (p) {
    p.remove();
  });
  root.querySelectorAll(".dp-input-invalid").forEach(function (inp) {
    inp.classList.remove("dp-input-invalid");
    inp.removeAttribute("aria-invalid");
  });
}

/**
 * @param {HTMLElement|string} field
 * @param {string} message
 */
export function dpSetFieldError(field, message) {
  var el = typeof field === "string" ? document.getElementById(field) : field;
  if (!el) return;
  el.classList.add("dp-input-invalid");
  el.setAttribute("aria-invalid", "true");
  var g = el.closest(".form-group");
  if (!g) return;
  var msgEl = g.querySelector(":scope > .dp-field-msg");
  if (!msgEl) {
    msgEl = document.createElement("p");
    msgEl.className = "dp-field-msg";
    msgEl.setAttribute("role", "alert");
    g.appendChild(msgEl);
  }
  msgEl.textContent = message;
}

/** @param {HTMLElement|string} field */
export function dpFocusField(field) {
  var el = typeof field === "string" ? document.getElementById(field) : field;
  if (el && typeof el.focus === "function") {
    try {
      el.focus();
    } catch (_e) {}
  }
}

/**
 * @param {string} raw
 * @param {{ required?: boolean, min?: number, max?: number }} [opts]
 * @returns {{ ok: boolean, value: string | null, message?: string }}
 */
export function dpParseDecimalField(raw, opts) {
  var req = !!(opts && opts.required);
  var min = opts && opts.min != null ? opts.min : 0;
  var max = opts && opts.max != null ? opts.max : 999;
  var s = String(raw || "").trim();
  if (!s) {
    if (req) return { ok: false, value: null, message: "Bu alan zorunludur." };
    return { ok: true, value: null };
  }
  var n = parseFloat(s.replace(",", "."), 10);
  if (isNaN(n))
    return { ok: false, value: null, message: "Geçerli bir sayı girin (örn. 85,5)." };
  if (n < min || n > max)
    return {
      ok: false,
      value: null,
      message: "Değer " + min + " ile " + max + " arasında olmalıdır.",
    };
  return { ok: true, value: s };
}
