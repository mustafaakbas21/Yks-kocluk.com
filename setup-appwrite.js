#!/usr/bin/env node
"use strict";

/**
 * Appwrite veritabanı şeması — Lessons, Topics, Exams, ExamResults, Universities, Programs + indeksler.
 *
 * Çalıştırma:
 *   cd proje-kökü
 *   npm install node-appwrite
 *   node setup-appwrite.js
 *
 * Node 20.6+ ile .env otomatik yükleme:
 *   node --env-file=.env setup-appwrite.js
 *
 * Universities / Programs (katalog):
 *   - Universities: uniName (string 255, zorunlu), koleksiyon izni read(Role.any()).
 *   - Programs: uniId, programName, scoreType (50), targetTytNet/targetAytNet (opsiyonel float),
 *     alanKey (opsiyonel), rowsJson (text, zorunlu), read(Role.any()).
 *
 * Gerekli .env anahtarları:
 *   APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID=...
 *   APPWRITE_API_KEY=...   (API Keys → Scopes: databases.write vb.)
 *   APPWRITE_DATABASE_ID=...  (opsiyonel; yoksa aşağıdaki varsayılan)
 */

const fs = require("fs");
const path = require("path");

try {
  require("dotenv").config();
} catch (_) {
  /* dotenv yoksa aşağıdaki loadEnvFromFile yeterli */
}

/** Basit .env yükleyici (dotenv olmadan) */
function loadEnvFromFile() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  const raw = fs.readFileSync(envPath, "utf8");
  raw.split("\n").forEach(function (line) {
    var t = line.trim();
    if (!t || t.charAt(0) === "#") return;
    var eq = t.indexOf("=");
    if (eq === -1) return;
    var key = t.slice(0, eq).trim();
    var val = t.slice(eq + 1).trim();
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

const { Client, Databases, Permission, Role, IndexType } = require("node-appwrite");

// ——— Ortam ———
const APPWRITE_ENDPOINT = (process.env.APPWRITE_ENDPOINT || "").replace(/\/$/, "");
const APPWRITE_PROJECT_ID = process.env.APPWRITE_PROJECT_ID || "";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";

/** Mevcut projedeki veritabanı kimliği ile uyumlu olabilir */
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || "derece_panel";
const DATABASE_NAME = process.env.APPWRITE_DATABASE_NAME || "Derece Panel";

/** Koleksiyon kimlikleri (Console’daki Collection ID ile birebir) */
const COLLECTION_LESSONS_ID = process.env.APPWRITE_COLLECTION_LESSONS || "Lessons";
const COLLECTION_TOPICS_ID = process.env.APPWRITE_COLLECTION_TOPICS || "Topics";
const COLLECTION_EXAMS_ID = process.env.APPWRITE_COLLECTION_EXAMS || "Exams";
const COLLECTION_EXAM_RESULTS_ID = process.env.APPWRITE_COLLECTION_EXAM_RESULTS || "ExamResults";
const COLLECTION_UNIVERSITIES_ID = process.env.APPWRITE_COLLECTION_UNIVERSITIES || "Universities";
const COLLECTION_PROGRAMS_ID = process.env.APPWRITE_COLLECTION_PROGRAMS || "Programs";

const COLLECTION_LESSONS_NAME = "Dersler";
const COLLECTION_TOPICS_NAME = "Konular";
const COLLECTION_EXAMS_NAME = "Denemeler";
const COLLECTION_EXAM_RESULTS_NAME = "Deneme Sonuçları (Optik)";
const COLLECTION_UNIVERSITIES_NAME = "Üniversiteler (Net Sihirbazı V2)";
const COLLECTION_PROGRAMS_NAME = "Programlar / Bölümler (Net Sihirbazı V2)";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function log(msg) {
  console.log(msg);
}

function isNotFound(err) {
  var c = err && err.code;
  return c === 404 || String(c) === "404";
}

function isConflict(err) {
  var c = err && err.code;
  return c === 409 || String(c) === "409";
}

/** Oturumlu kullanıcılar: okuma/yazma (gerekirse Role.any() ile değiştirilebilir) */
function defaultCollectionPermissions() {
  return [
    Permission.read(Role.users()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ];
}

/**
 * Üniversite / program kataloğu: herkes okuyabilsin (öğrenci paneli); yazma oturumlu kullanıcı + API key.
 */
function catalogCollectionPermissions() {
  return [
    Permission.read(Role.any()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ];
}

async function waitForIndex(databases, databaseId, collectionId, indexKey, maxAttempts) {
  maxAttempts = maxAttempts || 60;
  for (var i = 0; i < maxAttempts; i++) {
    var idx = await databases.getIndex({
      databaseId: databaseId,
      collectionId: collectionId,
      key: indexKey,
    });
    var st = (idx && idx.status) || "";
    if (st === "available") return;
    if (st === "failed") {
      throw new Error("Index '" + indexKey + "' oluşturma başarısız (failed).");
    }
    await sleep(1500);
  }
  throw new Error("Index '" + indexKey + "' zaman aşımı (available olmadı).");
}

async function ensureKeyIndex(databases, collectionId, indexKey, attributes, orders) {
  log("⏳ Index '" + indexKey + "' oluşturuluyor… (" + collectionId + ")");
  try {
    await databases.createIndex({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: indexKey,
      type: IndexType.Key,
      attributes: attributes,
      orders: orders,
    });
  } catch (e) {
    if (isConflict(e)) {
      log("   ℹ️  Index '" + indexKey + "' zaten vardı; durumu bekleniyor.");
    } else {
      throw e;
    }
  }
  await waitForIndex(databases, DATABASE_ID, collectionId, indexKey);
  log("✅ Index '" + indexKey + "' kullanılabilir (" + collectionId + ")");
}

async function waitForAttribute(databases, databaseId, collectionId, key, maxAttempts) {
  maxAttempts = maxAttempts || 45;
  for (var i = 0; i < maxAttempts; i++) {
    var attr = await databases.getAttribute({ databaseId: databaseId, collectionId: collectionId, key: key });
    var st = (attr && attr.status) || "";
    if (st === "available") return;
    if (st === "failed") {
      throw new Error("Attribute '" + key + "' oluşturma başarısız (failed).");
    }
    await sleep(1500);
  }
  throw new Error("Attribute '" + key + "' zaman aşımı (available olmadı).");
}

async function ensureDatabase(databases) {
  try {
    await databases.get({ databaseId: DATABASE_ID });
    log("   ℹ️  Veritabanı zaten var: " + DATABASE_ID);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    log("⏳ Veritabanı oluşturuluyor: " + DATABASE_ID + " …");
    await databases.create({
      databaseId: DATABASE_ID,
      name: DATABASE_NAME,
      enabled: true,
    });
    log("✅ Veritabanı oluşturuldu: " + DATABASE_ID);
  }
}

async function ensureCollection(databases, collectionId, displayName) {
  try {
    await databases.getCollection({ databaseId: DATABASE_ID, collectionId: collectionId });
    log("   ℹ️  Koleksiyon zaten var: " + collectionId);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    log("⏳ Koleksiyon oluşturuluyor: " + collectionId + " …");
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      name: displayName,
      permissions: defaultCollectionPermissions(),
      documentSecurity: false,
      enabled: true,
    });
    log("✅ " + collectionId + " koleksiyonu oluşturuldu");
  }
}

/** Universities / Programs — koleksiyon izinleri read(Role.any()) içerir; mevcutsa PUT ile güncellenir. */
async function ensureCatalogCollection(databases, collectionId, displayName) {
  try {
    await databases.getCollection({ databaseId: DATABASE_ID, collectionId: collectionId });
    log("   ℹ️  Koleksiyon zaten var: " + collectionId + " — izinler güncelleniyor (read: any)…");
    await databases.updateCollection({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      name: displayName,
      permissions: catalogCollectionPermissions(),
      documentSecurity: false,
      enabled: true,
    });
    return;
  } catch (e) {
    if (!isNotFound(e)) throw e;
  }
  log("⏳ Koleksiyon oluşturuluyor: " + collectionId + " (read: any) …");
  await databases.createCollection({
    databaseId: DATABASE_ID,
    collectionId: collectionId,
    name: displayName,
    permissions: catalogCollectionPermissions(),
    documentSecurity: false,
    enabled: true,
  });
  log("✅ " + collectionId + " oluşturuldu");
}

async function createStringAttr(databases, collectionId, key, size, required) {
  log("⏳ " + key + " sütunu ekleniyor… (" + collectionId + ")");
  try {
    await databases.createStringAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      size: size,
      required: required,
      array: false,
    });
  } catch (e) {
    if (isConflict(e)) {
      log("   ℹ️  '" + key + "' zaten tanımlı, atlanıyor.");
      return;
    }
    throw e;
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " eklendi (" + collectionId + ")");
}

async function createDatetimeAttr(databases, collectionId, key, required) {
  log("⏳ " + key + " sütunu ekleniyor… (" + collectionId + ")");
  try {
    await databases.createDatetimeAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
      array: false,
    });
  } catch (e) {
    if (isConflict(e)) {
      log("   ℹ️  '" + key + "' zaten tanımlı, atlanıyor.");
      return;
    }
    throw e;
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " eklendi (" + collectionId + ")");
}

async function createFloatAttr(databases, collectionId, key, required) {
  log("⏳ " + key + " (float) ekleniyor… (" + collectionId + ")");
  try {
    await databases.createFloatAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
      min: -1e12,
      max: 1e12,
      array: false,
    });
  } catch (e) {
    if (isConflict(e)) {
      log("   ℹ️  '" + key + "' zaten tanımlı, atlanıyor.");
      return;
    }
    throw e;
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " eklendi (" + collectionId + ")");
}

async function createTextAttr(databases, collectionId, key, required) {
  log("⏳ " + key + " (text) ekleniyor… (" + collectionId + ")");
  try {
    await databases.createTextAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
      array: false,
    });
  } catch (e) {
    if (isConflict(e)) {
      log("   ℹ️  '" + key + "' zaten tanımlı, atlanıyor.");
      return;
    }
    throw e;
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " eklendi (" + collectionId + ")");
}

async function main() {
  log("");
  log("╔══════════════════════════════════════════════════════════╗");
  log("║       Appwrite şema kurulumu — setup-appwrite.js         ║");
  log("╚══════════════════════════════════════════════════════════╝");
  log("");

  if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
    console.error("❌ Eksik ortam: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID ve APPWRITE_API_KEY .env içinde tanımlı olmalı.");
    process.exit(1);
  }

  var client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);

  var databases = new Databases(client);

  log("📌 Endpoint:     " + APPWRITE_ENDPOINT);
  log("📌 Project ID:   " + APPWRITE_PROJECT_ID);
  log("📌 Database ID:  " + DATABASE_ID);
  log("📌 Lessons ID:   " + COLLECTION_LESSONS_ID);
  log("📌 Topics ID:    " + COLLECTION_TOPICS_ID);
  log("📌 Exams ID:     " + COLLECTION_EXAMS_ID);
  log("📌 ExamResults:  " + COLLECTION_EXAM_RESULTS_ID);
  log("📌 Universities: " + COLLECTION_UNIVERSITIES_ID);
  log("📌 Programs:     " + COLLECTION_PROGRAMS_ID);
  log("");

  await ensureDatabase(databases);

  await ensureCollection(databases, COLLECTION_LESSONS_ID, COLLECTION_LESSONS_NAME);
  await ensureCollection(databases, COLLECTION_TOPICS_ID, COLLECTION_TOPICS_NAME);
  await ensureCollection(databases, COLLECTION_EXAMS_ID, COLLECTION_EXAMS_NAME);
  await ensureCollection(databases, COLLECTION_EXAM_RESULTS_ID, COLLECTION_EXAM_RESULTS_NAME);
  await ensureCatalogCollection(databases, COLLECTION_UNIVERSITIES_ID, COLLECTION_UNIVERSITIES_NAME);
  await ensureCatalogCollection(databases, COLLECTION_PROGRAMS_ID, COLLECTION_PROGRAMS_NAME);

  log("");
  log("——— Lessons attribute'ları ———");
  await createStringAttr(databases, COLLECTION_LESSONS_ID, "lessonName", 255, true);

  log("");
  log("——— Topics attribute'ları ———");
  await createStringAttr(databases, COLLECTION_TOPICS_ID, "lessonId", 255, true);
  await createStringAttr(databases, COLLECTION_TOPICS_ID, "topicName", 512, true);

  log("");
  log("——— Exams attribute'ları ———");
  await createStringAttr(databases, COLLECTION_EXAMS_ID, "examName", 512, true);
  await createDatetimeAttr(databases, COLLECTION_EXAMS_ID, "date", true);
  await createStringAttr(databases, COLLECTION_EXAMS_ID, "type", 128, true);
  await createStringAttr(databases, COLLECTION_EXAMS_ID, "status", 128, true);
  await createStringAttr(databases, COLLECTION_EXAMS_ID, "answerKey", 100000, true);
  await createStringAttr(databases, COLLECTION_EXAMS_ID, "coach_id", 128, false);

  log("");
  log("——— ExamResults attribute'ları ———");
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "exam_id", 255, true);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "coach_id", 128, false);
  /** Karne trend etiketi — Exams join olmadan UI’da kullanılır */
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "exam_name", 512, false);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "detail_json", 200000, true);
  /** Karne trend tarih etiketi — Exams zorunlu değil */
  await createDatetimeAttr(databases, COLLECTION_EXAM_RESULTS_ID, "saved_at", true);

  log("");
  log("——— ExamResults indeksleri (Karne / Akıllı Optik sorguları) ———");
  await ensureKeyIndex(
    databases,
    COLLECTION_EXAM_RESULTS_ID,
    "idx_er_student_saved_at",
    ["student_id", "saved_at"],
    ["ASC", "DESC"]
  );
  await ensureKeyIndex(
    databases,
    COLLECTION_EXAM_RESULTS_ID,
    "idx_er_coach_student_saved_at",
    ["coach_id", "student_id", "saved_at"],
    ["ASC", "ASC", "DESC"]
  );

  log("");
  log("——— Universities attribute'ları (frontend: uniName) ———");
  await createStringAttr(databases, COLLECTION_UNIVERSITIES_ID, "uniName", 255, true);

  log("");
  log("——— Programs attribute'ları ———");
  await createStringAttr(databases, COLLECTION_PROGRAMS_ID, "uniId", 255, true);
  await createStringAttr(databases, COLLECTION_PROGRAMS_ID, "programName", 255, true);
  await createStringAttr(databases, COLLECTION_PROGRAMS_ID, "scoreType", 50, true);
  await createFloatAttr(databases, COLLECTION_PROGRAMS_ID, "targetTytNet", false);
  await createFloatAttr(databases, COLLECTION_PROGRAMS_ID, "targetAytNet", false);
  await createStringAttr(databases, COLLECTION_PROGRAMS_ID, "alanKey", 50, false);
  await createTextAttr(databases, COLLECTION_PROGRAMS_ID, "rowsJson", true);

  log("");
  log("——— Programs indeksi (uniId) ———");
  await ensureKeyIndex(databases, COLLECTION_PROGRAMS_ID, "idx_prog_uniId", ["uniId"], ["ASC"]);

  log("");
  log("🎉 Kurulum tamamlandı. Appwrite Console → Databases → " + DATABASE_ID + " kontrol edin.");
  log("");
  log("Patron, tablolar ve sütunlar Appwrite'a hatasız eklendi.");
}

main().catch(function (err) {
  console.error("❌ Hata:", err && err.message ? err.message : err);
  if (err && err.response) console.error(err.response);
  process.exit(1);
});
