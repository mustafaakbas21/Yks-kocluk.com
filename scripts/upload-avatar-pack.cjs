#!/usr/bin/env node
/**
 * 40 adet 512×512 dairesel PNG üretir (Dicebear avataaars → sharp mask) ve
 * Appwrite Storage `avatarlar` kovasına yükler: male_01…male_20, female_01…female_20.
 *
 * Gerekli: .env içinde APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
 * Çalıştırma: npm run upload:avatars
 */
"use strict";

const fs = require("fs");
const path = require("path");
const { Client, Storage } = require("node-appwrite");

function loadProjectEnv() {
  const envPath = path.join(__dirname, "..", ".env");
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

const sharp = require("sharp");
const { InputFile } = require("node-appwrite/file");

const ENDPOINT = String(process.env.APPWRITE_ENDPOINT || "").trim().replace(/\/$/, "");
const PROJECT_ID = String(process.env.APPWRITE_PROJECT_ID || "").trim();
const API_KEY = String(process.env.APPWRITE_API_KEY || "").trim();
/** `.env`: APPWRITE_AVATAR_BUCKET_ID=... (yoksa soru_havuzu — tek kovalı Appwrite planları) */
const BUCKET_ID = String(process.env.APPWRITE_AVATAR_BUCKET_ID || "soru_havuzu").trim();

const YKS_HD_BG = ["b6e3f4", "c0aede", "ffd5dc", "d1d4f9", "ffdfbf", "bae6fd", "bbf7d0", "fde68a"];

function dicebearUrlMale(i) {
  return (
    "https://api.dicebear.com/7.x/avataaars/png?seed=" +
    encodeURIComponent("yks_hd_m_" + String(i).padStart(2, "0")) +
    "&size=512&backgroundColor=" +
    YKS_HD_BG[(i - 1) % YKS_HD_BG.length]
  );
}

function dicebearUrlFemale(i) {
  return (
    "https://api.dicebear.com/7.x/avataaars/png?seed=" +
    encodeURIComponent("yks_hd_f_" + String(i).padStart(2, "0")) +
    "&size=512&backgroundColor=" +
    YKS_HD_BG[(i + 3) % YKS_HD_BG.length]
  );
}

async function fetchPng(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("HTTP " + res.status + " " + url);
  return Buffer.from(await res.arrayBuffer());
}

async function toCircularPng512(inputBuf) {
  const mask = Buffer.from(
    '<svg width="512" height="512" xmlns="http://www.w3.org/2000/svg">' +
      '<circle cx="256" cy="256" r="256" fill="#ffffff"/>' +
      "</svg>"
  );
  return sharp(inputBuf)
    .resize(512, 512, { fit: "cover", position: "centre" })
    .ensureAlpha()
    .composite([{ input: mask, blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function uploadOne(storage, fileId, filename, pngBuffer) {
  const file = InputFile.fromBuffer(pngBuffer, filename);
  try {
    await storage.deleteFile(BUCKET_ID, fileId);
  } catch (_) {}
  await storage.createFile(BUCKET_ID, fileId, file);
}

async function ensureAvatarBucketReadable(storage) {
  try {
    await storage.getBucket(BUCKET_ID);
  } catch (e) {
    console.error(
      "Kova bulunamadı: " +
        BUCKET_ID +
        ". Appwrite Console’da kovayı oluşturun veya .env içinde APPWRITE_AVATAR_BUCKET_ID ayarlayın."
    );
    throw e;
  }
}

async function main() {
  if (!ENDPOINT || !PROJECT_ID || !API_KEY) {
    console.error("Eksik .env: APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY");
    process.exit(1);
  }

  const client = new Client().setEndpoint(ENDPOINT).setProject(PROJECT_ID).setKey(API_KEY);
  const storage = new Storage(client);

  await ensureAvatarBucketReadable(storage);

  console.log("Avatar paketi yükleniyor → bucket: " + BUCKET_ID);

  for (let i = 1; i <= 20; i++) {
    const id = "male_" + String(i).padStart(2, "0");
    const name = "male-" + String(i).padStart(2, "0") + ".png";
    process.stdout.write("  " + name + " … ");
    const raw = await fetchPng(dicebearUrlMale(i));
    const png = await toCircularPng512(raw);
    await uploadOne(storage, id, name, png);
    console.log("OK");
    await new Promise(function (r) {
      setTimeout(r, 120);
    });
  }

  for (let j = 1; j <= 20; j++) {
    const id = "female_" + String(j).padStart(2, "0");
    const name = "female-" + String(j).padStart(2, "0") + ".png";
    process.stdout.write("  " + name + " … ");
    const raw = await fetchPng(dicebearUrlFemale(j));
    const png = await toCircularPng512(raw);
    await uploadOne(storage, id, name, png);
    console.log("OK");
    await new Promise(function (r) {
      setTimeout(r, 120);
    });
  }

  console.log("Tamam: 40 dosya yüklendi (male_01…male_20, female_01…female_20).");
}

main().catch(function (e) {
  console.error(e);
  process.exit(1);
});
