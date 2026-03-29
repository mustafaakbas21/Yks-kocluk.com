/**
 * Tercih Sihirbazı — tek kaynak: hedef-appwrite-catalog (yok-atlas.json → yks-data.json).
 * Başarı sırası, taban puan, kontenjan: JSON’daki gerçek alanlar (yokAtlas dahil); uydurma yok.
 */
import {
  ensureHedefSimulatorAppwriteData,
  getAllHedefPrograms,
  getDedupedProgramsForUniversity,
  getHedefAppwriteUniversities,
  hedefProgramDisplayName,
  hedefUniDisplayName,
} from "./hedef-appwrite-catalog.js";

function tercihProgramAtlas(p) {
  if (!p) return {};
  var nested = p.yokAtlas && typeof p.yokAtlas === "object" ? p.yokAtlas : null;
  return nested ? Object.assign({}, p, nested) : Object.assign({}, p);
}

function getBasariSiralamaRaw(p) {
  var s = tercihProgramAtlas(p);
  var v =
    s.ornekSiralama != null
      ? s.ornekSiralama
      : s.basariSiralama != null
        ? s.basariSiralama
        : s.basari_sirasi != null
          ? s.basari_sirasi
          : s.yerlesenSirasi != null
            ? s.yerlesenSirasi
            : s.yerlesmeSirasi != null
              ? s.yerlesmeSirasi
              : s.yerlesme_sirasi != null
                ? s.yerlesme_sirasi
                : null;
  return v;
}

function getTabanPuanRaw(p) {
  var s = tercihProgramAtlas(p);
  return s.tabanPuan != null
    ? s.tabanPuan
    : s.ornekTabanPuan != null
      ? s.ornekTabanPuan
      : s.taban_puan != null
        ? s.taban_puan
        : s.yerlesmeTabanPuan != null
          ? s.yerlesmeTabanPuan
          : null;
}

function getKontenjanRaw(p) {
  var s = tercihProgramAtlas(p);
  return s.kontenjan != null
    ? s.kontenjan
    : s.kontenjanGenel != null
      ? s.kontenjanGenel
      : s.genelKontenjan != null
        ? s.genelKontenjan
        : s.genel_kontenjan != null
          ? s.genel_kontenjan
          : null;
}

function getScoreTypeRaw(p) {
  var s = tercihProgramAtlas(p);
  var raw = s.scoreType != null ? s.scoreType : s.puanTuru != null ? s.puanTuru : "";
  return String(raw || "").trim();
}

/** @param {string} raw */
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

function formatIntTr(n) {
  var x = Number(n);
  if (!isFinite(x)) return "-";
  return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** JSON'daki sıra (sayı veya "1.234.567" gibi) → tam sayı; geçersizse NaN */
function parseSiralamaInt(raw) {
  if (raw == null || raw === "") return NaN;
  var s = String(raw).trim();
  if (!s) return NaN;
  s = s.replace(/\s/g, "").replace(/\./g, "").replace(/,/g, "");
  if (s === "") return NaN;
  var n = parseInt(s, 10);
  return isFinite(n) ? n : NaN;
}

function sortProgramsBySiralamaAsc(programs) {
  programs.sort(function (a, b) {
    var sa = parseSiralamaInt(getBasariSiralamaRaw(a));
    var sb = parseSiralamaInt(getBasariSiralamaRaw(b));
    var fa = isFinite(sa);
    var fb = isFinite(sb);
    if (!fa && !fb) return 0;
    if (!fa) return 1;
    if (!fb) return -1;
    return sa - sb;
  });
  return programs;
}

function trLower(s) {
  return String(s || "").toLocaleLowerCase("tr");
}

function getProgramBursNormalized(p) {
  var raw =
    p.bursDurumu != null
      ? String(p.bursDurumu).trim()
      : p.ucretDurumu != null
        ? String(p.ucretDurumu).trim()
        : "";
  if (!raw) return "";
  var low = trLower(raw);
  if (low.indexOf("tam") !== -1 && low.indexOf("burs") !== -1) return "tam_burslu";
  if (low === "tam_burslu" || low === "tam burslu") return "tam_burslu";
  if (
    low.indexOf("50") !== -1 ||
    low.indexOf("yarı") !== -1 ||
    low.indexOf("yari") !== -1 ||
    low.indexOf("indirim") !== -1
  )
    return "yari_indirim";
  if (low.indexOf("ücret") !== -1 || low.indexOf("ucret") !== -1) return "ucretli";
  return "";
}

function bursFilterMatches(p, selected) {
  if (!selected) return true;
  var got = getProgramBursNormalized(p);
  if (!got) return true;
  return got === selected;
}

function formatKontenjanCell(p) {
  var v = getKontenjanRaw(p);
  if (v == null || v === "") return "-";
  var n = Number(v);
  if (!isFinite(n)) return "-";
  return formatIntTr(n);
}

function formatTabanCell(p) {
  var v = getTabanPuanRaw(p);
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

function programBolumBlockHtml(p) {
  var main = hedefProgramDisplayName(p);
  var fak = p.fakulte != null ? String(p.fakulte).trim() : "";
  if (fak) {
    return (
      '<div class="ts-prog-name">' +
      escapeHtml(main) +
      '</div><div class="ts-fakulte-line">' +
      escapeHtml(fak) +
      "</div>"
    );
  }
  return '<span class="ts-prog-name">' + escapeHtml(main) + "</span>";
}

function programBursBadgesHtml(p) {
  var k = getProgramBursNormalized(p);
  if (!k) return "";
  if (k === "tam_burslu") return '<span class="ts-badge ts-badge--burs-tam">Tam Burslu</span>';
  if (k === "yari_indirim") return '<span class="ts-badge ts-badge--burs-yari">%50 İndirimli</span>';
  if (k === "ucretli") return '<span class="ts-badge ts-badge--burs-ucret">Ücretli</span>';
  return "";
}

function uniTypeBadgeHtml(udoc) {
  var ut = udoc && udoc.uniType != null ? String(udoc.uniType).trim() : "";
  var low = trLower(ut);
  var isVakif = low === "vakıf" || low === "vakif";
  var isDevlet = low === "devlet";
  var isKibris = low === "kibris" || low === "kıbrıs" || low.indexOf("kıbrıs") !== -1 || low.indexOf("kibris") !== -1;
  var cls = "ts-badge ";
  if (isVakif) cls += "ts-badge--vakif";
  else if (isDevlet) cls += "ts-badge--devlet";
  else if (isKibris) cls += "ts-badge--kibris";
  else cls += "ts-badge--muted";
  var label = isVakif ? "Vakıf" : isDevlet ? "Devlet" : isKibris ? "Kıbrıs" : escapeHtml(ut || "—");
  return '<span class="' + cls + '">' + label + "</span>";
}

function uniCellBadgesRow(udoc, p) {
  var parts = [];
  if (udoc) parts.push(uniTypeBadgeHtml(udoc));
  var bb = programBursBadgesHtml(p);
  if (bb) parts.push(bb);
  if (!parts.length) return "";
  return '<div class="ts-uni-badges">' + parts.join("") + "</div>";
}

function buildUniMap(unis) {
  var m = Object.create(null);
  for (var i = 0; i < unis.length; i++) {
    var u = unis[i];
    var id = u && u.$id != null ? String(u.$id) : "";
    if (id) m[id] = u;
  }
  return m;
}

function uniqueCities(unis) {
  var s = Object.create(null);
  for (var i = 0; i < unis.length; i++) {
    var c = unis[i] && unis[i].city != null ? String(unis[i].city).trim() : "";
    if (c) s[c] = true;
  }
  return Object.keys(s).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
}

function filterPrograms(programs, uniMap, opts) {
  var minS = opts.minSiralama;
  var maxS = opts.maxSiralama;
  var puan = opts.puanTuru;
  var city = opts.city;
  var uniType = opts.uniType;
  var bursSel = opts.bursDurumu;
  var uniId = opts.uniId;
  var programId = opts.programId;
  var out = [];
  var rangeFilter = isFinite(minS) || isFinite(maxS);
  var puanCanon = puan ? canonPuanTuru(puan) : "";

  for (var i = 0; i < programs.length; i++) {
    var p = programs[i];
    var os = parseSiralamaInt(getBasariSiralamaRaw(p));
    if (rangeFilter) {
      if (!isFinite(os)) continue;
      if (isFinite(minS) && os < minS) continue;
      if (isFinite(maxS) && os > maxS) continue;
    }
    if (puanCanon) {
      var pc = canonPuanTuru(getScoreTypeRaw(p));
      if (pc !== puanCanon) continue;
    }
    var uid = String(p.uniId || "");
    var udoc = uniMap[uid];
    if (!udoc) continue;
    if (uniId && uid !== String(uniId)) continue;
    if (programId && String(p.$id) !== String(programId)) continue;
    if (city) {
      var uc = udoc.city != null ? String(udoc.city).trim() : "";
      if (uc !== city) continue;
    }
    if (uniType) {
      var ut = udoc.uniType != null ? String(udoc.uniType).trim() : "";
      if (uniType === "kibris") {
        var luk = trLower(ut);
        if (luk !== "kibris" && luk !== "kıbrıs") continue;
      } else if (ut !== uniType) continue;
    }
    if (!bursFilterMatches(p, bursSel)) continue;
    out.push(p);
  }
  return sortProgramsBySiralamaAsc(out);
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paintTablePage(wrap) {
  if (!wrap) return;
  var rows = wrap._tsRows;
  var uniMap = wrap._tsUniMap;
  var pageSize = wrap._tsPageSize || 50;
  var page = wrap._tsPage || 1;

  if (!rows || !rows.length) {
    wrap._tsAnimateNext = false;
    wrap.innerHTML =
      '<div class="ts-empty-state" role="status"><p class="ts-empty-state__text">Seçtiğiniz kriterlere uygun program bulunamadı.</p></div>';
    return;
  }

  var total = rows.length;
  var totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (page > totalPages) page = totalPages;
  if (page < 1) page = 1;
  wrap._tsPage = page;

  var start = (page - 1) * pageSize;
  var list = rows.slice(start, start + pageSize);
  var from = start + 1;
  var to = Math.min(start + pageSize, total);

  var anim = wrap._tsAnimateNext;
  wrap._tsAnimateNext = false;
  var rootCls = "ts-table-root" + (anim ? " ts-table-root--enter" : "");

  var html =
    '<div class="' +
    rootCls +
    '"><table class="ts-table ts-table--premium ts-table--yks" role="grid"><thead><tr>' +
    "<th>Üniversite</th><th>Bölüm / Fakülte</th><th>Puan Türü</th><th>Kontenjan</th><th>Taban Puan</th><th>Başarı Sırası</th>" +
    "</tr></thead><tbody>";
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var u = uniMap[String(p.uniId)];
    var uniName = u ? hedefUniDisplayName(u) : "—";
    var br = parseSiralamaInt(getBasariSiralamaRaw(p));
    var os = isFinite(br) ? formatIntTr(br) : "-";
    var stDisp = getScoreTypeRaw(p) || "-";
    html +=
      '<tr><td class="ts-cell-uni">' +
      '<div class="ts-uni-stack">' +
      '<strong class="ts-uni-name">' +
      escapeHtml(uniName) +
      "</strong>" +
      uniCellBadgesRow(u, p) +
      "</div></td><td class=\"ts-cell-bolum\">" +
      programBolumBlockHtml(p) +
      "</td><td>" +
      escapeHtml(stDisp) +
      "</td><td class=\"ts-num-cell\">" +
      escapeHtml(formatKontenjanCell(p)) +
      "</td><td class=\"ts-num-cell\">" +
      escapeHtml(formatTabanCell(p)) +
      "</td><td class=\"ts-num-cell\">" +
      escapeHtml(os) +
      "</td></tr>";
  }
  html += "</tbody></table>";

  html +=
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
    "</div></div>";

  wrap.innerHTML = html;
}

function renderTableWithPagination(wrap, rows, uniMap, pageSize) {
  if (!wrap) return;
  pageSize = pageSize || 50;
  wrap._tsRows = rows;
  wrap._tsUniMap = uniMap;
  wrap._tsPageSize = pageSize;
  wrap._tsPage = 1;
  paintTablePage(wrap);
}

function paintInitialPlaceholder(wrap) {
  if (!wrap) return;
  wrap._tsRows = null;
  wrap.innerHTML =
    '<div class="ts-empty-state" role="status"><p class="ts-empty-state__text">Şehir, puan türü, başarı sırası aralığı ve isteğe bağlı üniversite/bölüm seçerek «Filtrele»ye basın. Veriler YÖK Atlas kataloğundaki alanlardan okunur.</p></div>';
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
    noResults: function () { return "Sonuç yok"; },
    searching: function () { return "Aranıyor…"; },
  };
  jQuery(el).select2({
    width: "100%",
    placeholder: placeholder || "Seçin",
    allowClear: true,
    language: lang,
  });
}

/**
 * @param {{ formId: string, tableWrapId: string, metaId?: string, citySelectId: string, uniSelectId?: string, deptSelectId?: string, pageSize?: number }} options
 */
export function initTercihSihirbazi(options) {
  var formId = options.formId || "dpTsForm";
  var tableWrapId = options.tableWrapId || "dpTsTableWrap";
  var metaId = options.metaId || "dpTsMeta";
  var citySelectId = options.citySelectId || "dpTsCity";
  var uniSelectId = options.uniSelectId || "dpTsUniSelect";
  var deptSelectId = options.deptSelectId || "dpTsDeptSelect";
  var pageSize = options.pageSize != null ? Math.max(10, Math.min(200, Number(options.pageSize))) : 50;
  var form = document.getElementById(formId);
  var wrap = document.getElementById(tableWrapId);
  var meta = document.getElementById(metaId);
  var citySel = document.getElementById(citySelectId);
  var uniSel = document.getElementById(uniSelectId);
  var deptSel = document.getElementById(deptSelectId);
  if (!form || !wrap) return;

  function setMeta(t) {
    if (meta) meta.textContent = t;
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
    var uniId = uniSel ? String(uniSel.value || "").trim() : "";
    var programId = deptSel ? String(deptSel.value || "").trim() : "";
    var programs = getAllHedefPrograms();
    var unis = getHedefAppwriteUniversities();
    var uniMap = buildUniMap(unis);
    var filtered = filterPrograms(programs, uniMap, {
      minSiralama: minS,
      maxSiralama: maxS,
      puanTuru: puan,
      city: city,
      uniType: ut,
      bursDurumu: bursDurumu,
      uniId: uniId,
      programId: programId,
    });
    setMeta(
      "Toplam " +
        formatIntTr(filtered.length) +
        " program — YÖK Atlas kataloğu. Sıralama: Başarı sırası (küçükten büyüğe)."
    );
    wrap._tsAnimateNext = true;
    renderTableWithPagination(wrap, filtered, uniMap, pageSize);
  }

  function fillCitiesOnce() {
    if (!citySel || citySel.dataset.tsFilled) return;
    citySel.dataset.tsFilled = "1";
    var unis = getHedefAppwriteUniversities();
    var cities = uniqueCities(unis);
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
    var unis = getHedefAppwriteUniversities();
    uniSel.innerHTML = '<option value="">— Tüm üniversiteler —</option>';
    unis
      .slice()
      .sort(function (a, b) {
        return hedefUniDisplayName(a).localeCompare(hedefUniDisplayName(b), "tr");
      })
      .forEach(function (u) {
        var o = document.createElement("option");
        o.value = u.$id;
        o.textContent = hedefUniDisplayName(u) || u.$id;
        uniSel.appendChild(o);
      });
  }

  function fillDepartmentForUni(uid) {
    if (!deptSel) return;
    tsDestroySelect2(deptSel);
    if (!uid) {
      deptSel.innerHTML = '<option value="">— Önce üniversite seçin —</option>';
      deptSel.disabled = true;
      tsBindSelect2On(deptSel, "Önce üniversite seçin");
      return;
    }
    deptSel.disabled = false;
    deptSel.innerHTML = '<option value="">— Tüm bölümler (daraltmak için seçin) —</option>';
    var list = getDedupedProgramsForUniversity(uid) || [];
    list.forEach(function (p) {
      var o = document.createElement("option");
      o.value = p.$id;
      o.textContent = hedefProgramDisplayName(p) || p.$id;
      deptSel.appendChild(o);
    });
    tsBindSelect2On(deptSel, "Bölüm seçin");
  }

  function bindAllSelect2() {
    if (uniSel) tsBindSelect2On(uniSel, "Üniversite seçin");
    if (deptSel) tsBindSelect2On(deptSel, "Önce üniversite seçin");
    if (citySel) tsBindSelect2On(citySel, "Şehir");
    var puanEl = document.getElementById("dpTsPuan");
    var utEl = document.getElementById("dpTsUniType");
    var bursEl = document.getElementById("dpTsBurs");
    if (puanEl) tsBindSelect2On(puanEl, "Puan türü");
    if (utEl) tsBindSelect2On(utEl, "Üniversite türü");
    if (bursEl) tsBindSelect2On(bursEl, "Burs");
  }

  if (!wrap.dataset.tsPagerDelegation) {
    wrap.dataset.tsPagerDelegation = "1";
    wrap.addEventListener("click", function (ev) {
      var btn = ev.target && ev.target.closest ? ev.target.closest("[data-ts-act]") : null;
      if (!btn || !wrap._tsRows || !wrap._tsRows.length) return;
      var act = btn.getAttribute("data-ts-act");
      var totalPages = Math.max(1, Math.ceil(wrap._tsRows.length / (wrap._tsPageSize || 50)));
      if (act === "prev") wrap._tsPage = (wrap._tsPage || 1) - 1;
      else if (act === "next") wrap._tsPage = (wrap._tsPage || 1) + 1;
      else return;
      if (wrap._tsPage < 1) wrap._tsPage = 1;
      if (wrap._tsPage > totalPages) wrap._tsPage = totalPages;
      paintTablePage(wrap);
    });
  }

  if (!form.dataset.tsBound) {
    form.dataset.tsBound = "1";
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      runFilter();
    });
  }

  if (uniSel && !uniSel.dataset.tsUniChangeBound) {
    uniSel.dataset.tsUniChangeBound = "1";
    uniSel.addEventListener("change", function () {
      var uid = String(uniSel.value || "").trim();
      fillDepartmentForUni(uid);
    });
  }

  paintInitialPlaceholder(wrap);
  setMeta("Katalog yükleniyor…");

  ensureHedefSimulatorAppwriteData()
    .then(function () {
      fillCitiesOnce();
      fillUniversityOnce();
      if (uniSel) uniSel.value = "";
      fillDepartmentForUni("");
      bindAllSelect2();
      try {
        if (typeof jQuery !== "undefined" && jQuery.fn.select2) {
          jQuery("#dpTsUniSelect").val("").trigger("change");
          jQuery("#dpTsCity").val("").trigger("change");
          jQuery("#dpTsPuan").val("").trigger("change");
          jQuery("#dpTsUniType").val("").trigger("change");
          jQuery("#dpTsBurs").val("").trigger("change");
        }
      } catch (_e) {}
      setMeta(
        "Veri hazır. Filtreleri seçip «Filtrele» ile listeleyin — tablo başlangıçta boştur (YÖK Atlas / yks-data.json)."
      );
    })
    .catch(function (e) {
      console.error("[Tercih Sihirbazı]", e);
      setMeta("Katalog (yok-atlas.json / yks-data.json) yüklenemedi.");
      wrap.innerHTML =
        '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Katalog yüklenemedi.</p>';
    });
}
