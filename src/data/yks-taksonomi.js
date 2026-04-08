/**
 * YKS TYT/AYT — ders → konu → kazanım taksonomisi + ders bazlı soru tipleri.
 * Tarama (Soru Arşivi) modülü için veri katmanı.
 */

/** @typedef {{ id: string, ad: string }} Kazanim */
/** @typedef {{ id: string, ad: string, kazanilar: Kazanim[] }} Konu */
/** @typedef {{ id: string, ad: string, sinav: 'TYT'|'AYT', soruTipleri: string[], konular: Konu[] }} Ders */

/** @type {Ders[]} */
export const YKS_TAKSONOMI_DERSLER = [
  {
    id: "tyt-turkce",
    ad: "TYT Türkçe",
    sinav: "TYT",
    soruTipleri: [
      "Paragrafta Yapı",
      "Anlatım Biçimleri",
      "Görsel Okuma",
      "Dil Bilgisi (Sözcükte/Yorumda Anlam)",
      "Sözcükte Anlam",
      "Cümlede Anlam",
      "Paragrafta Anlam",
      "Yazım ve Noktalama",
    ],
    konular: [
      {
        id: "paragraf",
        ad: "Paragraf",
        kazanilar: [
          { id: "ana-dusunce", ad: "Ana düşünceyi belirleme" },
          { id: "yardimci-dusunce", ad: "Yardımcı düşünceleri ayırt etme" },
          { id: "paragraf-turleri", ad: "Paragraf türleri ve amaç" },
        ],
      },
      {
        id: "dil-bilgisi",
        ad: "Dil Bilgisi",
        kazanilar: [
          { id: "fiilimsiler", ad: "Fiilimsi (mastar, sıfat-fiil, zarf-fiil)" },
          { id: "cumle-turleri", ad: "Cümle türleri ve ögeler" },
          { id: "noktalama", ad: "Noktalama işaretleri" },
        ],
      },
      {
        id: "sozcukte-anlam",
        ad: "Sözcükte Anlam",
        kazanilar: [
          { id: "mecaz-anlam", ad: "Gerçek ve mecaz anlam" },
          { id: "deyimler", ad: "Deyim ve ikilemeler" },
        ],
      },
    ],
  },
  {
    id: "tyt-matematik",
    ad: "TYT Matematik",
    sinav: "TYT",
    soruTipleri: [
      "Öncüllü (I, II, III)",
      "Şekilli / Grafik",
      "Problem Kurgulu",
      "Klasik İşlem",
      "Tablo / Grafik Okuma",
      "Yeni Nesil Uzun Metin",
    ],
    konular: [
      {
        id: "temel-kavramlar",
        ad: "Temel Kavramlar",
        kazanilar: [
          { id: "sayilar", ad: "Sayılar ve işlemler" },
          { id: "bolunebilme", ad: "Bölünebilme kuralları" },
          { id: "ebob-ekok", ad: "EBOB–EKOK" },
        ],
      },
      {
        id: "fonksiyonlar",
        ad: "Fonksiyonlar",
        kazanilar: [
          { id: "fonk-tanim", ad: "Fonksiyon tanımı ve grafik" },
          { id: "dogrusal", ad: "Doğrusal fonksiyon" },
        ],
      },
      {
        id: "geometri-temel",
        ad: "Temel Geometri",
        kazanilar: [
          { id: "aci", ad: "Açılar ve doğrular" },
          { id: "cokgen", ad: "Çokgenler" },
        ],
      },
    ],
  },
  {
    id: "tyt-geometri",
    ad: "TYT Geometri",
    sinav: "TYT",
    soruTipleri: [
      "Katlama / Kesme",
      "Döndürme ve Simetri",
      "Günlük Hayat / Yeni Nesil",
      "Klasik İşlem",
      "Öncüllü (I, II, III)",
      "Alan–Çevre–Hacim",
    ],
    konular: [
      {
        id: "ucgenler",
        ad: "Üçgenler",
        kazanilar: [
          { id: "pisagor", ad: "Dik üçgende Pisagor bağıntısı" },
          { id: "es-ve-benzer", ad: "Eşlik ve benzerlik" },
          { id: "aci-kenar", ad: "İç ve dış açılar" },
        ],
      },
      {
        id: "cember-daire",
        ad: "Çember ve Daire",
        kazanilar: [
          { id: "teget-kiris", ad: "Teğet, kiriş, açı" },
          { id: "daire-alan", ad: "Dairede alan ve çevre" },
        ],
      },
      {
        id: "analitik",
        ad: "Analitik Geometri",
        kazanilar: [
          { id: "dogru-denklemi", ad: "Doğrunun analitik denklemi" },
          { id: "nokta-dogru", ad: "İki nokta arası uzaklık" },
        ],
      },
    ],
  },
  {
    id: "tyt-fizik",
    ad: "TYT Fizik",
    sinav: "TYT",
    soruTipleri: [
      "Grafik Yorumlama",
      "Deney / Grafik",
      "Birim Dönüşümü",
      "Kavramsal (Yorum)",
      "Sayısal Problem",
    ],
    konular: [
      {
        id: "hareket",
        ad: "Hareket ve Kuvvet",
        kazanilar: [
          { id: "dogrusal-hareket", ad: "Doğrusal hareket grafikleri" },
          { id: "newton", ad: "Newton yasaları" },
        ],
      },
      {
        id: "elektrik",
        ad: "Elektrik",
        kazanilar: [
          { id: "ohm", ad: "Ohm yasası ve direnç" },
          { id: "devre", ad: "Basit elektrik devreleri" },
        ],
      },
    ],
  },
  {
    id: "ayt-matematik",
    ad: "AYT Matematik",
    sinav: "AYT",
    soruTipleri: [
      "Öncüllü (I, II, III)",
      "Limit–Türev–İntegral Grafik",
      "Problem Kurgulu",
      "Klasik Analiz",
      "Matris / Determinant",
    ],
    konular: [
      {
        id: "turev-uygulama",
        ad: "Türev",
        kazanilar: [
          { id: "turev-geometri", ad: "Türevin geometrik yorumu" },
          { id: "ekstremum", ad: "Ekstremum problemleri" },
        ],
      },
      {
        id: "integral",
        ad: "İntegral",
        kazanilar: [
          { id: "belirsiz", ad: "Belirsiz integral" },
          { id: "belirli-alan", ad: "Belirli integral ve alan" },
        ],
      },
    ],
  },
  {
    id: "ayt-edebiyat",
    ad: "AYT Edebiyat",
    sinav: "AYT",
    soruTipleri: [
      "Paragrafta Anlam",
      "Edebi Sanatlar",
      "Şiir Bilgisi",
      "Divan / Halk Edebiyatı",
      "Metin İnceleme",
    ],
    konular: [
      {
        id: "halk-edebiyati",
        ad: "Halk Edebiyatı",
        kazanilar: [
          { id: "anonim-halk", ad: "Anonim halk edebiyatı ürünleri" },
          { id: "asiklik", ad: "Aşıklık geleneği" },
        ],
      },
      {
        id: "divan",
        ad: "Divan Edebiyatı",
        kazanilar: [
          { id: "nazim-bicimleri", ad: "Nazım biçimleri ve aruz" },
          { id: "mesnev", ad: "Mesnevî ve hikâye" },
        ],
      },
    ],
  },
];

/**
 * @param {string} dersId
 * @returns {Ders | undefined}
 */
export function getTaksonomiDersById(dersId) {
  return YKS_TAKSONOMI_DERSLER.find(function (d) {
    return d.id === dersId;
  });
}

/**
 * @param {string} dersId
 * @param {string} konuId
 * @returns {Konu | undefined}
 */
export function getTaksonomiKonuById(dersId, konuId) {
  var d = getTaksonomiDersById(dersId);
  if (!d) return undefined;
  return d.konular.find(function (k) {
    return k.id === konuId;
  });
}

/**
 * @param {string} dersId
 * @param {string} konuId
 * @param {string} kazanimId
 * @returns {Kazanim | undefined}
 */
export function getTaksonomiKazanimById(dersId, konuId, kazanimId) {
  var konu = getTaksonomiKonuById(dersId, konuId);
  if (!konu) return undefined;
  return konu.kazanilar.find(function (k) {
    return k.id === kazanimId;
  });
}

/**
 * Soru tipi etiketine göre Gemini systemInstruction ekleri (ders bazlı).
 * Anahtar: tam olarak `soruTipleri` dizisindeki metinle eşleşmeli.
 * @type {Record<string, Record<string, string>>}
 */
export const TAKSONOMI_AI_SORU_TIPI_HINTS = {
  "tyt-turkce": {
    "Paragrafta Yapı":
      "Paragrafın yapısına odaklan: giriş–gelişme–sonuç, düşünce akışı, bağlaçlar ve anlatımın örgütlenmesi.",
    "Anlatım Biçimleri":
      "Öyküleyici, açıklayıcı, tartışmacı vb. anlatım biçimlerini ayırt ettiren bir kök kur.",
    "Görsel Okuma":
      "Tablo, grafik, şema veya görsel özet üzerinden çıkarım gerektiren bir metin/yorum sorusu üret.",
    "Dil Bilgisi (Sözcükte/Yorumda Anlam)":
      "Dil bilgisi kurallarını bağlam içinde ölç; kural ezberi değil kullanım odaklı olsun.",
    "Sözcükte Anlam": "Sözcüğün cümle içi anlamını ve görevini ölç; çok anlamlılık ve bağlamı kullan.",
    "Cümlede Anlam": "Cümlenin anlamına ve iletişim işlevine yönelik bir soru yaz.",
    "Paragrafta Anlam": "Paragrafın ana düşüncesi, konu cümlesi veya çıkarımı ölçen ÖSYM tarzı kök yaz.",
    "Yazım ve Noktalama": "Yazım veya noktalama ile ilgili doğru/yanlış veya seçmeli bir soru üret.",
  },
  "tyt-matematik": {
    "Öncüllü (I, II, III)":
      "I–II–III öncüllü yapı kullan; mantıksal doğruluk ve çelişkisiz öncüller kur.",
    "Şekilli / Grafik": "Grafik, şekil veya koordinat düzlemi yorumu gerektiren bir kök yaz (metinde tanımla).",
    "Problem Kurgulu": "Gerçekçi bir günlük hayat veya bilimsel kurgu içinde matematiksel model kur.",
    "Klasik İşlem": "Doğrudan işlem ve kısa çözüm yolu olan klasik TYT matematik sorusu.",
    "Tablo / Grafik Okuma": "Tablo veya grafikten okuma ve yorum gerektiren bir soru yaz.",
    "Yeni Nesil Uzun Metin": "Uzun köklü, bağlamı zengin, birden fazla adım gerektiren yeni nesil bir soru yaz.",
  },
  "tyt-geometri": {
    "Katlama / Kesme":
      "Sen bir Geometri uzmanısın. Soruda mutlaka bir kağıt veya şekil katlama/kesme senaryosu, oluşan yeni açılar ve uzunluklar üzerine bir kurgu olmalı. ÖSYM çoktan seçmeli biçiminde olsun.",
    "Döndürme ve Simetri":
      "Düzlemde döndürme, eksene göre simetri veya dönüşüm sonrası şekil üzerinden soru kur; gerekirse açı ve uzunluk ilişkilerini kullan.",
    "Günlük Hayat / Yeni Nesil":
      "Günlük hayattan veya bağlamı uzun bir metinden geometrik model çıkarma; çıkarım ve yorum ağırlıklı olsun.",
    "Klasik İşlem": "Klasik geometri hesabı (açı, uzunluk, alan) içeren doğrudan bir soru yaz.",
    "Öncüllü (I, II, III)": "Geometride I–II–III öncüllü yapı; her öncül net ve sınaması mümkün olsun.",
    "Alan–Çevre–Hacim": "Alan, çevre veya hacim hesabına dayanan, gerekirse bileşik şekil içeren bir soru yaz.",
  },
  "tyt-fizik": {
    "Grafik Yorumlama": "Konum–zaman, hız–zaman vb. grafik yorumu gerektiren bir fizik sorusu yaz.",
    "Deney / Grafik": "Basit deney düzeneği veya ölçüm sonuçları üzerinden çıkarım iste.",
    "Birim Dönüşümü": "Birim dönüşümü ve ölçek içeren dikkatli bir sayısal soru yaz.",
    "Kavramsal (Yorum)": "Kavram yanlış anlamalarını ayıklayan yorum ağırlıklı bir soru yaz.",
    "Sayısal Problem": "Formül uygulamalı klasik sayısal fizik problemi yaz.",
  },
  "ayt-matematik": {
    "Öncüllü (I, II, III)": "Analiz/cebir bağlamında I–II–III öncüllü, çelişkisiz bir soru yaz.",
    "Limit–Türev–İntegral Grafik": "Limit, türev veya integral ile grafik ilişkisini ölçen bir soru yaz.",
    "Problem Kurgulu": "Çok adımlı, model kurmayı gerektiren AYT matematik problemi yaz.",
    "Klasik Analiz": "Klasik türev–integral veya fonksiyon analizi hesabı içeren soru yaz.",
    "Matris / Determinant": "Matris işlemleri veya determinant içeren bir soru yaz.",
  },
  "ayt-edebiyat": {
    "Paragrafta Anlam": "Edebi metin veya parça üzerinden anlam/anlatım soruları yaz.",
    "Edebi Sanatlar": "Sanat ve süslemeleri tanıma ve işlevini yorumlama odaklı soru yaz.",
    "Şiir Bilgisi": "Nazım biçimi, ölçü veya şiir türü ile ilgili ayırt edici bir soru yaz.",
    "Divan / Halk Edebiyatı": "Divan veya halk edebiyatı ürün ve şahsiyetleriyle ilgili bilgi sor.",
    "Metin İnceleme": "Verilen kısa metin üzerinden çıkarım ve yorum gerektiren soru yaz.",
  },
};

/**
 * @param {string} dersId
 * @param {string} soruTipiEtiketi
 * @returns {string | null}
 */
export function getAiHintForSoruTipi(dersId, soruTipiEtiketi) {
  var m = TAKSONOMI_AI_SORU_TIPI_HINTS[dersId];
  if (!m) return null;
  return m[soruTipiEtiketi] || null;
}

/**
 * Gemini `systemInstruction` metni: ders rolü + seçilen soru tipi ipuçları + konu/kazanım bağlamı.
 * @param {string} dersId
 * @param {string[]} selectedSoruTipiLabels — checkbox’tan seçilenler (boşsa ipuçları genel kalır)
 * @param {string} [konuAd]
 * @param {string} [kazanimAd]
 * @returns {string}
 */
export function buildTaramaGeminiSystemInstruction(dersId, selectedSoruTipiLabels, konuAd, kazanimAd) {
  var parts = [];
  var d = getTaksonomiDersById(dersId);
  if (d) {
    parts.push(
      "Sen YKS " +
        d.ad +
        " alanında uzman bir öğretmensin. Soruları Türkçe yaz; kök net ve anlaşılır olsun. Çıktı yalnızca istenen JSON şemasına uygun olmalı; markdown kod çiti veya ek açıklama ekleme."
    );
  } else {
    parts.push("Sen YKS formatında çoktan seçmeli soru yazan uzman bir öğretmensin.");
  }
  var tips = selectedSoruTipiLabels && selectedSoruTipiLabels.length ? selectedSoruTipiLabels : d ? d.soruTipleri.slice() : [];
  var seen = {};
  tips.forEach(function (tip) {
    if (!tip || seen[tip]) return;
    seen[tip] = true;
    var specific = dersId ? getAiHintForSoruTipi(dersId, tip) : null;
    if (specific) {
      parts.push(specific);
    } else if (d) {
      parts.push(
        "Bu üretimde soru türü şu etikete uygun olmalı: \"" +
          tip +
          "\". " +
          d.ad +
          " müfredatına ve ÖSYM çoktan seçmeli beş şık (A–E) formatına uy."
      );
    }
  });
  if (konuAd) parts.push("Seçilen konu bağlamı: " + konuAd + ".");
  if (kazanimAd) parts.push("Ölçülmesi hedeflenen kazanım: " + kazanimAd + ".");
  return parts.join("\n\n");
}
