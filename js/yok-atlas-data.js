/**
 * Koç paneli Hedef Simülatörü — üniversite / program atlas verisi.
 * `src/data/yks-data.json` → hedef-appwrite-catalog ile doldurulur (Appwrite yok).
 */
import {
  ensureHedefSimulatorAppwriteData,
  getHedefAppwriteUniversities,
  getAllHedefPrograms,
  hedefUniDisplayName,
  hedefProgramDisplayName,
} from "./hedef-appwrite-catalog.js";
import { buildProgramFromAppwriteV2 } from "./net-sihirbazi-engine.js";

await ensureHedefSimulatorAppwriteData();

var _uniById = Object.create(null);
getHedefAppwriteUniversities().forEach(function (u) {
  var id = String(u.$id || "");
  if (id) _uniById[id] = u;
});

export var TR_UNIVERSITIES_UNIQUE = getHedefAppwriteUniversities().map(function (u) {
  var id = String(u.$id || "");
  return { id: id, name: hedefUniDisplayName(u) || id };
});

var _progById = Object.create(null);
getAllHedefPrograms().forEach(function (p) {
  var id = String(p.$id || "");
  if (id) _progById[id] = p;
});

export var PROGRAM_TEMPLATES_UI = getAllHedefPrograms().map(function (p) {
  return { id: String(p.$id), name: hedefProgramDisplayName(p) || p.$id };
});

/**
 * @param {string} atlasId — `uniId__programId`
 */
export function findAtlasProgramById(atlasId) {
  var s = String(atlasId || "");
  var ix = s.indexOf("__");
  if (ix <= 0) return null;
  var uniId = s.slice(0, ix);
  var pid = s.slice(ix + 2);
  var uni = _uniById[uniId];
  var prog = _progById[pid];
  if (!uni || !prog || String(prog.uniId) !== uniId) return null;
  return buildProgramFromAppwriteV2(uni, prog);
}

/**
 * @param {string} uniId
 * @param {string} tmplId — program $id
 */
export function buildProgramFromUniTemplate(uniId, tmplId) {
  return findAtlasProgramById(String(uniId) + "__" + String(tmplId));
}
