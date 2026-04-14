/**
 * Test Tasarım Stüdyosu — vanilla JS (taslak, canlı önizleme, PDF, sürükle-bırak sıralama).
 */
(function () {
  "use strict";

  var DRAFT_KEY = "testOlusturucuStudioDraft_v1";

  window.__STUDIO_TEMPLATES__ = {
    "1": { short: "Standart Sınav", hint: "\u00d6SYM tarz\u0131 \u00e7ift s\u00fctun" },
    "2": { short: "Modern Fasik\u00fcl", hint: "Ferah s\u00fctunlar" },
    "3": { short: "\u00c7al\u0131\u015fma Yapra\u011f\u0131", hint: "Not alan\u0131" },
    "4": { short: "Kurumsal", hint: "Antetli ka\u011f\u0131t" },
    "5": { short: "Kompakt", hint: "Yo\u011fun d\u00fczen" },
    "6": { short: "Quiz Modu", hint: "Kutulu sorular" },
    "7": { short: "\u00c7\u00f6z\u00fcml\u00fc Rehber", hint: "\u00c7\u00f6z\u00fcm alan\u0131" },
    "8": { short: "Dijital Odakl\u0131", hint: "Geni\u015f puntolu" },
    "9": { short: "S\u00f6zel Odakl\u0131", hint: "Tek s\u00fctun" },
    "10": { short: "Deneme Modu", hint: "Cevap anahtar\u0131" },
  };

  var state = {
    kurum: "",
    baslik: "",
    slogan: "",
    templateId: "1",
 };

  var SAMPLE_QUESTIONS = [
    {
      id: "q1",
      stem:
        "Bir kimyasal tepkimede 2 mol X gazı ile 3 mol Y gazı birleşerek Z bileşiğini oluşturmaktadır. Buna göre aşağıdakilerden hangisi doğrudur?",
      opts: ["Tepkime endotermiktir.", "Mol sayısı korunur.", "Kütlesi artar.", "Hacim sabittir.", "Yoğunluk değişmez."],
    },
    {
      id: "q2",
      stem:
        "Aşağıdaki paragrafta anlatılan ana düşünceyi en iyi özetleyen seçenek hangisidir?\n\n“Bilimsel okuryazarlık, yalnızca bilgi biriktirmek değil; kaynakları sorgulama ve kanıtlarla karar verme becerisidir.”",
      opts: [
        "Bilgi ezberi yeterlidir.",
        "Okuryazarlık eleştirel düşünmeyi içerir.",
        "Kaynaklara güvenilmez.",
        "Kanıt aranmaz.",
        "Paragraf tanım içerir.",
      ],
    },
    {
      id: "q3",
      stem: "f(x) = x² − 4x + 3 fonksiyonunun minimum değeri kaçtır?",
      opts: ["−1", "0", "1", "3", "4"],
    },
    {
      id: "q4",
      stem: "Osmanlı'da ilk nüfus sayımı genellikle hangi padişah döneminde sistematik hale getirilmiştir?",
      opts: ["II. Mehmed", "Kanuni Sultan Süleyman", "IV. Murad", "III. Selim", "II. Mahmud"],
    },
    {
      id: "q5",
      stem: "Aşağıdaki cümlelerin hangisinde yazım yanlışı vardır?",
      opts: [
        "Herkese teşekkür ederim.",
        "Yarın ki toplantı erken.",
        "İki yüz öğrenci geldi.",
        "Sınıf başkanı seçildi.",
        "Rapor teslim edildi.",
      ],
    },
  ];

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function escapeHtml(s) {
    var d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function formatStem(text) {
    return escapeHtml(text).replace(/\n/g, "<br />");
  }

  function slugFileName(s) {
    var map = {
      "\u011f": "g",
      "\u00fc": "u",
      "\u015f": "s",
      "\u0131": "i",
      "\u00f6": "o",
      "\u00e7": "c",
      "\u0130": "i",
      "\u011e": "g",
      "\u00dc": "u",
      "\u015e": "s",
      "\u00d6": "o",
      "\u00c7": "c",
    };
    var t = (s || "test-tasarim")
      .split("")
      .map(function (ch) {
        return map[ch] || ch;
      })
      .join("");
    t = t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
    return t || "test-tasarim";
  }

  function renderQuestions() {
    var list = $("#questionsList");
    if (!list) return;
    list.innerHTML = SAMPLE_QUESTIONS.map(function (q, idx) {
      var opts = q.opts
        .map(function (o) {
          return '<li class="studio-q-opt">' + escapeHtml(o) + "</li>";
        })
        .join("");
      var solution =
        '<div class="studio-solution"><span class="studio-solution__lbl">Çözüm</span><p>Örnek çözüm metni — gerçek içerik daha sonra bağlanacak.</p></div>';
      var note = '<div class="studio-note-rail" aria-label="Not alanı"></div>';
      return (
        '<article class="studio-q" draggable="true" data-qid="' +
        escapeHtml(q.id) +
        '" data-index="' +
        idx +
        '">' +
        '<div class="studio-q__main">' +
        '<div class="studio-q__badge">' +
        (idx + 1) +
        "</div>" +
        '<div class="studio-q__body">' +
        '<p class="studio-q__stem">' +
        formatStem(q.stem) +
        "</p>" +
        '<ol class="studio-q__opts">' +
        opts +
        "</ol>" +
        solution +
        "</div>" +
        "</div>" +
        note +
        "</article>"
      );
    }).join("");
    initSortable(list);
  }

  function initSortable(container) {
    var dragged = null;
    $all(".studio-q", container).forEach(function (el) {
      el.setAttribute("draggable", "true");
      el.addEventListener("dragstart", function (e) {
        dragged = el;
        el.classList.add("studio-q--dragging");
        try {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", el.getAttribute("data-qid") || "");
        } catch (err) {}
      });
      el.addEventListener("dragend", function () {
        el.classList.remove("studio-q--dragging");
        dragged = null;
        renumberBadges(container);
      });
      el.addEventListener("dragover", function (e) {
        e.preventDefault();
        try {
          e.dataTransfer.dropEffect = "move";
        } catch (err) {}
        if (!dragged || dragged === el) return;
        var rect = el.getBoundingClientRect();
        var before = e.clientY < rect.top + rect.height / 2;
        if (before) container.insertBefore(dragged, el);
        else container.insertBefore(dragged, el.nextSibling);
      });
      el.addEventListener("drop", function (e) {
        e.preventDefault();
      });
    });
  }

  function renumberBadges(container) {
    $all(".studio-q", container).forEach(function (el, i) {
      var b = $(".studio-q__badge", el);
      if (b) b.textContent = String(i + 1);
    });
  }

  function applyStateToDom() {
    var paper = $("#studioPaper");
    var k = $("#fieldKurum");
    var t = $("#fieldBaslik");
    var s = $("#fieldSlogan");
    if (k) k.value = state.kurum;
    if (t) t.value = state.baslik;
    if (s) s.value = state.slogan;
    if (paper) paper.setAttribute("data-template", state.templateId);
    $("#previewKurum").textContent = state.kurum || "Kurum Adı";
    $("#previewBaslik").textContent = state.baslik || "Test Başlığı";
    $("#previewSlogan").textContent = state.slogan || "Alt bilgi veya slogan burada görünür.";
    syncTemplateUi();
  }

  function syncTemplateUi() {
    var id = state.templateId;
    $all("[data-template-id]").forEach(function (btn) {
      var on = btn.getAttribute("data-template-id") === id;
      btn.classList.toggle("ring-2", on);
      btn.classList.toggle("ring-violet-500", on);
      btn.classList.toggle("bg-violet-50", on);
    });
    var label = $("#templateTriggerLabel");
    var meta = window.__STUDIO_TEMPLATES__ && window.__STUDIO_TEMPLATES__[id];
    if (label && meta) label.textContent = meta.short;
  }

  function saveDraft() {
    state.kurum = ($("#fieldKurum") && $("#fieldKurum").value) || "";
    state.baslik = ($("#fieldBaslik") && $("#fieldBaslik").value) || "";
    state.slogan = ($("#fieldSlogan") && $("#fieldSlogan").value) || "";
    state.templateId = state.templateId || "1";
    try {
      localStorage.setItem(
        DRAFT_KEY,
        JSON.stringify({
          kurum: state.kurum,
          baslik: state.baslik,
          slogan: state.slogan,
          templateId: state.templateId,
          savedAt: Date.now(),
        })
      );
    } catch (e) {}
  }

  function loadDraft() {
    try {
      var raw = localStorage.getItem(DRAFT_KEY);
      if (!raw) return;
      var d = JSON.parse(raw);
      if (d.kurum != null) state.kurum = String(d.kurum);
      if (d.baslik != null) state.baslik = String(d.baslik);
      if (d.slogan != null) state.slogan = String(d.slogan);
      if (d.templateId != null) state.templateId = String(d.templateId);
    } catch (e) {}
  }

  function toast(msg, kind) {
    var host = $("#studioToast");
    if (!host) return;
    host.textContent = msg;
    host.classList.remove("opacity-0", "translate-y-2", "pointer-events-none");
    host.classList.toggle("bg-emerald-600", kind === "ok");
    host.classList.toggle("bg-slate-900", kind !== "ok");
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      host.classList.add("opacity-0", "translate-y-2", "pointer-events-none");
    }, 2600);
  }

  async function exportPdf() {
    var paper = $("#studioPaper");
    if (!paper) return;
    var btn = $("#btnPdfIndir");
    if (btn) {
      btn.disabled = true;
      btn.textContent = "Hazırlanıyor…";
    }
    try {
      var scale = Math.min(3, (window.devicePixelRatio || 1) * 2);
      var canvas = await html2canvas(paper, {
        scale: scale,
        useCORS: true,
        allowTaint: true,
        backgroundColor: "#ffffff",
        logging: false,
        windowWidth: paper.scrollWidth,
        windowHeight: paper.scrollHeight,
      });
      var imgData = canvas.toDataURL("image/jpeg", 0.92);
      var JSPDF = (window.jspdf && window.jspdf.jsPDF) || window.jsPDF;
      if (!JSPDF) throw new Error("jsPDF yüklenemedi.");
      var pdf = new JSPDF({ orientation: "portrait", unit: "mm", format: "a4", compress: true });
      var pageW = pdf.internal.pageSize.getWidth();
      var pageH = pdf.internal.pageSize.getHeight();
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH, undefined, "FAST");
      var name = slugFileName(state.baslik || state.kurum || "test");
      pdf.save(name + ".pdf");
      toast("PDF indirildi.", "ok");
    } catch (e) {
      console.error(e);
      toast("PDF oluşturulamadı. Konsolu kontrol edin.", "err");
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.textContent = "PDF Olarak İndir";
      }
    }
  }

  function wire() {
    loadDraft();
    renderQuestions();
    applyStateToDom();

    var k = $("#fieldKurum");
    var t = $("#fieldBaslik");
    var s = $("#fieldSlogan");
    function live() {
      state.kurum = (k && k.value) || "";
      state.baslik = (t && t.value) || "";
      state.slogan = (s && s.value) || "";
      $("#previewKurum").textContent = state.kurum || "Kurum Adı";
      $("#previewBaslik").textContent = state.baslik || "Test Başlığı";
      $("#previewSlogan").textContent = state.slogan || "Alt bilgi veya slogan burada görünür.";
    }
    if (k) k.addEventListener("input", live);
    if (t) t.addEventListener("input", live);
    if (s) s.addEventListener("input", live);

    var panel = $("#templatePanel");
    var trigger = $("#templateTrigger");
    if (trigger && panel) {
      trigger.addEventListener("click", function () {
        panel.classList.toggle("hidden");
      });
      document.addEventListener("click", function (e) {
        if (!panel.contains(e.target) && e.target !== trigger && !trigger.contains(e.target)) {
          panel.classList.add("hidden");
        }
      });
    }

    $all("[data-template-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        state.templateId = btn.getAttribute("data-template-id") || "1";
        $("#studioPaper").setAttribute("data-template", state.templateId);
        syncTemplateUi();
        if (panel) panel.classList.add("hidden");
      });
    });

    var btnSave = $("#btnTaslakKaydet");
    if (btnSave) {
      btnSave.addEventListener("click", function () {
        live();
        saveDraft();
        toast("Taslak tarayıcıya kaydedildi.", "ok");
      });
    }

    var btnPdf = $("#btnPdfIndir");
    if (btnPdf) btnPdf.addEventListener("click", exportPdf);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();
