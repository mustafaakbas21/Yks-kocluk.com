#!/usr/bin/env node
/**
 * Sessiz ve kusursuz modül şeması — MR, Görüşme Odası, Haftalık Program, ExamResults tamamlayıcı sütunlar.
 * Mevcut koleksiyon/attribute varsa atlanır; yoksa oluşturulur (.env → APPWRITE_*).
 *
 * Çalıştırma: node appwrite-setup.js
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Client, Databases, Permission, Role, IndexType, Query } = require("node-appwrite");

function loadProjectEnv() {
  const envPath = path.join(__dirname, ".env");
  if (!fs.existsSync(envPath)) return;
  try {
    require("dotenv").config({ path: envPath, override: true });
  } catch (_) {
    const raw = fs.readFileSync(envPath, "utf8").replace(/^\uFEFF/, "");
    raw.split(/\r?\n/).forEach(function (line) {
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
      if (val.length) process.env[key] = val;
    });
  }
}

loadProjectEnv();

function trimEnv(name) {
  return String(process.env[name] || "").trim();
}

const APPWRITE_ENDPOINT = (trimEnv("APPWRITE_ENDPOINT") || "https://cloud.appwrite.io/v1").replace(/\/$/, "");
const APPWRITE_PROJECT_ID = trimEnv("APPWRITE_PROJECT_ID");
const APPWRITE_API_KEY = trimEnv("APPWRITE_API_KEY");
const DATABASE_ID = trimEnv("APPWRITE_DATABASE_ID") || "derece_panel";
const DATABASE_NAME = trimEnv("APPWRITE_DATABASE_NAME") || "Derece Panel";

const COLLECTION_MEETING_LOGS = "meeting_logs";
const COLLECTION_COACH_TASKS = "coach_tasks";
const COLLECTION_SUBJECT_PROGRESS = "subject_progress";
const COLLECTION_EXAM_RESULTS = trimEnv("APPWRITE_COLLECTION_EXAM_RESULTS") || "ExamResults";
const COLLECTION_MR_PROFILES = trimEnv("APPWRITE_COLLECTION_MR_PROFILES") || "mr_student_profiles";

const ATTR_POLL_MS = Math.max(500, parseInt(process.env.APPWRITE_ATTR_POLL_MS || "2000", 10) || 2000);
const ATTR_MAX_ATTEMPTS = Math.max(30, parseInt(process.env.APPWRITE_ATTR_MAX_ATTEMPTS || "120", 10) || 120);
const INDEX_POLL_MS = ATTR_POLL_MS;
const INDEX_MAX_ATTEMPTS = Math.max(20, parseInt(process.env.APPWRITE_INDEX_MAX_ATTEMPTS || "80", 10) || 80);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isNotFound(err) {
  const c = err && err.code;
  return c === 404 || String(c) === "404";
}

function isConflict(err) {
  const c = err && err.code;
  return c === 409 || String(c) === "409";
}

function isAttributeLimitExceeded(err) {
  if (!err) return false;
  if (err.type === "attribute_limit_exceeded") return true;
  const m = String(err.message || "");
  return m.indexOf("attribute_limit") !== -1 || m.indexOf("maximum number") !== -1;
}

function log(msg) {
  console.log("[appwrite-setup] " + msg);
}

function defaultCollectionPermissions() {
  return [
    Permission.read(Role.users()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ];
}

function examResultsCollectionPermissions() {
  return [
    Permission.read(Role.any()),
    Permission.create(Role.users()),
    Permission.update(Role.users()),
    Permission.delete(Role.users()),
  ];
}

async function waitForAttribute(databases, collectionId, key) {
  for (let i = 0; i < ATTR_MAX_ATTEMPTS; i++) {
    const attr = await databases.getAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
    });
    const st = (attr && attr.status) || "";
    if (st === "available") return;
    if (st === "failed") throw new Error("Attribute '" + key + "' failed.");
    await sleep(ATTR_POLL_MS);
  }
  throw new Error("Attribute '" + key + "' timeout.");
}

async function waitForIndex(databases, collectionId, indexKey) {
  for (let i = 0; i < INDEX_MAX_ATTEMPTS; i++) {
    const idx = await databases.getIndex({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: indexKey,
    });
    const st = (idx && idx.status) || "";
    if (st === "available") return;
    if (st === "failed") throw new Error("Index '" + indexKey + "' failed.");
    await sleep(INDEX_POLL_MS);
  }
  throw new Error("Index '" + indexKey + "' timeout.");
}

async function listAttributeKeySet(databases, collectionId) {
  const res = await databases.listAttributes({
    databaseId: DATABASE_ID,
    collectionId: collectionId,
    queries: [Query.limit(200)],
  });
  const set = new Set();
  (res.attributes || []).forEach(function (a) {
    if (a && a.key && a.status !== "failed") set.add(a.key);
  });
  return set;
}

async function ensureDatabase(databases) {
  try {
    await databases.get({ databaseId: DATABASE_ID });
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await databases.create({
      databaseId: DATABASE_ID,
      name: DATABASE_NAME,
      enabled: true,
    });
    log("Veritabanı oluşturuldu: " + DATABASE_ID);
  }
}

async function ensureCollection(databases, collectionId, displayName, permissions) {
  try {
    await databases.getCollection({ databaseId: DATABASE_ID, collectionId: collectionId });
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      name: displayName,
      permissions: permissions || defaultCollectionPermissions(),
      documentSecurity: false,
      enabled: true,
    });
    log("Koleksiyon oluşturuldu: " + collectionId);
  }
}

async function ensureStringAttr(databases, collectionId, key, size, required, existingKeys) {
  if (existingKeys.has(key)) return;
  try {
    await databases.createStringAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      size: size,
      required: required,
      array: false,
    });
    await waitForAttribute(databases, collectionId, key);
    existingKeys.add(key);
    log("  + string: " + key);
  } catch (e) {
    if (isConflict(e)) existingKeys.add(key);
    else if (isAttributeLimitExceeded(e)) log("  ! kota: " + key);
    else throw e;
  }
}

async function ensureTextAttr(databases, collectionId, key, required, existingKeys) {
  if (existingKeys.has(key)) return;
  try {
    await databases.createTextAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
      array: false,
    });
    await waitForAttribute(databases, collectionId, key);
    existingKeys.add(key);
    log("  + text: " + key);
  } catch (e) {
    if (isConflict(e)) existingKeys.add(key);
    else if (isAttributeLimitExceeded(e)) log("  ! kota: " + key);
    else throw e;
  }
}

async function ensureDatetimeAttr(databases, collectionId, key, required, existingKeys) {
  if (existingKeys.has(key)) return;
  try {
    await databases.createDatetimeAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
      array: false,
    });
    await waitForAttribute(databases, collectionId, key);
    existingKeys.add(key);
    log("  + datetime: " + key);
  } catch (e) {
    if (isConflict(e)) existingKeys.add(key);
    else if (isAttributeLimitExceeded(e)) log("  ! kota: " + key);
    else throw e;
  }
}

async function ensureIntegerAttr(databases, collectionId, key, required, min, max, existingKeys) {
  if (existingKeys.has(key)) return;
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
    await waitForAttribute(databases, collectionId, key);
    existingKeys.add(key);
    log("  + integer: " + key);
  } catch (e) {
    if (isConflict(e)) existingKeys.add(key);
    else if (isAttributeLimitExceeded(e)) log("  ! kota: " + key);
    else throw e;
  }
}

async function ensureBooleanAttr(databases, collectionId, key, required, existingKeys) {
  if (existingKeys.has(key)) return;
  try {
    await databases.createBooleanAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
      array: false,
    });
    await waitForAttribute(databases, collectionId, key);
    existingKeys.add(key);
    log("  + boolean: " + key);
  } catch (e) {
    if (isConflict(e)) existingKeys.add(key);
    else if (isAttributeLimitExceeded(e)) log("  ! kota: " + key);
    else throw e;
  }
}

async function ensureKeyIndex(databases, collectionId, indexKey, attributes, orders) {
  try {
    await databases.createIndex({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: indexKey,
      type: IndexType.Key,
      attributes: attributes,
      orders: orders,
    });
    await waitForIndex(databases, collectionId, indexKey);
    log("  + index: " + indexKey);
  } catch (e) {
    if (isConflict(e)) return;
    throw e;
  }
}

async function setupMeetingLogs(databases) {
  log("meeting_logs (Görüşme notları) …");
  await ensureCollection(databases, COLLECTION_MEETING_LOGS, "Görüşme notları");
  let keys = await listAttributeKeySet(databases, COLLECTION_MEETING_LOGS);
  await ensureStringAttr(databases, COLLECTION_MEETING_LOGS, "coach_id", 128, true, keys);
  await ensureStringAttr(databases, COLLECTION_MEETING_LOGS, "student_id", 255, true, keys);
  await ensureStringAttr(databases, COLLECTION_MEETING_LOGS, "student_name", 512, false, keys);
  await ensureTextAttr(databases, COLLECTION_MEETING_LOGS, "body_html", false, keys);
  await ensureDatetimeAttr(databases, COLLECTION_MEETING_LOGS, "saved_at", true, keys);
  await ensureDatetimeAttr(databases, COLLECTION_MEETING_LOGS, "date", false, keys);
  await ensureStringAttr(databases, COLLECTION_MEETING_LOGS, "notes", 5000, false, keys);
  keys = await listAttributeKeySet(databases, COLLECTION_MEETING_LOGS);
  if (keys.has("student_id")) {
    await ensureKeyIndex(databases, COLLECTION_MEETING_LOGS, "idx_meeting_student", ["student_id"], ["ASC"]);
  }
  if (keys.has("coach_id")) {
    await ensureKeyIndex(databases, COLLECTION_MEETING_LOGS, "idx_meeting_coach", ["coach_id"], ["ASC"]);
  }
}

async function setupCoachTasks(databases) {
  log("coach_tasks (Haftalık program / görevler) …");
  await ensureCollection(databases, COLLECTION_COACH_TASKS, "Koç görevleri");
  let keys = await listAttributeKeySet(databases, COLLECTION_COACH_TASKS);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "title", 512, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "description", 3000, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "studentId", 255, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "studentName", 512, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "dueDate", 64, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "priority", 64, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "subject", 256, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "column", 32, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "coach_id", 128, false, keys);
  await ensureDatetimeAttr(databases, COLLECTION_COACH_TASKS, "createdAt", false, keys);
  await ensureDatetimeAttr(databases, COLLECTION_COACH_TASKS, "updatedAt", false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "student_id", 255, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "lesson", 256, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "topic", 512, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "task_type", 64, false, keys);
  await ensureIntegerAttr(databases, COLLECTION_COACH_TASKS, "target_questions", false, 0, 999999, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "resource_book", 512, false, keys);
  await ensureStringAttr(databases, COLLECTION_COACH_TASKS, "status", 64, false, keys);
  await ensureDatetimeAttr(databases, COLLECTION_COACH_TASKS, "date", false, keys);
  keys = await listAttributeKeySet(databases, COLLECTION_COACH_TASKS);
  if (keys.has("studentId")) {
    await ensureKeyIndex(databases, COLLECTION_COACH_TASKS, "idx_ctasks_studentId", ["studentId"], ["ASC"]);
  }
}

async function setupSubjectProgress(databases) {
  log("subject_progress (SubjectProgress / MR satır verisi) …");
  await ensureCollection(databases, COLLECTION_SUBJECT_PROGRESS, "Konu ilerleme (MR)");
  let keys = await listAttributeKeySet(databases, COLLECTION_SUBJECT_PROGRESS);
  await ensureStringAttr(databases, COLLECTION_SUBJECT_PROGRESS, "student_id", 255, true, keys);
  await ensureStringAttr(databases, COLLECTION_SUBJECT_PROGRESS, "coach_id", 128, false, keys);
  await ensureStringAttr(databases, COLLECTION_SUBJECT_PROGRESS, "lesson", 256, false, keys);
  await ensureStringAttr(databases, COLLECTION_SUBJECT_PROGRESS, "topic", 512, false, keys);
  await ensureBooleanAttr(databases, COLLECTION_SUBJECT_PROGRESS, "is_completed", false, keys);
  await ensureIntegerAttr(databases, COLLECTION_SUBJECT_PROGRESS, "questions_solved", false, 0, 10000000, keys);
  await ensureDatetimeAttr(databases, COLLECTION_SUBJECT_PROGRESS, "updatedAt", false, keys);
  keys = await listAttributeKeySet(databases, COLLECTION_SUBJECT_PROGRESS);
  if (keys.has("student_id")) {
    await ensureKeyIndex(databases, COLLECTION_SUBJECT_PROGRESS, "idx_sp_student", ["student_id"], ["ASC"]);
  }
}

async function setupMrProfiles(databases) {
  log("mr_student_profiles (MR kokpit) …");
  await ensureCollection(databases, COLLECTION_MR_PROFILES, "MR (Emar) öğrenci profili");
  let keys = await listAttributeKeySet(databases, COLLECTION_MR_PROFILES);
  await ensureStringAttr(databases, COLLECTION_MR_PROFILES, "student_id", 255, true, keys);
  await ensureStringAttr(databases, COLLECTION_MR_PROFILES, "coach_id", 128, true, keys);
  await ensureTextAttr(databases, COLLECTION_MR_PROFILES, "konu_json", false, keys);
  await ensureTextAttr(databases, COLLECTION_MR_PROFILES, "soru_json", false, keys);
  await ensureDatetimeAttr(databases, COLLECTION_MR_PROFILES, "updatedAt", false, keys);
  keys = await listAttributeKeySet(databases, COLLECTION_MR_PROFILES);
  if (keys.has("student_id")) {
    await ensureKeyIndex(databases, COLLECTION_MR_PROFILES, "idx_mr_student", ["student_id"], ["ASC"]);
  }
}

async function setupExamResults(databases) {
  log("ExamResults (saved_at / coach_id sorguları) …");
  try {
    await databases.getCollection({ databaseId: DATABASE_ID, collectionId: COLLECTION_EXAM_RESULTS });
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: COLLECTION_EXAM_RESULTS,
      name: "Deneme Sonuçları (Optik)",
      permissions: examResultsCollectionPermissions(),
      documentSecurity: false,
      enabled: true,
    });
    log("ExamResults koleksiyonu oluşturuldu.");
  }
  let keys = await listAttributeKeySet(databases, COLLECTION_EXAM_RESULTS);
  await ensureStringAttr(databases, COLLECTION_EXAM_RESULTS, "exam_id", 255, true, keys);
  await ensureStringAttr(databases, COLLECTION_EXAM_RESULTS, "student_id", 255, true, keys);
  await ensureStringAttr(databases, COLLECTION_EXAM_RESULTS, "coach_id", 128, false, keys);
  await ensureStringAttr(databases, COLLECTION_EXAM_RESULTS, "exam_name", 512, false, keys);
  await ensureStringAttr(databases, COLLECTION_EXAM_RESULTS, "detail_json", 5000, true, keys);
  await ensureDatetimeAttr(databases, COLLECTION_EXAM_RESULTS, "saved_at", true, keys);
  keys = await listAttributeKeySet(databases, COLLECTION_EXAM_RESULTS);
  if (keys.has("student_id") && keys.has("saved_at")) {
    await ensureKeyIndex(databases, COLLECTION_EXAM_RESULTS, "idx_er_student_saved_at", ["student_id", "saved_at"], ["ASC", "DESC"]);
  }
  if (keys.has("coach_id") && keys.has("student_id") && keys.has("saved_at")) {
    await ensureKeyIndex(
      databases,
      COLLECTION_EXAM_RESULTS,
      "idx_er_coach_student_saved_at",
      ["coach_id", "student_id", "saved_at"],
      ["ASC", "ASC", "DESC"]
    );
  }
}

async function main() {
  if (!APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
    console.error("[appwrite-setup] Hata: .env içinde APPWRITE_PROJECT_ID ve APPWRITE_API_KEY gerekli.");
    process.exit(1);
  }

  const client = new Client()
    .setEndpoint(APPWRITE_ENDPOINT)
    .setProject(APPWRITE_PROJECT_ID)
    .setKey(APPWRITE_API_KEY);
  const databases = new Databases(client);

  log("Başlıyor… DB=" + DATABASE_ID + " @ " + APPWRITE_ENDPOINT);
  await ensureDatabase(databases);

  await setupMeetingLogs(databases);
  await setupCoachTasks(databases);
  await setupSubjectProgress(databases);
  await setupMrProfiles(databases);
  await setupExamResults(databases);

  log("✅ Tamam.");
}

main().catch(function (err) {
  console.error("[appwrite-setup] Hata:", err && err.message ? err.message : err);
  process.exit(1);
});
