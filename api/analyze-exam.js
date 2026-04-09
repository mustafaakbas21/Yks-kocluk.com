/**
 * Deneme kitapçığı metni → Gemini ile soru–konu matrisi (JSON).
 * Anahtar yalnızca sunucuda: GEMINI_API_KEY (.env / Vercel Environment Variables).
 *
 * POST /api/analyze-exam
 * Body: { pdfText: string, examType?: string, questionCountHint?: number }
 * Response: { ok: true, items: [{ questionNo, subject, topic, answer }] }
 */
const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/models";

var SYSTEM_INSTRUCTION =
  "Sen bir YKS (Türkiye Yükseköğretim Kurumları Sınavı) uzmanısın. Sana gönderilen metin bir deneme sınavının içeriğidir. " +
  "Soru numaralarını takip et, her sorunun dersini ve konusunu belirle. " +
  "Her soru için doğru cevap şıkkı yalnızca A, B, C, D veya E olabilir (metinde yoksa en olası şıkkı tahmin etme; yine de tek harf ver). " +
  'Çıktıyı SADECE şu yapıda bir JSON dizisi olarak ver: [{"questionNo": 1, "subject": "TYT Matematik", "topic": "Fonksiyonlar", "answer": "A"}, ...]. ' +
  "subject alanında standart ders adları kullan (örn. TYT Matematik, TYT Türkçe, AYT Fizik, YDT). " +
  "Asla açıklama, markdown kod çiti veya metin ekleme; yalnızca geçerli JSON dizi döndür.";

var MAX_TEXT_CHARS = 120000;

function parseItemsFromGeminiBody(data) {
  try {
    var cands = data && data.candidates;
    if (!cands || !cands.length) return null;
    var parts = cands[0].content && cands[0].content.parts;
    if (!parts || !parts[0]) return null;
    var t = parts[0].text;
    if (t == null || String(t).trim() === "") return null;
    var trimmed = String(t).trim();
    if (trimmed.indexOf("```") === 0) {
      trimmed = trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "");
    }
    var parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    if (parsed && Array.isArray(parsed.items)) return parsed.items;
    if (parsed && Array.isArray(parsed.rows)) return parsed.rows;
  } catch (_e) {
    return null;
  }
  return null;
}

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var x = raw[i];
    if (!x || typeof x !== "object") continue;
    var q = parseInt(String(x.questionNo != null ? x.questionNo : x.q), 10);
    if (isNaN(q) || q < 1) continue;
    var subject = String(x.subject != null ? x.subject : x.ders || "").trim();
    var topic = String(x.topic != null ? x.topic : x.konu || "").trim();
    var ans = String(x.answer != null ? x.answer : x.correct || "A")
      .trim()
      .toUpperCase()
      .charAt(0);
    if ("ABCDE".indexOf(ans) === -1) ans = "A";
    if (!subject && !topic) continue;
    out.push({
      questionNo: q,
      subject: subject || "TYT Türkçe",
      topic: topic || "Genel",
      answer: ans,
    });
  }
  out.sort(function (a, b) {
    return a.questionNo - b.questionNo;
  });
  return out;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  var key = process.env.GEMINI_API_KEY;
  if (!key || !String(key).trim()) {
    console.error("[analyze-exam] GEMINI_API_KEY tanımlı değil");
    return res.status(500).json({
      ok: false,
      error: "Sunucu yapılandırması eksik (GEMINI_API_KEY).",
    });
  }

  var body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_e) {
      return res.status(400).json({ ok: false, error: "Geçersiz JSON gövdesi" });
    }
  }
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Gövde gerekli" });
  }

  var pdfText = body.pdfText != null ? String(body.pdfText) : "";
  if (!pdfText.trim()) {
    return res.status(400).json({ ok: false, error: "pdfText gerekli" });
  }
  if (pdfText.length > MAX_TEXT_CHARS) {
    pdfText = pdfText.slice(0, MAX_TEXT_CHARS);
  }

  var examType = body.examType != null ? String(body.examType).trim() : "TYT";
  var hint = body.questionCountHint != null ? parseInt(String(body.questionCountHint), 10) : 0;
  var hintLine =
    !isNaN(hint) && hint > 0
      ? "Yaklaşık soru sayısı (ipucu): " + hint + ". Bu kadar soru için satır üretmeye çalış.\n\n"
      : "";

  var userText =
    "Sınav türü (ipucu): " +
    examType +
    "\n" +
    hintLine +
    "Aşağıdaki metin PDF'ten çıkarılmış deneme sınavı içeriğidir.\n\n---\n" +
    pdfText +
    "\n---";

  var model = (process.env.GEMINI_MODEL || "gemini-1.5-flash").trim();
  var url =
    UPSTREAM + "/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(String(key).trim());

  var payload = {
    systemInstruction: {
      parts: [{ text: SYSTEM_INSTRUCTION }],
    },
    contents: [
      {
        role: "user",
        parts: [{ text: userText }],
      },
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: 8192,
      responseMimeType: "application/json",
    },
  };

  try {
    var upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    var rawText = await upstream.text();
    var geminiJson = null;
    try {
      geminiJson = JSON.parse(rawText);
    } catch (_e) {
      geminiJson = null;
    }

    if (!upstream.ok) {
      var msg = "AI şu an yoğun, lütfen sonra tekrar deneyin veya manuel doldurun";
      var errObj = geminiJson && geminiJson.error;
      if (errObj && errObj.message) {
        console.warn("[analyze-exam] Gemini:", upstream.status, errObj.message);
      }
      if (upstream.status === 429 || upstream.status === 503) {
        return res.status(503).json({ ok: false, error: msg });
      }
      return res.status(502).json({ ok: false, error: msg });
    }

    var items = parseItemsFromGeminiBody(geminiJson);
    items = normalizeItems(items);
    if (!items.length) {
      console.warn("[analyze-exam] Boş veya çözülemeyen model çıktısı");
      return res.status(502).json({
        ok: false,
        error: "AI şu an yoğun, lütfen sonra tekrar deneyin veya manuel doldurun",
      });
    }

    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(200).json({ ok: true, items: items });
  } catch (err) {
    console.error("[analyze-exam]", err);
    return res.status(502).json({
      ok: false,
      error: "AI şu an yoğun, lütfen sonra tekrar deneyin veya manuel doldurun",
    });
  }
};
