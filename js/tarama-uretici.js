/**
 * Tarama (Soru Arşivi) — filtreler, mock havuz, sepet, PDF stub, Hibrit Zeka V4.1 (Gemini).
 * API: POST /api/ai (anahtar yalnızca sunucuda GEMINI_API_KEY).
 * Özel URL: window.__GEMINI_PROXY_URL
 */

import { showToast } from "./dp-ui-feedback.js";
import {
  YKS_TAKSONOMI_DERSLER,
  getTaksonomiDersById,
  getTaksonomiKonuById,
  getTaksonomiKazanimById,
  buildTaramaGeminiSystemInstruction,
} from "../src/data/yks-taksonomi.js";

/** Sunucu proxy — istemcide API anahtarı yoktur. */
function getGeminiProxyUrl() {
  if (typeof window !== "undefined" && window.__GEMINI_PROXY_URL) {
    return String(window.__GEMINI_PROXY_URL).replace(/\/?$/, "");
  }
  return "/api/ai";
}

var GEMINI_MAX_OUTPUT_TOKENS = 8192;

var TARAMA_ONE_JSON_SCHEMA = {
  type: "object",
  properties: {
    soruMetni: { type: "string", description: "Soru kökü" },
    secenekler: {
      type: "array",
      items: { type: "string" },
      minItems: 5,
      maxItems: 5,
      description: "A–E şıkları sırayla",
    },
    zorluk: { type: "string", description: "Kolay, Orta veya Zor" },
  },
  required: ["soruMetni", "secenekler"],
};

var TARAMA_BATCH_JSON_SCHEMA = {
  type: "object",
  properties: {
    sorular: {
      type: "array",
      items: {
        type: "object",
        properties: {
          soruMetni: { type: "string" },
          secenekler: { type: "array", items: { type: "string" }, minItems: 5, maxItems: 5 },
          zorluk: { type: "string" },
          soruTipi: { type: "string", description: "İstenen soru tipi etiketi" },
        },
        required: ["soruMetni", "secenekler"],
      },
    },
  },
  required: ["sorular"],
};

var inited = false;
var aiBusy = false;

/**
 * @typedef {{
 *   id: string,
 *   metin: string,
 *   zorluk: string,
 *   etiketler: string[],
 *   dersId?: string,
 *   konuId?: string,
 *   kazanimId?: string,
 *   soruTipi?: string,
 * }} TaramaSoru
 */

/** @type {TaramaSoru[]} */
var MOCK_SORULAR = [
  {
    id: "mock-1",
    metin: "Bir dik üçgende dik kenarlar 6 cm ve 8 cm ise hipotenüs kaç cm'dir?",
    zorluk: "Kolay",
    etiketler: ["TYT Geometri", "Pisagor", "Klasik"],
    dersId: "tyt-geometri",
    konuId: "ucgenler",
    kazanimId: "pisagor",
    soruTipi: "Klasik İşlem",
  },
  {
    id: "mock-2",
    metin: "Aşağıdaki öncüllerden hangileri her zaman doğrudur? I) ... II) ... III) ...",
    zorluk: "Orta",
    etiketler: ["TYT Matematik", "Öncüllü", "Mantık"],
    dersId: "tyt-matematik",
    konuId: "temel-kavramlar",
    kazanimId: "sayilar",
    soruTipi: "Öncüllü (I, II, III)",
  },
  {
    id: "mock-3",
    metin: "Paragrafın ana düşüncesi aşağıdakilerden hangisidir? (ÖSYM tarzı uzun metin)",
    zorluk: "Orta",
    etiketler: ["TYT Türkçe", "Paragraf", "Yeni Nesil"],
    dersId: "tyt-turkce",
    konuId: "paragraf",
    kazanimId: "ana-dusunce",
    soruTipi: "Paragrafta Anlam",
  },
  {
    id: "mock-4",
    metin: "Şekilde verilen kare prizmanın hacmi kaç br³'tür?",
    zorluk: "Zor",
    etiketler: ["TYT Geometri", "Katı Cisim", "Şekilli"],
    dersId: "tyt-geometri",
    konuId: "ucgenler",
    kazanimId: "aci-kenar",
    soruTipi: "Alan–Çevre–Hacim",
  },
  {
    id: "mock-5",
    metin: "f(x) = x² − 4x + 3 fonksiyonunun yerel minimum noktasının apsisi kaçtır?",
    zorluk: "Zor",
    etiketler: ["AYT Matematik", "Türev", "Grafik"],
    dersId: "ayt-matematik",
    konuId: "turev-uygulama",
    kazanimId: "ekstremum",
    soruTipi: "Limit–Türev–İntegral Grafik",
  },
  {
    id: "mock-6",
    metin: "Divan şiirinde aruz ölçüsü ile ilgili aşağıdakilerden hangisi yanlıştır?",
    zorluk: "Orta",
    etiketler: ["AYT Edebiyat", "Nazım biçimleri", "Klasik"],
    dersId: "ayt-edebiyat",
    konuId: "divan",
    kazanimId: "nazim-bicimleri",
    soruTipi: "Şiir Bilgisi",
  },
];

/** @type {string[]} */
var sepetIds = [];

function el(id) {
  return document.getElementById(id);
}

function genId(prefix) {
  return (prefix || "ai") + "-" + Date.now() + "-" + Math.random().toString(36).slice(2, 10);
}

function stripJsonCodeFences(raw) {
  var s = String(raw || "").trim();
  s = s.replace(/^```(?:json)?\s*/i, "");
  s = s.replace(/\s*```\s*$/i, "");
  s = s.trim();
  var fi = s.indexOf("```");
  if (fi !== -1) {
    var chunk = s.slice(fi).replace(/^```(?:json)?\s*/i, "");
    var end = chunk.lastIndexOf("```");
    if (end !== -1) chunk = chunk.slice(0, end).trim();
    s = (chunk || s).trim();
  }
  return s.trim();
}

/**
 * Model metninden JSON nesnesi — ```json çitleri ve fazla metin toleransı.
 * @returns {object}
 */
function parseModelJsonText(text) {
  var cleaned = stripJsonCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    var start = cleaned.indexOf("{");
    var end = cleaned.lastIndexOf("}");
    if (start !== -1 && end > start) {
      var slice = cleaned.slice(start, end + 1);
      try {
        return JSON.parse(slice);
      } catch (_e2) {
        /* fall */
      }
    }
    throw new Error("Model çıktısı geçerli JSON değil (markdown veya ek metin olabilir).");
  }
}

/** Yükleme overlay’ini ve bayrağı her durumda kapatır; iç hata yüzünden takılı kalmayı önler. */
function forceHideAiOverlay() {
  try {
    aiBusy = false;
    var ov = el("tuAiOverlay");
    if (ov) {
      ov.hidden = true;
      ov.setAttribute("aria-hidden", "true");
    }
    document.querySelectorAll(".tu-ai-similar, #tuAiFillBtn, #tuPdfBtn").forEach(function (b) {
      if (b) b.disabled = false;
    });
  } catch (e) {
    console.error("[tarama-uretici] forceHideAiOverlay", e);
  }
}

function setAiBusy(on) {
  try {
    aiBusy = !!on;
    var ov = el("tuAiOverlay");
    if (ov) {
      ov.hidden = !on;
      ov.setAttribute("aria-hidden", on ? "false" : "true");
    }
    document.querySelectorAll(".tu-ai-similar, #tuAiFillBtn, #tuPdfBtn").forEach(function (b) {
      if (b) b.disabled = !!on;
    });
  } catch (e) {
    console.error("[tarama-uretici] setAiBusy", e);
    forceHideAiOverlay();
  }
}

function setAiStatus(msg, isErr) {
  var p = el("tuAiStatus");
  if (!p) return;
  p.textContent = msg || "";
  p.classList.toggle("text-rose-600", !!isErr);
  p.classList.toggle("text-slate-600", !isErr);
}

function geminiHttpErrorMessage(data, status) {
  if (!data || typeof data !== "object") return "HTTP " + status;
  if (typeof data.error === "string") return data.error;
  if (data.error && typeof data.error === "object") {
    return String(data.error.message || data.error.status || "").trim() || "HTTP " + status;
  }
  return "HTTP " + status;
}

/**
 * @param {object} payload — Gemini generateContent gövdesi
 * @returns {Promise<object>}
 */
async function fetchGeminiGenerateContent(payload) {
  var url = getGeminiProxyUrl();
  var res;
  var rawText = "";
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (netErr) {
    throw new Error(
      "Ağ: " + (netErr && netErr.message ? netErr.message : String(netErr))
    );
  }
  try {
    rawText = await res.text();
  } catch (_read) {
    throw new Error("Sunucu yanıtı okunamadı.");
  }
  var data;
  try {
    data = JSON.parse(rawText);
  } catch (_e) {
    throw new Error("Sunucu yanıtı JSON değil: " + String(rawText).slice(0, 180));
  }
  if (!res.ok) {
    var msg = geminiHttpErrorMessage(data, res.status);
    if (res.status === 500 && data && String(msg).indexOf("GEMINI_API_KEY") !== -1) {
      msg = "Sunucuda GEMINI_API_KEY tanımlı değil (Vercel ortam değişkeni veya vercel dev + .env).";
    }
    throw new Error(msg);
  }
  var parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  var text = parts && parts[0] && parts[0].text;
  if (text == null || String(text).trim() === "") {
    throw new Error("Model boş yanıt döndü.");
  }
  return parseModelJsonText(text);
}

function notifyAiError(err) {
  var msg = err && err.message ? String(err.message) : String(err || "Bilinmeyen hata");
  console.error("[tarama-uretici] AI hatası:", err);
  try {
    showToast("Yapay zeka sunucusuna ulaşılamadı: " + msg, { variant: "danger" });
  } catch (_t) {
    try {
      if (typeof window !== "undefined" && window.alert) window.alert("Yapay zeka sunucusuna ulaşılamadı:\n" + msg);
    } catch (_a) {}
  }
}

function getFilterContext() {
  var dersId = (el("tuDersSelect") && el("tuDersSelect").value) || "";
  var konuId = (el("tuKonuSelect") && el("tuKonuSelect").value) || "";
  var kazanimId = (el("tuKazanimSelect") && el("tuKazanimSelect").value) || "";
  var d = getTaksonomiDersById(dersId);
  var konu = konuId ? getTaksonomiKonuById(dersId, konuId) : null;
  var kaz = kazanimId && konu ? getTaksonomiKazanimById(dersId, konuId, kazanimId) : null;
  return {
    dersId: dersId,
    konuId: konuId,
    kazanimId: kazanimId,
    konuAd: konu ? konu.ad : "",
    kazanimAd: kaz ? kaz.ad : "",
    dersAd: d ? d.ad : "",
  };
}

function getCheckedSoruTipleri() {
  var host = el("tuSoruTipiList");
  if (!host) return [];
  var boxes = host.querySelectorAll('input[name="tuSoruTipi"]:checked');
  var out = [];
  boxes.forEach(function (c) {
    if (c.value) out.push(c.value);
  });
  return out;
}

function getEffectiveSoruTipleri(ctx) {
  var checked = getCheckedSoruTipleri();
  if (checked.length) return checked;
  var d = getTaksonomiDersById(ctx.dersId);
  return d ? d.soruTipleri.slice() : [];
}

/**
 * Sepetteki soruların soru tipi sayımı (metadata öncelikli).
 * @returns {Record<string, number>}
 */
function countCartBySoruTipi() {
  var counts = {};
  sepetIds.forEach(function (qid) {
    var q = MOCK_SORULAR.find(function (x) {
      return x.id === qid;
    });
    if (!q) return;
    var tip = q.soruTipi || (q.etiketler && q.etiketler[2]) || "Genel";
    counts[tip] = (counts[tip] || 0) + 1;
  });
  return counts;
}

/**
 * @param {number} need
 * @param {number} target
 * @param {string[]} tips
 * @param {Record<string, number>} cartCounts
 * @returns {string[]}
 */
function planSoruTipiFill(need, target, tips, cartCounts) {
  if (!tips.length || need <= 0) return [];
  var gaps = tips.map(function (tip) {
    var ideal = target / tips.length;
    return { tip: tip, gap: ideal - (cartCounts[tip] || 0) };
  });
  var plan = [];
  for (var n = 0; n < need; n++) {
    gaps.sort(function (a, b) {
      return b.gap - a.gap;
    });
    var g = gaps[0];
    plan.push(g.tip);
    g.gap -= 1;
  }
  return plan;
}

function fillDersSelect() {
  var sel = el("tuDersSelect");
  if (!sel) return;
  sel.innerHTML = '<option value="">— Ders seçin —</option>';
  YKS_TAKSONOMI_DERSLER.forEach(function (d) {
    var o = document.createElement("option");
    o.value = d.id;
    o.textContent = d.ad;
    sel.appendChild(o);
  });
}

function fillKonuKazanim(dersId) {
  var konuSel = el("tuKonuSelect");
  var kazSel = el("tuKazanimSelect");
  if (!konuSel || !kazSel) return;
  konuSel.innerHTML = '<option value="">— Konu seçin —</option>';
  kazSel.innerHTML = '<option value="">— Kazanım seçin —</option>';
  var d = getTaksonomiDersById(dersId);
  if (!d) return;
  d.konular.forEach(function (k) {
    var o = document.createElement("option");
    o.value = k.id;
    o.textContent = k.ad;
    konuSel.appendChild(o);
  });
}

function fillKazanimOnly(dersId, konuId) {
  var kazSel = el("tuKazanimSelect");
  if (!kazSel) return;
  kazSel.innerHTML = '<option value="">— Kazanım seçin —</option>';
  var d = getTaksonomiDersById(dersId);
  if (!d) return;
  var konu = d.konular.find(function (x) {
    return x.id === konuId;
  });
  if (!konu) return;
  konu.kazanilar.forEach(function (kz) {
    var o = document.createElement("option");
    o.value = kz.id;
    o.textContent = kz.ad;
    kazSel.appendChild(o);
  });
}

function renderSoruTipiCheckboxes(dersId) {
  var host = el("tuSoruTipiList");
  if (!host) return;
  host.innerHTML = "";
  var d = getTaksonomiDersById(dersId);
  if (!d || !d.soruTipleri.length) {
    host.innerHTML =
      '<p class="text-xs text-slate-500">Önce bir ders seçin; soru tipleri derse göre listelenir.</p>';
    return;
  }
  d.soruTipleri.forEach(function (tip, idx) {
    var cid = "tu-st-" + dersId + "-" + idx;
    var lab = document.createElement("label");
    lab.className =
      "flex cursor-pointer items-start gap-2 rounded-lg border border-slate-100 bg-white px-2 py-1.5 text-sm text-slate-700 transition hover:border-brand-200 hover:bg-brand-50/40";
    lab.innerHTML =
      '<input type="checkbox" id="' +
      cid +
      '" name="tuSoruTipi" value="' +
      escapeHtml(tip) +
      '" class="mt-0.5 h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500" />' +
      '<span class="leading-snug">' +
      escapeHtml(tip) +
      "</span>";
    host.appendChild(lab);
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * @param {object} raw — { soruMetni, secenekler, zorluk? }
 * @param {object} meta
 * @returns {TaramaSoru}
 */
function buildPoolQuestionFromAi(raw, meta) {
  var d = getTaksonomiDersById(meta.dersId);
  var etiketler = [
    d ? d.ad : "YKS",
    meta.konuAd || "Konu",
    meta.soruTipi || "AI",
  ];
  return {
    id: genId("ai"),
    metin: String(raw.soruMetni || "").trim(),
    zorluk: String(raw.zorluk || meta.zorluk || "Orta").trim(),
    etiketler: etiketler,
    dersId: meta.dersId,
    konuId: meta.konuId,
    kazanimId: meta.kazanimId,
    soruTipi: meta.soruTipi || "",
  };
}

function validateSecenekler(sec) {
  return Array.isArray(sec) && sec.length === 5 && sec.every(function (s) {
    return String(s || "").trim().length > 0;
  });
}

/**
 * @param {TaramaSoru} q
 */
async function runBenzerUret(q) {
  if (aiBusy) return;
  var ctx = getFilterContext();
  var dersId = ctx.dersId || q.dersId;
  if (!dersId) {
    setAiStatus("Benzer üretmek için soldan bir ders seçin veya sorunun ders bağlamı tanımlı olsın.", true);
    return;
  }
  var tips = getCheckedSoruTipleri();
  if (!tips.length && q.soruTipi) tips = [q.soruTipi];
  var konuAd = ctx.konuAd;
  var kazanimAd = ctx.kazanimAd;
  if (!konuAd && q.konuId) {
    var ko = getTaksonomiKonuById(dersId, q.konuId);
    if (ko) konuAd = ko.ad;
  }
  if (!kazanimAd && q.konuId && q.kazanimId) {
    var kz = getTaksonomiKazanimById(dersId, q.konuId, q.kazanimId);
    if (kz) kazanimAd = kz.ad;
  }
  var sys = buildTaramaGeminiSystemInstruction(dersId, tips, konuAd || undefined, kazanimAd || undefined);
  var userLines = [
    "REFERANS SORU (yalnızca zorluk ve ölçülen beceriyi koru; metni ve sayıları kopyalama):",
    '"""',
    String(q.metin),
    '"""',
    "Zorluk (korunacak): " + String(q.zorluk) + ".",
    "Görev: Bu soruyu referans alarak; aynı zorlukta, aynı kazanımı ölçen ama sayılar/kurgusu/metin tamamen farklı YENİ BİR çoktan seçmeli soru üret.",
    "Çıktı tek bir JSON nesnesi olsun: soruMetni, secenekler (tam 5 string, A–E), zorluk.",
  ];
  setAiBusy(true);
  setAiStatus("Benzer soru üretiliyor…", false);
  try {
    var body = {
      systemInstruction: { parts: [{ text: sys }] },
      contents: [{ role: "user", parts: [{ text: userLines.join("\n") }] }],
      generationConfig: {
        temperature: 0.65,
        topP: 0.95,
        maxOutputTokens: 4096,
        responseMimeType: "application/json",
        responseJsonSchema: TARAMA_ONE_JSON_SCHEMA,
      },
    };
    var parsed = await fetchGeminiGenerateContent(body);
    if (!validateSecenekler(parsed.secenekler)) throw new Error("Şıklar eksik veya hatalı.");
    var nq = buildPoolQuestionFromAi(parsed, {
      dersId: dersId,
      konuId: ctx.konuId || q.konuId,
      kazanimId: ctx.kazanimId || q.kazanimId,
      konuAd: konuAd || ctx.konuAd,
      soruTipi: q.soruTipi || tips[0] || "",
      zorluk: q.zorluk,
    });
    MOCK_SORULAR.unshift(nq);
    sepetIds.push(nq.id);
    renderHavuz();
    renderSepet();
    setAiStatus("Yeni soru havuza eklendi ve sepete kondu.", false);
  } catch (e) {
    notifyAiError(e);
    setAiStatus(String(e && e.message ? e.message : e), true);
  } finally {
    forceHideAiOverlay();
  }
}

/**
 * @param {string[]} planTips
 * @param {ReturnType<typeof getFilterContext>} ctx
 */
async function runEksikleriTamamla(planTips, ctx) {
  if (!planTips.length) return;
  var sys = buildTaramaGeminiSystemInstruction(
    ctx.dersId,
    getEffectiveSoruTipleri(ctx),
    ctx.konuAd || undefined,
    ctx.kazanimAd || undefined
  );
  var lines = [
    "Toplam " + planTips.length + " adet FARKLI soru üret.",
    "Her soru için aşağıdaki sıradaki soruTipi etiketine uy:",
  ];
  planTips.forEach(function (tip, i) {
    lines.push(String(i + 1) + ') soruTipi: "' + tip + '"');
  });
  lines.push(
    "Çıktı: { \"sorular\": [ ... ] } dizisi; her elemanda soruMetni, secenekler (5), zorluk (Kolay/Orta/Zor), soruTipi (yukarıdaki etiketle aynı)."
  );
  var body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: [{ role: "user", parts: [{ text: lines.join("\n") }] }],
    generationConfig: {
      temperature: 0.68,
      topP: 0.95,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseJsonSchema: TARAMA_BATCH_JSON_SCHEMA,
    },
  };
  var parsed = await fetchGeminiGenerateContent(body);
  if (!parsed.sorular || !Array.isArray(parsed.sorular)) throw new Error("sorular dizisi yok.");
  if (parsed.sorular.length !== planTips.length) {
    throw new Error("Beklenen " + planTips.length + " soru, gelen: " + parsed.sorular.length);
  }
  parsed.sorular.forEach(function (raw, i) {
    if (!validateSecenekler(raw.secenekler)) throw new Error("Soru " + (i + 1) + ": şıklar geçersiz.");
    var tip = raw.soruTipi || planTips[i];
    var nq = buildPoolQuestionFromAi(raw, {
      dersId: ctx.dersId,
      konuId: ctx.konuId,
      kazanimId: ctx.kazanimId,
      konuAd: ctx.konuAd,
      soruTipi: tip,
      zorluk: raw.zorluk,
    });
    MOCK_SORULAR.unshift(nq);
    sepetIds.push(nq.id);
  });
}

function renderHavuz() {
  var grid = el("tuHavuzGrid");
  if (!grid) return;
  grid.innerHTML = "";
  MOCK_SORULAR.forEach(function (q) {
    var card = document.createElement("article");
    card.className =
      "rounded-2xl border border-slate-200/90 bg-white p-4 shadow-sm shadow-slate-200/60 transition hover:border-brand-200 hover:shadow-md";
    card.setAttribute("data-qid", q.id);
    var tags = (q.etiketler || [])
      .map(function (t) {
        return (
          '<span class="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">' +
          escapeHtml(t) +
          "</span>"
        );
      })
      .join("");
    card.innerHTML =
      '<div class="flex items-start justify-between gap-2">' +
      '<p class="flex-1 text-sm font-medium leading-relaxed text-slate-900">' +
      escapeHtml(q.metin) +
      "</p>" +
      "</div>" +
      '<div class="mt-3 flex flex-wrap items-center gap-2">' +
      '<span class="text-xs font-semibold uppercase tracking-wide text-brand-600">' +
      escapeHtml(q.zorluk) +
      "</span>" +
      "</div>" +
      '<div class="mt-3 flex flex-wrap items-stretch justify-end gap-2">' +
      '<button type="button" class="tu-add-cart inline-flex flex-1 min-w-[120px] items-center justify-center gap-1.5 rounded-xl bg-brand-600 px-3 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-brand-700 sm:flex-none" data-qid="' +
      escapeHtml(q.id) +
      '">' +
      '<i class="fa-solid fa-plus" aria-hidden="true"></i> Sepete Ekle' +
      "</button>" +
      '<button type="button" class="tu-ai-similar inline-flex flex-1 min-w-[140px] items-center justify-center gap-1.5 rounded-xl border border-violet-200 bg-gradient-to-br from-violet-50 to-white px-3 py-2.5 text-xs font-bold text-violet-800 shadow-sm transition hover:border-violet-300 hover:from-violet-100 sm:flex-none" data-qid="' +
      escapeHtml(q.id) +
      '" title="Gemini ile benzer soru üret">' +
      '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i> Benzerini Üret (AI)' +
      "</button>" +
      "</div>" +
      '<div class="mt-2 flex flex-wrap gap-1.5">' +
      tags +
      "</div>";
    grid.appendChild(card);
  });

  grid.querySelectorAll(".tu-add-cart").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var qid = btn.getAttribute("data-qid");
      if (qid && sepetIds.indexOf(qid) === -1) {
        sepetIds.push(qid);
        renderSepet();
      }
    });
  });
  grid.querySelectorAll(".tu-ai-similar").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var qid = btn.getAttribute("data-qid");
      var q = MOCK_SORULAR.find(function (x) {
        return x.id === qid;
      });
      if (q) runBenzerUret(q);
    });
  });
}

function renderSepet() {
  var list = el("tuSepetList");
  var empty = el("tuSepetEmpty");
  var count = el("tuSepetCount");
  if (!list) return;
  list.innerHTML = "";
  if (empty) empty.hidden = sepetIds.length > 0;
  if (count) count.textContent = String(sepetIds.length);

  sepetIds.forEach(function (qid) {
    var q = MOCK_SORULAR.find(function (x) {
      return x.id === qid;
    });
    if (!q) return;
    var row = document.createElement("div");
    row.className =
      "group flex items-start gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-2 py-2 text-xs text-slate-800";
    row.innerHTML =
      '<p class="min-w-0 flex-1 leading-snug">' +
      escapeHtml(q.metin.slice(0, 72)) +
      (q.metin.length > 72 ? "…" : "") +
      "</p>" +
      '<button type="button" class="tu-rm-cart shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600" data-qid="' +
      escapeHtml(q.id) +
      '" title="Çıkar">' +
      '<i class="fa-solid fa-xmark" aria-hidden="true"></i>' +
      "</button>";
    list.appendChild(row);
  });

  list.querySelectorAll(".tu-rm-cart").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var qid = btn.getAttribute("data-qid");
      sepetIds = sepetIds.filter(function (x) {
        return x !== qid;
      });
      renderSepet();
    });
  });
}

function bindForm() {
  var ders = el("tuDersSelect");
  var konu = el("tuKonuSelect");
  if (ders) {
    ders.addEventListener("change", function () {
      var id = ders.value;
      fillKonuKazanim(id);
      renderSoruTipiCheckboxes(id);
    });
  }
  if (konu) {
    konu.addEventListener("change", function () {
      var dId = el("tuDersSelect") && el("tuDersSelect").value;
      if (dId) fillKazanimOnly(dId, konu.value);
    });
  }

  var pdfBtn = el("tuPdfBtn");
  if (pdfBtn) {
    pdfBtn.addEventListener("click", function () {
      if (aiBusy) return;
      var tpl = (el("tuSablonSelect") && el("tuSablonSelect").value) || "1";
      if (!sepetIds.length) {
        alert("Sepete en az bir soru ekleyin.");
        return;
      }
      console.log("[tarama-uretici] PDF stub — şablon:", tpl, "sorular:", sepetIds.slice());
      alert(
        "PDF oluşturma henüz bağlanmadı. Seçilen " +
          sepetIds.length +
          " soru ve şablon (" +
          (tpl === "2" ? "2 sütun" : "1 sütun") +
          ") konsola yazıldı."
      );
    });
  }

  var fillBtn = el("tuAiFillBtn");
  if (fillBtn) {
    fillBtn.addEventListener("click", async function () {
      if (aiBusy) return;
      var ctx = getFilterContext();
      if (!ctx.dersId) {
        setAiStatus("Önce soldan bir ders seçin.", true);
        return;
      }
      var targetEl = el("tuTaramaHedef");
      var target = parseInt(String((targetEl && targetEl.value) || "20"), 10);
      if (isNaN(target) || target < 1) target = 20;
      if (target > 60) target = 60;
      var need = target - sepetIds.length;
      if (need <= 0) {
        setAiStatus("Sepet zaten hedef sayıya ulaştı veya aştı. Hedefi artırın veya sepetten çıkarın.", true);
        return;
      }
      var tips = getEffectiveSoruTipleri(ctx);
      if (!tips.length) {
        setAiStatus("Soru tipi bulunamadı. Ders seçin veya soru tipi işaretleyin.", true);
        return;
      }
      var cartCounts = countCartBySoruTipi();
      var plan = planSoruTipiFill(need, target, tips, cartCounts);
      setAiBusy(true);
      setAiStatus(need + " soru için AI üretimi…", false);
      var chunk = 6;
      try {
        for (var i = 0; i < plan.length; i += chunk) {
          var slice = plan.slice(i, i + chunk);
          await runEksikleriTamamla(slice, ctx);
        }
        renderHavuz();
        renderSepet();
        setAiStatus(need + " soru üretildi, havuza ve sepete eklendi.", false);
      } catch (e) {
        notifyAiError(e);
        setAiStatus(String(e && e.message ? e.message : e), true);
      } finally {
        forceHideAiOverlay();
      }
    });
  }
}

export function initTaramaUreticiModule() {
  if (inited) return;
  var root = el("tarama-uretici-view");
  if (!root) return;
  inited = true;
  fillDersSelect();
  renderSoruTipiCheckboxes("");
  renderHavuz();
  renderSepet();
  bindForm();
  setAiStatus("", false);
}
