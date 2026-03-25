/**
 * Vercel Serverless — Zoho Mail gelen kutusu listesi
 * Ortam: ZOHO_CLIENT_ID, ZOHO_CLIENT_SECRET, ZOHO_REFRESH_TOKEN
 * İsteğe bağlı: ZOHO_ACCOUNT_ID, ZOHO_MAIL_API_BASE, ZOHO_ACCOUNTS_TOKEN_URL, ZOHO_INBOX_FOLDER_ID
 */

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
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Zoho token yanıtı JSON değil: " + text.slice(0, 200));
  }
  if (!res.ok || !json.access_token) {
    throw new Error(
      json.error || json.message || "Zoho access token alınamadı (" + res.status + ")"
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

async function zohoGetJson(url, accessToken) {
  const res = await fetch(url, {
    headers: { Authorization: "Zoho-oauthtoken " + accessToken },
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error("Beklenmeyen yanıt: " + text.slice(0, 180));
  }
  if (!res.ok) {
    throw new Error(
      (json && (json.message || json.error)) || "İstek başarısız " + res.status
    );
  }
  return json;
}

export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return res.status(204).end();
  }
  if (req.method !== "GET" && req.method !== "POST") {
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
        ". Vercel Project Settings → Environment Variables.",
      emails: [],
    });
  }

  const apiBase = (env.ZOHO_MAIL_API_BASE || "https://mail.zoho.eu/api").replace(/\/$/, "");

  try {
    const accessToken = await zohoRefreshAccessToken(env);

    let accountId = env.ZOHO_ACCOUNT_ID ? String(env.ZOHO_ACCOUNT_ID).trim() : "";
    if (!accountId) {
      const accPayload = await zohoGetJson(apiBase + "/accounts", accessToken);
      const accounts = firstApiData(accPayload) || [];
      const first = accounts[0];
      accountId =
        first &&
        (first.accountId || first.zuid || first.account_id || first.id);
      if (!accountId) {
        return res.status(502).json({
          ok: false,
          error: "Zoho hesap listesi boş veya ZOHO_ACCOUNT_ID tanımlayın.",
          raw: accPayload,
          emails: [],
        });
      }
    }

    let folderId = env.ZOHO_INBOX_FOLDER_ID
      ? String(env.ZOHO_INBOX_FOLDER_ID).trim()
      : "";
    if (!folderId) {
      const folderPayload = await zohoGetJson(
        apiBase + "/accounts/" + encodeURIComponent(accountId) + "/folders",
        accessToken
      );
      const folders = firstApiData(folderPayload) || [];
      const inbox = folders.find(function (f) {
        var name = (f.folderName || f.name || "").toString().toLowerCase();
        return name === "inbox" || name === "gelen" || f.isInbox === true;
      });
      folderId =
        inbox &&
        (inbox.folderId || inbox.folder_id || inbox.id);
      if (!folderId && folders[0]) {
        folderId = folders[0].folderId || folders[0].folder_id || folders[0].id;
      }
      if (!folderId) {
        return res.status(502).json({
          ok: false,
          error: "Gelen klasörü bulunamadı; ZOHO_INBOX_FOLDER_ID ekleyin.",
          emails: [],
        });
      }
    }

    var qLimit = "25";
    try {
      var host = req.headers["x-forwarded-host"] || req.headers.host || "localhost";
      var proto = req.headers["x-forwarded-proto"] || "https";
      var u = new URL(req.url || "/", proto + "://" + host);
      qLimit = u.searchParams.get("limit") || "25";
    } catch (_e) {}
    const limit = Math.min(50, Math.max(5, parseInt(String(qLimit), 10) || 25));
    const listUrl =
      apiBase +
      "/accounts/" +
      encodeURIComponent(accountId) +
      "/messages/view?folderId=" +
      encodeURIComponent(folderId) +
      "&start=0&limit=" +
      limit;

    const listPayload = await zohoGetJson(listUrl, accessToken);
    const rows = firstApiData(listPayload) || listPayload.messages || listPayload.data || [];

    const emails = (Array.isArray(rows) ? rows : []).map(function (m, idx) {
      var fromRaw =
        m.fromAddress ||
        (m.from && (m.from.address || m.from.email)) ||
        m.sender ||
        m.mailFrom ||
        "";
      if (typeof fromRaw === "object" && fromRaw !== null) {
        fromRaw =
          fromRaw.address || fromRaw.email || fromRaw.name || JSON.stringify(fromRaw);
      }
      var subject = m.subject != null ? String(m.subject) : "";
      var preview =
        m.summary ||
        m.snippet ||
        m.preview ||
        m.fragment ||
        (m.content && m.content.substring && m.content.substring(0, 400)) ||
        "";
      preview = String(preview).replace(/\s+/g, " ").trim();
      var lines = preview.split(/\r?\n/).filter(Boolean);
      var twoLine = lines.slice(0, 2).join(" ");
      if (!twoLine && preview.length) {
        twoLine = preview.length > 220 ? preview.slice(0, 220) + "…" : preview;
      }
      var ts =
        m.receivedTime ||
        m.sentTimeInGMT ||
        m.date ||
        m.received_time ||
        m.mailDeliveryTime;
      var dateLabel = "";
      if (ts != null) {
        var d = typeof ts === "number" ? new Date(ts) : new Date(String(ts));
        if (!isNaN(d.getTime())) {
          dateLabel = d.toLocaleString("tr-TR", {
            dateStyle: "medium",
            timeStyle: "short",
          });
        }
      }
      var unread =
        m.isUnread === true ||
        m.status === "unread" ||
        String(m.flag || "").toLowerCase() === "unread";
      return {
        id: String(m.messageId || m.mailId || m.message_id || idx),
        from: String(fromRaw || "—"),
        subject: subject || "(Konu yok)",
        date: dateLabel || "—",
        preview: twoLine || "—",
        isUnread: unread,
      };
    });

    return res.status(200).json({
      ok: true,
      emails,
      meta: { accountId: String(accountId), folderId: String(folderId) },
    });
  } catch (e) {
    console.error("[get-emails]", e);
    return res.status(200).json({
      ok: false,
      error: e && e.message ? String(e.message) : "Zoho Mail listesi alınamadı.",
      emails: [],
    });
  }
}
