/**
 * YKS deneme analizi — TYT / AYT branş soru sayıları ve konu etiketleri (koçluk analizi için).
 * Resmî sınav yapısına yakın; konu listeleri temsilidir.
 */

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

/** AYT alanlarına göre branş setleri (soru sayıları ÖSYM yapısına yakın) */
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

export function clampDy(soru, d, y) {
  var dd = Math.max(0, Math.min(soru, Number(d) || 0));
  var yy = Math.max(0, Math.min(soru - dd, Number(y) || 0));
  return { d: dd, y: yy, b: Math.max(0, soru - dd - yy) };
}
