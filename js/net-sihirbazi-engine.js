/**
 * TYT-AYT Net Sihirbazı — hedef motoru: soru üst sınırı, Appwrite hedef netleri, taban bazlı fallback.
 * Appwrite: koleksiyon `yks_net_sihirbazi_targets`, alanlar: programKey (string), rowsJson (string JSON dizi),
 * isteğe bağlı baseScore2025 (double). programKey = "{uniId}__{templateId}"
 */

import { YKS_AYT_BY_ALAN, YKS_TYT_BRANCHES } from "./yks-exam-structure.js";
import {
  db,
  collection,
  query,
  where,
  getDocs,
} from "./appwrite-compat.js";
import {
  buildProgramFromUniTemplate,
  TR_UNIVERSITIES_UNIQUE,
  PROGRAM_TEMPLATES,
} from "./yok-atlas-catalog.js";
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

var APPWRITE_NET_COLLECTION = "yks_net_sihirbazi_targets";

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
 * Şablon satırlarına bakarak puan türü (AYT seti) çıkarımı — sayısal şablonda Fizik/Kimya/Biyo vardır.
 * @param {string} templateId
 * @returns {PuanGroup}
 */
export function inferPuanGroupFromTemplateId(templateId) {
  if (!templateId) return "sayisal";
  var t = PROGRAM_TEMPLATES.find(function (x) {
    return x.id === templateId;
  });
  if (!t || !t.rows) return "sayisal";
  var ayt = t.rows.filter(function (r) {
    return String(r.section || "").toUpperCase() === "AYT";
  });
  var blob = ayt
    .map(function (r) {
      return r.name;
    })
    .join(" ");
  if (/yabancı|ydt/i.test(blob)) return "dil";
  if (/Fizik|Kimya|Biyoloji/.test(blob)) return "sayisal";
  if (/Tarih-2|Coğrafya-2|Felsefe\s*Grubu|Din\s*Kültürü/i.test(blob)) return "sozel";
  return "ea";
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
 * Taban puana ve Türkiye ortalamasına yakın profillere göre tahmini branş netleri (şablon satırları kullanılmaz).
 * @param {string} uniId
 * @param {string} templateId
 * @param {number} baseScore2025
 * @param {PuanGroup} pg
 */
export function buildFallbackTargetRows(uniId, templateId, baseScore2025, pg) {
  var alanKey = puanGroupToAlanKey(pg);
  var norm = (Number(baseScore2025) - 260) / 310;
  if (isNaN(norm)) norm = 0.45;
  norm = Math.min(1, Math.max(0, norm));
  var lift = 0.5 + norm * 0.42;

  var out = [];
  var tytIds = ["turkce", "sosyal", "matematik", "fen"];
  for (var ti = 0; ti < tytIds.length; ti++) {
    var tid = tytIds[ti];
    var br = YKS_TYT_BRANCHES.find(function (b) {
      return b.id === tid;
    });
    if (!br) continue;
    var maxS = br.soru;
    var h = hashStr(uniId + "::tyt::" + br.id);
    var jitter = 1 + ((h % 23) - 11) * 0.01;
    var raw = maxS * lift * 0.72 * jitter;
    var targetNet = Math.round(Math.min(maxS, Math.max(0, raw)) * 10) / 10;
    var tytName =
      br.id === "turkce"
        ? "Türkçe"
        : br.id === "sosyal"
          ? "Sosyal Bilimler"
          : br.id === "matematik"
            ? "Temel Matematik"
            : "Fen Bilimleri";
    out.push({ section: "TYT", name: tytName, targetNet: targetNet });
  }

  var aytBranches;
  if (alanKey === "dil") {
    aytBranches = [
      { label: "Yabancı Dil", soru: 80 },
      { label: "Türk Dili ve Edebiyatı", soru: 24 },
      { label: "Tarih-1", soru: 11 },
      { label: "Coğrafya-1", soru: 6 },
    ];
  } else {
    aytBranches = (YKS_AYT_BY_ALAN[alanKey] || YKS_AYT_BY_ALAN.sayisal).branches;
  }

  aytBranches.forEach(function (b) {
    var h = hashStr(uniId + "::" + templateId + "::ayt::" + b.id);
    var jitter = 1 + ((h % 27) - 13) * 0.011;
    var raw = b.soru * lift * 0.68 * jitter;
    var targetNet = Math.round(Math.min(b.soru, Math.max(0, raw)) * 10) / 10;
    out.push({ section: "AYT", name: b.label, targetNet: targetNet });
  });

  out = clampAllRowTargets(out, pg);
  return filterRowsByPuanGroup(out, pg);
}

/**
 * Appwrite’dan programKey ile hedef net satırlarını okur.
 * @returns {Promise<{ rows: Array, baseScore2025: number|null, source: string }|null>}
 */
export async function fetchNetTargetsFromAppwrite(uniId, templateId) {
  try {
    var key = String(uniId || "") + "__" + String(templateId || "");
    if (!key || key === "__") return null;
    var cRef = collection(db, APPWRITE_NET_COLLECTION);
    var q = query(cRef, where("programKey", "==", key));
    var snap = await getDocs(q);
    if (!snap || !snap.docs || snap.docs.length === 0) return null;
    var d = snap.docs[0].data();
    var raw = d.rowsJson != null ? d.rowsJson : d.rows_json != null ? d.rows_json : d.rows;
    var rows;
    if (typeof raw === "string") {
      try {
        rows = JSON.parse(raw);
      } catch (_e) {
        return null;
      }
    } else {
      rows = raw;
    }
    if (!Array.isArray(rows) || !rows.length) return null;
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
    var bs = d.baseScore2025 != null ? Number(d.baseScore2025) : null;
    return {
      rows: cleaned,
      baseScore2025: !isNaN(bs) ? bs : null,
      source: "appwrite",
    };
  } catch (e) {
    console.warn("[Net Sihirbazı] Appwrite okuma:", e && e.message ? e.message : e);
    return null;
  }
}

/**
 * @returns {Promise<{ id: string, university: string, department: string, baseScore2025: number, rows: Array, dataSource: string }|null>}
 */
export async function resolveNetSihirbaziProgram(uniId, templateId) {
  try {
    var uni = TR_UNIVERSITIES_UNIQUE.find(function (u) {
      return u.id === uniId;
    });
    var tmpl = PROGRAM_TEMPLATES.find(function (t) {
      return t.id === templateId;
    });
    if (!uni || !tmpl) return null;

    var pg = inferPuanGroupFromTemplateId(templateId);
    var shell = buildProgramFromUniTemplate(uniId, templateId);
    if (!shell) return null;

    var fromDb = await fetchNetTargetsFromAppwrite(uniId, templateId);
    var rows;
    var dataSource;
    if (fromDb && fromDb.rows && fromDb.rows.length) {
      rows = fromDb.rows;
      dataSource = "appwrite";
      if (fromDb.baseScore2025 != null && !isNaN(fromDb.baseScore2025)) {
        shell.baseScore2025 = fromDb.baseScore2025;
      }
    } else {
      rows = buildFallbackTargetRows(uniId, templateId, shell.baseScore2025, pg);
      dataSource = "fallback";
    }

    rows = clampAllRowTargets(rows, pg);
    rows = filterRowsByPuanGroup(rows, pg);
    if (!rows.length) {
      rows = buildFallbackTargetRows(uniId, templateId, shell.baseScore2025, pg);
      dataSource = "fallback";
    }

    return {
      id: shell.id,
      university: shell.university,
      department: shell.department,
      baseScore2025: shell.baseScore2025,
      rows: rows,
      dataSource: dataSource,
      puanGroup: pg,
    };
  } catch (e) {
    console.warn("[Net Sihirbazı] resolveNetSihirbaziProgram:", e && e.message ? e.message : e);
    return null;
  }
}

function currentNetDemo(target, maxCap, uniId, templateId, rowKey) {
  var h = hashStr(uniId + "::cur::" + templateId + "::" + rowKey);
  var ratio = 0.74 + ((h % 19) * 0.01);
  var c = target * ratio;
  return Math.round(Math.min(maxCap, Math.max(0, c)) * 10) / 10;
}

/**
 * @param {{ rows: Array, baseScore2025: number, university: string, department: string, dataSource: string, puanGroup: PuanGroup }} program
 */
export function buildMotorDisplayRows(program) {
  if (!program || !program.rows) return [];
  var idParts = String(program.id || "").split("__");
  var uniId = idParts[0] || "";
  var tmplId = idParts.length > 1 ? idParts.slice(1).join("__") : "";
  var pg = program.puanGroup || inferPuanGroupFromTemplateId(tmplId);
  return program.rows.map(function (r) {
    var cap = clampRowTargetNet(r, pg);
    var t = Number(r.targetNet);
    if (isNaN(t)) t = 0;
    t = Math.min(cap, t);
    var key = String(r.section) + "_" + String(r.name);
    var cur = currentNetDemo(t, cap, uniId, tmplId, key);
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
