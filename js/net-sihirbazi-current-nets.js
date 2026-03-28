/**
 * Net Sihirbazı — deneme kayıtlarındaki yksBranchDetail ile program satırı (branchId / atlasKey) eşlemesi.
 * Branş verisi yoksa güncel net 0,0 (sessiz; arayüzde uyarı yok).
 */

import { YKS_AYT_BY_ALAN, YKS_TYT_BRANCHES } from "./yks-exam-structure.js";
import { parseStudentNetVal } from "./hedef-atlas-helpers.js";

function normLabel(s) {
  return String(s == null ? "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

function buildTytLabelMap() {
  var m = {};
  YKS_TYT_BRANCHES.forEach(function (br) {
    if (br.alt && br.alt.length) {
      br.alt.forEach(function (a) {
        m[br.id + "_" + a.id] = br.label + " · " + a.label;
      });
    } else {
      m[br.id] = br.label;
    }
  });
  return m;
}

function buildAytLabelMap(alan) {
  var m = {};
  var pack = YKS_AYT_BY_ALAN[alan || "sayisal"];
  if (!pack) return m;
  pack.branches.forEach(function (b) {
    m[b.id] = b.label;
    m["ayt_" + b.id] = b.label;
  });
  return m;
}

function karneNetFromRowEntry(row) {
  if (!row || row.soru == null) return NaN;
  var soru = Number(row.soru);
  if (isNaN(soru) || soru <= 0) return NaN;
  var d = Number(row.d != null ? row.d : 0);
  var y = Number(row.y != null ? row.y : 0);
  if (isNaN(d)) d = 0;
  if (isNaN(y)) y = 0;
  d = Math.max(0, Math.min(soru, d));
  y = Math.max(0, Math.min(soru - d, y));
  return d - y / 4;
}

/**
 * @param {object|null|undefined} detail
 * @param {string} [aytAlan] — sayisal | esit_agirlik | sozel | dil
 * @returns {{ tyt: Array<{label:string, net:number}>, ayt: Array<{label:string, net:number}> }}
 */
export function extractBranchNetsFromYksDetail(detail, aytAlan) {
  var out = { tyt: [], ayt: [] };
  if (!detail || typeof detail !== "object") return out;
  var alan = String(aytAlan || detail.aytAlan || "sayisal").toLowerCase();

  if (detail.bulkImport && detail.branchNets && typeof detail.branchNets === "object") {
    var em = String(detail.examMode || "TYT").toUpperCase();
    var nets = detail.branchNets;
    var tytMap = buildTytLabelMap();
    var aytMap = buildAytLabelMap(alan);
    if (em === "TYT") {
      Object.keys(nets).forEach(function (k) {
        var v = parseStudentNetVal(nets[k]);
        if (v == null) return;
        out.tyt.push({ label: tytMap[k] || k, net: v });
      });
    } else {
      Object.keys(nets).forEach(function (k) {
        var v2 = parseStudentNetVal(nets[k]);
        if (v2 == null) return;
        out.ayt.push({ label: aytMap[k] || k, net: v2 });
      });
    }
    return out;
  }

  if (detail.rows && typeof detail.rows === "object") {
    var examMode = String(detail.examMode || "TYT").toUpperCase();
    var alan2 = String(detail.aytAlan || alan || "sayisal").toLowerCase();
    var tytMap2 = buildTytLabelMap();
    var aytMap2 = buildAytLabelMap(alan2);
    Object.keys(detail.rows).forEach(function (k) {
      var row = detail.rows[k];
      var n = karneNetFromRowEntry(row);
      if (isNaN(n)) return;
      if (examMode === "AYT") {
        out.ayt.push({ label: aytMap2[k] || String(k).replace(/^ayt_/, ""), net: n });
      } else {
        out.tyt.push({ label: tytMap2[k] || k, net: n });
      }
    });
  }
  return out;
}

function examSortKey(e) {
  var d = e && (e.date || e.saved_at || e.savedAt);
  return String(d || "");
}

/**
 * @param {object[]} exams
 * @param {string} programAlanKey
 */
export function buildLatestBranchNetLookup(exams, programAlanKey) {
  var list = Array.isArray(exams) ? exams.slice() : [];
  list.sort(function (a, b) {
    return examSortKey(b).localeCompare(examSortKey(a));
  });

  var latestTyt = null;
  var latestAyt = null;
  for (var i = 0; i < list.length; i++) {
    var e = list[i];
    var detail = e && (e.yksBranchDetail || e.yks_branch_detail);
    if (!detail) continue;
    var tur = String(e.examType || e.type || e.tur || "").toUpperCase();
    var parts = extractBranchNetsFromYksDetail(detail, programAlanKey);
    if (!latestTyt && parts.tyt.length && (tur === "TYT" || String(detail.examMode || "").toUpperCase() === "TYT")) {
      latestTyt = parts.tyt;
    }
    if (!latestAyt && parts.ayt.length && (tur === "AYT" || String(detail.examMode || "").toUpperCase() === "AYT")) {
      latestAyt = parts.ayt;
    }
    if (latestTyt && latestAyt) break;
  }

  if (!latestTyt) {
    for (var j = 0; j < list.length; j++) {
      var e2 = list[j];
      var d2 = e2 && (e2.yksBranchDetail || e2.yks_branch_detail);
      if (!d2) continue;
      var p2 = extractBranchNetsFromYksDetail(d2, programAlanKey);
      if (p2.tyt.length) {
        latestTyt = p2.tyt;
        break;
      }
    }
  }
  if (!latestAyt) {
    for (var k = 0; k < list.length; k++) {
      var e3 = list[k];
      var d3 = e3 && (e3.yksBranchDetail || e3.yks_branch_detail);
      if (!d3) continue;
      var p3 = extractBranchNetsFromYksDetail(d3, programAlanKey);
      if (p3.ayt.length) {
        latestAyt = p3.ayt;
        break;
      }
    }
  }

  return { tytRows: latestTyt || [], aytRows: latestAyt || [] };
}

function sumNetsWhere(rows, pred) {
  var s = 0;
  var any = false;
  (rows || []).forEach(function (x) {
    if (pred(x.label)) {
      s += Number(x.net) || 0;
      any = true;
    }
  });
  return any ? Math.round(s * 10) / 10 : null;
}

function normalizeAlanKeyForPack(ak) {
  var s = String(ak || "sayisal").toLowerCase();
  if (s === "ea" || s.indexOf("esit") !== -1) return "esit_agirlik";
  if (s.indexOf("sozel") !== -1 || s === "sözel") return "sozel";
  if (s === "dil") return "dil";
  return "sayisal";
}

/**
 * Öğrenci detayındaki etiket ile YKS şeması branchId eşlemesi.
 */
function canonicalLabelForBranch(section, branchId, programAlanKey) {
  var sec = String(section || "").toUpperCase();
  if (!branchId) return null;
  if (sec === "TYT") {
    for (var i = 0; i < YKS_TYT_BRANCHES.length; i++) {
      if (YKS_TYT_BRANCHES[i].id === branchId) return YKS_TYT_BRANCHES[i].label;
    }
    return null;
  }
  var ak = normalizeAlanKeyForPack(programAlanKey);
  var pack = YKS_AYT_BY_ALAN[ak] || YKS_AYT_BY_ALAN.sayisal;
  if (!pack || !pack.branches) return null;
  for (var j = 0; j < pack.branches.length; j++) {
    if (pack.branches[j].id === branchId) return pack.branches[j].label;
  }
  return null;
}

/**
 * @returns {function(object, number, number, string): number}
 */
export function createCurrentNetForRowResolver(exams, programAlanKey) {
  var lookup = buildLatestBranchNetLookup(exams, programAlanKey);
  return function currentNetForRow(r, target, cap, _key) {
    try {
      var sec = String(r.section || "").toUpperCase();
      var rowName = String(r.name || "").trim();
      var rows = sec === "AYT" ? lookup.aytRows : lookup.tytRows;
      var nameN = normLabel(rowName);
      var v = null;

      if (r.branchId) {
        var want = canonicalLabelForBranch(sec, r.branchId, programAlanKey);
        if (want) {
          for (var zi = 0; zi < rows.length; zi++) {
            if (normLabel(rows[zi].label) === normLabel(want)) {
              v = Number(rows[zi].net);
              break;
            }
          }
        }
      }

      if ((v == null || isNaN(v)) && rows.length) {
        for (var i = 0; i < rows.length; i++) {
          if (normLabel(rows[i].label) === nameN) {
            v = Number(rows[i].net);
            break;
          }
        }
      }
      if ((v == null || isNaN(v)) && nameN.indexOf("fen") !== -1 && nameN.indexOf("bilim") !== -1) {
        v = sumNetsWhere(rows, function (lbl) {
          return /^fen\s*bilimleri/i.test(String(lbl || ""));
        });
      }
      if ((v == null || isNaN(v)) && nameN.indexOf("sosyal") !== -1 && nameN.indexOf("bilim") !== -1) {
        v = sumNetsWhere(rows, function (lbl2) {
          return /^sosyal\s*bilimler/i.test(String(lbl2 || ""));
        });
      }
      if ((v == null || isNaN(v)) && sec === "AYT") {
        if (nameN.indexOf("yabanc") !== -1 || nameN.indexOf("ydt") !== -1 || /^dil$/.test(nameN)) {
          for (var k = 0; k < rows.length; k++) {
            var ln = normLabel(rows[k].label);
            if (ln.indexOf("ydt") !== -1 || ln.indexOf("yabanc") !== -1 || ln.indexOf("ingiliz") !== -1) {
              v = Number(rows[k].net);
              break;
            }
          }
        }
      }
      if (v == null || isNaN(v)) {
        for (var j = 0; j < rows.length; j++) {
          if (normLabel(rows[j].label).indexOf(nameN) !== -1 || nameN.indexOf(normLabel(rows[j].label)) !== -1) {
            v = Number(rows[j].net);
            break;
          }
        }
      }
      if (v == null || isNaN(v)) v = 0;
      v = Math.round(Math.min(Number(cap) || 0, Math.max(0, v)) * 10) / 10;
      return v;
    } catch (_e) {
      return 0;
    }
  };
}

/**
 * @param {object[]} exams
 * @param {string} programAlanKey
 */
export function hasAnyBranchNetData(exams, programAlanKey) {
  var x = buildLatestBranchNetLookup(exams, programAlanKey);
  return (x.tytRows && x.tytRows.length > 0) || (x.aytRows && x.aytRows.length > 0);
}
