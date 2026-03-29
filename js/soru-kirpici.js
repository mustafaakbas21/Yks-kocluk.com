/**
 * Soru Kırpıcı — koordinat motoru (PDF canvas ↔ görüntülenen CSS piksel oranı)
 * Manuel seçim kutusu (selection box) ile tam ölçekli kırpma; padding + çoklu soru uyarısı.
 */

export const SORU_KIRPICI_DEFAULTS = {
  /** Seçim kutusuna eklenen pay (CSS px) — şık / numara taşmasını azaltır */
  PADDING_CSS_PX: 8,
  /** Bu yüksekliği aşan seçimde “birden fazla soru” uyarısı (CSS px) */
  OVERLAP_WARN_CSS_HEIGHT: 800,
  /** Kenar örneklemede “beyaza yakın” eşik (0–255) */
  EDGE_WHITE_LUMA: 248,
};

/**
 * Canvas iç çözünürlüğü ile ekranda görünen kutu ölçüsü arasındaki ölçek.
 */
export function skGetCanvasCssScale(mainCanvas) {
  var r = mainCanvas.getBoundingClientRect();
  var rw = Math.max(r.width, 1e-6);
  var rh = Math.max(r.height, 1e-6);
  return {
    sx: mainCanvas.width / rw,
    sy: mainCanvas.height / rh,
    cssW: r.width,
    cssH: r.height,
  };
}

/**
 * Seçim kutusu köşeleri canvas görüntü alanına göre (CSS px, canvas içi 0..cssW).
 * @param {number} dispL - canvas içi sol (CSS)
 * @param {number} dispT - canvas içi üst (CSS)
 * @param {number} dispWi - genişlik (CSS)
 * @param {number} dispHi - yükseklik (CSS)
 */
export function skComputeCropPixels(mainCanvas, dispL, dispT, dispWi, dispHi) {
  var scale = skGetCanvasCssScale(mainCanvas);
  var pad = SORU_KIRPICI_DEFAULTS.PADDING_CSS_PX;
  var dL = Math.max(0, dispL - pad);
  var dT = Math.max(0, dispT - pad);
  var dR = Math.min(scale.cssW, dispL + dispWi + pad);
  var dB = Math.min(scale.cssH, dispT + dispHi + pad);
  var dW = Math.max(0, dR - dL);
  var dH = Math.max(0, dB - dT);
  if (dW < 2 || dH < 2) {
    return { ok: false, reason: "Alan çok küçük veya padding sonrası geçersiz." };
  }
  var x0 = dL * scale.sx;
  var y0 = dT * scale.sy;
  var x1 = (dL + dW) * scale.sx;
  var y1 = (dT + dH) * scale.sy;
  var cw = mainCanvas.width;
  var ch = mainCanvas.height;
  var x = Math.max(0, Math.floor(x0));
  var y = Math.max(0, Math.floor(y0));
  var w = Math.max(1, Math.ceil(x1 - x0));
  var h = Math.max(1, Math.ceil(y1 - y0));
  x = Math.max(0, Math.min(x, cw - 1));
  y = Math.max(0, Math.min(y, ch - 1));
  w = Math.min(w, cw - x);
  h = Math.min(h, ch - y);
  return {
    ok: true,
    x: x,
    y: y,
    w: w,
    h: h,
    scale: scale,
    selectionCssHeight: dispHi,
  };
}

/**
 * Kırpma öncesi: bölgenin kenar şeritlerinde ortalama parlaklık (basit beyazlık testi).
 */
export function skEdgeMeanLuma(ctx, cw, ch, rect) {
  var strip = Math.min(6, Math.floor(Math.min(rect.w, rect.h) / 8) || 3);
  var samples = [];
  function sampleBand(ox, oy, sw, sh) {
    if (sw < 1 || sh < 1) return;
    try {
      var d = ctx.getImageData(ox, oy, sw, sh).data;
      var n = d.length / 4;
      var sum = 0;
      for (var i = 0; i < d.length; i += 4) {
        sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      }
      samples.push(sum / Math.max(n, 1));
    } catch (_e) {}
  }
  var x = rect.x;
  var y = rect.y;
  var w = rect.w;
  var h = rect.h;
  sampleBand(x, y, w, strip);
  sampleBand(x, y + h - strip, w, strip);
  sampleBand(x, y, strip, h);
  sampleBand(x + w - strip, y, strip, h);
  if (!samples.length) return 200;
  var t = 0;
  samples.forEach(function (s) {
    t += s;
  });
  return t / samples.length;
}

/**
 * Kenar çok beyazsa konsola uyarı; isteğe bağlı ekstra padding (canvas px) öner.
 */
export function skWarnIfSparseCrop(ctx, fullW, fullH, rect) {
  var lu = skEdgeMeanLuma(ctx, fullW, fullH, rect);
  var th = SORU_KIRPICI_DEFAULTS.EDGE_WHITE_LUMA;
  if (lu >= th) {
    console.warn(
      "[SoruKirpici] Seçim kenarları çok açık renk (ortalama luma ≈ " +
        lu.toFixed(1) +
        "). Soru gövdesi veya şıklar kesilmiş olabilir; gerekirse seçimi genişletin."
    );
  }
  return lu;
}

export function skShouldWarnTallSelection(selectionCssHeight) {
  return selectionCssHeight > SORU_KIRPICI_DEFAULTS.OVERLAP_WARN_CSS_HEIGHT;
}

/**
 * Appwrite `source` (max 64) — sayfa + soru no meta.
 */
export function skEncodeCropSource(base, pdfSayfa, soruNo) {
  var b = String(base || "pdf_crop").trim() || "pdf_crop";
  var meta = "p" + String(pdfSayfa != null ? pdfSayfa : "") + "|q" + String(soruNo != null ? soruNo : "");
  var s = b + "|" + meta;
  if (s.length <= 64) return s;
  return s.slice(0, 64);
}
