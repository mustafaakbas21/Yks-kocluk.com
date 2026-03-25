/**
 * Soru havuzu — Appwrite `derece_panel` / `soru_havuzu` + Storage `soru_havuzu`
 */
import { ID, Query } from "./appwrite-browser.js";
import {
  databases,
  storage,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_SORULAR,
  APPWRITE_BUCKET_SORU_HAVUZU,
} from "./appwrite-config.js";

const DATABASE_ID = APPWRITE_DATABASE_ID;
const COLLECTION_ID = APPWRITE_COLLECTION_SORULAR;
const BUCKET_ID = APPWRITE_BUCKET_SORU_HAVUZU;

const PAGE_SIZE = 100;

export function getPoolCoachKey() {
  try {
    var imp = sessionStorage.getItem("superAdminViewAsCoach");
    if (imp && String(imp).trim()) return String(imp).trim();
  } catch (e) {}
  try {
    var cu = (localStorage.getItem("currentUser") || "").trim();
    if (cu) return cu;
  } catch (e2) {}
  try {
    var yc = (localStorage.getItem("yksCoachId") || "").trim();
    if (yc) return yc;
  } catch (e3) {}
  return "";
}

function coachKeyUsable(k) {
  return typeof k === "string" && k.trim().length > 0;
}

/** Appwrite şemasında coach_id yoksa veya sorgu geçersizse */
function isCoachIdUnavailableError(err) {
  var m = String((err && err.message) || err || "");
  return /coach_id|Attribute not found|not found in schema|Invalid query/i.test(m);
}

/**
 * coach_id alanı yoksa veya boşsa (legacy havuz) satırı bu koça aç.
 * Alan doluysa yalnızca eşleşen koç görür.
 */
function poolDocMatchesCoach(row, coachKey) {
  if (!coachKeyUsable(coachKey)) return false;
  var c = row && row.coach_id;
  if (c === undefined || c === null || String(c).trim() === "") return true;
  return String(c) === String(coachKey);
}

/**
 * Yeni havuz kayıtlarında `sinav` alanı olmayabilir; o zaman sınav seçimini eşleşmiş say (havuz boş kalmasın).
 */
function rowMatchesExamFilter(row, examWanted) {
  var want = String(examWanted || "").trim();
  if (!want) return true;
  var s = String((row.sinav != null ? row.sinav : row.sinavTipi) || "").trim();
  if (!s) return true;
  return s === want;
}

export function dataUrlToBlob(dataUrl) {
  var s = String(dataUrl || "");
  var i = s.indexOf(",");
  if (i === -1) throw new Error("Geçersiz görsel verisi.");
  var header = s.slice(0, i);
  var body = s.slice(i + 1);
  var mimeMatch = header.match(/data:(.*?);base64/);
  var mime = mimeMatch ? mimeMatch[1] : "image/png";
  var bin = atob(body);
  var n = bin.length;
  var u8 = new Uint8Array(n);
  while (n--) u8[n] = bin.charCodeAt(n);
  return new Blob([u8], { type: mime });
}

function guessImageExtAndMime(blob, fileName) {
  var t = (blob && blob.type && String(blob.type).trim()) || "";
  var lower = t.toLowerCase();
  if (lower.indexOf("png") >= 0) return { ext: "png", mime: "image/png" };
  if (lower.indexOf("webp") >= 0) return { ext: "webp", mime: "image/webp" };
  if (lower.indexOf("jpeg") >= 0 || lower.indexOf("jpg") >= 0)
    return { ext: "jpg", mime: lower || "image/jpeg" };
  var name = String(fileName || "").toLowerCase();
  if (/\.png$/i.test(name)) return { ext: "png", mime: "image/png" };
  if (/\.webp$/i.test(name)) return { ext: "webp", mime: "image/webp" };
  if (/\.jpe?g$/i.test(name)) return { ext: "jpg", mime: "image/jpeg" };
  return { ext: "png", mime: "image/png" };
}

function mapAppwriteDoc(d) {
  if (!d) return null;
  var created = d.$createdAt ? new Date(d.$createdAt).getTime() : 0;
  return Object.assign({}, d, {
    id: d.$id,
    firestoreId: d.$id,
    createdAt: {
      toMillis: function () {
        return created;
      },
    },
  });
}

function shuffleInPlace(arr) {
  var a = arr || [];
  for (var i = a.length - 1; i > 0; i--) {
    var j = Math.floor(Math.random() * (i + 1));
    var t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

/**
 * Havuz belgesinden A4 / AI akışı için görsel URL + meta (storage_file_id / soru_resim_id yedekli).
 */
export function normalizeSoruPoolDocForAi(d) {
  if (!d) return null;
  var url = String((d.image_url || d.imageUrl || "") || "").trim();
  if (!url) {
    var fid = String((d.soru_resim_id || d.storage_file_id || d.storageFileId || "") || "").trim();
    if (fid) {
      try {
        url = String(storage.getFileView(BUCKET_ID, fid) || "").trim();
      } catch (e) {
        console.warn("[soru_havuzu] getFileView:", fid, e);
      }
    }
  }
  if (!url) return null;
  return {
    id: d.$id || d.id,
    firestoreId: d.$id || d.id,
    imageUrl: url,
    image_url: url,
    ders: d.ders || "",
    konu: d.konu || "",
    zorluk: d.zorluk || "",
    sinav: d.sinav || d.sinavTipi || "",
    dogru_cevap: d.dogru_cevap || d.dogruCevap || "",
  };
}

/**
 * Appwrite listDocuments + Query; indeks / izin hatasında istemci tarafı süzgece düşer.
 * @returns {{ questions: Array, totalMatched: number, requested: number }}
 */
export async function listSoruHavuzuFiltered(coachKey, opts) {
  opts = opts || {};
  var exam = String(opts.exam || "").trim();
  var ders = String(opts.ders || "").trim();
  var konu = String(opts.konu || "").trim();
  var zorluk = String(opts.zorluk || "").trim();
  var want = Math.max(1, Math.min(80, parseInt(opts.limit, 10) || 40));
  var excludeIdsRaw = Array.isArray(opts.excludeIds) ? opts.excludeIds : [];
  var excludeSet = Object.create(null);
  excludeIdsRaw.forEach(function (x) {
    var id = x == null ? "" : String(x);
    if (id.trim()) excludeSet[id.trim()] = true;
  });
  var useKarma = zorluk === "Karma";

  if (!coachKeyUsable(coachKey)) {
    return { questions: [], totalMatched: 0, requested: want };
  }

  function buildQueries(includeCoach) {
    var q = [Query.orderDesc("$createdAt")];
    if (includeCoach) q.unshift(Query.equal("coach_id", coachKey));
    if (ders) q.push(Query.equal("ders", ders));
    if (konu) q.push(Query.equal("konu", konu));
    if (zorluk && !useKarma) q.push(Query.equal("zorluk", zorluk));
    // Appwrite tarafında (mümkünse) dışla; olmazsa aşağıdaki client-side filtre devreye girer.
    Object.keys(excludeSet).forEach(function (id) {
      q.push(Query.notEqual("$id", id));
    });
    return q;
  }

  var fetchLimit = useKarma ? Math.min(100, Math.max(want * 2, 40)) : want;
  var queries = buildQueries(true);
  queries.push(Query.limit(fetchLimit));

  var docs = [];
  try {
    var res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, queries);
    docs = (res && res.documents) || [];
  } catch (err) {
    if (!isCoachIdUnavailableError(err)) {
      console.warn("[soru_havuzu] listDocuments:", err);
    }
    try {
      var q2 = buildQueries(false);
      q2.push(Query.limit(Math.min(200, fetchLimit * 3)));
      var res2 = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, q2);
      docs = ((res2 && res2.documents) || []).filter(function (row) {
        return poolDocMatchesCoach(row, coachKey);
      });
      shuffleInPlace(docs);
      docs = docs.slice(0, fetchLimit);
    } catch (err2) {
      console.warn("[soru_havuzu] listDocuments (fallback istemci süzgeci):", err2);
      var all = await fetchSoruHavuzuForCoach(coachKey);
      docs = (all || []).filter(function (row) {
        if (ders && String(row.ders || "") !== ders) return false;
        if (konu && String(row.konu || "") !== konu) return false;
        if (exam && !rowMatchesExamFilter(row, exam)) return false;
        if (zorluk && !useKarma && String(row.zorluk || "") !== zorluk) return false;
        return true;
      });
      shuffleInPlace(docs);
      docs = docs.slice(0, fetchLimit);
    }
  }

  if (exam) {
    docs = (docs || []).filter(function (row) {
      return rowMatchesExamFilter(row, exam);
    });
  }

  if (useKarma && docs.length) {
    shuffleInPlace(docs);
  }

  var normalized = [];
  var seen = Object.create(null);
  for (var i = 0; i < docs.length; i++) {
    var n = normalizeSoruPoolDocForAi(docs[i]);
    if (!n) continue;
    var key = n && n.id != null ? String(n.id) : "";
    if (key && excludeSet[key]) continue;
    if (key && seen[key]) continue;
    if (key) seen[key] = true;
    normalized.push(n);
  }

  if (useKarma && normalized.length > want) {
    normalized = normalized.slice(0, want);
  } else if (!useKarma && normalized.length > want) {
    normalized = normalized.slice(0, want);
  }

  return {
    questions: normalized,
    totalMatched: normalized.length,
    requested: want,
  };
}

async function listAllCoachDocumentsPaged(queries) {
  var out = [];
  var cursor = null;
  for (;;) {
    var q = queries.slice();
    if (cursor) q.push(Query.cursorAfter(cursor));
    var res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, q);
    var batch = (res && res.documents) || [];
    for (var i = 0; i < batch.length; i++) {
      var m = mapAppwriteDoc(batch[i]);
      if (m) out.push(m);
    }
    if (batch.length < PAGE_SIZE) break;
    cursor = batch[batch.length - 1].$id;
  }
  return out;
}

async function listAllCoachDocuments(coachKey) {
  if (!coachKeyUsable(coachKey)) return [];
  var queries = [
    Query.equal("coach_id", coachKey),
    Query.orderDesc("$createdAt"),
    Query.limit(PAGE_SIZE),
  ];
  try {
    return await listAllCoachDocumentsPaged(queries);
  } catch (error) {
    if (!isCoachIdUnavailableError(error)) {
      console.error("VERI CEKME HATASI:", error);
      throw error;
    }
    var loose = [Query.orderDesc("$createdAt"), Query.limit(PAGE_SIZE)];
    var all = await listAllCoachDocumentsPaged(loose);
    return all.filter(function (row) {
      return poolDocMatchesCoach(row, coachKey);
    });
  }
}

/** Appwrite Storage görünüm URL’sinden dosya kimliği (silme için). */
export function storageFileIdFromImageUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (url.indexOf("/storage/buckets/") === -1) return "";
  var m = url.match(/\/files\/([^/?]+)\/(?:view|preview|download)(?:\?|$)/);
  return m ? m[1] : "";
}

/**
 * PDF / yerleştirme için yüksek çözünürlüklü önizleme URL’si (Storage köprüsü: soru_resim_id).
 */
export function getPoolQuestionPreviewUrl(fileId) {
  var fid = String(fileId || "").trim();
  if (!fid) return "";
  try {
    if (typeof storage.getFilePreview === "function") {
      var u = storage.getFilePreview(BUCKET_ID, fid, 2000, 2000);
      if (u) return String(u).trim();
    }
  } catch (e) {
    console.warn("[soru_havuzu] getFilePreview:", fid, e);
  }
  try {
    return String(storage.getFileView(BUCKET_ID, fid) || "").trim();
  } catch (e2) {
    return "";
  }
}

/**
 * Dökümandan görsel URL: `soru_resim_id` → getFilePreview; yoksa `image_url`.
 */
export function resolvePoolPreviewUrlFromDoc(doc) {
  if (!doc) return "";
  var fid = String((doc.soru_resim_id || doc.storage_file_id || doc.storageFileId || "") || "").trim();
  if (fid) {
    var prev = getPoolQuestionPreviewUrl(fid);
    if (prev) return prev;
  }
  return String((doc.image_url || doc.imageUrl || "") || "").trim();
}

/**
 * PDF şablonu için filtreli havuz listesi (gerçek veri; mock değil).
 */
export async function listSoruDocumentsForPdf(coachKey, filters) {
  filters = filters || {};
  if (!coachKeyUsable(coachKey)) return [];
  var ders = String(filters.ders || "").trim();
  var konu = String(filters.konu || "").trim();
  var zorluk = String(filters.zorluk || "").trim();
  var sinav = String(filters.sinav || "").trim();
  function build(withCoach) {
    var queries = [Query.orderDesc("$createdAt")];
    if (withCoach) queries.unshift(Query.equal("coach_id", coachKey));
    if (ders) queries.push(Query.equal("ders", ders));
    if (konu) queries.push(Query.equal("konu", konu));
    if (zorluk && zorluk !== "Tümü") queries.push(Query.equal("zorluk", zorluk));
    queries.push(Query.limit(100));
    return queries;
  }
  try {
    var res = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, build(true));
    var rowsOut = (res && res.documents) || [];
    if (sinav) {
      rowsOut = rowsOut.filter(function (row) {
        return rowMatchesExamFilter(row, sinav);
      });
    }
    return rowsOut;
  } catch (e) {
    if (!isCoachIdUnavailableError(e)) throw e;
    var res2 = await databases.listDocuments(DATABASE_ID, COLLECTION_ID, build(false));
    var rows = (res2 && res2.documents) || [];
    return rows.filter(function (row) {
      if (!poolDocMatchesCoach(row, coachKey)) return false;
      if (sinav && !rowMatchesExamFilter(row, sinav)) return false;
      return true;
    });
  }
}

/**
 * Appwrite `createDocument` yalnızca şemadaki alanlar: ders, konu, zorluk, dogru_cevap, soru_resim_id, coach_id.
 * COLLECTION_ID → appwrite-config `APPWRITE_COLLECTION_SORULAR` (`soru_havuzu`).
 *
 * @param {object} p
 * @param {string} p.coachKey
 * @param {Blob} [p.imageBlob]
 * @param {string} [p.externalImageUrl] — önce Storage’a yüklenir, `soru_resim_id` yazılır
 * @param {string} p.ders
 * @param {string} p.konu
 * @param {string} p.zorluk
 */
export async function saveSoruHavuzuEntry(p) {
  var coachKey = (p && p.coachKey) || getPoolCoachKey();
  if (!coachKeyUsable(coachKey)) throw new Error("Koç oturumu yok. Koç panelinden giriş yapın veya currentUser ayarlı değil.");
  var blob = p && p.imageBlob;
  var externalUrl = String((p && p.externalImageUrl) || "").trim();
  var uploadedFileId = "";

  if (blob) {
    var fn = (p && p.fileName) || (blob && blob.name) || "";
    var guess = guessImageExtAndMime(blob, fn);
    var fileId = ID.unique();
    var file = new File([blob], "soru_" + fileId + "." + guess.ext, { type: guess.mime });
    await storage.createFile(BUCKET_ID, fileId, file);
    uploadedFileId = fileId;
  } else if (externalUrl) {
    try {
      var res = await fetch(externalUrl, { mode: "cors" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      var b = await res.blob();
      var guess = guessImageExtAndMime(b, "harici.png");
      var fileIdEx = ID.unique();
      var fileEx = new File([b], "soru_" + fileIdEx + "." + guess.ext, { type: guess.mime });
      await storage.createFile(BUCKET_ID, fileIdEx, fileEx);
      uploadedFileId = fileIdEx;
    } catch (fe) {
      console.warn("[soru_havuzu] Harici görsel depoya alınamadı:", fe);
      throw new Error("Görsel indirilemedi veya depoya yüklenemedi (CORS / ağ).");
    }
  }

  if (!uploadedFileId) throw new Error("Görsel yüklenemedi (Storage fileId → soru_resim_id gerekli).");

  var docId = ID.unique();

  var payload = {
    ders: String((p && p.ders) || ""),
    konu: String((p && p.konu) || ""),
    zorluk: String((p && p.zorluk) || ""),
    soru_resim_id: uploadedFileId,
    dogru_cevap: "",
  };
  var dc = String((p && p.dogruCevap) || (p && p.dogru_cevap) || "")
    .trim()
    .toUpperCase();
  if (dc && /^[ABCDE]$/.test(dc)) {
    payload.dogru_cevap = dc;
  }
  if (coachKeyUsable(coachKey)) {
    payload.coach_id = coachKey;
  }

  try {
    var databaseId = DATABASE_ID;
    var collectionId = COLLECTION_ID;
    var data = payload;
    console.log("--- APPWRITE DEBUG ---");
    console.log("Hedef Database ID:", databaseId);
    console.log("Hedef Collection ID:", collectionId);
    console.log("Gönderilen Veri Yapısı:", data);
    console.log("-----------------------");
    await databases.createDocument(DATABASE_ID, COLLECTION_ID, docId, payload);
  } catch (err) {
    if (payload.coach_id && isCoachIdUnavailableError(err)) {
      try {
        var payload2 = {
          ders: payload.ders,
          konu: payload.konu,
          zorluk: payload.zorluk,
          soru_resim_id: payload.soru_resim_id,
          dogru_cevap: payload.dogru_cevap,
        };
        databaseId = DATABASE_ID;
        collectionId = COLLECTION_ID;
        data = payload2;
        console.log("--- APPWRITE DEBUG ---");
        console.log("Hedef Database ID:", databaseId);
        console.log("Hedef Collection ID:", collectionId);
        console.log("Gönderilen Veri Yapısı:", data);
        console.log("-----------------------");
        await databases.createDocument(DATABASE_ID, COLLECTION_ID, docId, payload2);
        console.warn("[soru_havuzu] coach_id şemada yok; kayıt coach_id olmadan oluşturuldu.");
        return docId;
      } catch (errRetry) {
        err = errRetry;
      }
    }
    var em = err && err.message != null ? String(err.message) : String(err || "");
    var ec = err && err.code != null ? err.code : err && err.type != null ? err.type : "";
    console.error("Kayıt Başarısız. Appwrite Hatası:", em, "Hata Kodu:", ec);
    console.error("[soru_havuzu] createDocument başarısız. Gönderilen anahtarlar:", Object.keys(payload));
    console.error("[soru_havuzu] Appwrite hata detayı:", err);
    var wrap = new Error(
      uploadedFileId
        ? "Görsel depoya yüklendi ancak soru kaydı oluşturulamadı. " +
            (err && err.message ? String(err.message) : String(err))
        : "Soru kaydı oluşturulamadı: " + (err && err.message ? String(err.message) : String(err))
    );
    wrap.name = "SoruHavuzuDocumentError";
    wrap.storageUploaded = !!uploadedFileId;
    wrap.documentCreateFailed = true;
    wrap.appwriteError = err;
    wrap.payloadKeys = Object.keys(payload);
    throw wrap;
  }
  return docId;
}

export async function saveManyAiQuestionsToPool(coachKey, questions, extra) {
  extra = extra || {};
  if (!coachKey || !questions || !questions.length) return 0;
  var n = 0;
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    try {
      await saveSoruHavuzuEntry({
        coachKey: coachKey,
        externalImageUrl: (q && (q.imageUrl || q.image)) || "",
        ders: (q && q.ders) || extra.ders || "",
        konu: (q && q.konu) || extra.konu || "",
        zorluk: (q && q.zorluk) || extra.zorluk || "",
      });
      n++;
    } catch (e) {
      console.warn("[soru_havuzu] AI kayıt atlandı:", e);
    }
  }
  return n;
}

export async function fetchSoruHavuzuForCoach(coachKey) {
  if (!coachKeyUsable(coachKey)) return [];
  return listAllCoachDocuments(coachKey);
}

async function deleteStorageIfLinked(imageUrl, explicitFileId) {
  var fid = (explicitFileId && String(explicitFileId).trim()) || storageFileIdFromImageUrl(imageUrl || "");
  if (!fid) return;
  try {
    await storage.deleteFile(BUCKET_ID, fid);
  } catch (e) {
    console.warn("[soru_havuzu] Storage dosyası silinemedi:", fid, e);
  }
}

export async function deleteSoruHavuzuDoc(docId) {
  var img = "";
  var explicit = "";
  try {
    var doc = await databases.getDocument(DATABASE_ID, COLLECTION_ID, docId);
    img = (doc && (doc.imageUrl || doc.image_url)) || "";
    explicit = (doc && (doc.soru_resim_id || doc.storage_file_id || doc.storageFileId)) || "";
  } catch (e) {
    console.warn("[soru_havuzu] doküman okunamadı (yine de silme denenir):", e);
  }
  await deleteStorageIfLinked(img, explicit);
  try {
    await databases.deleteDocument(DATABASE_ID, COLLECTION_ID, docId);
  } catch (e) {
    console.error("[soru_havuzu] deleteDocument:", docId, e);
    throw e;
  }
}

export async function setSoruHavuzuCozuldu(docId, cozuldu) {
  try {
    await databases.updateDocument(DATABASE_ID, COLLECTION_ID, docId, { cozuldu: !!cozuldu });
  } catch (e) {
    console.error("[soru_havuzu] cozuldu güncellenemedi:", docId, e);
    throw e;
  }
}
