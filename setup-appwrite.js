#!/usr/bin/env node
"use strict";

/**
 * Appwrite veritabanı şeması — Lessons, Topics, Exams, ExamResults, platform koleksiyonları, Storage kovaları.
 * Üniversite/bölüm kataloğu: `src/data/yks-data.json` (statik; Appwrite’ta Universities/Programs yok).
 *
 * Çalıştırma:
 *   cd proje-kökü
 *   npm install node-appwrite
 *   node setup-appwrite.js
 *   node setup-appwrite.js --only-deneme   → Yalnızca Lessons, Topics, Exams, ExamResults (üniversite şemasına dokunmaz)
 *   node setup-appwrite.js --only-exam-results → Yalnızca ExamResults (+ indeksler); `setup-exam-results.js` bunu çağırır
 *   node setup-appwrite.js --seed → Kurulum sonunda Lessons/Topics boşsa örnek ders+konu ekler
 *
 * Ortam: `setup-appwrite.js` ile aynı klasörde `.env` (`.env.example` şablonu).
 *   npm install
 *   node setup-appwrite.js --only-deneme
 *   veya: npm run setup:deneme
 * Node’un `--env-file` bayrağı gerekmez; `.env` dotenv veya yerleşik parser ile okunur.
 *
 * Gerekli .env anahtarları:
 *   APPWRITE_ENDPOINT=https://cloud.appwrite.io/v1
 *   APPWRITE_PROJECT_ID=...
 *   APPWRITE_API_KEY=...   (API Keys → Scopes: databases.write vb.)
 *   APPWRITE_DATABASE_ID=...  (opsiyonel; yoksa aşağıdaki varsayılan)
 *   APPWRITE_ATTR_MAX_ATTEMPTS — attribute/index available bekleme denemesi (varsayılan 150)
 *   APPWRITE_ATTR_POLL_MS — denemeler arası ms (varsayılan 2000; bulut yavaşsa 3000 deneyin)
 *
 * String attribute boyutları: Appwrite planında attribute sayısı / toplam boyut sınırına takılmamak için
 * gereksiz yüksek size kullanılmaz (ör. 65k). Kısa ID/isim: 255, kısa metin: ~1000, JSON: 3000–5000,
 * uzun URL: ~2048. Gerekirse Console’da tek tek artırılabilir.
 */

const fs = require("fs");
const path = require("path");

/**
 * `.env` yükleme — Node `--env-file` gerektirmez.
 * Önce `dotenv` (npm install dotenv); yoksa veya hata verirse satır satır parser.
 */
function loadProjectEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;

  var usedDotenv = false;
  try {
    var dotenv = require("dotenv");
    var out = dotenv.config({ path: envPath, override: true });
    usedDotenv = !out.error;
  } catch (_) {
    /* dotenv paketi yok */
  }

  if (usedDotenv) return;

  const raw = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
  raw.split(/\r?\n/).forEach(function (line) {
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
    if (val.length) process.env[key] = val;
  });
}

loadProjectEnv();

const { Client, Databases, Storage, Permission, Role, IndexType, Query, ID } = require("node-appwrite");

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

// ——— Ortam ———
const APPWRITE_ENDPOINT = (
  trimEnv("APPWRITE_ENDPOINT") || "https://cloud.appwrite.io/v1"
).replace(/\/$/, "");
const APPWRITE_PROJECT_ID = trimEnv("APPWRITE_PROJECT_ID");
const APPWRITE_API_KEY = trimEnv("APPWRITE_API_KEY");

/** Mevcut projedeki veritabanı kimliği ile uyumlu olabilir */
const DATABASE_ID = trimEnv("APPWRITE_DATABASE_ID") || "derece_panel";
const DATABASE_NAME = trimEnv("APPWRITE_DATABASE_NAME") || "Derece Panel";

/** Koleksiyon kimlikleri (Console’daki Collection ID ile birebir) */
const COLLECTION_LESSONS_ID = process.env.APPWRITE_COLLECTION_LESSONS || "Lessons";
const COLLECTION_TOPICS_ID = process.env.APPWRITE_COLLECTION_TOPICS || "Topics";
const COLLECTION_EXAMS_ID = process.env.APPWRITE_COLLECTION_EXAMS || "Exams";
const COLLECTION_EXAM_RESULTS_ID = process.env.APPWRITE_COLLECTION_EXAM_RESULTS || "ExamResults";
const COLLECTION_STUDENTS_ID = process.env.APPWRITE_COLLECTION_STUDENTS || "students";

/** Koç paneli / login — `js/appwrite-config.js` ve `koc-panel.js` ile aynı ID’ler */
const COLLECTION_USERS_ID = "users";
const COLLECTION_COACHES_ID = "coaches";
const COLLECTION_EXAMS_LEGACY_ID = "exams";
const COLLECTION_APPOINTMENTS_ID = "appointments";
const COLLECTION_TESTS_ID = "tests";
const COLLECTION_PAYMENTS_ID = "payments";
const COLLECTION_COACH_TASKS_ID = "coach_tasks";
const COLLECTION_MEETING_LOGS_ID = "meeting_logs";
const COLLECTION_KAYNAKLAR_ID = "kaynaklar";
const COLLECTION_QUOTE_REQUESTS_ID = process.env.APPWRITE_COLLECTION_QUOTE_REQUESTS || "quoteRequests";
const COLLECTION_COACH_LOGIN_LOG_ID = "coachLoginLog";
const COLLECTION_SORU_HAVUZU_ID = process.env.APPWRITE_COLLECTION_SORU_HAVUZU || "soru_havuzu";
const COLLECTION_HATA_BILDIRIMLERI_ID = process.env.APPWRITE_COLLECTION_HATA_BILDIRIMLERI || "hata_bildirimleri";
const COLLECTION_ATANAN_KAYNAKLAR_ID = process.env.APPWRITE_COLLECTION_ATANAN_KAYNAKLAR || "atanan_kaynaklar";
const COLLECTION_MR_STUDENT_PROFILES_ID = process.env.APPWRITE_COLLECTION_MR_PROFILES || "mr_student_profiles";
const COLLECTION_GLOBAL_DENEMELER_ID = process.env.APPWRITE_COLLECTION_GLOBAL_DENEMELER || "global_denemeler";
const COLLECTION_YKS_NET_TARGETS_ID = process.env.APPWRITE_COLLECTION_YKS_NET_TARGETS || "yks_net_sihirbazi_targets";
const COLLECTION_STUDENT_PORTAL_PLANS_ID = "studentPortalPlans";
const COLLECTION_SETTINGS_ID = "settings";

const COLLECTION_LESSONS_NAME = "Dersler";
const COLLECTION_TOPICS_NAME = "Konular";
const COLLECTION_EXAMS_NAME = "Denemeler";
const COLLECTION_EXAM_RESULTS_NAME = "Deneme Sonuçları (Optik)";
const COLLECTION_STUDENTS_NAME = "Öğrenciler";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Appwrite Cloud’da attribute bazen 2–5 dk “processing” kalabilir */
const ATTR_POLL_MS = Math.max(500, parseInt(process.env.APPWRITE_ATTR_POLL_MS || "2000", 10) || 2000);
const ATTR_MAX_ATTEMPTS = Math.max(20, parseInt(process.env.APPWRITE_ATTR_MAX_ATTEMPTS || "150", 10) || 150);
const INDEX_POLL_MS = Math.max(500, parseInt(process.env.APPWRITE_INDEX_POLL_MS || String(ATTR_POLL_MS), 10) || ATTR_POLL_MS);
const INDEX_MAX_ATTEMPTS = Math.max(20, parseInt(process.env.APPWRITE_INDEX_MAX_ATTEMPTS || "120", 10) || 120);

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

function isAttributeLimitExceeded(err) {
  if (!err) return false;
  if (err.type === "attribute_limit_exceeded") return true;
  var m = String(err.message || "");
  return m.indexOf("attribute_limit") !== -1 || m.indexOf("maximum number") !== -1;
}

function isAuthScopeError(err) {
  var c = Number(err && err.code);
  if (c === 401 || c === 403) return true;
  var m = String((err && err.message) || "").toLowerCase();
  return (
    m.indexOf("unauthorized") !== -1 ||
    m.indexOf("access denied") !== -1 ||
    m.indexOf("not authorized") !== -1 ||
    m.indexOf("forbidden") !== -1 ||
    m.indexOf("user_unauthorized") !== -1
  );
}

function logAppwriteAuthHelp() {
  console.error("");
  console.error("   API Key yetkisi (Appwrite Console → Project → API Keys → anahtarınız → Scopes):");
  console.error("   • databases.read");
  console.error("   • databases.write");
  console.error("   • storage.read");
  console.error("   • storage.write");
  console.error("");
  console.error("   Sunucu (Server / Secret) anahtarı kullanın; Web / Client SDK anahtarı bu script ile çalışmaz.");
  console.error("   Project ID ile Endpoint’in (self-host ise kendi /v1 URL’niz) bu projeye ait olduğunu doğrulayın.");
  console.error("");
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

async function waitForIndex(databases, databaseId, collectionId, indexKey, maxAttempts) {
  maxAttempts = maxAttempts || INDEX_MAX_ATTEMPTS;
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
    if ((i + 1) % 15 === 0) {
      log("   … Index '" + indexKey + "' bekleniyor (" + (i + 1) + "/" + maxAttempts + ") status=" + (st || "?"));
    }
    await sleep(INDEX_POLL_MS);
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
  maxAttempts = maxAttempts || ATTR_MAX_ATTEMPTS;
  for (var i = 0; i < maxAttempts; i++) {
    var attr = await databases.getAttribute({ databaseId: databaseId, collectionId: collectionId, key: key });
    var st = (attr && attr.status) || "";
    if (st === "available") return;
    if (st === "failed") {
      throw new Error("Attribute '" + key + "' oluşturma başarısız (failed).");
    }
    if ((i + 1) % 15 === 0) {
      log(
        "   … '" +
          key +
          "' bekleniyor (" +
          (i + 1) +
          "/" +
          maxAttempts +
          ") status=" +
          (st || "?") +
          " — ~" +
          Math.round(((maxAttempts - i - 1) * ATTR_POLL_MS) / 60000) +
          " dk kaldı (üst sınır)"
      );
    }
    await sleep(ATTR_POLL_MS);
  }
  throw new Error(
    "Attribute '" +
      key +
      "' zaman aşımı (available olmadı). Appwrite Console’da Topics → lessonId durumuna bakın; " +
      "birkaç dakika sonra `node setup-appwrite.js` ile tekrar deneyin veya .env: APPWRITE_ATTR_MAX_ATTEMPTS=250 APPWRITE_ATTR_POLL_MS=3000"
  );
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

/** ExamResults: herkes okuyabilsin (öğrenci paneli / karne); yazma oturumlu kullanıcı. */
function examResultsCollectionPermissions() {
  return [
    Permission.read(Role.any()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ];
}

async function ensureCollectionPublicRead(databases, collectionId, displayName) {
  try {
    await databases.getCollection({ databaseId: DATABASE_ID, collectionId: collectionId });
    await databases.updateCollection({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      name: displayName,
      permissions: examResultsCollectionPermissions(),
      documentSecurity: false,
      enabled: true,
    });
    log("   ℹ️  ExamResults izinleri güncellendi (read: any): " + collectionId);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    log("⏳ Koleksiyon oluşturuluyor: " + collectionId + " (read: any) …");
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      name: displayName,
      permissions: examResultsCollectionPermissions(),
      documentSecurity: false,
      enabled: true,
    });
    log("✅ " + collectionId + " oluşturuldu (read: any)");
  }
}

function storageBucketPermissions() {
  return [
    Permission.read(Role.any()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ];
}

async function ensureStorageBucket(storage, bucketId, displayName) {
  try {
    await storage.getBucket(bucketId);
    await storage.updateBucket({
      bucketId: bucketId,
      name: displayName,
      permissions: storageBucketPermissions(),
      fileSecurity: false,
      enabled: true,
    });
    log("   ℹ️  Storage bucket güncellendi: " + bucketId);
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await storage.createBucket({
      bucketId: bucketId,
      name: displayName,
      permissions: storageBucketPermissions(),
      fileSecurity: false,
      enabled: true,
    });
    log("✅ Storage bucket: " + bucketId);
  }
}

async function ensurePlatformStorageBuckets(storage) {
  log("");
  log("——— Storage kovaları (okuma: herkes, yazma: oturumlu kullanıcı) ———");
  await ensureStorageBucket(storage, "soru_havuzu", "Soru havuzu");
  await ensureStorageBucket(storage, "destek_ekranlari", "Destek ekranları");
  await ensureStorageBucket(storage, "deneme_deposu", "Deneme deposu");
  await ensureStorageBucket(storage, "avatarlar", "Avatarlar");
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
    if (isAttributeLimitExceeded(e)) {
      log("   ⚠️  '" + key + "' eklenemedi (attribute kotası). Console'da " + collectionId + " koleksiyonundan gereksiz sütun silin.");
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
    if (isAttributeLimitExceeded(e)) {
      log("   ⚠️  '" + key + "' eklenemedi (attribute kotası). Console'da " + collectionId + " koleksiyonundan gereksiz sütun silin.");
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
    if (isAttributeLimitExceeded(e)) {
      log("   ⚠️  '" + key + "' eklenemedi (attribute kotası). Console'da " + collectionId + " koleksiyonundan gereksiz sütun silin.");
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
    if (isAttributeLimitExceeded(e)) {
      log("   ⚠️  '" + key + "' eklenemedi (attribute kotası). Console'da " + collectionId + " koleksiyonundan gereksiz sütun silin.");
      return;
    }
    throw e;
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " eklendi (" + collectionId + ")");
}

async function createBooleanAttr(databases, collectionId, key, required) {
  log("⏳ " + key + " (boolean) ekleniyor… (" + collectionId + ")");
  try {
    await databases.createBooleanAttribute({
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
    if (isAttributeLimitExceeded(e)) {
      log("   ⚠️  '" + key + "' eklenemedi (attribute kotası). Console'da " + collectionId + " koleksiyonundan gereksiz sütun silin.");
      return;
    }
    throw e;
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " eklendi (" + collectionId + ")");
}

async function createIntegerAttr(databases, collectionId, key, required, min, max) {
  log("⏳ " + key + " (integer) ekleniyor… (" + collectionId + ")");
  try {
    await databases.createIntegerAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
      min: min != null ? min : -2147483648,
      max: max != null ? max : 2147483647,
      array: false,
    });
  } catch (e) {
    if (isConflict(e)) {
      log("   ℹ️  '" + key + "' zaten tanımlı, atlanıyor.");
      return;
    }
    if (isAttributeLimitExceeded(e)) {
      log("   ⚠️  '" + key + "' eklenemedi (attribute kotası). Console'da " + collectionId + " koleksiyonundan gereksiz sütun silin.");
      return;
    }
    throw e;
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " eklendi (" + collectionId + ")");
}

/**
 * Koç paneli, login, vitrin — tüm `collection(db, "...")` koleksiyonları + Appwrite-config tabloları.
 * (`Exams` büyük harf = Akıllı Optik şeması; `exams` küçük = klasik deneme kayıtları.)
 */
async function ensureExtendedPlatformSchema(databases) {
  log("");
  log("——— Genişletilmiş platform koleksiyonları (users, exams, …) ———");

  await ensureCollection(databases, COLLECTION_USERS_ID, "Kullanıcılar (profil)");
  await createStringAttr(databases, COLLECTION_USERS_ID, "username", 128, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "role", 64, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "fullName", 512, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "institutionName", 512, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "packageType", 64, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "plainPassword", 512, false);
  await createBooleanAttr(databases, COLLECTION_USERS_ID, "frozen", false);
  await createDatetimeAttr(databases, COLLECTION_USERS_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_USERS_ID, "lastLogin", false);
  await createDatetimeAttr(databases, COLLECTION_USERS_ID, "lastPasswordChangeAt", false);
  await ensureKeyIndex(databases, COLLECTION_USERS_ID, "idx_users_username", ["username"], ["ASC"]);

  await ensureCollection(databases, COLLECTION_COACHES_ID, "Koçlar (legacy username)");
  await createStringAttr(databases, COLLECTION_COACHES_ID, "username", 128, false);
  await createStringAttr(databases, COLLECTION_COACHES_ID, "fullName", 512, false);
  await createStringAttr(databases, COLLECTION_COACHES_ID, "name", 512, false);

  await ensureCollection(databases, COLLECTION_EXAMS_LEGACY_ID, "Deneme kayıtları (koç paneli)");
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "studentId", 255, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "studentName", 512, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "examType", 64, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "tur", 64, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "net", 128, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "date", 64, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "examName", 512, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "subjectBreakdown", 4000, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "status", 128, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "coachExamNote", 4000, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "examDefinitionId", 255, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "scoringRule", 128, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "yksBranchDetail", 5000, false);
  await createDatetimeAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "examDate", false);
  await createDatetimeAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "updatedAt", false);
  await ensureKeyIndex(databases, COLLECTION_EXAMS_LEGACY_ID, "idx_exams_studentId", ["studentId"], ["ASC"]);

  /** Randevular — 3 attribute (plan kotası); studentId details_json içinde */
  await ensureCollection(databases, COLLECTION_APPOINTMENTS_ID, "Randevular");
  await createDatetimeAttr(databases, COLLECTION_APPOINTMENTS_ID, "scheduledAt", false);
  await createStringAttr(databases, COLLECTION_APPOINTMENTS_ID, "details_json", 3000, false);
  await createStringAttr(databases, COLLECTION_APPOINTMENTS_ID, "coach_id", 64, false);

  await ensureCollection(databases, COLLECTION_TESTS_ID, "TestMaker taslakları");
  await createStringAttr(databases, COLLECTION_TESTS_ID, "title", 512, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "subject", 256, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "topic", 512, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "difficulty", 64, false);
  await createIntegerAttr(databases, COLLECTION_TESTS_ID, "questionCount", false, 1, 500);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "layout", 128, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "layoutLabel", 256, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "fontFamily", 128, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "colorTheme", 128, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "colorThemeLabel", 256, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "module", 128, false);
  await createBooleanAttr(databases, COLLECTION_TESTS_ID, "pdfDraft", false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "status", 64, false);
  await createStringAttr(databases, COLLECTION_TESTS_ID, "coach_id", 128, false);
  await createDatetimeAttr(databases, COLLECTION_TESTS_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_TESTS_ID, "updatedAt", false);

  await ensureCollection(databases, COLLECTION_PAYMENTS_ID, "Tahsilatlar");
  await createStringAttr(databases, COLLECTION_PAYMENTS_ID, "studentId", 255, false);
  await createStringAttr(databases, COLLECTION_PAYMENTS_ID, "studentName", 512, false);
  await createFloatAttr(databases, COLLECTION_PAYMENTS_ID, "amount", false);
  await createStringAttr(databases, COLLECTION_PAYMENTS_ID, "paymentDate", 32, false);
  await createStringAttr(databases, COLLECTION_PAYMENTS_ID, "paymentMethod", 128, false);
  await createStringAttr(databases, COLLECTION_PAYMENTS_ID, "description", 2000, false);
  await createStringAttr(databases, COLLECTION_PAYMENTS_ID, "invoiceNote", 1000, false);
  await createStringAttr(databases, COLLECTION_PAYMENTS_ID, "coach_id", 128, false);
  await createDatetimeAttr(databases, COLLECTION_PAYMENTS_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_PAYMENTS_ID, "updatedAt", false);

  await ensureCollection(databases, COLLECTION_COACH_TASKS_ID, "Koç görevleri");
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "title", 512, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "description", 3000, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "studentId", 255, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "studentName", 512, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "dueDate", 64, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "priority", 64, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "subject", 256, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "column", 32, false);
  await createStringAttr(databases, COLLECTION_COACH_TASKS_ID, "coach_id", 128, false);
  await createDatetimeAttr(databases, COLLECTION_COACH_TASKS_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_COACH_TASKS_ID, "updatedAt", false);

  await ensureCollection(databases, COLLECTION_MEETING_LOGS_ID, "Görüşme notları");
  await createStringAttr(databases, COLLECTION_MEETING_LOGS_ID, "coach_id", 128, true);
  await createStringAttr(databases, COLLECTION_MEETING_LOGS_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_MEETING_LOGS_ID, "student_name", 512, false);
  await createTextAttr(databases, COLLECTION_MEETING_LOGS_ID, "body_html", false);
  await createDatetimeAttr(databases, COLLECTION_MEETING_LOGS_ID, "saved_at", true);
  await ensureKeyIndex(databases, COLLECTION_MEETING_LOGS_ID, "idx_meeting_student", ["student_id"], ["ASC"]);

  await ensureCollection(databases, COLLECTION_KAYNAKLAR_ID, "Kütüphane kaynakları");
  await createStringAttr(databases, COLLECTION_KAYNAKLAR_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_KAYNAKLAR_ID, "title", 512, false);
  await createStringAttr(databases, COLLECTION_KAYNAKLAR_ID, "subject", 256, false);
  await createIntegerAttr(databases, COLLECTION_KAYNAKLAR_ID, "totalPages", false, 1, 100000);
  await createStringAttr(databases, COLLECTION_KAYNAKLAR_ID, "publisher", 256, false);

  await ensureCollection(databases, COLLECTION_QUOTE_REQUESTS_ID, "Vitrin teklif talepleri");
  await createStringAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "packageName", 256, false);
  await createStringAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "institutionName", 256, false);
  await createStringAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "contactName", 200, false);
  await createStringAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "email", 256, false);
  await createStringAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "phone", 64, false);
  await createStringAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "message", 3000, false);
  await createStringAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "status", 64, false);
  await createDatetimeAttr(databases, COLLECTION_QUOTE_REQUESTS_ID, "createdAt", false);

  await ensureCollection(databases, COLLECTION_COACH_LOGIN_LOG_ID, "Koç giriş logu");
  await createStringAttr(databases, COLLECTION_COACH_LOGIN_LOG_ID, "coachId", 128, false);
  await createStringAttr(databases, COLLECTION_COACH_LOGIN_LOG_ID, "username", 128, false);
  await createDatetimeAttr(databases, COLLECTION_COACH_LOGIN_LOG_ID, "at", false);

  await ensureCollection(databases, COLLECTION_SORU_HAVUZU_ID, "Soru havuzu");
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "coach_id", 256, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "image_url", 2048, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "ders", 512, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "konu", 512, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "zorluk", 128, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "sinav", 128, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "source", 64, false);
  await createBooleanAttr(databases, COLLECTION_SORU_HAVUZU_ID, "cozuldu", false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "storage_file_id", 512, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "soru_resim_id", 512, false);
  await createStringAttr(databases, COLLECTION_SORU_HAVUZU_ID, "dogru_cevap", 16, false);

  await ensureCollection(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "Sorun bildirimleri");
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "ad_soyad", 256, false);
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "kullanici_eposta", 512, false);
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "kategori", 64, false);
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "oncelik", 64, false);
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "sayfa_yolu", 1024, false);
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "tam_url", 4096, false);
  await createTextAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "detay", false);
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "ekran_goruntu_file_id", 256, false);
  await createStringAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "gonderen_uid", 128, false);
  await createBooleanAttr(databases, COLLECTION_HATA_BILDIRIMLERI_ID, "okundu_mu", false);

  await ensureCollection(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "Atanan kütüphane kayıtları");
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "student_id", 255, false);
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "libraryId", 256, false);
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "title", 512, false);
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "subject", 256, false);
  await createIntegerAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "totalPages", false, 0, 100000);
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "publisher", 256, false);
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "topics_json", 5000, false);
  await createIntegerAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "correctTotal", false, 0, 1000000);
  await createIntegerAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "wrongTotal", false, 0, 1000000);
  await createStringAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "difficulty", 64, false);
  await createDatetimeAttr(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "assignedAt", false);
  await ensureKeyIndex(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "idx_atanan_student", ["student_id"], ["ASC"]);

  await ensureCollection(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "MR (Emar) öğrenci profili");
  await createStringAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "coach_id", 128, true);
  await createTextAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "konu_json", false);
  await createTextAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "soru_json", false);
  await createDatetimeAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "updatedAt", false);
  await ensureKeyIndex(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "idx_mr_student", ["student_id"], ["ASC"]);

  await ensureCollection(databases, COLLECTION_GLOBAL_DENEMELER_ID, "Global deneme takvimi");
  await createStringAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "adi", 500, false);
  await createStringAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "yayinevi", 300, false);
  await createStringAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "sinavTuru", 16, false);
  await createDatetimeAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "tarihSaat", false);
  await createDatetimeAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "sonucTarihi", false);
  await createStringAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "pdfId", 256, false);
  await createStringAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "cevapAnahtariId", 256, false);
  await createStringAttr(databases, COLLECTION_GLOBAL_DENEMELER_ID, "coach_id", 128, false);

  await ensureCollection(databases, COLLECTION_YKS_NET_TARGETS_ID, "Net Sihirbazı (eski hedefler)");
  await createStringAttr(databases, COLLECTION_YKS_NET_TARGETS_ID, "label", 512, false);
  await createTextAttr(databases, COLLECTION_YKS_NET_TARGETS_ID, "payload_json", false);

  await ensureCollection(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "Öğrenci portal haftalık plan");
  await createIntegerAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "version", false, 0, 100);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "studentId", 255, false);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "studentName", 512, false);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "weekAnchor", 32, false);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "week_json", 5000, true);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "nextTaskId", 128, false);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "next_task_json", 3000, true);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "gorev_snapshot_json", 5000, false);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "task_done_map_json", 5000, false);
  await createStringAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "coachId", 128, false);
  await createDatetimeAttr(databases, COLLECTION_STUDENT_PORTAL_PLANS_ID, "updatedAt", false);

  await ensureCollection(databases, COLLECTION_SETTINGS_ID, "Sistem ayarları");
  await createBooleanAttr(databases, COLLECTION_SETTINGS_ID, "maintenance", false);
  await createDatetimeAttr(databases, COLLECTION_SETTINGS_ID, "updatedAt", false);

  log("✅ Genişletilmiş platform şeması tamam.");
}

/** Koç paneli `students` — coach_id sorgusu + tüm öğrenci form alanları */
async function ensureStudentsCoachSchema(databases) {
  await ensureCollection(databases, COLLECTION_STUDENTS_ID, COLLECTION_STUDENTS_NAME);
  log("");
  log("——— students attribute'ları ———");
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "firstName", 255, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "lastName", 255, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "name", 512, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "studentName", 512, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "gender", 32, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "parentPhone", 64, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "phone", 64, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "tcKimlikNo", 32, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "schoolName", 512, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "classGrade", 64, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "examGroup", 64, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "fieldType", 64, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "currentTytNet", 32, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "targetTytNet", 32, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "parentFullName", 255, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "parentRelation", 64, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "emergencyContactName", 255, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "registrationDate", 64, false);
  await createFloatAttr(databases, COLLECTION_STUDENTS_ID, "agreedTotalFee", false);
  await createIntegerAttr(databases, COLLECTION_STUDENTS_ID, "installmentCount", false, 0, 120);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "portalUsername", 128, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "targetUniversity", 512, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "targetDepartment", 512, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "track", 128, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "avatarUrl", 2000, false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "status", 64, false);
  await createBooleanAttr(databases, COLLECTION_STUDENTS_ID, "portalAuthPending", false);
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "studentAuthUid", 128, false);
  await createDatetimeAttr(databases, COLLECTION_STUDENTS_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_STUDENTS_ID, "updatedAt", false);
  await ensureKeyIndex(databases, COLLECTION_STUDENTS_ID, "idx_students_coach", ["coach_id"], ["ASC"]);
}

/** Lessons / Topics boşsa örnek ders + konu (deneme analizi açılır listeler) */
async function seedTemplateLessonsIfEmpty(databases) {
  var list = await databases.listDocuments({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_LESSONS_ID,
    queries: [Query.limit(1)],
  });
  if (list && list.documents && list.documents.length) {
    log("ℹ️  Şablon atlandı: Lessons zaten dolu.");
    return;
  }
  var lid = ID.unique();
  await databases.createDocument({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_LESSONS_ID,
    documentId: lid,
    data: { lessonName: "TYT — Genel" },
  });
  await databases.createDocument({
    databaseId: DATABASE_ID,
    collectionId: COLLECTION_TOPICS_ID,
    documentId: ID.unique(),
    data: { lessonId: lid, topicName: "Genel çalışma" },
  });
  log("✅ Şablon: 1 ders + 1 konu eklendi (Lessons / Topics).");
}

/** Yalnızca ExamResults (+ Karne / Akıllı Optik indeksleri) */
async function ensureExamResultsOnlySchema(databases) {
  await ensureCollectionPublicRead(databases, COLLECTION_EXAM_RESULTS_ID, COLLECTION_EXAM_RESULTS_NAME);
  log("");
  log("——— ExamResults attribute'ları ———");
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "exam_id", 255, true);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "exam_name", 512, false);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "detail_json", 5000, true);
  await createDatetimeAttr(databases, COLLECTION_EXAM_RESULTS_ID, "saved_at", true);
  log("");
  log("——— ExamResults indeksleri ———");
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
}

/** Deneme Analizi / Akıllı Optik — Lessons, Topics, Exams, ExamResults */
async function ensureDenemeExamSchema(databases) {
  await ensureCollection(databases, COLLECTION_LESSONS_ID, COLLECTION_LESSONS_NAME);
  await ensureCollection(databases, COLLECTION_TOPICS_ID, COLLECTION_TOPICS_NAME);
  await ensureCollection(databases, COLLECTION_EXAMS_ID, COLLECTION_EXAMS_NAME);
  await ensureCollectionPublicRead(databases, COLLECTION_EXAM_RESULTS_ID, COLLECTION_EXAM_RESULTS_NAME);

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
  await createStringAttr(databases, COLLECTION_EXAMS_ID, "answerKey", 5000, true);
  await createStringAttr(databases, COLLECTION_EXAMS_ID, "coach_id", 128, false);

  log("");
  log("——— ExamResults attribute'ları ———");
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "exam_id", 255, true);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "coach_id", 128, false);
  /** Karne trend etiketi — Exams join olmadan UI’da kullanılır */
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "exam_name", 512, false);
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "detail_json", 5000, true);
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
}

async function main() {
  var onlyDeneme =
    process.argv.indexOf("--only-deneme") !== -1 || String(process.env.APPWRITE_SETUP_ONLY_DENEME || "") === "1";
  var onlyExamResults = process.argv.indexOf("--only-exam-results") !== -1;
  var withSeed = process.argv.indexOf("--seed") !== -1;

  log("");
  log("╔══════════════════════════════════════════════════════════╗");
  log("║       Appwrite şema kurulumu — setup-appwrite.js         ║");
  log("╚══════════════════════════════════════════════════════════╝");
  log("");
  log("📌 Node.js:      " + process.version + " (.env → dotenv veya yerleşik okuyucu, --env-file gerekmez)");
  log("");

  if (!APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
    var envFile = path.join(__dirname, ".env");
    console.error("");
    if (!fs.existsSync(envFile)) {
      console.error("❌ .env dosyası yok: " + envFile);
      console.error("   Örnek: copy .env.example .env  ardından dosyayı düzenleyin.");
    } else {
      console.error("❌ APPWRITE_PROJECT_ID ve APPWRITE_API_KEY .env içinde dolu olmalı (şu an boş veya eksik).");
      console.error("   Appwrite Console → Project → Settings: Project ID");
      console.error("   Appwrite Console → API Keys: sunucu anahtarı (örn. databases.write yetkisi)");
      console.error("   Endpoint yazmazsanız varsayılan kullanılır: https://cloud.appwrite.io/v1");
    }
    console.error("");
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
  log(
    "📌 Mod:          " +
      (onlyExamResults
        ? "--only-exam-results"
        : onlyDeneme
          ? "--only-deneme (Lessons…ExamResults)"
          : "tam kurulum") + (withSeed && !onlyExamResults ? " + --seed" : "")
  );
  log("📌 students:     " + COLLECTION_STUDENTS_ID + " (tam şema)");
  log("📌 ExamResults:  " + COLLECTION_EXAM_RESULTS_ID);
  if (!onlyExamResults) {
    log("📌 Lessons ID:   " + COLLECTION_LESSONS_ID);
    log("📌 Topics ID:    " + COLLECTION_TOPICS_ID);
    log("📌 Exams ID:     " + COLLECTION_EXAMS_ID);
  }
  log("");

  await ensureDatabase(databases);

  var storage = new Storage(client);

  if (onlyExamResults) {
    await ensureExamResultsOnlySchema(databases);
  } else {
    await ensureExtendedPlatformSchema(databases);
    await ensureStudentsCoachSchema(databases);
    await ensureDenemeExamSchema(databases);
    await ensurePlatformStorageBuckets(storage);
    if (withSeed) {
      await seedTemplateLessonsIfEmpty(databases);
    }
  }

  log("");
  log("🎉 Kurulum tamamlandı. Appwrite Console → Databases → " + DATABASE_ID + " kontrol edin.");
  log("");
  log("Patron, statik mimariye geçildi, eksik tablolar ve kovalar kuruldu. Her şey hazır!");
}

main().catch(function (err) {
  console.error("❌ Hata:", err && err.message ? err.message : err);
  if (err && err.code != null) console.error("   HTTP / kod: " + err.code);
  if (err && err.type) console.error("   Tip: " + err.type);
  if (err && err.response) console.error(err.response);
  if (isAuthScopeError(err)) {
    console.error("   (Yetki: Unauthorized / Access Denied benzeri — aşağıdaki scope’ları kontrol edin.)");
    logAppwriteAuthHelp();
  }
  process.exit(1);
});
