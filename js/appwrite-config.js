import { Client, Databases, Storage } from "./appwrite-browser.js";

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
/** Koç / kullanıcı avatarları — Console’da bucket oluşturun (ör. `avatarlar`); oturum açık kullanıcıya dosya oluşturma izni verin. */
export const APPWRITE_BUCKET_AVATARLAR = "avatarlar";
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
/** Eski Net Sihirbazı hedef satırları (isteğe bağlı; arayüz artık Programs.rowsJson kullanır) */
export const APPWRITE_COLLECTION_YKS_NET_TARGETS = "yks_net_sihirbazi_targets";
/** Üniversite kataloğu (`seed-2026-yok-atlas.js`, import scriptleri) */
export const APPWRITE_COLLECTION_UNIVERSITIES = "Universities";
/** Net Sihirbazı V2 — bölümler (`uniId` → Universities.$id) */
export const APPWRITE_COLLECTION_PROGRAMS = "Programs";
/** Deneme Analizi — `setup-appwrite.js` ile oluşturulan koleksiyonlar */
export const APPWRITE_COLLECTION_LESSONS = "Lessons";
export const APPWRITE_COLLECTION_TOPICS = "Topics";
export const APPWRITE_COLLECTION_EXAMS = "Exams";
/**
 * Akıllı Optik V2 / Karne V2 — deneme sonucu kaydı (`setup-appwrite.js`: koleksiyon + indeksler).
 * Create payload: `js/exam-results-appwrite.js` → `buildExamResultCreatePayload`.
 * Karne trend etiketleri: `exam_name`, `saved_at` (Exams zorunlu değil).
 */
export const APPWRITE_COLLECTION_EXAM_RESULTS = "ExamResults";

const client = new Client()
  .setEndpoint(APPWRITE_ENDPOINT)
  .setProject(APPWRITE_PROJECT_ID);

const databases = new Databases(client);
const storage = new Storage(client);

export { client, databases, storage };

export function pingAppwriteBackend() {
  return client.ping();
}

pingAppwriteBackend()
  .then(function () {
    console.info("[Appwrite] Ping OK — " + APPWRITE_PROJECT_ID + ".");
  })
  .catch(function (err) {
    console.warn("[Appwrite] Ping başarısız:", err);
  });
