/**
 * Merkezi YKS müfredat — Sınav → Ders → Konu (TYT / AYT / YDT).
 * Net Sihirbazı / Hedef / Otomatik Kırpıcı / öğrenci accordion tek kaynak.
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
