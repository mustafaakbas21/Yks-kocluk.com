/**
 * TYT-AYT Net Sihirbazı V2 — `src/data/yks-data.json` statik katalog; güncel net = deneme yksBranchDetail (mock yok).
 * YKS Puan modülü aşağıda aynı dosyada.
 */
import { YKS2026_Mufredat } from "./yks-mufredat.js";
import { wireSearchFilterForSelect } from "./hedef-atlas-helpers.js";
import {
  ensureHedefSimulatorAppwriteData,
  getCachedHedefProgramsForUniversity,
  getHedefAppwriteUniversities,
  hedefProgramDisplayName,
  hedefUniDisplayName,
  loadHedefProgramsForUniversity,
} from "./hedef-appwrite-catalog.js";
import {
  buildProgramFromAppwriteV2,
  buildMotorDisplayRows,
  netSihirbaziSkeletonHtml,
  netSihirbaziV2ResultHtml,
} from "./net-sihirbazi-engine.js";
import {
  createCurrentNetForRowResolver,
  hasAnyBranchNetData,
} from "./net-sihirbazi-branch-nets.js";

export { YKS2026_Mufredat };

/** AYT branş eşlemesi için program türü (puanGroup) öncelikli */
function alanKeyForNetResolver(pdoc, prog) {
  var pg = prog && prog.puanGroup;
  if (pg === "ea") return "esit_agirlik";
  if (pg === "sozel") return "sozel";
  if (pg === "dil") return "dil";
  if (pg === "tyt_only") return "sayisal";
  if (pg === "sayisal") return "sayisal";
  return String(pdoc && pdoc.alanKey != null ? pdoc.alanKey : "sayisal");
}

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

  function renderEmptyState(msg) {
    try {
      if (uniTitle) uniTitle.textContent = "Üniversite ve bölüm seçin";
      if (deptTitle) deptTitle.textContent = "TYT-AYT Net Sihirbazı V2";
      if (subEl) {
        subEl.textContent =
          msg ||
          "Üniversite ve bölüm listesi src/data/yks-data.json dosyasından gelir. Önce üniversite, sonra o üniversiteye ait bölümler.";
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
      var progs = getCachedHedefProgramsForUniversity(uid) || [];
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
          "Kalan = güncel − hedef. Ekside kırmızı, fazlada yeşil. Hedefler yks-data.json (rowsJson).",
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
      await ensureHedefSimulatorAppwriteData();
      unis = getHedefAppwriteUniversities();
      fillUniversitySelect();
      bindFiltersOnce();
      if (!unis.length) {
        renderEmptyState("src/data/yks-data.json boş veya yüklenemedi. Dosyaya üniversite/program ekleyin.");
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Liste boş — yks-data.json kontrol edin.</p>';
        return;
      }
      renderEmptyState(null);
    } catch (e) {
      console.error("[Net Sihirbazı V2] bootstrap:", e);
      try {
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Yerel katalog (yks-data.json) yüklenemedi.</p>';
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
      loadHedefProgramsForUniversity(uid)
        .then(function (list) {
          try {
            if (!list.length) {
              fillDepartmentSelect([]);
              dSel.disabled = true;
              wrap.innerHTML =
                '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Bu üniversite için kayıtlı bölüm yok.</p>';
              if (subEl) subEl.textContent = "Bu üniversite kimliği için yks-data.json içinde program yok.";
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
          console.error("[Net Sihirbazı V2] programs load:", err);
          try {
            wrap.innerHTML =
              '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Bölümler yüklenemedi.</p>';
            if (subEl) subEl.textContent = err && err.message ? String(err.message) : "Hata.";
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

/** TYT ham: taban 100 + Özet katsayılar (Türkçe/Mat 3.3, Sosyal/Fen 3.4) */
function yksHamTyt(ntTr, ntMat, ntSos, ntFen) {
  return 100 + 3.3 * ntTr + 3.3 * ntMat + 3.4 * ntSos + 3.4 * ntFen;
}

/** AYT ham (alan bazlı, taban 100 + ders katsayıları × net) */
function yksHamAytSay(nMat, nFiz, nKim, nBio) {
  return 100 + 3.3 * nMat + 3.0 * nFiz + 3.0 * nKim + 3.0 * nBio;
}
function yksHamAytEa(nMat, nEdeb, nTar1, nCog1) {
  return 100 + 3.3 * nMat + 3.0 * nEdeb + 2.8 * nTar1 + 2.6 * nCog1;
}
function yksHamAytSoz(nEdeb, nTar1, nCog1, nTar2, nCog2, nFel, nDkab) {
  return (
    100 +
    3.0 * nEdeb +
    2.8 * nTar1 +
    2.6 * nCog1 +
    2.8 * nTar2 +
    2.6 * nCog2 +
    2.7 * nFel +
    2.5 * nDkab
  );
}
function yksHamAytDil(nYd, nEdeb) {
  return 100 + 2.9 * nYd + 3.0 * nEdeb;
}

/** Birleşik ham: %40 TYT + %60 AYT */
function yksBirlesikHam(tytHam, aytHam) {
  return 0.4 * tytHam + 0.6 * aytHam;
}

/**
 * OBP yerleştirme katkısı.
 * Diploma 50–100: ×0.6 (kırık: ×0.3).
 * Ham 30–60: doğrudan (kırık: ÷2).
 */
function yksObpPlacementContribution(mode, rawValue, kirik) {
  var v = Number(rawValue);
  if (isNaN(v)) return 0;
  var k = !!kirik;
  if (mode === "diploma") {
    if (v < 50 || v > 100) return 0;
    var c = v * 0.6;
    return k ? c * 0.5 : c;
  }
  if (v < 30 || v > 60) return 0;
  return k ? v * 0.5 : v;
}

/** YKS D/Y satırları — her biri için soru üst sınırı (ÖSYM soru sayıları) */
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

function dyPairBlank(dEl, yEl) {
  function emp(el) {
    return !el || String(el.value || "").trim() === "";
  }
  return emp(dEl) && emp(yEl);
}

/**
 * @param {object} [cfg] — idPrefix: "osp" veya ""; formId, btnId, resetBtnId opsiyonel
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
  var hintEl = document.getElementById(cfg.hintId || id("yksPuanHint"));
  var outWrap = document.getElementById(cfg.outWrapId || id("yksPuanOutWrap"));
  var hamTbody = document.getElementById(cfg.hamTbodyId || id("yksPuanHamTbody"));
  var yerTbody = document.getElementById(cfg.yerTbodyId || id("yksPuanYerTbody"));
  var obpModeDiploma = document.getElementById(id("yksObpModeDiploma"));
  var obpModeObp60 = document.getElementById(id("yksObpModeObp60"));
  var obpValueEl = document.getElementById(id("yksObpValue"));
  var obpValueLabel = document.getElementById(id("yksObpValueLabel"));
  var obpKirik = document.getElementById(id("yksObpKirik"));

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

  function getPair(key) {
    return {
      d: document.getElementById(id(key + "D")),
      y: document.getElementById(id(key + "Y")),
      net: document.getElementById(id(key + "Net")),
      wrap: document.getElementById(id(key + "Dyb")),
    };
  }

  function sanitizeDigits(el) {
    if (!el) return;
    var raw = String(el.value || "").replace(/\D/g, "");
    if (el.value !== raw) el.value = raw;
  }

  function clampDyPair(key, changedEl) {
    var max = YKS_PUAN_SUBJECT_MAX[key];
    if (max == null) return;
    var t = getPair(key);
    if (!t.d || !t.y) return;
    sanitizeDigits(t.d);
    sanitizeDigits(t.y);
    var d = parseDyInt(t.d);
    var y = parseDyInt(t.y);
    var sum = d + y;
    if (sum <= max) {
      if (t.wrap) t.wrap.classList.remove("yks-dyb-inputs--invalid");
      return;
    }
    if (changedEl) {
      if (t.wrap) t.wrap.classList.add("yks-dyb-inputs--invalid");
      var cur = changedEl === t.d ? d : y;
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
    while (d + y > max) {
      if (y > 0) {
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

  function netFromPair(key) {
    var t = getPair(key);
    if (!t.d || !t.y || !t.net) return 0;
    if (dyPairBlank(t.d, t.y)) {
      t.net.textContent = "—";
      return 0;
    }
    var d = parseDyInt(t.d);
    var y = parseDyInt(t.y);
    var net = d - y / 4;
    t.net.textContent = net.toFixed(2);
    return net;
  }

  function onDyInput(key, e) {
    clampDyPair(key, e && e.target);
    netFromPair(key);
    calc();
  }

  function obpMode() {
    if (obpModeObp60 && obpModeObp60.checked) return "obp60";
    return "diploma";
  }

  function syncObpUi() {
    var m = obpMode();
    if (obpValueLabel) {
      obpValueLabel.textContent = m === "diploma" ? "Diploma notu (50–100)" : "OBP puanı (30–60)";
    }
    if (obpValueEl) {
      obpValueEl.min = m === "diploma" ? "0" : "0";
      obpValueEl.max = m === "diploma" ? "100" : "60";
      obpValueEl.placeholder = m === "diploma" ? "Örn. 85" : "Örn. 45";
    }
  }

  function readObpContribution() {
    if (!obpValueEl) return 0;
    var s = String(obpValueEl.value || "").trim().replace(",", ".");
    if (s === "") return 0;
    var n = parseFloat(s);
    return yksObpPlacementContribution(obpMode(), n, obpKirik && obpKirik.checked);
  }

  function tytNets() {
    return {
      tr: netFromPair("yksTytTr"),
      sos: netFromPair("yksTytSos"),
      mat: netFromPair("yksTytMat"),
      fen: netFromPair("yksTytFen"),
    };
  }

  function tytNetSum() {
    var n = tytNets();
    return n.tr + n.sos + n.mat + n.fen;
  }

  function aytHamForAlan() {
    var a = alanSel ? String(alanSel.value || "say") : "say";
    if (a === "say") {
      return yksHamAytSay(
        netFromPair("yksAytSayMat"),
        netFromPair("yksAytSayFiz"),
        netFromPair("yksAytSayKim"),
        netFromPair("yksAytSayBio")
      );
    }
    if (a === "ea") {
      return yksHamAytEa(
        netFromPair("yksAytEaMat"),
        netFromPair("yksAytEaEdeb"),
        netFromPair("yksAytEaTar1"),
        netFromPair("yksAytEaCog1")
      );
    }
    if (a === "soz") {
      return yksHamAytSoz(
        netFromPair("yksAytSozEdeb"),
        netFromPair("yksAytSozTar1"),
        netFromPair("yksAytSozCog1"),
        netFromPair("yksAytSozTar2"),
        netFromPair("yksAytSozCog2"),
        netFromPair("yksAytSozFel"),
        netFromPair("yksAytSozDkab")
      );
    }
    if (a === "dil") {
      return yksHamAytDil(netFromPair("yksAytDilYd"), netFromPair("yksAytDilEdeb"));
    }
    return 0;
  }

  function aytNetSum() {
    var a = alanSel ? String(alanSel.value || "say") : "say";
    if (a === "say") {
      return (
        netFromPair("yksAytSayMat") +
        netFromPair("yksAytSayFiz") +
        netFromPair("yksAytSayKim") +
        netFromPair("yksAytSayBio")
      );
    }
    if (a === "ea") {
      return (
        netFromPair("yksAytEaMat") +
        netFromPair("yksAytEaEdeb") +
        netFromPair("yksAytEaTar1") +
        netFromPair("yksAytEaCog1")
      );
    }
    if (a === "soz") {
      return (
        netFromPair("yksAytSozEdeb") +
        netFromPair("yksAytSozTar1") +
        netFromPair("yksAytSozCog1") +
        netFromPair("yksAytSozTar2") +
        netFromPair("yksAytSozCog2") +
        netFromPair("yksAytSozFel") +
        netFromPair("yksAytSozDkab")
      );
    }
    if (a === "dil") return netFromPair("yksAytDilYd") + netFromPair("yksAytDilEdeb");
    return 0;
  }

  function anyUserInput() {
    for (var i = 0; i < subjectKeys.length; i++) {
      var t = getPair(subjectKeys[i]);
      if (t.d && String(t.d.value || "").trim() !== "") return true;
      if (t.y && String(t.y.value || "").trim() !== "") return true;
    }
    if (obpValueEl && String(obpValueEl.value || "").trim() !== "") return true;
    return false;
  }

  function fmt(n) {
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function row(tb, label, val) {
    if (!tb) return;
    var tr = document.createElement("tr");
    var td1 = document.createElement("td");
    td1.textContent = label;
    var td2 = document.createElement("td");
    td2.textContent = val;
    td2.className = "yks-puan-out-table__val";
    tr.appendChild(td1);
    tr.appendChild(td2);
    tb.appendChild(tr);
  }

  function calc() {
    toggleAytPanels();
    subjectKeys.forEach(function (k) {
      netFromPair(k);
    });
    syncObpUi();
    if (!anyUserInput()) {
      if (outWrap) outWrap.hidden = true;
      if (hamTbody) hamTbody.innerHTML = "";
      if (yerTbody) yerTbody.innerHTML = "";
      if (hintEl) hintEl.textContent = "";
      return;
    }
    var tn = tytNets();
    var tytHam = yksHamTyt(tn.tr, tn.mat, tn.sos, tn.fen);
    var aytHam = aytHamForAlan();
    var birlesik = yksBirlesikHam(tytHam, aytHam);
    var obpC = readObpContribution();
    var yerToplam = birlesik + obpC;

    if (hamTbody) {
      hamTbody.innerHTML = "";
      row(hamTbody, "TYT ham puanı (taban 100 + katsayılar)", fmt(tytHam));
      row(hamTbody, "AYT ham puanı (seçilen alan)", fmt(aytHam));
      row(hamTbody, "Birleşik ham (%40 TYT + %60 AYT)", fmt(birlesik));
      row(hamTbody, "TYT toplam net", fmt(tytNetSum()));
      row(hamTbody, "AYT toplam net", fmt(aytNetSum()));
    }
    if (yerTbody) {
      yerTbody.innerHTML = "";
      row(yerTbody, "Birleşik ham", fmt(birlesik));
      row(yerTbody, "OBP yerleştirme katkısı", fmt(obpC));
      row(yerTbody, "Yerleştirme göstergesi (birleşik + OBP)", fmt(yerToplam));
    }
    if (outWrap) outWrap.hidden = false;
    if (hintEl) {
      hintEl.textContent =
        "Net formülü: Doğru − Yanlış ÷ 4. Sonuçlar bilgilendirme amaçlıdır; resmî ÖSYM puanı değildir.";
    }
  }

  function resetForm() {
    subjectKeys.forEach(function (k) {
      var t = getPair(k);
      if (t.d) t.d.value = "";
      if (t.y) t.y.value = "";
      if (t.net) t.net.textContent = "—";
      if (t.wrap) t.wrap.classList.remove("yks-dyb-inputs--invalid");
    });
    if (obpValueEl) obpValueEl.value = "";
    if (obpKirik) obpKirik.checked = false;
    if (obpModeDiploma) obpModeDiploma.checked = true;
    if (hamTbody) hamTbody.innerHTML = "";
    if (yerTbody) yerTbody.innerHTML = "";
    if (outWrap) outWrap.hidden = true;
    if (hintEl) hintEl.textContent = "";
    syncObpUi();
    toggleAytPanels();
  }

  subjectKeys.forEach(function (k) {
    var t = getPair(k);
    ["d", "y"].forEach(function (which) {
      var el = t[which];
      if (!el) return;
      el.addEventListener("input", function (e) {
        onDyInput(k, e);
      });
      el.addEventListener("blur", function () {
        clampDyPair(k, null);
        netFromPair(k);
        calc();
      });
    });
  });

  if (obpModeDiploma)
    obpModeDiploma.addEventListener("change", function () {
      syncObpUi();
      calc();
    });
  if (obpModeObp60)
    obpModeObp60.addEventListener("change", function () {
      syncObpUi();
      calc();
    });
  if (obpValueEl) {
    obpValueEl.addEventListener("input", calc);
    obpValueEl.addEventListener("blur", calc);
  }
  if (obpKirik) obpKirik.addEventListener("change", calc);
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
  syncObpUi();
  calc();
}
