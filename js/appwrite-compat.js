import { ID, Query as AQuery, Account, Permission, Role } from "./appwrite-browser.js?v=20260408-inst";
import {
  client,
  databases,
  APPWRITE_DATABASE_ID,
  storage,
  APPWRITE_BUCKET_AVATARLAR,
} from "./appwrite-config.js?v=20260408-inst";

/**
 * Appwrite Databases (ve uyumluluk katmanı) hataları — tek tip konsol çıktısı.
 * @param {string} where örn. "appwrite-compat.js/getDocs"
 * @param {unknown} error
 */
export function logAppwriteError(where, error) {
  const code =
    error && error.code != null
      ? error.code
      : error && error.type != null
        ? error.type
        : "";
  const message = error && error.message != null ? String(error.message) : String(error || "");
  console.error("Appwrite Hatası [" + where + "]:", code, message);
}

const db = { kind: "appwrite-db" };
const account = new Account(client);

/**
 * Koç izolasyonu: `coach_id` alanı + belge ACL (oturum Appwrite `$id`).
 * Not: `coach_id` veri alanında genelde koç kullanıcı adı; ACL `Role.user(session.$id)` ile eşleşir.
 */
const COACH_SCOPED_COLLECTION_IDS = new Set([
  "students",
  "exams",
  "appointments",
  "ExamResults",
  "meeting_logs",
]);

var __dataCoachId = "";
/** Oturumdaki koçun kurum kimliği (Appwrite belge $id); sorgu + yazma izolasyonu */
var __dataInstitutionId = "";
var __aclUserId = "";
var __skipDocumentAcl = false;
/** @type {((studentDocId: string) => boolean) | null} */
var __examStudentGuard = null;

/**
 * Koç paneli oturumu: sorgu filtresi + yeni belge izinleri.
 * @param {{ coachIdForQueries?: string, institutionIdForQueries?: string, appwriteUserId?: string, skipDocumentAcl?: boolean }} opts
 */
export function setCoachDataIsolation(opts) {
  opts = opts || {};
  __dataCoachId = String(opts.coachIdForQueries || "").trim();
  __dataInstitutionId = String(opts.institutionIdForQueries || "").trim();
  __aclUserId = String(opts.appwriteUserId || "").trim();
  __skipDocumentAcl = !!opts.skipDocumentAcl;
}

export function clearCoachDataIsolation() {
  __dataCoachId = "";
  __dataInstitutionId = "";
  __aclUserId = "";
  __skipDocumentAcl = false;
  __examStudentGuard = null;
}

/**
 * `exams` oluşturmadan önce studentId doğrulaması (koçun öğrenci listesi).
 * @param {(studentDocId: string) => boolean | null} fn
 */
export function setExamStudentGuard(fn) {
  __examStudentGuard = typeof fn === "function" ? fn : null;
}

function isCoachScopedCollection(collectionId) {
  return COACH_SCOPED_COLLECTION_IDS.has(String(collectionId || ""));
}

function constraintsIncludeCoachIdEqual(constraints) {
  return (constraints || []).some(function (c) {
    return c && c.__type === "where" && c.field === "coach_id" && c.op === "==";
  });
}

function constraintsIncludeInstitutionIdEqual(constraints) {
  return (constraints || []).some(function (c) {
    return c && c.__type === "where" && c.field === "institutionId" && c.op === "==";
  });
}

function queriesArrayMentionsCoachId(queries) {
  return (queries || []).some(function (q) {
    var s = typeof q === "string" ? q : String(q && q.toString ? q.toString() : q || "");
    return /coach_id/i.test(s);
  });
}

function queriesArrayMentionsInstitutionId(queries) {
  return (queries || []).some(function (q) {
    var s = typeof q === "string" ? q : String(q && q.toString ? q.toString() : q || "");
    return /institutionId/i.test(s);
  });
}

function buildScopedDocumentPermissions() {
  if (__skipDocumentAcl || !__aclUserId) return undefined;
  if (!Permission || !Role || typeof Permission.read !== "function" || typeof Role.user !== "function") {
    return undefined;
  }
  try {
    var uid = __aclUserId;
    return [Permission.read(Role.user(uid)), Permission.write(Role.user(uid))];
  } catch (_e) {
    return undefined;
  }
}

function mergeCoachIdIntoPayload(collectionId, payload) {
  if (!isCoachScopedCollection(collectionId)) return;
  if (__dataCoachId) {
    var hasCoach =
      (payload.coach_id != null && String(payload.coach_id).trim() !== "") ||
      (payload.coachId != null && String(payload.coachId).trim() !== "");
    if (!hasCoach) payload.coach_id = __dataCoachId;
  }
  if (__dataInstitutionId) {
    if (payload.institutionId == null || String(payload.institutionId).trim() === "") {
      payload.institutionId = __dataInstitutionId;
    }
  }
}

function validateExamPayloadBeforeNormalize(raw) {
  var sid = raw.studentId != null ? raw.studentId : raw.student_id;
  sid = sid != null ? String(sid).trim() : "";
  if (!sid) {
    throw new Error("Deneme kaydı için geçerli öğrenci (studentId) zorunludur.");
  }
  if (__examStudentGuard && !__examStudentGuard(sid)) {
    throw new Error("Deneme yalnızca paneldeki kendi öğrencilerinize atanabilir (studentId doğrulanamadı).");
  }
}

/** Oturum yenileme aralığı (çok sık account.get isteğini keser) */
const AUTH_REFRESH_INTERVAL_MS = 120000;

/**
 * 404 / koleksiyon yok: sayfa yenilenene kadar tekrar istek atma (devre kesici).
 * @type {Set<string>}
 */
const __blacklistedCollections = new Set();

/**
 * Belirli döküman 404 (örn. settings/app yok).
 * Anahtar: collectionId + "\0" + docId
 * @type {Set<string>}
 */
const __blacklistedDocPaths = new Set();

function __docPathKey(collectionId, docId) {
  return String(collectionId || "") + "\0" + String(docId || "");
}

function __is404ishError(e) {
  const msg = e && e.message != null ? String(e.message) : String(e || "");
  const code = e && (e.code != null ? e.code : e.type);
  return (
    code === 404 ||
    /404|not be found|could not be found|not_found|collection_not_found|document_not_found/i.test(msg)
  );
}

function __isCollectionMissingError(e) {
  const msg = e && e.message != null ? String(e.message) : String(e || "");
  const type = e && e.type != null ? String(e.type).toLowerCase() : "";
  if (type === "collection_not_found" || /collection_not_found/i.test(type)) return true;
  return /collection.*not found|unknown collection|invalid collection|could not be found|collection with the requested id could not be found/i.test(
    msg
  );
}

/** createDocument / updateDocument: koleksiyon yok veya benzeri 404. */
function __isWriteMissingCollectionError(e) {
  if (__isCollectionMissingError(e)) return true;
  if (__is404ishError(e)) {
    const msg = String((e && e.message) || "");
    if (/collection/i.test(msg)) return true;
  }
  return false;
}

function __rethrowAsCollectionMissing(err, collectionId) {
  __blacklistedCollections.add(collectionId);
  const hint =
    'Appwrite’da «' +
    collectionId +
    '» koleksiyonu bulunamadı. Console’da bu veritabanında koleksiyonu oluşturun; gerekli attribute listesi için js/derece-board.js dosyası başındaki "APPWRITE GEREKSİNİMLERİ" yorumuna bakın (veya repo kökünde node appwrite-setup.js çalıştırın).';
  console.warn("[Appwrite]", hint, err && err.message ? "(" + err.message + ")" : "");
  const e2 = new Error(hint);
  e2.code = "COLLECTION_MISSING";
  e2.collectionId = collectionId;
  e2.original = err;
  throw e2;
}

/**
 * UI / modüller: kullanıcıya gösterilecek eksik koleksiyon hatası mı?
 * @param {unknown} e
 */
export function isAppwriteCollectionMissingError(e) {
  if (!e) return false;
  if (/** @type {{ code?: string }} */ (e).code === "COLLECTION_MISSING") return true;
  return __isWriteMissingCollectionError(e);
}

/** Şemada olmayan attribute / geçersiz sorgu (400) — boş liste, konsol gürültüsü yok */
function __isInvalidQueryError(e) {
  const code = e && (e.code != null ? e.code : e.type);
  const msg = e && e.message != null ? String(e.message) : String(e || "");
  return (
    code === 400 ||
    /invalid query|attribute.*not found|not found in schema|index.*not found/i.test(msg)
  );
}

/** Okuma/yazma: izin, forbidden, unauthorized — UI çökmeden yumuşak yol */
function __isPermissionLikeError(e) {
  if (!e) return false;
  const code = e.code;
  const type = String(e.type || "").toLowerCase();
  const msg = String(e.message || "").toLowerCase();
  if (code === 401 || code === 403 || code === "401" || code === "403") return true;
  if (type.indexOf("unauthorized") !== -1 || type.indexOf("forbidden") !== -1) return true;
  return (
    /permission|forbidden|unauthorized|not allowed|insufficient|access.*denied/i.test(msg) ||
    /missing scope|scopes/i.test(msg)
  );
}

/**
 * `addDoc` / `setDoc` / `updateDoc` dönüşünde `__softFail: true` ise izin veya koleksiyon/şema kaynaklı iptal.
 * @param {unknown} r
 */
export function isAppwriteWriteSoftFailure(r) {
  return !!(r && typeof r === "object" && /** @type {{ __softFail?: boolean }} */ (r).__softFail === true);
}

function nowIso() {
  return new Date().toISOString();
}

function isDateObject(v) {
  return (
    v != null &&
    typeof v === "object" &&
    Object.prototype.toString.call(v) === "[object Date]" &&
    typeof v.toISOString === "function"
  );
}

function normalizeValue(v) {
  if (v === "__SERVER_TIMESTAMP__") return nowIso();
  if (isDateObject(v)) return v.toISOString();
  /** Firestore Timestamp uyumu (ör. exams.examDate, appointments.scheduledAt) */
  if (v != null && typeof v === "object" && typeof v.toDate === "function") {
    try {
      var td = v.toDate();
      if (td && !isNaN(td.getTime())) return td.toISOString();
    } catch (_e) {}
  }
  if (Array.isArray(v)) return v.map(normalizeValue);
  if (v && typeof v === "object") {
    const out = {};
    Object.keys(v).forEach(function (k) {
      out[k] = normalizeValue(v[k]);
    });
    return out;
  }
  return v;
}

function parseCollectionRef(pathSegments) {
  const seg = pathSegments.slice();
  const collectionId = seg.join("__");
  return { collectionId, pathSegments: seg };
}

function parseDocRef(pathSegments) {
  const seg = pathSegments.slice();
  const docId = seg[seg.length - 1];
  const collectionPath = seg.slice(0, -1);
  const collectionId = collectionPath.join("__");
  return { docId, collectionId, pathSegments: seg };
}

function toSnapshotDoc(doc) {
  return {
    id: doc.$id,
    data: function () {
      return doc;
    },
  };
}

function makeDocsSnapshot(documents) {
  const docs = (documents || []).map(toSnapshotDoc);
  return {
    docs,
    forEach: function (fn) {
      docs.forEach(fn);
    },
    size: docs.length,
    empty: docs.length === 0,
  };
}

export function collection(_db, ...pathSegments) {
  return { __type: "collection", pathSegments };
}

export function doc(_db, ...pathSegments) {
  return { __type: "doc", pathSegments };
}

export function where(field, op, value) {
  return { __type: "where", field, op, value };
}

export function orderBy(field, direction) {
  return { __type: "orderBy", field, direction: direction || "asc" };
}

export function query(collectionRef, ...constraints) {
  return { __type: "query", collectionRef, constraints };
}

function compileConstraints(constraints) {
  const out = [];
  (constraints || []).forEach(function (c) {
    if (!c || c.__type !== "where") return;
    if (c.op === "==") out.push(AQuery.equal(c.field, c.value));
    else if (c.op === "contains") out.push(AQuery.contains(c.field, c.value));
    else if (c.op === "!=") out.push(AQuery.notEqual(c.field, c.value));
    else if (c.op === ">=") out.push(AQuery.greaterThanEqual(c.field, c.value));
    else if (c.op === "<=") out.push(AQuery.lessThanEqual(c.field, c.value));
    else if (c.op === ">") out.push(AQuery.greaterThan(c.field, c.value));
    else if (c.op === "<") out.push(AQuery.lessThan(c.field, c.value));
  });
  (constraints || []).forEach(function (c) {
    if (!c || c.__type !== "orderBy") return;
    if (String(c.direction || "").toLowerCase() === "desc") out.push(AQuery.orderDesc(c.field));
    else out.push(AQuery.orderAsc(c.field));
  });
  return out;
}

export async function addDoc(collectionRef, data) {
  const c = parseCollectionRef(collectionRef.pathSegments);
  const raw = data || {};
  if (c.collectionId === "exams") {
    if (__dataCoachId && !__examStudentGuard) {
      throw new Error("Öğrenci listesi henüz doğrulanmadı. Birkaç saniye bekleyip tekrar deneyin.");
    }
    validateExamPayloadBeforeNormalize(raw);
  }
  const payload = normalizeValue(raw);
  mergeCoachIdIntoPayload(c.collectionId, payload);
  /** institutions: createDocument yükü yalnızca name + createdAt (şemadaki alanlar). */
  var docPayloadForCreate = payload;
  if (String(c.collectionId || "") === "institutions") {
    docPayloadForCreate = {};
    if (payload.name !== undefined && payload.name !== null) docPayloadForCreate.name = payload.name;
    if (payload.createdAt !== undefined && payload.createdAt !== null) docPayloadForCreate.createdAt = payload.createdAt;
  }
  const perms = isCoachScopedCollection(c.collectionId) ? buildScopedDocumentPermissions() : undefined;
  try {
    const res = await databases.createDocument(
      APPWRITE_DATABASE_ID,
      c.collectionId,
      ID.unique(),
      docPayloadForCreate,
      perms
    );
    return { id: res.$id };
  } catch (err) {
    if (__isWriteMissingCollectionError(err)) {
      __blacklistedCollections.add(c.collectionId);
      console.warn(
        "[Appwrite] addDoc yumuşak iptal (koleksiyon/şema):",
        c.collectionId,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { id: null, __softFail: true, message: String((err && err.message) || "") };
    }
    if (__isPermissionLikeError(err)) {
      console.warn(
        "[Appwrite] addDoc yumuşak iptal (izin):",
        c.collectionId,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { id: null, __softFail: true, message: String((err && err.message) || "") };
    }
    logAppwriteError("appwrite-compat.js/addDoc", err);
    throw err;
  }
}

export async function setDoc(docRef, data) {
  const d = parseDocRef(docRef.pathSegments);
  const raw = data || {};
  if (d.collectionId === "exams" && (raw.studentId != null || raw.student_id != null)) {
    if (__dataCoachId && !__examStudentGuard) {
      throw new Error("Öğrenci listesi henüz doğrulanmadı. Birkaç saniye bekleyip tekrar deneyin.");
    }
    validateExamPayloadBeforeNormalize(raw);
  }
  const payload = normalizeValue(raw);
  mergeCoachIdIntoPayload(d.collectionId, payload);
  const docPerms = isCoachScopedCollection(d.collectionId) ? buildScopedDocumentPermissions() : undefined;
  function softReturn(err) {
    if (__isWriteMissingCollectionError(err) || __isPermissionLikeError(err)) {
      __blacklistedCollections.add(d.collectionId);
      console.warn(
        "[Appwrite] setDoc yumuşak iptal:",
        d.collectionId,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { __softFail: true, message: String((err && err.message) || "") };
    }
    return null;
  }
  try {
    await databases.updateDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId, payload);
  } catch (_e) {
    const sr = softReturn(_e);
    if (sr) return sr;
    try {
      await databases.createDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId, payload, docPerms);
    } catch (err) {
      const sr2 = softReturn(err);
      if (sr2) return sr2;
      logAppwriteError("appwrite-compat.js/setDoc", err);
      throw err;
    }
  }
}

export async function updateDoc(docRef, data) {
  const d = parseDocRef(docRef.pathSegments);
  const payload = normalizeValue(data || {});
  try {
    await databases.updateDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId, payload);
  } catch (err) {
    if (__isWriteMissingCollectionError(err) || __isPermissionLikeError(err)) {
      __blacklistedCollections.add(d.collectionId);
      console.warn(
        "[Appwrite] updateDoc yumuşak iptal:",
        d.collectionId,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { __softFail: true, message: String((err && err.message) || "") };
    }
    logAppwriteError("appwrite-compat.js/updateDoc", err);
    throw err;
  }
}

export async function deleteDoc(docRef) {
  const d = parseDocRef(docRef.pathSegments);
  try {
    await databases.deleteDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId);
  } catch (err) {
    if (__isWriteMissingCollectionError(err) || __isPermissionLikeError(err)) {
      console.warn(
        "[Appwrite] deleteDoc yumuşak iptal:",
        d.collectionId,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { __softFail: true, message: String((err && err.message) || "") };
    }
    logAppwriteError("appwrite-compat.js/deleteDoc", err);
    throw err;
  }
}

/**
 * Doğrudan `databases.listDocuments` — eksik koleksiyon / izin / geçersiz sorgu: boş liste + __softFail.
 * Konum çağrı: `(databaseId, collectionId, queries)` veya tek nesne `{ databaseId, collectionId, queries, total? }`.
 */
export async function databasesListDocumentsOrSoft(arg1, arg2, arg3) {
  const useObject =
    arg1 &&
    typeof arg1 === "object" &&
    !Array.isArray(arg1) &&
    (arg1.databaseId != null || arg1.collectionId != null) &&
    arg2 === undefined;

  let databaseId;
  let collectionId;
  let totalFlag = false;
  if (useObject) {
    databaseId = arg1.databaseId;
    collectionId = String(arg1.collectionId || "");
    totalFlag = !!arg1.total;
  } else {
    databaseId = arg1;
    collectionId = String(arg2 || "");
    totalFlag = false;
  }

  if (__blacklistedCollections.has(collectionId)) {
    const empty = { documents: [], __softFail: true };
    if (totalFlag) empty.total = 0;
    return empty;
  }

  try {
    if (useObject) {
      const qIn = Array.isArray(arg1.queries) ? arg1.queries.slice() : [];
      var qObj = qIn;
      if (__dataCoachId && isCoachScopedCollection(collectionId) && !queriesArrayMentionsCoachId(qObj)) {
        qObj = [AQuery.equal("coach_id", __dataCoachId)].concat(qObj);
      }
      if (__dataInstitutionId && isCoachScopedCollection(collectionId) && !queriesArrayMentionsInstitutionId(qObj)) {
        qObj = [AQuery.equal("institutionId", __dataInstitutionId)].concat(qObj);
      }
      return await databases.listDocuments(
        Object.assign({}, arg1, {
          queries: qObj,
        })
      );
    }
    var qList = Array.isArray(arg3) ? arg3.slice() : [];
    if (__dataCoachId && isCoachScopedCollection(collectionId) && !queriesArrayMentionsCoachId(qList)) {
      qList = [AQuery.equal("coach_id", __dataCoachId)].concat(qList);
    }
    if (__dataInstitutionId && isCoachScopedCollection(collectionId) && !queriesArrayMentionsInstitutionId(qList)) {
      qList = [AQuery.equal("institutionId", __dataInstitutionId)].concat(qList);
    }
    return await databases.listDocuments(databaseId, collectionId, qList);
  } catch (err) {
    if (__is404ishError(err) || __isCollectionMissingError(err)) {
      __blacklistedCollections.add(collectionId);
    }
    if (__isCollectionMissingError(err) || __isPermissionLikeError(err) || __isInvalidQueryError(err)) {
      console.warn(
        "[Appwrite] listDocuments yumuşak iptal:",
        collectionId,
        err && err.message ? "(" + err.message + ")" : ""
      );
      const soft = { documents: [], __softFail: true, message: String((err && err.message) || "") };
      if (totalFlag) soft.total = 0;
      return soft;
    }
    logAppwriteError("appwrite-compat.js/databasesListDocumentsOrSoft", err);
    throw err;
  }
}

/** Doğrudan `databases.createDocument` — izin / eksik koleksiyon: __softFail */
export async function databasesCreateDocumentOrSoft(databaseId, collectionId, documentId, data, permissionsOverride) {
  const cid = String(collectionId || "");
  const raw = data || {};
  if (cid === "exams") {
    if (__dataCoachId && !__examStudentGuard) {
      return { __softFail: true, message: "Öğrenci listesi henüz doğrulanmadı." };
    }
    try {
      validateExamPayloadBeforeNormalize(raw);
    } catch (ve) {
      return { __softFail: true, message: String((ve && ve.message) || ve) };
    }
  }
  const payload = normalizeValue(raw);
  mergeCoachIdIntoPayload(cid, payload);
  var perms = permissionsOverride;
  if (perms === undefined && isCoachScopedCollection(cid)) {
    perms = buildScopedDocumentPermissions();
  }
  try {
    return await databases.createDocument(databaseId, cid, documentId, payload, perms);
  } catch (err) {
    if (__isWriteMissingCollectionError(err) || __isPermissionLikeError(err)) {
      __blacklistedCollections.add(cid);
      console.warn(
        "[Appwrite] createDocument yumuşak iptal:",
        cid,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { __softFail: true, message: String((err && err.message) || "") };
    }
    logAppwriteError("appwrite-compat.js/databasesCreateDocumentOrSoft", err);
    throw err;
  }
}

/** Doğrudan `databases.updateDocument` — izin / eksik koleksiyon: __softFail */
export async function databasesUpdateDocumentOrSoft(databaseId, collectionId, documentId, data) {
  const cid = String(collectionId || "");
  const payload = normalizeValue(data || {});
  try {
    await databases.updateDocument(databaseId, cid, documentId, payload);
  } catch (err) {
    if (__isWriteMissingCollectionError(err) || __isPermissionLikeError(err)) {
      __blacklistedCollections.add(cid);
      console.warn(
        "[Appwrite] updateDocument yumuşak iptal:",
        cid,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { __softFail: true, message: String((err && err.message) || "") };
    }
    logAppwriteError("appwrite-compat.js/databasesUpdateDocumentOrSoft", err);
    throw err;
  }
}

/** Doğrudan `databases.deleteDocument` — izin / eksik koleksiyon: __softFail */
export async function databasesDeleteDocumentOrSoft(databaseId, collectionId, documentId) {
  const cid = String(collectionId || "");
  try {
    await databases.deleteDocument(databaseId, cid, documentId);
  } catch (err) {
    if (__isWriteMissingCollectionError(err) || __isPermissionLikeError(err)) {
      console.warn(
        "[Appwrite] deleteDocument yumuşak iptal:",
        cid,
        err && err.message ? "(" + err.message + ")" : ""
      );
      return { __softFail: true, message: String((err && err.message) || "") };
    }
    logAppwriteError("appwrite-compat.js/databasesDeleteDocumentOrSoft", err);
    throw err;
  }
}

export async function getDoc(docRef) {
  const d = parseDocRef(docRef.pathSegments);
  if (__blacklistedDocPaths.has(__docPathKey(d.collectionId, d.docId))) {
    return {
      id: d.docId,
      exists: function () {
        return false;
      },
      data: function () {
        return {};
      },
    };
  }
  try {
    const res = await databases.getDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId);
    return {
      id: res.$id,
      exists: function () {
        return true;
      },
      data: function () {
        return res;
      },
    };
  } catch (e) {
    const msg = e && e.message != null ? String(e.message) : String(e || "");
    const code = e && (e.code != null ? e.code : e.type);
    const is404 =
      code === 404 ||
      /404|could not be found|not be found|document_not_found|not_found/i.test(msg);
    if (is404) {
      __blacklistedDocPaths.add(__docPathKey(d.collectionId, d.docId));
    } else {
      logAppwriteError("appwrite-compat.js/getDoc", e);
    }
    return {
      id: d.docId,
      exists: function () {
        return false;
      },
      data: function () {
        return {};
      },
    };
  }
}

export async function getDocs(refOrQuery) {
  let cRef = refOrQuery;
  let constraints = [];
  if (refOrQuery && refOrQuery.__type === "query") {
    cRef = refOrQuery.collectionRef;
    constraints = refOrQuery.constraints || [];
  }
  const c = parseCollectionRef(cRef.pathSegments);
  if (__blacklistedCollections.has(c.collectionId)) {
    return makeDocsSnapshot([]);
  }
  const queries = compileConstraints(constraints);
  if (__dataCoachId && isCoachScopedCollection(c.collectionId) && !constraintsIncludeCoachIdEqual(constraints)) {
    queries.unshift(AQuery.equal("coach_id", __dataCoachId));
  }
  if (__dataInstitutionId && isCoachScopedCollection(c.collectionId) && !constraintsIncludeInstitutionIdEqual(constraints)) {
    queries.unshift(AQuery.equal("institutionId", __dataInstitutionId));
  }
  queries.push(AQuery.limit(500));
  try {
    const res = await databases.listDocuments(APPWRITE_DATABASE_ID, c.collectionId, queries);
    return makeDocsSnapshot(res.documents || []);
  } catch (e) {
    if (__is404ishError(e) || __isCollectionMissingError(e)) {
      __blacklistedCollections.add(c.collectionId);
    } else if (__isInvalidQueryError(e) || __isPermissionLikeError(e)) {
      console.warn("[Appwrite] getDocs yumuşak iptal:", c.collectionId, e && e.message ? "(" + e.message + ")" : "");
    } else {
      logAppwriteError("appwrite-compat.js/getDocs", e);
    }
    return makeDocsSnapshot([]);
  }
}

export async function getCountFromServer(refOrQuery) {
  const snap = await getDocs(refOrQuery);
  return {
    data: function () {
      return { count: snap.size };
    },
  };
}

export function serverTimestamp() {
  return "__SERVER_TIMESTAMP__";
}

export const Timestamp = {
  now: function () {
    return {
      toDate: function () {
        return new Date();
      },
      toMillis: function () {
        return Date.now();
      },
    };
  },
  fromDate: function (d) {
    const date = isDateObject(d) ? d : new Date(d);
    return {
      toDate: function () {
        return date;
      },
      toMillis: function () {
        return date.getTime();
      },
    };
  },
};

function makeAuthUser(u) {
  if (!u) return null;
  return {
    uid: u.$id,
    email: u.email,
    getIdToken: function () {
      return Promise.resolve("appwrite-session");
    },
  };
}

const authState = {
  currentUser: null,
  listeners: [],
  started: false,
};

/**
 * Appwrite oturumu gerçekten bitmiş mi (401 / unauthorized)?
 * Geçici ağ veya 5xx hatalarında false döner — oturum düşürülmez.
 */
export function isAppwriteSessionInvalidError(e) {
  if (!e) return false;
  var code = e.code;
  var type = String(e.type || "").toLowerCase();
  var msg = String(e.message || "").toLowerCase();
  if (code === 401 || code === "401") return true;
  if (
    type === "user_unauthorized" ||
    type === "general_unauthorized" ||
    type === "general_unauthorized_scope"
  )
    return true;
  return /unauthorized|invalid_credentials|session.*invalid|jwt.*expired|missing.*session/i.test(
    msg
  );
}

async function refreshCurrentUser() {
  try {
    const u = await account.get();
    authState.currentUser = makeAuthUser(u);
  } catch (e) {
    if (isAppwriteSessionInvalidError(e)) {
      authState.currentUser = null;
    } else if (authState.currentUser) {
      console.warn(
        "[auth] refreshCurrentUser: geçici hata — oturum korunuyor (Zoho/API 401 vb. burada işlenmez).",
        e && e.message
      );
    } else {
      authState.currentUser = null;
    }
  }
  return authState.currentUser;
}

/**
 * Appwrite account.get() ile oturum doğrulama; ağ/Appwrite takılırsa zaman aşımı.
 * @param {number} [timeoutMs=5000]
 */
export async function verifyAppwriteAccount(timeoutMs) {
  const ms = typeof timeoutMs === "number" && timeoutMs > 0 ? timeoutMs : 5000;
  try {
    const u = await Promise.race([
      account.get(),
      new Promise(function (_, reject) {
        setTimeout(function () {
          reject(new Error("Oturum doğrulama zaman aşımı."));
        }, ms);
      }),
    ]);
    return { ok: true, user: u };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e : new Error(String(e)) };
  }
}

function emitAuth() {
  authState.listeners.forEach(function (fn) {
    try {
      fn(authState.currentUser);
    } catch (_e) {}
  });
}

function ensureAuthLoop() {
  if (authState.started) return;
  authState.started = true;
  refreshCurrentUser()
    .then(emitAuth)
    .catch(function (e) {
      console.error("[auth] refreshCurrentUser", e);
    });
  setInterval(function () {
    refreshCurrentUser()
      .then(emitAuth)
      .catch(function (e) {
        console.error("[auth] refreshCurrentUser", e);
      });
  }, AUTH_REFRESH_INTERVAL_MS);
}

export const auth = {
  get currentUser() {
    return authState.currentUser;
  },
};

export const coachCreatorAuth = auth;
export const studentCreatorAuth = auth;
export const studentCreatorAuthKoc = auth;

export function onAuthStateChanged(_auth, callback) {
  ensureAuthLoop();
  authState.listeners.push(callback);
  callback(authState.currentUser);
  return function () {
    authState.listeners = authState.listeners.filter(function (x) {
      return x !== callback;
    });
  };
}

export async function signOut() {
  try {
    await account.deleteSession("current");
  } catch (_e) {}
  authState.currentUser = null;
  emitAuth();
}

export async function signInWithEmailAndPassword(_auth, email, password) {
  const em = String(email || "");
  const pw = String(password || "");
  try {
    await account.createEmailPasswordSession(em, pw);
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (/session is active|session.*active/i.test(msg)) {
      try {
        await account.deleteSession("current");
      } catch (_deleteErr) {}
      await account.createEmailPasswordSession(em, pw);
    } else {
      throw e;
    }
  }
  const u = await refreshCurrentUser();
  emitAuth();
  return { user: u };
}

export async function createUserWithEmailAndPassword(_auth, email, password) {
  const em = String(email || "");
  const pw = String(password || "");
  await account.create(ID.unique(), em, pw);
  try {
    await account.createEmailPasswordSession(em, pw);
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (/session is active|session.*active/i.test(msg)) {
      try {
        await account.deleteSession("current");
      } catch (_deleteErr) {}
      await account.createEmailPasswordSession(em, pw);
    } else {
      throw e;
    }
  }
  const u = await refreshCurrentUser();
  emitAuth();
  return { user: u };
}

/**
 * Yalnızca Appwrite e-posta/şifre hesabı oluşturur; oturum açmaz (createEmailPasswordSession yok).
 * Koç panelinde öğrenci eklerken mevcut koç oturumunun ezilmemesi için kullanılır.
 */
export async function createEmailPasswordUserNoSession(email, password) {
  const em = String(email || "").trim();
  const pw = String(password || "");
  const created = await account.create(ID.unique(), em, pw);
  await refreshCurrentUser();
  emitAuth();
  return { user: makeAuthUser({ $id: created.$id, email: em }) };
}

/**
 * Kurucu (admin) oturumu açıkken yeni e-posta/şifre hesabı oluşturur; Appwrite tarafında
 * kayıt aşaması oturum gerektirmediği için önce çıkış, sonra kayıt, sonra kurucu girişi yapılır.
 * (Bu sayede yeni kullanıcıya oturum açılmaz ve liste sonrası signOut kurucuyu düşürmez.)
 */
export async function createUserWithEmailAndRestoreAdmin(
  _auth,
  adminEmail,
  adminPassword,
  newEmail,
  newPassword
) {
  const em = String(newEmail || "");
  const pw = String(newPassword || "");
  const aem = String(adminEmail || "").trim();
  const apw = String(adminPassword || "");
  await signOut();
  let newUser;
  try {
    newUser = await account.create(ID.unique(), em, pw);
  } catch (e) {
    try {
      await signInWithEmailAndPassword(auth, aem, apw);
    } catch (_e2) {}
    const msg = String((e && e.message) || e || "");
    if (/already exists|409|duplicate|user_already|same email/i.test(msg)) {
      const err = new Error("Bu kullanıcı adı zaten kayıtlı.");
      err.code = "auth/email-already-in-use";
      throw err;
    }
    throw e;
  }
  try {
    await signInWithEmailAndPassword(auth, aem, apw);
  } catch (e) {
    const err = new Error(
      "Kullanıcı oluşturuldu ancak kurucu oturumu açılamadı. Giriş sayfasından kurucu olarak giriş yapın."
    );
    err.cause = e;
    throw err;
  }
  const uid = newUser && newUser.$id ? newUser.$id : "";
  return { user: makeAuthUser({ $id: uid, email: em }) };
}

export async function fetchSignInMethodsForEmail() {
  return ["password"];
}

/**
 * Appwrite: PATCH /account/password — e-posta/şifre hesaplarında genelde eski şifre gerekir.
 * @param {string} newPassword
 * @param {string} [oldPassword]
 */
export async function updatePassword(newPassword, oldPassword) {
  const np = String(newPassword || "");
  const op = oldPassword !== undefined && oldPassword !== null ? String(oldPassword) : "";
  await account.updatePassword({
    password: np,
    oldPassword: op || undefined,
  });
}

/**
 * Appwrite: PATCH /account/email — güvenlik için mevcut şifre zorunlu.
 * @param {string} newEmail
 * @param {string} currentPassword
 */
export async function updateEmail(newEmail, currentPassword) {
  await account.updateEmail({
    email: String(newEmail || ""),
    password: String(currentPassword || ""),
  });
}

/** Appwrite: PATCH /account/name — görünen ad (Profil ayarları) */
export async function updateAccountName(name) {
  await account.updateName({ name: String(name || "").trim() });
}

/** Appwrite: GET /account/prefs — tercihler (avatarFileId / avatarUrl vb.) */
export async function getAccountPrefs() {
  const p = await account.getPrefs();
  return p && typeof p === "object" && !Array.isArray(p) ? p : {};
}

/**
 * Appwrite: PATCH /account/prefs — mevcut tercihlerle birleştirir (tam nesne replace olduğu için).
 * Boş string / null / undefined değerler ilgili anahtarı siler.
 */
export async function updateAccountPrefs(patch) {
  const cur = await getAccountPrefs();
  const next = Object.assign({}, cur);
  Object.keys(patch || {}).forEach(function (k) {
    const v = patch[k];
    if (v === "" || v === null || v === undefined) {
      delete next[k];
    } else {
      next[k] = v;
    }
  });
  await account.updatePrefs({ prefs: next });
}

/** Koç avatarı — Storage kovasına yükler, dosya kimliğini döner. */
export async function uploadCoachAvatarToStorage(file) {
  const f = file instanceof File ? file : new File([file], "avatar.jpg", { type: "image/jpeg" });
  const fid = ID.unique();
  try {
    await storage.createFile({
      bucketId: APPWRITE_BUCKET_AVATARLAR,
      fileId: fid,
      file: f,
    });
  } catch (_e) {
    await storage.createFile(APPWRITE_BUCKET_AVATARLAR, fid, f);
  }
  return fid;
}

/**
 * Oturum açık kullanıcıyı kalıcı olarak engeller (tam silme yalnızca Users API + sunucu anahtarı ile).
 * Kurucu panelinde hedef hesaba geçiş yapıldıktan sonra silme akışında kullanılır.
 */
export async function blockCurrentAccount() {
  await account.updateStatus();
}

export async function sendPasswordResetEmail(email) {
  await account.createRecovery(String(email || ""), window.location.origin + "/pages/login.html");
}

/**
 * Firestore uyumluluğu: ilk okuma + isteğe bağlı aralıklı yeniden okuma (Realtime yok / WS koptu yedek).
 * @param {{ pollIntervalMs?: number, pollIntervalMsDoc?: number } | undefined} snapshotOpts Tek belge için `pollIntervalMsDoc`, sorgu için `pollIntervalMs`.
 */
export function onSnapshot(refOrQuery, callback, onError, snapshotOpts) {
  let active = true;
  let intervalId = null;
  const so = snapshotOpts && typeof snapshotOpts === "object" ? snapshotOpts : {};
  const isDoc = !!(refOrQuery && refOrQuery.__type === "doc");
  const pollMs = isDoc ? Math.max(0, parseInt(String(so.pollIntervalMsDoc || 0), 10) || 0) : Math.max(0, parseInt(String(so.pollIntervalMs || 0), 10) || 0);
  async function tick() {
    if (!active) return;
    try {
      if (refOrQuery && refOrQuery.__type === "doc") {
        const snap = await getDoc(refOrQuery);
        callback(snap);
      } else {
        const snap = await getDocs(refOrQuery);
        callback(snap);
      }
    } catch (e) {
      console.warn("[Appwrite] onSnapshot:", e && e.message ? e.message : e);
      if (typeof onError === "function") {
        try {
          onError(e);
        } catch (_e2) {}
      } else {
        try {
          if (refOrQuery && refOrQuery.__type === "doc") {
            callback({
              id: "",
              exists: function () {
                return false;
              },
              data: function () {
                return {};
              },
            });
          } else {
            callback(makeDocsSnapshot([]));
          }
        } catch (_e3) {}
      }
    }
  }
  tick();
  if (pollMs > 0) {
    intervalId = setInterval(tick, pollMs);
  }
  return function () {
    active = false;
    if (intervalId != null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  };
}

/** `settings` / `app` yokken bakım modu kapalı sayılır (404 konsol gürültüsü yok). */
export const DEFAULT_APP_SETTINGS = Object.freeze({ maintenance: false });

/**
 * @returns {Promise<{ maintenance: boolean }>}
 */
export async function getAppSettings() {
  const snap = await getDoc(doc(db, "settings", "app"));
  if (snap.exists && typeof snap.data === "function") {
    const d = snap.data() || {};
    return { maintenance: d.maintenance === true };
  }
  return { maintenance: DEFAULT_APP_SETTINGS.maintenance };
}

export { db };
