/**
 * Tercih Sihirbazı — program türüne göre tek JSON: yok-atlas-lisans.json | yok-atlas-onlisans.json
 * (Scraper çıktısını src/data/ altına kopyalayın.)
 */
import { getHedefCatalogJsonUrlCandidates } from "./hedef-appwrite-catalog.js";

var DATA_SOURCES = {
  lisans: { file: "yok-atlas-lisans.json", tag: "lisans" },
  onlisans: { file: "yok-atlas-onlisans.json", tag: "onlisans" },
};

/** @type {object[]|null} */
var _tsFlatRows = null;

function trLower(s) {
  return String(s || "").toLocaleLowerCase("tr");
}

function parseSureYil(raw) {
  if (raw == null || raw === "") return NaN;
  var s = String(raw).trim().replace(/[^\d]/g, "");
  if (!s) return NaN;
  var n = parseInt(s, 10);
  return isFinite(n) ? n : NaN;
}

/** @param {{ Sure_Yil?: unknown }} row @param {string} sourceTag */
function inferProgramTuru(row, sourceTag) {
  if (sourceTag === "lisans") return "lisans";
  if (sourceTag === "onlisans") return "onlisans";
  var sy = parseSureYil(row && row.Sure_Yil);
  if (sy === 2) return "onlisans";
  if (isFinite(sy) && sy >= 4) return "lisans";
  if (isFinite(sy) && sy === 3) return "lisans";
  return "";
}

function isScrapedShape(raw) {
  if (!raw || typeof raw !== "object") return false;
  if (raw.Program_Kodu != null && String(raw.Program_Kodu).trim() !== "") return true;
  if (raw.Puan_Tipi != null && raw.Universite != null) return true;
  if (raw.Sure_Yil != null && String(raw.Sure_Yil).trim() !== "") return true;
  return false;
}

/** @type {Record<string, true>} */
var TS_PRIVATE_UNI_KEYS = (function () {
  var names = [
    "KOÇ",
    "İSTANBUL MEDİPOL",
    "MEDİPOL",
    "İHSAN DOĞRAMACI BİLKENT",
    "BİLKENT",
    "BAHÇEŞEHİR",
    "ÖZYEĞİN",
    "SABANCI",
    "YEDİTEPE",
    "ÜSKÜDAR",
    "BEYKENT",
    "KADİR HAS",
    "İSTİNYE",
    "ACIBADEM",
    "LOKMAN HEKİM",
    "NİŞANTAŞI",
    "ALTINBAŞ",
    "ATLAS",
    "BEYKOZ",
    "İSTANBUL AREL",
    "İSTANBUL GELİŞİM",
    "KENT",
    "KTO KARATAY",
    "PİRİ REİS",
    "TOBB ETÜ",
    "UFUK",
    "YENİ YÜZYIL",
    "İSTANBUL ESENYURT",
    "İSTANBUL MEDENİYET",
    "İSTANBUL RUMELİ",
    "İSTANBUL SAĞLIK",
    "İSTANBUL TOPKAPI",
    "MALTEPE",
    "OKAN",
    "ÖZEL ONBEŞ KASIM",
    "SANKO",
    "TED",
    "TİCARET",
    "TORKU",
    "TÖMER",
    "TÜRKİSTAN",
    "ULUSLARARASI FİNAL",
    "UNİVERSİTE OF ADANA",
    "YAŞAR",
    "HALİÇ",
    "KEMERBURGAZ",
    "İSTANBUL AYDIN",
    "İSTANBUL BİLGİ",
    "İSTANBUL KENT",
    "İSTANBUL ŞİŞLİ",
    "İSTANBUL TİCARET",
  ];
  var o = Object.create(null);
  for (var i = 0; i < names.length; i++) {
    o[names[i].toLocaleUpperCase("tr-TR")] = true;
  }
  return o;
})();

/**
 * JSON'da UniversiteTuru yoksa kaba tahmin (filtre + rozet; resmi değildir).
 * @param {Record<string, unknown>} r
 */
function inferUniversiteTuruHeuristic(r) {
  var blob = [r.Universite, r.Fakulte_YO, r.Sehir]
    .map(function (x) {
      return trLower(String(x || ""));
    })
    .join(" ");
  if (
    /kıbrıs|kibris|kktc|lefkoşa|lefkosa|gazimağusa|gazimagusa|girne|yakın doğu|yakin dogu|near east|uluslararası\s+final|final\s+üniversitesi|final\s+universitesi/.test(
      blob
    )
  ) {
    return "Kıbrıs Üniversitesi";
  }
  var uni = String(r.Universite || "").trim();
  if (!uni) return "";
  var uniUp = uni.toLocaleUpperCase("tr-TR");
  if (TS_PRIVATE_UNI_KEYS[uniUp]) return "Vakıf Üniversitesi";
  if (/\bVAK(I|İ)F\b/i.test(uni)) return "Vakıf Üniversitesi";
  if (
    uni.length <= 28 &&
    !/\b(üniversitesi|universitesi|üniv\.|üniversite)\b/i.test(uni) &&
    !/\b(teknik|fen[- ]?edebiyat|eğitim bilimleri)\b/i.test(trLower(uni))
  ) {
    if (
      /^(KOÇ|MEDİPOL|BAHÇEŞEHİR|ÖZYEĞİN|BİLKENT|SABANCI|YEDİTEPE|ACIBADEM|ÜSKÜDAR|BEYKENT|KADİR HAS|İSTİNYE|LOKMAN HEKİM)$/i.test(
        uni
      )
    ) {
      return "Vakıf Üniversitesi";
    }
  }
  if (/\b(üniversitesi|universitesi)\b/i.test(uni)) return "Devlet Üniversitesi";
  return "";
}

function resolveUniversiteTuruForRow(r) {
  var order = ["UniversiteTuru", "Universite_Turu", "UniversiteTipi", "Devlet_Vakif", "Kurum_Turu"];
  for (var i = 0; i < order.length; i++) {
    var v = r[order[i]];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return inferUniversiteTuruHeuristic(r);
}

function getSourceRow(row) {
  return row && row._source && typeof row._source === "object" ? row._source : row;
}

/** YÖK atlas satırından burs/ücret metni (Ek_Bilgi_1 çoğunlukla dil; burs genelde Ek_Bilgi_2 veya Burs alanında) */
function pickScrapedBursDurumu(r) {
  if (!r || typeof r !== "object") return "";
  var order = [
    "Burs",
    "Burs / Ücret Durumu",
    "Burs_Ucret_Durumu",
    "Ek_Bilgi_2",
    "Ek_Bilgi_1",
    "BursDurumu",
  ];
  for (var i = 0; i < order.length; i++) {
    var v = r[order[i]];
    if (v != null && String(v).trim() !== "") return String(v).trim();
  }
  return "";
}

function looksLikeBursOrUcretLabel(s) {
  var low = trLower(String(s || ""));
  if (!low) return false;
  return /burs|ücret|ucret|indirim|ücretsiz|ucretsiz|katkı|katki|harç|harc|tam\s*burs|yarı|yari|%\s*\d/.test(low);
}

/** Satırı şemaya göre normalize et (eski düz tablo) */
function normalizeFlatRow(raw, index) {
  var r = raw && typeof raw === "object" ? raw : {};
  var sy = r.Sure_Yil != null ? parseSureYil(r.Sure_Yil) : NaN;
  return {
    Universite: r.Universite != null ? String(r.Universite).trim() : "",
    Bolum: r.Bolum != null ? String(r.Bolum).trim() : "",
    UniversiteTuru: r.UniversiteTuru != null ? String(r.UniversiteTuru).trim() : "",
    BursDurumu: r.BursDurumu != null ? String(r.BursDurumu).trim() : "",
    PuanTuru: r.PuanTuru != null ? String(r.PuanTuru).trim() : "",
    Sehir: r.Sehir != null ? String(r.Sehir).trim() : "",
    Kontenjan: r.Kontenjan,
    TabanPuan: r.TabanPuan,
    BasariSirasi: r.BasariSirasi,
    Sure_Yil: isFinite(sy) ? sy : "",
    _programTuru: inferProgramTuru({ Sure_Yil: r.Sure_Yil }, "legacy"),
    _ix: index,
    _source: null,
  };
}

function normalizeScrapedRow(raw, index, sourceTag) {
  var r = raw && typeof raw === "object" ? raw : {};
  var sy = parseSureYil(r.Sure_Yil);
  var pt = "";
  if (sourceTag === "lisans") pt = "lisans";
  else if (sourceTag === "onlisans") pt = "onlisans";
  else pt = inferProgramTuru({ Sure_Yil: r.Sure_Yil }, "legacy");

  var uniTuru = resolveUniversiteTuruForRow(r);

  return {
    Universite: r.Universite != null ? String(r.Universite).trim() : "",
    Bolum: r.Bolum != null ? String(r.Bolum).trim() : "",
    UniversiteTuru: uniTuru,
    BursDurumu: pickScrapedBursDurumu(r),
    PuanTuru:
      r.Puan_Tipi != null
        ? String(r.Puan_Tipi).trim()
        : r.PuanTuru != null
          ? String(r.PuanTuru).trim()
          : "",
    Sehir: r.Sehir != null ? String(r.Sehir).trim() : "",
    Kontenjan: r.Kontenjan_2025_Genel != null ? r.Kontenjan_2025_Genel : r.Kontenjan,
    TabanPuan: r.Taban_Puani_Guncel != null ? r.Taban_Puani_Guncel : r.TabanPuan,
    BasariSirasi: r.Basari_Sirasi_Guncel != null ? r.Basari_Sirasi_Guncel : r.BasariSirasi,
    Sure_Yil: isFinite(sy) ? sy : "",
    _programTuru: pt,
    _ix: index,
    _source: r,
  };
}

function normalizeAnyRow(raw, index, sourceTag) {
  if (isScrapedShape(raw)) return normalizeScrapedRow(raw, index, sourceTag);
  return normalizeFlatRow(raw, index);
}

function fetchJsonBundle(entry) {
  var urls = getHedefCatalogJsonUrlCandidates(entry.file || "yok-atlas-lisans.json");
  var tag = entry.tag;
  function step(i) {
    if (i >= urls.length) return Promise.resolve({ rows: [], tag: tag });
    return fetch(urls[i], { cache: "no-store" })
      .then(function (res) {
        if (!res.ok) return step(i + 1);
        return res.json().then(function (data) {
          var arr = Array.isArray(data) ? data : data && data.rows ? data.rows : [];
          return { rows: arr, tag: tag };
        });
      })
      .catch(function () {
        return step(i + 1);
      });
  }
  return step(0);
}

/** @param {"lisans"|"onlisans"} programKey */
function loadTercihDataForProgram(programKey) {
  var key = programKey === "onlisans" ? "onlisans" : "lisans";
  var entry = DATA_SOURCES[key];
  if (!entry) {
    _tsFlatRows = [];
    return Promise.resolve();
  }
  return fetchJsonBundle(entry)
    .then(function (bundle) {
      var merged = [];
      var ix = 0;
      var rows = bundle.rows;
      var tag = bundle.tag;
      for (var i = 0; i < rows.length; i++) {
        merged.push(normalizeAnyRow(rows[i], ix++, tag));
      }
      _tsFlatRows = merged.filter(function (row) {
        return row.Universite || row.Bolum;
      });
    })
    .catch(function (e) {
      console.error("[Tercih Sihirbazı] Veri yüklenemedi:", e);
      _tsFlatRows = [];
      throw e;
    });
}

function getAllFlatRows() {
  return _tsFlatRows ? _tsFlatRows.slice() : [];
}

function uniqueSorted(values) {
  var s = Object.create(null);
  for (var i = 0; i < values.length; i++) {
    var v = values[i];
    if (v) s[v] = true;
  }
  return Object.keys(s).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
}

/**
 * Çapraz filtre: her eksen için diğer iki seçime göre benzersiz seçenekler (tek geçişte 3× tarama).
 * @param {object[]} rows
 * @param {{ city?: string, universite?: string, bolum?: string }} sel
 */
function buildCrossOptionSets(rows, sel) {
  var c0 = String((sel && sel.city) || "").trim();
  var u0 = String((sel && sel.universite) || "").trim();
  var b0 = String((sel && sel.bolum) || "").trim();
  var cityS = new Set();
  var uniS = new Set();
  var bolS = new Set();
  var i;
  var r;
  var sc;
  var u;
  var b;
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    sc = String(r.Sehir || "").trim();
    u = r.Universite || "";
    b = r.Bolum || "";
    if (u0 && u !== u0) continue;
    if (b0 && b !== b0) continue;
    if (sc) cityS.add(sc);
  }
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    sc = String(r.Sehir || "").trim();
    u = r.Universite || "";
    b = r.Bolum || "";
    if (c0 && sc !== c0) continue;
    if (b0 && b !== b0) continue;
    if (u) uniS.add(u);
  }
  for (i = 0; i < rows.length; i++) {
    r = rows[i];
    sc = String(r.Sehir || "").trim();
    u = r.Universite || "";
    b = r.Bolum || "";
    if (c0 && sc !== c0) continue;
    if (u0 && u !== u0) continue;
    if (b) bolS.add(b);
  }
  return {
    cities: uniqueSorted(Array.from(cityS)),
    unis: uniqueSorted(Array.from(uniS)),
    bolums: uniqueSorted(Array.from(bolS)),
  };
}

/**
 * Geçersiz kısımları temizle (ör. şehir değişince bölüm artık yoksa).
 * @param {object[]} rows
 * @param {{ city: string, universite: string, bolum: string }} sel
 */
function pruneGeoSelectionsAgainstRows(rows, sel) {
  var k;
  for (k = 0; k < 8; k++) {
    var o = buildCrossOptionSets(rows, sel);
    var bad = false;
    if (sel.city && o.cities.indexOf(sel.city) === -1) {
      sel.city = "";
      bad = true;
    }
    if (sel.universite && o.unis.indexOf(sel.universite) === -1) {
      sel.universite = "";
      bad = true;
    }
    if (sel.bolum && o.bolums.indexOf(sel.bolum) === -1) {
      sel.bolum = "";
      bad = true;
    }
    if (!bad) break;
  }
}

function canonPuanTuru(raw) {
  var x = String(raw || "")
    .trim()
    .toUpperCase()
    .replace(/İ/g, "I")
    .replace(/Ş/g, "S")
    .replace(/Ö/g, "O")
    .replace(/Ü/g, "U")
    .replace(/Ğ/g, "G")
    .replace(/Ç/g, "C");
  if (!x) return "";
  if (x === "SAY" || x === "SAYISAL") return "SAY";
  if (x === "EA" || x.indexOf("ESIT") !== -1 || x.indexOf("AGIRLIK") !== -1 || x.indexOf("EŞIT") !== -1) return "EA";
  if (x === "SOZ" || x === "SÖZ" || x.indexOf("SOZ") !== -1) return "SÖZ";
  if (x === "DIL" || x === "DİL") return "DİL";
  if (x === "TYT") return "TYT";
  return x;
}

function normUniTypeFilterValue(raw) {
  var t = trLower(String(raw || ""));
  if (t.indexOf("kıbrıs") !== -1 || t.indexOf("kibris") !== -1) return "kibris";
  if (t.indexOf("vakıf") !== -1 || t.indexOf("vakif") !== -1) return "vakıf";
  if (t.indexOf("devlet") !== -1) return "devlet";
  return "";
}

function rowMatchesUniType(row, selected) {
  if (!selected) return true;
  var got = normUniTypeFilterValue(row.UniversiteTuru);
  if (selected === "kibris") return got === "kibris";
  return got === selected;
}

function rowBursKey(row) {
  var raw = String(row.BursDurumu || "").trim();
  if (!raw) return "";
  var low = trLower(raw);
  if ((low.indexOf("tam") !== -1 && low.indexOf("burs") !== -1) || low === "burslu" || low.indexOf("tam burs") !== -1)
    return "tam_burslu";
  if (low.indexOf("50") !== -1 || low.indexOf("yarı") !== -1 || low.indexOf("yari") !== -1 || low.indexOf("indirim") !== -1)
    return "yari_indirim";
  if (low.indexOf("ücret") !== -1 || low.indexOf("ucret") !== -1) return "ucretli";
  if (low.indexOf("burs") !== -1 && low.indexOf("ücret") === -1 && low.indexOf("indirim") === -1) return "tam_burslu";
  return "";
}

function rowMatchesBurs(row, selected) {
  if (!selected) return true;
  var got = rowBursKey(row);
  if (!got) return true;
  return got === selected;
}

/** Lisans / önlisans filtresi (Sure_Yil + kaynak etiketi) */
function rowMatchesProgramTuru(row, selected) {
  if (!selected || selected === "hepsi") return true;
  var pt = row._programTuru || "";
  var sy = typeof row.Sure_Yil === "number" ? row.Sure_Yil : parseSureYil(row.Sure_Yil);

  if (selected === "lisans") {
    if (pt === "lisans") return true;
    if (pt === "onlisans") return false;
    if (isFinite(sy) && sy >= 4) return true;
    if (isFinite(sy) && sy <= 2) return false;
    return false;
  }
  if (selected === "onlisans") {
    if (pt === "onlisans") return true;
    if (pt === "lisans") return false;
    if (sy === 2) return true;
    return false;
  }
  return true;
}

function parseSiralamaInt(raw) {
  if (raw == null || raw === "") return NaN;
  var s = String(raw).trim();
  if (!s) return NaN;
  s = s.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, "");
  if (s === "") return NaN;
  var n = parseInt(s, 10);
  return isFinite(n) ? n : NaN;
}

function getBasariSirasiNum(row) {
  return parseSiralamaInt(row.BasariSirasi);
}

function getTabanPuanNum(row) {
  if (!row) return NaN;
  var v = row.TabanPuan;
  if (v == null || v === "") return NaN;
  if (typeof v === "number") return isFinite(v) ? v : NaN;
  var s = String(v).trim().replace(/\s/g, "");
  if (s === "" || s === "-") return NaN;
  var dotCount = (s.match(/\./g) || []).length;
  if (s.indexOf(",") >= 0) {
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (dotCount === 1) {
    return parseFloat(s);
  } else if (dotCount > 1) {
    s = s.replace(/\./g, "");
  }
  var n = parseFloat(s);
  return isFinite(n) ? n : NaN;
}

function topRowsByTabanDesc(rows, limit) {
  var lim = limit != null ? Math.max(1, Math.min(200, Number(limit))) : 50;
  var copy = rows.slice();
  copy.sort(function (a, b) {
    var ta = getTabanPuanNum(a);
    var tb = getTabanPuanNum(b);
    var fa = isFinite(ta);
    var fb = isFinite(tb);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return tb - ta;
  });
  return copy.slice(0, lim);
}

function formatIntTr(n) {
  var x = Number(n);
  if (!isFinite(x)) return "-";
  return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** Taban / başarı hücresi: anlamsız sıfır veya «kontenjan dolmadı» metinleri */
function isKontenjanDolmamisDeger(v) {
  if (v == null || v === "") return true;
  if (typeof v === "number" && v === 0) return true;
  var s = String(v).trim();
  if (s === "") return true;
  var low = trLower(s);
  if (low === "0" || low === "null" || low === "undefined") return true;
  if (/^0+[.,]?0*$/.test(s.replace(/\s/g, ""))) return true;
  if (low.indexOf("kontenjan") !== -1 && (low.indexOf("dolmam") !== -1 || low.indexOf("dolmad") !== -1)) return true;
  return false;
}

function isTabanPuanDolmamis(row) {
  if (!row) return true;
  if (isKontenjanDolmamisDeger(row.TabanPuan)) return true;
  var n = getTabanPuanNum(row);
  return isFinite(n) && n === 0;
}

function isBasariSirasiDolmamis(row) {
  if (!row) return true;
  if (isKontenjanDolmamisDeger(row.BasariSirasi)) return true;
  var n = getBasariSirasiNum(row);
  return isFinite(n) && n === 0;
}

var TS_KONTENJAN_SPAN =
  '<span class="text-gray-500 italic text-sm ts-kontenjan-dolmadi">Kontenjan Dolmadı</span>';

function formatTabanCellHtml(row) {
  if (isTabanPuanDolmamis(row)) return TS_KONTENJAN_SPAN;
  var inner = formatTabanCell(row);
  if (inner === "-" || inner === "0") return TS_KONTENJAN_SPAN;
  return escapeHtml(inner);
}

function formatBasariCellHtml(row) {
  if (isBasariSirasiDolmamis(row)) return TS_KONTENJAN_SPAN;
  var inner = formatBasariCell(row);
  if (inner === "-" || inner === "0") return TS_KONTENJAN_SPAN;
  return escapeHtml(inner);
}

var TS_CELL_NA = '<span class="ts-cell-na">—</span>';
var TS_CELL_DATA_MISSING =
  '<span class="ts-cell-na" title="Bu alan YÖK Atlas çıktısında yok">Veri yok</span>';

function isDashOrEmptyRaw(v) {
  if (v == null) return true;
  var s = String(v).trim();
  return s === "" || s === "-" || s === "—";
}

/** @param {Record<string, unknown>} src */
function parseTabanFromRawField(v) {
  if (isDashOrEmptyRaw(v)) return NaN;
  var t = { TabanPuan: v };
  return getTabanPuanNum(t);
}

/** @param {Record<string, unknown>} src */
function collectTabanNumsFromSource(src) {
  var keys = ["Taban_2023", "Taban_2024", "Taban_2025", "Taban_Puani_Guncel"];
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var n = parseTabanFromRawField(src[keys[i]]);
    if (isFinite(n)) out.push(n);
  }
  return out;
}

/** @param {Record<string, unknown>} src */
function collectBasariNumsFromSource(src) {
  var keys = ["Basari_2023", "Basari_2024", "Basari_2025", "Basari_Sirasi_Guncel"];
  var out = [];
  for (var i = 0; i < keys.length; i++) {
    var n = parseSiralamaInt(src[keys[i]]);
    if (isFinite(n)) out.push(n);
  }
  return out;
}

function minMax(nums) {
  if (!nums || !nums.length) return { min: NaN, max: NaN };
  var mn = nums[0];
  var mx = nums[0];
  for (var i = 1; i < nums.length; i++) {
    if (nums[i] < mn) mn = nums[i];
    if (nums[i] > mx) mx = nums[i];
  }
  return { min: mn, max: mx };
}

function formatTabanNumHtml(n) {
  if (!isFinite(n)) return TS_CELL_NA;
  var fake = { TabanPuan: n };
  return formatTabanCellHtml(fake);
}

function formatBasariNumHtml(n) {
  if (!isFinite(n)) return TS_CELL_NA;
  var fake = { BasariSirasi: n };
  return formatBasariCellHtml(fake);
}

/** @param {Record<string, unknown>} src @param {string} key */
function formatYearlyTabanHtml(src, key) {
  if (isDashOrEmptyRaw(src[key])) return TS_CELL_NA;
  var fake = { TabanPuan: src[key] };
  return formatTabanCellHtml(fake);
}

/** @param {Record<string, unknown>} src @param {string} key */
function formatYearlyBasariHtml(src, key) {
  if (isDashOrEmptyRaw(src[key])) return TS_CELL_NA;
  var fake = { BasariSirasi: src[key] };
  return formatBasariCellHtml(fake);
}

/** Dil rozeti: Ek_Bilgi_1 çoğunlukla öğretim dili */
function dilBadgeFromSource(src) {
  var e1 = src.Ek_Bilgi_1 != null ? String(src.Ek_Bilgi_1).trim() : "";
  if (!e1 || looksLikeBursOrUcretLabel(e1)) return "";
  return (
    '<span class="ts-badge ts-badge--lang" title="Öğretim dili / program notu">' +
    escapeHtml(e1) +
    "</span>"
  );
}

/** Üniversite hücresi: tür + dil rozeti (burs ayrı sütunda) */
function uniCellBadgesWithLang(row) {
  var src = getSourceRow(row);
  var parts = [uniTypeBadgeHtmlFromRow(row)];
  var lang = dilBadgeFromSource(src);
  if (lang) parts.push(lang);
  return '<div class="ts-uni-badges">' + parts.join("") + "</div>";
}

/** @param {Record<string, unknown>} src */
function formatYerlesmeCellHtml(src) {
  var keys = [
    "Yerlesme_Sayisi",
    "Yerleşme_Sayısı",
    "Yerlesen_Sayisi",
    "Yerleşen_Sayısı",
    "Yerlesen",
    "Yerleşen",
  ];
  for (var i = 0; i < keys.length; i++) {
    var v = src[keys[i]];
    if (!isDashOrEmptyRaw(v)) {
      var n = Number(String(v).replace(/\./g, "").replace(/\s/g, ""));
      if (isFinite(n)) return escapeHtml(formatIntTr(n));
    }
  }
  return TS_CELL_DATA_MISSING;
}

/** @param {Record<string, unknown>} src */
function formatKontenjanGenelDigerHtml(src) {
  var g = src.Kontenjan_2025_Genel != null ? src.Kontenjan_2025_Genel : "";
  var d = src.Kontenjan_Diger != null ? src.Kontenjan_Diger : "";
  return {
    genel: isDashOrEmptyRaw(g) ? TS_CELL_NA : escapeHtml(String(g).trim()),
    diger: isDashOrEmptyRaw(d) ? TS_CELL_NA : escapeHtml(String(d).trim()),
  };
}

function readStudentComparisonCtx(form) {
  if (!form) return { sira: NaN, puan: NaN };
  try {
    var fd = new FormData(form);
    var sr = String(fd.get("studentSira") || "")
      .replace(/\./g, "")
      .trim();
    var pr = String(fd.get("studentPuan") || "").trim();
    var sira = sr ? parseInt(sr, 10) : NaN;
    var puan = NaN;
    if (pr) {
      if (pr.indexOf(",") >= 0) {
        puan = parseFloat(pr.replace(/\./g, "").replace(",", "."));
      } else {
        puan = parseFloat(pr);
      }
    }
    return { sira: sira, puan: puan };
  } catch (e) {
    return { sira: NaN, puan: NaN };
  }
}

function formatKriterCellHtml(row, ctx) {
  var hasS = isFinite(ctx.sira);
  var hasP = isFinite(ctx.puan);
  if (!hasS && !hasP) {
    return (
      '<span class="ts-cell-muted" title="İsteğe bağlı: yerleşme sırası veya puan girin">—</span>'
    );
  }
  var msgs = [];
  var progSira = getBasariSirasiNum(row);
  var progPuan = getTabanPuanNum(row);
  if (hasS && isFinite(progSira) && !isBasariSirasiDolmamis(row)) {
    if (ctx.sira > progSira) {
      msgs.push('<span class="ts-kriter ts-kriter--bad">Sıra yetmiyor</span>');
    }
  }
  if (hasP && isFinite(progPuan) && !isTabanPuanDolmamis(row)) {
    if (ctx.puan + 1e-6 < progPuan) {
      msgs.push('<span class="ts-kriter ts-kriter--bad">Puan yetmiyor</span>');
    }
  }
  if (!msgs.length) {
    return '<span class="ts-kriter ts-kriter--ok">Uygun görünüyor</span>';
  }
  return msgs.join(" ");
}

function programCellHtml(row) {
  var src = getSourceRow(row);
  var bolum = row.Bolum || "—";
  var fak = src.Fakulte_YO != null ? String(src.Fakulte_YO).trim() : "";
  var ek = src.Ek_Isaret != null ? String(src.Ek_Isaret).trim() : "";
  var lines =
    '<span class="ts-prog-name ts-prog-name--primary">' + escapeHtml(bolum) + "</span>";
  if (fak) {
    lines +=
      '<span class="ts-fakulte-line">' +
      escapeHtml(fak) +
      (ek ? " <span class=\"ts-ek-isaret\" title=\"Ek işaret\">" + escapeHtml(ek) + "</span>" : "") +
      "</span>";
  }
  return lines;
}

function escapeAttr(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatKontenjanCell(row) {
  var v = row.Kontenjan;
  if (v == null || v === "") return "-";
  var n = Number(v);
  if (!isFinite(n)) return "-";
  return formatIntTr(n);
}

function formatTabanCell(row) {
  var n = getTabanPuanNum(row);
  if (!isFinite(n)) return "-";
  if (Math.abs(n - Math.round(n)) < 1e-9) return formatIntTr(Math.round(n));
  try {
    return n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 6 });
  } catch (e) {
    return String(n);
  }
}

function formatBasariCell(row) {
  var n = getBasariSirasiNum(row);
  return isFinite(n) ? formatIntTr(n) : "-";
}

function sortRowsByBasariAsc(rows) {
  rows.sort(function (a, b) {
    var sa = getBasariSirasiNum(a);
    var sb = getBasariSirasiNum(b);
    var fa = isFinite(sa);
    var fb = isFinite(sb);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return sa - sb;
  });
  return rows;
}

function filterFlatRows(rows, opts) {
  var minS = opts.minSiralama;
  var maxS = opts.maxSiralama;
  var puan = opts.puanTuru;
  var city = opts.city;
  var uniType = opts.uniType;
  var bursSel = opts.bursDurumu;
  var uniName = opts.universite;
  var bolumName = opts.bolum;
  var programTuru = opts.programTuru || "hepsi";
  var out = [];
  var rangeFilter = isFinite(minS) || isFinite(maxS);
  var puanCanon = puan ? canonPuanTuru(puan) : "";

  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (!rowMatchesProgramTuru(r, programTuru)) continue;
    var os = getBasariSirasiNum(r);
    if (rangeFilter) {
      if (!isFinite(os)) continue;
      if (isFinite(minS) && os < minS) continue;
      if (isFinite(maxS) && os > maxS) continue;
    }
    if (puanCanon) {
      var pc = canonPuanTuru(r.PuanTuru);
      if (pc !== puanCanon) continue;
    }
    if (uniName && r.Universite !== uniName) continue;
    if (bolumName && r.Bolum !== bolumName) continue;
    if (city && String(r.Sehir || "").trim() !== city) continue;
    if (!rowMatchesUniType(r, uniType)) continue;
    if (!rowMatchesBurs(r, bursSel)) continue;
    out.push(r);
  }
  return sortRowsByBasariAsc(out);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLoaderHtml() {
  return (
    '<div class="ts-loader-skin" role="status" aria-busy="true">' +
    '<div class="ts-loader-skin__spinner" aria-hidden="true"></div>' +
    '<p class="ts-loader-skin__text">Veriler yükleniyor…</p>' +
    "</div>"
  );
}

function showTableLoading(tableScroll, pagerEl, combinedPager) {
  if (!tableScroll) return;
  tableScroll._tsRows = null;
  tableScroll._tsAnimateNext = false;
  tableScroll.innerHTML = renderLoaderHtml();
  if (pagerEl && !combinedPager) pagerEl.innerHTML = "";
}

function uniTypeBadgeHtmlFromRow(row) {
  var ut = normUniTypeFilterValue(row.UniversiteTuru);
  var cls = "ts-badge ";
  if (ut === "vakıf") cls += "ts-badge--vakif";
  else if (ut === "devlet") cls += "ts-badge--devlet";
  else if (ut === "kibris") cls += "ts-badge--kibris";
  else cls += "ts-badge--muted";
  var label =
    ut === "vakıf" ? "Vakıf" : ut === "devlet" ? "Devlet" : ut === "kibris" ? "Kıbrıs" : escapeHtml(row.UniversiteTuru || "—");
  return '<span class="' + cls + '">' + label + "</span>";
}

function bursBadgeHtmlFromRow(row) {
  var k = rowBursKey(row);
  if (k === "tam_burslu") return '<span class="ts-badge ts-badge--burs-tam">Tam Burslu</span>';
  if (k === "yari_indirim") return '<span class="ts-badge ts-badge--burs-yari">%50 İndirimli</span>';
  if (k === "ucretli") return '<span class="ts-badge ts-badge--burs-ucret">Ücretli</span>';
  var raw = String(row.BursDurumu || "").trim();
  if (raw && looksLikeBursOrUcretLabel(raw)) {
    return '<span class="ts-badge ts-badge--muted">' + escapeHtml(raw) + "</span>";
  }
  return "";
}

function paintTablePage(tableScroll, pagerEl) {
  if (!tableScroll) return;
  var rows = tableScroll._tsRows;
  var pageSize = tableScroll._tsPageSize || 50;
  var page = tableScroll._tsPage || 1;
  var combined = !pagerEl || pagerEl === tableScroll;

  if (!rows || !rows.length) {
    tableScroll._tsAnimateNext = false;
    tableScroll.innerHTML =
      '<div class="ts-empty-state" role="status"><p class="ts-empty-state__text">Seçtiğiniz kriterlere uygun program bulunamadı.</p></div>';
    if (pagerEl && !combined) pagerEl.innerHTML = "";
    return;
  }

  var total = rows.length;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  tableScroll._tsPage = page;

  var start = (page - 1) * pageSize;
  var list = rows.slice(start, start + pageSize);
  var from = start + 1;
  var to = Math.min(start + pageSize, total);

  var anim = tableScroll._tsAnimateNext;
  tableScroll._tsAnimateNext = false;
  var rootCls = "ts-table-root" + (anim ? " ts-table-root--enter" : "");
  var studentCtx = readStudentComparisonCtx(tableScroll._tsFormEl || null);

  var thead =
    "<thead><tr>" +
    '<th class="ts-th-add" scope="col"><span class="ts-th-sr">İşlem</span></th>' +
    '<th class="ts-th-code" scope="col" title="Program kodu">Prg. kodu</th>' +
    '<th scope="col" title="Puan türü">Puan türü</th>' +
    '<th class="ts-th-burs" scope="col">Burs / ücret</th>' +
    '<th scope="col" title="Öğrenim süresi (yıl)">Süre</th>' +
    '<th scope="col" title="Devlet / vakıf / Kıbrıs (tahmin dahil)">Tür</th>' +
    '<th scope="col">Şehir</th>' +
    '<th class="ts-th-uni" scope="col">Üniversite</th>' +
    '<th class="ts-th-prog" scope="col">Program</th>' +
    '<th scope="col" title="Yerleşen sayısı (kaynakta varsa)">Yerleşme</th>' +
    '<th class="ts-num-cell" scope="col" title="Kontenjan genel (2025)">Kn. genel</th>' +
    '<th class="ts-num-cell" scope="col" title="Kontenjan diğer">Kn. diğer</th>' +
    '<th class="ts-num-cell" scope="col" title="Yıllar arası en düşük taban">Tbn. min</th>' +
    '<th class="ts-num-cell" scope="col" title="Yıllar arası en yüksek taban">Tbn. max</th>' +
    '<th class="ts-num-cell ts-th-year" scope="col">T \'23</th>' +
    '<th class="ts-num-cell ts-th-year" scope="col">T \'24</th>' +
    '<th class="ts-num-cell ts-th-year" scope="col">T \'25</th>' +
    '<th class="ts-num-cell" scope="col" title="En iyi (en küçük) başarı sırası">Sıra min</th>' +
    '<th class="ts-num-cell" scope="col" title="En kötü (en büyük) başarı sırası">Sıra max</th>' +
    '<th class="ts-num-cell ts-th-year" scope="col">S \'23</th>' +
    '<th class="ts-num-cell ts-th-year" scope="col">S \'24</th>' +
    '<th class="ts-num-cell ts-th-year" scope="col">S \'25</th>' +
    '<th scope="col">Akreditasyon</th>' +
    '<th class="ts-th-kosul" scope="col">Özel koşul</th>' +
    '<th class="ts-th-kriter" scope="col" title="Öğrenci sıra/puanına göre">Durum</th>' +
    "</tr></thead>";

  var tableHtml =
    '<div class="' +
    rootCls +
    '"><table class="ts-table ts-table--premium ts-table--yks ts-table--elite" role="grid">' +
    thead +
    "<tbody>";

  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var src = getSourceRow(row);
    var uniName = row.Universite || "—";
    var pk =
      src.Program_Kodu != null && String(src.Program_Kodu).trim() !== ""
        ? String(src.Program_Kodu).trim()
        : "—";
    var stDisp = row.PuanTuru ? String(row.PuanTuru).trim() : "—";
    var sure =
      src.Sure_Yil != null && String(src.Sure_Yil).trim() !== ""
        ? escapeHtml(String(src.Sure_Yil).trim())
        : TS_CELL_NA;
    var sehir = row.Sehir ? escapeHtml(row.Sehir) : TS_CELL_NA;
    var bursCol = bursBadgeHtmlFromRow(row);
    if (!bursCol) bursCol = '<span class="ts-cell-muted">—</span>';
    var uniTypeOnly = uniTypeBadgeHtmlFromRow(row);
    var tnums = collectTabanNumsFromSource(src);
    var tmm = minMax(tnums);
    var snums = collectBasariNumsFromSource(src);
    var smm = minMax(snums);
    var kd = formatKontenjanGenelDigerHtml(src);
    var ozel = src.Ozel_Kosul_Kodlari != null ? String(src.Ozel_Kosul_Kodlari).trim() : "";
    var ozelHtml = ozel
      ? '<span class="ts-ozel-kosul" title="Özel koşul kodları">' + escapeHtml(ozel) + "</span>"
      : TS_CELL_NA;

    tableHtml +=
      "<tr>" +
      '<td class="ts-cell-add">' +
      '<button type="button" class="ts-row-add-btn" data-ts-add="1" data-program-kodu="' +
      escapeAttr(pk) +
      '" title="Listeye ekle (yakında)">' +
      '<span class="ts-row-add-btn__icon" aria-hidden="true">+</span>' +
      '<span class="ts-th-sr">Ekle</span>' +
      "</button></td>" +
      '<td class="ts-num-cell ts-cell-mono">' +
      escapeHtml(pk) +
      "</td>" +
      "<td>" +
      escapeHtml(stDisp) +
      "</td>" +
      '<td class="ts-cell-burs">' +
      bursCol +
      "</td>" +
      '<td class="ts-num-cell">' +
      sure +
      "</td>" +
      "<td>" +
      uniTypeOnly +
      "</td>" +
      "<td>" +
      sehir +
      "</td>" +
      '<td class="ts-cell-uni">' +
      '<div class="ts-uni-stack">' +
      '<strong class="ts-uni-name">' +
      escapeHtml(uniName) +
      "</strong>" +
      uniCellBadgesWithLang(row) +
      "</div></td>" +
      '<td class="ts-cell-bolum">' +
      programCellHtml(row) +
      "</td>" +
      "<td>" +
      formatYerlesmeCellHtml(src) +
      "</td>" +
      '<td class="ts-num-cell">' +
      kd.genel +
      "</td>" +
      '<td class="ts-num-cell">' +
      kd.diger +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatTabanNumHtml(tmm.min) +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatTabanNumHtml(tmm.max) +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatYearlyTabanHtml(src, "Taban_2023") +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatYearlyTabanHtml(src, "Taban_2024") +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatYearlyTabanHtml(src, "Taban_2025") +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatBasariNumHtml(smm.min) +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatBasariNumHtml(smm.max) +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatYearlyBasariHtml(src, "Basari_2023") +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatYearlyBasariHtml(src, "Basari_2024") +
      "</td>" +
      '<td class="ts-num-cell">' +
      formatYearlyBasariHtml(src, "Basari_2025") +
      "</td>" +
      "<td>" +
      (src.Akreditasyon != null && String(src.Akreditasyon).trim() !== ""
        ? escapeHtml(String(src.Akreditasyon).trim())
        : TS_CELL_NA) +
      "</td>" +
      "<td>" +
      ozelHtml +
      "</td>" +
      "<td>" +
      formatKriterCellHtml(row, studentCtx) +
      "</td>" +
      "</tr>";
  }
  tableHtml += "</tbody></table></div>";

  var pagerHtml =
    '<div class="ts-pager">' +
    '<button type="button" class="ts-pager__btn" data-ts-act="prev"' +
    (page <= 1 ? " disabled" : "") +
    ">Önceki</button>" +
    '<span class="ts-pager__info">Sayfa ' +
    page +
    " / " +
    totalPages +
    " — " +
    formatIntTr(from) +
    "–" +
    formatIntTr(to) +
    " / " +
    formatIntTr(total) +
    "</span>" +
    '<button type="button" class="ts-pager__btn" data-ts-act="next"' +
    (page >= totalPages ? " disabled" : "") +
    ">Sonraki</button>" +
    "</div>";

  if (combined) {
    tableScroll.innerHTML = tableHtml + pagerHtml;
  } else {
    tableScroll.innerHTML = tableHtml;
    pagerEl.innerHTML = pagerHtml;
  }
}

function renderTableWithPagination(tableScroll, pagerEl, rows, pageSize) {
  if (!tableScroll) return;
  pageSize = pageSize || 50;
  tableScroll._tsRows = rows;
  tableScroll._tsPageSize = pageSize;
  tableScroll._tsPage = 1;
  paintTablePage(tableScroll, pagerEl);
}

function tsDestroySelect2(el) {
  if (!el || typeof jQuery === "undefined" || !jQuery.fn.select2) return;
  var $e = jQuery(el);
  if ($e.length && $e.hasClass("select2-hidden-accessible")) $e.select2("destroy");
}

function tsBindSelect2On(el, placeholder) {
  if (!el || typeof jQuery === "undefined" || !jQuery.fn.select2) return;
  tsDestroySelect2(el);
  var lang = {
    noResults: function () {
      return "Sonuç yok";
    },
    searching: function () {
      return "Aranıyor…";
    },
  };
  jQuery(el).select2({
    width: "100%",
    placeholder: placeholder || "Seçin",
    allowClear: true,
    language: lang,
  });
}

/**
 * @param {{ formId: string, tableWrapId: string, pagerWrapId?: string, metaId?: string, citySelectId: string, uniSelectId?: string, deptSelectId?: string, programTurSelectId?: string, pageSize?: number }} options
 */
export function initTercihSihirbazi(options) {
  var formId = options.formId || "dpTsForm";
  var tableWrapId = options.tableWrapId || "dpTsTableScroll";
  var pagerWrapId = options.pagerWrapId || "";
  var metaId = options.metaId || "dpTsMeta";
  var citySelectId = options.citySelectId || "dpTsCity";
  var uniSelectId = "uniSelectId" in options ? options.uniSelectId : "dpTsUniSelect";
  var deptSelectId = "deptSelectId" in options ? options.deptSelectId : "dpTsDeptSelect";
  var programTurSelectId = options.programTurSelectId || "";
  var pageSize = options.pageSize != null ? Math.max(10, Math.min(200, Number(options.pageSize))) : 50;
  var form = document.getElementById(formId);
  var tableScroll = document.getElementById(tableWrapId);
  var pagerEl = pagerWrapId ? document.getElementById(pagerWrapId) : null;
  var meta = document.getElementById(metaId);
  var citySel = document.getElementById(citySelectId);
  var uniSel = uniSelectId ? document.getElementById(uniSelectId) : null;
  var deptSel = deptSelectId ? document.getElementById(deptSelectId) : null;
  var programTurEl = programTurSelectId
    ? document.getElementById(programTurSelectId)
    : form
      ? form.querySelector('select[name="programTuru"]')
      : null;
  if (!form || !tableScroll) return;

  tableScroll._tsFormEl = form;

  if (!tableScroll.dataset.tsAddDelegation) {
    tableScroll.dataset.tsAddDelegation = "1";
    tableScroll.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ts-add]") : null;
      if (!btn || !tableScroll.contains(btn)) return;
      ev.preventDefault();
      var kod = btn.getAttribute("data-program-kodu") || "";
      try {
        document.dispatchEvent(
          new CustomEvent("tercih-sihirbazi:add", {
            detail: { programKodu: kod, button: btn },
            bubbles: true,
          })
        );
      } catch (e) {
        /* IE yok */
      }
    });
  }

  var combinedPager = !pagerEl;
  if (combinedPager) pagerEl = tableScroll;

  /** @type {object[]} */
  var allRows = [];

  function setMeta(t) {
    if (meta) meta.textContent = t;
  }

  function currentProgramKey() {
    var v = programTurEl && programTurEl.value ? String(programTurEl.value).trim() : "lisans";
    return v === "onlisans" ? "onlisans" : "lisans";
  }

  function resetAuxiliaryFilters() {
    if (!form) return;
    if (citySel) citySel.value = "";
    if (uniSel) uniSel.value = "";
    if (deptSel) deptSel.value = "";
    var minI = form.querySelector('[name="minSira"]');
    var maxI = form.querySelector('[name="maxSira"]');
    if (minI) minI.value = "";
    if (maxI) maxI.value = "";
    var puanEl0 = form.querySelector('[name="puanTuru"]');
    var utEl0 = form.querySelector('[name="uniType"]');
    var bursEl0 = form.querySelector('[name="bursDurumu"]');
    var stS = form.querySelector('[name="studentSira"]');
    var stP = form.querySelector('[name="studentPuan"]');
    if (puanEl0) puanEl0.value = "";
    if (utEl0) utEl0.value = "";
    if (bursEl0) bursEl0.value = "";
    if (stS) stS.value = "";
    if (stP) stP.value = "";
  }

  function runFilter() {
    var fd = new FormData(form);
    var minRaw = (fd.get("minSira") || "").toString().replace(/\./g, "").trim();
    var maxRaw = (fd.get("maxSira") || "").toString().replace(/\./g, "").trim();
    var minS = minRaw ? parseInt(minRaw, 10) : NaN;
    var maxS = maxRaw ? parseInt(maxRaw, 10) : NaN;
    var puan = (fd.get("puanTuru") || "").toString().trim();
    var city = (fd.get("city") || "").toString().trim();
    var ut = (fd.get("uniType") || "").toString().trim();
    var bursDurumu = (fd.get("bursDurumu") || "").toString().trim();
    var universite = (fd.get("universite") || "").toString().trim();
    var bolum = (fd.get("bolum") || "").toString().trim();
    var programTuru =
      (fd.get("programTuru") || currentProgramKey() || "lisans").toString().trim() || "lisans";
    var filtered = filterFlatRows(allRows, {
      minSiralama: minS,
      maxSiralama: maxS,
      puanTuru: puan,
      city: city,
      uniType: ut,
      bursDurumu: bursDurumu,
      universite: universite,
      bolum: bolum,
      programTuru: programTuru,
    });
    setMeta(
      "Toplam " +
        formatIntTr(filtered.length) +
        " satır — YÖK Atlas geniş şema (prg. kodu, yıllık taban/sıra, kontenjan). Sıralama: güncel başarı sırası (küçükten büyüğe)."
    );
    tableScroll._tsAnimateNext = true;
    renderTableWithPagination(tableScroll, combinedPager ? tableScroll : pagerEl, filtered, pageSize);
  }

  var _tsGeoSyncing = false;

  function readGeoSelections() {
    return {
      city: citySel ? String(citySel.value || "").trim() : "",
      universite: uniSel ? String(uniSel.value || "").trim() : "",
      bolum: deptSel ? String(deptSel.value || "").trim() : "",
    };
  }

  function applyGeoSelectionsToDom(sel) {
    if (citySel) citySel.value = sel.city || "";
    if (uniSel) uniSel.value = sel.universite || "";
    if (deptSel) deptSel.value = sel.bolum || "";
  }

  function populateGeoNative(opts) {
    if (citySel) {
      citySel.innerHTML = '<option value="">Tüm şehirler</option>';
      for (var ci = 0; ci < opts.cities.length; ci++) {
        var oc = document.createElement("option");
        oc.value = opts.cities[ci];
        oc.textContent = opts.cities[ci];
        citySel.appendChild(oc);
      }
    }
    if (uniSel) {
      uniSel.innerHTML = '<option value="">— Tüm üniversiteler —</option>';
      for (var uj = 0; uj < opts.unis.length; uj++) {
        var ou = document.createElement("option");
        ou.value = opts.unis[uj];
        ou.textContent = opts.unis[uj];
        uniSel.appendChild(ou);
      }
    }
    if (deptSel) {
      deptSel.removeAttribute("disabled");
      deptSel.innerHTML = '<option value="">Bölüm Ara/Seçin</option>';
      for (var bi = 0; bi < opts.bolums.length; bi++) {
        var ob = document.createElement("option");
        ob.value = opts.bolums[bi];
        ob.textContent = opts.bolums[bi];
        deptSel.appendChild(ob);
      }
    }
  }

  function rebindGeoSelect2() {
    tsDestroySelect2(citySel);
    tsDestroySelect2(uniSel);
    tsDestroySelect2(deptSel);
    if (citySel) tsBindSelect2On(citySel, "Şehir");
    if (uniSel) tsBindSelect2On(uniSel, "Üniversite seçin");
    if (deptSel) tsBindSelect2On(deptSel, "Bölüm Ara/Seçin");
  }

  function syncGeoCrossFilter() {
    if (_tsGeoSyncing) return;
    _tsGeoSyncing = true;
    try {
      var sel = readGeoSelections();
      pruneGeoSelectionsAgainstRows(allRows, sel);
      var opts = buildCrossOptionSets(allRows, sel);
      tsDestroySelect2(citySel);
      tsDestroySelect2(uniSel);
      tsDestroySelect2(deptSel);
      populateGeoNative(opts);
      applyGeoSelectionsToDom(sel);
      rebindGeoSelect2();
    } finally {
      _tsGeoSyncing = false;
    }
  }

  function fullGeoRepopulateFromDataset() {
    var empty = { city: "", universite: "", bolum: "" };
    var opts = buildCrossOptionSets(allRows, empty);
    tsDestroySelect2(citySel);
    tsDestroySelect2(uniSel);
    tsDestroySelect2(deptSel);
    populateGeoNative(opts);
    applyGeoSelectionsToDom(empty);
  }

  function bindGeoCrossFilterListenersOnce() {
    if (!form || form.dataset.tsGeoCrossBound) return;
    form.dataset.tsGeoCrossBound = "1";
    function onGeoAny() {
      if (_tsGeoSyncing) return;
      syncGeoCrossFilter();
    }
    var geoEv = "change.tsGeoCross select2:select.tsGeoCross select2:clear.tsGeoCross";
    if (typeof jQuery !== "undefined" && jQuery.fn.select2) {
      if (citySel) jQuery(citySel).off(".tsGeoCross").on(geoEv, onGeoAny);
      if (uniSel) jQuery(uniSel).off(".tsGeoCross").on(geoEv, onGeoAny);
      if (deptSel) jQuery(deptSel).off(".tsGeoCross").on(geoEv, onGeoAny);
    } else {
      if (citySel) citySel.addEventListener("change", onGeoAny);
      if (uniSel) uniSel.addEventListener("change", onGeoAny);
      if (deptSel) deptSel.addEventListener("change", onGeoAny);
    }
  }

  function bindAllSelect2() {
    if (uniSel) tsBindSelect2On(uniSel, "Üniversite seçin");
    if (deptSel) tsBindSelect2On(deptSel, "Bölüm Ara/Seçin");
    if (citySel) tsBindSelect2On(citySel, "Şehir");
    var puanEl = form.querySelector('[name="puanTuru"]');
    var utEl = form.querySelector('[name="uniType"]');
    var bursEl = form.querySelector('[name="bursDurumu"]');
    var progEl = form.querySelector('select[name="programTuru"]');
    if (puanEl) tsBindSelect2On(puanEl, "Puan türü");
    if (utEl) tsBindSelect2On(utEl, "Üniversite türü");
    if (bursEl) tsBindSelect2On(bursEl, "Burs");
    if (progEl) tsBindSelect2On(progEl, "Program türü");
  }

  var pagerClickHost = combinedPager ? tableScroll : pagerEl;
  if (!pagerClickHost.dataset.tsPagerDelegation) {
    pagerClickHost.dataset.tsPagerDelegation = "1";
    pagerClickHost.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ts-act]") : null;
      if (!btn || !tableScroll._tsRows || !tableScroll._tsRows.length) return;
      var act = btn.getAttribute("data-ts-act");
      var totalPages = Math.max(1, Math.ceil(tableScroll._tsRows.length / (tableScroll._tsPageSize || 50)));
      if (act === "prev") tableScroll._tsPage = (tableScroll._tsPage || 1) - 1;
      else if (act === "next") tableScroll._tsPage = (tableScroll._tsPage || 1) + 1;
      else return;
      if (tableScroll._tsPage < 1) tableScroll._tsPage = 1;
      if (tableScroll._tsPage > totalPages) tableScroll._tsPage = totalPages;
      paintTablePage(tableScroll, combinedPager ? tableScroll : pagerEl);
    });
  }

  function showDefaultPreview() {
    if (!tableScroll) return;
    var key = currentProgramKey();
    var selRows = [];
    for (var i = 0; i < allRows.length; i++) {
      if (rowMatchesProgramTuru(allRows[i], key)) selRows.push(allRows[i]);
    }
    var top = topRowsByTabanDesc(selRows, 50);
    if (!top.length && selRows.length) top = selRows.slice(0, 50);
    var srcLabel =
      key === "onlisans" ? "yok-atlas-onlisans.json" : "yok-atlas-lisans.json";
    setMeta(
      "Önizleme: Taban puanı en yüksek " +
        formatIntTr(top.length) +
        " program (" +
        srcLabel +
        "). Katalog " +
        formatIntTr(selRows.length) +
        " satır — «Filtrele» ile daraltın; sıralama taban puana göre (yüksekten düşüğe)."
    );
    tableScroll._tsAnimateNext = false;
    renderTableWithPagination(tableScroll, combinedPager ? tableScroll : pagerEl, top, pageSize);
  }

  if (!form.dataset.tsBound) {
    form.dataset.tsBound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      runFilter();
    });
  }

  function hydrateAfterLoad() {
    allRows = getAllFlatRows();
    resetAuxiliaryFilters();

    fullGeoRepopulateFromDataset();
    bindGeoCrossFilterListenersOnce();

    if (form && programTurEl) form.dataset.tsSuppressProgramReload = "1";
    bindAllSelect2();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (form) delete form.dataset.tsSuppressProgramReload;
      });
    });

    showDefaultPreview();
  }

  function reloadProgramData() {
    if (form && form.dataset.tsSuppressProgramReload === "1") return;
    var key = currentProgramKey();
    if (key !== "lisans" && key !== "onlisans") key = "lisans";
    showTableLoading(tableScroll, pagerEl, combinedPager);
    setMeta("Veri yükleniyor…");
    loadTercihDataForProgram(key)
      .then(function () {
        hydrateAfterLoad();
      })
      .catch(function (e) {
        console.error("[Tercih Sihirbazı]", e);
        setMeta("Veri dosyası yüklenemedi (src/data/ altını kontrol edin).");
        tableScroll.innerHTML =
          '<div class="ts-empty-state ts-empty-state--error" role="alert"><p class="ts-empty-state__text">Veri yüklenemedi. <code>src/data/</code> içinde ilgili JSON dosyasını kontrol edin.</p></div>';
        if (pagerEl && pagerEl !== tableScroll) pagerEl.innerHTML = "";
      });
  }

  showTableLoading(tableScroll, pagerEl, combinedPager);
  setMeta("Veri yükleniyor…");

  loadTercihDataForProgram(currentProgramKey())
    .then(function () {
      hydrateAfterLoad();
    })
    .catch(function (e) {
      console.error("[Tercih Sihirbazı]", e);
      setMeta("Veri dosyası yüklenemedi (src/data/ altını kontrol edin).");
      tableScroll.innerHTML =
        '<div class="ts-empty-state ts-empty-state--error" role="alert"><p class="ts-empty-state__text">Veri yüklenemedi. <code>src/data/</code> içinde <code>yok-atlas-lisans.json</code> veya <code>yok-atlas-onlisans.json</code> dosyasını kontrol edin.</p></div>';
      if (pagerEl && pagerEl !== tableScroll) pagerEl.innerHTML = "";
    });

  var clearBtn = document.getElementById("dpTsClearBtn");
  if (clearBtn && !clearBtn.dataset.tsClearBound) {
    clearBtn.dataset.tsClearBound = "1";
    clearBtn.addEventListener("click", function (e) {
      e.preventDefault();
      var puanElC = form.querySelector('[name="puanTuru"]');
      var utElC = form.querySelector('[name="uniType"]');
      var bursElC = form.querySelector('[name="bursDurumu"]');
      var progElC = form.querySelector('select[name="programTuru"]');
      if (citySel) tsDestroySelect2(citySel);
      if (uniSel) tsDestroySelect2(uniSel);
      if (deptSel) tsDestroySelect2(deptSel);
      if (puanElC) tsDestroySelect2(puanElC);
      if (utElC) tsDestroySelect2(utElC);
      if (bursElC) tsDestroySelect2(bursElC);
      if (progElC) tsDestroySelect2(progElC);
      form.reset();
      if (programTurEl) programTurEl.value = "lisans";
      showTableLoading(tableScroll, pagerEl, combinedPager);
      setMeta("Sıfırlanıyor…");
      loadTercihDataForProgram("lisans")
        .then(function () {
          hydrateAfterLoad();
        })
        .catch(function (err) {
          console.error("[Tercih Sihirbazı]", err);
          setMeta("Veri dosyası yüklenemedi (src/data/ altını kontrol edin).");
          tableScroll.innerHTML =
            '<div class="ts-empty-state ts-empty-state--error" role="alert"><p class="ts-empty-state__text">Veri yüklenemedi.</p></div>';
          if (pagerEl && pagerEl !== tableScroll) pagerEl.innerHTML = "";
        });
    });
  }

  var tsProgReloadTimer = null;
  if (programTurEl && !form.dataset.tsProgramReloadBound) {
    form.dataset.tsProgramReloadBound = "1";
    function onProgramTurChanged() {
      if (tsProgReloadTimer) clearTimeout(tsProgReloadTimer);
      tsProgReloadTimer = setTimeout(function () {
        tsProgReloadTimer = null;
        reloadProgramData();
      }, 60);
    }
    if (typeof jQuery !== "undefined" && jQuery.fn.select2) {
      jQuery(programTurEl)
        .off(".tsTsProg")
        .on("change.tsTsProg select2:select.tsTsProg", onProgramTurChanged);
    } else {
      programTurEl.addEventListener("change", onProgramTurChanged);
    }
  }
}
