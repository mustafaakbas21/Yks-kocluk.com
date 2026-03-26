/**
 * Merkezi YKS 2026 müfredat paketi — Net Sihirbazı / Hedef / Otomatik Kırpıcı / öğrenci accordion tek kaynak.
 */
export const YKS2026_Mufredat = {
  "Matematik (TYT/AYT)": {
    "TYT Başlangıç": ["Temel Kavramlar", "Sayı Basamakları", "Bölme-Bölünebilme", "OBEB-OKEK", "Rasyonel Sayılar"],
    "TYT Denklem/Eşitsizlik": ["Basit Eşitsizlikler", "Mutlak Değer", "Üslü Sayılar", "Köklü Sayılar", "Çarpanlara Ayırma"],
    "AYT Trigonometri": ["Trigonometri 1 (Bölüm)", "Trigonometri 2 (Denklemler)"],
    "AYT Logaritma/Diziler": ["Logaritma Fonksiyonu", "Diziler ve Seriler"],
    "AYT Limit/Türev/İntegral": ["Limit ve Süreklilik", "Türev Alma Kuralları", "İntegral ve Alan Hesabı"],
    Geometri: ["Üçgenler", "Dörtgenler", "Çember ve Daire", "Analitik Geometri", "Katı Cisimler"],
  },
  "Türkçe (Edebiyat/Dil)": {
    "Dil Bilgisi (TYT)": ["Sözcükte Anlam", "Cümlede Anlam", "Paragrafta Anlam", "Ses Bilgisi", "Yazım Kuralları", "Noktalama İşaretleri"],
    "Edebiyat (AYT)": ["Edebi Sanatlar", "Türk Edebiyatı Tarihi", "Halk Edebiyatı", "Divan Edebiyatı", "Cumhuriyet Dönemi"],
    "Anlatım Bozuklukları": ["Anlatım Bozukluğu TYT"],
  },
  "Fen Bilimleri": {
    Fizik: ["Vektörler ve Kuvvet", "Hareket", "Newton'un Hareket Yasaları", "Atışlar", "Enerji ve İş"],
    Kimya: ["Kimya Bilimi", "Atom ve Periyodik Sistem", "Kimyasal Türler Arası Etkileşimler", "Mol Kavramı"],
    Biyoloji: ["Hücre ve Yapısı", "Canlıların Sınıflandırılması", "Ekoloji", "Nükleik Asitler", "Canlılarda Enerji Dönüşümü"],
  },
  "Sosyal Bilimler": {
    Tarih: ["Tarih Bilimi", "İlkçağ Uygarlıkları", "Türk-İslam Tarihi", "Osmanlı Tarihi", "Milli Mücadele Dönemi"],
    Coğrafya: ["Doğa ve İnsan", "Dünya'nın Şekli", "Harita Bilgisi", "İklim Bilgisi", "Nüfus ve Yerleşme"],
    "Felsefe & Din": ["Felsefeye Giriş", "Bilgi Felsefesi", "İnanç Esasları", "İbadet ve Hayat"],
  },
};

export function yks2026DersKeys() {
  return Object.keys(YKS2026_Mufredat);
}

/**
 * @param {string} dersKey — YKS2026_Mufredat üst anahtarı
 * @returns {{ value: string, text: string }[]} value = "Ünite › Konu"
 */
export function yks2026KonuOptionsForDers(dersKey) {
  var block = YKS2026_Mufredat[dersKey];
  if (!block || typeof block !== "object") return [];
  var out = [];
  Object.keys(block).forEach(function (unit) {
    var arr = block[unit];
    if (!Array.isArray(arr)) return;
    arr.forEach(function (topic) {
      out.push({
        value: unit + " › " + topic,
        text: unit + " › " + topic,
      });
    });
  });
  return out;
}

/**
 * Öğrenci paneli / soru formları için TYT·AYT sözlüğü (ünite — konu etiketleri).
 */
export function buildLegacyMufredatTYTAYT() {
  var TYT = {};
  var AYT = {};

  function pushUnique(arr, item) {
    if (arr.indexOf(item) === -1) arr.push(item);
  }

  function addTy(ders, unit, topics) {
    if (!TYT[ders]) TYT[ders] = [];
    topics.forEach(function (t) {
      pushUnique(TYT[ders], unit + " — " + t);
    });
  }

  function addAy(ders, unit, topics) {
    if (!AYT[ders]) AYT[ders] = [];
    topics.forEach(function (t) {
      pushUnique(AYT[ders], unit + " — " + t);
    });
  }

  var mat = YKS2026_Mufredat["Matematik (TYT/AYT)"] || {};
  Object.keys(mat).forEach(function (unit) {
    var topics = mat[unit] || [];
    if (/^TYT/i.test(unit) || unit === "Geometri") addTy("Matematik", unit, topics);
    if (/^AYT/i.test(unit)) addAy("Matematik", unit, topics);
  });

  var tr = YKS2026_Mufredat["Türkçe (Edebiyat/Dil)"] || {};
  Object.keys(tr).forEach(function (unit) {
    var topics = tr[unit] || [];
    if (/Dil Bilgisi/i.test(unit) || /TYT/i.test(unit)) addTy("Türkçe", unit, topics);
    if (/Edebiyat/i.test(unit) || /Anlatım/i.test(unit)) addAy("Türk Dili ve Edebiyatı", unit, topics);
  });

  var fen = YKS2026_Mufredat["Fen Bilimleri"] || {};
  Object.keys(fen).forEach(function (dersName) {
    addTy(dersName, dersName, fen[dersName] || []);
  });

  var sos = YKS2026_Mufredat["Sosyal Bilimler"] || {};
  Object.keys(sos).forEach(function (unit) {
    var topics = sos[unit] || [];
    if (unit === "Felsefe & Din") addTy("Felsefe & Din", unit, topics);
    else addTy(unit, unit, topics);
  });

  return { TYT: TYT, AYT: AYT };
}
