/**
 * Üniversite / bölüm tek kaynak: önce YÖK Atlas (`yok-atlas.json`), yoksa `yks-data.json`.
 */

/** @type {string[]} */
var YKS_DATA_JSON_URLS = ["src/data/yok-atlas.json", "src/data/yks-data.json"];

/** @type {boolean} */
var _ready = false;
/** @type {object[]} */
var _universities = [];
/** @type {object[]} */
var _allPrograms = [];
/** @type {Record<string, object[]>} */
var _programsByUni = Object.create(null);
/** Appwrite dökümanında üniversite görünen adı (`uniName`; eski kayıtlar `name`). */
export function hedefUniDisplayName(u) {
  if (!u) return "";
  var a = u.uniName != null ? String(u.uniName).trim() : "";
  if (a) return a;
  return String(u.name || "").trim();
}

/** Appwrite dökümanında program görünen adı (`programName`; eski kayıtlar `name`). */
export function hedefProgramDisplayName(p) {
  if (!p) return "";
  var a = p.programName != null ? String(p.programName).trim() : "";
  if (a) return a;
  return String(p.name || "").trim();
}

export function programPuanGroupFromAlanKey(alanKey) {
  var k = String(alanKey || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  if (k === "dil" || /^dil\b/.test(k)) return "dil";
  if (k === "sozel" || k.indexOf("sozel") !== -1) return "sozel_ea";
  if (k === "esit_agirlik" || k.indexOf("esit") !== -1 || k.indexOf("agirlik") !== -1) return "sozel_ea";
  return "sayisal";
}

function normalizeUni(raw) {
  var id = raw && (raw.id != null ? String(raw.id) : raw.$id != null ? String(raw.$id) : "");
  return Object.assign({}, raw, { $id: id, uniName: raw.uniName != null ? raw.uniName : raw.name });
}

function normalizeProgram(raw) {
  var id = raw && (raw.id != null ? String(raw.id) : raw.$id != null ? String(raw.$id) : "");
  var rows = raw.rowsJson != null ? raw.rowsJson : raw.rows_json;
  if (Array.isArray(rows)) {
    rows = JSON.stringify(rows);
  }
  return Object.assign({}, raw, { $id: id, rowsJson: rows });
}

/**
 * Statik JSON’u bir kez yükler (boş dizi olabilir).
 */
function normDedupeKey(s) {
  return String(s || "")
    .trim()
    .toLocaleLowerCase("tr")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

/**
 * Aynı üniversitede aynı bölüm adı tekrar etmesin (ilk kayıt kalır).
 * @param {object[]} programs
 * @returns {object[]}
 */
export function dedupeProgramsByDisplayName(programs) {
  var seen = Object.create(null);
  var out = [];
  (programs || []).forEach(function (p) {
    var name = hedefProgramDisplayName(p);
    var key = normDedupeKey(name);
    if (!key) return;
    if (seen[key]) return;
    seen[key] = true;
    out.push(p);
  });
  return out;
}

export function getDedupedProgramsForUniversity(uniDocId) {
  var list = getCachedHedefProgramsForUniversity(uniDocId);
  if (!list || !list.length) return [];
  return dedupeProgramsByDisplayName(list);
}

export async function ensureHedefSimulatorAppwriteData() {
  if (_ready) return;
  try {
    var data = null;
    var lastErr = null;
    for (var u = 0; u < YKS_DATA_JSON_URLS.length; u++) {
      try {
        var res = await fetch(YKS_DATA_JSON_URLS[u], { cache: "no-store" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var dataTry = await res.json();
        var ulistCheck = Array.isArray(dataTry.universities) ? dataTry.universities : [];
        if (ulistCheck.length === 0 && u < YKS_DATA_JSON_URLS.length - 1) continue;
        data = dataTry;
        break;
      } catch (e) {
        lastErr = e;
      }
    }
    if (!data) throw lastErr || new Error("Atlas JSON yüklenemedi");
    var ulist = Array.isArray(data.universities) ? data.universities : [];
    _universities = ulist.map(normalizeUni).filter(function (u) {
      return u.$id;
    });
    _universities.sort(function (a, b) {
      return hedefUniDisplayName(a).localeCompare(hedefUniDisplayName(b), "tr");
    });
    _allPrograms = (Array.isArray(data.programs) ? data.programs : []).map(normalizeProgram).filter(function (p) {
      return p.$id && p.uniId;
    });
    _programsByUni = Object.create(null);
    for (var i = 0; i < _allPrograms.length; i++) {
      var p = _allPrograms[i];
      var uid = String(p.uniId);
      if (!_programsByUni[uid]) _programsByUni[uid] = [];
      _programsByUni[uid].push(p);
    }
    for (var k in _programsByUni) {
      if (!Object.prototype.hasOwnProperty.call(_programsByUni, k)) continue;
      _programsByUni[k].sort(function (a, b) {
        return hedefProgramDisplayName(a).localeCompare(hedefProgramDisplayName(b), "tr");
      });
    }
  } catch (e) {
    console.warn("[Uni/Program kataloğu] yok-atlas.json / yks-data.json yüklenemedi:", e && e.message ? e.message : e);
    _universities = [];
    _allPrograms = [];
    _programsByUni = Object.create(null);
  }
  _ready = true;
}

export function isHedefAppwriteCatalogReady() {
  return _ready;
}

export function getHedefAppwriteUniversities() {
  return _universities || [];
}

/** Tüm programlar (Tercih Sihirbazı vb.); tek sefer yks-data.json */
export function getAllHedefPrograms() {
  return _allPrograms ? _allPrograms.slice() : [];
}

export function getCachedHedefProgramsForUniversity(uniDocId) {
  var uid = String(uniDocId || "").trim();
  if (!uid) return null;
  return Object.prototype.hasOwnProperty.call(_programsByUni, uid) ? _programsByUni[uid] : null;
}

/**
 * @returns {Promise<object[]>}
 */
export function loadHedefProgramsForUniversity(uniDocId) {
  var uid = String(uniDocId || "").trim();
  if (!uid) return Promise.resolve([]);
  if (!Object.prototype.hasOwnProperty.call(_programsByUni, uid)) {
    return Promise.resolve([]);
  }
  return Promise.resolve(_programsByUni[uid]);
}

export function invalidateHedefAppwriteCache() {
  _ready = false;
  _universities = [];
  _allPrograms = [];
  _programsByUni = Object.create(null);
}
