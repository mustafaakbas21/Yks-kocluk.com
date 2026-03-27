/**
 * Üniversite / bölüm tek kaynak: Appwrite Universities + Programs.
 * import-excel-to-appwrite.js, auto-fetch-yokatlas.js veya yokatlas-py ile doldurulur.
 */

import { Query } from "./appwrite-browser.js";
import {
  databases,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_UNIVERSITIES,
  APPWRITE_COLLECTION_PROGRAMS,
} from "./appwrite-config.js";

var PAGE = 500;
/** @type {boolean} */
var _ready = false;
/** @type {object[]} */
var _universities = [];
/** @type {Record<string, object[]>} */
var _programsByUni = Object.create(null);
/** @type {Record<string, Promise<object[]>>} */
var _progPromises = Object.create(null);

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

async function listAllDocuments(collectionId, extraQueries) {
  var all = [];
  var cursor = null;
  for (;;) {
    var q = [Query.limit(PAGE)].concat(extraQueries || []);
    if (cursor) q.push(Query.cursorAfter(cursor));
    var res = await databases.listDocuments(APPWRITE_DATABASE_ID, collectionId, q);
    var docs = (res && res.documents) || [];
    all = all.concat(docs);
    if (docs.length < PAGE) break;
    cursor = docs[docs.length - 1].$id;
  }
  return all;
}

/**
 * Universities listesini Appwrite’tan bir kez yükler (boş dizi olabilir).
 */
export async function ensureHedefSimulatorAppwriteData() {
  if (_ready) return;
  try {
    var list = await listAllDocuments(APPWRITE_COLLECTION_UNIVERSITIES, []);
    list.sort(function (a, b) {
      return hedefUniDisplayName(a).localeCompare(hedefUniDisplayName(b), "tr");
    });
    _universities = list;
  } catch (e) {
    console.warn("[Uni/Program kataloğu] Appwrite Universities okunamadı:", e && e.message ? e.message : e);
    _universities = [];
  }
  _ready = true;
}

export function isHedefAppwriteCatalogReady() {
  return _ready;
}

export function getHedefAppwriteUniversities() {
  return _universities || [];
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
  if (Object.prototype.hasOwnProperty.call(_programsByUni, uid)) {
    return Promise.resolve(_programsByUni[uid]);
  }
  if (_progPromises[uid]) return _progPromises[uid];
  _progPromises[uid] = listAllDocuments(APPWRITE_COLLECTION_PROGRAMS, [Query.equal("uniId", uid)])
    .then(function (docs) {
      docs.sort(function (a, b) {
        return hedefProgramDisplayName(a).localeCompare(hedefProgramDisplayName(b), "tr");
      });
      _programsByUni[uid] = docs;
      delete _progPromises[uid];
      return docs;
    })
    .catch(function (err) {
      delete _progPromises[uid];
      console.error("[Uni/Program kataloğu] Programs yüklenemedi:", err);
      _programsByUni[uid] = [];
      return [];
    });
  return _progPromises[uid];
}

export function invalidateHedefAppwriteCache() {
  _ready = false;
  _universities = [];
  for (var k in _programsByUni) {
    if (Object.prototype.hasOwnProperty.call(_programsByUni, k)) delete _programsByUni[k];
  }
}
