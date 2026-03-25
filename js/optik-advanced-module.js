/**
 * Optik — OCR (Tesseract.js), CSV/DAT içe aktarma ön işleme.
 */
function preprocessCanvasFromImage(img, maxSide) {
  maxSide = maxSide || 1800;
  var w = img.naturalWidth || img.width;
  var h = img.naturalHeight || img.height;
  var scale = Math.min(1, maxSide / Math.max(w, h));
  var cw = Math.round(w * scale);
  var ch = Math.round(h * scale);
  var c = document.createElement("canvas");
  c.width = cw;
  c.height = ch;
  var ctx = c.getContext("2d");
  ctx.drawImage(img, 0, 0, cw, ch);
  var imgData = ctx.getImageData(0, 0, cw, ch);
  var d = imgData.data;
  for (var i = 0; i < d.length; i += 4) {
    var g = (d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114) | 0;
    var b = g > 128 ? 255 : 0;
    d[i] = d[i + 1] = d[i + 2] = b;
  }
  ctx.putImageData(imgData, 0, 0);
  return c;
}

/**
 * @param {{ showToast: function }} ctx
 */
export function initOptikAdvancedBindings(ctx) {
  var panel = document.getElementById("optikPanelAdvanced");
  if (!panel || panel.dataset.optikAdvBound) return;
  panel.dataset.optikAdvBound = "1";

  var fileEl = document.getElementById("optikOcrFile");
  var preview = document.getElementById("optikOcrPreview");
  var btnRun = document.getElementById("optikOcrRun");
  var outEl = document.getElementById("optikOcrOutput");
  var mergeTa = document.getElementById("optikBulkTextarea");

  if (fileEl && preview) {
    fileEl.addEventListener("change", function () {
      var f = fileEl.files && fileEl.files[0];
      if (!f) return;
      var url = URL.createObjectURL(f);
      var im = new Image();
      im.onload = function () {
        try {
          var can = preprocessCanvasFromImage(im, 1600);
          preview.width = can.width;
          preview.height = can.height;
          preview.getContext("2d").drawImage(can, 0, 0);
        } catch (e) {
          console.warn(e);
        }
        URL.revokeObjectURL(url);
      };
      im.onerror = function () {
        URL.revokeObjectURL(url);
        if (ctx && ctx.showToast) ctx.showToast("Görüntü okunamadı.");
      };
      im.src = url;
    });
  }

  if (btnRun && preview) {
    btnRun.addEventListener("click", async function () {
      if (!preview.width || !preview.height) {
        if (ctx && ctx.showToast) ctx.showToast("Önce görüntü dosyası seçin.");
        return;
      }
      try {
        ctx.showToast("OCR başlatılıyor…");
        var mod = await import("https://esm.sh/tesseract.js@5.1.0");
        var createWorker = mod.createWorker;
        if (typeof createWorker !== "function") {
          ctx.showToast("Tesseract yüklenemedi.");
          return;
        }
        var worker = await createWorker("eng");
        await worker.setParameters({ tessedit_char_whitelist: "ABCDEabcde " });
        var c = document.createElement("canvas");
        c.width = preview.width;
        c.height = preview.height;
        c.getContext("2d").drawImage(preview, 0, 0);
        var res = await worker.recognize(c);
        await worker.terminate();
        var txt = (res && res.data && res.data.text) || "";
        if (outEl) outEl.textContent = txt;
        var letters = txt.toUpperCase().replace(/[^ABCDE]/g, "");
        if (mergeTa && letters.length >= 20) {
          mergeTa.value =
            (mergeTa.value ? mergeTa.value.trim() + "\n" : "") +
            "# OCR — yapıştırılan harf dizisi\n" +
            letters;
        }
        ctx.showToast("OCR tamamlandı (" + letters.length + " şık harfi).");
      } catch (e) {
        console.error(e);
        ctx.showToast("OCR hatası: ağ veya tarayıcı izni.");
      }
    });
  }

  var btnDat = document.getElementById("optikDatMerge");
  if (btnDat && mergeTa) {
    btnDat.addEventListener("click", function () {
      var raw = ((document.getElementById("optikDatPaste") || {}).value || "").trim();
      if (!raw) {
        ctx.showToast("DAT/CSV metnini yapıştırın.");
        return;
      }
      var lines = raw.split(/\r?\n/);
      var added = 0;
      lines.forEach(function (line, i) {
      line = line.trim();
        if (!line || line.charAt(0) === "#") return;
        var parts = line.split(/[;\t]/).map(function (x) { return x.trim(); });
        if (parts.length < 2) return;
        var key = parts[0];
        var rest = parts.slice(1).join(" ");
        var ans = rest.toUpperCase().replace(/[^ABCDE]/g, "");
        if (!ans.length) return;
        mergeTa.value += (mergeTa.value ? "\n" : "") + key + "\t" + ans;
        added++;
      });
      ctx.showToast(added ? added + " satır birleştirildi (optik toplu alanına)." : "Uygun satır bulunamadı.");
    });
  }
}
