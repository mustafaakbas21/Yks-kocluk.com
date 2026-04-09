/**
 * Fasikül / Kitap Üretici — Gemini 1.5 Flash + pdfmake (Matbaa v3.1 Dinamik Prompt)
 * Müfredat: ./yks-mufredat.js
 *
 * Gemini: sunucu proxy POST /api/generate-fasikul (api/generate-fasikul.js).
 * API anahtarı yalnızca sunucuda (.env / Vercel → GEMINI_API_KEY); tarayıcıya gitmez.
 */

import { showToast } from "./dp-ui-feedback.js";
import { YKS2026_Mufredat } from "./yks-mufredat.js";

/** Aynı origin üzerinde Vercel serverless uç noktası. */
const FASIKUL_PROXY_PATH = "/api/generate-fasikul";

const MIN_QUESTIONS = 1;
const MAX_QUESTIONS = 40;

/** Model çıkış tavanı (Flash için tipik 8192; daha yüksek değer API hatası doğurabilir). */
const GEMINI_MAX_OUTPUT_TOKENS = 8192;
const DEFAULT_WATERMARK = "DerecePanel";

function getFasikulGenerateEndpoint() {
  if (typeof window === "undefined" || !window.location || !window.location.origin) {
    return FASIKUL_PROXY_PATH;
  }
  try {
    return new URL(FASIKUL_PROXY_PATH, window.location.origin).href;
  } catch (_e) {
    return FASIKUL_PROXY_PATH;
  }
}

/** Appwrite yerine mock öğrenci listesi */
const MOCK_STUDENTS = [
  { id: "stu_demo_1", name: "Ayşe Yılmaz" },
  { id: "stu_demo_2", name: "Mehmet Kaya" },
  { id: "stu_demo_3", name: "Zeynep Demir" },
  { id: "stu_demo_4", name: "Can Öztürk" },
  { id: "stu_demo_5", name: "Elif Şahin" },
];

const FASIKUL_RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    konuOzeti: { type: "string", description: "Konu özeti metni." },
    sorular: {
      type: "array",
      items: {
        type: "object",
        properties: {
          soruMetni: { type: "string" },
          secenekler: { type: "array", items: { type: "string" } },
        },
        required: ["soruMetni", "secenekler"],
      },
    },
  },
  required: ["konuOzeti", "sorular"],
};

const COVER_SVGS = {
  1: () =>
    svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><defs><linearGradient id="g1" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#7c3aed"/><stop offset="100%" style="stop-color:#312e81"/></linearGradient></defs><rect width="794" height="1123" fill="url(#g1)"/><text x="397" y="420" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="42" font-weight="700">YKS FASİKÜL</text></svg>`),
  2: () =>
    svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><defs><linearGradient id="g2" x1="0%" y1="100%" x2="100%" y2="0%"><stop offset="0%" style="stop-color:#10b981"/><stop offset="100%" style="stop-color:#115e59"/></linearGradient></defs><rect width="794" height="1123" fill="url(#g2)"/><text x="397" y="420" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="42" font-weight="700">YKS FASİKÜL</text></svg>`),
  3: () =>
    svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><defs><linearGradient id="g3" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:#f59e0b"/><stop offset="100%" style="stop-color:#be123c"/></linearGradient></defs><rect width="794" height="1123" fill="url(#g3)"/><text x="397" y="420" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="42" font-weight="700">YKS FASİKÜL</text></svg>`),
  4: () =>
    svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><rect width="794" height="1123" fill="#1e293b"/><rect x="48" y="48" width="698" height="1027" fill="none" stroke="#64748b" stroke-width="2"/><text x="397" y="480" text-anchor="middle" fill="#f8fafc" font-family="Arial,sans-serif" font-size="38" font-weight="700">YKS FASİKÜL</text></svg>`),
  5: () =>
    svgToDataUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="794" height="1123" viewBox="0 0 794 1123"><defs><linearGradient id="g5" x1="0%" y1="0%" x2="0%" y2="100%"><stop offset="0%" style="stop-color:#0ea5e9"/><stop offset="100%" style="stop-color:#1e3a8a"/></linearGradient></defs><rect width="794" height="1123" fill="url(#g5)"/><text x="397" y="430" text-anchor="middle" fill="white" font-family="Arial,sans-serif" font-size="42" font-weight="700">YKS FASİKÜL</text></svg>`),
};

function svgToDataUrl(svgMarkup) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgMarkup.replace(/\s+/g, " ").trim());
}

function clampInt(n, a, b) {
  var x = parseInt(String(n), 10);
  if (isNaN(x)) return a;
  return Math.max(a, Math.min(b, x));
}

function normalizeTopicNarration(raw) {
  var v = String(raw || "medium").trim().toLowerCase();
  if (v === "low" || v === "high") return v;
  return "medium";
}

function topicNarrationLabel(tn) {
  switch (normalizeTopicNarration(tn)) {
    case "low":
      return "Özet geç (Az)";
    case "high":
      return "Detaylı anlatım (Çok)";
    default:
      return "Standart (Orta)";
  }
}

/** System + user prompt için konu yoğunluğu kuralları (V3.1) */
function getTopicNarrationInstruction(tn) {
  switch (normalizeTopicNarration(tn)) {
    case "low":
      return {
        system:
          "Konu özetini çok kısa tut; sadece hap bilgiler, kritik uyarılar ve formülleri madde madde ver.",
        user:
          "Konu özeti (konuOzeti): Az yoğunluk — yalnız kritik formüller, kısa tanımlar ve madde işaretli hap bilgi.",
      };
    case "high":
      return {
        system:
          "Konuyu hiç bilmeyen birine anlatır gibi sıfırdan, çok detaylı, mantığını açıklayarak, alt başlıklarla ve bol günlük hayat örnekleriyle uzun bir metin olarak yaz.",
        user:
          "Konu özeti (konuOzeti): Çok yoğunluk — sıfırdan anlatım, püf noktaları, mantık zinciri, alt başlıklar ve bol örnek; metin uzun olabilir.",
      };
    default:
      return {
        system:
          "Konuyu lise düzeyinde, anlaşılır bir dille, temel kuralları ve birkaç örneği içerecek şekilde standart uzunlukta anlat.",
        user:
          "Konu özeti (konuOzeti): Orta yoğunluk — standart anlatım, temel kurallar ve 1–2 örnek.",
      };
  }
}

function examTypeToLabel(v) {
  switch (v) {
    case "TYT":
      return "TYT";
    case "AYT":
      return "AYT";
    case "YDT":
      return "YDT (İngilizce)";
    case "TYT_AYT":
      return "TYT + AYT";
    default:
      return String(v || "");
  }
}

function parseSubjectValue(raw) {
  var parts = String(raw || "").trim().split("|||");
  return { examLayer: (parts[0] || "").trim(), dersKey: (parts[1] || "").trim() };
}

function sortedKeys(obj) {
  return Object.keys(obj || {}).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
}

function getSubjectOptionsForExamType(examType) {
  var out = [];
  if (examType === "TYT") {
    sortedKeys(YKS2026_Mufredat.TYT).forEach(function (dk) {
      out.push({ value: "TYT|||" + dk, label: dk });
    });
  } else if (examType === "AYT") {
    sortedKeys(YKS2026_Mufredat.AYT).forEach(function (dk) {
      out.push({ value: "AYT|||" + dk, label: dk });
    });
  } else if (examType === "YDT") {
    sortedKeys(YKS2026_Mufredat.YDT).forEach(function (dk) {
      out.push({ value: "YDT|||" + dk, label: dk });
    });
  } else if (examType === "TYT_AYT") {
    sortedKeys(YKS2026_Mufredat.TYT).forEach(function (dk) {
      out.push({ value: "TYT|||" + dk, label: "[TYT] " + dk });
    });
    sortedKeys(YKS2026_Mufredat.AYT).forEach(function (dk) {
      out.push({ value: "AYT|||" + dk, label: "[AYT] " + dk });
    });
  }
  return out;
}

function fillSubjectSelect(examType) {
  var sel = document.getElementById("fuSubject");
  if (!sel) return;
  sel.innerHTML = "";
  var opts = getSubjectOptionsForExamType(examType);
  if (!opts.length) {
    var o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = "Bu sınav için ders bulunamadı";
    o0.disabled = true;
    o0.selected = true;
    sel.appendChild(o0);
    fillTopicSelect("", "");
    return;
  }
  opts.forEach(function (o, i) {
    var opt = document.createElement("option");
    opt.value = o.value;
    opt.textContent = o.label;
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  });
  fillTopicSelect(parseSubjectValue(sel.value).examLayer, parseSubjectValue(sel.value).dersKey);
}

function fillTopicSelect(examLayer, dersKey) {
  var sel = document.getElementById("fuTopic");
  if (!sel) return;
  sel.innerHTML = "";
  var block = (YKS2026_Mufredat[examLayer] || {})[dersKey];
  var topics = Array.isArray(block) ? block.slice() : [];
  if (!topics.length) {
    var o0 = document.createElement("option");
    o0.value = "";
    o0.textContent = dersKey ? "Konu listesi yok" : "Önce ders seçin";
    o0.disabled = true;
    o0.selected = true;
    sel.appendChild(o0);
    return;
  }
  topics.sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
  topics.forEach(function (t, i) {
    var opt = document.createElement("option");
    opt.value = t;
    opt.textContent = t;
    if (i === 0) opt.selected = true;
    sel.appendChild(opt);
  });
}

function wireMufredatCascades() {
  var exam = document.getElementById("fuExamType");
  var sub = document.getElementById("fuSubject");
  if (!exam || !sub) return;
  exam.addEventListener("change", function () {
    fillSubjectSelect(exam.value);
  });
  sub.addEventListener("change", function () {
    var p = parseSubjectValue(sub.value);
    fillTopicSelect(p.examLayer, p.dersKey);
  });
  fillSubjectSelect(exam.value);
}

function fillMockStudents() {
  var sel = document.getElementById("fuStudentId");
  if (!sel) return;
  MOCK_STUDENTS.forEach(function (s) {
    var o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name;
    sel.appendChild(o);
  });
}

function wireSmartToggle() {
  var chk = document.getElementById("fuSmartMode");
  var wrap = document.getElementById("fuStudentWrap");
  if (!chk || !wrap) return;
  function sync() {
    var on = !!chk.checked;
    wrap.hidden = !on;
    wrap.classList.toggle("hidden", !on);
    var s = document.getElementById("fuStudentId");
    if (s) s.required = on;
  }
  chk.addEventListener("change", sync);
  sync();
}

function wireTabs() {
  var tabs = document.querySelectorAll("[data-fu-tab]");
  var panels = document.querySelectorAll("[data-fu-panel]");
  if (!tabs.length) return;
  tabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.getAttribute("data-fu-tab");
      tabs.forEach(function (b) {
        b.setAttribute("aria-selected", b === btn ? "true" : "false");
      });
      panels.forEach(function (p) {
        p.hidden = p.getAttribute("data-fu-panel") !== id;
      });
    });
  });
}

function buildGeminiSystemInstruction(form) {
  var n = clampInt(form.questionCount, MIN_QUESTIONS, MAX_QUESTIONS);
  var tn = getTopicNarrationInstruction(form.topicNarration);
  var konum =
    "Konumuz: [" + form.examTypeLabel + "] [" + form.subject + "] - [" + form.topic + "].";
  var langLine =
    form.examType === "YDT"
      ? "YDT (İngilizce): soru kökleri, şıklar ve konu özeti İngilizce olmalı."
      : "Soru ve özet metni Türkçe olmalı (YDT hariç).";
  var lines = [
    "Sen uzman bir eğitim materyali yazarısın.",
    konum,
    "Bana yanıtı SADECE aşağıdaki JSON şemasında ver.",
    "Başka hiçbir açıklama, giriş cümlesi veya markdown metni (``` dahil) kullanma.",
    "Kritik kural: Yanıtın yalnızca geçerli tek bir JSON nesnesi olmalıdır.",
    "Soru kökleri net ve ölçülebilir olsun; her soruda tam 5 şık ver; şıklar A) B) C) D) E) ile başlasın.",
    "Konu özeti müfredattaki bu ders ve konuya sıkı bağlı olsun.",
    "Konu anlatım yoğunluğu: " + tn.system,
    langLine,
  ];
  if (form.smartMode && form.studentName) {
    lines.push(
      "Bu materyal '" + form.studentName + "' adlı öğrenciye özel üretilmektedir; örnek ve vurgular bu öğrencinin seviyesine uygun olsun."
    );
  }
  if (form.questionStyle === "newgen") {
    lines.push(
      "Soruları yeni nesil ÖSYM tarzında yaz: en az 2–3 paragraftan oluşan bağlam, günlük hayat hikâyesi veya senaryo, şekilsel algı veya I–II–III öncüllü mantık muhakemesi gerektiren çok adımlı sorular tercih et."
    );
  }
  lines.push(
    'KATI KURAL: "sorular" DİZİSİNİN İÇİNE TAM OLARAK ' +
      n +
      " ADET SORU OBJESİ EKLEMELİSİN. NE EKSİK NE FAZLA."
  );
  return lines.join(" ");
}

function buildGeminiUserPrompt(form) {
  var n = clampInt(form.questionCount, MIN_QUESTIONS, MAX_QUESTIONS);
  var tn = getTopicNarrationInstruction(form.topicNarration);
  var lines = [
    "Aşağıdaki parametrelere göre fasikül üret.",
    "",
    "Seçilen sınav (form): " + form.examTypeLabel + " (müfredat katmanı: " + form.examLayer + ").",
    "Seçilen ders: " + form.subject + ".",
    "Seçilen konu: " + form.topic + ".",
    "İstenen soru sayısı: tam olarak " + n + " adet.",
    "Zorluk: " + form.difficulty + ".",
    "Konu anlatım yoğunluğu (seçim): " + topicNarrationLabel(form.topicNarration) + ".",
    tn.user,
    "Soru tarzı: " + (form.questionStyle === "newgen" ? "Yeni nesil (ÖSYM tipi)" : "Klasik") + ".",
  ];
  if (form.smartMode && form.studentName) {
    lines.push("Öğrenci: " + form.studentName + ".");
  }
  if (form.questionStyle === "newgen") {
    lines.push(
      "",
      "Yeni nesil kuralı: Soruları ÖSYM'nin güncel tarzına uygun yaz. Uzun metinli kökler, günlük hayattan örnekler, I-II-III öncüllü veya şekil/şema yorumu gerektiren nitelikte sorular üret. Şıklar yine A–E ve klasik çoktan seçmeli biçimde kalsın."
    );
  }
  lines.push(
    "",
    "JSON: kök alanlar \"konuOzeti\" ve \"sorular\"; her soruda \"soruMetni\" ve 5 \"secenekler\".",
    "sorular uzunluğu tam " + n + " olmalı.",
    "",
    'KATI KURAL: "sorular" DİZİSİNİN İÇİNE TAM OLARAK ' + n + " ADET SORU OBJESİ EKLEMELİSİN. NE EKSİK NE FAZLA."
  );
  return lines.join("\n");
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

function parseFasikulModelJson(text) {
  var cleaned = stripJsonCodeFences(text);
  try {
    return JSON.parse(cleaned);
  } catch (_e) {
    var a = cleaned.indexOf("{");
    var b = cleaned.lastIndexOf("}");
    if (a !== -1 && b > a) {
      try {
        return JSON.parse(cleaned.slice(a, b + 1));
      } catch (_e2) {
        /* fall */
      }
    }
    throw new Error("Model çıktısı geçerli JSON değil (```json veya ek metin olabilir).");
  }
}

async function fetchGeminiFasikulJson(form) {
  var n = clampInt(form.questionCount, MIN_QUESTIONS, MAX_QUESTIONS);
  var url = getFasikulGenerateEndpoint();
  var body = {
    systemInstruction: { parts: [{ text: buildGeminiSystemInstruction(form) }] },
    contents: [{ role: "user", parts: [{ text: buildGeminiUserPrompt(form) }] }],
    generationConfig: {
      temperature:
        form.questionStyle === "newgen"
          ? normalizeTopicNarration(form.topicNarration) === "high"
            ? 0.74
            : 0.72
          : normalizeTopicNarration(form.topicNarration) === "high"
            ? 0.68
            : 0.65,
      topP: 0.95,
      maxOutputTokens: GEMINI_MAX_OUTPUT_TOKENS,
      responseMimeType: "application/json",
      responseJsonSchema: FASIKUL_RESPONSE_JSON_SCHEMA,
    },
  };
  var res;
  var rawText = "";
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch (netErr) {
    throw new Error(
      "Sunucuya bağlanılamadı. Sayfayı Vercel / `vercel dev` üzerinden açtığınızdan emin olun. " +
        (netErr && netErr.message ? netErr.message : String(netErr))
    );
  }
  try {
    rawText = await res.text();
  } catch (readErr) {
    throw new Error("Yanıt gövdesi okunamadı: " + (readErr && readErr.message ? readErr.message : String(readErr)));
  }
  var data;
  try {
    data = JSON.parse(rawText);
  } catch (_parseErr) {
    throw new Error("Sunucu yanıtı geçerli JSON değil: " + String(rawText || "").slice(0, 240));
  }
  if (!res.ok) {
    var msg =
      (data.error && (data.error.message || data.error.status)) ||
      (typeof data.error === "string" && data.error) ||
      "HTTP " + res.status;
    if (res.status === 404) {
      throw new Error(
        "Fasikül API bulunamadı (404). Projeyi `vercel dev` veya barındırıcıda `/api/generate-fasikul` ile çalıştırın."
      );
    }
    if (res.status === 500 && typeof data.error === "string" && data.error.indexOf("GEMINI_API_KEY") !== -1) {
      throw new Error(
        "Sunucuda GEMINI_API_KEY tanımlı değil. Vercel ortam değişkenlerine veya `.env` dosyasına anahtarı ekleyin."
      );
    }
    throw new Error("Fasikül üretimi başarısız: " + msg);
  }
  if (!data || typeof data !== "object") {
    throw new Error("Sunucu yanıtı beklenen biçimde değil.");
  }
  var parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
  var text = parts && parts[0] && parts[0].text;
  if (!text) throw new Error("Model boş veya beklenmeyen yapıda yanıt döndü.");
  var parsed = parseFasikulModelJson(text);
  if (!parsed.konuOzeti || !Array.isArray(parsed.sorular)) {
    throw new Error("JSON şeması eksik.");
  }
  if (parsed.sorular.length !== n) {
    throw new Error("Beklenen soru sayısı " + n + ", gelen: " + parsed.sorular.length + ".");
  }
  parsed.sorular.forEach(function (q, i) {
    if (!q || !q.soruMetni || !Array.isArray(q.secenekler) || q.secenekler.length !== 5) {
      throw new Error("Soru " + (i + 1) + " geçersiz.");
    }
  });
  return parsed;
}

function normalizeQuestionsForPdf(sorular) {
  return sorular.map(function (q, i) {
    return {
      no: i + 1,
      stem: String(q.soruMetni || "").trim(),
      options: q.secenekler.map(function (o) {
        return String(o || "").trim();
      }),
    };
  });
}

function splitHalf(arr) {
  var mid = Math.ceil(arr.length / 2);
  return [arr.slice(0, mid), arr.slice(mid)];
}

function questionBlockPdf(q) {
  return {
    stack: [
      { text: q.no + ". " + q.stem, style: "qStem", margin: [0, 0, 0, 4] },
    ].concat(
      q.options.map(function (o) {
        return { text: o, style: "qOpt", margin: [6, 0, 0, 2] };
      })
    ),
    margin: [0, 0, 0, 10],
  };
}

function optikCircleCell() {
  return {
    stack: [
      {
        canvas: [{ type: "ellipse", x: 14, y: 2, r1: 6, r2: 6, lineWidth: 1, lineColor: "#334155" }],
        margin: [0, 2, 0, 2],
      },
    ],
    alignment: "center",
  };
}

function buildOptikPage(n) {
  var header = [
    { text: "Soru", style: "optikH", alignment: "center" },
    { text: "A", style: "optikH", alignment: "center" },
    { text: "B", style: "optikH", alignment: "center" },
    { text: "C", style: "optikH", alignment: "center" },
    { text: "D", style: "optikH", alignment: "center" },
    { text: "E", style: "optikH", alignment: "center" },
  ];
  var body = [header];
  for (var i = 1; i <= n; i++) {
    body.push([
      { text: String(i), bold: true, alignment: "center", margin: [0, 6, 0, 6] },
      optikCircleCell(),
      optikCircleCell(),
      optikCircleCell(),
      optikCircleCell(),
      optikCircleCell(),
    ]);
  }
  return {
    stack: [
      { text: "Optik işaretleme formu", style: "h2", margin: [0, 0, 0, 8] },
      {
        text: "Soruları yanıtladıktan sonra ilgili daireleri koyu kurşun kalemle işaretleyiniz.",
        fontSize: 8,
        color: "#64748b",
        margin: [0, 0, 0, 12],
      },
      {
        table: {
          widths: [28, "*", "*", "*", "*", "*"],
          headerRows: 1,
          body: body,
        },
        layout: {
          fillColor: function (i) {
            return i === 0 ? "#f1f5f9" : i % 2 === 0 ? "#fafafa" : null;
          },
          hLineWidth: function () {
            return 0.5;
          },
          vLineWidth: function () {
            return 0.5;
          },
          hLineColor: "#e2e8f0",
          vLineColor: "#e2e8f0",
        },
      },
    ],
    pageBreak: "before",
  };
}

function konuParagraphs(text) {
  var s = String(text || "").replace(/\r\n/g, "\n");
  var blocks = [];
  var i;
  var rawLines = s.split("\n");
  for (i = 0; i < rawLines.length; i++) {
    var line = rawLines[i].trim();
    if (line) blocks.push(line);
  }
  if (!blocks.length && s.trim()) {
    blocks = [s.trim()];
  }
  if (!blocks.length) {
    return [{ text: "—", style: "bodyText", italics: true, color: "#94a3b8", margin: [0, 0, 0, 8] }];
  }
  return blocks.map(function (p) {
    return {
      text: p,
      style: "bodyText",
      alignment: "justify",
      margin: [0, 0, 0, 7],
    };
  });
}

function getPdfMake() {
  var p = typeof window !== "undefined" ? window.pdfMake : null;
  if (!p || typeof p.createPdf !== "function") {
    throw new Error("pdfmake yüklenemedi. Sayfayı yenileyin.");
  }
  return p;
}

function buildPdfMakeDoc(form, topicText, questions, coverDataUrl) {
  var wm = String(form.watermarkText || "").trim() || DEFAULT_WATERMARK;
  var footerLine = String(form.footerText || "").trim() || "YKS Koçluk · DerecePanel";

  var halves = splitHalf(questions);
  var leftStack = halves[0].map(questionBlockPdf);
  var rightStack = halves[1].map(questionBlockPdf);

  var dd = {
    pageSize: "A4",
    pageMargins: [40, 55, 40, 72],
    watermark: {
      text: wm,
      color: "#64748b",
      opacity: 0.1,
      bold: true,
      angle: -55,
      fontSize: 52,
    },
    footer: function (currentPage, pageCount) {
      return {
        margin: [40, 4, 40, 0],
        columns: [
          { text: footerLine, fontSize: 8, color: "#64748b", width: "*" },
          { text: currentPage + " / " + pageCount, fontSize: 8, color: "#64748b", width: 56, alignment: "right" },
        ],
      };
    },
    content: [
      {
        image: coverDataUrl,
        width: 515,
        alignment: "center",
        pageBreak: "after",
      },
      {
        text: form.subject + " — " + form.topic,
        style: "title",
        margin: [0, 0, 0, 6],
      },
      {
        text:
          form.examTypeLabel +
          " · " +
          form.difficulty +
          " · " +
          topicNarrationLabel(form.topicNarration) +
          " · " +
          questions.length +
          " soru · Gemini",
        style: "meta",
        margin: [0, 0, 0, 16],
      },
      { text: "Konu özeti", style: "h2", margin: [0, 0, 0, 8] },
    ]
      .concat(konuParagraphs(topicText))
      .concat([
        { text: "Sorular", style: "h2", margin: [0, 16, 0, 10] },
        {
          columns: [
            { width: "*", stack: leftStack },
            { width: 24, text: "" },
            { width: "*", stack: rightStack },
          ],
        },
        buildOptikPage(questions.length),
      ]),
    styles: {
      title: { fontSize: 18, bold: true, color: "#4c1d95" },
      meta: { fontSize: 9, color: "#64748b" },
      h2: { fontSize: 12, bold: true, color: "#334155" },
      bodyText: { fontSize: 10, lineHeight: 1.45 },
      qStem: { fontSize: 10, bold: true },
      qOpt: { fontSize: 9 },
      optikH: { bold: true, fontSize: 9, fillColor: "#e2e8f0" },
    },
    defaultStyle: { font: "Roboto" },
  };
  return dd;
}

function getFormPayload() {
  var form = document.getElementById("fuForm");
  if (!form) return null;
  var fd = new FormData(form);
  var examType = String(fd.get("examType") || "TYT").trim();
  var parsed = parseSubjectValue(String(fd.get("subject") || "").trim());
  var topic = String(fd.get("topic") || "").trim();
  var smart = fd.get("smartMode") === "on";
  var sid = String(fd.get("studentId") || "").trim();
  var stSel = document.getElementById("fuStudentId");
  var stName = "";
  if (stSel && sid) {
    var opt = stSel.options[stSel.selectedIndex];
    stName = opt && opt.textContent ? opt.textContent.trim() : "";
  }
  var qRaw = fd.get("questionCount");
  var qNum = parseInt(String(qRaw != null ? qRaw : "10"), 10);
  if (isNaN(qNum)) qNum = 10;
  return {
    examType: examType,
    examTypeLabel: examTypeToLabel(examType),
    examLayer: parsed.examLayer,
    subject: parsed.dersKey,
    topic: topic,
    questionCount: clampInt(qNum, MIN_QUESTIONS, MAX_QUESTIONS),
    topicNarration: normalizeTopicNarration(String(fd.get("topicNarration") || "medium")),
    difficulty: fd.get("difficulty") || "Orta",
    coverId: String(fd.get("coverId") || "1"),
    smartMode: smart,
    studentId: sid,
    studentName: stName,
    questionStyle: String(fd.get("questionStyle") || "classic").trim() === "newgen" ? "newgen" : "classic",
    footerText: String(fd.get("footerText") != null ? fd.get("footerText") : "").trim(),
    watermarkText: String(fd.get("watermarkText") != null ? fd.get("watermarkText") : "").trim(),
  };
}

async function generatePDF() {
  var form = getFormPayload();
  if (!form) throw new Error("Form bulunamadı.");
  if (!form.subject || !form.topic) throw new Error("Lütfen müfredattan ders ve konu seçin.");
  if (form.smartMode && !form.studentId) {
    throw new Error("Akıllı üretim açıkken öğrenci seçin.");
  }
  var allowedTopics = (YKS2026_Mufredat[form.examLayer] || {})[form.subject];
  if (!Array.isArray(allowedTopics) || allowedTopics.indexOf(form.topic) === -1) {
    throw new Error("Seçilen konu müfredat ile eşleşmiyor.");
  }

  var ai = await fetchGeminiFasikulJson(form);
  var topicText = String(ai.konuOzeti || "").trim();
  var questions = normalizeQuestionsForPdf(ai.sorular);

  var coverFn = COVER_SVGS[form.coverId] || COVER_SVGS["1"];
  var coverDataUrl = coverFn();
  var dd = buildPdfMakeDoc(form, topicText, questions, coverDataUrl);
  var pdfMake = getPdfMake();
  var fname =
    "fasikul-" +
    form.subject.toLowerCase().replace(/\s+/g, "-").slice(0, 40) +
    "-" +
    new Date().toISOString().slice(0, 10) +
    ".pdf";

  return new Promise(function (resolve, reject) {
    try {
      pdfMake.createPdf(dd).download(fname);
      resolve();
    } catch (e) {
      reject(e);
    }
  });
}

function wireForm() {
  var form = document.getElementById("fuForm");
  var btn = document.getElementById("fuSubmitBtn");
  var status = document.getElementById("fuStatus");
  if (!form || !btn) return;

  var btnSpan = btn.querySelector("span");
  var fuSubmitBtnDefaultHtml = btnSpan ? btnSpan.innerHTML : btn.innerHTML;

  fillMockStudents();
  wireSmartToggle();
  wireTabs();
  wireMufredatCascades();

  var qcInp = document.getElementById("fuQuestionCount");
  if (qcInp) {
    function syncQc() {
      qcInp.value = String(clampInt(qcInp.value, MIN_QUESTIONS, MAX_QUESTIONS));
    }
    qcInp.addEventListener("change", syncQc);
    qcInp.addEventListener("blur", syncQc);
  }

  var fuStatusClassIdle = "mt-3 hidden text-center text-sm font-medium text-brand-700";

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var payload = getFormPayload();

    btn.disabled = true;
    btn.setAttribute("aria-busy", "true");
    if (btnSpan) {
      btnSpan.innerHTML =
        '<span class="inline-flex items-center justify-center gap-2"><span aria-hidden="true">⏳</span> Fasikül üretiliyor, lütfen bekleyin…</span>';
    } else {
      btn.textContent = "⏳ Fasikül üretiliyor, lütfen bekleyin…";
    }
    if (status) {
      status.hidden = false;
      status.className = "mt-3 text-center text-sm font-medium text-slate-600";
      status.textContent = "⏳ Fasikül üretiliyor, lütfen bekleyin…";
    }

    generatePDF()
      .then(function () {
        if (status) {
          status.className = "mt-3 text-center text-sm font-medium text-emerald-700";
          status.textContent = "PDF hazır ve indirildi.";
          setTimeout(function () {
            status.className = fuStatusClassIdle;
            status.hidden = true;
          }, 2800);
        }
      })
      .catch(function (err) {
        console.error(err);
        var raw = err && err.message ? String(err.message) : "PDF oluşturulamadı.";
        try {
          showToast("Yapay zeka sunucusuna ulaşılamadı: " + (raw.length > 200 ? raw.slice(0, 200) + "…" : raw), {
            variant: "danger",
          });
        } catch (_t) {}
        if (status) {
          status.hidden = false;
          status.className =
            "mt-3 text-center text-sm font-medium rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-800 leading-relaxed";
          status.textContent =
            "Üzgünüz, fasikül üretilemedi. " +
            (raw.length > 280 ? raw.slice(0, 280) + "…" : raw);
        }
      })
      .finally(function () {
        btn.disabled = false;
        btn.removeAttribute("aria-busy");
        if (btnSpan) {
          btnSpan.innerHTML = fuSubmitBtnDefaultHtml;
        } else {
          btn.innerHTML = fuSubmitBtnDefaultHtml;
        }
      });
  });
}

var fasikulUreticiModuleInited = false;

export function initFasikulUreticiModule() {
  if (fasikulUreticiModuleInited) return;
  if (!document.getElementById("fuForm")) return;
  fasikulUreticiModuleInited = true;
  wireForm();
}

if (typeof window !== "undefined") {
  window.generatePDF = generatePDF;
  window.initFasikulUreticiModule = initFasikulUreticiModule;
}
