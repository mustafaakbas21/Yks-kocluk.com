/**
 * Vercel Serverless — Zoho Mail gönder
 * POST /api/send-zoho-email
 * Body (JSON): toAddress*, subject*, content*, accountId? (yoksa ortam veya hesap listesinden),
 *   mailFormat? ("html" | "plaintext"), fromAddress? (varsayılan ZOHO_FROM_ADDRESS veya info@derecepanel.com)
 *
 * Ortam: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
 * İsteğe bağlı: ZOHO_ACCOUNT_ID, ZOHO_FROM_ADDRESS,
 *   ZOHO_MAIL_SEND_BASE (varsayılan: ZOHO_MAIL_API_LEGACY_BASE veya https://mail.zoho.eu/api),
 *   ZOHO_MAIL_API_V1_BASE, ZOHO_MAIL_API_LEGACY_BASE, ZOHO_ACCOUNTS_TOKEN_URL
 *
 * Zoho dokümantasyonu: POST https://mail.zoho.eu/api/accounts/{accountId}/messages (EU)
 * OAuth kapsamı: ZohoMail.messages.CREATE veya ZohoMail.messages.ALL
 * ZOHO_MAIL_AUTH_SCHEME — "zoho" (Zoho-oauthtoken) veya "bearer"
 */

function zohoMailAuthHeader(accessToken, env) {
  const scheme = String(env.ZOHO_MAIL_AUTH_SCHEME || "zoho").toLowerCase();
  if (scheme === "bearer") {
    return { Authorization: "Bearer " + accessToken };
  }
  return { Authorization: "Zoho-oauthtoken " + accessToken };
}

async function zohoRefreshAccessToken(env) {
  const tokenUrl =
    env.ZOHO_ACCOUNTS_TOKEN_URL || "https://accounts.zoho.eu/oauth/v2/token";
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: env.ZOHO_REFRESH_TOKEN,
    client_id: env.ZOHO_CLIENT_ID,
    client_secret: env.ZOHO_CLIENT_SECRET,
  });
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error(
      "[send-zoho-email] Token yanıtı JSON değil. HTTP",
      res.status,
      "body:",
      text.slice(0, 2000)
    );
    throw new Error("Zoho token yanıtı JSON değil: " + text.slice(0, 200));
  }
  if (!res.ok || !json.access_token) {
    console.error(
      "[send-zoho-email] Token alınamadı. HTTP",
      res.status,
      "URL:",
      tokenUrl,
      "body:",
      JSON.stringify(json)
    );
    throw new Error(
      json.error ||
        json.message ||
        "Zoho access token alınamadı (" + res.status + "): " +
          (text ? text.slice(0, 500) : "")
    );
  }
  return json.access_token;
}

function firstApiData(payload) {
  if (!payload) return null;
  if (Array.isArray(payload.data)) return payload.data;
  if (payload.data && Array.isArray(payload.data.data)) return payload.data.data;
  return null;
}

async function zohoGetJson(url, accessToken, env) {
  const authHeaders = zohoMailAuthHeader(accessToken, env);
  const res = await fetch(url, {
    headers: {
      ...authHeaders,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    console.error(
      "[send-zoho-email] Mail API JSON parse. HTTP",
      res.status,
      "URL:",
      url,
      "raw:",
      text.slice(0, 2000)
    );
    throw new Error("Beklenmeyen yanıt: " + text.slice(0, 180));
  }
  if (!res.ok) {
    const detail =
      (json && (json.message || json.error || json.data)) || text || "";
    console.error(
      "[send-zoho-email] Mail API hata. HTTP",
      res.status,
      "URL:",
      url,
      "body:",
      typeof detail === "string" ? detail : JSON.stringify(detail).slice(0, 2000)
    );
    throw new Error(
      (typeof detail === "string" ? detail : JSON.stringify(detail)) ||
        "İstek başarısız " + res.status
    );
  }
  return json;
}

function readJsonBody(req) {
  const b = req.body;
  if (b && typeof b === "object" && !Array.isArray(b)) return b;
  if (typeof b === "string") {
    try {
      return JSON.parse(b || "{}");
    } catch {
      return null;
    }
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  const env = process.env;
  const missing = [];
  if (!env.ZOHO_CLIENT_ID) missing.push("ZOHO_CLIENT_ID");
  if (!env.ZOHO_CLIENT_SECRET) missing.push("ZOHO_CLIENT_SECRET");
  if (!env.ZOHO_REFRESH_TOKEN) missing.push("ZOHO_REFRESH_TOKEN");
  if (missing.length) {
    return res.status(503).json({
      ok: false,
      error:
        "Zoho ortam değişkenleri eksik: " +
        missing.join(", ") +
        ". Vercel → Environment Variables.",
    });
  }

  const body = readJsonBody(req);
  if (!body || typeof body !== "object") {
    return res.status(400).json({ ok: false, error: "Geçersiz veya boş JSON gövdesi." });
  }

  const toAddress = String(body.toAddress || "").trim();
  const subject = String(body.subject || "").trim();
  const content =
    body.content != null && body.content !== undefined ? String(body.content) : "";
  const mailFormat =
    String(body.mailFormat || "html").toLowerCase() === "plaintext"
      ? "plaintext"
      : "html";
  let accountId = body.accountId != null ? String(body.accountId).trim() : "";
  const fromAddress = String(
    body.fromAddress ||
      env.ZOHO_FROM_ADDRESS ||
      "info@derecepanel.com"
  ).trim();

  if (!toAddress) {
    return res.status(400).json({ ok: false, error: "Alıcı adresi (toAddress) gerekli." });
  }
  if (!subject) {
    return res.status(400).json({ ok: false, error: "Konu (subject) gerekli." });
  }

  const v1Base = (
    env.ZOHO_MAIL_API_V1_BASE || "https://mail.zoho.eu/api/v1"
  ).replace(/\/$/, "");
  const legacyBase = (
    env.ZOHO_MAIL_API_LEGACY_BASE || "https://mail.zoho.eu/api"
  ).replace(/\/$/, "");
  const sendBase = (
    env.ZOHO_MAIL_SEND_BASE || legacyBase
  ).replace(/\/$/, "");

  try {
    const accessToken = await zohoRefreshAccessToken(env);

    if (!accountId) {
      accountId = env.ZOHO_ACCOUNT_ID ? String(env.ZOHO_ACCOUNT_ID).trim() : "";
    }
    if (!accountId) {
      let accPayload;
      try {
        accPayload = await zohoGetJson(v1Base + "/accounts", accessToken, env);
      } catch (_acc) {
        accPayload = await zohoGetJson(legacyBase + "/accounts", accessToken, env);
      }
      const accounts = firstApiData(accPayload) || [];
      const first = accounts[0];
      accountId =
        first &&
        (first.accountId || first.zuid || first.account_id || first.id);
      if (!accountId) {
        return res.status(502).json({
          ok: false,
          error:
            "Zoho hesap kimliği bulunamadı. Vercel’de ZOHO_ACCOUNT_ID tanımlayın veya hesap listesini kontrol edin.",
        });
      }
    }

    const payload = {
      fromAddress,
      toAddress,
      subject,
      content: content || " ",
      mailFormat,
    };

    const sendUrl =
      sendBase +
      "/accounts/" +
      encodeURIComponent(accountId) +
      "/messages";

    const sendAuth = zohoMailAuthHeader(accessToken, env);
    const zRes = await fetch(sendUrl, {
      method: "POST",
      headers: {
        ...sendAuth,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    const zText = await zRes.text();
    let zJson;
    try {
      zJson = zText ? JSON.parse(zText) : {};
    } catch {
      zJson = { raw: zText };
    }

    if (!zRes.ok) {
      console.error(
        "[send-zoho-email] Gönderim hata. HTTP",
        zRes.status,
        "URL:",
        sendUrl,
        "authScheme:",
        String(env.ZOHO_MAIL_AUTH_SCHEME || "zoho"),
        "body:",
        zText.slice(0, 2000)
      );
      const msg =
        (zJson && (zJson.message || zJson.error || zJson.data)) ||
        zText.slice(0, 300) ||
        "Gönderim başarısız " + zRes.status;
      const lower = String(msg).toLowerCase();
      const scopeHint =
        zRes.status === 401 ||
        zRes.status === 403 ||
        lower.includes("scope") ||
        lower.includes("permission") ||
        lower.includes("unauthorized");
      return res.status(200).json({
        ok: false,
        error: scopeHint
          ? msg +
            " — Zoho API Console’da OAuth kapsamlarını kontrol edin (ör. ZohoMail.messages.CREATE veya ZohoMail.messages.ALL) ve yeni refresh token üretin."
          : msg,
        zohoStatus: zRes.status,
      });
    }

    return res.status(200).json({
      ok: true,
      data: zJson,
      meta: { accountId: String(accountId) },
    });
  } catch (e) {
    const msg = e && e.message ? String(e.message) : "Gönderim sırasında hata.";
    console.error("[send-zoho-email] exception:", e);
    console.error("[send-zoho-email] message:", msg);
    if (e && e.stack) console.error("[send-zoho-email] stack:", e.stack);
    return res.status(200).json({
      ok: false,
      error:
        msg +
        (msg.toLowerCase().includes("token")
          ? " OAuth kapsamları ve ZOHO_REFRESH_TOKEN değerini kontrol edin."
          : ""),
    });
  }
}
