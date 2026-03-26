/**
 * YKS Koçluk — 40 adet tutarlı minimalist “çizgi film” avatar (20 Erkek, 20 Kadın).
 * Pastel daire zemin, düz SVG; Dicebear / dış API yok.
 */

function svgToDataUrl(svg) {
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg.replace(/\s+/g, " ").trim());
}

/**
 * @param {object} cfg
 * @param {string} cfg.bg
 * @param {string} cfg.hair
 * @param {string} cfg.skin
 * @param {string} cfg.shirt
 * @param {string} [cfg.band] — şerit rengi (hex, # yok) veya boş
 * @param {'dd'|'ll'|'wk'} cfg.eye
 * @param {string} [cfg.badge] — göğüste tek harf / rakam
 * @param {boolean} [cfg.female]
 * @param {boolean} [cfg.bow]
 * @param {number} [cfg.hairRx]
 * @param {number} [cfg.hairRy]
 * @param {number} [cfg.hairCy]
 */
function buildAvatar(cfg) {
  var eye = cfg.eye || "dd";
  var eyes = "";
  if (eye === "dd") {
    eyes =
      '<circle cx="43" cy="52" r="2.2" fill="#1e293b"/><circle cx="57" cy="52" r="2.2" fill="#1e293b"/>';
  } else if (eye === "ll") {
    eyes =
      '<line x1="40" y1="52" x2="46" y2="52" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>' +
      '<line x1="54" y1="52" x2="60" y2="52" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>';
  } else {
    eyes =
      '<line x1="40" y1="52" x2="46" y2="52" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>' +
      '<path d="M54 52 Q57 47 60 52" fill="none" stroke="#1e293b" stroke-width="2" stroke-linecap="round"/>';
  }
  var bandEl = "";
  if (cfg.band) {
    bandEl =
      '<path d="M28 40 Q50 32 72 40" fill="none" stroke="#' +
      cfg.band +
      '" stroke-width="6" stroke-linecap="round"/>';
  }
  var bowEl = "";
  if (cfg.female && cfg.bow) {
    bowEl =
      '<path d="M67 36 l5 5 l-5 5 l-5-5z" fill="#fda4af" stroke="#fb7185" stroke-width="0.5"/>';
  }
  var badgeEl = "";
  if (cfg.badge) {
    badgeEl =
      '<ellipse cx="50" cy="76" rx="7" ry="6" fill="#ffffff" opacity="0.93"/>' +
      '<text x="50" y="79" text-anchor="middle" font-size="7" font-family="Segoe UI,system-ui,sans-serif" fill="#334155" font-weight="800">' +
      cfg.badge +
      "</text>";
  }
  var rx = cfg.hairRx != null ? cfg.hairRx : 30;
  var ry = cfg.hairRy != null ? cfg.hairRy : 26;
  var hcy = cfg.hairCy != null ? cfg.hairCy : 36;
  return (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="128" height="128">' +
    '<circle cx="50" cy="50" r="50" fill="#' +
    cfg.bg +
    '"/>' +
    '<ellipse cx="50" cy="' +
    hcy +
    '" rx="' +
    rx +
    '" ry="' +
    ry +
    '" fill="#' +
    cfg.hair +
    '"/>' +
    bandEl +
    bowEl +
    '<ellipse cx="50" cy="50" rx="21" ry="23" fill="#' +
    cfg.skin +
    '"/>' +
    '<path d="M35 44 Q40 40 45 44" fill="none" stroke="#9a6b47" stroke-width="1.4" stroke-linecap="round"/>' +
    '<path d="M55 44 Q60 40 65 44" fill="none" stroke="#9a6b47" stroke-width="1.4" stroke-linecap="round"/>' +
    eyes +
    '<line x1="50" y1="56" x2="50" y2="59" stroke="#1e293b" stroke-width="1.2" stroke-linecap="round"/>' +
    '<path d="M45 63 Q50 66 55 63" fill="none" stroke="#1e293b" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M18 92 Q50 62 82 92 L82 100 L18 100 Z" fill="#' +
    cfg.shirt +
    '"/>' +
    badgeEl +
    "</svg>"
  );
}

/** @type {Partial<Parameters<typeof buildAvatar>[0]>[]} */
var MALE_PRESETS = [
  { bg: "ffd5dc", hair: "d4a574", skin: "fde4d0", shirt: "ef4444", band: "3b82f6", eye: "wk", badge: "Y" },
  { bg: "bae6fd", hair: "78716c", skin: "ffedd5", shirt: "2563eb", eye: "dd", badge: "" },
  { bg: "bbf7d0", hair: "3f3f46", skin: "fde4d0", shirt: "16a34a", eye: "ll", badge: "1" },
  { bg: "fde68a", hair: "a16207", skin: "fed7aa", shirt: "c2410c", band: "0ea5e9", eye: "wk", badge: "" },
  { bg: "e9d5ff", hair: "57534e", skin: "ffedd5", shirt: "7c3aed", eye: "dd", badge: "★" },
  { bg: "fed7aa", hair: "1c1917", skin: "fdba74", shirt: "0d9488", eye: "ll", badge: "" },
  { bg: "cffafe", hair: "78716c", skin: "fef3c7", shirt: "0369a1", eye: "wk", badge: "A" },
  { bg: "fecaca", hair: "92400e", skin: "fed7aa", shirt: "b91c1c", eye: "dd", badge: "" },
  { bg: "ddd6fe", hair: "44403c", skin: "fde4d0", shirt: "6366f1", band: "f472b6", eye: "ll", badge: "" },
  { bg: "d1fae5", hair: "3f3f46", skin: "ffedd5", shirt: "15803d", eye: "wk", badge: "2" },
  { bg: "fce7f3", hair: "854d0e", skin: "fdba74", shirt: "be185d", eye: "dd", badge: "" },
  { bg: "a5f3fc", hair: "57534e", skin: "fef9c3", shirt: "0891b2", eye: "ll", badge: "" },
  { bg: "fecdd3", hair: "292524", skin: "fdba74", shirt: "9d174d", eye: "wk", band: "fcd34d", badge: "" },
  { bg: "e0e7ff", hair: "713f12", skin: "fde68a", shirt: "4f46e5", eye: "dd", badge: "" },
  { bg: "ccfbf1", hair: "3f3f46", skin: "ffedd5", shirt: "0f766e", eye: "ll", badge: "T" },
  { bg: "fef3c7", hair: "57534e", skin: "fed7aa", shirt: "b45309", eye: "wk", badge: "" },
  { bg: "fae8ff", hair: "44403c", skin: "fde4d0", shirt: "a21caf", band: "38bdf8", eye: "dd", badge: "" },
  { bg: "dbeafe", hair: "78350f", skin: "fdba74", shirt: "1d4ed8", eye: "ll", badge: "" },
  { bg: "ffedd5", hair: "1c1917", skin: "fdba74", shirt: "ea580c", eye: "wk", badge: "5" },
  { bg: "ecfccb", hair: "78716c", skin: "fef3c7", shirt: "65a30d", eye: "dd", badge: "" },
];

/** @type {Partial<Parameters<typeof buildAvatar>[0]>[]} */
var FEMALE_PRESETS = [
  { bg: "ffd5dc", hair: "e8d4c4", skin: "fff1f2", shirt: "e11d48", band: "3b82f6", eye: "wk", badge: "★", female: true },
  { bg: "ffcdf4", hair: "f9a8d4", skin: "ffe4e6", shirt: "db2777", eye: "dd", female: true, bow: true, badge: "" },
  { bg: "fce7f3", hair: "fda4af", skin: "fff7ed", shirt: "a855f7", eye: "ll", female: true, hairRy: 30, hairCy: 34, badge: "" },
  { bg: "e0f2fe", hair: "fcd34d", skin: "fef3c7", shirt: "0284c7", eye: "wk", female: true, badge: "★" },
  { bg: "fef3c7", hair: "854d0e", skin: "fde68a", shirt: "ca8a04", eye: "dd", female: true, bow: true, badge: "" },
  { bg: "dbeafe", hair: "c4b5fd", skin: "fef9c3", shirt: "4f46e5", eye: "ll", female: true, hairRx: 32, badge: "" },
  { bg: "ccfbf1", hair: "86efac", skin: "ecfccb", shirt: "0d9488", eye: "wk", female: true, badge: "" },
  { bg: "fecdd3", hair: "fb7185", skin: "fff1f2", shirt: "e11d48", eye: "dd", female: true, bow: true, badge: "Y" },
  { bg: "ede9fe", hair: "ddd6fe", skin: "fef3c7", shirt: "7c3aed", eye: "ll", female: true, badge: "" },
  { bg: "cffafe", hair: "67e8f9", skin: "fff7ed", shirt: "0e7490", eye: "wk", female: true, hairRy: 29, badge: "" },
  { bg: "fce4ec", hair: "f472b6", skin: "fff1f2", shirt: "be185d", eye: "dd", female: true, badge: "" },
  { bg: "ecfccb", hair: "a3e635", skin: "fef9c3", shirt: "4d7c0f", eye: "ll", female: true, bow: true, badge: "" },
  { bg: "fef9c3", hair: "f59e0b", skin: "fde68a", shirt: "d97706", eye: "wk", female: true, badge: "" },
  { bg: "f3e8ff", hair: "e9d5ff", skin: "ffedd5", shirt: "9333ea", eye: "dd", female: true, badge: "" },
  { bg: "ffedd5", hair: "fb923c", skin: "fed7aa", shirt: "ea580c", eye: "ll", female: true, hairRx: 33, badge: "" },
  { bg: "dbeafe", hair: "93c5fd", skin: "fff7ed", shirt: "2563eb", eye: "wk", female: true, bow: true, badge: "" },
  { bg: "fce7f3", hair: "fbcfe8", skin: "ffe4e6", shirt: "c026d3", eye: "dd", female: true, badge: "2" },
  { bg: "d1fae5", hair: "6ee7b7", skin: "ecfdf5", shirt: "059669", eye: "ll", female: true, badge: "" },
  { bg: "fee2e2", hair: "fca5a5", skin: "fff1f2", shirt: "dc2626", eye: "wk", female: true, bow: true, badge: "" },
  { bg: "e0e7ff", hair: "a5b4fc", skin: "fef9c3", shirt: "4338ca", eye: "dd", female: true, badge: "" },
];

export var YKS_CARTOON_AVATAR_MALE = MALE_PRESETS.map(function (c) {
  return svgToDataUrl(buildAvatar(Object.assign({ female: false }, c)));
});

export var YKS_CARTOON_AVATAR_FEMALE = FEMALE_PRESETS.map(function (c) {
  return svgToDataUrl(buildAvatar(Object.assign({ female: true }, c)));
});
