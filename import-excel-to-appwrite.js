#!/usr/bin/env node
"use strict";

/**
 * Excel (yks-verileri.xlsx) → Appwrite Universities + Programs
 *
 * Kurulum:
 *   npm install xlsx node-appwrite
 *
 * Ortam (.env veya ortam değişkenleri):
 *   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
 *   APPWRITE_DATABASE_ID (varsayılan: derece_panel)
 *   EXCEL_PATH (varsayılan: ./yks-verileri.xlsx)
 *
 * Çalıştırma:
 *   node --env-file=.env import-excel-to-appwrite.js
 *   node import-excel-to-appwrite.js "C:/path/yks-verileri.xlsx"
 *
 * Önkoşul: node setup-appwrite.js (Universities / Programs şeması)
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

const XLSX = require("xlsx");
const { Client, Databases, ID } = require("node-appwrite");

const APPWRITE_ENDPOINT = String(process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || "derece_panel";
const COL_UNI = process.env.APPWRITE_COLLECTION_UNIVERSITIES || "Universities";
const COL_PROG = process.env.APPWRITE_COLLECTION_PROGRAMS || "Programs";

const EXCEL_PATH = process.argv[2] || process.env.EXCEL_PATH || path.join(__dirname, "yks-verileri.xlsx");
const RATE_MS = 150;

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
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

/**
 * Excel başlık satırından sütun adlarını eşleştirir (Türkçe / İngilizce varyantlar).
 */
function detectColumnMap(headers) {
  const rawKeys = headers.map(function (h) {
    return String(h);
  });
  const list = rawKeys.map(function (h) {
    return { raw: h, n: normHeader(h), c: normKeyCompact(h) };
  });

  function pick(predicate) {
    for (let i = 0; i < list.length; i++) {
      if (predicate(list[i])) return list[i].raw;
    }
    return null;
  }

  const uniCol = pick(function (x) {
    return (
      x.c.indexOf("universiteadi") !== -1 ||
      x.c === "universite" ||
      (x.n.indexOf("üniversite") !== -1 && x.n.indexOf("ad") !== -1) ||
      (x.n.indexOf("universite") !== -1 && x.n.indexOf("ad") !== -1) ||
      x.c === "univ" ||
      x.c === "university"
    );
  });

  const programCol = pick(function (x) {
    return (
      x.c.indexOf("programname") !== -1 ||
      x.c.indexOf("programadi") !== -1 ||
      (x.n.indexOf("bolum") !== -1 && x.n.indexOf("ad") !== -1) ||
      (x.n.indexOf("program") !== -1 && x.n.indexOf("ad") !== -1) ||
      x.c === "program" ||
      x.c === "bolum" ||
      x.n === "bolum" ||
      x.n === "fakulte"
    );
  });

  const scoreTypeCol = pick(function (x) {
    return (
      x.c.indexOf("scoretype") !== -1 ||
      x.c.indexOf("puanturu") !== -1 ||
      x.c.indexOf("alanturu") !== -1 ||
      x.n.indexOf("puan tur") !== -1 ||
      x.n.indexOf("yks alan") !== -1
    );
  });

  const tytCol = pick(function (x) {
    return (
      x.c.indexOf("targettyt") !== -1 ||
      x.c.indexOf("hedeftyt") !== -1 ||
      (x.n.indexOf("tyt") !== -1 && x.n.indexOf("net") !== -1 && x.n.indexOf("ayt") === -1) ||
      x.c === "tytnet"
    );
  });

  const aytCol = pick(function (x) {
    return (
      x.c.indexOf("targetayt") !== -1 ||
      x.c.indexOf("hedefayt") !== -1 ||
      (x.n.indexOf("ayt") !== -1 && x.n.indexOf("net") !== -1) ||
      x.c === "aytnet"
    );
  });

  return {
    university: uniCol,
    program: programCol,
    scoreType: scoreTypeCol,
    targetTyt: tytCol,
    targetAyt: aytCol,
  };
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

function uniKey(name) {
  return String(name || "")
    .trim()
    .replace(/\s+/g, " ");
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
  var s = String(rawScore == null ? "" : rawScore).trim();
  if (s) return s.slice(0, 50);
  var k = String(alanKey || "").toLowerCase();
  if (k === "dil") return "DİL";
  if (k === "sozel") return "SÖZ";
  if (k === "esit_agirlik") return "EA";
  return "SAY";
}

async function main() {
  if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
    console.error("Eksik ortam: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY");
    process.exit(1);
  }
  if (!fs.existsSync(EXCEL_PATH)) {
    console.error("Excel bulunamadı:", EXCEL_PATH);
    process.exit(1);
  }

  const workbook = XLSX.readFile(EXCEL_PATH, { cellDates: true });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) {
    console.error("Dosyada sayfa yok.");
    process.exit(1);
  }
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { defval: "", raw: false });

  if (!rows.length) {
    console.error("İlk sayfada veri satırı yok.");
    process.exit(1);
  }

  const headers = Object.keys(rows[0]);
  const col = detectColumnMap(headers);
  if (!col.university || !col.program) {
    console.error(
      "Sütun eşleşmedi. Bulunan başlıklar:",
      headers.join(" | "),
      "\nBeklenen: Üniversite adı ve Program/Bölüm adı sütunları (Türkçe veya İngilizce varyant)."
    );
    console.error("Eşleşen:", JSON.stringify(col, null, 2));
    process.exit(1);
  }
  if (!col.targetTyt || !col.targetAyt) {
    console.warn("UYARI: TYT/AYT sütunları otomatik bulunamadı; '0' kullanılırsa satır atlanabilir.");
  }

  console.log("Dosya:", EXCEL_PATH);
  console.log("Sayfa:", sheetName);
  console.log("Satır (veri):", rows.length);
  console.log("Sütun eşlemesi:", col);

  const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
  const databases = new Databases(client);

  const uniqueUnis = [];
  const seen = new Set();
  for (let i = 0; i < rows.length; i++) {
    const uk = uniKey(rows[i][col.university]);
    if (!uk) continue;
    if (!seen.has(uk)) {
      seen.add(uk);
      uniqueUnis.push(uk);
    }
  }
  uniqueUnis.sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });

  console.log("\n── Faz 1: Universities (" + uniqueUnis.length + " tekil) ──");
  /** @type {Map<string, string>} */
  const uniIdByName = new Map();
  let uDone = 0;
  for (let u = 0; u < uniqueUnis.length; u++) {
    const name = uniqueUnis[u];
    uDone++;
    try {
      console.log("[" + uDone + " / " + uniqueUnis.length + "] Üniversite kaydediliyor: " + name.slice(0, 80));
      const doc = await databases.createDocument({
        databaseId: DATABASE_ID,
        collectionId: COL_UNI,
        documentId: ID.unique(),
        data: { uniName: slice255(name) },
        permissions: [],
      });
      uniIdByName.set(name, doc.$id);
    } catch (e) {
      console.error("Hata (üniversite):", name, e.message || e);
      throw e;
    }
    await sleep(RATE_MS);
  }

  const programRows = rows.filter(function (r) {
    return uniKey(r[col.university]) && String(r[col.program] || "").trim();
  });
  const programTotal = programRows.length;

  console.log("\n── Faz 2: Programs (" + programTotal + " satır) ──");
  const skippedEmpty = rows.length - programTotal;
  let skippedNoUniId = 0;
  let errors = 0;
  let created = 0;

  for (let r = 0; r < programRows.length; r++) {
    const row = programRows[r];
    const uName = uniKey(row[col.university]);
    const pName = String(row[col.program] || "").trim();
    const progress = "[" + (r + 1) + " / " + programTotal + "]";
    const uniId = uniIdByName.get(uName);
    if (!uniId) {
      console.warn(progress + " Atlanıyor (üniversite Map'te yok): " + uName);
      skippedNoUniId++;
      await sleep(RATE_MS);
      continue;
    }

    const rawScore = col.scoreType ? row[col.scoreType] : "";
    const alanKey = scoreTypeToAlanKey(rawScore);
    const scoreTypeOut = scoreTypeLabelForRow(rawScore, alanKey);
    let tyt = col.targetTyt ? parseNumber(row[col.targetTyt]) : NaN;
    let ayt = col.targetAyt ? parseNumber(row[col.targetAyt]) : NaN;
    if (isNaN(tyt)) tyt = 0;
    if (isNaN(ayt)) ayt = 0;
    tyt = clampTyt(tyt);
    ayt = clampAyt(ayt, alanKey);

    const rowsJson = buildRowsJson(alanKey, tyt, ayt);

    const shortUni = uName.length > 40 ? uName.slice(0, 37) + "…" : uName;
    const shortProg = pName.length > 50 ? pName.slice(0, 47) + "…" : pName;
    console.log(progress + " Yükleniyor: " + shortUni + " - " + shortProg);

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
      errors++;
      console.error("Programs satır hatası:", e.message || e, "| " + progress);
    }
    await sleep(RATE_MS);
  }

  console.log(
    "\n✅ Bitti. Programs oluşturulan: " +
      created +
      " / " +
      programTotal +
      " | Boş/atık satır: " +
      skippedEmpty +
      " | Map yok atlanan: " +
      skippedNoUniId +
      " | API hata: " +
      errors
  );
}

main().catch(function (e) {
  console.error("FATAL:", e.message || e);
  process.exit(1);
});
