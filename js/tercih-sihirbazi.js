/**
 * Tercih Sihirbazı — yks-data.json üzerinden client-side filtre + tablo + sayfalama
 */
import {
  ensureHedefSimulatorAppwriteData,
  getAllHedefPrograms,
  getHedefAppwriteUniversities,
  hedefProgramDisplayName,
  hedefUniDisplayName,
} from "./hedef-appwrite-catalog.js";

function formatIntTr(n) {
  var x = Number(n);
  if (!isFinite(x)) return "—";
  return String(Math.round(x)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
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
  var out = [];
  for (var i = 0; i < programs.length; i++) {
    var p = programs[i];
    var os = p.ornekSiralama != null ? Number(p.ornekSiralama) : NaN;
    if (isFinite(minS) && isFinite(os) && os < minS) continue;
    if (isFinite(maxS) && isFinite(os) && os > maxS) continue;
    if (puan && String(p.scoreType || "") !== puan) continue;
    var uid = String(p.uniId || "");
    var udoc = uniMap[uid];
    if (!udoc) continue;
    if (city) {
      var uc = udoc.city != null ? String(udoc.city).trim() : "";
      if (uc !== city) continue;
    }
    if (uniType) {
      var ut = udoc.uniType != null ? String(udoc.uniType).trim() : "";
      if (ut !== uniType) continue;
    }
    out.push(p);
  }
  return out;
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
    wrap.innerHTML =
      '<p class="net-sihirbazi-placeholder">Kriterlere uyan program bulunamadı. Aralığı veya filtreleri gevşetin.</p>';
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

  var html =
    '<div class="ts-table-scroll"><table class="ts-table" role="grid"><thead><tr>' +
    "<th>Sıra (örnek)</th><th>Üniversite</th><th>Program</th><th>Puan türü</th><th>Şehir</th><th>Tür</th>" +
    "</tr></thead><tbody>";
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    var u = uniMap[String(p.uniId)];
    var uniName = u ? hedefUniDisplayName(u) : "—";
    var pname = hedefProgramDisplayName(p);
    var city = u && u.city != null ? String(u.city) : "—";
    var ut = u && u.uniType != null ? String(u.uniType) : "—";
    var os = p.ornekSiralama != null ? formatIntTr(p.ornekSiralama) : "—";
    html +=
      "<tr><td>" +
      escapeHtml(os) +
      "</td><td>" +
      escapeHtml(uniName) +
      "</td><td>" +
      escapeHtml(pname) +
      "</td><td>" +
      escapeHtml(String(p.scoreType || "—")) +
      "</td><td>" +
      escapeHtml(city) +
      "</td><td>" +
      escapeHtml(ut) +
      "</td></tr>";
  }
  html += "</tbody></table></div>";

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
    "</div>";

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

/**
 * @param {{ formId: string, tableWrapId: string, metaId?: string, citySelectId: string, pageSize?: number }} options
 */
export function initTercihSihirbazi(options) {
  var formId = options.formId || "dpTsForm";
  var tableWrapId = options.tableWrapId || "dpTsTableWrap";
  var metaId = options.metaId || "dpTsMeta";
  var citySelectId = options.citySelectId || "dpTsCity";
  var pageSize = options.pageSize != null ? Math.max(10, Math.min(200, Number(options.pageSize))) : 50;
  var form = document.getElementById(formId);
  var wrap = document.getElementById(tableWrapId);
  var meta = document.getElementById(metaId);
  var citySel = document.getElementById(citySelectId);
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
    var programs = getAllHedefPrograms();
    var unis = getHedefAppwriteUniversities();
    var uniMap = buildUniMap(unis);
    var filtered = filterPrograms(programs, uniMap, {
      minSiralama: minS,
      maxSiralama: maxS,
      puanTuru: puan,
      city: city,
      uniType: ut,
    });
    setMeta(
      "Toplam " +
        formatIntTr(filtered.length) +
        " program (yks-data.json). Tablo sayfalama ile gösteriliyor."
    );
    renderTableWithPagination(wrap, filtered, uniMap, pageSize);
  }

  function fillCitiesOnce() {
    if (!citySel || citySel.dataset.tsFilled) return;
    citySel.dataset.tsFilled = "1";
    var unis = getHedefAppwriteUniversities();
    var cities = uniqueCities(unis);
    var prev = citySel.value;
    citySel.innerHTML = '<option value="">Tümü</option>';
    for (var i = 0; i < cities.length; i++) {
      var o = document.createElement("option");
      o.value = cities[i];
      o.textContent = cities[i];
      citySel.appendChild(o);
    }
    if (prev) citySel.value = prev;
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

  ensureHedefSimulatorAppwriteData()
    .then(function () {
      fillCitiesOnce();
      setMeta("Veri hazır. Filtreleri seçip Filtrele’ye basın.");
      wrap.innerHTML =
        '<p class="net-sihirbazi-placeholder">Filtrele düğmesine basarak sonuçları tabloda görüntüleyin (sayfalama aktif).</p>';
      wrap._tsRows = null;
    })
    .catch(function (e) {
      console.error("[Tercih Sihirbazı]", e);
      setMeta("yks-data.json yüklenemedi.");
      wrap.innerHTML =
        '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Katalog yüklenemedi.</p>';
    });
}
