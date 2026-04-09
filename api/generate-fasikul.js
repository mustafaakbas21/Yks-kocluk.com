/**
 * Fasikül üretici — Gemini HTTP proxy (anahtar yalnızca sunucuda).
 *
 * Vercel: Environment Variables → GEMINI_API_KEY
 * Yerel: `.env` içine GEMINI_API_KEY=... yazıp `npx vercel dev` çalıştırın.
 *
 * İstemci: POST /api/generate-fasikul (Google generateContent ile aynı JSON gövdesi)
 */
const UPSTREAM = "https://generativelanguage.googleapis.com/v1beta/models";

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
    console.error("[generate-fasikul] GEMINI_API_KEY tanımlı değil");
    return res.status(500).json({ error: "Sunucu yapılandırması eksik (GEMINI_API_KEY)." });
  }

  const model = (process.env.GEMINI_MODEL || "gemini-1.5-flash").trim();
  const url = UPSTREAM + "/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(key.trim());

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

  try {
    var upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    var text = await upstream.text();
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    return res.status(upstream.status).send(text);
  } catch (err) {
    console.error("[generate-fasikul]", err);
    return res.status(502).json({ error: "Gemini bağlantı hatası" });
  }
};
