#!/usr/bin/env node
/**
 * Türkiye üniversite + bölüm listesi → src/data/yks-data.json
 * Appwrite'a GÖNDERMEZ. Sadece dosya yazar.
 *
 * Birincil kaynak (önerilen): data/_uniturkiye-university.json + data/_uniturkiye-departments.json
 *   (github.com/tuncaydamlar/uniturkiye — YÖK üniversite/fakülte/bölüm ağacı; ~20k bölüm satırı)
 *
 * Yedek: data/_turkiye-uni-raw.json (ertanyildiz/turkiye-universite-bolum-json) — uniturkiye yoksa
 * Şehir/kurum (yedek modda): province-universities.json, vakif-uni-names.json, uni-city-manual.json
 *
 * ornekSiralama: YÖK Atlas yerleştirme sırası DEĞİLDİR; arayüz filtresi için deterministik örnek değer.
 */
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const RAW = path.join(ROOT, "data", "_turkiye-uni-raw.json");
const UNITURKIYE_UNI = path.join(ROOT, "data", "_uniturkiye-university.json");
const UNITURKIYE_DEP = path.join(ROOT, "data", "_uniturkiye-departments.json");
const OUT = path.join(ROOT, "src", "data", "yks-data.json");
const PROVINCE_PATH = path.join(ROOT, "data", "province-universities.json");
const VAKIF_NAMES_PATH = path.join(ROOT, "data", "vakif-uni-names.json");
const CITY_MANUAL_PATH = path.join(ROOT, "data", "uni-city-manual.json");

/** Yalnızca ertanyildiz yedek modunda: ham listede eksik kalan gerçek programlar */
const PROGRAM_OVERRIDES_LEGACY = [
  { uniName: "Haliç Üniversitesi", programName: "Dijital Oyun Tasarımı", scoreType: "SAY", alanKey: "sayisal" },
];

function hashStr(s) {
  let h = 0;
  const str = String(s || "");
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}

function normSpaced(s) {
  return String(s || "")
    .toLocaleLowerCase("tr")
    .replace(/[^a-z0-9ğüşıöçİiIı]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function provinceToDisplay(code) {
  const s = String(code || "").trim();
  if (!s) return "";
  return s
    .split(/\s+/)
    .map(function (w) {
      return w ? w.charAt(0).toLocaleUpperCase("tr") + w.slice(1).toLocaleLowerCase("tr") : "";
    })
    .join(" ");
}

function safeEndsWith(whole, suffix) {
  if (!whole.endsWith(suffix)) return false;
  if (whole.length === suffix.length) return true;
  const i = whole.length - suffix.length;
  return whole.charAt(i - 1) === " ";
}

function loadProvinceFlat() {
  if (!fs.existsSync(PROVINCE_PATH)) return [];
  try {
    const prov = JSON.parse(fs.readFileSync(PROVINCE_PATH, "utf8"));
    const flat = [];
    if (!Array.isArray(prov)) return [];
    prov.forEach(function (block) {
      const city = provinceToDisplay(block.province);
      const unis = block.universities;
      if (!Array.isArray(unis)) return;
      unis.forEach(function (u) {
        const name = String(u.name || "").trim();
        if (!name) return;
        flat.push({ city: city, key: normSpaced(name) });
      });
    });
    return flat;
  } catch (e) {
    console.warn("[build-yks-data] province-universities.json okunamadı:", e.message);
    return [];
  }
}

function findCityForUni(uniName, provinceFlat, cityManual) {
  const manual = cityManual && cityManual[uniName];
  if (manual) return manual;
  const r = normSpaced(uniName);
  if (!r) return "";
  const cands = provinceFlat.filter(function (f) {
    return f.key === r || safeEndsWith(f.key, r) || safeEndsWith(r, f.key);
  });
  if (cands.length === 0) return "";
  const exact = cands.find(function (c) {
    return c.key === r;
  });
  if (exact) return exact.city;
  cands.sort(function (a, b) {
    return b.key.length - a.key.length;
  });
  return cands[0].city;
}

function loadVakifWikiNames() {
  if (!fs.existsSync(VAKIF_NAMES_PATH)) return [];
  try {
    const arr = JSON.parse(fs.readFileSync(VAKIF_NAMES_PATH, "utf8"));
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function isVakifUni(uniName, vakifWikiNames) {
  const r = normSpaced(uniName);
  if (!r) return false;
  const extras = {
    "bilkent üniversitesi": true,
    "acıbadem mehmet ali aydınlar üniversitesi": true,
    "acıbadem üniversitesi": true,
    "bezm-i âlem vakıf üniversitesi": true,
    "bezmialem vakıf üniversitesi": true,
  };
  if (extras[r]) return true;
  for (let i = 0; i < vakifWikiNames.length; i++) {
    const w = vakifWikiNames[i];
    const wn = normSpaced(w);
    if (!wn) continue;
    if (wn === r) return true;
    if (safeEndsWith(wn, r) || safeEndsWith(r, wn)) return true;
  }
  return false;
}

function demoSiralama(programId) {
  const buf = crypto.createHash("sha256").update(String(programId)).digest();
  const n = buf.readUInt32BE(0) % 6999999 + 1;
  return n;
}

/** Üst veri kaynakları genelde UPPERCASE; görünen ad için */
function titleCaseTr(s) {
  return String(s)
    .trim()
    .toLocaleLowerCase("tr")
    .split(/\s+/)
    .map(function (w) {
      if (!w) return w;
      return w.charAt(0).toLocaleUpperCase("tr") + w.slice(1);
    })
    .join(" ");
}

function writeYksOutput(version, source, universities, programs) {
  universities.sort(function (a, b) {
    return String(a.uniName).localeCompare(String(b.uniName), "tr");
  });
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const compactPrograms = programs.map(function (p) {
    return Object.assign({}, p, {
      rowsJson: typeof p.rowsJson === "string" ? p.rowsJson : JSON.stringify(p.rowsJson),
    });
  });
  const outMin = {
    version: version,
    source: source,
    generatedAt: new Date().toISOString(),
    universities: universities,
    programs: compactPrograms,
  };
  const minified = JSON.stringify(outMin);
  fs.writeFileSync(OUT, minified, "utf8");
  const bytes = Buffer.byteLength(minified, "utf8");
  console.log("");
  console.log("✅ Yazıldı:", path.relative(ROOT, OUT));
  console.log("   Üniversite:", universities.length);
  console.log("   Program (bölüm):", programs.length);
  console.log("   Boyut:", Math.round(bytes / 1024) + " KB (minified tek satır JSON, Appwrite yok)");
  console.log("");
}

function buildFromUniturkiye() {
  const uniObj = JSON.parse(fs.readFileSync(UNITURKIYE_UNI, "utf8"));
  const depts = JSON.parse(fs.readFileSync(UNITURKIYE_DEP, "utf8"));
  if (!Array.isArray(depts)) {
    throw new Error("departments dizisi bekleniyor");
  }
  const universities = [];
  const uniByCode = Object.create(null);
  Object.keys(uniObj).forEach(function (code) {
    const u = uniObj[code];
    if (!u || !u.name) return;
    const uniName = titleCaseTr(String(u.name));
    const cityRaw = String(u.city || "").trim();
    const city = provinceToDisplay(cityRaw.replace(/\s+/g, " "));
    const uniType = String(u.type || "").toUpperCase() === "VAKIF" ? "vakıf" : "devlet";
    const id = "uni-" + code;
    const row = { id: id, uniName: uniName, city: city, uniType: uniType };
    universities.push(row);
    uniByCode[code] = row;
  });

  const seenProg = Object.create(null);
  const idxByCode = Object.create(null);
  const programs = [];
  for (let i = 0; i < depts.length; i++) {
    const d = depts[i];
    const code = d.universityCode;
    const u = uniByCode[code];
    if (!u) continue;
    const pnameRaw = String(d.name || "").trim();
    if (!pnameRaw) continue;
    const dedupKey = code + "\0" + normSpaced(pnameRaw);
    if (seenProg[dedupKey]) continue;
    seenProg[dedupKey] = true;

    const programName = titleCaseTr(pnameRaw);
    const n = (idxByCode[code] = (idxByCode[code] || 0) + 1);
    const { scoreType, alanKey } = inferPuan(programName);
    const { tt, ta } = targetsForProgram(programName, alanKey);
    const rowsJson = rowsForAlan(alanKey, tt, ta);
    const pid = progId(code, programName, n);
    programs.push({
      id: pid,
      uniId: u.id,
      programName: programName,
      scoreType: scoreType,
      alanKey: alanKey,
      targetTytNet: tt,
      targetAytNet: ta,
      rowsJson: rowsJson,
      ornekSiralama: demoSiralama(pid),
    });
  }

  writeYksOutput(
    4,
    "YÖK üniversite/bölüm ağacı: github.com/tuncaydamlar/uniturkiye (kurumsal yapı). Hedef netler ve ornekSiralama şablondur; YÖK Atlas taban puanı / resmî yerleştirme sırası değildir.",
    universities,
    programs
  );
}

function slugifyUni(name) {
  let s = String(name || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/İ/g, "I")
    .replace(/ı/g, "i")
    .replace(/ğ/g, "g")
    .replace(/ü/g, "u")
    .replace(/ş/g, "s")
    .replace(/ö/g, "o")
    .replace(/ç/g, "c")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (!s) s = "uni";
  return s.slice(0, 72);
}

function progId(uniSlug, programName, idx) {
  const h = crypto.createHash("sha1").update(uniSlug + "\0" + programName + "\0" + idx).digest("hex");
  return "prog-" + h.slice(0, 16);
}

function targetsForProgram(programName, alanKey) {
  const h = hashStr(programName + "|" + alanKey);
  const tt = 30 + (h % 95) / 10;
  const ta = 24 + ((h >> 9) % 115) / 10;
  return { tt: Math.round(tt * 10) / 10, ta: Math.round(ta * 10) / 10 };
}

function sayRows(tt, ta) {
  const t = (n) => Math.round((Number(tt) + n) * 10) / 10;
  const a = (n) => Math.round((Number(ta) + n) * 10) / 10;
  return [
    { section: "TYT", name: "Türkçe", targetNet: t(0) },
    { section: "TYT", name: "Sosyal Bilimler", targetNet: t(-20) },
    { section: "TYT", name: "Temel Matematik", targetNet: t(-2) },
    { section: "TYT", name: "Fen Bilimleri", targetNet: t(-18) },
    { section: "AYT", name: "Matematik", targetNet: a(0) },
    { section: "AYT", name: "Fizik", targetNet: a(-26) },
    { section: "AYT", name: "Kimya", targetNet: a(-27) },
    { section: "AYT", name: "Biyoloji", targetNet: a(-27) },
  ];
}

function eaRows(tt, ta) {
  const t = (n) => Math.round((Number(tt) + n) * 10) / 10;
  const a = (n) => Math.round((Number(ta) + n) * 10) / 10;
  return [
    { section: "TYT", name: "Türkçe", targetNet: t(0) },
    { section: "TYT", name: "Sosyal Bilimler", targetNet: t(-20) },
    { section: "TYT", name: "Temel Matematik", targetNet: t(-2) },
    { section: "TYT", name: "Fen Bilimleri", targetNet: t(-18) },
    { section: "AYT", name: "Matematik", targetNet: a(0) },
    { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: a(-8) },
    { section: "AYT", name: "Tarih-1", targetNet: a(-22) },
    { section: "AYT", name: "Coğrafya-1", targetNet: a(-28) },
  ];
}

function sozelRows(tt, ta) {
  const t = (n) => Math.round((Number(tt) + n) * 10) / 10;
  const a = (n) => Math.round((Number(ta) + n) * 10) / 10;
  return [
    { section: "TYT", name: "Türkçe", targetNet: t(0) },
    { section: "TYT", name: "Sosyal Bilimler", targetNet: t(-20) },
    { section: "TYT", name: "Temel Matematik", targetNet: t(-2) },
    { section: "TYT", name: "Fen Bilimleri", targetNet: t(-18) },
    { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: a(-2) },
    { section: "AYT", name: "Tarih-1", targetNet: a(-12) },
    { section: "AYT", name: "Tarih-2", targetNet: a(-12) },
    { section: "AYT", name: "Coğrafya-1", targetNet: a(-18) },
    { section: "AYT", name: "Coğrafya-2", targetNet: a(-14) },
    { section: "AYT", name: "Felsefe Grubu", targetNet: a(-16) },
    { section: "AYT", name: "Din Kültürü", targetNet: a(-24) },
  ];
}

function dilRows(tt, ta) {
  const t = (n) => Math.round((Number(tt) + n) * 10) / 10;
  const a = (n) => Math.round((Number(ta) + n) * 10) / 10;
  return [
    { section: "TYT", name: "Türkçe", targetNet: t(0) },
    { section: "TYT", name: "Sosyal Bilimler", targetNet: t(-20) },
    { section: "TYT", name: "Temel Matematik", targetNet: t(-2) },
    { section: "TYT", name: "Fen Bilimleri", targetNet: t(-18) },
    { section: "AYT", name: "Yabancı Dil", targetNet: a(0) },
    { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: a(-10) },
    { section: "AYT", name: "Tarih-1", targetNet: a(-20) },
    { section: "AYT", name: "Coğrafya-1", targetNet: a(-26) },
  ];
}

function inferPuan(programName) {
  const n = String(programName || "").toLocaleLowerCase("tr");

  if (
    /yabancı\s*dil|ingiliz\s*dil|almanca|fransızca|rusça|mütercim|çevirmenlik|modern\s*diller|dil ve edebiyat|İngiliz Dili ve Edebiyatı/i.test(
      programName
    ) ||
    (/dil ve edebiyat|İngiliz/i.test(programName) && !/bilgisayar/i.test(n))
  ) {
    return { scoreType: "DİL", alanKey: "dil" };
  }

  if (
    /hukuk|sosyoloji|tarih\s*\(|felsefe|psikoloji|gazetecilik|sanat|müzik|resim|heykel|sinema|televizyon|arkeoloji|antropoloji|coğrafya\s*\(sözel|ilahiyat|teoloji|İslami|Arapça|Farsça/i.test(
      programName
    ) &&
    !/mühendislik|tıp|fakültesi\s*\(s/i.test(n)
  ) {
    return { scoreType: "SÖZ", alanKey: "sozel" };
  }

  if (
    /işletme|ekonomi|iktisat|maliye|uluslararası\s*ticaret|bankacılık|kamu\s*yönetimi|siyaset\s*bilimi|uluslararası\s*i̇lişkiler|uluslararası ilişkiler|çalışma\s*ekonomisi|eşit\s*ağırlık/i.test(
      n
    )
  ) {
    return { scoreType: "EA", alanKey: "esit_agirlik" };
  }

  return { scoreType: "SAY", alanKey: "sayisal" };
}

function rowsForAlan(alanKey, tt, ta) {
  switch (alanKey) {
    case "dil":
      return dilRows(tt, ta);
    case "sozel":
      return sozelRows(tt, ta);
    case "esit_agirlik":
      return eaRows(tt, ta);
    default:
      return sayRows(tt, ta);
  }
}

function buildFromErtanyildiz() {
  if (!fs.existsSync(RAW)) {
    console.error("Önce veri indirin: data/_turkiye-uni-raw.json (build script README)");
    process.exit(1);
  }
  const provinceFlat = loadProvinceFlat();
  let cityManual = {};
  if (fs.existsSync(CITY_MANUAL_PATH)) {
    try {
      cityManual = JSON.parse(fs.readFileSync(CITY_MANUAL_PATH, "utf8"));
    } catch (e) {}
  }
  const vakifWikiNames = loadVakifWikiNames();

  const rawText = fs.readFileSync(RAW, "utf8").replace(/^\uFEFF/, "");
  const root = JSON.parse(rawText);
  const list = root.universities;
  if (!Array.isArray(list)) {
    console.error("Beklenen: { universities: [...] }");
    process.exit(1);
  }

  const universities = [];
  const programs = [];
  const seenUniSlug = Object.create(null);

  list.forEach(function (u) {
    const uniName = String(u.name || "").trim();
    if (!uniName) return;
    let baseSlug = slugifyUni(uniName);
    if (seenUniSlug[baseSlug]) {
      seenUniSlug[baseSlug] += 1;
      baseSlug = baseSlug + "-" + seenUniSlug[baseSlug];
    } else {
      seenUniSlug[baseSlug] = 1;
    }
    const uniId = "uni-" + baseSlug;
    const city = findCityForUni(uniName, provinceFlat, cityManual);
    const uniType = isVakifUni(uniName, vakifWikiNames) ? "vakıf" : "devlet";
    universities.push({ id: uniId, uniName: uniName, city: city, uniType: uniType });

    const deps = u.departments;
    const arr = Array.isArray(deps) ? deps : Object.values(deps || {});
    arr.forEach(function (dept, idx) {
      const programName = typeof dept === "string" ? dept.trim() : String(dept || "").trim();
      if (!programName) return;
      const { scoreType, alanKey } = inferPuan(programName);
      const { tt, ta } = targetsForProgram(programName, alanKey);
      const rowsJson = rowsForAlan(alanKey, tt, ta);
      const pid = progId(baseSlug, programName, idx);
      programs.push({
        id: pid,
        uniId: uniId,
        programName: programName,
        scoreType: scoreType,
        alanKey: alanKey,
        targetTytNet: tt,
        targetAytNet: ta,
        rowsJson: rowsJson,
        ornekSiralama: demoSiralama(pid),
      });
    });
  });

  const uniByName = Object.create(null);
  universities.forEach(function (u) {
    uniByName[u.uniName] = u;
  });

  PROGRAM_OVERRIDES_LEGACY.forEach(function (ov) {
    const u = uniByName[ov.uniName];
    if (!u) return;
    const exists = programs.some(function (p) {
      return p.uniId === u.id && p.programName === ov.programName;
    });
    if (exists) return;
    const baseSlug = u.id.replace(/^uni-/, "");
    const idx = programs.filter(function (p) {
      return p.uniId === u.id;
    }).length;
    const alanKey = ov.alanKey || inferPuan(ov.programName).alanKey;
    const scoreType = ov.scoreType || inferPuan(ov.programName).scoreType;
    const { tt, ta } = targetsForProgram(ov.programName, alanKey);
    const rowsJson = rowsForAlan(alanKey, tt, ta);
    const pid = progId(baseSlug, ov.programName, idx);
    programs.push({
      id: pid,
      uniId: u.id,
      programName: ov.programName,
      scoreType: scoreType,
      alanKey: alanKey,
      targetTytNet: tt,
      targetAytNet: ta,
      rowsJson: rowsJson,
      ornekSiralama: demoSiralama(pid),
    });
  });

  writeYksOutput(
    3,
    "Üniversite ve bölüm adları: github.com/ertanyildiz/turkiye-universite-bolum-json. Şehir: TR iller JSON + el ile tamamlama. Kurum türü: Vikipedi vakıf listesi + eşleştirme. Hedef netler ve ornekSiralama şablondur; YÖK Atlas taban puanı / yerleştirme sırası değildir.",
    universities,
    programs
  );
}

function main() {
  if (fs.existsSync(UNITURKIYE_UNI) && fs.existsSync(UNITURKIYE_DEP)) {
    console.log("Kaynak: uniturkiye (YÖK üniversite/bölüm ağacı — tuncaydamlar/uniturkiye)");
    try {
      buildFromUniturkiye();
    } catch (e) {
      console.error("[build-yks-data] uniturkiye hatası:", e.message || e);
      process.exit(1);
    }
    return;
  }
  console.log("Kaynak: ertanyildiz (yedek — data/_uniturkiye-*.json yok)");
  buildFromErtanyildiz();
}

main();
