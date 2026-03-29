#!/usr/bin/env node
"use strict";

/**
 * SharedBoards koleksiyonu — koç → öğrenci tahta paylaşımı.
 * Çalıştırma: node appwrite-board-share.js  (.env: APPWRITE_PROJECT_ID, APPWRITE_API_KEY, APPWRITE_DATABASE_ID)
 */

const fs = require("fs");
const path = require("path");
const { Client, Databases, Permission, Role, IndexType, Query } = require("node-appwrite");

function loadEnv() {
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

loadEnv();

const ENDPOINT = (process.env.APPWRITE_ENDPOINT || "https://cloud.appwrite.io/v1").replace(/\/$/, "");
const PROJECT = process.env.APPWRITE_PROJECT_ID;
const API_KEY = process.env.APPWRITE_API_KEY;
const DATABASE_ID = process.env.APPWRITE_DATABASE_ID || "derece_panel";
const COLLECTION_ID = "SharedBoards";

const ATTR_POLL_MS = Math.max(500, parseInt(process.env.APPWRITE_ATTR_POLL_MS || "2000", 10) || 2000);
const ATTR_MAX_ATTEMPTS = Math.max(30, parseInt(process.env.APPWRITE_ATTR_MAX_ATTEMPTS || "120", 10) || 120);
const INDEX_POLL_MS = ATTR_POLL_MS;
const INDEX_MAX_ATTEMPTS = Math.max(20, parseInt(process.env.APPWRITE_INDEX_MAX_ATTEMPTS || "80", 10) || 80);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function isNotFound(err) {
  return err && (err.code === 404 || String(err.code) === "404");
}
function isConflict(err) {
  return err && (err.code === 409 || String(err.code) === "409");
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
    if (st === "failed") throw new Error("Attribute " + key + " failed");
    await sleep(ATTR_POLL_MS);
  }
  throw new Error("Attribute " + key + " timeout");
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
    if (st === "failed") throw new Error("Index " + indexKey + " failed");
    await sleep(INDEX_POLL_MS);
  }
  throw new Error("Index " + indexKey + " timeout");
}

async function listAttributeKeys(databases, collectionId) {
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

async function ensureCollection(databases) {
  try {
    await databases.getCollection({ databaseId: DATABASE_ID, collectionId: COLLECTION_ID });
  } catch (e) {
    if (!isNotFound(e)) throw e;
    await databases.createCollection({
      databaseId: DATABASE_ID,
      collectionId: COLLECTION_ID,
      name: "Shared boards (coach → students)",
      permissions: [
        Permission.read(Role.users()),
        Permission.create(Role.users()),
        Permission.update(Role.users()),
        Permission.delete(Role.users()),
      ],
      documentSecurity: false,
      enabled: true,
    });
    console.log("[appwrite-board-share] Koleksiyon oluşturuldu: " + COLLECTION_ID);
  }
}

async function ensureStringAttr(databases, collectionId, key, size, required, keys) {
  if (keys.has(key)) return;
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
    keys.add(key);
    console.log("[appwrite-board-share]  + string: " + key);
  } catch (e) {
    if (isConflict(e)) keys.add(key);
    else throw e;
  }
}

async function ensureStringArrayAttr(databases, collectionId, key, size, required, keys) {
  if (keys.has(key)) return;
  try {
    await databases.createStringAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      size: size,
      required: required,
      array: true,
    });
    await waitForAttribute(databases, collectionId, key);
    keys.add(key);
    console.log("[appwrite-board-share]  + string[]: " + key);
  } catch (e) {
    if (isConflict(e)) keys.add(key);
    else throw e;
  }
}

async function ensureDatetimeAttr(databases, collectionId, key, required, keys) {
  if (keys.has(key)) return;
  try {
    await databases.createDatetimeAttribute({
      databaseId: DATABASE_ID,
      collectionId: collectionId,
      key: key,
      required: required,
    });
    await waitForAttribute(databases, collectionId, key);
    keys.add(key);
    console.log("[appwrite-board-share]  + datetime: " + key);
  } catch (e) {
    if (isConflict(e)) keys.add(key);
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
    console.log("[appwrite-board-share]  + index: " + indexKey);
  } catch (e) {
    if (isConflict(e)) return;
    console.warn("[appwrite-board-share]  ! index atlanamadı (" + indexKey + "):", e && e.message ? e.message : e);
  }
}

async function main() {
  if (!PROJECT || !API_KEY) {
    console.error("[appwrite-board-share] .env içinde APPWRITE_PROJECT_ID ve APPWRITE_API_KEY gerekli.");
    process.exit(1);
  }
  const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT).setKey(API_KEY);
  const databases = new Databases(client);

  await ensureCollection(databases);
  let keys = await listAttributeKeys(databases, COLLECTION_ID);
  await ensureStringAttr(databases, COLLECTION_ID, "board_id", 36, true, keys);
  await ensureStringAttr(databases, COLLECTION_ID, "coach_id", 128, true, keys);
  await ensureStringArrayAttr(databases, COLLECTION_ID, "student_ids", 36, true, keys);
  await ensureDatetimeAttr(databases, COLLECTION_ID, "shared_at", true, keys);
  keys = await listAttributeKeys(databases, COLLECTION_ID);
  if (keys.has("student_ids")) {
    await ensureKeyIndex(databases, COLLECTION_ID, "idx_shared_student_ids", ["student_ids"], ["ASC"]);
  }
  console.log("[appwrite-board-share] Tamam — SharedBoards hazır.");
}

main().catch(function (err) {
  console.error("[appwrite-board-share] Hata:", err && err.message ? err.message : err);
  process.exit(1);
});
