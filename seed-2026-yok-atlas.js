#!/usr/bin/env node
"use strict";

/**
 * Net Sihirbazı V2 — 2026 tahmini tohum veri (GERÇEK üniversite ve bölüm adları).
 * Appwrite: Universities + Programs koleksiyonlarını temizler, ilişkisel uniId ile yeniden doldurur.
 *
 * Önkoşul: node setup-appwrite.js (Universities / Programs şeması + idx_prog_uniId)
 *
 * Çalıştırma:
 *   node --env-file=.env seed-2026-yok-atlas.js
 *   veya dotenv yüklü: node seed-2026-yok-atlas.js
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

const { Client, Databases, Query } = require("node-appwrite");

const APPWRITE_ENDPOINT = String(process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || "derece_panel";
const COL_UNI = process.env.APPWRITE_COLLECTION_UNIVERSITIES || "Universities";
const COL_PROG = process.env.APPWRITE_COLLECTION_PROGRAMS || "Programs";

const RATE_MS = 150;

function sleep(ms) {
  return new Promise(function (r) {
    setTimeout(r, ms);
  });
}

function log() {
  console.log.apply(console, arguments);
}

/**
 * Türkiye'deki seçkin 15 üniversite (gerçek kurum adları). tier: 1 = en seçkin dilim,
 * 2 = ara, 3 = geniş grup — yalnızca hedef net çarpanı için (resmî sıralama iddiası yok).
 */
const SEED_UNIVERSITIES = [
  { id: "u_bogazici", name: "Boğaziçi Üniversitesi", tier: 1 },
  { id: "u_odtu", name: "Orta Doğu Teknik Üniversitesi", tier: 1 },
  { id: "u_itu", name: "İstanbul Teknik Üniversitesi", tier: 1 },
  { id: "u_bilkent", name: "Bilkent Üniversitesi", tier: 1 },
  { id: "u_koc", name: "Koç Üniversitesi", tier: 1 },
  { id: "u_hacettepe", name: "Hacettepe Üniversitesi", tier: 2 },
  { id: "u_gsu", name: "Galatasaray Üniversitesi", tier: 2 },
  { id: "u_ankara", name: "Ankara Üniversitesi", tier: 2 },
  { id: "u_ege", name: "Ege Üniversitesi", tier: 2 },
  { id: "u_yildiz", name: "Yıldız Teknik Üniversitesi", tier: 2 },
  { id: "u_istanbul", name: "İstanbul Üniversitesi", tier: 3 },
  { id: "u_akdeniz", name: "Akdeniz Üniversitesi", tier: 3 },
  { id: "u_gazi", name: "Gazi Üniversitesi", tier: 3 },
  { id: "u_dokuzeylul", name: "Dokuz Eylül Üniversitesi", tier: 3 },
  { id: "u_marmara", name: "Marmara Üniversitesi", tier: 3 },
];

/**
 * Popüler 20 bölüm/fakülte (gerçek adlar). refTyt/refAyt: tier-2 referans tahmini 2026 çalışma profili (üst sınırlara yakın değil, yerleşim göstergesi değildir).
 * alanKey: sayisal | esit_agirlik | sozel | dil
 */
const SEED_PROGRAM_BLUEPRINTS = [
  { slug: "tip", name: "Tıp Fakültesi", alanKey: "sayisal", refTyt: 112.5, refAyt: 69.2 },
  { slug: "dis", name: "Diş Hekimliği Fakültesi", alanKey: "sayisal", refTyt: 111.8, refAyt: 66.5 },
  { slug: "hukuk", name: "Hukuk Fakültesi", alanKey: "esit_agirlik", refTyt: 105.2, refAyt: 41.8 },
  { slug: "bilgisayar", name: "Bilgisayar Mühendisliği", alanKey: "sayisal", refTyt: 108.4, refAyt: 54.6 },
  { slug: "elektrik", alanKey: "sayisal", name: "Elektrik-Elektronik Mühendisliği", refTyt: 107.9, refAyt: 53.1 },
  { slug: "endustri", name: "Endüstri Mühendisliği", alanKey: "sayisal", refTyt: 107.2, refAyt: 51.8 },
  { slug: "makine", name: "Makine Mühendisliği", alanKey: "sayisal", refTyt: 106.5, refAyt: 50.4 },
  { slug: "insaat", name: "İnşaat Mühendisliği", alanKey: "sayisal", refTyt: 105.8, refAyt: 48.9 },
  { slug: "isletme", name: "İşletme", alanKey: "esit_agirlik", refTyt: 102.6, refAyt: 43.2 },
  { slug: "ekonomi", name: "İktisat / Ekonomi", alanKey: "esit_agirlik", refTyt: 103.1, refAyt: 44.5 },
  { slug: "kiy", name: "Kamu Yönetimi", alanKey: "esit_agirlik", refTyt: 101.4, refAyt: 40.6 },
  { slug: "psikoloji", name: "Psikoloji", alanKey: "sozel", refTyt: 104.8, refAyt: 48.2 },
  { slug: "sinif_ogrt", name: "Sınıf Öğretmenliği", alanKey: "esit_agirlik", refTyt: 100.2, refAyt: 38.7 },
  { slug: "hemsirelik", name: "Hemşirelik Fakültesi", alanKey: "sayisal", refTyt: 103.5, refAyt: 46.3 },
  { slug: "eczacilik", name: "Eczacılık Fakültesi", alanKey: "sayisal", refTyt: 109.1, refAyt: 57.4 },
  { slug: "mimarlik", name: "Mimarlık", alanKey: "sayisal", refTyt: 106.0, refAyt: 49.8 },
  { slug: "sbp", name: "Şehir ve Bölge Planlama", alanKey: "sayisal", refTyt: 104.2, refAyt: 47.1 },
  { slug: "ingedeb", name: "İngiliz Dili ve Edebiyatı", alanKey: "dil", refTyt: 99.8, refAyt: 62.4 },
  { slug: "ulinter", name: "Uluslararası İlişkiler", alanKey: "esit_agirlik", refTyt: 102.9, refAyt: 42.3 },
  { slug: "otomotiv", name: "Otomotiv Mühendisliği", alanKey: "sayisal", refTyt: 105.5, refAyt: 49.5 },
];

function tierFactor(tier) {
  if (tier <= 1) return 1.014;
  if (tier === 2) return 1;
  return 0.984;
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

/** Appwrite Programs.scoreType (SAY / EA / SÖZ / DİL) */
function scoreTypeLabelFromAlanKey(alanKey) {
  const k = String(alanKey || "").toLowerCase();
  if (k === "dil") return "DİL";
  if (k === "sozel") return "SÖZ";
  if (k === "esit_agirlik") return "EA";
  return "SAY";
}

/** Tüm üniversite × bölüm çiftleri için program kayıtları üretir */
function expandSeedRows() {
  const out = [];
  SEED_UNIVERSITIES.forEach(function (uni) {
    const f = tierFactor(uni.tier);
    SEED_PROGRAM_BLUEPRINTS.forEach(function (bp) {
      const tyt = clampTyt(bp.refTyt * f);
      const ayt = clampAyt(bp.refAyt * f, bp.alanKey);
      out.push({
        docId: uni.id + "__" + bp.slug,
        uniId: uni.id,
        name: bp.name,
        alanKey: bp.alanKey,
        targetTytNet: tyt,
        targetAytNet: ayt,
        rowsJson: buildRowsJson(bp.alanKey, tyt, ayt),
      });
    });
  });
  return out;
}

const SEED_PROGRAM_ROWS = expandSeedRows();

async function purgeCollection(databases, collectionId) {
  log("… Purge:", collectionId);
  for (;;) {
    const res = await databases.listDocuments({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      queries: [Query.limit(100)],
    });
    const docs = res.documents || [];
    if (docs.length === 0) break;
    for (let i = 0; i < docs.length; i++) {
      await databases.deleteDocument({
        databaseId: DATABASE_ID,
        collectionId: collectionId,
        documentId: docs[i].$id,
      });
      await sleep(RATE_MS);
    }
  }
  log("   ✓ Purge bitti:", collectionId);
}

async function main() {
  if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
    console.error("APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID ve APPWRITE_API_KEY gerekli (.env).");
    process.exit(1);
  }

  const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY);
  const databases = new Databases(client);

  log("══════════════════════════════════════════════════════");
  log(" seed-2026-yok-atlas — Universities / Programs");
  log(" DB:", DATABASE_ID, "| rate:", RATE_MS, "ms");
  log("══════════════════════════════════════════════════════");

  try {
    await purgeCollection(databases, COL_PROG);
    await purgeCollection(databases, COL_UNI);

    log("\n… Universities oluşturuluyor (" + SEED_UNIVERSITIES.length + ")");
    for (let i = 0; i < SEED_UNIVERSITIES.length; i++) {
      const u = SEED_UNIVERSITIES[i];
      await databases.createDocument({
        databaseId: DATABASE_ID,
        collectionId: COL_UNI,
        documentId: u.id,
        data: { uniName: u.name },
        permissions: [],
      });
      await sleep(RATE_MS);
    }
    log("   ✓ Universities tamam");

    log("\n… Programs oluşturuluyor (" + SEED_PROGRAM_ROWS.length + ")");
    for (let j = 0; j < SEED_PROGRAM_ROWS.length; j++) {
      const p = SEED_PROGRAM_ROWS[j];
      await databases.createDocument({
        databaseId: DATABASE_ID,
        collectionId: COL_PROG,
        documentId: p.docId,
        data: {
          uniId: p.uniId,
          programName: p.programName,
          scoreType: p.scoreType,
          targetTytNet: p.targetTytNet,
          targetAytNet: p.targetAytNet,
          alanKey: p.alanKey,
          rowsJson: p.rowsJson,
        },
        permissions: [],
      });
      await sleep(RATE_MS);
      if ((j + 1) % 50 === 0) log("   …", j + 1, "/", SEED_PROGRAM_ROWS.length);
    }
    log("\n✅ Tohum veri yazıldı. Üniversite:", SEED_UNIVERSITIES.length, "Program:", SEED_PROGRAM_ROWS.length);
  } catch (e) {
    console.error("❌", e && e.message ? e.message : e);
    if (e && e.response) console.error(JSON.stringify(e.response, null, 2));
    process.exit(1);
  }
}

main();
