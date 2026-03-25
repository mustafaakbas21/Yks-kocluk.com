/**
 * TYT-AYT Net Sihirbazı — tam üniversite listesi + bölüm şablonları
 * YKS Puan — TYT ders bazlı + AYT alan bazlı (demo gösterge)
 */
import {
  TR_UNIVERSITIES_UNIQUE,
  PROGRAM_TEMPLATES_UI,
} from "./yok-atlas-catalog.js";
import { wireSearchFilterForSelect, sortNamedItemsAlphabeticalTr } from "./hedef-atlas-helpers.js";
import {
  resolveNetSihirbaziProgram,
  buildMotorDisplayRows,
  netSihirbaziMotorTableHtml,
  netSihirbaziSkeletonHtml,
} from "./net-sihirbazi-engine.js";

/**
 * @param {{ uniSelectId: string, deptSelectId: string, tableWrapId: string, uniTitleId?: string, deptTitleId?: string, subtitleId?: string, uniFilterId?: string, deptFilterId?: string }} options
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
  if (!uSel || !dSel || !wrap) return;
  if (uSel.dataset.nsBound) return;
  uSel.dataset.nsBound = "1";

  uSel.innerHTML = '<option value="">— Üniversite seçin —</option>';
  sortNamedItemsAlphabeticalTr(TR_UNIVERSITIES_UNIQUE).forEach(function (u) {
    var o = document.createElement("option");
    o.value = u.id;
    o.textContent = u.name;
    uSel.appendChild(o);
  });

  dSel.innerHTML = '<option value="">— Bölüm / program türü seçin —</option>';
  sortNamedItemsAlphabeticalTr(PROGRAM_TEMPLATES_UI).forEach(function (t) {
    var o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.name;
    dSel.appendChild(o);
  });

  wireSearchFilterForSelect(uniFilter, uSel);
  wireSearchFilterForSelect(deptFilter, dSel);

  function renderEmptyState() {
    if (uniTitle) uniTitle.textContent = "Üniversite ve bölüm seçin";
    if (deptTitle) deptTitle.textContent = "Net Sihirbazı — ders bazlı hedef tablosu";
    if (subEl)
      subEl.textContent =
        "Hedef netler Appwrite’da tanımlıysa canlı çekilir; yoksa taban puanına göre tahmini dağılım üretilir.";
    wrap.innerHTML =
      '<p class="net-sihirbazi-placeholder">Üniversite ve bölüm seçildiğinde tablo oluşturulur.</p>';
  }

  function render() {
    var uid = uSel.value;
    var tid = dSel.value;
    if (!uid || !tid) {
      renderEmptyState();
      return;
    }
    wrap.innerHTML = netSihirbaziSkeletonHtml();
    resolveNetSihirbaziProgram(uid, tid)
      .then(function (prog) {
        try {
          if (!prog || !prog.rows || !prog.rows.length) {
            if (uniTitle) uniTitle.textContent = "Üniversite ve bölüm seçin";
            if (deptTitle) deptTitle.textContent = "Net Sihirbazı";
            if (subEl) subEl.textContent = "Bu eşleşme için program üretilemedi.";
            wrap.innerHTML =
              '<p class="net-sihirbazi-placeholder">Bu bölüm için net verisi bekleniyor veya seçim geçersiz.</p>';
            return;
          }
          if (uniTitle) uniTitle.textContent = prog.university;
          if (deptTitle) deptTitle.textContent = prog.department;
          if (subEl) {
            var src =
              prog.dataSource === "appwrite"
                ? "Kaynak: Appwrite hedef netleri · Taban (ref.): "
                : "Kaynak: taban puanına göre tahmini dağılım · Taban (ref.): ";
            subEl.textContent =
              src +
              prog.baseScore2025 +
              " · Koleksiyon `yks_net_sihirbazi_targets` ile gerçek netleri bağlayabilirsiniz.";
          }
          var display = buildMotorDisplayRows(prog);
          wrap.innerHTML = netSihirbaziMotorTableHtml(display, {});
        } catch (inner) {
          console.error("[Net Sihirbazı] render:", inner);
          wrap.innerHTML =
            '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Tablo oluşturulurken bir hata oluştu. Lütfen yeniden deneyin.</p>';
        }
      })
      .catch(function (err) {
        console.error("[Net Sihirbazı] yükleme:", err);
        wrap.innerHTML =
          '<p class="net-sihirbazi-placeholder net-sihirbazi-placeholder--warn">Veri yüklenemedi. Bağlantınızı kontrol edip tekrar deneyin.</p>';
      });
  }

  uSel.addEventListener("change", render);
  dSel.addEventListener("change", render);
  try {
    render();
  } catch (e) {
    console.error("[Net Sihirbazı] ilk render:", e);
    renderEmptyState();
  }
}

function readNet(id) {
  var el = document.getElementById(id);
  if (!el) return 0;
  var n = parseFloat(String(el.value || "0").replace(",", "."));
  return isNaN(n) ? 0 : n;
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
