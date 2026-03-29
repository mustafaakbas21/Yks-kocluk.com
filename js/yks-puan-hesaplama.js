/**
 * YKS Puan Hesaplama — Tahmini başarı sıralaması (Canlı Sonuç Panosu eklentisi).
 * Yerleştirme göstergesi (birleşik ham + OBP) ile ÖSYM yığılmaya yaklaşık doğrusal eşleme (tahmini).
 */

/**
 * Alan bazlı puan → sıralama kırılımları (yaklaşık 2024 düzeyi; gösterge puanı ölçeğine göre ayarlı).
 * Dizi: puan azalan sıra (yüksek puan = daha iyi sıra = daha küçük sayı).
 */
export var YKS_YERLESME_SIRA_BAREM = {
  say: [
    { puan: 545, sira: 120 },
    { puan: 510, sira: 6500 },
    { puan: 475, sira: 32000 },
    { puan: 440, sira: 95000 },
    { puan: 405, sira: 210000 },
    { puan: 365, sira: 420000 },
    { puan: 320, sira: 720000 },
    { puan: 270, sira: 1100000 },
  ],
  ea: [
    { puan: 530, sira: 180 },
    { puan: 495, sira: 9000 },
    { puan: 460, sira: 38000 },
    { puan: 425, sira: 105000 },
    { puan: 390, sira: 235000 },
    { puan: 350, sira: 480000 },
    { puan: 305, sira: 780000 },
    { puan: 260, sira: 1150000 },
  ],
  soz: [
    { puan: 505, sira: 250 },
    { puan: 470, sira: 12000 },
    { puan: 435, sira: 52000 },
    { puan: 400, sira: 140000 },
    { puan: 365, sira: 310000 },
    { puan: 325, sira: 580000 },
    { puan: 285, sira: 920000 },
    { puan: 240, sira: 1350000 },
  ],
  dil: [
    { puan: 535, sira: 80 },
    { puan: 500, sira: 4000 },
    { puan: 465, sira: 22000 },
    { puan: 430, sira: 68000 },
    { puan: 395, sira: 165000 },
    { puan: 355, sira: 360000 },
    { puan: 310, sira: 620000 },
    { puan: 265, sira: 980000 },
  ],
};

/**
 * İki kırılım arasında doğrusal sıralama tahmini.
 * @param {number} p — yerleştirme göstergesi (paneldeki toplam)
 * @param {{puan:number,sira:number}[]} rows — puan azalan
 * @returns {number|null}
 */
export function yksInterpolateSiralamaFromBarem(p, rows) {
  if (p == null || isNaN(p) || !rows || !rows.length) return null;
  var r = rows.slice().sort(function (a, b) {
    return b.puan - a.puan;
  });
  var top = r[0];
  var bot = r[r.length - 1];
  if (p >= top.puan) return Math.max(1, top.sira);
  if (p <= bot.puan) return Math.round(bot.sira + Math.max(0, bot.puan - p) * 2500);
  for (var i = 0; i < r.length - 1; i++) {
    var hi = r[i];
    var lo = r[i + 1];
    if (p <= hi.puan && p >= lo.puan) {
      var t = (hi.puan - p) / (hi.puan - lo.puan || 1);
      return Math.round(hi.sira + t * (lo.sira - hi.sira));
    }
  }
  return null;
}

export function yksEstimateSiralamaForAlan(alanKey, yerlesmeGostergesi) {
  var k = String(alanKey || "say").toLowerCase();
  var rows = YKS_YERLESME_SIRA_BAREM[k] || YKS_YERLESME_SIRA_BAREM.say;
  return yksInterpolateSiralamaFromBarem(Number(yerlesmeGostergesi), rows);
}

function injectSiralamaStylesOnce() {
  if (document.getElementById("yks-puan-siralama-style")) return;
  var st = document.createElement("style");
  st.id = "yks-puan-siralama-style";
  st.textContent =
    ".yks-live-card--siralama{" +
    "background:linear-gradient(135deg,#faf5ff 0%,#eef2ff 55%,#fff 100%)!important;" +
    "border:2px solid #c4b5fd!important;" +
    "box-shadow:0 6px 24px rgba(91,33,182,0.14),inset 0 1px 0 rgba(255,255,255,0.85);" +
    "position:relative;" +
    "overflow:hidden;" +
    "grid-column:1 / -1;" +
    "}" +
    ".yks-live-card--siralama::before{" +
    "content:'';position:absolute;inset:0;border-radius:13px;" +
    "pointer-events:none;box-shadow:inset 0 0 0 1px rgba(234,179,8,0.35);" +
    "}" +
    ".yks-live-card--siralama .yks-live-card__label{color:#5b21b6!important;}" +
    ".yks-live-card__disclaimer{font-size:0.62rem!important;line-height:1.35!important;" +
    "color:#94a3b8!important;margin:0.4rem 0 0!important;font-weight:500;}" +
    "@media (min-width:720px){.yks-live-card--siralama{grid-column:auto;}}";
  document.head.appendChild(st);
}

export function injectYksPuanSiralamaCard(grid) {
  if (!grid || document.getElementById("yksPuanDashSiralamaVal")) return;
  injectSiralamaStylesOnce();
  var card = document.createElement("div");
  card.className = "yks-live-card yks-live-card--siralama";
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", "Tahmini başarı sıralaması");
  card.innerHTML =
    '<span class="yks-live-card__label">🏆 TAHMİNİ SIRALAMA</span>' +
    '<span class="yks-live-card__val" id="yksPuanDashSiralamaVal">—</span>' +
    '<span class="yks-live-card__hint">Gösterge puanı → yığılma eğrisi</span>' +
    '<p class="yks-live-card__disclaimer">' +
    "* ÖSYM 2024/2025 yığılma eğilimlerine göre yaklaşık tahmin; resmî yerleştirme puanı / sıralama değildir." +
    "</p>";
  grid.appendChild(card);
}

export function syncYksPuanSiralamaFromDom() {
  var valEl = document.getElementById("yksPuanDashSiralamaVal");
  var totEl = document.getElementById("yksPuanDashYerToplam");
  var alanEl = document.getElementById("yksAlanSelect");
  if (!valEl) return;
  var raw = totEl && totEl.textContent ? String(totEl.textContent).trim() : "";
  if (!raw || raw === "—" || raw === "-" || raw === "…") {
    valEl.textContent = "—";
    return;
  }
  var p = parseFloat(String(raw).replace(/\s/g, "").replace(",", "."));
  if (isNaN(p)) {
    valEl.textContent = "—";
    return;
  }
  var ak = alanEl ? String(alanEl.value || "say") : "say";
  var sira = yksEstimateSiralamaForAlan(ak, p);
  if (sira == null || !isFinite(sira)) {
    valEl.textContent = "—";
    return;
  }
  valEl.textContent = Math.max(1, Math.round(sira)).toLocaleString("tr-TR");
}

function ensureInjectedInCoachPanel() {
  var grid = document.querySelector("#view-yks-puan .yks-puan-live-dashboard__grid");
  if (!grid) return;
  injectYksPuanSiralamaCard(grid);
  syncYksPuanSiralamaFromDom();
}

function boot() {
  ensureInjectedInCoachPanel();
  document.addEventListener("yks-puan:updated", function () {
    syncYksPuanSiralamaFromDom();
  });
  window.addEventListener("yks:navigate", function (ev) {
    try {
      if (ev && ev.detail && ev.detail.view === "yks-puan") {
        requestAnimationFrame(function () {
          ensureInjectedInCoachPanel();
        });
      }
    } catch (_e) {}
  });
  var demo = document.getElementById("yksPuanHesaplamaDemoGrid");
  if (demo && !document.getElementById("view-yks-puan")) {
    injectYksPuanSiralamaCard(demo);
    var v = document.getElementById("yksPuanDashSiralamaVal");
    if (v) v.textContent = "45.230";
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
}
