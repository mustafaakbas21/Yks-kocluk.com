/**
 * Tercih Sihirbazı — program türüne göre tek JSON: yok-atlas-lisans.json | yok-atlas-onlisans.json
 * (Scraper çıktısını src/data/ altına kopyalayın.)
 */
var DATA_SOURCES = {
  lisans: { url: "src/data/yok-atlas-lisans.json", tag: "lisans" },
  onlisans: { url: "src/data/yok-atlas-onlisans.json", tag: "onlisans" },
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
  };
}

function normalizeScrapedRow(raw, index, sourceTag) {
  var r = raw && typeof raw === "object" ? raw : {};
  var sy = parseSureYil(r.Sure_Yil);
  var pt = "";
  if (sourceTag === "lisans") pt = "lisans";
  else if (sourceTag === "onlisans") pt = "onlisans";
  else pt = inferProgramTuru({ Sure_Yil: r.Sure_Yil }, "legacy");

  return {
    Universite: r.Universite != null ? String(r.Universite).trim() : "",
    Bolum: r.Bolum != null ? String(r.Bolum).trim() : "",
    UniversiteTuru: r.UniversiteTuru != null ? String(r.UniversiteTuru).trim() : "",
    BursDurumu:
      r.Ek_Bilgi_1 != null
        ? String(r.Ek_Bilgi_1).trim()
        : r.BursDurumu != null
          ? String(r.BursDurumu).trim()
          : "",
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
  };
}

function normalizeAnyRow(raw, index, sourceTag) {
  if (isScrapedShape(raw)) return normalizeScrapedRow(raw, index, sourceTag);
  return normalizeFlatRow(raw, index);
}

function fetchJsonBundle(entry) {
  return fetch(entry.url, { cache: "no-store" })
    .then(function (res) {
      if (!res.ok) return { rows: [], tag: entry.tag };
      return res.json().then(function (data) {
        var arr = Array.isArray(data) ? data : data && data.rows ? data.rows : [];
        return { rows: arr, tag: entry.tag };
      });
    })
    .catch(function () {
      return { rows: [], tag: entry.tag };
    });
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

function uniqueUniversiteler(rows) {
  return uniqueSorted(
    rows.map(function (r) {
      return r.Universite;
    })
  );
}

function uniqueSehirler(rows) {
  return uniqueSorted(
    rows.map(function (r) {
      return r.Sehir;
    })
  );
}

function bolumlerForUniversite(rows, uniName) {
  var u = String(uniName || "").trim();
  if (!u) return [];
  var list = rows
    .filter(function (r) {
      return r.Universite === u;
    })
    .map(function (r) {
      return r.Bolum;
    })
    .filter(Boolean);
  return uniqueSorted(list);
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

function formatIntTr(n) {
  var x = Number(n);
  if (!isFinite(x)) return "-";
  return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function formatKontenjanCell(row) {
  var v = row.Kontenjan;
  if (v == null || v === "") return "-";
  var n = Number(v);
  if (!isFinite(n)) return "-";
  return formatIntTr(n);
}

function formatTabanCell(row) {
  var v = row.TabanPuan;
  if (v == null || v === "") return "-";
  var n;
  if (typeof v === "number") {
    n = v;
  } else {
    var s = String(v).trim().replace(/\s/g, "");
    s = s.replace(/\./g, "").replace(",", ".");
    n = parseFloat(s);
  }
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
  if (row.BursDurumu) return '<span class="ts-badge ts-badge--muted">' + escapeHtml(row.BursDurumu) + "</span>";
  return "";
}

function uniCellBadgesFlat(row) {
  var parts = [uniTypeBadgeHtmlFromRow(row)];
  var bb = bursBadgeHtmlFromRow(row);
  if (bb) parts.push(bb);
  return '<div class="ts-uni-badges">' + parts.join("") + "</div>";
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

  var tableHtml =
    '<div class="' +
    rootCls +
    '"><table class="ts-table ts-table--premium ts-table--yks" role="grid"><thead><tr>' +
    "<th>Üniversite</th><th>Bölüm</th><th>Puan Türü</th><th>Kontenjan</th><th>Taban Puan</th><th>Başarı Sırası</th>" +
    "</tr></thead><tbody>";
  for (var i = 0; i < list.length; i++) {
    var row = list[i];
    var uniName = row.Universite || "—";
    var bolumHtml = '<span class="ts-prog-name">' + escapeHtml(row.Bolum || "—") + "</span>";
    var stDisp = row.PuanTuru ? String(row.PuanTuru).trim() : "-";
    tableHtml +=
      '<tr><td class="ts-cell-uni">' +
      '<div class="ts-uni-stack">' +
      '<strong class="ts-uni-name">' +
      escapeHtml(uniName) +
      "</strong>" +
      uniCellBadgesFlat(row) +
      '</div></td><td class="ts-cell-bolum">' +
      bolumHtml +
      "</td><td>" +
      escapeHtml(stDisp) +
      '</td><td class="ts-num-cell">' +
      escapeHtml(formatKontenjanCell(row)) +
      '</td><td class="ts-num-cell">' +
      escapeHtml(formatTabanCell(row)) +
      '</td><td class="ts-num-cell">' +
      escapeHtml(formatBasariCell(row)) +
      "</td></tr>";
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

function paintInitialPlaceholder(tableScroll, pagerEl) {
  if (!tableScroll) return;
  tableScroll._tsRows = null;
  tableScroll.innerHTML =
    '<div class="ts-empty-state" role="status"><p class="ts-empty-state__text">Şehir, puan türü, program türü, başarı sırası aralığı ve isteğe bağlı üniversite/bölüm seçerek «Filtrele»ye basın. Veriler birleşik JSON kaynaklarından okunur.</p></div>';
  if (pagerEl && pagerEl !== tableScroll) pagerEl.innerHTML = "";
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

  function resetFilterDropdownCaches() {
    if (citySel) delete citySel.dataset.tsFilled;
    if (uniSel) delete uniSel.dataset.tsUniFilled;
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
      "Toplam " + formatIntTr(filtered.length) + " satır — düz veri şeması. Sıralama: Başarı sırası (küçükten büyüğe)."
    );
    tableScroll._tsAnimateNext = true;
    renderTableWithPagination(tableScroll, combinedPager ? tableScroll : pagerEl, filtered, pageSize);
  }

  function fillCitiesOnce() {
    if (!citySel || citySel.dataset.tsFilled) return;
    citySel.dataset.tsFilled = "1";
    var cities = uniqueSehirler(allRows);
    var prev = citySel.value;
    citySel.innerHTML = '<option value="">Tüm şehirler</option>';
    for (var i = 0; i < cities.length; i++) {
      var o = document.createElement("option");
      o.value = cities[i];
      o.textContent = cities[i];
      citySel.appendChild(o);
    }
    if (prev) citySel.value = prev;
  }

  function fillUniversityOnce() {
    if (!uniSel || uniSel.dataset.tsUniFilled) return;
    uniSel.dataset.tsUniFilled = "1";
    var unis = uniqueUniversiteler(allRows);
    uniSel.innerHTML = '<option value="">— Tüm üniversiteler —</option>';
    unis.forEach(function (name) {
      var o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      uniSel.appendChild(o);
    });
  }

  function fillDepartmentForUni(uniName) {
    if (!deptSel) return;
    tsDestroySelect2(deptSel);
    var u = String(uniName || "").trim();
    if (!u) {
      deptSel.innerHTML = '<option value="">— Önce üniversite seçin —</option>';
      deptSel.disabled = true;
      tsBindSelect2On(deptSel, "Önce üniversite seçin");
      return;
    }
    deptSel.disabled = false;
    deptSel.removeAttribute("disabled");
    var bolumler = bolumlerForUniversite(allRows, u);
    deptSel.innerHTML = '<option value="">— Tüm bölümler (daraltmak için seçin) —</option>';
    for (var i = 0; i < bolumler.length; i++) {
      var o = document.createElement("option");
      o.value = bolumler[i];
      o.textContent = bolumler[i];
      deptSel.appendChild(o);
    }
    tsBindSelect2On(deptSel, "Bölüm seçin");
  }

  function bindAllSelect2() {
    if (uniSel) tsBindSelect2On(uniSel, "Üniversite seçin");
    if (deptSel) tsBindSelect2On(deptSel, "Önce üniversite seçin");
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

  if (!form.dataset.tsBound) {
    form.dataset.tsBound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      runFilter();
    });
  }

  function hydrateAfterLoad() {
    allRows = getAllFlatRows();
    resetFilterDropdownCaches();
    fillCitiesOnce();
    fillUniversityOnce();
    if (form && programTurEl) form.dataset.tsSuppressProgramReload = "1";
    bindAllSelect2();
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        if (form) delete form.dataset.tsSuppressProgramReload;
      });
    });
    if (uniSel && !uniSel.dataset.tsUniDeptSyncBound) {
      uniSel.dataset.tsUniDeptSyncBound = "1";
      function onUniChanged() {
        var name = String(uniSel.value || "").trim();
        fillDepartmentForUni(name);
        try {
          if (deptSel && typeof jQuery !== "undefined" && jQuery.fn.select2) {
            jQuery(deptSel).val(null).trigger("change");
          }
        } catch (_e) {}
      }
      if (typeof jQuery !== "undefined" && jQuery.fn.select2) {
        jQuery(uniSel)
          .off(".tsWizard")
          .on("change.tsWizard select2:select.tsWizard select2:clear.tsWizard", onUniChanged);
      } else {
        uniSel.addEventListener("change", onUniChanged);
      }
    }
    var uidAfter = uniSel ? String(uniSel.value || "").trim() : "";
    fillDepartmentForUni(uidAfter);
    try {
      if (deptSel && typeof jQuery !== "undefined" && jQuery.fn.select2) {
        jQuery(deptSel).trigger("change");
      }
    } catch (_e2) {}
    paintInitialPlaceholder(tableScroll, combinedPager ? null : pagerEl);
    var label = currentProgramKey() === "onlisans" ? "Önlisans (yok-atlas-onlisans.json)" : "Lisans (yok-atlas-lisans.json)";
    setMeta(
      "Veri hazır (" +
        formatIntTr(allRows.length) +
        " satır). «Filtrele» ile listeleyin — kaynak: " +
        label +
        "."
    );
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

  if (programTurEl && !form.dataset.tsProgramReloadBound) {
    form.dataset.tsProgramReloadBound = "1";
    programTurEl.addEventListener("change", function () {
      reloadProgramData();
    });
  }
}
