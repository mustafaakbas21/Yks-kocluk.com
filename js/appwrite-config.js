import { Client, Databases, Storage } from "./appwrite-browser.js?v=20260408-inst";

/** Tüm veritabanı koleksiyonları ve sütunlar: kökte `setup-appwrite.js` (genişletilmiş şema + isteğe `--seed`). */

export const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
export const APPWRITE_PROJECT_ID = "69c12f05001b051b2f14";
export const APPWRITE_DATABASE_ID = "derece_panel";
export const APPWRITE_COLLECTION_SORU_HAVUZU = "soru_havuzu";
/** Havuz soruları tablosu (şu an `soru_havuzu` ile aynı; koleksiyon adı değişirse burayı güncelleyin) */
export const APPWRITE_COLLECTION_SORULAR = APPWRITE_COLLECTION_SORU_HAVUZU;
export const APPWRITE_BUCKET_SORU_HAVUZU = "soru_havuzu";
/** Destek / sorun bildirimi ekran görüntüleri (Appwrite Console’da bucket oluşturun; izin: dosya oluşturma) */
export const APPWRITE_BUCKET_DESTEK = "destek_ekranlari";
/** `derece_panel` içinde koleksiyon: alanlar js/sorun-bildir.js içindeki createDocument ile uyumlu olmalı */
export const APPWRITE_COLLECTION_HATA_BILDIRIMLERI = "hata_bildirimleri";
/**
 * Öğrenciye atanan kütüphane kaynakları (Appwrite — düz koleksiyon).
 * Firestore tarzı `students/{id}/atananKaynaklar` yolu `collectionId` limitini aşar; bu yüzden tek tablo + student_id kullanılır.
 * Console’da koleksiyon oluşturun: student_id, coach_id, libraryId, title, subject, totalPages, publisher,
 * topics_json (string, büyük), correctTotal, wrongTotal, assignedAt (datetime) vb.
 */
export const APPWRITE_COLLECTION_ATANAN_KAYNAKLAR = "atanan_kaynaklar";
/**
 * Yetkili dizini kayıtları `users` koleksiyonunda tutulur (ayrı `admins` tablosu gerekmez).
 * Şema (koç/öğrenci ile aynı koleksiyon): role = bu sabit; fullName; username; institutionName (iletişim e-postası);
 * packageType = Admin_Tam | Admin_Orta | Admin_Salt; plainPassword, frozen, createdAt (super-admin.js).
 */
export const APPWRITE_ADMIN_ROSTER_ROLE = "admin_roster";
/**
 * Vitrin teklif talepleri — Appwrite Console’daki koleksiyon kimliği ile birebir aynı olmalı.
 * Koleksiyon otomatik ID ile oluşturulduysa (ör. 64 karakterlik hex değil, kısa ID) burayı Console’daki ID ile güncelleyin.
 */
export const APPWRITE_COLLECTION_QUOTE_REQUESTS = "quoteRequests";
/** DenemeDeposu — PDF / cevap anahtarı (create okuma; Console’da bucket ID aynı olmalı) */
export const APPWRITE_BUCKET_DENEME_DEPOSU = "deneme_deposu";
/**
 * HD avatar paketi + koç yükleme dosyaları.
 * Tek kovalı planda paket `soru_havuzu` ile paylaşılabilir (`npm run upload:avatars`);
 * ayrı `avatarlar` kovası açıldığında bu sabiti Console ID ile güncelleyin.
 */
export const APPWRITE_BUCKET_AVATARLAR = "soru_havuzu";
/**
 * Global deneme takvimi — Appwrite Console’da `derece_panel` içinde bu ID ile koleksiyon oluşturulmalıdır.
 * Yoksa «Planı kaydet» ve liste istekleri 404 verir.
 *
 * Önerilen attribute’lar (Console → Create attribute):
 * - adi (string, 500), yayinevi (string, 300), sinavTuru (string, 8), tarihSaat (datetime),
 * - sonucTarihi (datetime, opsiyonel), pdfId (string, opsiyonel), cevapAnahtariId (string, opsiyonel).
 * İzinler: oturumlu kullanıcıya okuma/yazma (koç paneli ile uyumlu).
 */
export const APPWRITE_COLLECTION_GLOBAL_DENEMELER = "global_denemeler";
/** Eski Net Sihirbazı hedef satırları (isteğe bağlı) */
export const APPWRITE_COLLECTION_YKS_NET_TARGETS = "yks_net_sihirbazi_targets";
/**
 * YKS Puan Hesaplama — koç kayıtlı hesaplama + not (koç paneli).
 * Console’da `yks_puan_notes` koleksiyonu: coach_id, title, coach_note, tyt_ham, ayt_ham, yer_toplam, alan_label, created_at (string ISO).
 */
export const APPWRITE_COLLECTION_YKS_PUAN_NOTES = "yks_puan_notes";
/** Geriye dönük uyumluluk — Net Sihirbazı / hedef seçici artık `src/data/yks-data.json` kullanır */
export const APPWRITE_COLLECTION_UNIVERSITIES = "Universities";
export const APPWRITE_COLLECTION_PROGRAMS = "Programs";
/** Deneme Analizi — `setup-appwrite.js` ile oluşturulan koleksiyonlar */
export const APPWRITE_COLLECTION_LESSONS = "Lessons";
export const APPWRITE_COLLECTION_TOPICS = "Topics";
export const APPWRITE_COLLECTION_EXAMS = "Exams";
/**
 * Akıllı Optik V2 / Karne V2 — deneme sonucu kaydı (`setup-appwrite.js`: koleksiyon + indeksler).
 * Create payload örneği: `_YEDEKLER_VE_COPLER/_eski_kodlar_arsivi/js/exam-results-appwrite.js` → `buildExamResultCreatePayload` (Akıllı Optik modülü arşivlendi).
 * Karne trend etiketleri: `exam_name`, `saved_at` (Exams zorunlu değil).
 */
export const APPWRITE_COLLECTION_EXAM_RESULTS = "ExamResults";
/** MR (Emar) — Konu/Soru ilerleme (öğrenci başına tek belge, JSON alanları) */
export const APPWRITE_COLLECTION_MR_PROFILES = "mr_student_profiles";
/** Koç paneli öğrenci listesi — `coach_id` ile Appwrite sorgusu (`koc-panel.js` → coachQuery) */
export const APPWRITE_COLLECTION_STUDENTS = "students";
/** Görüşme Odası — koç notları (Quill HTML); setup-appwrite.js ile oluşturulmalı */
export const APPWRITE_COLLECTION_MEETING_LOGS = "meeting_logs";
/** DereceBoard — Ders Anlatımı tuval sayfaları (Fabric JSON + küçük resim özetleri); Console’da `boards` koleksiyonu + şema */
export const APPWRITE_COLLECTION_BOARDS = "boards";
/** Koç → öğrenci tahta paylaşımı (board_id + çoklu student_ids) */
export const APPWRITE_COLLECTION_SHARED_BOARDS = "SharedBoards";
/**
 * Koç ↔ öğrenci metin mesajları (Gelen Sorular / canlı sohbet).
 * Şema: sender_id (string), receiver_id (string), text (Text — uzun mesaj), timestamp (datetime),
 * read_at (datetime, opsiyonel — koç okundu işareti / okunmamış rozet).
 * Kurulum: `node setup-appwrite.js` veya `node appwrite-setup.js` — veya setup-appwrite.js dosya başındaki Console adımları.
 */
export const APPWRITE_COLLECTION_MESSAGES = "messages";
/** Oturum profili — `login.js` / koç kapısı ile uyumlu (Appwrite Console ID’leri) */
export const APPWRITE_COLLECTION_USERS = "users";
export const APPWRITE_COLLECTION_COACHES = "coaches";
/** Kurumsal çok kiracılı yapı — koç/öğrenci institutionId ile bağlanır */
export const APPWRITE_COLLECTION_INSTITUTIONS = "institutions";

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);
const storage = new Storage(client);

export { client, databases, storage };

/**
 * Appwrite Realtime — tüm veritabanı belgeleri (`*.create` / `*.update` / `*.delete`).
 * @see https://appwrite.io/docs/apis/realtime
 */
export const APPWRITE_REALTIME_DB_DOCUMENTS_CHANNEL =
  "databases." + APPWRITE_DATABASE_ID + ".collections.*.documents";

/**
 * @param {(response: { events?: string[], payload?: object }) => void} handler
 * @param {string[] | undefined} fallbackCollectionIds — wildcard desteklenmezse koleksiyon başına abonelik
 * @returns {() => void}
 */
export function subscribeAppwriteDatabaseDocuments(handler, fallbackCollectionIds) {
  /** @type {(() => void)[]} */
  const unsubs = [];

  /**
   * @returns {"sync"|"async"|false}
   */
  function attachChannel(channel) {
    try {
      if (typeof client.subscribe !== "function") {
        console.warn("[Appwrite Realtime] client.subscribe yok; CDN SDK sürümünü kontrol edin.");
        return false;
      }
      /** @type {unknown} */
      let ret;
      try {
        ret = client.subscribe(channel, handler);
      } catch (_e0) {
        ret = client.subscribe([channel], handler);
      }
      if (ret != null && typeof ret.then === "function") {
        ret
          .then(function (u) {
            if (typeof u === "function") unsubs.push(u);
          })
          .catch(function () {});
        return "async";
      }
      if (typeof ret === "function") {
        unsubs.push(ret);
        return "sync";
      }
    } catch (e) {
      console.warn("[Appwrite Realtime] Kanal açılamadı:", channel, e && e.message ? e.message : e);
    }
    return false;
  }

  var wild = attachChannel(APPWRITE_REALTIME_DB_DOCUMENTS_CHANNEL);
  if (wild !== "sync" && wild !== "async" && Array.isArray(fallbackCollectionIds) && fallbackCollectionIds.length) {
    fallbackCollectionIds.forEach(function (cid) {
      var ch = "databases." + APPWRITE_DATABASE_ID + ".collections." + String(cid) + ".documents";
      attachChannel(ch);
    });
  }

  return function unsubscribeAppwriteDatabaseDocuments() {
    unsubs.forEach(function (fn) {
      try {
        fn();
      } catch (_e) {}
    });
    unsubs.length = 0;
  };
}

export function pingAppwriteBackend() {
  return client.ping();
}

(function runAppwritePingIfLocalhost() {
  try {
    if (typeof globalThis.location === "undefined" || !globalThis.location.hostname) return;
    var h = String(globalThis.location.hostname || "");
    if (h !== "localhost" && h !== "127.0.0.1") return;
  } catch (_e) {
    return;
  }
  pingAppwriteBackend()
    .then(function () {
      console.info("[Appwrite] Ping OK — " + APPWRITE_PROJECT_ID + ".");
    })
    .catch(function (err) {
      console.warn("[Appwrite] Ping başarısız:", err);
    });
})();
