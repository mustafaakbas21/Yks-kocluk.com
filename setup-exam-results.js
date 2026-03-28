#!/usr/bin/env node
"use strict";

/**
 * Appwrite `ExamResults` koleksiyonu + sütunlar + indeksler (Karne V2 / Akıllı Optik).
 *
 * Alanlar (uygulama referansı: _YEDEKLER_VE_COPLER/_eski_kodlar_arsivi/js/exam-results-appwrite.js):
 *   exam_id, student_id, coach_id?, exam_name?, detail_json, saved_at
 * Puan / konu dökümü `detail_json` içindedir; ayrı `score` sütunu kullanılmaz.
 *
 * Çalıştırma (önce kökte `.env` oluşturun; `.env.example` şablonu):
 *   node setup-exam-results.js
 *
 * İçeride `setup-appwrite.js --only-exam-results` tetiklenir.
 */

const path = require("path");
const { spawnSync } = require("child_process");

try {
  require("dotenv").config();
} catch (_) {}

const fs = require("fs");
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
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

var script = path.join(__dirname, "setup-appwrite.js");
var r = spawnSync(process.execPath, [script, "--only-exam-results"], {
  cwd: __dirname,
  stdio: "inherit",
  env: process.env,
});
process.exit(r.status !== 0 && r.status != null ? r.status : r.error ? 1 : 0);
