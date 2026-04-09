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

/** @type {{ id: string, adi: string, yayinevi: string, sinavTuru: string, tarihSaat: string }[]} */
var gdtRows = [];
var gdtFilter = "YKS";
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
  var t = String(row.sinavTuru || "").toUpperCase();
  if (gdtFilter === "YKS") return true;
  if (gdtFilter === "TYT") return t === "TYT" || t === "YKS";
  if (gdtFilter === "AYT") return t === "AYT" || t === "YKS";
  return true;
}

function gdtFiltered() {
  return gdtRows.filter(gdtRowMatchesFilter);
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
  gdtRows = docs.map(gdtParseDoc).filter(function (r) {
    return r.adi && gdtExamDateKey(r);
  });
  gdtRows.sort(gdtSortByDate);
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

function gdtRenderCalendar() {
  var grid = document.getElementById("danaCalGrid");
  var title = document.getElementById("danaCalTitle");
  if (!grid || !title) return;
  title.textContent = TR_MONTH_NAMES[gdtViewM] + " " + gdtViewY;
  grid.innerHTML = "";
  var today = new Date();
  today.setHours(0, 0, 0, 0);
  var todayKey = gdtDayKey(today.getFullYear(), today.getMonth(), today.getDate());
  var first = new Date(gdtViewY, gdtViewM, 1);
  var startPad = (first.getDay() + 6) % 7;
  var lastDay = new Date(gdtViewY, gdtViewM + 1, 0).getDate();
  var cellCount = 0;
  for (var p = 0; p < startPad; p++) {
    var ghost = document.createElement("div");
    ghost.className = "dana-cal__cell dana-cal__cell--muted dana-cal__cell--empty";
    ghost.setAttribute("aria-hidden", "true");
    grid.appendChild(ghost);
    cellCount++;
  }
  for (var d = 1; d <= lastDay; d++) {
    var exams = gdtExamsOnDay(gdtViewY, gdtViewM, d);
    var key = gdtDayKey(gdtViewY, gdtViewM, d);
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "dana-cal__cell dana-cal__cell--v2 dana-cal__cell--selectable";
    if (key === gdtSelectedKey) btn.classList.add("dana-cal__cell--selected");
    if (key === todayKey) btn.classList.add("dana-cal__cell--today");
    btn.setAttribute("data-gdt-day", key);
    var dots = "";
    var nDot = Math.min(exams.length, 3);
    for (var di = 0; di < nDot; di++) {
      dots += '<span class="dana-cal-dot dana-cal-dot--gen" aria-hidden="true"></span>';
    }
    btn.innerHTML =
      '<span class="dana-cal__num">' +
      d +
      "</span>" +
      (dots ? '<div class="dana-cal-dots">' + dots + "</div>" : "");
    grid.appendChild(btn);
    cellCount++;
  }
  while (cellCount % 7 !== 0) {
    var g2 = document.createElement("div");
    g2.className = "dana-cal__cell dana-cal__cell--muted dana-cal__cell--empty";
    g2.setAttribute("aria-hidden", "true");
    grid.appendChild(g2);
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
      '<p class="dana-agenda-empty" style="margin:0;color:#64748b;font-size:0.9rem">Bu gün için kayıtlı deneme yok.</p>';
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
  document.querySelectorAll("[data-dana-takvim-filter]").forEach(function (b) {
    var on = b.getAttribute("data-dana-takvim-filter") === gdtFilter;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  gdtRenderUpcoming();
  gdtRenderCalendar();
  if (gdtSelectedKey) gdtOpenAgendaForKey(gdtSelectedKey);
  if (typeof window.renderGlobalDenemeTakvimDataTable === "function") {
    window.renderGlobalDenemeTakvimDataTable(gdtFiltered());
  }
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
  gdtSetFilter(gdtFilter);
}

if (typeof window !== "undefined") {
  window.initGlobalDenemeTakvimReadonly = initGlobalDenemeTakvimReadonly;
}
