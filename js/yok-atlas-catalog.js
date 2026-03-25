/**
 * Geniş YÖK Atlas simülasyon kataloğu: tüm üniversite listesi × bölüm şablonları.
 * Her (üniversite, şablon) çifti için deterministik taban puanı ve hedef netler üretilir.
 */
import { TR_UNIVERSITIES } from "./tr-universities-seed.js";
import { getPrestigeBonus2025 } from "./yok-atlas-prestige.js";
import { dedupeNamedRecordsByDisplayName } from "./hedef-atlas-helpers.js";

function hashStr(s) {
  var h = 0;
  var str = String(s || "");
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** TYT + sayısal AYT (4+4) */
export function rowsFromTyAyt(tyt, ayt) {
  return [
    { section: "TYT", name: "Türkçe", targetNet: tyt.Turkce },
    { section: "TYT", name: "Sosyal Bilimler", targetNet: tyt.Sosyal },
    { section: "TYT", name: "Temel Matematik", targetNet: tyt.Matematik },
    { section: "TYT", name: "Fen Bilimleri", targetNet: tyt.Fen },
    { section: "AYT", name: "Matematik", targetNet: ayt.Matematik },
    { section: "AYT", name: "Fizik", targetNet: ayt.Fizik },
    { section: "AYT", name: "Kimya", targetNet: ayt.Kimya },
    { section: "AYT", name: "Biyoloji", targetNet: ayt.Biyoloji },
  ];
}

/**
 * Bölüm şablonları — Türkiye’deki yaygın program türleri (isim + hedef net profili).
 * @type {Array<{ id: string, name: string, baseBoost?: number, rows: Array<{ section: string, name: string, targetNet: number }> }>}
 */
export const PROGRAM_TEMPLATES = [
  {
    id: "tip",
    name: "Tıp Fakültesi",
    baseBoost: 155,
    rows: rowsFromTyAyt(
      { Turkce: 39, Matematik: 38, Sosyal: 19, Fen: 35 },
      { Matematik: 36, Fizik: 13, Kimya: 13, Biyoloji: 14 }
    ),
  },
  {
    id: "dis",
    name: "Diş Hekimliği Fakültesi",
    baseBoost: 148,
    rows: rowsFromTyAyt(
      { Turkce: 38, Matematik: 38, Sosyal: 18, Fen: 34 },
      { Matematik: 37, Fizik: 12.5, Kimya: 12.5, Biyoloji: 13.5 }
    ),
  },
  {
    id: "eczane",
    name: "Eczacılık Fakültesi",
    baseBoost: 130,
    rows: rowsFromTyAyt(
      { Turkce: 38, Matematik: 37, Sosyal: 18, Fen: 33 },
      { Matematik: 36, Fizik: 12, Kimya: 13, Biyoloji: 13 }
    ),
  },
  {
    id: "vet",
    name: "Veteriner Fakültesi",
    baseBoost: 125,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 36, Sosyal: 17, Fen: 32 },
      { Matematik: 35, Fizik: 12, Kimya: 12, Biyoloji: 13 }
    ),
  },
  {
    id: "bilgisayar",
    name: "Bilgisayar Mühendisliği",
    baseBoost: 155,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 38, Sosyal: 17, Fen: 31 },
      { Matematik: 39, Fizik: 12.5, Kimya: 12, Biyoloji: 11.5 }
    ),
  },
  {
    id: "yapay_zeka",
    name: "Yapay Zeka ve Veri Mühendisliği",
    baseBoost: 150,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 39, Sosyal: 17, Fen: 31 },
      { Matematik: 40, Fizik: 12, Kimya: 11.5, Biyoloji: 11 }
    ),
  },
  {
    id: "elektrik",
    name: "Elektrik-Elektronik Mühendisliği",
    baseBoost: 148,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 38, Sosyal: 17, Fen: 30 },
      { Matematik: 39, Fizik: 12, Kimya: 11.5, Biyoloji: 11 }
    ),
  },
  {
    id: "makine",
    name: "Makine Mühendisliği",
    baseBoost: 105,
    rows: rowsFromTyAyt(
      { Turkce: 35, Matematik: 37, Sosyal: 16, Fen: 29 },
      { Matematik: 37, Fizik: 11, Kimya: 11, Biyoloji: 10.5 }
    ),
  },
  {
    id: "endustri",
    name: "Endüstri Mühendisliği",
    baseBoost: 115,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 36, Sosyal: 16, Fen: 28 },
      { Matematik: 36, Fizik: 10.5, Kimya: 10.5, Biyoloji: 10 }
    ),
  },
  {
    id: "insaat",
    name: "İnşaat Mühendisliği",
    baseBoost: 95,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 35, Sosyal: 16, Fen: 27 },
      { Matematik: 35, Fizik: 10, Kimya: 10, Biyoloji: 9.5 }
    ),
  },
  {
    id: "kimya_muhendislik",
    name: "Kimya Mühendisliği",
    baseBoost: 100,
    rows: rowsFromTyAyt(
      { Turkce: 35, Matematik: 37, Sosyal: 16, Fen: 30 },
      { Matematik: 37, Fizik: 11, Kimya: 12, Biyoloji: 10 }
    ),
  },
  {
    id: "metalurji",
    name: "Metalurji ve Malzeme Mühendisliği",
    baseBoost: 88,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 36, Sosyal: 16, Fen: 28 },
      { Matematik: 36, Fizik: 11, Kimya: 11, Biyoloji: 10 }
    ),
  },
  {
    id: "jeoloji",
    name: "Jeoloji Mühendisliği",
    baseBoost: 82,
    rows: rowsFromTyAyt(
      { Turkce: 33, Matematik: 34, Sosyal: 16, Fen: 27 },
      { Matematik: 34, Fizik: 10, Kimya: 10, Biyoloji: 10 }
    ),
  },
  {
    id: "jeofizik",
    name: "Jeofizik Mühendisliği",
    baseBoost: 80,
    rows: rowsFromTyAyt(
      { Turkce: 33, Matematik: 35, Sosyal: 16, Fen: 28 },
      { Matematik: 35, Fizik: 11, Kimya: 10, Biyoloji: 9.5 }
    ),
  },
  {
    id: "petrol",
    name: "Petrol ve Doğal Gaz Mühendisliği",
    baseBoost: 92,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 36, Sosyal: 16, Fen: 29 },
      { Matematik: 36, Fizik: 11, Kimya: 11, Biyoloji: 10 }
    ),
  },
  {
    id: "havacilik",
    name: "Uçak ve Uzay Bilimleri / Havacılık",
    baseBoost: 135,
    rows: rowsFromTyAyt(
      { Turkce: 36, Matematik: 38, Sosyal: 17, Fen: 31 },
      { Matematik: 38, Fizik: 12.5, Kimya: 11, Biyoloji: 10.5 }
    ),
  },
  {
    id: "mimarlik",
    name: "Mimarlık",
    baseBoost: 75,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 36, Sosyal: 17, Fen: 28 },
      { Matematik: 35, Fizik: 10, Kimya: 10, Biyoloji: 10 }
    ),
  },
  {
    id: "sehir_planlama",
    name: "Şehir ve Bölge Planlama",
    baseBoost: 65,
    rows: rowsFromTyAyt(
      { Turkce: 35, Matematik: 32, Sosyal: 18, Fen: 25 },
      { Matematik: 31, Fizik: 9, Kimya: 9, Biyoloji: 9 }
    ),
  },
  {
    id: "endustri_muh_isletme",
    name: "İşletme Mühendisliği",
    baseBoost: 25,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 36 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 17 },
      { section: "TYT", name: "Temel Matematik", targetNet: 35 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 32 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 32 },
      { section: "AYT", name: "Tarih-1", targetNet: 22 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 20 },
    ],
  },
  {
    id: "iktisat",
    name: "İktisat",
    baseBoost: 95,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 37 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 36 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 34 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 33 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 21 },
    ],
  },
  {
    id: "isletme",
    name: "İşletme",
    baseBoost: 88,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 36 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 35 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 25 },
      { section: "AYT", name: "Matematik", targetNet: 33 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 32 },
      { section: "AYT", name: "Tarih-1", targetNet: 22 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 20 },
    ],
  },
  {
    id: "hukuk",
    name: "Hukuk Fakültesi",
    baseBoost: 60,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 33 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 24 },
      { section: "AYT", name: "Matematik", targetNet: 30 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 34 },
      { section: "AYT", name: "Tarih-1", targetNet: 24 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 21 },
    ],
  },
  {
    id: "siyaset",
    name: "Siyaset Bilimi ve Kamu Yönetimi",
    baseBoost: 45,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 37 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 32 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 23 },
      { section: "AYT", name: "Matematik", targetNet: 28 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 33 },
      { section: "AYT", name: "Tarih-1", targetNet: 24 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 22 },
    ],
  },
  {
    id: "uluslararasi_iliskiler",
    name: "Uluslararası İlişkiler",
    baseBoost: 50,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 32 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 22 },
      { section: "AYT", name: "Matematik", targetNet: 28 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 34 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 21 },
    ],
  },
  {
    id: "edebiyat_fak",
    name: "Edebiyat Fakültesi (Genel)",
    baseBoost: 35,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 30 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 22 },
      { section: "AYT", name: "Matematik", targetNet: 26 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 35 },
      { section: "AYT", name: "Tarih-1", targetNet: 24 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 22 },
    ],
  },
  {
    id: "psikoloji",
    name: "Psikoloji",
    baseBoost: 110,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 34 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 31 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 33 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 21 },
    ],
  },
  {
    id: "sosyoloji",
    name: "Sosyoloji",
    baseBoost: 40,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 37 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 30 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 22 },
      { section: "AYT", name: "Matematik", targetNet: 26 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 34 },
      { section: "AYT", name: "Tarih-1", targetNet: 24 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 22 },
    ],
  },
  {
    id: "turk_dili_ve_edebiyati",
    name: "Türk Dili ve Edebiyatı",
    baseBoost: 30,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 39 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 28 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 20 },
      { section: "AYT", name: "Matematik", targetNet: 22 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 36 },
      { section: "AYT", name: "Tarih-1", targetNet: 25 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 23 },
    ],
  },
  {
    id: "tarih",
    name: "Tarih",
    baseBoost: 28,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 37 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 28 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 20 },
      { section: "AYT", name: "Matematik", targetNet: 22 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 33 },
      { section: "AYT", name: "Tarih-1", targetNet: 27 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 23 },
    ],
  },
  {
    id: "cografya",
    name: "Coğrafya",
    baseBoost: 32,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 36 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 30 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 22 },
      { section: "AYT", name: "Matematik", targetNet: 26 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 32 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 26 },
    ],
  },
  {
    id: "felsefe",
    name: "Felsefe",
    baseBoost: 25,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 37 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 28 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 20 },
      { section: "AYT", name: "Matematik", targetNet: 22 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 33 },
      { section: "AYT", name: "Tarih-1", targetNet: 24 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 22 },
    ],
  },
  {
    id: "ilahiyat",
    name: "İlahiyat",
    baseBoost: 20,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 28 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 20 },
      { section: "AYT", name: "Matematik", targetNet: 22 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 34 },
      { section: "AYT", name: "Tarih-1", targetNet: 24 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 22 },
    ],
  },
  {
    id: "dil_edebiyat",
    name: "İngiliz Dili ve Edebiyatı",
    baseBoost: 45,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 32 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 24 },
      { section: "AYT", name: "Yabancı Dil", targetNet: 38 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 32 },
      { section: "AYT", name: "Tarih-1", targetNet: 22 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 20 },
    ],
  },
  {
    id: "mütercim",
    name: "Mütercim-Tercümanlık",
    baseBoost: 42,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 31 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 23 },
      { section: "AYT", name: "Yabancı Dil", targetNet: 39 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 31 },
      { section: "AYT", name: "Tarih-1", targetNet: 21 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 20 },
    ],
  },
  {
    id: "fen_lisans_mat",
    name: "Matematik (Fen Bilimleri)",
    baseBoost: 85,
    rows: rowsFromTyAyt(
      { Turkce: 36, Matematik: 39, Sosyal: 17, Fen: 32 },
      { Matematik: 40, Fizik: 12, Kimya: 11.5, Biyoloji: 11 }
    ),
  },
  {
    id: "fen_lisans_fizik",
    name: "Fizik (Fen Bilimleri)",
    baseBoost: 78,
    rows: rowsFromTyAyt(
      { Turkce: 35, Matematik: 38, Sosyal: 17, Fen: 33 },
      { Matematik: 38, Fizik: 13.5, Kimya: 11, Biyoloji: 10.5 }
    ),
  },
  {
    id: "fen_lisans_kimya",
    name: "Kimya (Fen Bilimleri)",
    baseBoost: 80,
    rows: rowsFromTyAyt(
      { Turkce: 35, Matematik: 37, Sosyal: 17, Fen: 33 },
      { Matematik: 37, Fizik: 11.5, Kimya: 13, Biyoloji: 11 }
    ),
  },
  {
    id: "fen_lisans_bio",
    name: "Biyoloji (Fen Bilimleri)",
    baseBoost: 82,
    rows: rowsFromTyAyt(
      { Turkce: 36, Matematik: 36, Sosyal: 17, Fen: 34 },
      { Matematik: 35, Fizik: 11, Kimya: 12, Biyoloji: 13.5 }
    ),
  },
  {
    id: "ziraat",
    name: "Ziraat Mühendisliği",
    baseBoost: 70,
    rows: rowsFromTyAyt(
      { Turkce: 33, Matematik: 34, Sosyal: 16, Fen: 28 },
      { Matematik: 33, Fizik: 10, Kimya: 10, Biyoloji: 12 }
    ),
  },
  {
    id: "orman",
    name: "Orman Mühendisliği",
    baseBoost: 62,
    rows: rowsFromTyAyt(
      { Turkce: 33, Matematik: 33, Sosyal: 17, Fen: 27 },
      { Matematik: 32, Fizik: 9.5, Kimya: 9.5, Biyoloji: 11 }
    ),
  },
  {
    id: "gida",
    name: "Gıda Mühendisliği",
    baseBoost: 72,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 35, Sosyal: 16, Fen: 29 },
      { Matematik: 35, Fizik: 10, Kimya: 12, Biyoloji: 11 }
    ),
  },
  {
    id: "cevre",
    name: "Çevre Mühendisliği",
    baseBoost: 78,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 36, Sosyal: 16, Fen: 29 },
      { Matematik: 36, Fizik: 11, Kimya: 11, Biyoloji: 10.5 }
    ),
  },
  {
    id: "bilgisayar_ogretmenligi",
    name: "Bilgisayar ve Öğretim Teknolojileri Öğretmenliği",
    baseBoost: 55,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 36, Sosyal: 18, Fen: 28 },
      { Matematik: 36, Fizik: 10, Kimya: 10, Biyoloji: 10 }
    ),
  },
  {
    id: "sinif_ogretmenligi",
    name: "Sınıf Öğretmenliği",
    baseBoost: 48,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 39 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 32 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 30 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 34 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 22 },
    ],
  },
  {
    id: "yazilim_muh",
    name: "Yazılım Mühendisliği",
    baseBoost: 142,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 38, Sosyal: 17, Fen: 31 },
      { Matematik: 39, Fizik: 12, Kimya: 11.5, Biyoloji: 11 }
    ),
  },
  {
    id: "mekatronik",
    name: "Mekatronik Mühendisliği",
    baseBoost: 128,
    rows: rowsFromTyAyt(
      { Turkce: 36, Matematik: 38, Sosyal: 17, Fen: 30 },
      { Matematik: 38, Fizik: 12, Kimya: 11, Biyoloji: 10.5 }
    ),
  },
  {
    id: "enerji_muh",
    name: "Enerji Sistemleri Mühendisliği",
    baseBoost: 118,
    rows: rowsFromTyAyt(
      { Turkce: 35, Matematik: 37, Sosyal: 16, Fen: 29 },
      { Matematik: 37, Fizik: 11.5, Kimya: 11, Biyoloji: 10.5 }
    ),
  },
  {
    id: "maden_muh",
    name: "Maden Mühendisliği",
    baseBoost: 92,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 35, Sosyal: 16, Fen: 28 },
      { Matematik: 35, Fizik: 10.5, Kimya: 10.5, Biyoloji: 10 }
    ),
  },
  {
    id: "gmu",
    name: "Gemi ve Deniz Teknolojisi Mühendisliği",
    baseBoost: 98,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 36, Sosyal: 16, Fen: 28 },
      { Matematik: 36, Fizik: 11, Kimya: 10.5, Biyoloji: 10 }
    ),
  },
  {
    id: "tip_ing",
    name: "Tıp Fakültesi (İngilizce)",
    baseBoost: 154,
    rows: rowsFromTyAyt(
      { Turkce: 39, Matematik: 38, Sosyal: 19, Fen: 35 },
      { Matematik: 36, Fizik: 13, Kimya: 13, Biyoloji: 14 }
    ),
  },
  {
    id: "hemsirelik",
    name: "Hemşirelik",
    baseBoost: 72,
    rows: rowsFromTyAyt(
      { Turkce: 34, Matematik: 32, Sosyal: 18, Fen: 26 },
      { Matematik: 30, Fizik: 9, Kimya: 10, Biyoloji: 12 }
    ),
  },
  {
    id: "beslenme_diyetetik",
    name: "Beslenme ve Diyetetik",
    baseBoost: 68,
    rows: rowsFromTyAyt(
      { Turkce: 35, Matematik: 33, Sosyal: 17, Fen: 28 },
      { Matematik: 31, Fizik: 9.5, Kimya: 11, Biyoloji: 12 }
    ),
  },
  {
    id: "fizyoterapi",
    name: "Fizyoterapi ve Rehabilitasyon",
    baseBoost: 75,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 34, Sosyal: 16, Fen: 28 },
      { Matematik: 33, Fizik: 10, Kimya: 10, Biyoloji: 12 }
    ),
  },
  {
    id: "odyoloji",
    name: "Odyoloji",
    baseBoost: 58,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 36 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 34 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 32 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 32 },
      { section: "AYT", name: "Tarih-1", targetNet: 22 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 20 },
    ],
  },
  {
    id: "sinema_tv",
    name: "Radyo, Televizyon ve Sinema",
    baseBoost: 38,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 30 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 22 },
      { section: "AYT", name: "Matematik", targetNet: 26 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 34 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 21 },
    ],
  },
  {
    id: "bankacilik",
    name: "Bankacılık ve Sigortacılık",
    baseBoost: 52,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 36 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 35 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 25 },
      { section: "AYT", name: "Matematik", targetNet: 33 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 32 },
      { section: "AYT", name: "Tarih-1", targetNet: 22 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 20 },
    ],
  },
  {
    id: "uluslararasi_ticaret",
    name: "Uluslararası Ticaret ve Finans",
    baseBoost: 58,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 37 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 36 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 34 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 33 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 21 },
    ],
  },
  {
    id: "rehberlik",
    name: "Rehberlik ve Psikolojik Danışmanlık",
    baseBoost: 42,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 38 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 19 },
      { section: "TYT", name: "Temel Matematik", targetNet: 31 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 24 },
      { section: "AYT", name: "Matematik", targetNet: 28 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 34 },
      { section: "AYT", name: "Tarih-1", targetNet: 24 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 22 },
    ],
  },
  {
    id: "dis_ing",
    name: "Diş Hekimliği (İngilizce)",
    baseBoost: 147,
    rows: rowsFromTyAyt(
      { Turkce: 38, Matematik: 38, Sosyal: 18, Fen: 34 },
      { Matematik: 37, Fizik: 12.5, Kimya: 12.5, Biyoloji: 13.5 }
    ),
  },
  {
    id: "eczacilik_ing",
    name: "Eczacılık (İngilizce)",
    baseBoost: 128,
    rows: rowsFromTyAyt(
      { Turkce: 38, Matematik: 37, Sosyal: 18, Fen: 33 },
      { Matematik: 36, Fizik: 12, Kimya: 13, Biyoloji: 13 }
    ),
  },
  {
    id: "aviation_elec",
    name: "Elektronik ve Haberleşme Mühendisliği",
    baseBoost: 132,
    rows: rowsFromTyAyt(
      { Turkce: 36, Matematik: 38, Sosyal: 17, Fen: 30 },
      { Matematik: 38, Fizik: 12.5, Kimya: 11.5, Biyoloji: 11 }
    ),
  },
  {
    id: "bilgisayar_ing",
    name: "Bilgisayar Mühendisliği (İngilizce)",
    baseBoost: 152,
    rows: rowsFromTyAyt(
      { Turkce: 37, Matematik: 38, Sosyal: 17, Fen: 31 },
      { Matematik: 39, Fizik: 12.5, Kimya: 12, Biyoloji: 11.5 }
    ),
  },
];

/** Bölüm şablonları — dropdown’da aynı program adı tek satır (ilk şablon korunur) */
export const PROGRAM_TEMPLATES_UI = dedupeNamedRecordsByDisplayName(PROGRAM_TEMPLATES);

/** Üniversite listesi — aynı üniversite adı tek satır (ilk id korunur) */
export const TR_UNIVERSITIES_UNIQUE = dedupeNamedRecordsByDisplayName(TR_UNIVERSITIES);

/**
 * @returns {{ id: string, university: string, department: string, baseScore2025: number, rows: Array } | null}
 */
export function buildProgramFromUniTemplate(uniId, templateId) {
  var uni = TR_UNIVERSITIES_UNIQUE.find(function (u) {
    return u.id === uniId;
  });
  var tmpl = PROGRAM_TEMPLATES.find(function (t) {
    return t.id === templateId;
  });
  if (!uni || !tmpl) return null;
  var h = hashStr(uniId + "::" + templateId);
  var jitter = (h % 17) - 8;
  var prestige = getPrestigeBonus2025(uniId, hashStr);
  var boost = tmpl.baseBoost || 0;
  /** 2025 yerleştirme tarzı taban (simülasyon): prestij + şablon zorluğu + deterministik yayılım */
  var base = 248 + prestige + boost * 0.92 + (h % 162) * 0.88 + jitter * 0.26;
  var baseScore2025 = Math.round(Math.min(579, Math.max(248, base)) * 10) / 10;
  return {
    id: uniId + "__" + templateId,
    university: uni.name,
    department: tmpl.name,
    baseScore2025: baseScore2025,
    rows: tmpl.rows.map(function (r) {
      return { section: r.section, name: r.name, targetNet: r.targetNet };
    }),
  };
}

export function findProgramByUniAndTemplate(uniId, templateId) {
  return buildProgramFromUniTemplate(uniId, templateId);
}

/** Hedef simülatörü için örnek liste (performans: ilk N çift) */
export function sampleProgramsForHedefSimulator(limit) {
  var lim = typeof limit === "number" && limit > 0 ? limit : 400;
  var out = [];
  var uu = TR_UNIVERSITIES_UNIQUE;
  var tt = PROGRAM_TEMPLATES_UI;
  outer: for (var i = 0; i < uu.length; i++) {
    for (var j = 0; j < tt.length; j++) {
      var p = buildProgramFromUniTemplate(uu[i].id, tt[j].id);
      if (p) out.push(p);
      if (out.length >= lim) break outer;
    }
  }
  return out;
}
