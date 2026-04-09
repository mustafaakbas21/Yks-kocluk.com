/**
 * Üniversite / bölüm tek kaynak: önce YÖK Atlas (`yok-atlas.json`), yoksa `yks-data.json`.
 */

/**
 * Statik JSON için fetch URL adayları.
 * `/pages/koc-panel.html` altında `/src/data/x.json` → sunucuda `/pages/src/data/...` (404) olur;
 * `new URL('../src/data/x', location.href)` proje kökündeki dosyayı verir.
 * @param {string} filename örn. yks-data.json
 * @returns {string[]}
 */
export function getHedefCatalogJsonUrlCandidates(filename) {
  var urls = [];
  if (typeof location !== "undefined" && location.href) {
    try {
      urls.push(new URL("../src/data/" + filename, location.href).href);
    } catch (_e) {}
    try {
      urls.push(new URL("../../src/data/" + filename, location.href).href);
    } catch (_e2) {}
  }
  urls.push("/src/data/" + filename);
  urls.push("/data/" + filename);
  var seen = Object.create(null);
  return urls.filter(function (u) {
    if (!u || seen[u]) return false;
    seen[u] = true;
    return true;
  });
}

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
    var fileSpecs = [
      { name: "yok-atlas.json", skipIfUniversitiesEmpty: true },
      { name: "yks-data.json", skipIfUniversitiesEmpty: false },
    ];
    var data = null;
    outer: for (var fi = 0; fi < fileSpecs.length; fi++) {
      var spec = fileSpecs[fi];
      var candidates = getHedefCatalogJsonUrlCandidates(spec.name);
      for (var ci = 0; ci < candidates.length; ci++) {
        try {
          var res = await fetch(candidates[ci], { cache: "no-store" });
          if (!res.ok) continue;
          var dataTry = await res.json();
          var ulistCheck = Array.isArray(dataTry.universities) ? dataTry.universities : [];
          if (ulistCheck.length === 0 && spec.skipIfUniversitiesEmpty) continue;
          data = dataTry;
          break outer;
        } catch (_e) {
          /* ağ / parse: sonraki aday */
        }
      }
    }
    if (!data) {
      data = { universities: [], programs: [] };
      if (typeof console !== "undefined" && typeof console.info === "function") {
        console.info(
          "[Uni/Program kataloğu] yok-atlas.json / yks-data.json yüklenemedi (src/data veya /data yollarını kontrol edin); boş katalog kullanılıyor."
        );
      }
    }
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
  } catch (_e) {
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
