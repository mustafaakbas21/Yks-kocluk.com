#!/usr/bin/env node
"use strict";

/**
 * YÖK Atlas benzeri açık JSON (GitHub raw vb.) → Appwrite Universities + Programs
 *
 * Kurulum:
 *   npm install node-appwrite
 *   (Node 18+ yerleşik fetch kullanır)
 *
 * Ortam (.env):
 *   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
 *   APPWRITE_DATABASE_ID (varsayılan: derece_panel)
 *   YOK_ATLAS_JSON_URL — HTTP(S) JSON (dizi veya { data: [...] } vb.)
 *   YOK_ATLAS_LOCAL_PATH — yerel dosya yolu (örn. data/yok-atlas.json); URL yoksa argv[2] dosya veya URL olabilir
 *   Örnek:
 *     YOK_ATLAS_JSON_URL=https://.../yok-atlas.json
 *     node --env-file=.env auto-fetch-yokatlas.js ./data/uni-bolumler-tr.json
 *
 * Çalıştırma:
 *   node --env-file=.env auto-fetch-yokatlas.js
 *   node --env-file=.env auto-fetch-yokatlas.js ./data/uni-bolumler-tr.json
 *
 * Önkoşul: setup-appwrite.js (Universities: uniName | Programs: uniId, programName, scoreType, targetTytNet, targetAytNet, alanKey, rowsJson)
 *
 * Not: Bu script mevcut koleksiyonları silmez; aynı veriyi tekrar çalıştırmak yinelenen kayıt oluşturur.
 *      Temiz içe aktarım için önce Programs/Universities purge veya ayrı bir veritabanı kullanın.
 *
 * YÖK Atlas API ile tam program listesi üretmek için Python tarafında şu projeye bakın:
 * https://github.com/saidsurucu/yokatlas-py (search_lisans_programs, program_id ile detay).
 * Çıktıyı bu scriptin beklediği JSON alan adlarıyla (üniversite, bölüm, puan türü, TYT/AYT net) uyumlu bir diziye çevirip
 * raw GitHub veya kendi sunucunuzda barındırın; YOK_ATLAS_JSON_URL ile çekilir.
 */

const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config();
} catch (_) {}

function loadEnvFromFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  raw.split("\n").forEach(function (line) {
    const t = line.trim();
    if (!t || t.charAt(0) === "#") return;
    const eq = t.indexOf("=");
    if (eq === -1) return;
    const key = t.slice(0, eq).trim();
    let val = t.slice(eq + 1).trim();
    if (
      (val.charAt(0) === '"' && val.charAt(val.length - 1) === '"') ||
      (val.charAt(0) === "'" && val.charAt(val.length - 1) === "'")
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  });
}

loadEnvFromFile();

const { Client, Databases, ID } = require("node-appwrite");

const PLACEHOLDER_JSON_URL =
  "https://raw.githubusercontent.com/example-user/example-repo/main/yok-atlas-data.json";

const APPWRITE_ENDPOINT = String(process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || "derece_panel";
const COL_UNI = process.env.APPWRITE_COLLECTION_UNIVERSITIES || "Universities";
const COL_PROG = process.env.APPWRITE_COLLECTION_PROGRAMS || "Programs";

/** Öncelik: argv[2] (pipeline / CLI) → yerel path env → URL env → placeholder */
const DATA_SOURCE = String(
  process.argv[2] ||
    process.env.YOK_ATLAS_LOCAL_PATH ||
    process.env.YOK_ATLAS_JSON_URL ||
    PLACEHOLDER_JSON_URL
).trim();
/** 10k+ kayıtta 429 önlemi: her createDocument sonrası en az 150ms */
const RATE_MS = Math.max(150, parseInt(process.env.APPWRITE_IMPORT_DELAY_MS || "150", 10) || 150);

/** Appwrite rate limit — kullanıcı isteğiyle birebir: Promise + setTimeout(150) */
async function rateLimitPause() {
  await new Promise(function (resolve) {
    setTimeout(resolve, RATE_MS);
  });
}

function normHeader(s) {
  return String(s == null ? "" : s)
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function normKeyCompact(s) {
  return normHeader(s).replace(/\s/g, "");
}

function parseNumber(v) {
  if (v == null || v === "") return NaN;
  if (typeof v === "number" && !isNaN(v)) return v;
  const s = String(v).trim().replace(",", ".");
  const n = parseFloat(s);
  return isNaN(n) ? NaN : n;
}

function uniKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
}

function scoreTypeToAlanKey(raw) {
  const s = normKeyCompact(String(raw || ""));
  if (!s) return "sayisal";
  if (/^say|sayisal|numeric/.test(s)) return "sayisal";
  if (/sozel|sözel/.test(s) || s.indexOf("sozel") !== -1) return "sozel";
  if (/dil|^ydt|lang|language/.test(s)) return "dil";
  if (/esit|ea|esitagirlik|eakit/.test(s) || s.indexOf("agirlik") !== -1) return "esit_agirlik";
  return "sayisal";
}

function clampTyt(n) {
  n = Math.round(n * 10) / 10;
  return Math.min(120, Math.max(0, n));
}

function clampAyt(n, alanKey) {
  n = Math.round(n * 10) / 10;
  const k = String(alanKey || "").toLowerCase();
  const cap = k === "dil" ? 121 : 80;
  return Math.min(cap, Math.max(0, n));
}

function tytSpecs() {
  return [
    { name: "Türkçe", max: 40 },
    { name: "Sosyal Bilimler", max: 20 },
    { name: "Temel Matematik", max: 40 },
    { name: "Fen Bilimleri", max: 20 },
  ];
}

function aytSpecs(alanKey) {
  const k = String(alanKey || "").toLowerCase();
  if (k === "sayisal") {
    return [
      { name: "Matematik", max: 40 },
      { name: "Fizik", max: 14 },
      { name: "Kimya", max: 13 },
      { name: "Biyoloji", max: 13 },
    ];
  }
  if (k === "esit_agirlik") {
    return [
      { name: "Matematik", max: 40 },
      { name: "Türk Dili ve Edebiyatı", max: 24 },
      { name: "Tarih-1", max: 10 },
      { name: "Coğrafya-1", max: 6 },
    ];
  }
  if (k === "dil") {
    return [
      { name: "Yabancı Dil", max: 80 },
      { name: "Türk Dili ve Edebiyatı", max: 24 },
      { name: "Tarih-1", max: 11 },
      { name: "Coğrafya-1", max: 6 },
    ];
  }
  return [
    { name: "Türk Dili ve Edebiyatı", max: 24 },
    { name: "Tarih-1", max: 11 },
    { name: "Tarih-2", max: 11 },
    { name: "Coğrafya-1", max: 6 },
    { name: "Coğrafya-2", max: 11 },
    { name: "Felsefe Grubu", max: 12 },
    { name: "Din Kültürü", max: 6 },
  ];
}

function distributeToRows(section, total, specs) {
  const wsum = specs.reduce(function (s, x) {
    return s + x.max;
  }, 0);
  const rows = [];
  let allocated = 0;
  for (let i = 0; i < specs.length; i++) {
    const sp = specs[i];
    let v;
    if (i === specs.length - 1) {
      v = Math.min(sp.max, Math.max(0, Math.round((total - allocated) * 10) / 10));
    } else {
      v = (total * sp.max) / wsum;
      v = Math.round(v * 10) / 10;
      v = Math.min(sp.max, Math.max(0, v));
    }
    allocated = Math.round((allocated + v) * 10) / 10;
    rows.push({ section: section, name: sp.name, targetNet: v });
  }
  const drift = Math.round((total - allocated) * 10) / 10;
  if (rows.length && Math.abs(drift) >= 0.05) {
    const last = rows[rows.length - 1];
    const spLast = specs[specs.length - 1];
    last.targetNet = Math.min(spLast.max, Math.max(0, Math.round((last.targetNet + drift) * 10) / 10));
  }
  return rows;
}

function buildRowsJson(alanKey, tytTotal, aytTotal) {
  const tyt = distributeToRows("TYT", tytTotal, tytSpecs());
  const ayt = distributeToRows("AYT", aytTotal, aytSpecs(alanKey));
  return JSON.stringify(tyt.concat(ayt));
}

function slice512(s) {
  s = String(s == null ? "" : s);
  return s.length > 512 ? s.slice(0, 509) + "…" : s;
}

function slice255(s) {
  s = String(s == null ? "" : s);
  return s.length > 255 ? s.slice(0, 252) + "…" : s;
}

function scoreTypeLabelForRow(rawScore, alanKey) {
  const s = String(rawScore == null ? "" : rawScore).trim();
  if (s) return s.slice(0, 50);
  const k = String(alanKey || "").toLowerCase();
  if (k === "dil") return "DİL";
  if (k === "sozel") return "SÖZ";
  if (k === "esit_agirlik") return "EA";
  return "SAY";
}

/**
 * Obje anahtarlarını küçük ASCII anahtarlara indirger; bilinen alanları okur.
 */
function recordFromJsonObject(obj) {
  if (!obj || typeof obj !== "object") return null;
  const compact = {};
  Object.keys(obj).forEach(function (k) {
    compact[normKeyCompact(k)] = obj[k];
  });

  function pickString(keys) {
    for (let i = 0; i < keys.length; i++) {
      const v = compact[keys[i]];
      const t = uniKey(v);
      if (t) return t;
    }
    return "";
  }

  function pickScoreType() {
    const v = pickString([
      "puanturu",
      "puantur",
      "scoretype",
      "alanturu",
      "alan",
      "yksalan",
      "programturu",
    ]);
    return v || pickString(["tip", "tur"]);
  }

  const university = pickString([
    "universiteadi",
    "universite",
    "universitead",
    "uniname",
    "universityname",
    "university",
    "okul",
    "kurum",
  ]);
  const program = pickString([
    "programadi",
    "programname",
    "program",
    "bolumadi",
    "bolum",
    "bolumad",
    "department",
    "departmentname",
    "fakulte",
    "anabilimdali",
  ]);

  let tyt = NaN;
  let ayt = NaN;
  const tytKeys = [
    "targettytnet",
    "hedeftytnet",
    "tytnet",
    "tyttoplamnet",
    "tyt",
    "nettyt",
  ];
  const aytKeys = ["targetaytnet", "hedefaytnet", "aytnet", "ayttoplamnet", "ayt", "netayt"];
  for (let i = 0; i < tytKeys.length; i++) {
    if (compact[tytKeys[i]] != null && String(compact[tytKeys[i]]).trim() !== "") {
      tyt = parseNumber(compact[tytKeys[i]]);
      break;
    }
  }
  for (let j = 0; j < aytKeys.length; j++) {
    if (compact[aytKeys[j]] != null && String(compact[aytKeys[j]]).trim() !== "") {
      ayt = parseNumber(compact[aytKeys[j]]);
      break;
    }
  }

  return {
    university: university,
    program: program,
    scoreType: pickScoreType(),
    targetTyt: tyt,
    targetAyt: ayt,
  };
}

function extractRecords(root) {
  if (Array.isArray(root)) return root;
  if (root && typeof root === "object") {
    const keys = ["data", "items", "programs", "rows", "records", "sonuclar", "results", "liste"];
    for (let i = 0; i < keys.length; i++) {
      const k = keys[i];
      if (Array.isArray(root[k])) return root[k];
    }
  }
  return [];
}

/**
 * { universities: [ { name, departments: [...] } ] } → düz satırlar (projedeki uni-bolumler-tr.json).
 */
function expandFromUniversitiesDepartments(root) {
  if (!root || typeof root !== "object") return [];
  const arr = root.universities;
  if (!Array.isArray(arr)) return [];
  const out = [];
  for (let i = 0; i < arr.length; i++) {
    const u = arr[i];
    const uname = u && u.name != null ? uniKey(u.name) : "";
    const depts = u && Array.isArray(u.departments) ? u.departments : [];
    if (!uname) continue;
    for (let j = 0; j < depts.length; j++) {
      const prog = uniKey(depts[j]);
      if (!prog) continue;
      out.push({
        university: uname,
        program: prog,
        scoreType: "",
        targetTyt: NaN,
        targetAyt: NaN,
      });
    }
  }
  return out;
}

async function loadJsonRoot(src) {
  if (/^https?:\/\//i.test(src)) {
    return fetchJson(src);
  }
  const fp = path.isAbsolute(src) ? src : path.join(process.cwd(), src);
  if (!fs.existsSync(fp)) {
    throw new Error("Dosya bulunamadı: " + fp);
  }
  const text = fs.readFileSync(fp, "utf8");
  return JSON.parse(text);
}

async function fetchJson(url) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "YKS-Kocluk-auto-fetch-yokatlas/1.0", Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error("HTTP " + res.status + " " + res.statusText);
    }
    return await res.json();
  } catch (e) {
    console.error("JSON indirilemedi:", url);
    throw e;
  }
}

async function main() {
  if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
    console.error("Eksik ortam: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY");
    process.exit(1);
  }

  console.log("Kaynak:", DATA_SOURCE);
  console.log("Gecikme (rate limit):", RATE_MS, "ms / createDocument");
  let root;
  try {
    root = await loadJsonRoot(DATA_SOURCE);
  } catch (e) {
    console.error(e && e.message ? e.message : e);
    process.exit(1);
  }

  let normalized = expandFromUniversitiesDepartments(root);
  if (!normalized.length) {
    const rawList = extractRecords(root);
    if (!rawList.length) {
      console.error(
        "JSON içinde kayıt yok. Beklenen: kök dizi, veya data/items/..., veya { universities: [ { name, departments } ] }."
      );
      process.exit(1);
    }
    for (let i = 0; i < rawList.length; i++) {
      const rec = recordFromJsonObject(rawList[i]);
      if (rec && rec.university && rec.program) normalized.push(rec);
    }
  }

  if (!normalized.length) {
    console.error("Hiç geçerli satır yok (üniversite + bölüm zorunlu). JSON alan adlarını kontrol edin.");
    process.exit(1);
  }

  const uniqueUnis = [];
  const seen = new Set();
  for (let j = 0; j < normalized.length; j++) {
    const uk = uniKey(normalized[j].university);
    if (!seen.has(uk)) {
      seen.add(uk);
      uniqueUnis.push(uk);
    }
  }
  uniqueUnis.sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });

  const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
  const databases = new Databases(client);

  /** @type {Map<string, string>} */
  const uniIdByName = new Map();
  const uniTotal = uniqueUnis.length;

  console.log("\n── Faz 1: Universities (" + uniTotal + " tekil) ──");
  for (let u = 0; u < uniqueUnis.length; u++) {
    const name = uniqueUnis[u];
    const step = u + 1;
    console.log("[" + step + " / " + uniTotal + "] Aktarılıyor (üniversite): " + name.slice(0, 72));
    try {
      const doc = await databases.createDocument({
        databaseId: DATABASE_ID,
        collectionId: COL_UNI,
        documentId: ID.unique(),
        data: { uniName: slice255(name) },
        permissions: [],
      });
      uniIdByName.set(name, doc.$id);
    } catch (err) {
      console.error("Universities hata:", name, err && err.message ? err.message : err);
      throw err;
    }
    await rateLimitPause();
  }

  const programTotal = normalized.length;
  console.log("\n── Faz 2: Programs (" + programTotal + " satır) ──");
  let created = 0;
  let errN = 0;

  for (let p = 0; p < normalized.length; p++) {
    const row = normalized[p];
    const uName = uniKey(row.university);
    const pName = uniKey(row.program);
    const uniId = uniIdByName.get(uName);
    const progress = "[" + (p + 1) + " / " + programTotal + "]";
    if (!uniId) {
      console.warn(progress + " Atlanıyor (üniversite eşlemesi yok): " + uName);
      await rateLimitPause();
      continue;
    }

    const alanKey = scoreTypeToAlanKey(row.scoreType);
    const scoreTypeOut = scoreTypeLabelForRow(row.scoreType, alanKey);
    let tyt = row.targetTyt;
    let ayt = row.targetAyt;
    if (isNaN(tyt)) tyt = 0;
    if (isNaN(ayt)) ayt = 0;
    tyt = clampTyt(tyt);
    ayt = clampAyt(ayt, alanKey);
    const rowsJson = buildRowsJson(alanKey, tyt, ayt);

    const shortU = uName.length > 42 ? uName.slice(0, 39) + "…" : uName;
    const shortP = pName.length > 48 ? pName.slice(0, 45) + "…" : pName;
    console.log(progress + " Aktarılıyor: " + shortU + " — " + shortP);

    try {
      await databases.createDocument({
        databaseId: DATABASE_ID,
        collectionId: COL_PROG,
        documentId: ID.unique(),
        data: {
          uniId: uniId,
          programName: slice255(pName),
          scoreType: scoreTypeOut,
          targetTytNet: tyt,
          targetAytNet: ayt,
          alanKey: alanKey,
          rowsJson: rowsJson,
        },
        permissions: [],
      });
      created++;
    } catch (e) {
      errN++;
      console.error(progress + " Programs hatası:", e && e.message ? e.message : e);
    }
    await rateLimitPause();
  }

  console.log(
    "\n✅ Bitti. Programs oluşturulan: " + created + " / " + programTotal + " | Hata: " + errN + " | Üniversite: " + uniTotal
  );
  console.log("İlişkisel kontrol: Programs.uniId alanları Faz 1'de oluşturulan Universities.$id ile eşlendi.");
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
