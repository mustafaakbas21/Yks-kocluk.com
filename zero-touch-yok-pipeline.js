#!/usr/bin/env node
"use strict";

/**
 * İsteğe bağlı: Açık kaynak JSON indirir (Appwrite’a yazmaz).
 * Net Sihirbazı / hedef seçici `src/data/yks-data.json` kullanır; patron veriyi bu dosyaya yapıştırır.
 *
 * Çalıştırma:
 *   node --env-file=.env zero-touch-yok-pipeline.js
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

const DEFAULT_PUBLIC_UNI_JSON =
  "https://raw.githubusercontent.com/ertanyildiz/turkiye-universite-bolum-json/master/jsonformatter.json";

const OUT_REL = path.join("data", "yks-veri.json");
const OUT_FILE = path.join(__dirname, OUT_REL);

function fetchUrl() {
  return String(process.env.YOK_ATLAS_JSON_URL || process.env.ZERO_TOUCH_JSON_URL || DEFAULT_PUBLIC_UNI_JSON).trim();
}

async function main() {
  const url = fetchUrl();
  console.log("");
  console.log("Kaynak URL:", url);
  const res = await fetch(url, {
    headers: {
      "User-Agent": "YKS-Kocluk-zero-touch-pipeline/2.0 (+https://github.com)",
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
  console.log("");
  console.log("Not: Uygulama üniversite listesini src/data/yks-data.json dosyasından okur; indirilen dosyayı bu şemaya göre dönüştürüp yapıştırın.");
}

main().catch(function (err) {
  console.error("[Zero-Touch] Hata:", err && err.message ? err.message : err);
  process.exit(1);
});
