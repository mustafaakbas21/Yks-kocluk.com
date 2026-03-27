#!/usr/bin/env node
"use strict";

/**
 * Sıfır Temas — YÖK/üniversite JSON’u internetten çeker, projeye yazar, Appwrite’a aktarır.
 *
 * Aşama 1: HTTP(S) ile JSON indir → data/yks-veri.json
 * Aşama 2: Birkaç saniye sonra → node auto-fetch-yokatlas.js <dosya> (150ms rate limit içeride)
 *
 * Ortam (.env):
 *   APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY
 *   YOK_ATLAS_JSON_URL — özel kaynak (yoksa herkese açık varsayılan GitHub raw kullanılır)
 *   ZERO_TOUCH_JSON_URL — YOK_ATLAS_JSON_URL yokken kullanılacak alternatif URL
 *   ZERO_TOUCH_PAUSE_MS — Aşamalar arası bekleme (varsayılan 3000)
 *   APPWRITE_IMPORT_DELAY_MS — içe aktarımda createDocument arası ms (varsayılan 150)
 *
 * Çalıştırma:
 *   node --env-file=.env zero-touch-yok-pipeline.js
 */

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

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

/** Türkiye üniversite + bölüm listesi (açık kaynak, universities[] + departments[] yapısı) */
const DEFAULT_PUBLIC_UNI_JSON =
  "https://raw.githubusercontent.com/ertanyildiz/turkiye-universite-bolum-json/master/jsonformatter.json";

const OUT_REL = path.join("data", "yks-veri.json");
const OUT_FILE = path.join(__dirname, OUT_REL);
const PAUSE_MS = Math.max(0, parseInt(process.env.ZERO_TOUCH_PAUSE_MS || "3000", 10) || 3000);

function fetchUrl() {
  return String(process.env.YOK_ATLAS_JSON_URL || process.env.ZERO_TOUCH_JSON_URL || DEFAULT_PUBLIC_UNI_JSON).trim();
}

async function stage1Download(url) {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Zero-Touch — Aşama 1: Veri çekiliyor (Auto-Fetch)      ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  console.log("Kaynak URL:", url);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "YKS-Kocluk-zero-touch-pipeline/1.0 (+https://github.com)",
      Accept: "application/json, */*",
    },
  });
  if (!res.ok) {
    throw new Error("HTTP " + res.status + " " + res.statusText);
  }
  const text = await res.text();
  try {
    JSON.parse(text);
  } catch (e) {
    throw new Error("İndirilen gövde geçerli JSON değil: " + (e && e.message ? e.message : e));
  }
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, text, "utf8");
  console.log("✓ Diske yazıldı:", OUT_REL, "(" + Buffer.byteLength(text, "utf8") + " byte)");
}

async function stagePause() {
  console.log("");
  console.log("[Zero-Touch] Aşamalar arası " + PAUSE_MS + " ms bekleniyor…");
  await new Promise(function (resolve) {
    setTimeout(resolve, PAUSE_MS);
  });
}

function stage2Import() {
  console.log("");
  console.log("╔══════════════════════════════════════════════════════════╗");
  console.log("║  Zero-Touch — Aşama 2: Appwrite (Auto-Import)           ║");
  console.log("╚══════════════════════════════════════════════════════════╝");
  const importScript = path.join(__dirname, "auto-fetch-yokatlas.js");
  const result = spawnSync(process.execPath, [importScript, OUT_FILE], {
    cwd: __dirname,
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    process.exit(result.status == null ? 1 : result.status);
  }
}

async function main() {
  const url = fetchUrl();
  await stage1Download(url);
  await stagePause();
  stage2Import();
  console.log("");
  console.log("Patron, veri çekildi ve veritabanına sıfır el değmeden yüklendi.");
}

main().catch(function (err) {
  console.error("[Zero-Touch] Hata:", err && err.message ? err.message : err);
  process.exit(1);
});
