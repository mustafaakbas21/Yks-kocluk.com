/**
 * YKS Koçluk — 40 ayrı çizgi film avatar (20 Erkek, 20 Kadın).
 * Pastel daire zemin, düz vektör; her indeks farklı saç silüeti (cinsiyet net ayrılır).
 * Harici görsel / API yok — tamamı SVG data URL.
 */

function svgToDataUrl(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/\s+/g, " ").trim());
}

/**
 * @typedef {object} AvatarPreset
 * @property {string} bg
 * @property {string} hair
 * @property {string} skin
 * @property {string} shirt
 * @property {string} [band]
 * @property {'dd'|'ll'|'wk'} [eye]
 * @property {string} [badge]
 * @property {boolean} [female]
 * @property {boolean} [bow]
 * @property {number} sil — 0..19 silüet indeksi
 */

/* ——— Erkek: 20 farklı saç / baş hacmi (kısa, yan, spiky, uzun yan çizgi, vb.) ——— */
var MALE_SIL_BACK = [
  "M50 14c-14 0-24 10-24 30l2 10c12-10 32-10 44 0l2-10c0-20-10-30-24-30z",
  "M30 20h40a10 10 0 0 1 10 10v6a28 22 0 0 1-28 22h-4a28 22 0 0 1-28-22v-6a10 10 0 0 1 10-10z",
  "M50 12c-18 2-28 16-26 36l4 6c8-14 40-14 48 0l4-6 c2-20-8-34-30-36z",
  "M48 10 L88 28 L82 44 L72 38 Q50 18 28 38 L18 44 L12 28 Z",
  "M50 16l-6-4-4 8 4 10 6-2 6 2 4-10-4-8-6 4zm-18 20l4 8c8-6 28-6 36 0l4-8c-12-8-32-8-44 0z",
  "M50 13c-20 0-32 12-30 32l6 4c6-12 34-12 40 0l6-4c2-20-10-32-30-32z",
  "M26 42c2-22 14-32 24-32s22 10 24 32c-8-10-40-10-48 0z",
  "M38 14h24a14 14 0 0 1 14 14v10H24V28a14 14 0 0 1 14-14z",
  "M50 11c-16 1-24 12-22 28 4-6 40-6 44 0 2-16-6-27-22-28z",
  "M32 18 Q50 8 68 18 L72 36 Q50 24 28 36 Z",
  "M22 48c4-24 16-34 28-34s24 10 28 34c-10-8-46-8-56 0z",
  "M50 15c-22 4-26 18-24 34l8-4c4-12 36-12 40 0l8 4c2-16-2-30-24-34z",
  "M42 12 L58 12 L62 22 L50 28 L38 22 Z",
  "M28 25c6-16 18-18 22-18s23 4 22 18c-12 2-32 2-44 0z",
  "M50 10c-14 0-26 10-26 28h52c0-18-12-28-26-28z",
  "M24 40 Q50 14 76 40 Q72 28 50 20 Q28 28 24 40z",
  "M35 22 Q50 12 65 22 L68 38 Q50 30 32 38 Z",
  "M50 13c-12 0-22 8-20 26h40c2-18-8-26-20-26z",
  "M46 9 L54 9 L58 20 L50 26 L42 20 Z",
  "M30 20 Q50 10 70 20 Q68 32 50 28 Q32 32 30 20z",
];

var MALE_SIL_FRONT = [
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
  "",
];

/* ——— Kadın: 20 farklı silüet (bob, uzun yan, toplu, örgü hissi, fiyonk vb.) ——— */
var FEMALE_SIL_BACK = [
  "M50 16c-20 0-34 20-30 48l8 30h6l-4-38c2-18 40-18 42 0l-4 38h6l8-30c4-28-10-48-30-48z",
  "M50 18c-18 0-28 14-26 34l-2 40h8l4-32c0-12 32-12 32 0l4 32h8l-2-40c2-20-8-34-26-34z",
  "M50 17c-22 2-30 16-28 38l10 34h6l-6-30c12-8 28-8 40 0l-6 30h6l10-34c2-22-6-36-28-38z",
  "M34 20 Q50 12 66 20 Q70 40 66 58 L62 92 h-8 l6-38 Q50 48 38 54 l6 38 h-8 L34 58 Q30 40 34 20z",
  "M50 16c-16 0-26 12-24 32l2 44h7l-2-36c10-6 30-6 40 0l-2 36h7l2-44c2-20-8-32-24-32z",
  "M50 15c-20 4-24 18-22 36l-8 38h8l6-28c8-10 32-10 40 0l6 28h8l-8-38c2-18 2-32-22-36z",
  "M28 24 Q50 10 72 24 Q76 50 72 70 L68 94 h-7 l4-28 Q50 52 36 66 l4 28 h-7 L28 70 Q24 50 28 24z",
  "M50 18c-14 0-24 10-22 28 L24 90 h8 l8-40c6-4 20-4 26 0l8 40 h8 L72 46c2-18-8-28-22-28z",
  "M50 14c-22 2-32 18-28 42l4 34h6l-2-30c8-14 32-14 40 0l-2 30h6l4-34c4-24-6-40-28-42z",
  "M40 19 Q50 11 60 19 Q64 36 62 52 L58 88 h-6 l4-32 Q50 56 44 56 l4 32 h-6 L38 52 Q36 36 40 19z",
  "M50 17 Q32 22 26 44 l-4 46 h7 l6-38 Q50 42 70 52 l6 38 h7 l-4 46 Q74 22 50 17z",
  "M50 16c-18 0-30 14-26 36l10 40h5l-8-34c6-8 32-8 38 0l-8 34h5l10-40c4-22-8-36-26-36z",
  "M34 22 Q50 14 66 22 L70 46 Q50 38 30 46 Z",
  "M50 15c-20 0-28 16-24 34l-6 42h7l4-32c8-10 28-10 36 0l4 32h7l-6-42c4-18-4-34-24-34z",
  "M30 26 Q50 8 70 26 Q74 48 68 62 L64 94 h-7 l4-28 Q50 50 38 64 l4 28 h-7 L32 62 Q26 48 30 26z",
  "M50 18c-12 0-22 8-20 26 l-12 46 h8 l8-34c4-6 24-6 28 0l8 34 h8 L70 44c2-18-8-26-20-26z",
  "M42 17 Q50 9 58 17 Q62 40 58 60 L50 52 L42 60 Q38 40 42 17z",
  "M50 16 Q28 20 20 46 l6 44 h7 l-4-34c4-12 38-12 42 0l-4 34 h7 l6-44 Q72 20 50 16z",
  "M50 14c-16 0-28 12-26 34l2 48h7l2-40c8-8 30-8 38 0l2 40h7l2-48c2-22-10-34-26-34z",
  "M36 21 Q50 11 64 21 Q68 38 64 54 L60 90 h-6 l4-30 Q50 58 42 60 l4 30 h-6 L36 54 Q32 38 36 21z",
];

var FEMALE_SIL_FRONT = [
  "",
  '<path d="M38 44 Q50 38 62 44" fill="none" stroke="#__H__" stroke-width="5" stroke-linecap="round"/>',
  '<ellipse cx="50" cy="40" rx="22" ry="10" fill="#__H__"/>',
  "",
  '<path d="M32 42 Q50 34 68 42" fill="none" stroke="#__H__" stroke-width="6" stroke-linecap="round"/>',
  "",
  "",
  '<path d="M40 38 Q50 32 60 38" fill="none" stroke="#__H__" stroke-width="5" stroke-linecap="round"/>',
  "",
  '<ellipse cx="50" cy="39" rx="20" ry="9" fill="#__H__"/>',
  "",
  "",
  '<path d="M36 41 Q50 33 64 41" fill="none" stroke="#__H__" stroke-width="5" stroke-linecap="round"/>',
  "",
  "",
  "",
  "",
  '<path d="M34 43 Q50 35 66 43" fill="none" stroke="#__H__" stroke-width="5" stroke-linecap="round"/>',
  '<ellipse cx="50" cy="38" rx="21" ry="8" fill="#__H__"/>',
  "",
  '<path d="M39 40 Q50 34 61 40" fill="none" stroke="#__H__" stroke-width="5" stroke-linecap="round"/>',
];

function eyeGroup(eye) {
  var e = eye || "dd";
  if (e === "ll") {
    return (
      '<line x1="41" y1="52" x2="46" y2="52" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>' +
      '<line x1="54" y1="52" x2="59" y2="52" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>'
    );
  }
  if (e === "wk") {
    return (
      '<line x1="40" y1="52" x2="46" y2="52" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M54 52 Q57 47 60 52" fill="none" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>'
    );
  }
  return '<circle cx="43" cy="52" r="2.2" fill="#1e293b"/><circle cx="57" cy="52" r="2.2" fill="#1e293b"/>';
}

/** @param {AvatarPreset} cfg */
function buildAvatar(cfg) {
  var female = !!cfg.female;
  var sil = typeof cfg.sil === "number" ? cfg.sil % 20 : 0;
  var dBack = female ? FEMALE_SIL_BACK[sil] : MALE_SIL_BACK[sil];
  var frontTpl = female ? FEMALE_SIL_FRONT[sil] : MALE_SIL_FRONT[sil];
  var hairHex = cfg.hair;
  var hairBack = '<path d="' + dBack + '" fill="#' + hairHex + '"/>';
  var hairFront = frontTpl ? frontTpl.split("__H__").join(hairHex) : "";

  var bandEl = "";
  if (cfg.band) {
    bandEl =
      '<path d="M28 40 Q50 32 72 40" fill="none" stroke="#' +
      cfg.band +
      '" stroke-width="6" stroke-linecap="round"/>';
  }
  var bowEl = "";
  if (female && cfg.bow) {
    bowEl =
      '<path d="M68 34 l5 5 l-5 5 l-5-5z" fill="#fda4af" stroke="#fb7185" stroke-width="0.5"/>' +
      '<circle cx="68" cy="39" r="2.5" fill="#fb7185"/>';
  }
  var badgeEl = "";
  if (cfg.badge) {
    var b = String(cfg.badge);
    var fs = b.length > 1 ? 6 : 7;
    badgeEl =
      '<ellipse cx="50" cy="76" rx="7" ry="6" fill="#ffffff" opacity="0.93"/>' +
      '<text x="50" y="79" text-anchor="middle" font-size="' +
      fs +
      '" font-family="Segoe UI,system-ui,sans-serif" fill="#334155" font-weight="800">' +
      b +
      "</text>";
  }
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="128" height="128">' +
    '<circle cx="50" cy="50" r="50" fill="#' +
    cfg.bg +
    '"/>' +
    hairBack +
    bandEl +
    bowEl +
    '<ellipse cx="50" cy="50" rx="21" ry="23" fill="#' +
    cfg.skin +
    '"/>' +
    hairFront +
    '<path d="M35 44 Q40 40 45 44" fill="none" stroke="#9a6b47" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>' +
    '<path d="M55 44 Q60 40 65 44" fill="none" stroke="#9a6b47" stroke-width="1.2" stroke-linecap="round" opacity="0.65"/>' +
    eyeGroup(cfg.eye) +
    '<path d="M45 63 Q50 66 55 63" fill="none" stroke="#1e293b" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M18 92 Q50 62 82 92 L82 100 L18 100 Z" fill="#' +
    cfg.shirt +
    '"/>' +
    badgeEl +
    "</svg>"
  );
}

/** @type {AvatarPreset[]} */
var MALE_PRESETS = [
  { bg: "ffd5dc", hair: "57534e", skin: "fde4d0", shirt: "ef4444", band: "3b82f6", eye: "wk", badge: "Y", sil: 0 },
  { bg: "bae6fd", hair: "44403c", skin: "ffedd5", shirt: "2563eb", eye: "dd", sil: 1 },
  { bg: "bbf7d0", hair: "292524", skin: "fde4d0", shirt: "16a34a", eye: "ll", badge: "1", sil: 2 },
  { bg: "fde68a", hair: "78350f", skin: "fed7aa", shirt: "c2410c", band: "0ea5e9", eye: "wk", sil: 3 },
  { bg: "e9d5ff", hair: "3f3f46", skin: "ffedd5", shirt: "7c3aed", eye: "dd", badge: "★", sil: 4 },
  { bg: "fed7aa", hair: "1c1917", skin: "fdba74", shirt: "0d9488", eye: "ll", sil: 5 },
  { bg: "cffafe", hair: "57534e", skin: "fef3c7", shirt: "0369a1", eye: "wk", badge: "A", sil: 6 },
  { bg: "fecaca", hair: "713f12", skin: "fed7aa", shirt: "b91c1c", eye: "dd", sil: 7 },
  { bg: "ddd6fe", hair: "78716c", skin: "fde4d0", shirt: "6366f1", band: "ec4899", eye: "ll", sil: 8 },
  { bg: "d1fae5", hair: "1c1917", skin: "ffedd5", shirt: "15803d", eye: "wk", badge: "2", sil: 9 },
  { bg: "fce7f3", hair: "854d0e", skin: "fdba74", shirt: "be185d", eye: "dd", sil: 10 },
  { bg: "a5f3fc", hair: "44403c", skin: "fef9c3", shirt: "0891b2", eye: "ll", sil: 11 },
  { bg: "fecdd3", hair: "292524", skin: "fdba74", shirt: "9d174d", eye: "wk", band: "fcd34d", sil: 12 },
  { bg: "e0e7ff", hair: "57534e", skin: "fde68a", shirt: "4f46e5", eye: "dd", sil: 13 },
  { bg: "ccfbf1", hair: "3f3f46", skin: "ffedd5", shirt: "0f766e", eye: "ll", badge: "T", sil: 14 },
  { bg: "fef3c7", hair: "44403c", skin: "fed7aa", shirt: "b45309", eye: "wk", sil: 15 },
  { bg: "fae8ff", hair: "57534e", skin: "fde4d0", shirt: "a21caf", band: "38bdf8", eye: "dd", sil: 16 },
  { bg: "dbeafe", hair: "78350f", skin: "fdba74", shirt: "1d4ed8", eye: "ll", sil: 17 },
  { bg: "ffedd5", hair: "1c1917", skin: "fdba74", shirt: "ea580c", eye: "wk", badge: "5", sil: 18 },
  { bg: "ecfccb", hair: "78716c", skin: "fef3c7", shirt: "65a30d", eye: "dd", sil: 19 },
];

/** @type {AvatarPreset[]} */
var FEMALE_PRESETS = [
  { bg: "ffd5dc", hair: "57534e", skin: "fff1f2", shirt: "e11d48", band: "3b82f6", eye: "wk", badge: "★", female: true, bow: true, sil: 0 },
  { bg: "ffcdf4", hair: "9d174d", skin: "ffe4e6", shirt: "db2777", eye: "dd", female: true, bow: true, sil: 1 },
  { bg: "fce7f3", hair: "831843", skin: "fff7ed", shirt: "9333ea", eye: "ll", female: true, sil: 2 },
  { bg: "e0f2fe", hair: "ca8a04", skin: "fef3c7", shirt: "0284c7", eye: "wk", female: true, badge: "Y", sil: 3 },
  { bg: "fef3c7", hair: "854d0e", skin: "fde68a", shirt: "ca8a04", eye: "dd", female: true, bow: true, sil: 4 },
  { bg: "dbeafe", hair: "5b21b6", skin: "fef9c3", shirt: "4f46e5", eye: "ll", female: true, sil: 5 },
  { bg: "ccfbf1", hair: "166534", skin: "ecfccb", shirt: "0d9488", eye: "wk", female: true, sil: 6 },
  { bg: "fecdd3", hair: "9f1239", skin: "fff1f2", shirt: "e11d48", eye: "dd", female: true, bow: true, sil: 7 },
  { bg: "ede9fe", hair: "6d28d9", skin: "fef3c7", shirt: "7c3aed", eye: "ll", female: true, sil: 8 },
  { bg: "cffafe", hair: "0e7490", skin: "fff7ed", shirt: "0891b2", eye: "wk", female: true, sil: 9 },
  { bg: "fce4ec", hair: "be185d", skin: "fff1f2", shirt: "db2777", eye: "dd", female: true, sil: 10 },
  { bg: "ecfccb", hair: "3f6212", skin: "fef9c3", shirt: "4d7c0f", eye: "ll", female: true, bow: true, sil: 11 },
  { bg: "fef9c3", hair: "b45309", skin: "fde68a", shirt: "d97706", eye: "wk", female: true, sil: 12 },
  { bg: "f3e8ff", hair: "7e22ce", skin: "ffedd5", shirt: "9333ea", eye: "dd", female: true, sil: 13 },
  { bg: "ffedd5", hair: "c2410c", skin: "fed7aa", shirt: "ea580c", eye: "ll", female: true, sil: 14 },
  { bg: "dbeafe", hair: "1d4ed8", skin: "fff7ed", shirt: "2563eb", eye: "wk", female: true, bow: true, sil: 15 },
  { bg: "fce7f3", hair: "a21caf", skin: "ffe4e6", shirt: "c026d3", eye: "dd", female: true, badge: "2", sil: 16 },
  { bg: "d1fae5", hair: "047857", skin: "ecfdf5", shirt: "059669", eye: "ll", female: true, sil: 17 },
  { bg: "fee2e2", hair: "b91c1c", skin: "fff1f2", shirt: "dc2626", eye: "wk", female: true, bow: true, sil: 18 },
  { bg: "e0e7ff", hair: "4338ca", skin: "fef9c3", shirt: "4f46e5", eye: "dd", female: true, sil: 19 },
];

export var YKS_CARTOON_AVATAR_MALE = MALE_PRESETS.map(function (c) {
  return svgToDataUrl(buildAvatar(Object.assign({ female: false }, c)));
});

export var YKS_CARTOON_AVATAR_FEMALE = FEMALE_PRESETS.map(function (c) {
  return svgToDataUrl(buildAvatar(Object.assign({ female: true }, c)));
});
