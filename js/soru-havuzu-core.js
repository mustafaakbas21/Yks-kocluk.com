/**
 * Soru havuzu — Firestore `soru_havuzu` + Storage görsel yolu (koç kullanıcı adı = coach_id).
 */
import { db, storage, auth } from "./firebase-config.js";
import { ref, uploadBytes, getDownloadURL } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import {
  collection,
  addDoc,
  serverTimestamp,
  query,
  where,
  getDocs,
  deleteDoc,
  doc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

export function getPoolCoachKey() {
  try {
    var imp = sessionStorage.getItem("superAdminViewAsCoach");
    if (imp && String(imp).trim()) return String(imp).trim();
  } catch (e) {}
  return (localStorage.getItem("currentUser") || "").trim();
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

/** Boş MIME (bazı tarayıcılar) için dosya adından; Storage contentType ile uyumlu uzantı */
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

/**
 * @param {object} p
 * @param {string} p.coachKey
 * @param {Blob} [p.imageBlob]
 * @param {string} [p.externalImageUrl] — harici URL (ör. AI mock)
 * @param {string} p.ders
 * @param {string} p.konu
 * @param {string} p.zorluk
 * @param {string} [p.sinavTipi]
 * @param {string} p.source — pdf_crop | manual | ai
 */
export async function saveSoruHavuzuEntry(p) {
  var coachKey = (p && p.coachKey) || "";
  if (!coachKey) throw new Error("Koç oturumu yok (coach_id).");
  var imageUrl = String((p && p.externalImageUrl) || "").trim();
  var blob = p && p.imageBlob;
  if (!imageUrl && blob) {
    var uid = auth.currentUser && auth.currentUser.uid;
    if (!uid) throw new Error("Oturum yok — önce giriş yapın (Storage).");
    var fn = (p && p.fileName) || (blob && blob.name) || "";
    var guess = guessImageExtAndMime(blob, fn);
    var ext = guess.ext;
    var mime = guess.mime;
    /** Storage kuralları çoğunlukla path'te auth.uid ister; coach_id Firestore'da kullanıcı adı olarak kalır */
    var path =
      "soru_havuzu/" +
      uid +
      "/" +
      Date.now() +
      "_" +
      Math.random().toString(36).slice(2, 10) +
      "." +
      ext;
    var r = ref(storage, path);
    await uploadBytes(r, blob, { contentType: mime });
    imageUrl = await getDownloadURL(r);
  }
  if (!imageUrl) throw new Error("Görsel yüklenemedi.");
  var refDoc = await addDoc(collection(db, "soru_havuzu"), {
    coach_id: coachKey,
    imageUrl,
    ders: String((p && p.ders) || ""),
    konu: String((p && p.konu) || ""),
    zorluk: String((p && p.zorluk) || ""),
    sinavTipi: String((p && p.sinavTipi) || ""),
    source: String((p && p.source) || "manual"),
    cozuldu: false,
    createdAt: serverTimestamp(),
  });
  return refDoc.id;
}

export async function saveManyAiQuestionsToPool(coachKey, questions, extra) {
  extra = extra || {};
  if (!coachKey || !questions || !questions.length) return 0;
  var n = 0;
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    try {
      await saveSoruHavuzuEntry({
        coachKey,
        externalImageUrl: (q && (q.imageUrl || q.image)) || "",
        ders: (q && q.ders) || extra.ders || "",
        konu: (q && q.konu) || extra.konu || "",
        zorluk: (q && q.zorluk) || extra.zorluk || "",
        sinavTipi: extra.sinavTipi || "",
        source: "ai",
      });
      n++;
    } catch (e) {
      console.warn("[soru_havuzu] AI kayıt atlandı:", e);
    }
  }
  return n;
}

export async function fetchSoruHavuzuForCoach(coachKey) {
  if (!coachKey) return [];
  var qy = query(collection(db, "soru_havuzu"), where("coach_id", "==", coachKey));
  var snap = await getDocs(qy);
  var out = [];
  snap.forEach(function (d) {
    var x = d.data();
    out.push(
      Object.assign({}, x, {
        id: d.id,
        firestoreId: d.id,
      })
    );
  });
  out.sort(function (a, b) {
    var ta = a.createdAt && typeof a.createdAt.toMillis === "function" ? a.createdAt.toMillis() : 0;
    var tb = b.createdAt && typeof b.createdAt.toMillis === "function" ? b.createdAt.toMillis() : 0;
    return tb - ta;
  });
  return out;
}

export async function deleteSoruHavuzuDoc(docId) {
  await deleteDoc(doc(db, "soru_havuzu", docId));
}

export async function setSoruHavuzuCozuldu(docId, cozuldu) {
  await updateDoc(doc(db, "soru_havuzu", docId), { cozuldu: !!cozuldu });
}
