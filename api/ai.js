/**
 * Gemini proxy — POST /api/ai
 * GEMINI_API_KEY yalnızca sunucuda (Vercel Environment / .env + vercel dev).
 * Google yanıtı (başarı/hata) aynı HTTP durumu ve gövde ile iletilir.
 */
const model = "gemini-1.5-flash";

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.GEMINI_API_KEY;
  if (!key || !String(key).trim()) {
    console.error("[api/ai] GEMINI_API_KEY tanımlı değil");
    return res.status(500).json({ error: "Sunucu yapılandırması eksik (GEMINI_API_KEY)." });
  }

  var payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (_e) {
      return res.status(400).json({ error: "Geçersiz JSON gövdesi" });
    }
  }
  if (!payload || typeof payload !== "object") {
    return res.status(400).json({ error: "Gövde gerekli" });
  }

  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" +
    encodeURIComponent(model) +
    ":generateContent?key=" +
    encodeURIComponent(String(key).trim());

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const text = await response.text();
    let jsonBody;
    try {
      jsonBody = text ? JSON.parse(text) : {};
    } catch (_parse) {
      jsonBody = {
        _proxyNote: "Google gövdesi JSON parse edilemedi; ham metin kısaltıldı.",
        _httpStatusFromGoogle: response.status,
        _rawSnippet: String(text).slice(0, 4000),
      };
    }
    return res.status(response.status).json(jsonBody);
  } catch (err) {
    console.error("[api/ai] fetch", err);
    return res.status(502).json({
      proxyError: true,
      message: err && err.message ? String(err.message) : String(err),
    });
  }
};
