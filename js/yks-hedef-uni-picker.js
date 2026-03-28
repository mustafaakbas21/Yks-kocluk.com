/**
 * YKS — Hedef üniversite / bölüm seçici (src/data/yks-data.json).
 * window.YksHedefUniPicker — öğrenci ekle/düzen formları (koc-panel.html).
 */
import {
  ensureHedefSimulatorAppwriteData,
  getHedefAppwriteUniversities,
  loadHedefProgramsForUniversity,
  hedefUniDisplayName,
  hedefProgramDisplayName,
} from "./hedef-appwrite-catalog.js";

var loadPromise = null;

function loadData() {
  if (loadPromise) return loadPromise;
  loadPromise = ensureHedefSimulatorAppwriteData()
    .then(function () {
      loadPromise = null;
      return getHedefAppwriteUniversities();
    })
    .catch(function (e) {
      loadPromise = null;
      console.warn("[YksHedefUniPicker] yks-data.json:", e && e.message ? e.message : e);
      return getHedefAppwriteUniversities();
    });
  return loadPromise;
}

function norm(s) {
  return String(s || "")
    .toLocaleLowerCase("tr")
    .replace(/\s+/g, " ")
    .trim();
}

function findUniByName(name) {
  if (!name) return null;
  var n = String(name).trim();
  var list = getHedefAppwriteUniversities();
  for (var i = 0; i < list.length; i++) {
    if (hedefUniDisplayName(list[i]) === n) return list[i];
  }
  return null;
}

function searchUniversities(q, limit) {
  limit = limit || 12;
  var nq = norm(q);
  if (!nq) return [];
  var list = getHedefAppwriteUniversities();
  var out = [];
  for (var i = 0; i < list.length && out.length < limit; i++) {
    var u = list[i];
    if (norm(hedefUniDisplayName(u)).indexOf(nq) !== -1) out.push(u);
  }
  return out;
}

/**
 * @returns {Promise<void>}
 */
function fillDepartmentSelect(sel, uniName, selectedDep) {
  if (!sel) return Promise.resolve();
  sel.innerHTML = "";
  var ph = document.createElement("option");
  ph.value = "";
  ph.textContent = uniName ? "— Bölümler yükleniyor… —" : "— Önce üniversite seçin —";
  sel.appendChild(ph);
  sel.disabled = true;
  if (!uniName) {
    ph.textContent = "— Önce üniversite seçin —";
    return Promise.resolve();
  }
  var u = findUniByName(uniName);
  if (!u || !u.$id) {
    ph.textContent = "— Üniversite bulunamadı —";
    return Promise.resolve();
  }
  return loadHedefProgramsForUniversity(String(u.$id)).then(function (programs) {
    sel.innerHTML = "";
    ph = document.createElement("option");
    ph.value = "";
    ph.textContent = "— Bölüm / program seçin —";
    sel.appendChild(ph);
    sel.disabled = false;
    (programs || []).forEach(function (p) {
      var o = document.createElement("option");
      var label = hedefProgramDisplayName(p) || String(p.$id || "");
      o.value = label;
      o.textContent = label;
      sel.appendChild(o);
    });
    if (selectedDep) {
      var found = false;
      for (var j = 0; j < sel.options.length; j++) {
        if (sel.options[j].value === selectedDep) {
          found = true;
          break;
        }
      }
      if (found) sel.value = selectedDep;
    }
  });
}

function bindPicker(cfg) {
  var search = document.getElementById(cfg.searchId);
  var hidden = document.getElementById(cfg.hiddenUniId);
  var dd = document.getElementById(cfg.dropdownId);
  var picked = document.getElementById(cfg.pickedId);
  var depSel = document.getElementById(cfg.depSelectId);
  if (!search || !hidden || !dd || !depSel) return;

  function closeDd() {
    dd.hidden = true;
    dd.innerHTML = "";
  }

  function pickUni(u) {
    var disp = hedefUniDisplayName(u);
    hidden.value = disp;
    search.value = "";
    if (picked) picked.textContent = "Seçilen üniversite: " + disp;
    fillDepartmentSelect(depSel, disp, "");
    closeDd();
  }

  search.addEventListener("input", function () {
    var q = search.value;
    if (!q || q.length < 1) {
      closeDd();
      return;
    }
    var list = searchUniversities(q, 14);
    if (!list.length) {
      dd.innerHTML =
        '<div class="yks-uni-dropdown__empty">Sonuç yok — farklı anahtar kelime deneyin veya Appwrite’ta üniversite kaydı olduğundan emin olun.</div>';
      dd.hidden = false;
      return;
    }
    dd.innerHTML = list
      .map(function (u) {
        var disp = hedefUniDisplayName(u);
        return (
          '<button type="button" class="yks-uni-dropdown__item" data-uni-name="' +
          encodeURIComponent(disp) +
          '">' +
          escapeHtml(disp) +
          "</button>"
        );
      })
      .join("");
    dd.hidden = false;
  });

  dd.addEventListener("click", function (e) {
    var btn = e.target.closest("[data-uni-name]");
    if (!btn) return;
    e.preventDefault();
    var name = decodeURIComponent(btn.getAttribute("data-uni-name") || "");
    var u = findUniByName(name);
    if (u) pickUni(u);
  });

  document.addEventListener("click", function (e) {
    if (!search.contains(e.target) && !dd.contains(e.target)) closeDd();
  });

  search.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeDd();
  });
}

function escapeHtml(t) {
  if (t == null) return "";
  var d = document.createElement("div");
  d.textContent = String(t);
  return d.innerHTML;
}

function resetAddForm() {
  var search = document.getElementById("st_targetUniSearch");
  var hidden = document.getElementById("st_targetUniversity");
  var picked = document.getElementById("st_targetUniPicked");
  var depSel = document.getElementById("st_targetDepartment");
  if (search) search.value = "";
  if (hidden) hidden.value = "";
  if (picked) picked.textContent = "";
  fillDepartmentSelect(depSel, "", "");
}

function fillEditForm(portalUsername, uniName, depName) {
  return loadData().then(function () {
    var pu = document.getElementById("editPortalUsername");
    if (pu) pu.value = portalUsername || "";
    var hidden = document.getElementById("editTargetUniversity");
    var search = document.getElementById("editTargetUniSearch");
    var picked = document.getElementById("editTargetUniPicked");
    var depSel = document.getElementById("editTargetDepartment");
    var un = uniName || "";
    if (hidden) hidden.value = un;
    if (search) search.value = "";
    if (picked) picked.textContent = un ? "Seçilen üniversite: " + un : "";
    return fillDepartmentSelect(depSel, un, depName || "");
  });
}

var inited = false;

window.YksHedefUniPicker = {
  loadData: loadData,
  init: function () {
    if (inited) return loadData();
    inited = true;
    return loadData().then(function () {
      bindPicker({
        searchId: "st_targetUniSearch",
        hiddenUniId: "st_targetUniversity",
        dropdownId: "st_targetUniDropdown",
        pickedId: "st_targetUniPicked",
        depSelectId: "st_targetDepartment",
      });
      bindPicker({
        searchId: "editTargetUniSearch",
        hiddenUniId: "editTargetUniversity",
        dropdownId: "editTargetUniDropdown",
        pickedId: "editTargetUniPicked",
        depSelectId: "editTargetDepartment",
      });
    });
  },
  resetAddForm: resetAddForm,
  fillEditForm: fillEditForm,
  findUniByName: function (n) {
    return findUniByName(n);
  },
};
