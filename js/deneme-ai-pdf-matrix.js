/**
 * Deneme kitapçığı PDF → metin (pdf.js) + Gemini proxy (/api/analyze-exam) ile soru–konu matrisi.
 * API anahtarı yalnızca Vercel sunucusunda (GEMINI_API_KEY); tarayıcıda tutulmaz.
 */

import { yks2026DersKeys, yks2026KonuOptionsForDers } from "./yks-mufredat.js";

/** İsteğe bağlı: `VITE_ANALYZE_EXAM_URL` veya `window.__DNM_AI_CONFIG.analyzeExamUrl` ile özel uç nokta */
export const DNM_AI_MATRIX_CONFIG = {
  analyzeExamUrl:
    typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_ANALYZE_EXAM_URL
      ? String(import.meta.env.VITE_ANALYZE_EXAM_URL)
      : "",
};

var PDFJS_BASE = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/";
var pdfJsModulePromise = null;

function dnmAiApplyRuntimeConfig() {
  try {
    var w = typeof globalThis !== "undefined" ? globalThis.__DNM_AI_CONFIG : null;
    if (!w || typeof w !== "object") return;
    if (w.analyzeExamUrl != null) DNM_AI_MATRIX_CONFIG.analyzeExamUrl = String(w.analyzeExamUrl);
  } catch (e) {}
}

function getAnalyzeExamEndpoint() {
  dnmAiApplyRuntimeConfig();
  var u = String(DNM_AI_MATRIX_CONFIG.analyzeExamUrl || "").trim();
  if (u) return u;
  return "/api/analyze-exam";
}

function dnmExamKeyFromTur(tur) {
  var t = String(tur || "TYT").toUpperCase();
  if (t === "LGS") return "TYT";
  var keys = yks2026DersKeys(t);
  if (keys && keys.length) return t;
  return "TYT";
}

function dnmPickClosestDers(examKey, subjectRaw) {
  var list = yks2026DersKeys(examKey);
  if (!list || !list.length) list = ["TYT Türkçe"];
  var raw = String(subjectRaw || "").trim().toLowerCase();
  if (!raw) return list[0];
  var i;
  for (i = 0; i < list.length; i++) {
    if (list[i].toLowerCase() === raw) return list[i];
  }
  var rawC = raw.replace(/\s+/g, "");
  for (i = 0; i < list.length; i++) {
    if (list[i].replace(/\s+/g, "").toLowerCase() === rawC) return list[i];
  }
  for (i = 0; i < list.length; i++) {
    var k = list[i].toLowerCase();
    if (k.indexOf(raw) !== -1 || raw.indexOf(k) !== -1) return list[i];
  }
  if ((/tyt\s*mat\b|^mat\b/i.test(subjectRaw) || /^matematik/i.test(raw)) && examKey === "TYT") {
    for (i = 0; i < list.length; i++) {
      if (list[i].indexOf("TYT Matematik") === 0) return list[i];
    }
  }
  if (/ayt\s*mat\b/i.test(subjectRaw) || (raw.indexOf("matematik") !== -1 && examKey === "AYT")) {
    for (i = 0; i < list.length; i++) {
      if (list[i].indexOf("AYT Matematik") === 0) return list[i];
    }
  }
  return list[0];
}

function dnmPickClosestKonu(examKey, ders, topicRaw) {
  var t = String(topicRaw || "").trim();
  var opts = yks2026KonuOptionsForDers(examKey, ders);
  if (!opts.length) return t || "Genel";
  if (!t) return opts[0].value;
  var low = t.toLowerCase();
  var j;
  for (j = 0; j < opts.length; j++) {
    if (opts[j].value === t || opts[j].text === t) return opts[j].value;
  }
  for (j = 0; j < opts.length; j++) {
    var v = opts[j].value.toLowerCase();
    var tx = opts[j].text.toLowerCase();
    if (low === v || low === tx || v.indexOf(low) !== -1 || low.indexOf(v) !== -1 || tx.indexOf(low) !== -1) {
      return opts[j].value;
    }
  }
  return t;
}

/**
 * @param {string} examKey
 * @param {Array<{ questionNo: number, subject: string, topic: string, answer?: string }>} items
 * @returns {DnmAiMatrixRow[]}
 */
function dnmMapApiItemsToRows(examKey, items) {
  if (!items || !items.length) return [];
  return items.map(function (it) {
    var q = parseInt(String(it.questionNo != null ? it.questionNo : 0), 10);
    if (isNaN(q) || q < 1) q = 1;
    if (q > 40) q = 40;
    var ders = dnmPickClosestDers(examKey, it.subject);
    var konu = dnmPickClosestKonu(examKey, ders, it.topic);
    var ans = String(it.answer != null ? it.answer : "A")
      .trim()
      .toUpperCase()
      .charAt(0);
    if ("ABCDE".indexOf(ans) === -1) ans = "A";
    return {
      questionNo: q,
      ders: ders,
      konu: konu,
      answer: ans,
    };
  });
}

/**
 * pdf.js (ESM) tek seferlik yükleme + worker.
 * @returns {Promise<typeof import("pdfjs-dist")>}
 */
export async function ensurePdfJsLoaded() {
  if (pdfJsModulePromise) return pdfJsModulePromise;
  pdfJsModulePromise = (async function () {
    var mod = await import(/* @vite-ignore */ PDFJS_BASE + "pdf.mjs");
    if (mod.GlobalWorkerOptions) {
      mod.GlobalWorkerOptions.workerSrc = PDFJS_BASE + "pdf.worker.mjs";
    }
    return mod;
  })();
  return pdfJsModulePromise;
}

/**
 * PDF dosyasından düz metin çıkarır (tüm sayfalar).
 * @param {File|Blob} file
 * @returns {Promise<string>}
 */
export async function extractTextFromPDF(file) {
  if (!file) throw new Error("PDF dosyası yok.");
  var pdfjs = await ensurePdfJsLoaded();
  var buf = await file.arrayBuffer();
  var loadingTask = pdfjs.getDocument({ data: buf });
  var pdf = await loadingTask.promise;
  var parts = [];
  for (var p = 1; p <= pdf.numPages; p++) {
    var page = await pdf.getPage(p);
    var tc = await page.getTextContent();
    var line = "";
    for (var i = 0; i < tc.items.length; i++) {
      var it = tc.items[i];
      line += (it && it.str) || "";
      if (it && it.hasEOL) line += "\n";
    }
    parts.push(line);
  }
  return parts.join("\n\n").trim();
}

/**
 * @typedef {{ questionNo: number, ders: string, konu: string, answer?: string }} DnmAiMatrixRow
 */

var DNM_AI_BUSY_MSG = "AI şu an yoğun, lütfen sonra tekrar deneyin veya manuel doldurun";

/**
 * PDF metnini sunucudaki Gemini proxy ile analiz eder; matris satırları döner.
 * @param {string} pdfText
 * @param {{ examType?: string, questionCountHint?: number }} [ctx]
 * @returns {Promise<{ source: 'gemini', rows: DnmAiMatrixRow[] }>}
 */
export async function analyzeExamWithAI(pdfText, ctx) {
  ctx = ctx || {};
  var endpoint = getAnalyzeExamEndpoint();
  var examTur = String(ctx.examType || "TYT").trim();
  var examKey = dnmExamKeyFromTur(examTur);

  var res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pdfText: pdfText,
      examType: examTur,
      questionCountHint: ctx.questionCountHint,
    }),
  });

  var data = {};
  try {
    data = await res.json();
  } catch (e) {
    data = {};
  }

  if (!res.ok) {
    if (data && data.error) throw new Error(String(data.error));
    throw new Error(DNM_AI_BUSY_MSG);
  }
  if (!data.ok || !data.items || !data.items.length) {
    if (data && data.error) throw new Error(String(data.error));
    throw new Error(DNM_AI_BUSY_MSG);
  }

  var rows = dnmMapApiItemsToRows(examKey, data.items);
  if (!rows.length) throw new Error(DNM_AI_BUSY_MSG);

  return { source: "gemini", rows: rows };
}
