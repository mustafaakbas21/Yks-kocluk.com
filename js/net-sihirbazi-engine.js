/**
 * TYT-AYT Net Sihirbazı — hedef motoru: soru üst sınırı, Appwrite Programs.rowsJson, clamp / filtre.
 * Program çözümü: `buildProgramFromAppwriteV2` (Universities + Programs).
 */

import { YKS_AYT_BY_ALAN, YKS_TYT_BRANCHES } from "./yks-exam-structure.js";
import {
  filterSimulatorRowsForStudentAlan,
  normalizeStudentYksAlanKey,
} from "./hedef-atlas-helpers.js";

/** Soru sayısı üst sınırları — hesaplanan/hedef net asla bunları aşamaz (TYT Fen max 20 vb.). */
export const MAX_QUESTIONS = {
  TYT: { Turkce: 40, Sosyal: 20, Matematik: 40, Fen: 20 },
  AYT_SAYISAL: { Matematik: 40, Fizik: 14, Kimya: 13, Biyoloji: 13 },
  AYT_EA: {
    Matematik: 40,
    "Türk Dili ve Edebiyatı": 24,
    "Tarih-1": 10,
    "Coğrafya-1": 6,
  },
  AYT_SOZEL: {
    "Türk Dili ve Edebiyatı": 24,
    "Tarih-1": 11,
    "Tarih-2": 11,
    "Coğrafya-1": 6,
    "Coğrafya-2": 11,
    "Felsefe Grubu": 12,
    "Din Kültürü": 6,
  },
  AYT_DIL: {
    "Yabancı Dil": 80,
    "Türk Dili ve Edebiyatı": 24,
    "Tarih-1": 11,
    "Coğrafya-1": 6,
  },
};

function hashStr(s) {
  var h = 0;
  var str = String(s || "");
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** @typedef {"sayisal"|"ea"|"sozel"|"dil"} PuanGroup */

/**
 * Appwrite Programs.alanKey → motor puan grubu.
 */
export function puanGroupFromAlanKey(alanKey) {
  var raw = String(alanKey || "").trim().toLowerCase();
  var k = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (k === "esit_agirlik" || k === "ea" || (k.indexOf("esit") !== -1 && k.indexOf("agir") !== -1)) return "ea";
  if (k === "sozel" || raw.indexOf("sözel") !== -1) return "sozel";
  if (k === "dil") return "dil";
  return "sayisal";
}

function puanGroupToAlanKey(pg) {
  if (pg === "ea") return "esit_agirlik";
  if (pg === "sozel") return "sozel";
  if (pg === "dil") return "dil";
  return "sayisal";
}

function studentStubForPuanGroup(pg) {
  var ft = { sayisal: "sayısal", ea: "eşit ağırlık", sozel: "sözel", dil: "dil" }[pg] || "sayısal";
  return { fieldType: ft };
}

function maxTytForName(name) {
  var n = String(name || "").toLocaleLowerCase("tr");
  if (n.indexOf("fen") !== -1) return MAX_QUESTIONS.TYT.Fen;
  if (n.indexOf("sosyal") !== -1) return MAX_QUESTIONS.TYT.Sosyal;
  if (n.indexOf("matematik") !== -1 || n.indexOf("temel") !== -1) return MAX_QUESTIONS.TYT.Matematik;
  if (n.indexOf("türk") !== -1) return MAX_QUESTIONS.TYT.Turkce;
  return MAX_QUESTIONS.TYT.Turkce;
}

function maxAytForName(name, pg) {
  var n = String(name || "").trim();
  var map =
    pg === "sayisal"
      ? MAX_QUESTIONS.AYT_SAYISAL
      : pg === "ea"
        ? MAX_QUESTIONS.AYT_EA
        : pg === "sozel"
          ? MAX_QUESTIONS.AYT_SOZEL
          : MAX_QUESTIONS.AYT_DIL;
  if (map[n] != null) return map[n];
  var low = n.toLocaleLowerCase("tr");
  for (var k in map) {
    if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
    if (low.indexOf(k.toLocaleLowerCase("tr")) !== -1) return map[k];
  }
  var pack = YKS_AYT_BY_ALAN[puanGroupToAlanKey(pg)] || YKS_AYT_BY_ALAN.sayisal;
  for (var i = 0; i < pack.branches.length; i++) {
    var lb = pack.branches[i].label.toLocaleLowerCase("tr");
    if (low.indexOf(lb) !== -1) return pack.branches[i].soru;
  }
  return 40;
}

/**
 * Tek satır hedef netini soru üst sınırına göre kısar.
 * @param {{ section: string, name: string, targetNet?: number }} row
 * @param {PuanGroup} pg
 */
export function clampRowTargetNet(row, pg) {
  var sec = String(row.section || "").toUpperCase();
  var t = Number(row.targetNet);
  if (isNaN(t) || t < 0) t = 0;
  var max = sec === "TYT" ? maxTytForName(row.name) : maxAytForName(row.name, pg);
  return Math.round(Math.min(max, t) * 10) / 10;
}

/**
 * @param {Array<{ section: string, name: string, targetNet: number }>} rows
 * @param {PuanGroup} pg
 */
export function clampAllRowTargets(rows, pg) {
  return (rows || []).map(function (r) {
    return {
      section: r.section,
      name: r.name,
      targetNet: clampRowTargetNet(r, pg),
    };
  });
}

/**
 * Şablondaki AYT yapısına uygun olmayan satırları çıkarır (sayısalda edebiyat vb. yok).
 */
export function filterRowsByPuanGroup(rows, pg) {
  if (pg === "dil") {
    return (rows || []).filter(function (r) {
      var sec = String(r.section || "").toUpperCase();
      if (sec !== "AYT") return true;
      var n = String(r.name || "").toLocaleLowerCase("tr");
      if (/tarih-2|coğrafya-2|felsefe|din\s*kültür/i.test(n)) return false;
      return (
        /yabancı|ydt/.test(n) ||
        /türk\s*dili|edebiyat/.test(n) ||
        n.indexOf("tarih-1") !== -1 ||
        n.indexOf("coğrafya-1") !== -1
      );
    });
  }
  var stub = studentStubForPuanGroup(pg);
  var alan = normalizeStudentYksAlanKey(stub);
  var shaped = (rows || []).map(function (r) {
    return {
      section: r.section,
      name: r.name,
      targetNet: r.targetNet,
      label: String(r.section || "") + " " + String(r.name || ""),
      current: 0,
      target: Number(r.targetNet) || 0,
    };
  });
  var filtered = filterSimulatorRowsForStudentAlan(shaped, alan);
  return filtered.map(function (r) {
    return { section: r.section, name: r.name, targetNet: r.targetNet };
  });
}

/**
 * Appwrite V2: Universities + Programs dökümanlarından program nesnesi.
 * @param {{ name?: string, universityName?: string }} uniDoc
 * @param {object} programDoc — Programs (uniId, name, targetTytNet, targetAytNet, alanKey, rowsJson)
 * @returns {{ id: string, university: string, department: string, baseScore2025: number, rows: Array, dataSource: string, puanGroup: PuanGroup, targetTytNet: number, targetAytNet: number }|null}
 */
export function buildProgramFromAppwriteV2(uniDoc, programDoc) {
  try {
    if (!uniDoc || !programDoc) return null;
    var uniName =
      uniDoc.uniName != null && String(uniDoc.uniName).trim() !== ""
        ? String(uniDoc.uniName)
        : uniDoc.name != null
          ? String(uniDoc.name)
          : uniDoc.universityName != null
            ? String(uniDoc.universityName)
            : "";
    var dept =
      programDoc.programName != null && String(programDoc.programName).trim() !== ""
        ? String(programDoc.programName)
        : programDoc.name != null
          ? String(programDoc.name)
          : "";
    var raw = programDoc.rowsJson != null ? programDoc.rowsJson : programDoc.rows_json;
    var rows;
    if (typeof raw === "string") {
      try {
        rows = JSON.parse(raw);
      } catch (_e) {
        rows = [];
      }
    } else {
      rows = raw;
    }
    if (!Array.isArray(rows)) rows = [];
    var cleaned = [];
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (!r || r.section == null || r.name == null) continue;
      var tn = parseFloat(String(r.targetNet != null ? r.targetNet : "").replace(",", "."));
      cleaned.push({
        section: String(r.section).trim(),
        name: String(r.name).trim(),
        targetNet: isNaN(tn) ? 0 : tn,
      });
    }
    if (!cleaned.length) return null;
    var pg = puanGroupFromAlanKey(programDoc.alanKey);
    cleaned = clampAllRowTargets(cleaned, pg);
    cleaned = filterRowsByPuanGroup(cleaned, pg);
    if (!cleaned.length) return null;
    var pid = programDoc.$id != null ? String(programDoc.$id) : "";
    var tt = parseFloat(String(programDoc.targetTytNet != null ? programDoc.targetTytNet : "").replace(",", "."));
    var ta = parseFloat(String(programDoc.targetAytNet != null ? programDoc.targetAytNet : "").replace(",", "."));
    return {
      id: pid,
      university: uniName,
      department: dept,
      baseScore2025: 400,
      rows: cleaned,
      dataSource: "appwrite-v2",
      puanGroup: pg,
      targetTytNet: isNaN(tt) ? 0 : tt,
      targetAytNet: isNaN(ta) ? 0 : ta,
    };
  } catch (e) {
    console.warn("[Net Sihirbazı] buildProgramFromAppwriteV2:", e && e.message ? e.message : e);
    return null;
  }
}

function currentNetDemo(target, maxCap, programId, rowKey) {
  var h = hashStr(String(programId || "") + "::cur::" + rowKey);
  var ratio = 0.74 + ((h % 19) * 0.01);
  var c = target * ratio;
  return Math.round(Math.min(maxCap, Math.max(0, c)) * 10) / 10;
}

/**
 * @param {{ rows: Array, baseScore2025: number, university: string, department: string, dataSource: string, puanGroup: PuanGroup }} program
 * @param {{ currentNetForRow?: function(r: object, target: number, cap: number, key: string): number }} [opts]
 */
export function buildMotorDisplayRows(program, opts) {
  opts = opts || {};
  if (!program || !program.rows) return [];
  var pg = program.puanGroup || "sayisal";
  var progId = String(program.id || "");
  return program.rows.map(function (r) {
    var cap = clampRowTargetNet(r, pg);
    var t = Number(r.targetNet);
    if (isNaN(t)) t = 0;
    t = Math.min(cap, t);
    var key = String(r.section) + "_" + String(r.name);
    var cur =
      typeof opts.currentNetForRow === "function"
        ? opts.currentNetForRow(r, t, cap, key)
        : currentNetDemo(t, cap, progId, key);
    if (isNaN(cur)) cur = 0;
    cur = Math.round(Math.min(cap, Math.max(0, cur)) * 10) / 10;
    var diff = Math.round((cur - t) * 10) / 10;
    return {
      label: String(r.section) + " " + String(r.name),
      section: r.section,
      name: r.name,
      target: t,
      current: cur,
      diff: diff,
    };
  });
}

function sumDisplaySection(displayRows, sectionUpper) {
  var s = 0;
  var c = 0;
  (displayRows || []).forEach(function (r) {
    if (String(r.section || "").toUpperCase() !== sectionUpper) return;
    s += Number(r.target) || 0;
    c += Number(r.current) || 0;
  });
  return { target: s, current: c };
}

/**
 * Net Sihirbazı V2 — Tailwind özet şeridi + ders tablosu (Kalan: güncel − hedef; eksi → kırmızı, artı → yeşil).
 * @param {object} [uiMeta] — currentNetSummary (düz metin), tableFootnote (düz metin)
 */
export function netSihirbaziV2ResultHtml(displayRows, program, uiMeta) {
  program = program || {};
  uiMeta = uiMeta || {};
  var pctAgg = computeMotorSuccessPercent(displayRows);
  var tytAgg = sumDisplaySection(displayRows, "TYT");
  var aytAgg = sumDisplaySection(displayRows, "AYT");
  var tT = program.targetTytNet != null ? Number(program.targetTytNet) : tytAgg.target;
  var aT = program.targetAytNet != null ? Number(program.targetAytNet) : aytAgg.target;
  var denom = tT + aT;
  var pct = denom > 0 ? Math.min(100, Math.max(0, Math.round((100 * (tytAgg.current + aytAgg.current)) / denom))) : pctAgg;
  var w = Math.min(100, Math.max(0, pct));

  var currentLine =
    '<p class="text-xs text-slate-600">Güncel toplam (branş): TYT <span class="font-bold text-slate-800 tabular-nums">' +
    esc(tytAgg.current.toFixed(1)) +
    '</span> · AYT <span class="font-bold text-slate-800 tabular-nums">' +
    esc(aytAgg.current.toFixed(1)) +
    "</span></p>";
  if (uiMeta.currentNetSummary) {
    currentLine +=
      '<p class="text-xs text-slate-500 mt-1">' + esc(String(uiMeta.currentNetSummary)) + "</p>";
  }

  var strip =
    '<div class="mb-5 rounded-2xl border border-violet-200/90 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-4 shadow-md shadow-violet-100/50">' +
    '<div class="flex flex-wrap items-end justify-between gap-3">' +
    '<div class="space-y-1">' +
    '<p class="text-xs font-extrabold uppercase tracking-wider text-violet-600">Hedef netler (Appwrite Programs)</p>' +
    '<p class="text-sm font-semibold text-slate-700">' +
    "TYT: <span class=\"text-violet-700 tabular-nums\">" +
    esc(tT.toFixed(1)) +
    "</span> · AYT: <span class=\"text-fuchsia-700 tabular-nums\">" +
    esc(aT.toFixed(1)) +
    "</span></p>" +
    currentLine +
    "</div>" +
    '<div class="min-w-[200px] flex-1">' +
    '<div class="mb-1 flex justify-between text-xs font-bold text-slate-600">' +
    '<span>% Başarı ihtimali</span><span class="text-violet-700 tabular-nums">' +
    esc(String(pct)) +
    "%</span></div>" +
    '<div class="h-2.5 w-full overflow-hidden rounded-full bg-slate-200/80 ring-1 ring-violet-200/60">' +
    '<div class="h-full rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-500 transition-all duration-500" style="width:' +
    esc(String(w)) +
    '%"></div></div>' +
    '<p class="mt-1 text-[10px] leading-snug text-slate-400">Gösterge: hedef TYT+AYT toplamına göre güncel branş toplamlarınızın oranı; resmî yerleştirme değildir.</p>' +
    "</div></div></div>";

  if (!displayRows || !displayRows.length) {
    return strip + '<p class="net-sihirbazi-placeholder">Bu bölüm için satır üretilemedi.</p>';
  }

  var trs = displayRows
    .map(function (r) {
      var diffCls =
        r.diff < 0 ? "text-rose-600 font-bold" : r.diff > 0 ? "text-emerald-600 font-bold" : "text-slate-600 font-semibold";
      var diffTxt = r.diff === 0 ? "0" : (r.diff > 0 ? "+" : "") + r.diff.toFixed(1);
      return (
        "<tr class=\"border-b border-violet-100/80\">" +
        '<td class="py-2.5 pr-3 text-sm font-medium text-slate-800">' +
        esc(r.label) +
        '</td><td class="py-2.5 px-2 text-center text-sm tabular-nums text-slate-700">' +
        r.target.toFixed(1) +
        '</td><td class="py-2.5 px-2 text-center text-sm tabular-nums text-slate-700">' +
        r.current.toFixed(1) +
        '</td><td class="py-2.5 pl-2 text-right text-sm tabular-nums ' +
        diffCls +
        '">' +
        esc(diffTxt) +
        "</td></tr>"
      );
    })
    .join("");

  var foot =
    uiMeta.tableFootnote != null && String(uiMeta.tableFootnote).trim() !== ""
      ? String(uiMeta.tableFootnote)
      : "Hedefler Appwrite Programs.rowsJson kaynağındadır. Kalan = güncel net − hedef net.";
  var table =
    '<div class="overflow-hidden rounded-2xl border border-violet-200/80 bg-white shadow-sm">' +
    '<table class="w-full border-collapse text-left text-sm">' +
    '<thead><tr class="border-b border-violet-200 bg-gradient-to-r from-violet-100/90 to-fuchsia-50/90">' +
    '<th class="px-3 py-3 text-xs font-extrabold uppercase tracking-wide text-violet-900">Ders</th>' +
    '<th class="px-2 py-3 text-center text-xs font-extrabold uppercase tracking-wide text-violet-900">Hedef</th>' +
    '<th class="px-2 py-3 text-center text-xs font-extrabold uppercase tracking-wide text-violet-900">Güncel</th>' +
    '<th class="px-3 py-3 text-right text-xs font-extrabold uppercase tracking-wide text-violet-900">Kalan</th>' +
    "</tr></thead><tbody>" +
    trs +
    "</tbody></table>" +
    '<p class="border-t border-violet-100 px-3 py-2 text-xs text-slate-500">' +
    esc(foot) +
    "</p>" +
    "</div>";

  return strip + table;
}

export function computeMotorSuccessPercent(displayRows) {
  var sumT = 0;
  var sumC = 0;
  (displayRows || []).forEach(function (r) {
    sumT += r.target > 0 ? r.target : 0;
    sumC += r.current > 0 ? r.current : 0;
  });
  if (sumT <= 0) return 0;
  return Math.min(100, Math.max(0, Math.round((100 * sumC) / sumT)));
}

/**
 * Tablo + üst olasılık çubuğu HTML (5 sütun: Ders, Hedef, Güncel, Hedefe Kalan, durum).
 * Hedefe Kalan = güncel − hedef; negatif → geride (kırmızı), pozitif → fazla (yeşil).
 */
export function netSihirbaziMotorTableHtml(displayRows, opts) {
  opts = opts || {};
  var pct = computeMotorSuccessPercent(displayRows);
  var pctClass = pct >= 75 ? "is-green" : pct >= 45 ? "is-amber" : "is-red";
  var probBlock =
    '<div class="net-sihirbazi-prob" role="region" aria-label="Başarı ihtimali">' +
    '<div class="net-sihirbazi-prob__row">' +
    '<span class="net-sihirbazi-prob__lbl">% Başarı ihtimali (güncel / hedef toplam net)</span>' +
    "<strong>" +
    pct +
    "%</strong>" +
    "</div>" +
    '<div class="net-sihirbazi-prob__track" aria-hidden="true">' +
    '<div class="net-sihirbazi-prob__fill ' +
    esc(pctClass) +
    '" style="width:' +
    pct +
    '%"></div>' +
    "</div>" +
    "</div>";

  if (!displayRows || !displayRows.length) {
    return (
      probBlock +
      '<p class="net-sihirbazi-placeholder">' +
      esc(opts.emptyMessage || "Bu bölüm için net verisi bekleniyor.") +
      "</p>"
    );
  }

  function diffClass(d) {
    if (d < 0) return "ns-motor-diff--behind";
    if (d > 0) return "ns-motor-diff--ahead";
    return "ns-motor-diff--ok";
  }

  function diffText(d) {
    if (d === 0) return "0";
    return (d > 0 ? "+" : "") + d.toFixed(1);
  }

  var trs = displayRows
    .map(function (r) {
      return (
        "<tr><td>" +
        esc(r.label) +
        "</td><td>" +
        r.target.toFixed(1) +
        "</td><td>" +
        r.current.toFixed(1) +
        '</td><td class="' +
        diffClass(r.diff) +
        '">' +
        esc(diffText(r.diff)) +
        " net</td></tr>"
      );
    })
    .join("");

  return (
    probBlock +
    '<div class="hedef-atlas-net-wrap">' +
    '<table class="hedef-atlas-net-table net-sihirbazi-motor-table">' +
    "<thead><tr><th>Ders</th><th>Hedef net</th><th>Güncel net (örnek)</th><th>Hedefe Kalan</th></tr></thead><tbody>" +
    trs +
    "</tbody></table>" +
    '<p class="hedef-atlas-net-footnote">' +
    esc(
      opts.footnote ||
        "Hedef netler soru üst sınırına göre kısıtlanır. Güncel sütunu örnek profil üretimidir. Resmî ÖSYM verisi değildir."
    ) +
    "</p>" +
    "</div>"
  );
}

export function netSihirbaziSkeletonHtml() {
  return (
    '<div class="net-sihirbazi-skeleton" aria-busy="true">' +
    '<div class="net-sihirbazi-skeleton__bar"></div>' +
    '<div class="net-sihirbazi-skeleton__row"></div>' +
    '<div class="net-sihirbazi-skeleton__row"></div>' +
    '<div class="net-sihirbazi-skeleton__row"></div>' +
    '<div class="net-sihirbazi-skeleton__row"></div>' +
    '<p class="net-sihirbazi-skeleton__txt">Yükleniyor…</p>' +
    "</div>"
  );
}
