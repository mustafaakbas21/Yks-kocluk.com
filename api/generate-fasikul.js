/**
 * Fasikül üretici — güvenli Gemini proxy (POST /api/generate-fasikul).
 * Gövde: Google Generative Language `generateContent` ile aynı JSON.
 * Anahtar: process.env.GEMINI_API_KEY (yalnızca sunucu).
 *
 * Vercel: Environment Variables → GEMINI_API_KEY
 * İsteğe bağlı: GEMINI_MODEL (varsayılan gemini-1.5-flash)
 */
module.exports = require("./gemini-fasikul.js");
