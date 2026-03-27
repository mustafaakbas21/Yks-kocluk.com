/**
 * Öğrenci paneli — Hedef Simülatörü (Chart.js + Appwrite Universities / Programs).
 * Veri: import-excel-to-appwrite.js, auto-fetch-yokatlas.js veya yokatlas-py ile Appwrite’a aktarılır.
 */
import { YKS2026_Mufredat } from "./yks-mufredat.js";
import { buildProgramFromAppwriteV2 } from "./net-sihirbazi-engine.js";
import {
  ensureHedefSimulatorAppwriteData,
  getHedefAppwriteUniversities,
  loadHedefProgramsForUniversity,
  getCachedHedefProgramsForUniversity,
  hedefUniDisplayName,
  hedefProgramDisplayName,
} from "./hedef-appwrite-catalog.js";
import {
  buildSimulatorRows,
  netTemplateTableHtml,
  sumGap,
  wireSearchFilterForSelect,
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

function populateOspHedefSelects() {
  var uniSel = document.getElementById("ospHedefUniSelect");
  var deptSel = document.getElementById("ospHedefDeptSelect");
  if (!uniSel || !deptSel) return;
  var prevUni = uniSel.value ? String(uniSel.value) : "";
  var prevDept = deptSel.value ? String(deptSel.value) : "";

  var unis = getHedefAppwriteUniversities();
  uniSel.innerHTML = '<option value="">— Üniversite seçin —</option>';
  unis.forEach(function (u) {
    var o = document.createElement("option");
    o.value = u.$id;
    o.textContent = hedefUniDisplayName(u) || u.$id;
    uniSel.appendChild(o);
  });
  if (prevUni && unis.some(function (x) {
    return x.$id === prevUni;
  }))
    uniSel.value = prevUni;

  var uniPick = uniSel.value ? String(uniSel.value) : "";
  var df = document.getElementById("ospHedefDeptFilter");
  if (!uniPick) {
    deptSel.innerHTML = '<option value="">— Önce üniversite seçin —</option>';
    deptSel.disabled = true;
    if (df) df.disabled = true;
    return;
  }

  var cached = getCachedHedefProgramsForUniversity(uniPick);
  if (cached === null) {
    deptSel.innerHTML = '<option value="">— Bölümler yükleniyor… —</option>';
    deptSel.disabled = true;
    if (df) df.disabled = true;
    loadHedefProgramsForUniversity(uniPick).then(function () {
      try {
        populateOspHedefSelects();
        renderOspHedefSimulator();
      } catch (e) {
        console.error("[OSP Hedef] programs load:", e);
      }
    });
    return;
  }

  deptSel.disabled = false;
  if (df) df.disabled = false;
  deptSel.innerHTML = '<option value="">— Bölüm seçin —</option>';
  cached.forEach(function (p) {
    var o2 = document.createElement("option");
    o2.value = p.$id;
    o2.textContent = hedefProgramDisplayName(p) || p.$id;
    deptSel.appendChild(o2);
  });
  if (prevDept && cached.some(function (x) {
    return x.$id === prevDept;
  }))
    deptSel.value = prevDept;
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
  var deptId = deptSel && deptSel.value ? String(deptSel.value) : "";

  var program = null;
  try {
    var uDoc = getHedefAppwriteUniversities().find(function (u) {
      return u.$id === uniId;
    });
    var plist = getCachedHedefProgramsForUniversity(uniId) || [];
    var pDoc = plist.find(function (p) {
      return p.$id === deptId;
    });
    program = uDoc && pDoc ? buildProgramFromAppwriteV2(uDoc, pDoc) : null;
  } catch (e) {
    console.error("[OSP Hedef] program çözümü:", e);
    program = null;
  }

  var student = getStudentLike();
  var uEl = document.getElementById("ospHedefUni");
  var bEl = document.getElementById("ospHedefBolum");
  if (program) {
    if (uEl) uEl.textContent = program.university;
    if (bEl) {
      var tt = program.targetTytNet != null ? Number(program.targetTytNet) : 0;
      var ta = program.targetAytNet != null ? Number(program.targetAytNet) : 0;
      bEl.textContent =
        program.department +
        " — Hedef TYT/AYT: " +
        (isNaN(tt) ? "—" : tt.toFixed(1)) +
        " / " +
        (isNaN(ta) ? "—" : ta.toFixed(1)) +
        " (Appwrite)";
    }
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
      ? " — Appwrite Programs."
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
            label: "Hedef net (Programs)",
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
  window.__ospHedefRender = renderOspHedefSimulator;
  var uniSel = document.getElementById("ospHedefUniSelect");
  if (!uniSel || uniSel.dataset.ospHedefWired) return;
  uniSel.dataset.ospHedefWired = "1";

  ensureHedefSimulatorAppwriteData()
    .then(function () {
      try {
        populateOspHedefSelects();
        var deptSel = document.getElementById("ospHedefDeptSelect");
        var uniFilter = document.getElementById("ospHedefUniFilter");
        var deptFilter = document.getElementById("ospHedefDeptFilter");
        if (uniSel && deptSel) {
          wireSearchFilterForSelect(uniFilter, uniSel);
          wireSearchFilterForSelect(deptFilter, deptSel);
          uniSel.addEventListener("change", function () {
            try {
              populateOspHedefSelects();
              renderOspHedefSimulator();
            } catch (e) {
              console.error("[OSP Hedef] uni change:", e);
            }
          });
          deptSel.addEventListener("change", function () {
            try {
              renderOspHedefSimulator();
            } catch (e2) {
              console.error("[OSP Hedef] dept change:", e2);
            }
          });
        }
        renderOspHedefSimulator();
      } catch (err) {
        console.error("[OSP Hedef] kurulum:", err);
        renderOspHedefSimulator();
      }
    })
    .catch(function (err) {
      console.error("[OSP Hedef] Appwrite:", err);
      try {
        populateOspHedefSelects();
        renderOspHedefSimulator();
      } catch (_e) {}
    });
}
