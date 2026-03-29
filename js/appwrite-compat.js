import { ID, Query as AQuery, Account } from "./appwrite-browser.js";
import {
  client,
  databases,
  APPWRITE_DATABASE_ID,
  storage,
  APPWRITE_BUCKET_AVATARLAR,
} from "./appwrite-config.js";

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
  return /collection.*not found|unknown collection|Invalid collection|could not be found/i.test(msg);
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
  const payload = normalizeValue(data || {});
  try {
    const res = await databases.createDocument(APPWRITE_DATABASE_ID, c.collectionId, ID.unique(), payload);
    return { id: res.$id };
  } catch (err) {
    logAppwriteError("appwrite-compat.js/addDoc", err);
    throw err;
  }
}

export async function setDoc(docRef, data) {
  const d = parseDocRef(docRef.pathSegments);
  const payload = normalizeValue(data || {});
  try {
    await databases.updateDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId, payload);
  } catch (_e) {
    try {
      await databases.createDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId, payload);
    } catch (err) {
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
    logAppwriteError("appwrite-compat.js/updateDoc", err);
    throw err;
  }
}

export async function deleteDoc(docRef) {
  const d = parseDocRef(docRef.pathSegments);
  try {
    await databases.deleteDocument(APPWRITE_DATABASE_ID, d.collectionId, d.docId);
  } catch (err) {
    logAppwriteError("appwrite-compat.js/deleteDoc", err);
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
  queries.push(AQuery.limit(500));
  try {
    const res = await databases.listDocuments(APPWRITE_DATABASE_ID, c.collectionId, queries);
    return makeDocsSnapshot(res.documents || []);
  } catch (e) {
    if (__is404ishError(e) || __isCollectionMissingError(e)) {
      __blacklistedCollections.add(c.collectionId);
    } else if (!__isInvalidQueryError(e)) {
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
function __isAppwriteSessionInvalidError(e) {
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
    if (__isAppwriteSessionInvalidError(e)) {
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
  await account.createRecovery(String(email || ""), window.location.origin + "/login");
}

/**
 * Firestore uyumluluğu: tek seferlik okuma (sayfa yüklendiğinde). Sürekli polling yok.
 * Güncellemeler için sayfa yenileme veya ayrıca manuel yeniden abonelik gerekir.
 */
export function onSnapshot(refOrQuery, callback, onError) {
  let active = true;
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
      if (typeof onError === "function") {
        try {
          onError(e);
        } catch (_e2) {}
      } else {
        logAppwriteError("appwrite-compat.js/onSnapshot", e);
      }
    }
  }
  tick();
  return function () {
    active = false;
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
