/**
 * Net Sihirbazı — src/data/yok-atlas-lisans.json düz satırları.
 * Üniversite / bölüm çapraz filtreleme ve yks-data.json katalog eşlemesi.
 */

import { hedefProgramDisplayName, hedefUniDisplayName } from "./hedef-appwrite-catalog.js";

export const YOK_ATLAS_LISANS_URL = "src/data/yok-atlas-lisans.json";

function normDedupeKey(s) {
  return String(s || "")
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function uniqueSortedTr(arr) {
  var s = new Set();
  for (var i = 0; i < arr.length; i++) {
    if (arr[i]) s.add(arr[i]);
  }
  return Array.from(s).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
}

/**
 * @param {object} raw
 * @param {number} ix
 */
export function normalizeLisansRow(raw, ix) {
  var r = raw && typeof raw === "object" ? raw : {};
  return {
    Universite: r.Universite != null ? String(r.Universite).trim() : "",
    Bolum: r.Bolum != null ? String(r.Bolum).trim() : "",
    Program_Kodu: r.Program_Kodu != null ? String(r.Program_Kodu).trim() : "",
    Puan_Tipi: r.Puan_Tipi != null ? String(r.Puan_Tipi).trim() : "",
    _ix: ix,
  };
}

/**
 * @returns {Promise<object[]>}
 */
export function fetchYokAtlasLisansFlatRows() {
  return fetch(YOK_ATLAS_LISANS_URL, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) throw new Error("HTTP " + res.status);
      return res.json();
    })
    .then(function (data) {
      var arr = Array.isArray(data) ? data : data && data.rows ? data.rows : [];
      var out = [];
      for (var i = 0; i < arr.length; i++) {
        var row = normalizeLisansRow(arr[i], i);
        if (row.Universite || row.Bolum) out.push(row);
      }
      return out;
    });
}

/**
 * @param {object[]} rows
 * @param {{ universite?: string, bolum?: string }} sel
 */
export function buildUniBolumCrossOptionSets(rows, sel) {
  var u0 = String((sel && sel.universite) || "").trim();
  var b0 = String((sel && sel.bolum) || "").trim();
  var uniS = new Set();
  var bolS = new Set();
  var i;
  var r;
  var u;
  var b;
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    u = r.Universite || "";
    b = r.Bolum || "";
    if (b0 && b !== b0) continue;
    if (u) uniS.add(u);
  }
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    u = r.Universite || "";
    b = r.Bolum || "";
    if (u0 && u !== u0) continue;
    if (b) bolS.add(b);
  }
  return {
    unis: uniqueSortedTr(Array.from(uniS)),
    bolums: uniqueSortedTr(Array.from(bolS)),
  };
}

/**
 * @param {object[]} rows
 * @param {{ universite: string, bolum: string }} sel
 */
export function pruneUniBolumSelections(rows, sel) {
  var k;
  for (k = 0; k < 8; k++) {
    var o = buildUniBolumCrossOptionSets(rows, sel);
    var bad = false;
    if (sel.universite && o.unis.indexOf(sel.universite) === -1) {
      sel.universite = "";
      bad = true;
    }
    if (sel.bolum && o.bolums.indexOf(sel.bolum) === -1) {
      sel.bolum = "";
      bad = true;
    }
    if (!bad) break;
  }
}

/**
 * İsim eşlemesi — YÖK düz isimleri ile yks-data.json uzun üniversite adları.
 */
function scoreNameOverlap(flatName, catalogName) {
  var a = normDedupeKey(flatName);
  var b = normDedupeKey(catalogName);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 88;
  var ta = a.split(" ").filter(function (x) {
    return x.length > 2;
  });
  var tb = b.split(" ").filter(function (x) {
    return x.length > 2;
  });
  if (!ta.length || !tb.length) return 0;
  var hits = 0;
  for (var i = 0; i < ta.length; i++) {
    for (var j = 0; j < tb.length; j++) {
      if (ta[i] === tb[j] || ta[i].indexOf(tb[j]) !== -1 || tb[j].indexOf(ta[i]) !== -1) {
        hits++;
        break;
      }
    }
  }
  return Math.min(92, 35 + hits * 18);
}

/**
 * @param {string} flatUni
 * @param {string} flatBolum
 * @param {object[]} universities
 * @param {object[]} programs
 * @returns {{ uniDoc: object, programDoc: object, score: number }|null}
 */
export function findBestCatalogProgramForFlatSelection(flatUni, flatBolum, universities, programs) {
  var umap = Object.create(null);
  for (var ui = 0; ui < universities.length; ui++) {
    var u = universities[ui];
    if (u && u.$id) umap[String(u.$id)] = u;
  }
  var best = null;
  var bestScore = -1;
  for (var pi = 0; pi < programs.length; pi++) {
    var p = programs[pi];
    var udoc = p && p.uniId ? umap[String(p.uniId)] : null;
    if (!udoc) continue;
    var un = hedefUniDisplayName(udoc);
    var pn = hedefProgramDisplayName(p);
    var us = scoreNameOverlap(flatUni, un);
    var ps = scoreNameOverlap(flatBolum, pn);
    if (us < 38 || ps < 52) continue;
    var sc = us * 0.44 + ps * 0.56;
    if (sc > bestScore) {
      bestScore = sc;
      best = { uniDoc: udoc, programDoc: p, score: sc };
    }
  }
  return best;
}
