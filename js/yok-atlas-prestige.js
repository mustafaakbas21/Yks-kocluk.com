/**
 * Üniversite “prestij” katmanı — 2025 yerleştirme simülasyonunda taban puanına ek etki.
 * Resmî YÖK/ÖSYM sıralaması değildir; sunumda üst/orta/alt dilimlerin ayrışması için kalibrasyon.
 * 4 = en seçkin, 1 = genel devlet / bölgesel ağırlık.
 */
function hashStr(s) {
  var h = 0;
  var str = String(s || "");
  for (var i = 0; i < str.length; i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/** @type {Record<string, 1|2|3|4>} */
export const UNIVERSITY_PRESTIGE_TIER = {
  bogazici: 4,
  bogazici2: 4,
  boun: 4,
  odtu: 4,
  odtu2: 4,
  metu: 4,
  itu: 4,
  itu2: 4,
  istanbul_teknik: 4,
  bilkent: 4,
  bilkent2: 4,
  istanbul_koc: 4,
  istanbul_sabanci: 4,
  ankara_bilkent: 4,
  istanbul_odtu_istanbul: 3,
  yeditepe: 3,
  bahcesehir: 3,
  ankara_hacettepe: 4,
  ankara_hacettepe2: 4,
  hu: 4,
  ankara: 3,
  ankara_ankara: 3,
  au: 3,
  gazi: 3,
  gazi2: 3,
  gu: 3,
  ankara_gazi2: 3,
  istanbul_univ: 3,
  istanbul: 3,
  ege: 3,
  ege2: 3,
  izmir_ege: 3,
  deu: 3,
  izmir_dokuz: 3,
  izmir_iyte: 4,
  iyte2: 4,
  ktu: 3,
  karadeniz_teknik: 3,
  yildiz: 3,
  ytu2: 3,
  gebze_teknik: 3,
  gebze2: 3,
  etu: 3,
  ankara_tobb: 3,
  marmara: 3,
  marmara2: 3,
  istanbul_marmara: 3,
  yasar: 3,
  izmir_yasar: 3,
  izmir_yasar2: 3,
  izmir_economy: 3,
  istanbul_odtu_istanbul: 3,
  hatay_mustafa: 2,
  iste: 2,
  bandirma_17: 2,
  ankara_asbu: 3,
};

/**
 * Taban puana eklenecek 0–52 arası bonus (üniversite + deterministik küçük oynama).
 * @param {string} uniId
 * @param {function(string): number} [hashFn]
 */
export function getPrestigeBonus2025(uniId, hashFn) {
  var id = String(uniId || "");
  var hf = hashFn || hashStr;
  var tier = UNIVERSITY_PRESTIGE_TIER[id];
  if (tier == null) {
    var h0 = hf(id + "::prestige");
    tier = 1 + (h0 % 3);
  }
  var spread = hf(id + "::spr");
  var micro = (spread % 7) - 3;
  return tier * 11 + 6 + micro;
}
