/**
 * TYT-AYT Net Sihirbazı V2 — Appwrite Universities + Programs; Türkçe sıralı menüler; güncel net = deneme yksBranchDetail (mock yok).
 * YKS Puan modülü aşağıda aynı dosyada.
 */
import { YKS2026_Mufredat } from "./yks-mufredat.js";
import { wireSearchFilterForSelect } from "./hedef-atlas-helpers.js";
import { hedefUniDisplayName, hedefProgramDisplayName } from "./hedef-appwrite-catalog.js";
import {
  buildProgramFromAppwriteV2,
  buildMotorDisplayRows,
  netSihirbaziSkeletonHtml,
  netSihirbaziV2ResultHtml,
} from "./net-sihirbazi-engine.js";
import {
  databases,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_UNIVERSITIES,
  APPWRITE_COLLECTION_PROGRAMS,
} from "./appwrite-config.js";
import { Query } from "./appwrite-browser.js";
import { createCurrentNetForRowResolver, hasAnyBranchNetData } from "./net-sihirbazi-current-nets.js";

export { YKS2026_Mufredat };

var NS_PAGE = 500;

/**
 * @param {{ uniSelectId: string, deptSelectId: string, tableWrapId: string, uniTitleId?: string, deptTitleId?: string, subtitleId?: string, uniFilterId?: string, deptFilterId?: string, resolveExams?: () => unknown }} options
 * resolveExams: seçili öğrencinin denemeleri (yksBranchDetail). Dizi veya Promise dönebilir. Yoksa güncel net 0 gösterilir.
 */
export function initNetSihirbazi(options) {
  var uSel = document.getElementById(options.uniSelectId);
  var dSel = document.getElementById(options.deptSelectId);
  var wrap = document.getElementById(options.tableWrapId);
  var uniTitle = options.uniTitleId ? document.getElementById(options.uniTitleId) : null;
  var deptTitle = options.deptTitleId ? document.getElementById(options.deptTitleId) : null;
  var subEl = options.subtitleId ? document.getElementById(options.subtitleId) : null;
  var uniFilter = options.uniFilterId ? document.getElementById(options.uniFilterId) : null;
  var deptFilter = options.deptFilterId ? document.getElementById(options.deptFilterId) : null;
  var resolveExams = typeof options.resolveExams === "function" ? options.resolveExams : null;
  if (!uSel || !dSel || !wrap) return;
  if (uSel.dataset.nsBound) return;
  uSel.dataset.nsBound = "1";

  /** @type {object[]} */
  var unis = [];
  /** @type {Record<string, object[]>} */
  var programsByUni = {};

  function renderEmptyState(msg) {
    try {
      if (uniTitle) uniTitle.textContent = "Üniversite ve bölüm seçin";
      if (deptTitle) deptTitle.textContent = "TYT-AYT Net Sihirbazı V2";
      if (subEl) {
        subEl.textContent =
          msg ||
          "Veri yalnızca Appwrite Universities / Programs koleksiyonlarından gelir. Önce üniversite, sonra yalnızca o üniversiteye ait bölümler.";
      }
      wrap.innerHTML =
        '<p class="net-sihirbazi-placeholder">Üniversite ve bölüm seçildiğinde analiz tablosu oluşturulur.</p>';
    } catch (e) {
      console.error("[Net Sihirbazı V2] renderEmptyState:", e);
    }
  }

  function resetDepartmentUi() {
    try {
      dSel.innerHTML = '<option value="">— Önce üniversite seçin —</option>';
      dSel.disabled = true;
      if (deptFilter) {
        deptFilter.disabled = true;
        deptFilter.value = "";
      }
    } catch (e) {
      console.error("[Net Sihirbazı V2] resetDepartmentUi:", e);
    }
  }

  function fillUniversitySelect() {
    try {
      uSel.innerHTML = '<option value="">— Üniversite seçin —</option>';
      unis.forEach(function (u) {
        var o = document.createElement("option");
        o.value = u.$id;
        o.textContent = hedefUniDisplayName(u) || u.$id;
        uSel.appendChild(o);
      });
    } catch (e) {
      console.error("[Net Sihirbazı V2] fillUniversitySelect:", e);
    }
  }

  function fillDepartmentSelect(list) {
    try {
      dSel.innerHTML = '<option value="">— Bölüm seçin —</option>';
      list.forEach(function (p) {
        var o = document.createElement("option");
        o.value = p.$id;
        o.textContent = hedefProgramDisplayName(p) || p.$id;
        dSel.appendChild(o);
      });
      dSel.disabled = false;
      if (deptFilter) {
        deptFilter.disabled = false;
        deptFilter.value = "";
        Array.from(dSel.options).forEach(function (opt, i) {
          if (i === 0) opt.hidden = false;
          else opt.hidden = false;
        });
      }
    } catch (e) {
      console.error("[Net Sihirbazı V2] fillDepartmentSelect:", e);
    }
  }

  async function fetchAllUniversities() {
    var all = [];
    var cursor = null;
    try {
      for (;;) {
        var q = [Query.limit(NS_PAGE)];
        if (cursor) q.push(Query.cursorAfter(cursor));
        var res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_UNIVERSITIES, q);
        var docs = (res && res.documents) || [];
        all = all.concat(docs);
        if (docs.length < NS_PAGE) break;
        cursor = docs[docs.length - 1].$id;
      }
      all.sort(function (a, b) {
        return hedefUniDisplayName(a).localeCompare(hedefUniDisplayName(b), "tr");
      });
      return all;
    } catch (e) {
      console.error("[Net Sihirbazı V2] fetchAllUniversities:", e);
      throw e;
    }
  }

  async function fetchProgramsForUni(uniId) {
    var uid = String(uniId || "").trim();
    if (!uid) return [];
    if (programsByUni[uid]) return programsByUni[uid];
    var acc = [];
    var cursor = null;
    try {
      for (;;) {
        var q = [Query.equal("uniId", uid), Query.limit(NS_PAGE)];
        if (cursor) q.push(Query.cursorAfter(cursor));
        var res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_PROGRAMS, q);
        var docs = (res && res.documents) || [];
        acc = acc.concat(docs);
        if (docs.length < NS_PAGE) break;
        cursor = docs[docs.length - 1].$id;
      }
      acc.sort(function (a, b) {
        return hedefProgramDisplayName(a).localeCompare(hedefProgramDisplayName(b), "tr");
      });
      programsByUni[uid] = acc;
      return acc;
    } catch (e) {
      console.error("[Net Sihirbazı V2] fetchProgramsForUni:", e);
      throw e;
    }
  }

  async function loadExamsForResolver() {
    try {
      if (!resolveExams) return [];
      var x = resolveExams();
      if (x && typeof x.then === "function") x = await x;
      return Array.isArray(x) ? x : [];
    } catch (e) {
      console.error("[Net Sihirbazı V2] loadExamsForResolver:", e);
      return [];
    }
  }

  async function renderTable() {
    try {
      var uid = String(uSel.value || "").trim();
      var pid = String(dSel.value || "").trim();
      if (!uid || !pid) {
        renderEmptyState(null);
        return;
      }
      wrap.innerHTML = netSihirbaziSkeletonHtml();
      var uni = unis.find(function (x) {
        return x.$id === uid;
      });
      var progs = programsByUni[uid] || [];
      var pdoc = progs.find(function (x) {
        return x.$id === pid;
      });
      if (!uni || !pdoc) {
        renderEmptyState("Seçilen kayıt bulunamadı.");
        return;
      }
      var prog = buildProgramFromAppwriteV2(uni, pdoc);
      if (!prog || !prog.rows || !prog.rows.length) {
        if (uniTitle) uniTitle.textContent = hedefUniDisplayName(uni) || "—";
        if (deptTitle) deptTitle.textContent = hedefProgramDisplayName(pdoc) || "—";
        if (subEl) subEl.textContent = "Bu bölüm için geçerli rowsJson üretilemedi.";
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Program verisi okunamadı veya satır listesi boş.</p>';
        return;
      }
      if (uniTitle) uniTitle.textContent = prog.university || hedefUniDisplayName(uni) || "";
      if (deptTitle) deptTitle.textContent = prog.department || hedefProgramDisplayName(pdoc) || "";

      var alanKeyStr = String(pdoc.alanKey != null ? pdoc.alanKey : "sayisal");
      var exams = await loadExamsForResolver();
      var hasBranch = hasAnyBranchNetData(exams, alanKeyStr);
      var currentNetForRow = createCurrentNetForRowResolver(exams, alanKeyStr);

      if (subEl) {
        subEl.textContent = hasBranch
          ? "Güncel netler: son denemelerinizdeki YKS branş detayı (yksBranchDetail) ile eşleştirildi."
          : "Branş güncel net bulunamadı — tabloda güncel sütunu 0; deneme kaydınıza YKS detayı ekleyin veya öğrenci seçin.";
      }

      var display = buildMotorDisplayRows(prog, { currentNetForRow: currentNetForRow });
      var uiMeta = {
        currentNetSummary: hasBranch
          ? "Güncel sütunu gerçek deneme branş netlerinizden türetilir (eşleşmeyen dersler 0)."
          : "Henüz branş neti yok; güncel değerler 0 gösteriliyor.",
        tableFootnote:
          "Kalan = güncel − hedef. Ekside kırmızı, fazlada yeşil. Hedefler Appwrite Programs (rowsJson).",
      };
      wrap.innerHTML = netSihirbaziV2ResultHtml(display, prog, uiMeta);
    } catch (err) {
      console.error("[Net Sihirbazı V2] renderTable:", err);
      try {
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Tablo oluşturulurken hata oluştu. Lütfen tekrar deneyin.</p>';
        if (subEl) subEl.textContent = err && err.message ? String(err.message) : "Hata.";
      } catch (_e2) {}
    }
  }

  function bindFiltersOnce() {
    try {
      if (uniFilter && !uniFilter.dataset.nsV2Wired) {
        uniFilter.dataset.nsV2Wired = "1";
        wireSearchFilterForSelect(uniFilter, uSel);
      }
      if (deptFilter && !deptFilter.dataset.nsV2Wired) {
        deptFilter.dataset.nsV2Wired = "1";
        wireSearchFilterForSelect(deptFilter, dSel);
      }
    } catch (e) {
      console.error("[Net Sihirbazı V2] bindFiltersOnce:", e);
    }
  }

  resetDepartmentUi();
  renderEmptyState("Üniversiteler yükleniyor…");
  wrap.innerHTML = netSihirbaziSkeletonHtml();

  (async function bootstrap() {
    try {
      unis = await fetchAllUniversities();
      fillUniversitySelect();
      bindFiltersOnce();
      if (!unis.length) {
        renderEmptyState(
          "Universities koleksiyonunda kayıt yok. setup-appwrite.js sonrası auto-fetch-yokatlas.js veya import-excel-to-appwrite.js çalıştırın."
        );
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Liste boş — önce veri aktarımı gerekir.</p>';
        return;
      }
      renderEmptyState(null);
    } catch (e) {
      console.error("[Net Sihirbazı V2] bootstrap:", e);
      try {
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Appwrite Universities yüklenemedi. Oturum ve koleksiyon adlarını kontrol edin.</p>';
        if (subEl) subEl.textContent = e && e.message ? String(e.message) : "Yükleme hatası.";
      } catch (_e2) {}
    }
  })();

  uSel.addEventListener("change", function () {
    try {
      var uid = String(uSel.value || "").trim();
      resetDepartmentUi();
      renderEmptyState(
        uid ? "Bölümler yükleniyor…" : "Önce üniversite seçin; bölüm listesi yalnızca seçilen üniversitenin uniId değerine göre gelir."
      );
      if (!uid) {
        if (uniTitle) uniTitle.textContent = "Üniversite ve bölüm seçin";
        return;
      }
      wrap.innerHTML = netSihirbaziSkeletonHtml();
      fetchProgramsForUni(uid)
        .then(function (list) {
          try {
            if (!list.length) {
              fillDepartmentSelect([]);
              dSel.disabled = true;
              wrap.innerHTML =
                '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Bu üniversite için kayıtlı bölüm yok.</p>';
              if (subEl) subEl.textContent = "Bu uniId için Programs dökümanı bulunamadı.";
              return;
            }
            fillDepartmentSelect(list);
            bindFiltersOnce();
            renderEmptyState(null);
          } catch (inner) {
            console.error("[Net Sihirbazı V2] uni change:", inner);
            renderEmptyState("Bölüm listesi işlenemedi.");
          }
        })
        .catch(function (err) {
          console.error("[Net Sihirbazı V2] programs fetch:", err);
          try {
            wrap.innerHTML =
              '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Bölümler yüklenemedi.</p>';
            if (subEl) subEl.textContent = err && err.message ? String(err.message) : "Ağ hatası.";
          } catch (_e2) {}
        });
    } catch (err) {
      console.error("[Net Sihirbazı V2] uSel change:", err);
    }
  });

  dSel.addEventListener("change", function () {
    renderTable().catch(function (e) {
      console.error("[Net Sihirbazı V2] renderTable:", e);
    });
  });
}

function demoYerlestirmeDetayli(tytSum, aytSum, obp) {
  var t = Math.max(0, Math.min(120, tytSum));
  var a = Math.max(0, Math.min(120, aytSum));
  var o = Math.max(0, Math.min(60, obp));
  return Math.round((100 + t * 1.85 + a * 2.45 + o * 0.72) * 10) / 10;
}

/** YKS D/Y/B satırları — her biri için soru üst sınırı (ÖSYM soru sayıları) */
var YKS_PUAN_SUBJECT_MAX = {
  yksTytTr: 40,
  yksTytSos: 20,
  yksTytMat: 40,
  yksTytFen: 20,
  yksAytSayMat: 40,
  yksAytSayFiz: 14,
  yksAytSayKim: 13,
  yksAytSayBio: 13,
  yksAytEaMat: 40,
  yksAytEaEdeb: 24,
  yksAytEaTar1: 10,
  yksAytEaCog1: 6,
  yksAytSozEdeb: 24,
  yksAytSozTar1: 10,
  yksAytSozCog1: 6,
  yksAytSozTar2: 11,
  yksAytSozCog2: 11,
  yksAytSozFel: 12,
  yksAytSozDkab: 6,
  yksAytDilYd: 80,
  yksAytDilEdeb: 24,
};

function parseDyInt(el) {
  if (!el) return 0;
  var s = String(el.value || "").trim();
  if (s === "") return 0;
  var n = parseInt(s, 10);
  return isNaN(n) || n < 0 ? 0 : n;
}

function dybAllBlank(dEl, yEl, bEl) {
  function emp(el) {
    return !el || String(el.value || "").trim() === "";
  }
  return emp(dEl) && emp(yEl) && emp(bEl);
}

/**
 * @param {object} [cfg] — idPrefix: "osp" veya ""; ayrıca alan/tyt/ayt element id'leri
 */
export function initYksPuanHesaplama(cfg) {
  cfg = cfg || {};
  var pre = cfg.idPrefix || "";
  function id(local) {
    if (!pre) return local;
    return pre + local.charAt(0).toUpperCase() + local.slice(1);
  }

  var form = document.getElementById(cfg.formId || id("yksPuanForm"));
  if (!form || form.dataset.yksBound) return;
  form.dataset.yksBound = "1";

  var alanSel = document.getElementById(id("yksAlanSelect"));
  var outEl = document.getElementById(cfg.outId || id("yksPuanSonuc"));
  var hintEl = document.getElementById(cfg.hintId || id("yksPuanHint"));
  var obpEl = document.getElementById(id("yksInpObp"));

  var panels = {
    say: document.getElementById(id("yksPanelAytSay")),
    ea: document.getElementById(id("yksPanelAytEa")),
    soz: document.getElementById(id("yksPanelAytSoz")),
    dil: document.getElementById(id("yksPanelAytDil")),
  };

  var subjectKeys = Object.keys(YKS_PUAN_SUBJECT_MAX);

  function toggleAytPanels() {
    var a = alanSel ? String(alanSel.value || "say") : "say";
    if (panels.say) panels.say.hidden = a !== "say";
    if (panels.ea) panels.ea.hidden = a !== "ea";
    if (panels.soz) panels.soz.hidden = a !== "soz";
    if (panels.dil) panels.dil.hidden = a !== "dil";
  }

  function getTriplet(key) {
    return {
      d: document.getElementById(id(key + "D")),
      y: document.getElementById(id(key + "Y")),
      b: document.getElementById(id(key + "B")),
      net: document.getElementById(id(key + "Net")),
      wrap: document.getElementById(id(key + "Dyb")),
    };
  }

  function sanitizeDigits(el) {
    if (!el) return;
    var raw = String(el.value || "").replace(/\D/g, "");
    if (el.value !== raw) el.value = raw;
  }

  function clampTriplet(key, changedEl) {
    var max = YKS_PUAN_SUBJECT_MAX[key];
    if (max == null) return;
    var t = getTriplet(key);
    if (!t.d || !t.y || !t.b) return;
    sanitizeDigits(t.d);
    sanitizeDigits(t.y);
    sanitizeDigits(t.b);
    var d = parseDyInt(t.d);
    var y = parseDyInt(t.y);
    var b = parseDyInt(t.b);
    var sum = d + y + b;
    if (sum <= max) {
      if (t.wrap) t.wrap.classList.remove("yks-dyb-inputs--invalid");
      return;
    }
    if (changedEl) {
      if (t.wrap) t.wrap.classList.add("yks-dyb-inputs--invalid");
      var cur = changedEl === t.d ? d : changedEl === t.y ? y : b;
      var other = sum - cur;
      var allowed = Math.max(0, max - other);
      changedEl.value = allowed === 0 ? "" : String(allowed);
      setTimeout(function () {
        if (t.wrap) t.wrap.classList.remove("yks-dyb-inputs--invalid");
      }, 320);
      return;
    }
    if (t.wrap) t.wrap.classList.add("yks-dyb-inputs--invalid");
    d = parseDyInt(t.d);
    y = parseDyInt(t.y);
    b = parseDyInt(t.b);
    while (d + y + b > max) {
      if (b > 0) {
        b--;
        t.b.value = b ? String(b) : "";
      } else if (y > 0) {
        y--;
        t.y.value = y ? String(y) : "";
      } else if (d > 0) {
        d--;
        t.d.value = d ? String(d) : "";
      } else break;
    }
    setTimeout(function () {
      if (t.wrap) t.wrap.classList.remove("yks-dyb-inputs--invalid");
    }, 320);
  }

  function netFromTriplet(key) {
    var t = getTriplet(key);
    if (!t.d || !t.y || !t.net) return 0;
    if (dybAllBlank(t.d, t.y, t.b)) {
      t.net.textContent = "—";
      return 0;
    }
    var d = parseDyInt(t.d);
    var y = parseDyInt(t.y);
    var net = d - y / 4;
    t.net.textContent = net.toFixed(2);
    return net;
  }

  function onDybInput(key, e) {
    clampTriplet(key, e && e.target);
    netFromTriplet(key);
    calc();
  }

  function readObp() {
    if (!obpEl) return 0;
    var s = String(obpEl.value || "").trim().replace(",", ".");
    if (s === "") return 0;
    var n = parseFloat(s);
    if (isNaN(n)) return 0;
    return Math.max(0, Math.min(60, n));
  }

  function onObpInput() {
    if (!obpEl) return;
    var s = String(obpEl.value || "").trim().replace(",", ".");
    if (s === "") return;
    var n = parseFloat(s);
    if (isNaN(n)) return;
    if (n > 60) obpEl.value = "60";
    else if (n < 0) obpEl.value = "0";
    calc();
  }

  function tytNetSum() {
    return (
      netFromTriplet("yksTytTr") +
      netFromTriplet("yksTytSos") +
      netFromTriplet("yksTytMat") +
      netFromTriplet("yksTytFen")
    );
  }

  function sumSay() {
    return (
      netFromTriplet("yksAytSayMat") +
      netFromTriplet("yksAytSayFiz") +
      netFromTriplet("yksAytSayKim") +
      netFromTriplet("yksAytSayBio")
    );
  }
  function sumEa() {
    return (
      netFromTriplet("yksAytEaMat") +
      netFromTriplet("yksAytEaEdeb") +
      netFromTriplet("yksAytEaTar1") +
      netFromTriplet("yksAytEaCog1")
    );
  }
  function sumSoz() {
    return (
      netFromTriplet("yksAytSozEdeb") +
      netFromTriplet("yksAytSozTar1") +
      netFromTriplet("yksAytSozCog1") +
      netFromTriplet("yksAytSozTar2") +
      netFromTriplet("yksAytSozCog2") +
      netFromTriplet("yksAytSozFel") +
      netFromTriplet("yksAytSozDkab")
    );
  }
  function sumDil() {
    return netFromTriplet("yksAytDilYd") + netFromTriplet("yksAytDilEdeb");
  }

  function aytNetSum() {
    var a = alanSel ? String(alanSel.value || "say") : "say";
    if (a === "say") return sumSay();
    if (a === "ea") return sumEa();
    if (a === "soz") return sumSoz();
    if (a === "dil") return sumDil();
    return 0;
  }

  function anyUserInput() {
    for (var i = 0; i < subjectKeys.length; i++) {
      var t = getTriplet(subjectKeys[i]);
      if (t.d && String(t.d.value || "").trim() !== "") return true;
      if (t.y && String(t.y.value || "").trim() !== "") return true;
      if (t.b && String(t.b.value || "").trim() !== "") return true;
    }
    if (obpEl && String(obpEl.value || "").trim() !== "") return true;
    return false;
  }

  function calc() {
    toggleAytPanels();
    subjectKeys.forEach(function (k) {
      netFromTriplet(k);
    });
    if (!anyUserInput()) {
      if (outEl) outEl.textContent = "—";
      if (hintEl) hintEl.textContent = "";
      return;
    }
    var tyt = tytNetSum();
    var ayt = aytNetSum();
    var obp = readObp();
    var g = demoYerlestirmeDetayli(tyt, ayt, obp);
    if (outEl) outEl.textContent = String(g);
    var alanLabel = { say: "Sayısal", ea: "Eşit ağırlık", soz: "Sözel", dil: "Dil" };
    var ak = alanSel ? alanLabel[String(alanSel.value)] || "" : "";
    if (hintEl)
      hintEl.textContent =
        "TYT toplam net: " +
        tyt.toFixed(2) +
        " · AYT toplam net (" +
        ak +
        "): " +
        ayt.toFixed(2) +
        " · OBP: " +
        obp.toFixed(1) +
        " — gösterge (demo, ÖSYM değil).";
  }

  function resetForm() {
    subjectKeys.forEach(function (k) {
      var t = getTriplet(k);
      if (t.d) t.d.value = "";
      if (t.y) t.y.value = "";
      if (t.b) t.b.value = "";
      if (t.net) t.net.textContent = "—";
      if (t.wrap) t.wrap.classList.remove("yks-dyb-inputs--invalid");
    });
    if (obpEl) obpEl.value = "";
    if (outEl) outEl.textContent = "—";
    if (hintEl) hintEl.textContent = "";
    toggleAytPanels();
  }

  subjectKeys.forEach(function (k) {
    var t = getTriplet(k);
    ["d", "y", "b"].forEach(function (which) {
      var el = t[which];
      if (!el) return;
      el.addEventListener("input", function (e) {
        onDybInput(k, e);
      });
      el.addEventListener("blur", function () {
        clampTriplet(k, null);
        netFromTriplet(k);
        calc();
      });
    });
  });

  if (obpEl) {
    obpEl.addEventListener("input", function () {
      onObpInput();
      calc();
    });
  }
  if (alanSel) alanSel.addEventListener("change", calc);
  var btn = document.getElementById(cfg.btnId || id("yksPuanHesaplaBtn"));
  if (btn)
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      calc();
    });
  var resetBtn = document.getElementById(cfg.resetBtnId || id("yksPuanResetBtn"));
  if (resetBtn)
    resetBtn.addEventListener("click", function (e) {
      e.preventDefault();
      resetForm();
    });
  calc();
}
