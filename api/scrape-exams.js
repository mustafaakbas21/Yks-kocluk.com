/**
 * POST /api/scrape-exams — body: { targetUrl?: string } (boşsa varsayılan takvim).
 * GET /api/scrape-exams — geriye dönük: varsayılan URL.
 */
const axios = require("axios");
const cheerio = require("cheerio");

const DEFAULT_SOURCE_URL = "https://denemeler.net/takvim";

const TR_MONTHS = {
  oca: 1,
  şub: 2,
  sub: 2,
  mar: 3,
  nis: 4,
  may: 5,
  haz: 6,
  tem: 7,
  ağu: 8,
  agu: 8,
  eyl: 9,
  eki: 10,
  kas: 11,
  ara: 12,
};

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

function normalizeScrapeTargetUrl(raw) {
  var s = raw != null ? String(raw).trim() : "";
  if (!s) return DEFAULT_SOURCE_URL;
  if (!/^https?:\/\//i.test(s)) s = "https://" + s;
  try {
    var u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return DEFAULT_SOURCE_URL;
    return u.href;
  } catch (_e) {
    return DEFAULT_SOURCE_URL;
  }
}

function inferYearFromTitle(title, fallbackYear) {
  var s = String(title || "");
  var m = s.match(/\b(20\d{2})\b/g);
  if (m && m.length) return parseInt(m[m.length - 1], 10);
  return fallbackYear;
}

function parseExamTypeFromCard($, $card) {
  var texts = [];
  $card.find(".flex.items-center.gap-2.mb-1 span").each(function (_, el) {
    var t = $(el).text().trim().toUpperCase();
    if (t) texts.push(t);
  });
  if (texts.indexOf("TYT-AYT") !== -1 || (texts.indexOf("TYT") !== -1 && texts.indexOf("AYT") !== -1)) return "YKS";
  if (texts.indexOf("AYT") !== -1) return "AYT";
  if (texts.indexOf("TYT") !== -1) return "TYT";
  return "YKS";
}

function parseTrDayMonth(raw, year) {
  var line = String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/\./g, "");
  if (!line) return null;
  var parts = line.split(/\s+/);
  if (parts.length < 2) return null;
  var day = parseInt(parts[0], 10);
  var monToken = parts[1].slice(0, 3);
  if (isNaN(day) || day < 1 || day > 31) return null;
  var month = TR_MONTHS[monToken];
  if (!month) return null;
  var y = parseInt(String(year), 10);
  if (isNaN(y) || y < 2000) y = new Date().getFullYear();
  var d = new Date(Date.UTC(y, month - 1, day, 12, 0, 0, 0));
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

function scrapeExams(html) {
  var $ = cheerio.load(html);
  var nowY = new Date().getFullYear();
  /** @type {Map<string, object>} */
  var byKey = new Map();
  $('a[href^="/deneme/"]').each(function (_, el) {
    var $a = $(el);
    var href = $a.attr("href") || "";
    var name = $a.find("h4").first().text().trim();
    var publisher =
      $a.find("p.text-sm.text-muted-foreground.mt-1").first().text().trim() ||
      $a.find("p.mt-1.text-muted-foreground").first().text().trim();
    var dateLine = $a.find(".text-right p.text-sm.font-medium").first().text().trim();
    if (!name || !publisher || !dateLine) return;
    var year = inferYearFromTitle(name, nowY);
    var dateIso = parseTrDayMonth(dateLine, year);
    if (!dateIso) return;
    var examType = parseExamTypeFromCard($, $a);
    var key = href || name + "|" + dateIso;
    if (byKey.has(key)) return;
    byKey.set(key, {
      name: name,
      publisher: publisher,
      date: dateIso,
      examType: examType,
      sourcePath: href,
    });
  });
  var arr = Array.from(byKey.values());
  arr.sort(function (a, b) {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return String(a.name).localeCompare(String(b.name), "tr");
  });
  return arr;
}

async function runScrapeForUrl(sourceUrl, res) {
  var ax = await axios.get(sourceUrl, {
    timeout: 25000,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; YKSKoclukCalendar/1.0; +https://derecepanel.com)",
      Accept: "text/html,application/xhtml+xml",
    },
    maxRedirects: 5,
    validateStatus: function (s) {
      return s >= 200 && s < 400;
    },
  });
  var html = String(ax.data || "");
  var exams = scrapeExams(html);
  return res.status(200).json({ ok: true, exams: exams, source: sourceUrl });
}

module.exports = async function handler(req, res) {
  Object.entries(corsHeaders()).forEach(function (pair) {
    res.setHeader(pair[0], pair[1]);
  });

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method === "GET") {
    try {
      return await runScrapeForUrl(DEFAULT_SOURCE_URL, res);
    } catch (err) {
      var msgG = (err && err.message) || String(err);
      return res.status(502).json({ ok: false, error: msgG, exams: [] });
    }
  }

  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, error: "Method not allowed" });
  }

  var body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch (_e) {
      return res.status(400).json({ ok: false, error: "Geçersiz JSON gövdesi", exams: [] });
    }
  }
  if (!body || typeof body !== "object") {
    body = {};
  }
  var targetUrl = normalizeScrapeTargetUrl(body.targetUrl != null ? body.targetUrl : "");

  try {
    return await runScrapeForUrl(targetUrl, res);
  } catch (err) {
    var msg = (err && err.message) || String(err);
    return res.status(502).json({ ok: false, error: msg, exams: [], source: targetUrl });
  }
};
