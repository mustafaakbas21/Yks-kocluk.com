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
 *   APPWRITE_ATTR_MAX_ATTEMPTS — 1. faz deneme sayısı (varsayılan 600)
 *   APPWRITE_ATTR_POLL_MS — 1. faz denemeler arası ms (varsayılan 4000)
 *   APPWRITE_ATTR_PROCESSING_GRACE_ATTEMPTS — süre dolunca hâlâ «processing» ise 2. faz denemesi (varsayılan 360; 0=kapat)
 *   APPWRITE_ATTR_PROCESSING_GRACE_MS — 2. faz aralığı ms (varsayılan 5000)
 *   APPWRITE_ATTR_SKIP_WAIT=1 — sadece acil: attribute bekleme döngüsünü atlar (indeks adımında hata riski)
 *   APPWRITE_DEBUG_ATTR=1 — status boş uyarısında getAttribute yanıtının alan adlarını bir kez loglar
 *
 * String attribute boyutları: Appwrite planında attribute sayısı / toplam boyut sınırına takılmamak için
 * gereksiz yüksek size kullanılmaz (ör. 65k). Kısa ID/isim: 255, kısa metin: ~1000, JSON: 3000–5000,
 * uzun URL: ~2048. Gerekirse Console’da tek tek artırılabilir.
 *
 * ——— messages (Gelen Sorular / koç–öğrenci sohbet) ———
 * Koleksiyon ID: messages (veya .env: APPWRITE_COLLECTION_MESSAGES)
 *
 * Appwrite Console’da elle açacaksanız (Databases → derece_panel → Create collection):
 *   1) Collection ID: messages, Document security: kapalı, izinler: oturumlu kullanıcı okuma/yazma
 *   2) Attributes:
 *        sender_id   → String, size 512, required (koç kimliği veya students belge $id)
 *        receiver_id → String, size 512, required
 *        text        → Text, required (uzun mesajlar; String yerine Text kullanın)
 *        timestamp   → DateTime, required
 *        read_at     → DateTime, optional (koç okudu; okunmamış rozet — panel kodu kullanır)
 *   3) Indexes (önerilen): sender_id+receiver_id (Key); receiver_id (Key) — sorgu performansı için
 *   4) Project → Realtime: veritabanı/koleksiyon için canlı güncellemeleri açın
 *
 * Otomatik kurulum: bu dosyayı API anahtarıyla çalıştırdığınızda aşağıdaki ensureCollection bloğu aynı şemayı oluşturur.
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
const COLLECTION_INSTITUTIONS_ID = process.env.APPWRITE_COLLECTION_INSTITUTIONS || "institutions";
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
const COLLECTION_MR_EXAM_DEFICIENCIES_ID =
  process.env.APPWRITE_COLLECTION_MR_EXAM_DEFICIENCIES || "mr_exam_deficiencies";
const COLLECTION_GLOBAL_DENEMELER_ID = process.env.APPWRITE_COLLECTION_GLOBAL_DENEMELER || "global_denemeler";
const COLLECTION_YKS_NET_TARGETS_ID = process.env.APPWRITE_COLLECTION_YKS_NET_TARGETS || "yks_net_sihirbazi_targets";
const COLLECTION_STUDENT_PORTAL_PLANS_ID = "studentPortalPlans";
const COLLECTION_SETTINGS_ID = "settings";
const COLLECTION_MESSAGES_ID = process.env.APPWRITE_COLLECTION_MESSAGES || "messages";

const COLLECTION_LESSONS_NAME = "Dersler";
const COLLECTION_TOPICS_NAME = "Konular";
const COLLECTION_EXAMS_NAME = "Denemeler";
const COLLECTION_EXAM_RESULTS_NAME = "Deneme Sonuçları (Optik)";
const COLLECTION_STUDENTS_NAME = "Öğrenciler";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * node-appwrite / Appwrite REST: `status`, `$status` veya nadir şekil farkları.
 * Büyük sayıları JSONbig ile parse eden yanıtlarda alan adı varyasyonu olabilir.
 */
function readAttributeStatus(attr) {
  if (!attr || typeof attr !== "object") return "";
  var s = attr.status != null ? attr.status : attr.$status;
  if (s == null) {
    var keys = Object.keys(attr);
    for (var ki = 0; ki < keys.length; ki++) {
      if (String(keys[ki]).toLowerCase() === "status") {
        s = attr[keys[ki]];
        break;
      }
    }
  }
  return String(s != null ? s : "")
    .trim()
    .toLowerCase();
}

function appwriteErrBrief(e) {
  if (!e || typeof e !== "object") return { message: String(e) };
  return {
    code: e.code,
    type: e.type,
    message: e.message ? String(e.message).slice(0, 220) : undefined,
  };
}

function findAttributeInAttributesArray(attrs, key) {
  if (!Array.isArray(attrs)) return null;
  for (var i = 0; i < attrs.length; i++) {
    var a = attrs[i];
    var k = a && a.key != null ? a.key : "";
    if (String(k) === String(key)) return a;
  }
  return null;
}

function packAttrResult(status, via, errors, hitObj) {
  var out = { status: status || "", via: via || "", errors: errors || [] };
  if (hitObj && typeof hitObj === "object" && !status) {
    out.attrSampleKeys = Object.keys(hitObj).join(",");
  }
  return out;
}

/**
 * getAttribute → listAttributes(key) → sorgusuz ilk sayfa → limit/offset sayfalama.
 * «Bulunamadı» uyarısı çoğu zaman yanlış DB/koleksiyon ID, yetkisiz anahtar veya yanıtta status alanı olmamasıdır; errors[] teşhis için dolu gelir.
 */
async function fetchAttributeStatusRobust(databases, databaseId, collectionId, key) {
  var errors = [];
  var getBodyNoStatus = null;

  try {
    var attrGet = await databases.getAttribute({
      databaseId: databaseId,
      collectionId: collectionId,
      key: key,
    });
    var stGet = readAttributeStatus(attrGet);
    if (stGet) return packAttrResult(stGet, "getAttribute", errors, null);
    getBodyNoStatus = attrGet;
    errors.push({
      step: "getAttribute",
      note: "yanıtta status yok",
      keys: Object.keys(attrGet || {}).join(","),
    });
  } catch (eGet) {
    errors.push(Object.assign({ step: "getAttribute" }, appwriteErrBrief(eGet)));
  }

  try {
    var listEq = await databases.listAttributes({
      databaseId: databaseId,
      collectionId: collectionId,
      queries: [Query.equal("key", key)],
      total: false,
    });
    var hitEq = findAttributeInAttributesArray(listEq && listEq.attributes, key);
    if (hitEq) {
      var stEq = readAttributeStatus(hitEq);
      return packAttrResult(stEq, stEq ? "listAttributes(equal)" : "listAttributes(equal-noStatus)", errors, hitEq);
    }
  } catch (eEq) {
    errors.push(Object.assign({ step: "listAttributes(equal)" }, appwriteErrBrief(eEq)));
  }

  try {
    var listPlain = await databases.listAttributes({
      databaseId: databaseId,
      collectionId: collectionId,
      total: true,
    });
    var hitPl = findAttributeInAttributesArray(listPlain && listPlain.attributes, key);
    if (hitPl) {
      var stPl = readAttributeStatus(hitPl);
      return packAttrResult(stPl, stPl ? "listAttributes(plain)" : "listAttributes(plain-noStatus)", errors, hitPl);
    }
  } catch (ePl) {
    errors.push(Object.assign({ step: "listAttributes(plain)" }, appwriteErrBrief(ePl)));
  }

  try {
    var pageSize = 100;
    var offset = 0;
    var totalAttrs = null;
    var guard = 0;
    while (guard < 60) {
      guard++;
      var listPg = await databases.listAttributes({
        databaseId: databaseId,
        collectionId: collectionId,
        queries: [Query.limit(pageSize), Query.offset(offset)],
        total: offset === 0,
      });
      if (totalAttrs == null && listPg && typeof listPg.total === "number") {
        totalAttrs = listPg.total;
      }
      var attrsPg = (listPg && listPg.attributes) || [];
      var hitPg = findAttributeInAttributesArray(attrsPg, key);
      if (hitPg) {
        var stPg = readAttributeStatus(hitPg);
        return packAttrResult(stPg, stPg ? "listAttributes(paged)" : "listAttributes(paged-noStatus)", errors, hitPg);
      }
      if (attrsPg.length === 0) break;
      offset += attrsPg.length;
      if (totalAttrs != null && offset >= totalAttrs) break;
      if (attrsPg.length < pageSize) break;
    }
  } catch (ePg) {
    errors.push(Object.assign({ step: "listAttributes(paged)" }, appwriteErrBrief(ePg)));
  }

  if (getBodyNoStatus) {
    return packAttrResult("", "getAttribute(noStatus)", errors, getBodyNoStatus);
  }

  return { status: "", via: "", errors: errors };
}

/** Appwrite Cloud’da attribute bazen 40–60+ dk “processing” kalabilir; 2. faz (grace) bunu karşılar. */
const ATTR_POLL_MS = Math.max(500, parseInt(process.env.APPWRITE_ATTR_POLL_MS || "4000", 10) || 4000);
const ATTR_MAX_ATTEMPTS = Math.max(20, parseInt(process.env.APPWRITE_ATTR_MAX_ATTEMPTS || "600", 10) || 600);
/** 1. faz bittiğinde son durum «processing» ise ek bekleme (toplam ~ek 30 dk @ varsayılan) */
const ATTR_PROCESSING_GRACE_ATTEMPTS = Math.max(
  0,
  parseInt(process.env.APPWRITE_ATTR_PROCESSING_GRACE_ATTEMPTS || "360", 10) || 360
);
const ATTR_PROCESSING_GRACE_MS = Math.max(
  1000,
  parseInt(process.env.APPWRITE_ATTR_PROCESSING_GRACE_MS || "5000", 10) || 5000
);
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

var storageBucketLimitWarnPrinted = false;

/** Ücretsiz plan kova kotası (HTTP 403) veya benzeri limit mesajları */
function isStorageBucketQuotaExceeded(err) {
  if (!err) return false;
  var c = Number(err.code);
  var m = String(err.message || "").toLowerCase();
  if (m.indexOf("maximum number of buckets") !== -1) return true;
  if (m.indexOf("buckets allowed") !== -1 && (m.indexOf("plan") !== -1 || m.indexOf("reached") !== -1))
    return true;
  if (c === 403 && m.indexOf("bucket") !== -1) return true;
  return false;
}

function isAttributeLimitExceeded(err) {
  if (!err) return false;
  if (err.type === "attribute_limit_exceeded") return true;
  var m = String(err.message || "");
  return m.indexOf("attribute_limit") !== -1 || m.indexOf("maximum number") !== -1;
}

/** Bu process koşusunda kotadan eklenemeyen sütunlar — ensureKeyIndex beklemez / indeks oluşturmaz. */
var ATTR_SKIPPED_FOR_QUOTA = Object.create(null);

function attrQuotaMapKey(collectionId, key) {
  return String(collectionId) + "\x00" + String(key);
}

function markAttributeSkippedForQuota(collectionId, key) {
  ATTR_SKIPPED_FOR_QUOTA[attrQuotaMapKey(collectionId, key)] = true;
}

function indexRequiredAttrsAllCreated(collectionId, attributeKeys) {
  if (!attributeKeys || !attributeKeys.length) return true;
  for (var i = 0; i < attributeKeys.length; i++) {
    if (ATTR_SKIPPED_FOR_QUOTA[attrQuotaMapKey(collectionId, attributeKeys[i])]) return false;
  }
  return true;
}

function logAttributeQuotaExceeded(collectionId, key) {
  markAttributeSkippedForQuota(collectionId, key);
  log(
    "   ⚠️  '" +
      key +
      "' eklenemedi (attribute kotası). «" +
      collectionId +
      "» koleksiyonunda kullanılmayan sütunları silin veya Appwrite planını yükseltin; ardından scripti yeniden çalıştırın."
  );
}

function logSetupQuotaSummaryIfAny() {
  var keys = Object.keys(ATTR_SKIPPED_FOR_QUOTA);
  if (!keys.length) return;
  log("");
  log("——— Attribute kotası: bu koşuda oluşturulamayan sütunlar ———");
  for (var i = 0; i < keys.length; i++) {
    var sep = keys[i].indexOf("\x00");
    var cid = sep === -1 ? keys[i] : keys[i].slice(0, sep);
    var k = sep === -1 ? "?" : keys[i].slice(sep + 1);
    log("   • " + cid + " → " + k);
  }
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
    if (i < 6 || (i + 1) % 5 === 0 || i === maxAttempts - 1) {
      log(
        "   … Index '" + indexKey + "'  #" + (i + 1) + "/" + maxAttempts + "  status=" + (st || "?")
      );
    }
    await sleep(INDEX_POLL_MS);
  }
  throw new Error("Index '" + indexKey + "' zaman aşımı (available olmadı).");
}

function throwIfAttributeTerminalError(collectionId, key, st) {
  if (st === "failed") {
    throw new Error(
      "Attribute '" +
        key +
        "' (" +
        collectionId +
        ") Appwrite'da failed. Console → Databases → " +
        collectionId +
        " → ilgili sütunu silin veya düzeltin; sonra scripti tekrar çalıştırın."
    );
  }
  if (st === "stuck") {
    throw new Error(
      "Attribute '" +
        key +
        "' (" +
        collectionId +
        ") Appwrite durumu «stuck» (iş kuyruğu takıldı). Appwrite Console → Databases → " +
        collectionId +
        " → bu sütunu silin; gerekirse Appwrite Cloud desteğine yazın. Sonra scripti yeniden çalıştırın."
    );
  }
  if (st === "deleting") {
    throw new Error(
      "Attribute '" + key + "' (" + collectionId + ") siliniyor (deleting). Bitene kadar bekleyip scripti yeniden çalıştırın."
    );
  }
}

/** İndeks `lengths` asla attribute size’dan büyük olamaz (Console’da 128 kalan eski studentId vb.). 128: 4×128<767 ve çoğu ID için yeterli. */
var KEY_INDEX_PREFIX_SHORT_ID = 128;

/**
 * Appwrite Cloud (MySQL): Key indeks tekil giriş uzunluğu ~767 bayt (utf8mb4).
 * Uzun string veya bileşik (yalnızca string) indekslerde `lengths` ile önek (767 bayt sınırı).
 * Appwrite: datetime sütunu indekste varsa `lengths` GÖNDERMEYİN (HTTP 400: Cannot set a length on datetime).
 */
async function ensureKeyIndex(databases, collectionId, indexKey, attributes, orders, lengths) {
  if (attributes && attributes.length && !indexRequiredAttrsAllCreated(collectionId, attributes)) {
    var miss = [];
    for (var mi = 0; mi < attributes.length; mi++) {
      if (ATTR_SKIPPED_FOR_QUOTA[attrQuotaMapKey(collectionId, attributes[mi])]) miss.push(attributes[mi]);
    }
    log(
      "   ⏭️  İndeks «" +
        indexKey +
        "» atlandı (" +
        collectionId +
        "): kotadan eklenemeyen sütun" +
        (miss.length > 1 ? "lar: " : ": ") +
        miss.join(", ") +
        ". Yer açılınca scripti yeniden çalıştırın."
    );
    return;
  }
  if (attributes && attributes.length) {
    for (var ai = 0; ai < attributes.length; ai++) {
      await waitForAttribute(databases, DATABASE_ID, collectionId, attributes[ai]);
    }
  }
  log("⏳ Index '" + indexKey + "' oluşturuluyor… (" + collectionId + ")");
  try {
    var idxPayload = {
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: indexKey,
      type: IndexType.Key,
      attributes: attributes,
      orders: orders,
    };
    if (lengths != null && lengths.length) {
      idxPayload.lengths = lengths;
    }
    await databases.createIndex(idxPayload);
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

/**
 * opts.seedStatus: createAttribute yanıtındaki ilk status (ör. «processing»); poll boş dönse bile lastSt korunur, 2. faz açılabilir.
 */
async function waitForAttribute(databases, databaseId, collectionId, key, maxAttempts, opts) {
  if (String(process.env.APPWRITE_ATTR_SKIP_WAIT || "").trim() === "1") {
    log(
      "⚠️  APPWRITE_ATTR_SKIP_WAIT=1 → '" +
        collectionId +
        "." +
        key +
        "' için available beklenmiyor (indeks/400 hatası alırsanız Console’da sütun durumunu kontrol edin)."
    );
    return;
  }
  opts = opts && typeof opts === "object" ? opts : {};
  maxAttempts = maxAttempts || ATTR_MAX_ATTEMPTS;
  var maxMin = Math.round((maxAttempts * ATTR_POLL_MS) / 60000);
  log(
    "   ⏳ '" +
      collectionId +
      "." +
      key +
      "' → Appwrite durumu 'available' olana kadar kontrol ediliyor (en fazla ~" +
      maxMin +
      " dk; bulutta 'processing' normaldir)."
  );
  var seedRaw = opts.seedStatus;
  var lastSt =
    seedRaw != null && String(seedRaw).trim() !== ""
      ? String(seedRaw)
          .trim()
          .toLowerCase()
      : "";
  if (lastSt === "available") {
    return;
  }
  throwIfAttributeTerminalError(collectionId, key, lastSt);
  var lastVia = "";
  for (var i = 0; i < maxAttempts; i++) {
    var fetched = await fetchAttributeStatusRobust(databases, databaseId, collectionId, key);
    var st = fetched.status;
    if (fetched.via) lastVia = fetched.via;
    lastSt = st || lastSt;
    if (st === "available") {
      if (i > 0) {
        log("   ✅ '" + collectionId + "." + key + "' kullanılabilir (available).");
      }
      return;
    }
    throwIfAttributeTerminalError(collectionId, key, st);
    if (i === 10 && !st) {
      if (fetched.via && String(fetched.via).indexOf("noStatus") !== -1) {
        log(
          "   ⚠️  Sütun bulundu ama «status» alanı boş (kaynak: " +
            fetched.via +
            "). Dönen alanlar: " +
            (fetched.attrSampleKeys || "—") +
            ". node-appwrite güncelleyin veya APPWRITE_DEBUG_ATTR=1 deneyin."
        );
      } else if (!fetched.via) {
        log(
          "   ⚠️  «" +
            key +
            "» sütunu bu database/koleksiyon için API’de görünmüyor. Kontrol: APPWRITE_DATABASE_ID=" +
            databaseId +
            " (Console’daki Database ID ile aynı mı?), koleksiyon ID=" +
            collectionId +
            ", sütun adı=" +
            key +
            ". Sunucu API anahtarında databases.read (+ write) açık olmalı; yanlış proje/endpoint kullanılmamalı."
        );
        if (fetched.errors && fetched.errors.length) {
          log("   ⚠️  Teknik özet (ilk 4): " + JSON.stringify(fetched.errors.slice(0, 4)));
        }
      } else {
        log(
          "   ⚠️  Beklenmeyen durum (kaynak: " +
            fetched.via +
            ", status boş). APPWRITE_DEBUG_ATTR=1 ile teşhis; node-appwrite / Cloud sürümünü kontrol edin."
        );
      }
      if (String(process.env.APPWRITE_DEBUG_ATTR || "").trim() === "1") {
        try {
          var rawDbg = await databases.getAttribute({
            databaseId: databaseId,
            collectionId: collectionId,
            key: key,
          });
          log(
            "   [APPWRITE_DEBUG_ATTR] getAttribute anahtarları: " + Object.keys(rawDbg || {}).join(", ")
          );
        } catch (eDbg) {
          log("   [APPWRITE_DEBUG_ATTR] getAttribute hata: " + ((eDbg && eDbg.message) || eDbg));
        }
      }
    }
    var loud = i < 8 || (i + 1) % 5 === 0 || i === maxAttempts - 1;
    if (loud) {
      var extra = "";
      if (st === "processing") {
        extra = " (Cloud’da bazen 10–20+ dk sürebilir)";
      }
      log(
        "   … " +
          collectionId +
          "." +
          key +
          "  #" +
          (i + 1) +
          "/" +
          maxAttempts +
          "  status=" +
          (st || "(boş)") +
          extra +
          "  ~" +
          Math.round(((maxAttempts - i - 1) * ATTR_POLL_MS) / 60000) +
          " dk üst sınır kaldı"
      );
    }
    await sleep(ATTR_POLL_MS);
  }

  var graceNoStatus =
    !lastSt &&
    lastVia &&
    String(lastVia).indexOf("noStatus") !== -1 &&
    ATTR_PROCESSING_GRACE_ATTEMPTS > 0;
  var graceProcessing = lastSt === "processing" && ATTR_PROCESSING_GRACE_ATTEMPTS > 0;
  if (graceProcessing || graceNoStatus) {
    var graceMin = Math.round((ATTR_PROCESSING_GRACE_ATTEMPTS * ATTR_PROCESSING_GRACE_MS) / 60000);
    if (graceNoStatus && !graceProcessing) {
      log(
        "   … Sütun bulundu ama status okunamadı — 2. bekleme fazı (~" +
          graceMin +
          " dk); ardından tekrar kontrol edilecek."
      );
    } else {
      log(
        "   … «processing» sürüyor — 2. bekleme fazı (~" +
          graceMin +
          " dk). APPWRITE_ATTR_PROCESSING_GRACE_ATTEMPTS=0 ile kapatılabilir."
      );
    }
    for (var g = 0; g < ATTR_PROCESSING_GRACE_ATTEMPTS; g++) {
      await sleep(ATTR_PROCESSING_GRACE_MS);
      var fetchedG = await fetchAttributeStatusRobust(databases, databaseId, collectionId, key);
      var stG = fetchedG.status;
      if (fetchedG.via) lastVia = fetchedG.via;
      lastSt = stG || lastSt;
      if (stG === "available") {
        log("   ✅ '" + collectionId + "." + key + "' kullanılabilir (available, 2. faz sonrası).");
        return;
      }
      throwIfAttributeTerminalError(collectionId, key, stG);
      var loudG = g < 4 || (g + 1) % 6 === 0 || g === ATTR_PROCESSING_GRACE_ATTEMPTS - 1;
      if (loudG) {
        log(
          "   … " +
            collectionId +
            "." +
            key +
            "  (2.faz) #" +
            (g + 1) +
            "/" +
            ATTR_PROCESSING_GRACE_ATTEMPTS +
            "  status=" +
            (stG || "(boş)") +
            "  ~" +
            Math.round(((ATTR_PROCESSING_GRACE_ATTEMPTS - g - 1) * ATTR_PROCESSING_GRACE_MS) / 60000) +
            " dk üst sınır"
        );
      }
    }
  }

  var tail =
    " .env: APPWRITE_ATTR_MAX_ATTEMPTS / APPWRITE_ATTR_POLL_MS artırın; APPWRITE_ATTR_PROCESSING_GRACE_ATTEMPTS (örn. 500) ve _GRACE_MS (örn. 8000); veya acil APPWRITE_ATTR_SKIP_WAIT=1 (riskli).";
  var statusHuman = lastSt || "bilinmiyor";
  if (!lastSt && lastVia) {
    statusHuman = "bilinmiyor (son API kaynağı: " + lastVia + " — status alanı poll’larda boş kaldı; APPWRITE_DEBUG_ATTR=1)";
  } else if (!lastSt && !lastVia) {
    statusHuman =
      "bilinmiyor (sütun API’de tespit edilemedi — APPWRITE_DATABASE_ID, koleksiyon ID, key ve databases.read doğrulayın)";
  }
  if (lastSt === "processing") {
    tail =
      " «processing» hâlâ bitmediyse Appwrite Cloud kuyruğu çok yoğun veya sütun takılı; Console’da durumu kontrol edin. «stuck»/«failed» ise sütunu silin." +
      tail;
  } else if (!lastSt && lastVia && String(lastVia).indexOf("noStatus") !== -1) {
    tail =
      " Sütun var gibi ama yanıtta «status» yok; node-appwrite güncelleyin veya Appwrite Console’da appointments.institutionId durumuna bakın." + tail;
  } else {
    tail = " Console’da «stuck»/«failed» ise ilgili sütunu silip scripti yeniden çalıştırın." + tail;
  }
  throw new Error(
    "Attribute '" +
      key +
      "' (" +
      collectionId +
      ") zaman aşımı: hâlâ available değil. Son görülen durum: «" +
      statusHuman +
      "»." +
      tail
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
    try {
      await storage.createBucket({
        bucketId: bucketId,
        name: displayName,
        permissions: storageBucketPermissions(),
        fileSecurity: false,
        enabled: true,
      });
      log("✅ Storage bucket: " + bucketId);
    } catch (ce) {
      if (isConflict(ce) || isStorageBucketQuotaExceeded(ce)) {
        if (!storageBucketLimitWarnPrinted) {
          console.warn(
            "⚠️ [UYARI]: Kova limiti dolu veya kova zaten mevcut. Kova oluşturma adımı atlanıyor..."
          );
          storageBucketLimitWarnPrinted = true;
        }
        log("   ⏭️  Atlandı: " + bucketId);
        return;
      }
      throw ce;
    }
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
  var createdRes = null;
  try {
    createdRes = await databases.createStringAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      size: size,
      required: required,
      array: false,
    });
  } catch (e) {
    if (isConflict(e)) {
      log("   ℹ️  '" + key + "' zaten tanımlı; Appwrite'da 'available' olana kadar bekleniyor.");
    } else if (isAttributeLimitExceeded(e)) {
      logAttributeQuotaExceeded(collectionId, key);
      return;
    } else {
      throw e;
    }
  }
  var seed = readAttributeStatus(createdRes);
  await waitForAttribute(
    databases,
    DATABASE_ID,
    collectionId,
    key,
    undefined,
    seed ? { seedStatus: seed } : undefined
  );
  log("✅ " + key + " hazır (" + collectionId + ")");
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
      log("   ℹ️  '" + key + "' zaten tanımlı; Appwrite'da 'available' olana kadar bekleniyor.");
    } else if (isAttributeLimitExceeded(e)) {
      logAttributeQuotaExceeded(collectionId, key);
      return;
    } else {
      throw e;
    }
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " hazır (" + collectionId + ")");
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
      log("   ℹ️  '" + key + "' zaten tanımlı; Appwrite'da 'available' olana kadar bekleniyor.");
    } else if (isAttributeLimitExceeded(e)) {
      logAttributeQuotaExceeded(collectionId, key);
      return;
    } else {
      throw e;
    }
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " hazır (" + collectionId + ")");
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
      log("   ℹ️  '" + key + "' zaten tanımlı; Appwrite'da 'available' olana kadar bekleniyor.");
    } else if (isAttributeLimitExceeded(e)) {
      logAttributeQuotaExceeded(collectionId, key);
      return;
    } else {
      throw e;
    }
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " hazır (" + collectionId + ")");
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
      log("   ℹ️  '" + key + "' zaten tanımlı; Appwrite'da 'available' olana kadar bekleniyor.");
    } else if (isAttributeLimitExceeded(e)) {
      logAttributeQuotaExceeded(collectionId, key);
      return;
    } else {
      throw e;
    }
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " hazır (" + collectionId + ")");
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
      log("   ℹ️  '" + key + "' zaten tanımlı; Appwrite'da 'available' olana kadar bekleniyor.");
    } else if (isAttributeLimitExceeded(e)) {
      logAttributeQuotaExceeded(collectionId, key);
      return;
    } else {
      throw e;
    }
  }
  await waitForAttribute(databases, DATABASE_ID, collectionId, key);
  log("✅ " + key + " hazır (" + collectionId + ")");
}

/**
 * Koç paneli, login, vitrin — tüm `collection(db, "...")` koleksiyonları + Appwrite-config tabloları.
 * (`Exams` büyük harf = Akıllı Optik şeması; `exams` küçük = klasik deneme kayıtları.)
 */
async function ensureExtendedPlatformSchema(databases) {
  log("");
  log("——— Genişletilmiş platform koleksiyonları (users, exams, …) ———");

  await ensureCollection(databases, COLLECTION_INSTITUTIONS_ID, "Kurumlar (tenant)");
  await createStringAttr(databases, COLLECTION_INSTITUTIONS_ID, "name", 512, true);
  /** Logo kaldırıldı (panel yalnızca ad + createdAt gönderir; eski `logo` attribute’u Console’da bırakılabilir) */
  await createDatetimeAttr(databases, COLLECTION_INSTITUTIONS_ID, "createdAt", false);

  await ensureCollection(databases, COLLECTION_USERS_ID, "Kullanıcılar (profil)");
  await createStringAttr(databases, COLLECTION_USERS_ID, "username", 128, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "role", 64, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "fullName", 512, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "institutionId", 128, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "institutionName", 512, false);
  /** Kurucu paneli koç formu (`super-admin.js`) — şemada yoksa createDocument 400 döner, profil yazılmaz */
  await createStringAttr(databases, COLLECTION_USERS_ID, "phone", 64, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "packageType", 64, false);
  await createStringAttr(databases, COLLECTION_USERS_ID, "plainPassword", 512, false);
  await createBooleanAttr(databases, COLLECTION_USERS_ID, "frozen", false);
  await createDatetimeAttr(databases, COLLECTION_USERS_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_USERS_ID, "lastLogin", false);
  await createDatetimeAttr(databases, COLLECTION_USERS_ID, "lastPasswordChangeAt", false);
  /** Koç paneli profil fotoğrafı (Storage view URL); asıl kaynak ayrıca Account prefs */
  await createStringAttr(databases, COLLECTION_USERS_ID, "avatarUrl", 2000, false);
  await ensureKeyIndex(databases, COLLECTION_USERS_ID, "idx_users_username", ["username"], ["ASC"]);
  /** `role == coach|student|…` listeleri (kurucu paneli) — indeks yoksa listDocuments 400 / boş dönebilir */
  await ensureKeyIndex(databases, COLLECTION_USERS_ID, "idx_users_role", ["role"], ["ASC"]);

  await ensureCollection(databases, COLLECTION_COACHES_ID, "Koçlar (legacy username)");
  await createStringAttr(databases, COLLECTION_COACHES_ID, "username", 128, false);
  await createStringAttr(databases, COLLECTION_COACHES_ID, "institutionId", 128, false);
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
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "institutionId", 128, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "examDefinitionId", 255, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "scoringRule", 128, false);
  await createStringAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "yksBranchDetail", 5000, false);
  await createDatetimeAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "examDate", false);
  await createDatetimeAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "createdAt", false);
  await createDatetimeAttr(databases, COLLECTION_EXAMS_LEGACY_ID, "updatedAt", false);
  /** Önek ≤ sütun size (eski şemalar 128); 128 tam indeks de 512 bayt < 767 */
  await ensureKeyIndex(
    databases,
    COLLECTION_EXAMS_LEGACY_ID,
    "idx_exams_studentId",
    ["studentId"],
    ["ASC"],
    [KEY_INDEX_PREFIX_SHORT_ID]
  );
  await ensureKeyIndex(
    databases,
    COLLECTION_EXAMS_LEGACY_ID,
    "idx_exams_coach_institution",
    ["coach_id", "institutionId"],
    ["ASC", "ASC"],
    [95, 95]
  );

  /** Randevular — scheduledAt + details_json + coach_id + institutionId; kota dolunca sütun atlanır, idx_appointments_* oluşturulmaz */
  await ensureCollection(databases, COLLECTION_APPOINTMENTS_ID, "Randevular");
  await createDatetimeAttr(databases, COLLECTION_APPOINTMENTS_ID, "scheduledAt", false);
  await createStringAttr(databases, COLLECTION_APPOINTMENTS_ID, "details_json", 3000, false);
  await createStringAttr(databases, COLLECTION_APPOINTMENTS_ID, "coach_id", 64, false);
  await createStringAttr(databases, COLLECTION_APPOINTMENTS_ID, "institutionId", 128, false);
  await ensureKeyIndex(
    databases,
    COLLECTION_APPOINTMENTS_ID,
    "idx_appointments_coach_institution",
    ["coach_id", "institutionId"],
    ["ASC", "ASC"],
    [64, 95]
  );

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
  await createStringAttr(databases, COLLECTION_MEETING_LOGS_ID, "institutionId", 128, false);
  await createStringAttr(databases, COLLECTION_MEETING_LOGS_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_MEETING_LOGS_ID, "student_name", 512, false);
  await createTextAttr(databases, COLLECTION_MEETING_LOGS_ID, "body_html", false);
  await createDatetimeAttr(databases, COLLECTION_MEETING_LOGS_ID, "saved_at", true);
  await ensureKeyIndex(databases, COLLECTION_MEETING_LOGS_ID, "idx_meeting_student", ["student_id"], ["ASC"], [
    KEY_INDEX_PREFIX_SHORT_ID,
  ]);
  await ensureKeyIndex(
    databases,
    COLLECTION_MEETING_LOGS_ID,
    "idx_meeting_coach_institution",
    ["coach_id", "institutionId"],
    ["ASC", "ASC"],
    [95, 95]
  );

  /** Koç paneli — öğrenci ile iki yönlü sohbet (Gelen Sorular); Console şeması üstteki yorumla aynı */
  await ensureCollection(databases, COLLECTION_MESSAGES_ID, "Mesajlar (koç–öğrenci)");
  await createStringAttr(databases, COLLECTION_MESSAGES_ID, "sender_id", 512, true);
  await createStringAttr(databases, COLLECTION_MESSAGES_ID, "receiver_id", 512, true);
  await createTextAttr(databases, COLLECTION_MESSAGES_ID, "text", true);
  await createDatetimeAttr(databases, COLLECTION_MESSAGES_ID, "timestamp", true);
  await createDatetimeAttr(databases, COLLECTION_MESSAGES_ID, "read_at", false);
  /** İki adet 512’lik id birlikte indeks >767 bayt */
  await ensureKeyIndex(databases, COLLECTION_MESSAGES_ID, "idx_msg_sender_recv", ["sender_id", "receiver_id"], [
    "ASC",
    "ASC",
  ], [95, 95]);
  await ensureKeyIndex(databases, COLLECTION_MESSAGES_ID, "idx_messages_receiver", ["receiver_id"], ["ASC"], [
    KEY_INDEX_PREFIX_SHORT_ID,
  ]);

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
  await ensureKeyIndex(databases, COLLECTION_ATANAN_KAYNAKLAR_ID, "idx_atanan_student", ["student_id"], ["ASC"], [
    KEY_INDEX_PREFIX_SHORT_ID,
  ]);

  await ensureCollection(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "MR (Emar) öğrenci profili");
  await createStringAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "coach_id", 128, true);
  await createTextAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "konu_json", false);
  await createTextAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "soru_json", false);
  await createDatetimeAttr(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "updatedAt", false);
  await ensureKeyIndex(databases, COLLECTION_MR_STUDENT_PROFILES_ID, "idx_mr_student", ["student_id"], ["ASC"], [
    KEY_INDEX_PREFIX_SHORT_ID,
  ]);

  await ensureCollection(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "MR deneme konu eksikleri");
  await createStringAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "student_id", 255, true);
  await createStringAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "exam_id", 255, true);
  await createStringAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "coach_id", 128, false);
  await createStringAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "exam_result_id", 255, false);
  await createStringAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "subject", 256, false);
  await createStringAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "topic", 512, false);
  await createIntegerAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "error_count", false, 0, 1000000);
  await createIntegerAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "wrong_count", false, 0, 1000000);
  await createIntegerAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "empty_count", false, 0, 1000000);
  await createStringAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "status", 64, false);
  await createBooleanAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "critical", false);
  await createBooleanAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "severity_high", false);
  await createDatetimeAttr(databases, COLLECTION_MR_EXAM_DEFICIENCIES_ID, "analyzed_at", false);
  await ensureKeyIndex(
    databases,
    COLLECTION_MR_EXAM_DEFICIENCIES_ID,
    "idx_mr_def_student_exam",
    ["student_id", "exam_id"],
    ["ASC", "ASC"],
    [KEY_INDEX_PREFIX_SHORT_ID, KEY_INDEX_PREFIX_SHORT_ID]
  );

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
  await createStringAttr(databases, COLLECTION_STUDENTS_ID, "institutionId", 128, false);
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
  await ensureKeyIndex(
    databases,
    COLLECTION_STUDENTS_ID,
    "idx_students_coach_institution",
    ["coach_id", "institutionId"],
    ["ASC", "ASC"],
    [95, 95]
  );
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
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "institutionId", 255, false);
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
  await createStringAttr(databases, COLLECTION_EXAM_RESULTS_ID, "institutionId", 255, false);
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

  logSetupQuotaSummaryIfAny();
  log("");
  var quotaSkipped = Object.keys(ATTR_SKIPPED_FOR_QUOTA).length > 0;
  if (quotaSkipped) {
    log(
      "⚠️  Kurulum kısmen tamam: attribute kotası — bazı sütunlar eklenemedi, bağlı indeksler atlandı. Console’da yer açıp scripti yeniden çalıştırın veya planı yükseltin."
    );
    log("");
  }
  log("🎉 Kurulum tamamlandı. Appwrite Console → Databases → " + DATABASE_ID + " kontrol edin.");
  log("");
  if (quotaSkipped) {
    log("ℹ️  Özet listesi yukarıda; eksikler tamamlanana kadar ilgili özellikler sınırlı kalabilir.");
  } else {
    log("Patron, statik mimariye geçildi, eksik tablolar ve kovalar kuruldu. Her şey hazır!");
  }
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
