/**
 * TYT-AYT Net Sihirbazı — YÖK Atlas (Lisans / Önlisans) hedef modeli.
 * Hedef satırları: program belgesindeki tyt_* / ayt_* alanları veya yokAtlas alt nesnesi.
 * Kalan net = Hedef net − Güncel net (negatif → kırmızı, sıfır/pozitif → yeşil).
 */

import { YKS_AYT_BY_ALAN } from "./yks-exam-structure.js";

/** Soru üst sınırı — hedef net clamp */
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

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function parseAtlasNum(v) {
  if (v == null || v === "") return null;
  var n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  if (isNaN(n)) return null;
  return Math.round(Math.min(999, Math.max(0, n)) * 10) / 10;
}

/** YÖK JSON’daki net değeri — yuvarlama yok; Net Sihirbazı SSOT satırı için */
function parseAtlasNumExact(v) {
  if (v == null || v === "") return null;
  var n = parseFloat(String(v).replace(/\s/g, "").replace(",", "."));
  if (isNaN(n)) return null;
  return Math.min(999, Math.max(0, n));
}

/**
 * @param {number|null|undefined} n
 * @returns {string}
 */
export function formatYokNetDisplay(n) {
  if (n == null || (typeof n === "number" && isNaN(n))) return "—";
  var x = Number(n);
  if (isNaN(x)) return "—";
  return new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 8 }).format(x);
}

/** @typedef {"sayisal"|"ea"|"sozel"|"dil"|"tyt_only"} PuanGroup */

function normStr(s) {
  return String(s || "")
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

/**
 * programTuru: Lisans | Önlisans
 * puanTuru: SAY | EA | SÖZ | DİL | TYT
 */
export function puanGroupFromAtlas(programDoc) {
  var ptRaw = String(programDoc.programTuru || "")
    .trim()
    .toLocaleLowerCase("tr");
  var puRaw = String(programDoc.puanTuru || "")
    .trim()
    .toLocaleUpperCase("tr");
  if (ptRaw.indexOf("önlisans") !== -1 || ptRaw.indexOf("onlisans") !== -1) return "tyt_only";
  if (puRaw === "TYT") return "tyt_only";
  var pu = normStr(programDoc.puanTuru);
  if (pu === "say" || pu.indexOf("sayisal") !== -1) return "sayisal";
  if (pu === "ea" || pu.indexOf("esit") !== -1 || pu.indexOf("agirlik") !== -1) return "ea";
  if (pu === "soz" || pu.indexOf("sozel") !== -1) return "sozel";
  if (pu === "dil") return "dil";
  return puanGroupFromAlanKey(programDoc.alanKey);
}

export function puanGroupFromAlanKey(alanKey) {
  var raw = String(alanKey || "").trim().toLowerCase();
  var k = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (k === "esit_agirlik" || k === "ea" || (k.indexOf("esit") !== -1 && k.indexOf("agir") !== -1)) return "ea";
  if (k === "sozel" || raw.indexOf("sözel") !== -1) return "sozel";
  if (k === "dil") return "dil";
  return "sayisal";
}

function maxTytForName(name) {
  var n = String(name || "").toLocaleLowerCase("tr");
  if (n.indexOf("fen") !== -1) return MAX_QUESTIONS.TYT.Fen;
  if (n.indexOf("sosyal") !== -1) return MAX_QUESTIONS.TYT.Sosyal;
  if (n.indexOf("matematik") !== -1 || n.indexOf("temel") !== -1) return MAX_QUESTIONS.TYT.Matematik;
  if (n.indexOf("türk") !== -1 || n.indexOf("turk") !== -1) return MAX_QUESTIONS.TYT.Turkce;
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
  var pack = YKS_AYT_BY_ALAN[pg === "sayisal" ? "sayisal" : pg === "ea" ? "esit_agirlik" : pg === "sozel" ? "sozel" : "dil"];
  if (pack && pack.branches) {
    for (var i = 0; i < pack.branches.length; i++) {
      var lb = pack.branches[i].label.toLocaleLowerCase("tr");
      if (low.indexOf(lb) !== -1) return pack.branches[i].soru;
    }
  }
  return 40;
}

/**
 * @param {{ section: string, name: string, targetNet?: number, puanGroup?: PuanGroup }} row
 */
export function clampRowTargetNet(row, pg) {
  var sec = String(row.section || "").toUpperCase();
  var t = Number(row.targetNet);
  if (isNaN(t) || t < 0) t = 0;
  var max = sec === "TYT" ? maxTytForName(row.name) : maxAytForName(row.name, pg === "tyt_only" ? "sayisal" : pg);
  return Math.round(Math.min(max, t) * 10) / 10;
}

function mergeAtlasPayload(programDoc) {
  var p = programDoc || {};
  var nested = p.yokAtlas && typeof p.yokAtlas === "object" ? p.yokAtlas : null;
  var base = nested ? Object.assign({}, p, nested) : Object.assign({}, p);
  if (!base.puanTuru && base.scoreType) base.puanTuru = base.scoreType;
  return base;
}

/**
 * Atlas anahtarlarından satır listesi (dinamik: Önlisans = yalnızca TYT).
 */
function buildRowsFromYokAtlasFields(src, pg, exact) {
  var rows = [];

  function pushTyt(key, displayName, branchId) {
    var v = exact ? parseAtlasNumExact(src[key]) : parseAtlasNum(src[key]);
    if (v == null) return;
    rows.push({
      section: "TYT",
      name: displayName,
      targetNet: v,
      atlasKey: key,
      branchId: branchId,
      label: "TYT " + displayName,
    });
  }

  pushTyt("tyt_turkce", "Türkçe", "turkce");
  pushTyt("tyt_sosyal", "Sosyal Bilimler", "sosyal");
  pushTyt("tyt_matematik", "Temel Matematik", "matematik");
  pushTyt("tyt_fen", "Fen Bilimleri", "fen");

  if (pg === "tyt_only") {
    return rows;
  }

  function pushAyt(key, displayName, branchId) {
    var v2 = exact ? parseAtlasNumExact(src[key]) : parseAtlasNum(src[key]);
    if (v2 == null) return;
    rows.push({
      section: "AYT",
      name: displayName,
      targetNet: v2,
      atlasKey: key,
      branchId: branchId,
      label: "AYT " + displayName,
    });
  }

  if (pg === "sayisal") {
    pushAyt("ayt_matematik", "Matematik", "mat");
    pushAyt("ayt_fizik", "Fizik", "fizik");
    pushAyt("ayt_kimya", "Kimya", "kimya");
    pushAyt("ayt_biyoloji", "Biyoloji", "biyo");
  } else if (pg === "ea") {
    pushAyt("ayt_matematik", "Matematik", "mat");
    pushAyt("ayt_edebiyat", "Türk Dili ve Edebiyatı", "edebiyat");
    pushAyt("ayt_tarih1", "Tarih-1", "tarih1");
    pushAyt("ayt_cografya1", "Coğrafya-1", "cografya1");
  } else if (pg === "sozel") {
    pushAyt("ayt_edebiyat", "Türk Dili ve Edebiyatı", "edebiyat");
    pushAyt("ayt_tarih1", "Tarih-1", "tarih1");
    pushAyt("ayt_cografya1", "Coğrafya-1", "cografya1");
    pushAyt("ayt_tarih2", "Tarih-2", "tarih2");
    pushAyt("ayt_cografya2", "Coğrafya-2", "cografya2");
    pushAyt("ayt_felsefe", "Felsefe Grubu", "felsefe");
    pushAyt("ayt_din_kulturu", "Din Kültürü", "din");
  } else if (pg === "dil") {
    pushAyt("ayt_yabanci_dil", "Yabancı Dil", "ydt");
    pushAyt("ayt_edebiyat", "Türk Dili ve Edebiyatı", "edebiyat");
    pushAyt("ayt_tarih1", "Tarih-1", "tarih1");
    pushAyt("ayt_cografya1", "Coğrafya-1", "cografya1");
  }

  return rows;
}

/** rowsJson → iç motor satırları (geçiş; hedef değerler JSON’daki satırlardan) */
function buildRowsFromLegacyRowsJson(programDoc, pg, exact) {
  var raw = programDoc.rowsJson != null ? programDoc.rowsJson : programDoc.rows_json;
  var arr;
  if (typeof raw === "string") {
    try {
      arr = JSON.parse(raw);
    } catch (_e) {
      arr = [];
    }
  } else {
    arr = raw;
  }
  if (!Array.isArray(arr) || !arr.length) return [];

  var stubPg = pg === "tyt_only" ? "sayisal" : pg;
  var cleaned = [];
  for (var i = 0; i < arr.length; i++) {
    var r = arr[i];
    if (!r || r.section == null || r.name == null) continue;
    var tn = parseFloat(String(r.targetNet != null ? r.targetNet : "").replace(",", "."));
    cleaned.push({
      section: String(r.section).trim(),
      name: String(r.name).trim(),
      targetNet: isNaN(tn) ? 0 : tn,
    });
  }
  if (!cleaned.length) return [];

  for (var j = 0; j < cleaned.length; j++) {
    if (!exact) {
      cleaned[j].targetNet = clampRowTargetNet(cleaned[j], stubPg);
    }
    cleaned[j].label = cleaned[j].section + " " + cleaned[j].name;
  }

  if (pg === "tyt_only") {
    return cleaned.filter(function (x) {
      return String(x.section || "").toUpperCase() === "TYT";
    });
  }

  return filterRowsByPuanGroup(cleaned, pg);
}

/**
 * Statik katalog programı — YÖK Atlas alanları veya (geçiş) rowsJson.
 * @returns {{ id: string, university: string, department: string, rows: Array, dataSource: string, puanGroup: PuanGroup, programTuru?: string, puanTuruRaw?: string, targetTytNet: number, targetAytNet: number }|null}
 */
export function buildProgramFromAppwriteV2(uniDoc, programDoc, opts) {
  opts = opts || {};
  var exact = !!opts.exactYokAtlasTargets;
  try {
    if (!uniDoc || !programDoc) return null;
    var uniName =
      uniDoc.uniName != null && String(uniDoc.uniName).trim() !== ""
        ? String(uniDoc.uniName)
        : uniDoc.name != null
          ? String(uniDoc.name)
          : "";
    var dept =
      programDoc.programName != null && String(programDoc.programName).trim() !== ""
        ? String(programDoc.programName)
        : programDoc.name != null
          ? String(programDoc.name)
          : "";

    var src = mergeAtlasPayload(programDoc);
    var pg = puanGroupFromAtlas(src);

    var rows = buildRowsFromYokAtlasFields(src, pg, exact);
    var dataSource = "yok-atlas";
    if (!rows.length) {
      rows = buildRowsFromLegacyRowsJson(programDoc, pg, exact);
      dataSource = rows.length ? "legacy-rows-json" : "";
    }
    if (!rows.length) return null;

    for (var i = 0; i < rows.length; i++) {
      var g = pg === "tyt_only" ? "sayisal" : pg;
      if (!exact) {
        rows[i].targetNet = clampRowTargetNet(rows[i], g);
      }
      if (!rows[i].label) rows[i].label = String(rows[i].section) + " " + String(rows[i].name);
    }

    var pid = programDoc.$id != null ? String(programDoc.$id) : "";
    var sumTyt = 0;
    var sumAyt = 0;
    rows.forEach(function (r) {
      var sec = String(r.section || "").toUpperCase();
      var t = Number(r.targetNet) || 0;
      if (sec === "TYT") sumTyt += t;
      else if (sec === "AYT") sumAyt += t;
    });

    var tt = exact
      ? parseAtlasNumExact(src.targetTytNet != null ? src.targetTytNet : programDoc.targetTytNet)
      : parseAtlasNum(src.targetTytNet != null ? src.targetTytNet : programDoc.targetTytNet);
    var ta = exact
      ? parseAtlasNumExact(src.targetAytNet != null ? src.targetAytNet : programDoc.targetAytNet)
      : parseAtlasNum(src.targetAytNet != null ? src.targetAytNet : programDoc.targetAytNet);
    if (tt == null) tt = exact ? sumTyt : Math.round(sumTyt * 10) / 10;
    if (ta == null) ta = exact ? sumAyt : Math.round(sumAyt * 10) / 10;

    return {
      id: pid,
      university: uniName,
      department: dept,
      baseScore2025: 400,
      rows: rows,
      dataSource: dataSource,
      puanGroup: pg,
      programTuru: src.programTuru != null ? String(src.programTuru) : "",
      puanTuruRaw: src.puanTuru != null ? String(src.puanTuru) : "",
      targetTytNet: tt != null ? tt : 0,
      targetAytNet: ta != null ? ta : 0,
      exactYokAtlasTargets: exact,
    };
  } catch (e) {
    console.warn("[Net Sihirbazı] buildProgramFromAppwriteV2:", e && e.message ? e.message : e);
    return null;
  }
}

/**
 * Kalan = Hedef − Güncel (≥0 yeşil, <0 kırmızı).
 * @param {{ currentNetForRow?: function(object, number, number, string): number }} [opts]
 */
export function buildMotorDisplayRows(program, opts) {
  opts = opts || {};
  var exact = !!opts.exactYokAtlasTargets;
  if (!program || !program.rows) return [];
  var pg = program.puanGroup || "sayisal";
  var progId = String(program.id || "");
  return program.rows.map(function (r) {
    var cap = clampRowTargetNet(r, pg === "tyt_only" ? "sayisal" : pg);
    var t = Number(r.targetNet);
    if (isNaN(t)) t = 0;
    if (!exact) {
      t = Math.min(cap, t);
    }
    var key = String(r.section) + "_" + String(r.name);
    var cur =
      typeof opts.currentNetForRow === "function"
        ? opts.currentNetForRow(r, t, cap, key)
        : 0;
    if (isNaN(cur)) cur = 0;
    cur = Math.round(Math.min(cap, Math.max(0, cur)) * 10) / 10;
    var kalan = exact ? t - cur : Math.round((t - cur) * 10) / 10;
    return {
      label: r.label || String(r.section) + " " + String(r.name),
      section: r.section,
      name: r.name,
      target: t,
      current: cur,
      diff: kalan,
      atlasKey: r.atlasKey,
      branchId: r.branchId,
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
 * @param {object} [uiMeta]
 */
export function netSihirbaziV2ResultHtml(displayRows, program, uiMeta) {
  program = program || {};
  uiMeta = uiMeta || {};
  var exact = !!(program && program.exactYokAtlasTargets);
  var pctAgg = computeMotorSuccessPercent(displayRows);
  var tytAgg = sumDisplaySection(displayRows, "TYT");
  var aytAgg = sumDisplaySection(displayRows, "AYT");
  var tT = program.targetTytNet != null ? Number(program.targetTytNet) : tytAgg.target;
  var aT = program.targetAytNet != null ? Number(program.targetAytNet) : aytAgg.target;
  var denom = tT + aT;
  var pct = denom > 0 ? Math.min(100, Math.max(0, Math.round((100 * (tytAgg.current + aytAgg.current)) / denom))) : pctAgg;
  var w = Math.min(100, Math.max(0, pct));

  var dsNote =
    program.dataSource === "legacy-rows-json"
      ? " Geçiş: hedefler eski satır listesinden okundu; yokAtlas alanlarına geçmeniz önerilir."
      : "";

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

  var tytHead = exact ? esc(formatYokNetDisplay(tT)) : esc(tT.toFixed(1));
  var aytHead = exact ? esc(formatYokNetDisplay(aT)) : esc(aT.toFixed(1));

  var strip =
    '<div class="mb-5 rounded-2xl border border-violet-200/90 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-4 shadow-md shadow-violet-100/50">' +
    '<div class="flex flex-wrap items-end justify-between gap-3">' +
    '<div class="space-y-1">' +
    '<p class="text-xs font-extrabold uppercase tracking-wider text-violet-600">YÖK Atlas hedef netler</p>' +
    '<p class="text-sm font-semibold text-slate-700">' +
    "TYT: <span class=\"text-violet-700 tabular-nums\">" +
    tytHead +
    "</span> · AYT: <span class=\"text-fuchsia-700 tabular-nums\">" +
    aytHead +
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
    '<p class="mt-1 text-[10px] leading-snug text-slate-400">Gösterge: hedef TYT+AYT toplamına göre güncel branş toplamlarınızın oranı; resmî yerleştirme değildir.' +
    esc(dsNote) +
    "</p>" +
    "</div></div></div>";

  if (!displayRows || !displayRows.length) {
    return strip + '<p class="net-sihirbazi-placeholder">Bu bölüm için satır üretilemedi.</p>';
  }

  var trs = displayRows
    .map(function (r) {
      var kalan = r.diff;
      var diffCls =
        kalan < 0 ? "text-rose-600 font-bold" : "text-emerald-600 font-bold";
      var diffTxt;
      if (exact) {
        diffTxt =
          kalan === 0 ? "0" : (kalan > 0 ? "+" : "") + formatYokNetDisplay(kalan);
      } else {
        diffTxt = kalan === 0 ? "0.0" : (kalan > 0 ? "+" : "") + kalan.toFixed(1);
      }
      return (
        "<tr class=\"border-b border-violet-100/80\">" +
        '<td class="py-2.5 pr-3 text-sm font-medium text-slate-800">' +
        esc(r.label) +
        '</td><td class="py-2.5 px-2 text-center text-sm tabular-nums text-slate-700">' +
        (exact ? esc(formatYokNetDisplay(r.target)) : r.target.toFixed(1)) +
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
      : "Kalan = Hedef net − Güncel net. Eksi değerler kırmızı; sıfır ve pozitif değerler yeşil.";

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

  function diffClassKalan(d) {
    if (d < 0) return "ns-motor-diff--behind";
    return "ns-motor-diff--ahead";
  }

  function diffText(d) {
    if (d === 0) return "0.0";
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
        diffClassKalan(r.diff) +
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
    "<thead><tr><th>Ders</th><th>Hedef net</th><th>Güncel net</th><th>Kalan</th></tr></thead><tbody>" +
    trs +
    "</tbody></table>" +
    '<p class="hedef-atlas-net-footnote">' +
    esc(
      opts.footnote ||
        "Kalan = Hedef net − Güncel net. Deneme branş verisi yoksa güncel 0,0 kabul edilir."
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

/** Geriye dönük: eski motor yardımcıları */
export function clampAllRowTargets(rows, pg) {
  var g = pg === "tyt_only" ? "sayisal" : pg;
  return (rows || []).map(function (r) {
    return {
      section: r.section,
      name: r.name,
      targetNet: clampRowTargetNet(r, g),
    };
  });
}

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
  var alan =
    pg === "sayisal"
      ? "sayisal"
      : pg === "ea"
        ? "esit_agirlik"
        : pg === "sozel"
          ? "sozel"
          : pg === "dil"
            ? "dil"
            : "sayisal";
  var pack = YKS_AYT_BY_ALAN[alan] || YKS_AYT_BY_ALAN.sayisal;
  return (rows || []).filter(function (r) {
    var sec = String(r.section || "").toUpperCase();
    if (sec !== "AYT") return true;
    var lab = String(r.name || "").toLocaleLowerCase("tr");
    for (var i = 0; i < pack.branches.length; i++) {
      var bl = pack.branches[i].label.toLocaleLowerCase("tr");
      if (lab.indexOf(bl) !== -1) return true;
    }
    return false;
  });
}
