/**
 * Merkezi YKS “master” modül — müfredat + deneme branş yapısı + net yardımcıları.
 *
 * - YKS2026_Mufredat — Sınav → Ders → Konu (MR Emar, Görev Takibi, Net Sihirbazı, öğrenci paneli)
 * - mufredatData / yksMufredatDatasi — TYT·AYT·YDT sözlüğü (legacy formlar)
 * - YKS_TYT_BRANCHES / YKS_AYT_BY_ALAN — TYT/AYT branş soru sayıları (Deneme Analizi, optik)
 * - netFromDy, clampDy — net hesabı
 */

/**
 * @type {Record<string, Record<string, string[]>>}
 */
export const YKS2026_Mufredat = {
  TYT: {
    "TYT Türkçe": [
      "Sözcükte Anlam",
      "Cümlede Anlam",
      "Paragrafta Anlam",
      "Ses Bilgisi",
      "Yazım Kuralları",
      "Noktalama İşaretleri",
      "Anlatım Bozuklukları",
    ],
    "TYT Matematik": [
      "Temel Kavramlar",
      "Sayı Basamakları ve Bölünebilme",
      "Rasyonel Sayılar",
      "Üslü Sayılar",
      "Köklü Sayılar",
      "Çarpanlara Ayırma",
      "Oran ve Orantı",
      "Problemler",
      "Mutlak Değer",
      "Birinci Dereceden Denklem ve Eşitsizlikler",
      "Kümeler ve İşlemler",
      "Fonksiyonlar",
      "Permütasyon, Kombinasyon ve Olasılık",
      "Veri, İstatistik",
    ],
    "TYT Geometri": [
      "Üçgenler",
      "Çokgenler ve Dörtgenler",
      "Çember ve Daire",
      "Katı Cisimler",
      "Dönüşüm Geometrisi",
      "Analitik Geometri",
    ],
    "TYT Tarih": [
      "Tarih Bilimi ve Uygarlığın Doğuşu",
      "İlk ve Orta Çağlarda Türk Dünyası",
      "İslam Tarihi ve Uygarlığı",
      "Türkiye Tarihi (Türk-İslam Devletleri, Osmanlı)",
      "Yakın Çağda Türkiye, Atatürk İlkeleri ve İnkılap Tarihi",
      "Atatürk Dönemi ve Sonrası Türkiye",
    ],
    "TYT Coğrafya": [
      "Doğa ve İnsan",
      "Dünya'nın Şekli ve Hareketleri",
      "Çevre ve Toplum",
      "İklim Bilgisi",
      "Yeryüzü Şekilleri ve Su",
      "Nüfus ve Yerleşme",
      "Üretim, Bölgesel Kalkınma ve Küresel Ekonomi",
    ],
    "TYT Felsefe": [
      "Felsefeye Giriş",
      "Bilgi Felsefesi",
      "Varlık Felsefesi",
      "Ahlak Felsefesi",
      "Sanat Felsefesi",
      "Din Felsefesi",
      "Siyaset Felsefesi",
      "Bilim Felsefesi",
    ],
    "TYT Din": [
      "İnanç Esasları",
      "İbadetler",
      "Güncel Ahlaki ve Sosyal Meseleler",
    ],
    "TYT Fizik": [
      "Fizik Bilimine Giriş",
      "Madde ve Özellikleri",
      "Hareket ve Kuvvet",
      "Enerji",
      "Basit Makineler",
      "Isı ve Sıcaklık",
      "Elektrik ve Elektronik",
      "Dalga Özellikleri ve Optik",
    ],
    "TYT Kimya": [
      "Kimya Bilimi",
      "Atom ve Yapısı",
      "Periyodik Sistem",
      "Kimyasal Türler Arası Etkileşimler",
      "Mol Kavramı",
      "Asitler ve Bazlar",
      "Kimya ve Enerji",
      "Karbon Kimyası ve Hayat",
    ],
    "TYT Biyoloji": [
      "Canlıların Ortak Özellikleri",
      "Hücre",
      "Canlıların Sınıflandırılması",
      "Ekoloji",
      "Canlılarda Enerji Dönüşümü",
      "Kalıtım ve Evrim",
      "Vücudun Sistemleri",
      "Biyoteknoloji ve Genetik Mühendisliği",
    ],
  },
  AYT: {
    "AYT Matematik": [
      "Temel Kavramlar",
      "Sayı Basamakları ve Bölünebilme",
      "Rasyonel Sayılar",
      "Üslü Sayılar",
      "Köklü Sayılar",
      "Çarpanlara Ayırma",
      "Oran ve Orantı",
      "Problemler",
      "Mutlak Değer",
      "Denklem ve Eşitsizlikler",
      "Kümeler ve İşlemler",
      "Fonksiyonlar",
      "Permütasyon, Kombinasyon ve Olasılık",
      "Veri, İstatistik",
      "Trigonometri",
      "Diziler ve Seriler",
      "Limit ve Süreklilik",
      "Türev",
      "İntegral",
    ],
    "AYT Geometri": [
      "Üçgenler",
      "Çokgenler ve Dörtgenler",
      "Çember ve Daire",
      "Katı Cisimler",
      "Dönüşüm Geometrisi",
      "Analitik Geometri",
    ],
    "AYT Edebiyat": [
      "Güzel Sanatlar ve Edebiyat",
      "Edebi Sanatlar",
      "Halk Edebiyatı",
      "Tanzimat ve Servet-i Fünun",
      "Milli Edebiyat",
      "Cumhuriyet Dönemi ve Sonrası Türk Edebiyatı",
      "Dünya Edebiyatı",
    ],
    "AYT Tarih-1": [
      "Tarih Bilimi ve Yakın Çağın Başlangıcı",
      "İlk Çağ Uygarlıkları ve İslam Öncesi Türk Tarihi",
      "İlk Çağlarda İslam Tarihi ve Kültürü",
      "Türk-İslam Devletleri, Osmanlı Tarihi",
      "Yüzyıldan Günümüze Türkiye ve Dünya",
    ],
    "AYT Tarih-2": [
      "Atatürk İlkeleri ve İnkılap Tarihi",
      "Atatürk Dönemi ve Sonrası Türkiye",
    ],
    "AYT Coğrafya-1": [
      "Doğa ve İnsan",
      "Dünya'nın Şekli ve Hareketleri",
      "İklim Bilgisi",
      "Yeryüzü Şekilleri ve Su",
      "Nüfus ve Yerleşme",
      "Üretim, Bölgesel Kalkınma ve Küresel Ekonomi",
    ],
    "AYT Coğrafya-2": [
      "Çevre ve Toplum",
      "Türkiye Fiziki ve Beşeri Coğrafyası",
      "Çevre ve Toplum Sorunları",
      "Küresel Ortam",
    ],
    "AYT Felsefe Grubu": [
      "Felsefeye Giriş",
      "Bilgi Felsefesi",
      "Varlık Felsefesi",
      "Ahlak Felsefesi",
      "Sanat Felsefesi",
      "Din Felsefesi",
      "Siyaset Felsefesi",
      "Bilim Felsefesi",
      "Psikoloji",
      "Sosyoloji",
      "Mantık",
    ],
    "AYT Din Kültürü ve Ahlak Bilgisi": [
      "İnanç Esasları",
      "İbadetler",
      "Güncel Ahlaki ve Sosyal Meseleler",
    ],
    "AYT Fizik": [
      "Vektörler ve Kuvvet",
      "Hareket ve Kuvvet",
      "Enerji",
      "Basit Makineler",
      "Isı ve Sıcaklık",
      "Elektrik ve Manyetizma",
      "Dalga Özellikleri ve Optik",
      "Modern Fizik",
    ],
    "AYT Kimya": [
      "Kimya Bilimi",
      "Atom ve Yapısı",
      "Periyodik Sistem",
      "Kimyasal Türler Arası Etkileşimler",
      "Mol Kavramı",
      "Asitler ve Bazlar",
      "Kimya ve Enerji",
      "Organik Kimya",
      "Karbon Kimyası",
    ],
    "AYT Biyoloji": [
      "Canlıların Ortak Özellikleri",
      "Hücre",
      "Canlıların Sınıflandırılması",
      "Ekoloji",
      "Canlılarda Enerji Dönüşümü",
      "Kalıtım ve Evrim",
      "Vücudun Sistemleri",
      "Biyoteknoloji ve Genetik Mühendisliği",
    ],
  },
  YDT: {
    "YDT": [
      "Kelime Bilgisi",
      "Dil Bilgisi",
      "Cloze Test",
      "Cümleyi Tamamlama",
      "İngilizceden Türkçeye Çeviri",
      "Paragraf",
      "Diyalog Tamamlama",
      "Anlam Bütünlüğü",
    ],
  },
};

export function yks2026DersKeys(exam) {
  if (!exam) {
    var out = [];
    ["TYT", "AYT", "YDT"].forEach(function (e) {
      Object.keys(YKS2026_Mufredat[e] || {}).forEach(function (k) {
        if (out.indexOf(k) === -1) out.push(k);
      });
    });
    return out;
  }
  return Object.keys(YKS2026_Mufredat[exam] || {});
}

/**
 * @param {string} exam
 * @param {string} dersKey — örn. "TYT Matematik"
 * @returns {{ value: string, text: string }[]}
 */
export function yks2026KonuOptionsForDers(exam, dersKey) {
  var block = (YKS2026_Mufredat[exam] || {})[dersKey];
  if (!Array.isArray(block)) return [];
  return block.map(function (topic) {
    return { value: topic, text: topic };
  });
}

/**
 * Öğrenci paneli / soru formları için TYT·AYT·YDT sözlüğü (ders → konu listesi).
 */
export function buildLegacyMufredatTYTAYT() {
  var out = { TYT: {}, AYT: {}, YDT: {} };
  ["TYT", "AYT", "YDT"].forEach(function (exam) {
    var bag = YKS2026_Mufredat[exam] || {};
    Object.keys(bag).forEach(function (ders) {
      out[exam][ders] = (bag[ders] || []).slice();
    });
  });
  return out;
}

/** Öğrenci paneli / soru PDF / tekilleştirilmiş formlar — `buildLegacyMufredatTYTAYT` türevi */
export const mufredatData = buildLegacyMufredatTYTAYT();
export const yksMufredatDatasi = mufredatData;

// ---------------------------------------------------------------------------
// Deneme analizi & optik — branş soru sayıları (eski dosya: yks-exam-structure.js)
// Konu etiketleri özet/temsilidir; ayrıntılı konu listesi için YKS2026_Mufredat kullanılır.
// ---------------------------------------------------------------------------

export const YKS_TYT_BRANCHES = [
  {
    id: "turkce",
    label: "Türkçe",
    soru: 40,
    konular: [
      "Sözcükte anlam",
      "Cümlede anlam",
      "Paragraf",
      "Ses bilgisi",
      "Yazım kuralları",
      "Noktalama",
      "Sözel mantık",
      "Şiir / nesir (okuma)",
    ],
  },
  {
    id: "matematik",
    label: "Temel Matematik",
    soru: 40,
    konular: [
      "Temel kavramlar",
      "Rasyonel sayılar",
      "Üslü ve köklü sayılar",
      "Çarpanlara ayırma",
      "Oran-orantı",
      "Problemler",
      "Kümeler ve fonksiyonlar",
      "Polinomlar",
      "İkinci dereceden denklemler",
      "Trigonometri",
      "Logaritma",
      "Diziler",
      "Limit ve süreklilik",
      "Türev (TYT düzeyi)",
      "İstatistik ve olasılık",
      "Geometri — üçgenler",
      "Geometri — çokgenler ve dörtgenler",
      "Geometri — çember ve daire",
      "Katı cisimler",
      "Analitik geometri",
    ],
  },
  {
    id: "fen",
    label: "Fen Bilimleri",
    soru: 20,
    alt: [
      { id: "fizik", label: "Fizik", soru: 7 },
      { id: "kimya", label: "Kimya", soru: 7 },
      { id: "biyoloji", label: "Biyoloji", soru: 6 },
    ],
    konular: [
      "Fizik — hareket ve kuvvet",
      "Fizik — enerji",
      "Fizik — elektrik",
      "Kimya — atom ve periyodik sistem",
      "Kimya — kimyasal tepkimeler",
      "Kimya — asit-baz",
      "Biyoloji — hücre ve canlıların sınıflandırılması",
      "Biyoloji — kalıtım",
      "Biyoloji — ekosistem",
    ],
  },
  {
    id: "sosyal",
    label: "Sosyal Bilimler",
    soru: 20,
    alt: [
      { id: "tarih", label: "Tarih", soru: 5 },
      { id: "cografya", label: "Coğrafya", soru: 5 },
      { id: "felsefe", label: "Felsefe", soru: 5 },
      { id: "din", label: "Din Kültürü", soru: 5 },
    ],
    konular: [
      "Tarih — Osmanlı / Cumhuriyet",
      "Coğrafya — Türkiye fiziki ve beşeri",
      "Coğrafya — harita ve çevre",
      "Felsefe — bilgi ve varlık felsefesi",
      "Felsefe — ahlak ve siyaset felsefesi",
      "Din — inanç esasları ve ibadet",
    ],
  },
];

export const YKS_AYT_BY_ALAN = {
  sayisal: {
    label: "Sayısal",
    branches: [
      { id: "mat", label: "Matematik", soru: 40, konular: ["Limit", "Türev", "İntegral", "Analitik geometri", "Trigonometri", "Olasılık"] },
      { id: "fizik", label: "Fizik", soru: 14, konular: ["Kuvvet ve hareket", "Enerji", "Elektrik ve manyetizma", "Dalgalar", "Optik", "Modern fizik"] },
      { id: "kimya", label: "Kimya", soru: 13, konular: ["Kimyasal tepkimeler", "Asit-baz", "Organik kimya", "Termokimya", "Kimyasal denge"] },
      { id: "biyo", label: "Biyoloji", soru: 13, konular: ["Hücre", "Genetik", "Sistemler", "Ekoloji", "Evrim"] },
    ],
  },
  esit_agirlik: {
    label: "Eşit Ağırlık",
    branches: [
      { id: "mat", label: "Matematik", soru: 40, konular: ["Limit", "Türev", "İntegral", "Problemler", "Olasılık"] },
      { id: "edebiyat", label: "Türk Dili ve Edebiyatı", soru: 24, konular: ["Şiir", "Paragraf", "Divan/edebi sanatlar", "Hikaye/roman", "Tanzimat sonrası"] },
      { id: "tarih1", label: "Tarih-1", soru: 10, konular: ["Osmanlı kronoloji", "Kurtuluş Savaşı", "Atatürk ilkeleri"] },
      { id: "cografya1", label: "Coğrafya-1", soru: 6, konular: ["İklim", "Beşeri coğrafya", "Bölgeler"] },
    ],
  },
  sozel: {
    label: "Sözel",
    branches: [
      { id: "edebiyat", label: "Türk Dili ve Edebiyatı", soru: 24, konular: ["Şiir", "Paragraf", "Nesir", "Sözcük bilgisi"] },
      { id: "tarih1", label: "Tarih-1", soru: 11, konular: ["Osmanlı", "Kurtuluş", "İnkılap"] },
      { id: "tarih2", label: "Tarih-2", soru: 11, konular: ["Çağdaş Türk ve dünya tarihi"] },
      { id: "cografya1", label: "Coğrafya-1", soru: 6, konular: ["Doğal sistemler", "Çevre"] },
      { id: "cografya2", label: "Coğrafya-2", soru: 11, konular: ["Bölgeler", "Ülkeler", "Harita"] },
      { id: "felsefe", label: "Felsefe Grubu", soru: 12, konular: ["Mantık", "Psikoloji", "Sosyoloji", "Felsefe"] },
      { id: "din", label: "Din Kültürü", soru: 6, konular: ["İnanç", "İbadet", "Ahlak"] },
    ],
  },
  dil: {
    label: "Dil",
    branches: [
      { id: "ydt", label: "YDT (İngilizce)", soru: 80, konular: ["Kelime", "Grammar", "Cloze", "Çeviri", "Paragraf"] },
    ],
  },
};

export function netFromDy(d, y) {
  d = Number(d) || 0;
  y = Number(y) || 0;
  return Math.max(0, d - y / 4);
}

/**
 * Net kuralı: ÖSYM (4 yanlış 1 doğru), 3 yanlış 1 doğru (yayın/okul), katı 3:1 (tam sayılı).
 * @param {"osym"|"y3"|"y3floor"} rule
 */
export function netFromDyWithRule(d, y, rule) {
  d = Number(d) || 0;
  y = Number(y) || 0;
  var r = rule || "osym";
  if (r === "y3") return Math.max(0, d - y / 3);
  if (r === "y3floor") return Math.max(0, d - Math.floor(y / 3));
  return Math.max(0, d - y / 4);
}

export function clampDy(soru, d, y) {
  var dd = Math.max(0, Math.min(soru, Number(d) || 0));
  var yy = Math.max(0, Math.min(soru - dd, Number(y) || 0));
  return { d: dd, y: yy, b: Math.max(0, soru - dd - yy) };
}
