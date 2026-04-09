/**
 * Optik dışa aktarma + tarama çizgisi animasyonu.
 * Piksel OMR mantığı `optik-okuma.js` içinde (`scanRealOptikImage`, `analyzeBubble`).
 */

/** Sabit kayıt: 5 (no) + 25 (isim) + 5 (ayırıcı/boşluk) + şıklar → cevaplar 36. karakterden (1-tabanlı, indeks 35). */
export const OPTIK_RECORD_HEADER_LEN = 35;

/**
 * @param {string} studentNo
 * @param {string} name
 * @param {string} answersLetters A–E dizisi
 */
export function buildOptikFixedRecord(studentNo, name, answersLetters) {
  var rawNo = String(studentNo != null ? studentNo : "").trim();
  var noField;
  if (/^\d+$/.test(rawNo)) {
    noField = rawNo.slice(-5).padStart(5, "0");
  } else {
    noField = rawNo.slice(0, 5).padEnd(5, " ");
  }
  var nameField = String(name != null ? name : "")
    .slice(0, 25)
    .padEnd(25, " ");
  var gap5 = "     ";
  var ans = String(answersLetters || "")
    .toUpperCase()
    .replace(/[^ABCDEXZ]/g, "");
  return noField + nameField + gap5 + ans;
}

/**
 * @param {Array<{ studentNo?: string, name?: string, answersString?: string }>} studentsData
 * @param {{ filename?: string, extension?: "bin"|"txt", mime?: string }} [opts]
 */
export function exportToBin(studentsData, opts) {
  opts = opts || {};
  var ext = opts.extension === "txt" ? "txt" : "bin";
  var filename = (opts.filename || "optik_export").replace(/\.(bin|txt)$/i, "") + "." + ext;
  var lines = (studentsData || []).map(function (s) {
    return buildOptikFixedRecord(s.studentNo, s.name, s.answersString);
  });
  var body = lines.join("\r\n");
  var mime = opts.mime || "application/octet-stream";
  var blob = new Blob([body], { type: mime });
  var url = URL.createObjectURL(blob);
  var a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(function () {
    URL.revokeObjectURL(url);
  }, 2500);
}

/**
 * @param {HTMLElement} overlayEl
 * @param {number} durationMs
 * @returns {Promise<void>}
 */
export function runScanlineAnimation(overlayEl, durationMs) {
  durationMs = durationMs || 1400;
  var line = overlayEl && overlayEl.querySelector("[data-optik-scanline]");
  if (!overlayEl) return Promise.resolve();
  if (!line) {
    return new Promise(function (resolve) {
      setTimeout(resolve, durationMs);
    });
  }

  return new Promise(function (resolve) {
    var start = null;
    function frame(t) {
      if (start == null) start = t;
      var p = Math.min(1, (t - start) / durationMs);
      var pct = p * 100;
      line.style.top = pct + "%";
      line.style.opacity = String(0.85 + 0.15 * Math.sin(p * Math.PI));
      if (p < 1) {
        requestAnimationFrame(frame);
      } else {
        line.style.top = "100%";
        resolve();
      }
    }
    line.style.top = "0%";
    requestAnimationFrame(frame);
  });
}
