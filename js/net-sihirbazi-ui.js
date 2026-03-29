/**
 * TYT-AYT Net Sihirbazı V2 — veri kaynağı Hedef Simülatörü ile aynı: `yok-atlas.json` → yedek `yks-data.json` (hedef-appwrite-catalog).
 * Güncel net = deneme yksBranchDetail (mock yok).
 * YKS Puan modülü aşağıda aynı dosyada.
 */
import { YKS2026_Mufredat } from "./yks-mufredat.js";
import {
  ensureHedefSimulatorAppwriteData,
  getDedupedProgramsForUniversity,
  getHedefAppwriteUniversities,
  hedefProgramDisplayName,
  hedefUniDisplayName,
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
 * @param {{ uniSelectId: string, deptSelectId: string, tableWrapId: string, uniTitleId?: string, deptTitleId?: string, subtitleId?: string, resolveExams?: () => unknown }} options
 * resolveExams: seçili öğrencinin denemeleri (yksBranchDetail). Dizi veya Promise dönebilir. Yoksa güncel net 0 gösterilir.
 */
export function initNetSihirbazi(options) {
  var uSel = document.getElementById(options.uniSelectId);
  var dSel = document.getElementById(options.deptSelectId);
  var wrap = document.getElementById(options.tableWrapId);
  var uniTitle = options.uniTitleId ? document.getElementById(options.uniTitleId) : null;
  var deptTitle = options.deptTitleId ? document.getElementById(options.deptTitleId) : null;
  var subEl = options.subtitleId ? document.getElementById(options.subtitleId) : null;
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
          "Üniversite ve bölüm listesi YÖK Atlas kataloğundan gelir (Hedef Simülatörü ile aynı kaynak). Önce üniversite, sonra bölüm.";
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
    } catch (e) {
      console.error("[Net Sihirbazı V2] resetDepartmentUi:", e);
    }
  }

  function nsBindSelect2() {
    try {
      if (typeof jQuery === "undefined" || !jQuery.fn.select2) return;
      var $u = jQuery(uSel);
      var $d = jQuery(dSel);
      if ($u.hasClass("select2-hidden-accessible")) $u.select2("destroy");
      if ($d.hasClass("select2-hidden-accessible")) $d.select2("destroy");
      var lang = {
        noResults: function () { return "Sonuç yok"; },
        searching: function () { return "Aranıyor…"; },
      };
      jQuery(uSel).select2({
        width: "100%",
        placeholder: "Üniversite seçin",
        allowClear: true,
        language: lang,
      });
      jQuery(dSel).select2({
        width: "100%",
        placeholder: "Önce üniversite seçin",
        allowClear: true,
        language: lang,
      });
    } catch (e) {
      console.error("[Net Sihirbazı V2] nsBindSelect2:", e);
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
      var progs = getDedupedProgramsForUniversity(uid) || [];
      var pdoc = progs.find(function (x) {
        return x.$id === pid;
      });
      if (!uni || !pdoc) {
        renderEmptyState("Seçilen kayıt bulunamadı.");
        return;
      }
      var prog = buildProgramFromAppwriteV2(uni, pdoc, { exactYokAtlasTargets: true });
      if (!prog || !prog.rows || !prog.rows.length) {
        if (uniTitle) uniTitle.textContent = hedefUniDisplayName(uni) || "—";
        if (deptTitle) deptTitle.textContent = hedefProgramDisplayName(pdoc) || "—";
        if (subEl) subEl.textContent = "Bu bölüm için YÖK/katalog satır listesi üretilemedi.";
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

      var display = buildMotorDisplayRows(prog, {
        currentNetForRow: currentNetForRow,
        exactYokAtlasTargets: true,
      });
      var uiMeta = {
        currentNetSummary: hasBranch
          ? "Güncel sütunu gerçek deneme branş netlerinizden türetilir (eşleşmeyen dersler 0)."
          : "Henüz branş neti yok; güncel değerler 0 gösteriliyor.",
        tableFootnote:
          "Kalan = Hedef net − Güncel net. Hedef sütunu YÖK Atlas / katalog JSON ile birebir aynıdır (Net Sihirbazı = Hedef Simülatörü veri kaynağı).",
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

  resetDepartmentUi();
  renderEmptyState("Üniversiteler yükleniyor…");
  wrap.innerHTML = netSihirbaziSkeletonHtml();

  (async function bootstrap() {
    try {
      await ensureHedefSimulatorAppwriteData();
      unis = getHedefAppwriteUniversities();
      fillUniversitySelect();
      nsBindSelect2();
      if (!unis.length) {
        renderEmptyState("YÖK Atlas / yks-data.json boş veya yüklenemedi. src/data/yok-atlas.json veya yks-data.json dosyasını kontrol edin.");
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Liste boş — katalog dosyasını kontrol edin.</p>';
        return;
      }
      renderEmptyState(null);
    } catch (e) {
      console.error("[Net Sihirbazı V2] bootstrap:", e);
      try {
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Katalog (yok-atlas.json / yks-data.json) yüklenemedi.</p>';
        if (subEl) subEl.textContent = e && e.message ? String(e.message) : "Yükleme hatası.";
      } catch (_e2) {}
    }
  })();

  uSel.addEventListener("change", function () {
    try {
      var uid = String(uSel.value || "").trim();
      resetDepartmentUi();
      nsBindSelect2();
      renderEmptyState(
        uid ? "Bölümler yükleniyor…" : "Önce üniversite seçin; bölüm listesi seçilen üniversiteye göre tekilleştirilmiş olarak gelir."
      );
      if (!uid) {
        if (uniTitle) uniTitle.textContent = "Üniversite ve bölüm seçin";
        return;
      }
      wrap.innerHTML = netSihirbaziSkeletonHtml();
      var list = getDedupedProgramsForUniversity(uid) || [];
      try {
        if (!list.length) {
          fillDepartmentSelect([]);
          dSel.disabled = true;
          nsBindSelect2();
          wrap.innerHTML =
            '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Bu üniversite için kayıtlı bölüm yok.</p>';
          if (subEl) subEl.textContent = "Bu üniversite için katalogda program yok.";
          return;
        }
        fillDepartmentSelect(list);
        nsBindSelect2();
        renderEmptyState(null);
      } catch (inner) {
        console.error("[Net Sihirbazı V2] uni change:", inner);
        renderEmptyState("Bölüm listesi işlenemedi.");
      }
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

/**
 * Güncel ÖSYM YKS ham puan katsayıları (özet; taban 100).
 * Ham = 100 + Σ (katsayı × net); birleşik yerleştirme = 0,40×TYT_ham + 0,60×AYT_ham + OBP katkısı.
 */
export var YKS_OSYM_KATSAYILAR = {
  taban: 100,
  birlesik: { tytOran: 0.4, aytOran: 0.6 },
  tyt: { turkce: 3.3, temelMat: 3.3, sosyal: 3.4, fen: 3.4 },
  aytSay: { mat: 3.0, fiz: 2.85, kim: 3.0, bio: 3.0 },
  aytEa: { mat: 3.3, edeb: 3.0, tar1: 2.8, cog1: 2.6 },
  aytSoz: { edeb: 3.0, tar1: 2.8, cog1: 2.6, tar2: 2.8, cog2: 2.6, fel: 2.7, dkab: 2.5 },
  aytDil: { yd: 2.9, edeb: 3.0 },
};

function yksHamTyt(ntTr, ntMat, ntSos, ntFen) {
  var K = YKS_OSYM_KATSAYILAR.tyt;
  var B = YKS_OSYM_KATSAYILAR.taban;
  return B + K.turkce * ntTr + K.temelMat * ntMat + K.sosyal * ntSos + K.fen * ntFen;
}

function yksHamAytSay(nMat, nFiz, nKim, nBio) {
  var K = YKS_OSYM_KATSAYILAR.aytSay;
  var B = YKS_OSYM_KATSAYILAR.taban;
  return B + K.mat * nMat + K.fiz * nFiz + K.kim * nKim + K.bio * nBio;
}
function yksHamAytEa(nMat, nEdeb, nTar1, nCog1) {
  var K = YKS_OSYM_KATSAYILAR.aytEa;
  var B = YKS_OSYM_KATSAYILAR.taban;
  return B + K.mat * nMat + K.edeb * nEdeb + K.tar1 * nTar1 + K.cog1 * nCog1;
}
function yksHamAytSoz(nEdeb, nTar1, nCog1, nTar2, nCog2, nFel, nDkab) {
  var K = YKS_OSYM_KATSAYILAR.aytSoz;
  var B = YKS_OSYM_KATSAYILAR.taban;
  return (
    B +
    K.edeb * nEdeb +
    K.tar1 * nTar1 +
    K.cog1 * nCog1 +
    K.tar2 * nTar2 +
    K.cog2 * nCog2 +
    K.fel * nFel +
    K.dkab * nDkab
  );
}
function yksHamAytDil(nYd, nEdeb) {
  var K = YKS_OSYM_KATSAYILAR.aytDil;
  var B = YKS_OSYM_KATSAYILAR.taban;
  return B + K.yd * nYd + K.edeb * nEdeb;
}

function yksBirlesikHam(tytHam, aytHam) {
  var r = YKS_OSYM_KATSAYILAR.birlesik;
  return r.tytOran * tytHam + r.aytOran * aytHam;
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

  function getMaxWarnEl(wrap) {
    if (!wrap) return null;
    var el = wrap.querySelector(".yks-dyb-maxwarn");
    if (!el) {
      el = document.createElement("span");
      el.className = "yks-dyb-maxwarn";
      el.setAttribute("role", "alert");
      wrap.appendChild(el);
    }
    return el;
  }

  function clearDyError(t) {
    if (!t || !t.wrap) return;
    t.wrap.classList.remove("yks-dyb-inputs--invalid");
    if (t.d) t.d.classList.remove("yks-inp-dyb--invalid");
    if (t.y) t.y.classList.remove("yks-inp-dyb--invalid");
    var w = t.wrap.querySelector(".yks-dyb-maxwarn");
    if (w) {
      w.hidden = true;
      w.textContent = "";
    }
  }

  function isValidPair(key) {
    var max = YKS_PUAN_SUBJECT_MAX[key];
    var t = getPair(key);
    if (!t.d || !t.y || max == null) return true;
    if (dyPairBlank(t.d, t.y)) return true;
    var d = parseDyInt(t.d);
    var y = parseDyInt(t.y);
    return d + y <= max;
  }

  function validateDyPair(key) {
    var max = YKS_PUAN_SUBJECT_MAX[key];
    var t = getPair(key);
    if (!t.d || !t.y || max == null) return true;
    sanitizeDigits(t.d);
    sanitizeDigits(t.y);
    if (dyPairBlank(t.d, t.y)) {
      clearDyError(t);
      return true;
    }
    var d = parseDyInt(t.d);
    var y = parseDyInt(t.y);
    var ok = d + y <= max;
    var warnEl = getMaxWarnEl(t.wrap);
    if (!ok) {
      if (t.wrap) t.wrap.classList.add("yks-dyb-inputs--invalid");
      if (t.d) t.d.classList.add("yks-inp-dyb--invalid");
      if (t.y) t.y.classList.add("yks-inp-dyb--invalid");
      if (warnEl) {
        warnEl.hidden = false;
        warnEl.textContent = "Maksimum soru sayısını aştınız!";
      }
    } else {
      clearDyError(t);
    }
    return ok;
  }

  function netFromPair(key) {
    var t = getPair(key);
    if (!t.d || !t.y || !t.net) return 0;
    var badge = t.net.closest ? t.net.closest(".yks-net-badge") : null;
    if (dyPairBlank(t.d, t.y)) {
      t.net.textContent = "—";
      if (badge) badge.classList.remove("yks-net-badge--invalid");
      return 0;
    }
    if (!isValidPair(key)) {
      t.net.textContent = "—";
      if (badge) badge.classList.add("yks-net-badge--invalid");
      return 0;
    }
    if (badge) badge.classList.remove("yks-net-badge--invalid");
    var d = parseDyInt(t.d);
    var y = parseDyInt(t.y);
    var net = d - y / 4;
    t.net.textContent = net.toFixed(2);
    return net;
  }

  function onDyInput(key) {
    validateDyPair(key);
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
      obpValueLabel.textContent = m === "diploma" ? "Diploma notu (OBP, 50–100)" : "OBP puanı (30–60)";
    }
    if (obpValueEl) {
      obpValueEl.setAttribute("min", m === "diploma" ? "50" : "30");
      obpValueEl.setAttribute("max", m === "diploma" ? "100" : "60");
      obpValueEl.placeholder = m === "diploma" ? "Max: 100" : "Max: 60";
    }
  }

  function readObpContribution() {
    if (!obpValueEl) return 0;
    var s = String(obpValueEl.value || "").trim().replace(",", ".");
    if (s === "") return 0;
    var n = parseFloat(s);
    return yksObpPlacementContribution(obpMode(), n, obpKirik && obpKirik.checked);
  }

  function obpValidForPlacement() {
    if (!obpValueEl) return false;
    var s = String(obpValueEl.value || "").trim().replace(",", ".");
    if (s === "") return false;
    var n = parseFloat(s);
    if (isNaN(n)) return false;
    var m = obpMode();
    if (m === "diploma") return n >= 50 && n <= 100;
    return n >= 30 && n <= 60;
  }

  var dashTytHam = document.getElementById(id("yksPuanDashTytHam"));
  var dashTytYer = document.getElementById(id("yksPuanDashTytYer"));
  var dashAytHam = document.getElementById(id("yksPuanDashAytHam"));
  var dashAytYer = document.getElementById(id("yksPuanDashAytYer"));
  var dashAytLabel = document.getElementById(id("yksPuanDashAytLabel"));
  var dashAytHint = document.getElementById(id("yksPuanDashAytHint"));
  var dashObp = document.getElementById(id("yksPuanDashObp"));
  var dashYerToplam = document.getElementById(id("yksPuanDashYerToplam"));
  var dashWarn = document.getElementById(id("yksPuanDashWarn"));
  var dashCoeff = document.getElementById(id("yksPuanDashCoeff"));
  var dashSub = document.getElementById(id("yksPuanLiveDashboardSub"));

  function dashSet(el, v) {
    if (el) el.textContent = v;
  }

  function alanDisplayName() {
    var a = alanSel ? String(alanSel.value || "say") : "say";
    if (a === "say") return "Sayısal (SAY)";
    if (a === "ea") return "Eşit ağırlık (EA)";
    if (a === "soz") return "Sözel (SÖZ)";
    if (a === "dil") return "Dil (DİL)";
    return a;
  }

  function coeffSummaryText() {
    var K = YKS_OSYM_KATSAYILAR;
    return (
      "Katsayılar (özet): TYT Türkçe " +
      K.tyt.turkce +
      ", TYT Mat " +
      K.tyt.temelMat +
      "; AYT Say Mat " +
      K.aytSay.mat +
      ", Fiz " +
      K.aytSay.fiz +
      ", Kim " +
      K.aytSay.kim +
      ", Bio " +
      K.aytSay.bio +
      "."
    );
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

  function emitYksPuanUpdate() {
    try {
      if (form && typeof CustomEvent !== "undefined") {
        form.dispatchEvent(new CustomEvent("yks-puan:updated", { bubbles: true }));
      }
    } catch (e) {}
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
      validateDyPair(k);
    });
    subjectKeys.forEach(function (k) {
      netFromPair(k);
    });
    syncObpUi();

    var br = YKS_OSYM_KATSAYILAR.birlesik;
    var dyBlocked = subjectKeys.some(function (k) {
      var t = getPair(k);
      if (!t.d || !t.y) return false;
      if (dyPairBlank(t.d, t.y)) return false;
      return !isValidPair(k);
    });

    if (dashCoeff) dashCoeff.textContent = coeffSummaryText();
    if (dashSub) dashSub.textContent = "Gerçek zamanlı · " + alanDisplayName();

    if (!anyUserInput()) {
      dashSet(dashTytHam, "—");
      dashSet(dashTytYer, "—");
      dashSet(dashAytHam, "—");
      dashSet(dashAytYer, "—");
      dashSet(dashObp, "—");
      dashSet(dashYerToplam, "—");
      dashSet(dashWarn, "");
      if (dashAytLabel) dashAytLabel.textContent = "AYT ham puanı";
      if (outWrap) outWrap.hidden = true;
      if (hamTbody) hamTbody.innerHTML = "";
      if (yerTbody) yerTbody.innerHTML = "";
      if (hintEl) hintEl.textContent = "";
      emitYksPuanUpdate();
      return;
    }

    var warnParts = [];
    if (dyBlocked) warnParts.push("Doğru + yanlış toplamı soru sayısını aşan satırlar var.");

    var tn = tytNets();
    var tytHam = yksHamTyt(tn.tr, tn.mat, tn.sos, tn.fen);
    var aytHam = aytHamForAlan();
    var birlesik = yksBirlesikHam(tytHam, aytHam);
    var tytYerPay = br.tytOran * tytHam;
    var aytYerPay = br.aytOran * aytHam;
    var obpOk = obpValidForPlacement();
    var obpC = readObpContribution();
    var yerToplam = birlesik + obpC;

    if (!obpOk) {
      warnParts.push("Yerleştirme puanı için diploma notu (50–100) veya OBP (30–60) girin.");
    }

    if (dashAytLabel) dashAytLabel.textContent = "AYT ham · " + alanDisplayName();
    if (dashAytHint) {
      dashAytHint.textContent =
        "Taban " + YKS_OSYM_KATSAYILAR.taban + " + alan katsayıları × net";
    }

    if (dyBlocked) {
      dashSet(dashTytHam, "—");
      dashSet(dashTytYer, "—");
      dashSet(dashAytHam, "—");
      dashSet(dashAytYer, "—");
      dashSet(dashObp, obpOk ? fmt(obpC) : "—");
      dashSet(dashYerToplam, "—");
    } else {
      dashSet(dashTytHam, fmt(tytHam));
      dashSet(dashTytYer, fmt(tytYerPay));
      dashSet(dashAytHam, fmt(aytHam));
      dashSet(dashAytYer, fmt(aytYerPay));
      dashSet(dashObp, obpOk ? fmt(obpC) : "—");
      dashSet(dashYerToplam, obpOk ? fmt(yerToplam) : "—");
    }

    dashSet(dashWarn, warnParts.join(" "));

    if (hamTbody) {
      hamTbody.innerHTML = "";
      if (!dyBlocked) {
        row(hamTbody, "TYT ham puanı (taban 100 + katsayılar)", fmt(tytHam));
        row(hamTbody, "AYT ham puanı (seçilen alan)", fmt(aytHam));
        row(hamTbody, "Birleşik ham (%40 TYT + %60 AYT)", fmt(birlesik));
        row(hamTbody, "TYT toplam net", fmt(tytNetSum()));
        row(hamTbody, "AYT toplam net", fmt(aytNetSum()));
      }
    }
    if (yerTbody) {
      yerTbody.innerHTML = "";
      if (!dyBlocked && obpOk) {
        row(yerTbody, "Birleşik ham", fmt(birlesik));
        row(yerTbody, "OBP yerleştirme katkısı", fmt(obpC));
        row(yerTbody, "Yerleştirme göstergesi (birleşik + OBP)", fmt(yerToplam));
      }
    }
    if (outWrap) outWrap.hidden = true;
    if (hintEl) {
      hintEl.textContent =
        "Canlı güncelleme aktif. Net: Doğru − Yanlış ÷ 4. Sonuçlar bilgilendirme amaçlıdır; resmî ÖSYM puanı değildir.";
    }
    emitYksPuanUpdate();
  }

  function resetForm() {
    subjectKeys.forEach(function (k) {
      var t = getPair(k);
      if (t.d) t.d.value = "";
      if (t.y) t.y.value = "";
      if (t.net) t.net.textContent = "—";
      clearDyError(t);
      var b = t.net && t.net.closest ? t.net.closest(".yks-net-badge") : null;
      if (b) b.classList.remove("yks-net-badge--invalid");
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
    calc();
  }

  subjectKeys.forEach(function (k) {
    var t = getPair(k);
    var max = YKS_PUAN_SUBJECT_MAX[k];
    var ph = "Max: " + max;
    if (t.d) t.d.setAttribute("placeholder", ph);
    if (t.y) t.y.setAttribute("placeholder", ph);
    ["d", "y"].forEach(function (which) {
      var el = t[which];
      if (!el) return;
      el.addEventListener("input", function () {
        onDyInput(k);
      });
      el.addEventListener("blur", function () {
        validateDyPair(k);
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
