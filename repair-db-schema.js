#!/usr/bin/env node
/**
 * Appwrite derece_panel: users, coaches, students koleksiyonlarını ve
 * email (email), name (string), role (string) şemasını onarır.
 *
 * Ortam: APPWRITE_API_KEY (zorunlu), APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_DATABASE_ID
 *
 * Çalıştır: node repair-db-schema.js
 */

import { Client, Databases, Permission, Role } from "node-appwrite";

const DEFAULT_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
const DEFAULT_PROJECT_ID = "69c12f05001b051b2f14";
const DEFAULT_DATABASE_ID = "derece_panel";

const COLLECTIONS = [
  { id: "users", name: "Users" },
  { id: "coaches", name: "Coaches" },
  { id: "students", name: "Students" },
];

const STRING_SIZE = 512;
const POLL_MS = 600;
const ATTR_TIMEOUT_MS = 180000;

function env(name, fallback) {
  var v = process.env[name];
  return v != null && String(v).trim() !== "" ? String(v).trim() : fallback;
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function waitForAttribute(databases, databaseId, collectionId, key) {
  var start = Date.now();
  for (;;) {
    if (Date.now() - start > ATTR_TIMEOUT_MS) {
      throw new Error(
        "Zaman aşımı: " + collectionId + "." + key + " hâlâ hazır değil (max " + ATTR_TIMEOUT_MS + "ms)"
      );
    }
    var attr = await databases.getAttribute({
      databaseId: databaseId,
      collectionId: collectionId,
      key: key,
    });
    var st = attr && attr.status ? String(attr.status) : "";
    if (st === "available") {
      console.log("  ✓ " + collectionId + "." + key + " → available");
      return;
    }
    if (st === "failed") {
      throw new Error(
        collectionId + "." + key + " oluşturma başarısız: " + (attr.error || JSON.stringify(attr))
      );
    }
    process.stdout.write("  … " + collectionId + "." + key + " (" + st + ")\r");
    await sleep(POLL_MS);
  }
}

async function ensureDatabase(databases, databaseId) {
  try {
    await databases.get({ databaseId: databaseId });
    console.log("[repair] Veritabanı mevcut:", databaseId);
  } catch (e) {
    if (e.code !== 404) throw e;
    await databases.create({
      databaseId: databaseId,
      name: "Derece Panel",
      enabled: true,
    });
    console.log("[repair] Veritabanı oluşturuldu:", databaseId);
  }
}

var defaultCollectionPermissions = [
  Permission.read(Role.users()),
  Permission.create(Role.users()),
  Permission.update(Role.users()),
  Permission.delete(Role.users()),
];

async function ensureCollection(databases, databaseId, collectionId, displayName) {
  try {
    await databases.getCollection({
      databaseId: databaseId,
      collectionId: collectionId,
    });
    console.log("[repair] Koleksiyon var:", collectionId);
  } catch (e) {
    if (e.code !== 404) throw e;
    await databases.createCollection({
      databaseId: databaseId,
      collectionId: collectionId,
      name: displayName,
      permissions: defaultCollectionPermissions,
      documentSecurity: false,
      enabled: true,
    });
    console.log("[repair] Koleksiyon oluşturuldu:", collectionId);
    await sleep(800);
  }
}

async function ensureEmailAttribute(databases, databaseId, collectionId) {
  var key = "email";
  try {
    var existing = await databases.getAttribute({
      databaseId: databaseId,
      collectionId: collectionId,
      key: key,
    });
    if (existing.status === "available") {
      console.log("  ✓ " + collectionId + "." + key + " zaten available");
      return;
    }
    console.log("[repair] " + collectionId + "." + key + " mevcut, bekleniyor…");
    await waitForAttribute(databases, databaseId, collectionId, key);
    return;
  } catch (e) {
    if (e.code !== 404) throw e;
  }
  console.log("[repair] " + collectionId + " → email attribute oluşturuluyor…");
  try {
    await databases.createEmailAttribute({
      databaseId: databaseId,
      collectionId: collectionId,
      key: key,
      required: false,
    });
  } catch (e) {
    var msg = e && e.message ? String(e.message) : "";
    if (e.code !== 409 && !/already exists|duplicate/i.test(msg)) throw e;
    console.log("[repair] email atributu zaten tanımlı (409), senkron bekleniyor…");
  }
  await waitForAttribute(databases, databaseId, collectionId, key);
}

async function ensureStringAttribute(databases, databaseId, collectionId, key) {
  try {
    var existing = await databases.getAttribute({
      databaseId: databaseId,
      collectionId: collectionId,
      key: key,
    });
    if (existing.status === "available") {
      console.log("  ✓ " + collectionId + "." + key + " zaten available");
      return;
    }
    console.log("[repair] " + collectionId + "." + key + " mevcut, bekleniyor…");
    await waitForAttribute(databases, databaseId, collectionId, key);
    return;
  } catch (e) {
    if (e.code !== 404) throw e;
  }
  console.log("[repair] " + collectionId + " → " + key + " (string) oluşturuluyor…");
  try {
    await databases.createStringAttribute({
      databaseId: databaseId,
      collectionId: collectionId,
      key: key,
      size: STRING_SIZE,
      required: false,
    });
  } catch (e) {
    var msg = e && e.message ? String(e.message) : "";
    if (e.code !== 409 && !/already exists|duplicate/i.test(msg)) throw e;
    console.log("[repair] " + key + " zaten tanımlı (409), senkron bekleniyor…");
  }
  await waitForAttribute(databases, databaseId, collectionId, key);
}

async function repairCollection(databases, databaseId, meta) {
  console.log("\n--- " + meta.id + " ---");
  await ensureCollection(databases, databaseId, meta.id, meta.name);
  await ensureEmailAttribute(databases, databaseId, meta.id);
  await ensureStringAttribute(databases, databaseId, meta.id, "name");
  await ensureStringAttribute(databases, databaseId, meta.id, "role");
}

async function main() {
  var apiKey = env("APPWRITE_API_KEY", null);
  if (!apiKey) {
    console.error("[repair] APPWRITE_API_KEY tanımlı değil.");
    process.exit(1);
  }

  var endpoint = env("APPWRITE_ENDPOINT", DEFAULT_ENDPOINT);
  var projectId = env("APPWRITE_PROJECT_ID", DEFAULT_PROJECT_ID);
  var databaseId = env("APPWRITE_DATABASE_ID", DEFAULT_DATABASE_ID);

  var client = new Client().setEndpoint(endpoint).setProject(projectId).setKey(apiKey);

  var databases = new Databases(client);

  console.log("[repair] Endpoint:", endpoint);
  console.log("[repair] Project:", projectId);
  console.log("[repair] Database:", databaseId);

  await ensureDatabase(databases, databaseId);

  for (var i = 0; i < COLLECTIONS.length; i++) {
    await repairCollection(databases, databaseId, COLLECTIONS[i]);
  }

  console.log("\n[repair] Tamam. email, name, role şeması üç koleksiyonda da kullanılabilir olmalı.");
}

main().catch(function (err) {
  console.error(
    "[repair] HATA:",
    err && err.message != null ? err.message : err,
    err && err.code != null ? "(code: " + err.code + ")" : ""
  );
  if (err && err.response) console.error(String(err.response));
  process.exit(1);
});
