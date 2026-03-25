/**
 * Havuzdan filtreli PDF — mock veri yok; listDocuments + soru_resim_id → getFilePreview URL
 */
import {
  getPoolCoachKey,
  listSoruDocumentsForPdf,
  resolvePoolPreviewUrlFromDoc,
} from "./soru-havuzu-core.js";
import { yksMufredatDatasi } from "./mufredat-data.js";
import "./appwrite-config.js";

var curriculum = yksMufredatDatasi || {};

function $(id) {
  return document.getElementById(id);
}

function fillDersFromSinav() {
  var sinEl = $("pdfSinav");
  var dersEl = $("pdfDers");
  var konuEl = $("pdfKonu");
  if (!sinEl || !dersEl || !konuEl) return;
  var ex = sinEl.value || "TYT";
  var bag = curriculum[ex] || {};
  var dersler = Object.keys(bag).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
  dersEl.innerHTML = "";
  dersler.forEach(function (d) {
    var o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    dersEl.appendChild(o);
  });
  fillKonu();
}

function fillKonu() {
  var sinEl = $("pdfSinav");
  var dersEl = $("pdfDers");
  var konuEl = $("pdfKonu");
  if (!sinEl || !dersEl || !konuEl) return;
  var ex = sinEl.value || "TYT";
  var d = dersEl.value;
  var bag = curriculum[ex] || {};
  var list = (bag[d] || []).slice();
  konuEl.innerHTML = "";
  if (!list.length) {
    var ox = document.createElement("option");
    ox.value = "Genel";
    ox.textContent = "Genel";
    konuEl.appendChild(ox);
    return;
  }
  list.forEach(function (t) {
    var o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    konuEl.appendChild(o);
  });
}

function setBusy(btn, on) {
  if (!btn) return;
  btn.disabled = !!on;
  btn.setAttribute("aria-busy", on ? "true" : "false");
}

function showEmpty(on) {
  var el = $("pdfEmpty");
  if (el) el.hidden = !on;
}

function showError(msg) {
  var el = $("pdfError");
  if (el) {
    el.hidden = !msg;
    el.textContent = msg || "";
    if (msg) el.removeAttribute("hidden");
    else el.setAttribute("hidden", "");
  }
}

function fetchImageAsDataUrl(url) {
  return fetch(url, { mode: "cors", credentials: "omit", cache: "no-store" })
    .then(function (r) {
      if (!r.ok) throw new Error("Görsel indirilemedi (HTTP " + r.status + ")");
      return r.blob();
    })
    .then(function (blob) {
      return new Promise(function (resolve, reject) {
        var fr = new FileReader();
        fr.onload = function () {
          resolve(fr.result);
        };
        fr.onerror = function () {
          reject(new Error("Dosya okunamadı"));
        };
        fr.readAsDataURL(blob);
      });
    });
}

function buildPdfFromDocuments(docs, titleBase) {
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    return Promise.reject(new Error("jsPDF yüklenemedi."));
  }
  var J = window.jspdf.jsPDF;
  var doc = new J({ unit: "pt", format: "a4", orientation: "portrait", compress: true });
  var pageW = doc.internal.pageSize.getWidth();
  var pageH = doc.internal.pageSize.getHeight();
  var margin = 28;
  var added = 0;

  function addOnePage(dataUrl, label) {
    var fmt = "JPEG";
    if (typeof dataUrl === "string" && /data:image\/png/i.test(dataUrl)) fmt = "PNG";
    var iw = pageW - margin * 2;
    var ih = pageH - margin * 2 - (label ? 22 : 0);
    try {
      var prop = doc.getImageProperties(dataUrl);
      var rw = prop.width || iw;
      var rh = prop.height || ih;
      var ratio = Math.min(iw / rw, ih / rh);
      var w = rw * ratio;
      var h = rh * ratio;
      var x = (pageW - w) / 2;
      var y = margin + (label ? 18 : 0);
      doc.addImage(dataUrl, fmt, x, y, w, h, undefined, fmt === "PNG" ? "FAST" : "MEDIUM");
    } catch (e1) {
      doc.addImage(dataUrl, fmt, margin, margin + (label ? 18 : 0), iw, ih);
    }
    if (label) {
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 110);
      doc.text(String(label).slice(0, 120), margin, margin + 10);
    }
  }

  var chain = Promise.resolve();
  docs.forEach(function (row) {
    chain = chain.then(function () {
      var url = resolvePoolPreviewUrlFromDoc(row);
      if (!url) return;
      var meta = (row.ders || "") + " — " + (row.konu || "") + " · " + (row.zorluk || "");
      return fetchImageAsDataUrl(url)
        .then(function (dataUrl) {
          if (added > 0) doc.addPage();
          addOnePage(dataUrl, meta);
          added++;
        })
        .catch(function (e) {
          console.warn("[soru-pdf-hazirla] görsel atlandı:", e);
        });
    });
  });

  return chain.then(function () {
    if (added === 0) {
      throw new Error("Görseller indirilemedi veya URL yok (CORS / izin / soru_resim_id).");
    }
    var fn =
      (titleBase || "Havuz_Sorulari").replace(/[\\/:*?"<>|]/g, "-").slice(0, 120) || "Havuz_Sorulari";
    doc.save(fn + ".pdf");
  });
}

function run() {
  var coachKey = getPoolCoachKey();
  showError("");
  showEmpty(false);

  if (!coachKey) {
    showError("Oturum bulunamadı. Koç girişi yapın (localStorage currentUser) veya bu sayfayı panel içinden açın.");
    return;
  }
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    showError("jsPDF kütüphanesi yüklenemedi; sayfayı yenileyin.");
    return;
  }

  var sinav = (($("pdfSinav") || {}).value || "").trim();
  var ders = (($("pdfDers") || {}).value || "").trim();
  var konu = (($("pdfKonu") || {}).value || "").trim();
  var zorluk = (($("pdfZorluk") || {}).value || "").trim();

  var btn = $("pdfBuildBtn");
  setBusy(btn, true);

  listSoruDocumentsForPdf(coachKey, { sinav: sinav, ders: ders, konu: konu, zorluk: zorluk })
    .then(function (docs) {
      if (!docs || !docs.length) {
        showEmpty(true);
        return;
      }
      showEmpty(false);
      var title =
        "Havuz_" + sinav + "_" + ders + "_" + konu + "_" + (zorluk || "Tum");
      return buildPdfFromDocuments(docs, title);
    })
    .catch(function (e) {
      console.error("[soru-pdf-hazirla]", e);
      showError(
        "Liste veya PDF oluşturulamadı: " +
          (e && e.message ? String(e.message) : String(e))
      );
    })
    .finally(function () {
      setBusy(btn, false);
    });
}

function init() {
  var sinEl = $("pdfSinav");
  var dersEl = $("pdfDers");
  if (sinEl) sinEl.addEventListener("change", fillDersFromSinav);
  if (dersEl) dersEl.addEventListener("change", fillKonu);
  fillDersFromSinav();

  var btn = $("pdfBuildBtn");
  if (btn) btn.addEventListener("click", run);
}

init();
