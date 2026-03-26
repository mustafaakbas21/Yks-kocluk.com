/**
 * Öğrenci paneli — Hedef Simülatörü (Chart.js + YÖK Atlas örnek tablosu)
 * Müfredat ağacı merkezi kaynak: `yks-mufredat.js`.
 */
import { YKS2026_Mufredat } from "./yks-mufredat.js";
import { findAtlasProgramById, TR_UNIVERSITIES_UNIQUE, PROGRAM_TEMPLATES_UI } from "./yok-atlas-data.js";
import {
  buildSimulatorRows,
  netTemplateTableHtml,
  sumGap,
  wireSearchFilterForSelect,
  sortNamedItemsAlphabeticalTr,
  filterSimulatorRowsForStudentAlan,
  studentAytTableSectionTitle,
  normalizeStudentYksAlanKey,
} from "./hedef-atlas-helpers.js";

export { YKS2026_Mufredat };

var ospHedefRadarChart = null;

function getStudentLike() {
  var O = window.OSP;
  if (!O) return null;
  return {
    currentTytNet: O.coachCurrentTytNet,
    targetTytNet: O.coachTargetTytNet,
  };
}

export function renderOspHedefSimulator() {
  var bars = document.getElementById("ospHedefBars");
  var gapEl = document.getElementById("ospHedefGapBanner");
  var canvas = document.getElementById("ospHedefRadarCanvas");
  var tableWrap = document.getElementById("ospHedefNetTableWrap");
  if (!bars || !gapEl) return;

  var uniSel = document.getElementById("ospHedefUniSelect");
  var deptSel = document.getElementById("ospHedefDeptSelect");
  var uniId = uniSel && uniSel.value ? String(uniSel.value) : "";
  var tmplId = deptSel && deptSel.value ? String(deptSel.value) : "";
  var atlasId = uniId && tmplId ? uniId + "__" + tmplId : "";

  var program = atlasId ? findAtlasProgramById(atlasId) : null;
  var student = getStudentLike();
  var uEl = document.getElementById("ospHedefUni");
  var bEl = document.getElementById("ospHedefBolum");
  if (program) {
    if (uEl) uEl.textContent = program.university;
    if (bEl) bEl.textContent = program.department + " — Taban (örnek): " + program.baseScore2025;
  } else if (window.OSP) {
    var O = window.OSP;
    if (uEl && O.targetUniversity) uEl.textContent = O.targetUniversity;
    else if (uEl) uEl.textContent = "Hedef üniversite";
    if (bEl && O.targetDepartment) bEl.textContent = O.targetDepartment + " — Hedef net";
    else if (bEl) bEl.textContent = "Koç kaydından hedef net";
  }
  var alanKey = normalizeStudentYksAlanKey(student);
  var rows = filterSimulatorRowsForStudentAlan(buildSimulatorRows(program, student), alanKey);

  var labels = rows.map(function (r) {
    return r.label;
  });
  var current = rows.map(function (r) {
    return r.current;
  });
  var target = rows.map(function (r) {
    return r.target;
  });
  var totalGap = sumGap(rows);

  bars.innerHTML = rows
    .map(function (r) {
      var pct = Math.min(100, (r.current / r.target) * 100);
      var gap = Math.max(0, r.target - r.current);
      var ok = r.current >= r.target;
      return (
        '<div class="osp-hedef-bar-block"><div class="osp-hedef-bar-head"><span>' +
        r.label +
        "</span><span>" +
        r.current.toFixed(1) +
        " / " +
        r.target.toFixed(1) +
        ' net</span></div><div class="osp-hedef-bar-track"><div class="osp-hedef-bar-fill ' +
        (ok ? "osp-hedef-bar-fill--ok" : "") +
        '" style="width:' +
        pct.toFixed(1) +
        '%"></div></div></div>'
      );
    })
    .join("");

  gapEl.textContent =
    "Kalan net farkı (branş toplamı): " +
    totalGap.toFixed(1) +
    (program
      ? " — Seçilen program: " + program.university + " · " + program.department + " (taban örnek: " + program.baseScore2025 + ")"
      : window.OSP &&
          window.OSP.coachCurrentTytNet != null &&
          window.OSP.coachTargetTytNet != null
        ? " — Koç kaydındaki güncel/hedef TYT netine göre ölçeklendirildi."
        : " — Program seçin veya koç panelinden net girin.");

  if (tableWrap)
    tableWrap.innerHTML = netTemplateTableHtml(rows, {
      aytSectionTitle: studentAytTableSectionTitle(alanKey),
    });

  if (canvas && typeof Chart !== "undefined") {
    var ctx = canvas.getContext("2d");
    if (ospHedefRadarChart) {
      ospHedefRadarChart.destroy();
      ospHedefRadarChart = null;
    }
    ospHedefRadarChart = new Chart(ctx, {
      type: "radar",
      data: {
        labels: labels,
        datasets: [
          {
            label: "Güncel net",
            data: current,
            borderColor: "#6c5ce7",
            backgroundColor: "rgba(108, 92, 231, 0.22)",
            pointBackgroundColor: "#6c5ce7",
          },
          {
            label: "Güncel hedef (YÖK şablonu / ölçek)",
            data: target,
            borderColor: "#10b981",
            backgroundColor: "rgba(16, 185, 129, 0.18)",
            pointBackgroundColor: "#059669",
          },
        ],
      },
      options: {
        scales: {
          r: {
            min: 0,
            suggestedMax: 45,
          },
        },
        plugins: {
          legend: { position: "bottom" },
        },
      },
    });
  }
}

export function wireOspHedefSimulator() {
  var uniSel = document.getElementById("ospHedefUniSelect");
  var deptSel = document.getElementById("ospHedefDeptSelect");
  var uniFilter = document.getElementById("ospHedefUniFilter");
  var deptFilter = document.getElementById("ospHedefDeptFilter");
  if (uniSel && deptSel && !uniSel.dataset.populated) {
    uniSel.dataset.populated = "1";
    uniSel.innerHTML = '<option value="">— Üniversite seçin —</option>';
    sortNamedItemsAlphabeticalTr(TR_UNIVERSITIES_UNIQUE).forEach(function (u) {
      var o = document.createElement("option");
      o.value = u.id;
      o.textContent = u.name;
      uniSel.appendChild(o);
    });
    deptSel.innerHTML = '<option value="">— Bölüm / program türü seçin —</option>';
    sortNamedItemsAlphabeticalTr(PROGRAM_TEMPLATES_UI).forEach(function (t) {
      var o = document.createElement("option");
      o.value = t.id;
      o.textContent = t.name;
      deptSel.appendChild(o);
    });
    wireSearchFilterForSelect(uniFilter, uniSel);
    wireSearchFilterForSelect(deptFilter, deptSel);
  }
  if (uniSel && deptSel && !uniSel.dataset.wired) {
    uniSel.dataset.wired = "1";
    deptSel.dataset.wired = "1";
    uniSel.addEventListener("change", function () {
      renderOspHedefSimulator();
    });
    deptSel.addEventListener("change", function () {
      renderOspHedefSimulator();
    });
  }
  window.__ospHedefRender = renderOspHedefSimulator;
}
