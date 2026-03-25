/**
 * YKS — Hedef üniversite / bölüm seçici (data/uni-bolumler-tr.json)
 * window.YksHedefUniPicker
 */
(function (global) {
  var DATA = null;
  var loadPromise = null;

  function loadData() {
    if (DATA) return Promise.resolve(DATA);
    if (loadPromise) return loadPromise;
    loadPromise = fetch("data/uni-bolumler-tr.json")
      .then(function (r) {
        if (!r.ok) throw new Error("json");
        return r.json();
      })
      .then(function (j) {
        var raw = Array.isArray(j.universities) ? j.universities : [];
        DATA = dedupeUniversitiesByNormName(raw);
        loadPromise = null;
        return DATA;
      })
      .catch(function () {
        DATA = [];
        loadPromise = null;
        return DATA;
      });
    return loadPromise;
  }

  function norm(s) {
    return String(s || "")
      .toLocaleLowerCase("tr")
      .replace(/\s+/g, " ")
      .trim();
  }

  /** Aynı görünen üniversite adı listede yalnızca bir kez (ilk kayıt korunur). */
  function dedupeUniversitiesByNormName(arr) {
    var seen = Object.create(null);
    var out = [];
    (arr || []).forEach(function (u) {
      if (!u || !u.name) return;
      var k = norm(u.name);
      if (!k || seen[k]) return;
      seen[k] = true;
      var copy = Object.assign({}, u);
      if (Array.isArray(copy.departments)) {
        copy.departments = dedupeDepartmentStrings(copy.departments);
      }
      out.push(copy);
    });
    return out;
  }

  function dedupeDepartmentStrings(depts) {
    var seen = Object.create(null);
    var out = [];
    (depts || []).forEach(function (d) {
      var k = norm(String(d));
      if (!k || seen[k]) return;
      seen[k] = true;
      out.push(String(d).trim());
    });
    return out;
  }

  function findUniByName(name) {
    if (!DATA || !name) return null;
    var n = String(name).trim();
    for (var i = 0; i < DATA.length; i++) {
      if (DATA[i].name === n) return DATA[i];
    }
    return null;
  }

  function searchUniversities(q, limit) {
    limit = limit || 12;
    if (!DATA || !q) return [];
    var nq = norm(q);
    if (!nq) return [];
    var out = [];
    for (var i = 0; i < DATA.length && out.length < limit; i++) {
      if (norm(DATA[i].name).indexOf(nq) !== -1) out.push(DATA[i]);
    }
    return out;
  }

  function fillDepartmentSelect(sel, uniName, selectedDep) {
    if (!sel) return;
    sel.innerHTML = "";
    var ph = document.createElement("option");
    ph.value = "";
    ph.textContent = uniName ? "— Bölüm / program seçin —" : "— Önce üniversite seçin —";
    sel.appendChild(ph);
    sel.disabled = !uniName;
    if (!uniName) return;
    var u = findUniByName(uniName);
    if (!u || !Array.isArray(u.departments)) return;
    dedupeDepartmentStrings(u.departments).forEach(function (d) {
      var o = document.createElement("option");
      o.value = d;
      o.textContent = d;
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
      hidden.value = u.name;
      search.value = "";
      if (picked) picked.textContent = "Seçilen üniversite: " + u.name;
      fillDepartmentSelect(depSel, u.name, "");
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
          '<div class="yks-uni-dropdown__empty">Sonuç yok — farklı anahtar kelime deneyin.</div>';
        dd.hidden = false;
        return;
      }
      dd.innerHTML = list
        .map(function (u) {
          return (
            '<button type="button" class="yks-uni-dropdown__item" data-uni-name="' +
            encodeURIComponent(u.name) +
            '">' +
            escapeHtml(u.name) +
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
    loadData().then(function () {
      var pu = document.getElementById("editPortalUsername");
      if (pu) pu.value = portalUsername || "";
      var hidden = document.getElementById("editTargetUniversity");
      var search = document.getElementById("editTargetUniSearch");
      var picked = document.getElementById("editTargetUniPicked");
      var depSel = document.getElementById("editTargetDepartment");
      if (hidden) hidden.value = uniName || "";
      if (search) search.value = "";
      if (picked) picked.textContent = uniName ? "Seçilen üniversite: " + uniName : "";
      fillDepartmentSelect(depSel, uniName || "", depName || "");
    });
  }

  var inited = false;

  global.YksHedefUniPicker = {
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
})(window);
