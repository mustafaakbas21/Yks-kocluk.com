/**
 * Global Deneme Takvimi — salt okunur; veri Appwrite `global_denemeler` (GLOBAL_EXAMS).
 */
import { databasesListDocumentsOrSoft } from "./appwrite-compat.js?v=20260409-schema-users";
import { APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_GLOBAL_EXAMS } from "./appwrite-config.js?v=20260408-inst";
import { Query } from "./appwrite-browser.js";

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

var TR_MONTH_NAMES = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

/** Appwrite’dan gelen tam liste; filtreler bunun üzerinde çalışır. */
/** @type {{ id: string, adi: string, yayinevi: string, sinavTuru: string, tarihSaat: string }[]} */
var allExams = [];
var gdtFilter = "YKS";
/** Tablo ay filtresi: "" = tüm aylar, aksi "YYYY-MM". */
var gdtMonthKey = "";
var gdtPageSize = 10;
var gdtPageIndex = 0;
var gdtViewY = new Date().getFullYear();
var gdtViewM = new Date().getMonth();
var gdtSelectedKey = "";
var gdtBound = false;

function gdtDayKey(y, m, d) {
  var mm = String(m + 1).padStart(2, "0");
  var dd = String(d).padStart(2, "0");
  return y + "-" + mm + "-" + dd;
}

function gdtParseDoc(d) {
  var id = d.$id != null ? d.$id : d.id;
  return {
    id: String(id || ""),
    adi: String(d.adi != null ? d.adi : "").trim(),
    yayinevi: String(d.yayinevi != null ? d.yayinevi : "").trim(),
    sinavTuru: String(d.sinavTuru != null ? d.sinavTuru : "YKS")
      .toUpperCase()
      .slice(0, 16),
    tarihSaat: d.tarihSaat != null ? String(d.tarihSaat) : "",
  };
}

function gdtExamDateKey(row) {
  var ts = row.tarihSaat || "";
  if (ts.length >= 10) return ts.slice(0, 10);
  return "";
}

function gdtRowMatchesFilter(row) {
  if (gdtFilter === "YKS") return true;
  var t = String(row.sinavTuru || "").toUpperCase().trim();
  var ad = String(row.adi || "").toUpperCase();
  if (gdtFilter === "TYT") {
    if (t === "AYT") return false;
    return t === "TYT" || ad.includes("TYT");
  }
  if (gdtFilter === "AYT") {
    if (t === "TYT") return false;
    return t === "AYT" || ad.includes("AYT");
  }
  return true;
}

/** Filtrelenmiş sınavlar — takvim / yaklaşanlar (tür filtresi). */
function gdtFiltered() {
  return allExams.filter(gdtRowMatchesFilter);
}

function gdtRowMatchesMonth(row) {
  if (!gdtMonthKey) return true;
  var k = gdtExamDateKey(row);
  return k.length >= 7 && k.slice(0, 7) === gdtMonthKey;
}

/** Tablo: tür + ay; tarihe göre sıralı tam liste (sayfalama öncesi). */
function gdtFilteredForTable() {
  return gdtFiltered()
    .filter(gdtRowMatchesMonth)
    .slice()
    .sort(gdtSortByDate);
}

function gdtBuildMonthOptions() {
  var sel = document.getElementById("gdtMonthFilter");
  if (!sel) return;
  var prev = gdtMonthKey;
  var seen = {};
  for (var i = 0; i < allExams.length; i++) {
    var k = gdtExamDateKey(allExams[i]);
    if (k.length >= 7) seen[k.slice(0, 7)] = true;
  }
  var keys = Object.keys(seen).sort();
  sel.innerHTML = "";
  var optAll = document.createElement("option");
  optAll.value = "";
  optAll.textContent = "Tüm Aylar";
  sel.appendChild(optAll);
  for (var j = 0; j < keys.length; j++) {
    var key = keys[j];
    var y = parseInt(key.slice(0, 4), 10);
    var m = parseInt(key.slice(5, 7), 10) - 1;
    var opt = document.createElement("option");
    opt.value = key;
    opt.textContent = TR_MONTH_NAMES[m] + " " + y;
    sel.appendChild(opt);
  }
  if (prev && seen[prev]) sel.value = prev;
  else {
    sel.value = "";
    gdtMonthKey = "";
  }
}

function gdtUpdatePaginationUi(total, pageCount) {
  var info = document.getElementById("gdtPageInfo");
  var prev = document.getElementById("gdtPrevPage");
  var next = document.getElementById("gdtNextPage");
  var ps = gdtPageSize;
  if (info) {
    if (total === 0) {
      info.textContent = "0 kayıt";
    } else {
      var from = gdtPageIndex * ps + 1;
      var to = Math.min((gdtPageIndex + 1) * ps, total);
      info.textContent =
        from + "–" + to + " / " + total + " · Sayfa " + (gdtPageIndex + 1) + "/" + pageCount;
    }
  }
  if (prev) prev.disabled = gdtPageIndex <= 0 || total === 0;
  if (next) next.disabled = gdtPageIndex >= pageCount - 1 || total === 0;
}

function gdtRefreshMainTable() {
  var fullList = gdtFilteredForTable();
  var total = fullList.length;
  var pageCount = total === 0 ? 1 : Math.ceil(total / gdtPageSize);
  if (gdtPageIndex >= pageCount) gdtPageIndex = Math.max(0, pageCount - 1);
  var start = gdtPageIndex * gdtPageSize;
  var pageRows = fullList.slice(start, start + gdtPageSize);
  if (typeof window.renderGlobalDenemeTakvimDataTable === "function") {
    window.renderGlobalDenemeTakvimDataTable(pageRows);
  }
  gdtUpdatePaginationUi(total, pageCount);
}

function gdtSortByDate(a, b) {
  var ka = gdtExamDateKey(a);
  var kb = gdtExamDateKey(b);
  if (ka !== kb) return ka < kb ? -1 : 1;
  return String(a.adi).localeCompare(String(b.adi), "tr");
}

async function gdtLoad() {
  var res = await databasesListDocumentsOrSoft({
    databaseId: APPWRITE_DATABASE_ID,
    collectionId: APPWRITE_COLLECTION_GLOBAL_EXAMS,
    queries: [Query.limit(2500)],
  });
  var docs = res.documents || [];
  allExams = docs.map(gdtParseDoc).filter(function (r) {
    return r.adi && gdtExamDateKey(r);
  });
  allExams.sort(gdtSortByDate);
}

function gdtExamsOnDay(y, m, day) {
  var key = gdtDayKey(y, m, day);
  return gdtFiltered().filter(function (r) {
    return gdtExamDateKey(r) === key;
  });
}

function gdtRenderUpcoming() {
  var ul = document.getElementById("danaTakvimUpcomingList");
  var skel = document.getElementById("danaTakvimUpcomingSkeleton");
  var empty = document.getElementById("danaTakvimEmpty");
  var lead = document.querySelector(".dana-takvim-upcoming-lead");
  if (lead) {
    lead.textContent =
      gdtFilter === "YKS"
        ? "Bugünden sonraki ilk 3 deneme (merkezi takvim)"
        : "Bugünden sonraki ilk 3 deneme (" + gdtFilter + " filtresi)";
  }
  if (skel) skel.hidden = true;
  var list = gdtFiltered().slice().sort(gdtSortByDate);
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayKey = gdtDayKey(today.getFullYear(), today.getMonth(), today.getDate());
  var upcoming = [];
  for (var i = 0; i < list.length; i++) {
    var k = gdtExamDateKey(list[i]);
    if (k >= todayKey) upcoming.push(list[i]);
    if (upcoming.length >= 3) break;
  }
  if (!ul) return;
  ul.innerHTML = "";
  if (!upcoming.length) {
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  upcoming.forEach(function (r) {
    var li = document.createElement("li");
    li.className = "dana-takvim-upcoming-item";
    var dk = gdtExamDateKey(r);
    li.innerHTML =
      '<span class="dana-takvim-upcoming-item__badge"><span>' +
      escapeHtml(r.sinavTuru || "YKS") +
      "</span></span>" +
      '<div style="flex:1;min-width:0;align-self:center">' +
      '<p class="dana-takvim-upcoming-item__title">' +
      escapeHtml(r.adi) +
      "</p>" +
      '<p style="margin:0.2rem 0 0;font-size:0.78rem;font-weight:600;color:#64748b">' +
      escapeHtml(r.yayinevi || "—") +
      " · " +
      escapeHtml(dk) +
      "</p></div>";
    li.addEventListener("click", function () {
      gdtOpenAgendaForKey(dk);
    });
    ul.appendChild(li);
  });
}

/** Figma tarzı date picker: turuncu tema, önceki/sonraki ay günleri soluk. */
var GDT_CAL_OUT_DAY =
  "flex h-8 w-8 select-none items-center justify-center rounded-lg text-sm font-medium text-gray-300 pointer-events-none tabular-nums";

function gdtRenderCalendar() {
  var grid = document.getElementById("danaCalGrid");
  var title = document.getElementById("danaCalTitle");
  if (!grid || !title) return;
  title.textContent = TR_MONTH_NAMES[gdtViewM] + " " + gdtViewY;
  grid.innerHTML = "";

  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayKey = gdtDayKey(today.getFullYear(), today.getMonth(), today.getDate());

  var y = gdtViewY;
  var m = gdtViewM;
  var first = new Date(y, m, 1);
  var startPad = (first.getDay() + 6) % 7;
  var lastDay = new Date(y, m + 1, 0).getDate();
  var prevM = m === 0 ? 11 : m - 1;
  var prevY = m === 0 ? y - 1 : y;
  var daysInPrevMonth = new Date(prevY, prevM + 1, 0).getDate();

  var cellCount = 0;
  var p;
  for (p = 0; p < startPad; p++) {
    var leadDay = daysInPrevMonth - startPad + p + 1;
    var outLead = document.createElement("div");
    outLead.className = GDT_CAL_OUT_DAY;
    outLead.textContent = String(leadDay);
    outLead.setAttribute("aria-hidden", "true");
    grid.appendChild(outLead);
    cellCount++;
  }

  for (var d = 1; d <= lastDay; d++) {
    var key = gdtDayKey(y, m, d);
    var exams = gdtExamsOnDay(y, m, d);
    var hasExam = exams.length > 0;
    var isSel = key === gdtSelectedKey;
    var isToday = key === todayKey;

    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("data-gdt-day", key);

    var base =
      "relative flex h-8 w-8 cursor-pointer flex-col items-center justify-center rounded-lg text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-400 focus-visible:ring-offset-0 tabular-nums ";
    if (isSel) {
      btn.className =
        base +
        "bg-orange-500 text-white shadow-md hover:bg-orange-600";
    } else if (isToday) {
      btn.className =
        base + "bg-orange-100 text-orange-700 hover:bg-orange-200";
    } else {
      btn.className = base + "text-gray-800 hover:bg-gray-100";
    }

    var dotClass = isSel ? "bg-white" : "bg-orange-400";
    btn.innerHTML =
      '<span class="leading-none">' +
      d +
      "</span>" +
      (hasExam
        ? '<span class="' +
          dotClass +
          ' absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full opacity-95" aria-hidden="true"></span>'
        : "");
    grid.appendChild(btn);
    cellCount++;
  }

  var trail = 1;
  while (cellCount % 7 !== 0) {
    var outTrail = document.createElement("div");
    outTrail.className = GDT_CAL_OUT_DAY;
    outTrail.textContent = String(trail);
    outTrail.setAttribute("aria-hidden", "true");
    grid.appendChild(outTrail);
    trail++;
    cellCount++;
  }
}

function gdtOpenAgendaForKey(dayKey) {
  gdtSelectedKey = dayKey || "";
  var panel = document.getElementById("danaAgendaPanel");
  var tEl = document.getElementById("danaAgendaTitle");
  var body = document.getElementById("danaAgendaBody");
  var selTitle = document.getElementById("danaCalSelectedDayTitle");
  if (!panel || !body) return;
  var parts = gdtSelectedKey.split("-");
  var y = parseInt(parts[0], 10);
  var m = parseInt(parts[1], 10) - 1;
  var d = parseInt(parts[2], 10);
  var dateLabel = isNaN(d) ? "—" : d + " " + TR_MONTH_NAMES[m] + " " + y;
  if (selTitle) selTitle.textContent = "Seçili gün: " + dateLabel;
  if (tEl) tEl.textContent = dateLabel;
  var ymd = gdtSelectedKey;
  var exams = gdtFiltered().filter(function (r) {
    return gdtExamDateKey(r) === ymd;
  });
  exams.sort(gdtSortByDate);
  if (!exams.length) {
    body.innerHTML =
      '<div class="gdt-agenda-empty">' +
      '<span class="gdt-agenda-empty__icon" aria-hidden="true"><i class="fa-regular fa-calendar-xmark"></i></span>' +
      '<p class="gdt-agenda-empty__text">Bu gün için kayıtlı deneme yok.</p></div>';
  } else {
    body.innerHTML = exams
      .map(function (r) {
        return (
          '<article class="dana-agenda-card">' +
          '<p class="dana-agenda-card__name">' +
          escapeHtml(r.adi) +
          "</p>" +
          '<p class="dana-agenda-card__type">' +
          escapeHtml(r.yayinevi || "—") +
          " · " +
          escapeHtml(r.sinavTuru || "YKS") +
          "</p></article>"
        );
      })
      .join("");
  }
  panel.hidden = false;
  panel.setAttribute("aria-hidden", "false");
  gdtRenderCalendar();
}

function gdtCloseAgenda() {
  var panel = document.getElementById("danaAgendaPanel");
  if (!panel) return;
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
}

function gdtSetFilter(f) {
  gdtFilter = f || "YKS";
  gdtPageIndex = 0;
  document.querySelectorAll("[data-dana-takvim-filter]").forEach(function (b) {
    var on = b.getAttribute("data-dana-takvim-filter") === gdtFilter;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  gdtRenderUpcoming();
  gdtRenderCalendar();
  if (gdtSelectedKey) gdtOpenAgendaForKey(gdtSelectedKey);
  gdtRefreshMainTable();
}

function gdtBindOnce() {
  if (gdtBound) return;
  gdtBound = true;
  var prev = document.getElementById("danaCalPrev");
  var next = document.getElementById("danaCalNext");
  if (prev) {
    prev.addEventListener("click", function () {
      gdtViewM--;
      if (gdtViewM < 0) {
        gdtViewM = 11;
        gdtViewY--;
      }
      gdtRenderCalendar();
    });
  }
  if (next) {
    next.addEventListener("click", function () {
      gdtViewM++;
      if (gdtViewM > 11) {
        gdtViewM = 0;
        gdtViewY++;
      }
      gdtRenderCalendar();
    });
  }
  document.querySelectorAll("[data-dana-takvim-filter]").forEach(function (b) {
    b.addEventListener("click", function () {
      var f = b.getAttribute("data-dana-takvim-filter");
      if (f) gdtSetFilter(f);
    });
  });
  var monthSel = document.getElementById("gdtMonthFilter");
  if (monthSel) {
    monthSel.addEventListener("change", function () {
      gdtMonthKey = String(monthSel.value || "");
      gdtPageIndex = 0;
      gdtRefreshMainTable();
    });
  }
  var pageSizeSel = document.getElementById("gdtPageSize");
  if (pageSizeSel) {
    pageSizeSel.addEventListener("change", function () {
      var n = parseInt(String(pageSizeSel.value), 10);
      gdtPageSize = n === 20 || n === 50 ? n : 10;
      gdtPageIndex = 0;
      gdtRefreshMainTable();
    });
  }
  var prevPg = document.getElementById("gdtPrevPage");
  var nextPg = document.getElementById("gdtNextPage");
  if (prevPg) {
    prevPg.addEventListener("click", function () {
      if (gdtPageIndex <= 0) return;
      gdtPageIndex--;
      gdtRefreshMainTable();
    });
  }
  if (nextPg) {
    nextPg.addEventListener("click", function () {
      var total = gdtFilteredForTable().length;
      var pageCount = total === 0 ? 1 : Math.ceil(total / gdtPageSize);
      if (gdtPageIndex >= pageCount - 1) return;
      gdtPageIndex++;
      gdtRefreshMainTable();
    });
  }
  var grid = document.getElementById("danaCalGrid");
  if (grid) {
    grid.addEventListener("click", function (ev) {
      var cell = ev.target.closest && ev.target.closest("[data-gdt-day]");
      if (!cell || !grid.contains(cell)) return;
      var key = cell.getAttribute("data-gdt-day");
      if (key) gdtOpenAgendaForKey(key);
    });
  }
  var cls = document.getElementById("danaAgendaClose");
  var bd = document.getElementById("danaAgendaBackdrop");
  if (cls) cls.addEventListener("click", gdtCloseAgenda);
  if (bd) bd.addEventListener("click", gdtCloseAgenda);
  document.addEventListener("keydown", function (ev) {
    if (ev.key !== "Escape") return;
    var panel = document.getElementById("danaAgendaPanel");
    if (panel && !panel.hidden) gdtCloseAgenda();
  });
}

export async function initGlobalDenemeTakvimReadonly() {
  var root = document.getElementById("denemeAnalizTakvimRoot");
  if (!root) return;
  gdtBindOnce();
  var skel = document.getElementById("danaTakvimUpcomingSkeleton");
  var empty = document.getElementById("danaTakvimEmpty");
  if (skel) skel.hidden = false;
  if (empty) empty.hidden = true;
  try {
    await gdtLoad();
  } catch (e) {
    console.error("[gdt]", e);
  }
  if (skel) skel.hidden = true;
  if (!gdtFiltered().length) {
    if (empty) {
      empty.hidden = false;
      var t = document.getElementById("danaTakvimEmptyTitle");
      var h = document.getElementById("danaTakvimEmptyHint");
      if (t) t.textContent = "Merkezi takvimde kayıt yok";
      if (h) h.textContent = "Kurucu panelinden denemeler.net verisini içe aktarın.";
    }
  } else if (empty) empty.hidden = true;
  gdtBuildMonthOptions();
  var psEl = document.getElementById("gdtPageSize");
  if (psEl) {
    gdtPageSize = parseInt(String(psEl.value), 10);
    if (gdtPageSize !== 20 && gdtPageSize !== 50) gdtPageSize = 10;
  }
  gdtPageIndex = 0;
  gdtSetFilter(gdtFilter);
}

if (typeof window !== "undefined") {
  window.initGlobalDenemeTakvimReadonly = initGlobalDenemeTakvimReadonly;
}
