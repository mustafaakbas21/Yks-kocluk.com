/**
 * YKS geri sayım — hedef: 14 Haziran 2026 (AYT / merkezi sınav takvimi örneği)
 * Flip-clock tarzı rakam animasyonu (Vanilla JS, CSS sınıfları #yksCountdownHost içinde)
 */
(function () {
  "use strict";

  var TARGET = new Date(2026, 5, 14, 10, 0, 0); // Haziran = ay index 5

  function pad2(n) {
    return String(Math.max(0, n)).padStart(2, "0");
  }

  function splitDigits(n, digits) {
    n = Math.max(0, Math.min(n, Math.pow(10, digits) - 1));
    var s = String(n).padStart(digits, "0");
    return s.split("");
  }

  function el(root, sel) {
    return root ? root.querySelector(sel) : null;
  }

  function setFlipSlot(slot, digit) {
    if (!slot) return;
    var cur = slot.getAttribute("data-digit");
    var inner = slot.querySelector(".yks-flip__inner");
    if (!inner) return;
    if (cur === digit) return;
    slot.setAttribute("data-digit", digit);
    inner.setAttribute("data-roll", "1");
    inner.textContent = digit;
    setTimeout(function () {
      inner.removeAttribute("data-roll");
    }, 420);
  }

  function render(host) {
    if (!host) return;
    var now = new Date();
    var diff = TARGET.getTime() - now.getTime();
    var days = Math.floor(diff / (24 * 60 * 60 * 1000));
    if (diff < 0) days = 0;
    var hrs = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
    var mins = Math.floor((diff % (60 * 60 * 1000)) / (60 * 1000));
    if (diff < 0) {
      hrs = 0;
      mins = 0;
    }

    var dLabel = el(host, "[data-yks-label='days']");
    if (dLabel) dLabel.textContent = days === 1 ? "gün" : "gün";

    var daySlots = host.querySelectorAll("[data-yks-slot='d'] .yks-flip");
    var dh = splitDigits(Math.min(days, 999), 3);
    daySlots.forEach(function (slot, i) {
      setFlipSlot(slot, dh[i] || "0");
    });

    var hm = pad2(hrs) + pad2(mins);
    var hmSlots = host.querySelectorAll("[data-yks-slot='hm'] .yks-flip");
    hm.split("").forEach(function (ch, i) {
      setFlipSlot(hmSlots[i], ch);
    });
  }

  function mount(targetId) {
    var host = document.getElementById(targetId || "yksCountdownHost");
    if (!host || host.getAttribute("data-yks-mounted") === "1") return;
    host.setAttribute("data-yks-mounted", "1");
    host.innerHTML =
      '<div class="yks-countdown">' +
      '  <div class="yks-countdown__head">' +
      '    <span class="yks-countdown__badge">YKS 2026</span>' +
      '    <h3 class="yks-countdown__title">Sınava kalan süre</h3>' +
      '    <p class="yks-countdown__sub">Hedef: 14 Haziran 2026</p>' +
      "  </div>" +
      '  <div class="yks-countdown__body">' +
      '    <div class="yks-countdown__block" aria-label="Gün">' +
      '      <div class="yks-flip-row" data-yks-slot="d">' +
      '        <div class="yks-flip" data-digit="0"><span class="yks-flip__inner">0</span></div>' +
      '        <div class="yks-flip" data-digit="0"><span class="yks-flip__inner">0</span></div>' +
      '        <div class="yks-flip" data-digit="0"><span class="yks-flip__inner">0</span></div>' +
      "      </div>" +
      '      <span class="yks-countdown__unit" data-yks-label="days">gün</span>' +
      "    </div>" +
      '    <div class="yks-countdown__sep" aria-hidden="true">:</div>' +
      '    <div class="yks-countdown__block" aria-label="Saat ve dakika">' +
      '      <div class="yks-flip-row yks-flip-row--sm" data-yks-slot="hm">' +
      '        <div class="yks-flip" data-digit="0"><span class="yks-flip__inner">0</span></div>' +
      '        <div class="yks-flip" data-digit="0"><span class="yks-flip__inner">0</span></div>' +
      '        <div class="yks-flip" data-digit="0"><span class="yks-flip__inner">0</span></div>' +
      '        <div class="yks-flip" data-digit="0"><span class="yks-flip__inner">0</span></div>' +
      "      </div>" +
      '      <span class="yks-countdown__unit">saat · dk</span>' +
      "    </div>" +
      "  </div>" +
      "</div>";

    render(host);
    setInterval(function () {
      render(host);
    }, 1000);
  }

  window.yksCountdownMount = mount;
  document.addEventListener("DOMContentLoaded", function () {
    mount("yksCountdownHost");
  });
})();
