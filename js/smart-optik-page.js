/**
 * Akıllı Optik V2 — Appwrite Exams + ExamResults, sahte veri yok.
 */
import { ID, Query } from "./appwrite-browser.js";
import {
  databases,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_EXAMS,
  APPWRITE_COLLECTION_EXAM_RESULTS,
  APPWRITE_COLLECTION_LESSONS,
  APPWRITE_COLLECTION_TOPICS,
} from "./appwrite-config.js";
import { logAppwriteError } from "./appwrite-compat.js";
import { buildExamResultCreatePayload } from "./exam-results-appwrite.js";
import { SMART_OPTIK_LETTERS } from "./smart-optik-engine.js";
import {
  parseExamAnswerKey,
  computeTotalsFromRows,
  perLessonStats,
  buildExamResultDetail,
} from "./smart-optik-answerkey.js";

var STATUS_PLAN = "Planlandı";
var STATUS_OKUNUYOR = "Okunuyor";

/**
 * OpenCV öncesi şablon: görüntüyü işle (şimdilik gecikme + boş sonuç).
 * @param {string} base64Image — data URL veya ham base64
 * @param {string} answerKey — Exams.answerKey ham JSON string
 * @returns {Promise<{ processed: boolean }>}
 */
export async function processOpticalImage(base64Image, answerKey) {
  void base64Image;
  void answerKey;
  await new Promise(function (resolve) {
    setTimeout(resolve, 2000);
  });
  return { processed: true };
}

/**
 * @param {HTMLVideoElement} video
 * @param {HTMLCanvasElement} canvas
 * @param {number} [quality]
 * @returns {string}
 */
export function smartOptikCaptureVideoFrameToDataUrl(video, canvas, quality) {
  if (!video || !canvas) return "";
  var w = video.videoWidth || 640;
  var h = video.videoHeight || 480;
  if (w <= 0 || h <= 0) return "";
  canvas.width = w;
  canvas.height = h;
  var ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.drawImage(video, 0, 0, w, h);
  var q = typeof quality === "number" ? quality : 0.92;
  try {
    return canvas.toDataURL("image/jpeg", q);
  } catch (e) {
    return "";
  }
}

/**
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export function smartOptikFileToDataUrl(blob) {
  return new Promise(function (resolve, reject) {
    var r = new FileReader();
    r.onload = function () {
      resolve(typeof r.result === "string" ? r.result : "");
    };
    r.onerror = function () {
      reject(new Error("Dosya okunamadı"));
    };
    r.readAsDataURL(blob);
  });
}

function el(id) {
  return document.getElementById(id);
}

function escapeHtml(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

/**
 * @param {{ showToast?: function, getCoachId?: function(): string, getStudents?: function(): object[] }} ctx
 */
export function initSmartOptikPage(ctx) {
  ctx = ctx || {};
  var toast =
    typeof ctx.showToast === "function"
      ? ctx.showToast
      : function (m, o) {
          void m;
          void o;
        };
  var getCoachId =
    typeof ctx.getCoachId === "function"
      ? ctx.getCoachId
      : function () {
          return "";
        };
  var getStudents =
    typeof ctx.getStudents === "function"
      ? ctx.getStudents
      : function () {
          return [];
        };

  var root = el("view-deneme-analiz-optik");
  if (!root || root.dataset.aoInit === "1") return;
  root.dataset.aoInit = "1";

  var selExam = el("aoExamSelect");
  var hintExam = el("aoExamSelectHint");
  var workspace = el("aoWorkspace");
  var saveBar = el("aoSaveKarneBar");
  var tabCam = el("aoTabCamera");
  var tabManual = el("aoTabManual");
  var panelCam = el("aoPanelCamera");
  var panelManual = el("aoPanelManual");
  var sectionsHost = el("aoManualSections");
  var summaryEl = el("aoLiveSummary");
  var selStudent = el("aoStudentSelect");
  var btnSaveKarne = el("aoBtnSaveKarne");

  var video = el("aoCamVideo");
  var canvas = el("aoCamCanvas");
  var stream = null;
  var lastBase64 = "";
  var analyzing = false;

  /** @type {Array<{ n: number, lessonId: string, topicId: string, answer: string }>} */
  var keyRows = [];
  /** @type {(string|null)[]} */
  var answers = [];
  /** @type {object|null} */
  var selectedExamDoc = null;
  /** @type {Record<string, string>} */
  var lessonNameMap = {};
  /** @type {Record<string, string>} */
  var topicNameMap = {};

  function setWorkspaceEnabled(on) {
    if (workspace) {
      workspace.classList.toggle("pointer-events-none", !on);
      workspace.classList.toggle("opacity-40", !on);
      workspace.classList.toggle("opacity-100", on);
      workspace.setAttribute("aria-disabled", on ? "false" : "true");
    }
    if (saveBar) {
      saveBar.classList.toggle("pointer-events-none", !on);
      saveBar.classList.toggle("opacity-40", !on);
      saveBar.classList.toggle("opacity-100", on);
    }
  }

  function populateStudentSelect() {
    if (!selStudent) return;
    var keep = selStudent.value;
    selStudent.innerHTML = '<option value="">— Öğrenci seçin —</option>';
    try {
      var list = getStudents() || [];
      list.forEach(function (s) {
        var o = document.createElement("option");
        o.value = String(s.id || "");
        o.textContent = String(s.name || s.studentName || s.id || "Öğrenci");
        selStudent.appendChild(o);
      });
      if (
        keep &&
        Array.prototype.some.call(selStudent.options, function (op) {
          return op.value === keep;
        })
      ) {
        selStudent.value = keep;
      } else if (list.length === 1) {
        selStudent.value = String(list[0].id || "");
      }
    } catch (e) {
      logAppwriteError("smart-optik-page/populateStudentSelect", e);
    }
  }

  async function fetchLessonTopicMaps() {
    lessonNameMap = {};
    topicNameMap = {};
    try {
      var lr = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_LESSONS, [
        Query.limit(500),
      ]);
      (lr.documents || []).forEach(function (d) {
        var id = d.$id || d.id;
        if (id) lessonNameMap[id] = String(d.lessonName || id);
      });
    } catch (e) {
      logAppwriteError("smart-optik-page/fetchLessons", e);
    }
    try {
      var tr = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_TOPICS, [
        Query.limit(2000),
      ]);
      (tr.documents || []).forEach(function (d) {
        var id = d.$id || d.id;
        if (id) topicNameMap[id] = String(d.topicName || id);
      });
    } catch (e) {
      logAppwriteError("smart-optik-page/fetchTopics", e);
    }
  }

  async function fetchExamsForOptik() {
    var cid = String(getCoachId() || "").trim();
    var docs = [];
    var queries = [Query.orderDesc("$createdAt"), Query.limit(500)];
    try {
      var q = queries.slice();
      q.unshift(
        Query.or([Query.equal("status", STATUS_PLAN), Query.equal("status", STATUS_OKUNUYOR)])
      );
      if (cid) q.unshift(Query.equal("coach_id", cid));
      var res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_EXAMS, q);
      docs = res.documents || [];
    } catch (err) {
      try {
        var res2 = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_EXAMS, [
          Query.orderDesc("$createdAt"),
          Query.limit(500),
        ]);
        docs = (res2.documents || []).filter(function (d) {
          var st = String(d.status || "").trim();
          if (st !== STATUS_PLAN && st !== STATUS_OKUNUYOR) return false;
          if (!cid) return true;
          var x = d.coach_id != null ? d.coach_id : d.coachId;
          return String(x || "").trim() === cid;
        });
      } catch (err2) {
        throw err2;
      }
    }
    if (cid && docs.length) {
      docs = docs.filter(function (d) {
        var x = d.coach_id != null ? d.coach_id : d.coachId;
        if (x === undefined || x === null || String(x).trim() === "") return false;
        return String(x).trim() === cid;
      });
    }
    return docs;
  }

  async function loadExamOptions() {
    if (!selExam) return;
    var v = selExam.value;
    selExam.innerHTML = '<option value="">— Önce deneme seçin —</option>';
    try {
      var docs = await fetchExamsForOptik();
      docs.forEach(function (d) {
        var id = d.$id || d.id;
        if (!id) return;
        var opt = document.createElement("option");
        opt.value = id;
        var name = d.examName || "Deneme";
        var dt = d.date ? new Date(d.date).toLocaleDateString("tr-TR") : "";
        opt.textContent = dt ? name + " · " + dt : name;
        selExam.appendChild(opt);
      });
      if (
        v &&
        Array.prototype.some.call(selExam.options, function (o) {
          return o.value === v;
        })
      ) {
        selExam.value = v;
      }
      if (hintExam) {
        hintExam.textContent =
          docs.length === 0
            ? "Uygun deneme yok. Denemeler sayfasında durumu «Planlandı» veya «Okunuyor» olan kayıt oluşturun."
            : "Yalnızca durumu Planlandı veya Okunuyor olan denemeler listelenir.";
      }
    } catch (err) {
      logAppwriteError("smart-optik-page/loadExamOptions", err);
      toast("Denemeler yüklenemedi: " + (err && err.message ? err.message : String(err)), {
        variant: "danger",
      });
    }
  }

  function clearManualUi() {
    keyRows = [];
    answers = [];
    selectedExamDoc = null;
    if (sectionsHost) sectionsHost.innerHTML = "";
    if (summaryEl) summaryEl.innerHTML = "";
    lastBase64 = "";
    var prev = el("aoStillPreview");
    if (prev) {
      prev.src = "";
      prev.hidden = true;
    }
  }

  function setTab(which) {
    var cam = which === "camera";
    if (tabCam) {
      tabCam.classList.toggle("is-active", cam);
      tabCam.setAttribute("aria-selected", cam ? "true" : "false");
    }
    if (tabManual) {
      tabManual.classList.toggle("is-active", !cam);
      tabManual.setAttribute("aria-selected", cam ? "false" : "true");
    }
    if (panelCam) panelCam.hidden = !cam;
    if (panelManual) panelManual.hidden = cam;
    if (!cam) stopCamera();
  }

  function stopCamera() {
    if (stream) {
      stream.getTracks().forEach(function (t) {
        try {
          t.stop();
        } catch (e) {
          void e;
        }
      });
      stream = null;
    }
    if (video) video.srcObject = null;
  }

  function renderManualGrid() {
    if (!sectionsHost || !keyRows.length) {
      if (sectionsHost) sectionsHost.innerHTML = "";
      return;
    }
    sectionsHost.innerHTML = "";
    var groups = [];
    var cur = null;
    keyRows.forEach(function (row) {
      var lid = row.lessonId || "_genel";
      if (!cur || cur.lid !== lid) {
        cur = { lid: lid, items: [] };
        groups.push(cur);
      }
      cur.items.push(row);
    });

    groups.forEach(function (g) {
      var block = document.createElement("div");
      block.className = "ao-sec mb-8 rounded-2xl border border-violet-100 bg-white/90 p-4 shadow-sm";
      var head = document.createElement("div");
      head.className = "ao-sec__head mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-violet-100 pb-2";
      var lname = lessonNameMap[g.lid] || g.lid;
      head.innerHTML =
        '<h3 class="ao-sec__title text-base font-bold text-violet-900">' +
        escapeHtml(lname) +
        '</h3><span class="ao-sec__count rounded-full bg-violet-100 px-3 py-0.5 text-xs font-bold text-violet-800">' +
        g.items.length +
        " soru</span>";
      block.appendChild(head);
      var grid = document.createElement("div");
      grid.className = "ao-sec__grid flex flex-col gap-2";
      g.items.forEach(function (row) {
        var idx = keyRows.indexOf(row);
        if (idx < 0) return;
        grid.appendChild(buildQuestionRow(idx, row.n));
      });
      block.appendChild(grid);
      sectionsHost.appendChild(block);
    });
    updateStickySummary();
  }

  function buildQuestionRow(flatIndex, displayNum) {
    var row = document.createElement("div");
    row.className =
      "ao-q-row flex flex-wrap items-center gap-2 rounded-xl border border-slate-100 bg-slate-50/80 px-2 py-2 sm:gap-3";
    var num = document.createElement("span");
    num.className =
      "ao-q-num inline-flex min-w-[2rem] items-center justify-center rounded-lg bg-white text-sm font-bold text-slate-700 shadow-sm";
    num.textContent = String(displayNum);
    var group = document.createElement("div");
    group.className = "ao-bubble-group flex flex-wrap items-center gap-1.5";
    group.setAttribute("role", "group");
    group.setAttribute("aria-label", "Soru " + displayNum);
    SMART_OPTIK_LETTERS.forEach(function (L) {
      var b = document.createElement("button");
      b.type = "button";
      b.className =
        "ao-bubble inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full border-2 border-slate-200 bg-white text-sm font-bold text-slate-600 shadow-sm transition hover:border-violet-400 hover:text-violet-700 focus:outline-none focus:ring-2 focus:ring-violet-300";
      b.textContent = L;
      b.dataset.letter = L;
      b.addEventListener("click", function () {
        var cur = answers[flatIndex];
        answers[flatIndex] = cur === L ? null : L;
        syncRowUI(flatIndex, row);
        updateStickySummary();
      });
      group.appendChild(b);
    });
    var clr = document.createElement("button");
    clr.type = "button";
    clr.className =
      "ao-bubble ao-bubble--clear inline-flex h-9 w-9 items-center justify-center rounded-full border-2 border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100";
    clr.title = "Temizle";
    clr.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
    clr.addEventListener("click", function () {
      answers[flatIndex] = null;
      syncRowUI(flatIndex, row);
      updateStickySummary();
    });
    group.appendChild(clr);
    row.appendChild(num);
    row.appendChild(group);
    syncRowUI(flatIndex, row);
    return row;
  }

  function syncRowUI(flatIndex, row) {
    var val = answers[flatIndex];
    row.querySelectorAll(".ao-bubble[data-letter]").forEach(function (btn) {
      var L = btn.getAttribute("data-letter");
      var on = val === L;
      btn.classList.toggle("is-selected", on);
      btn.classList.toggle("border-violet-600", on);
      btn.classList.toggle("bg-violet-600", on);
      btn.classList.toggle("text-white", on);
      btn.classList.toggle("shadow-md", on);
      btn.classList.toggle("border-slate-200", !on);
      btn.classList.toggle("bg-white", !on);
      btn.classList.toggle("text-slate-600", !on);
    });
  }

  function formatNet(n) {
    var x = Number(n);
    if (isNaN(x)) return "—";
    return (Math.round(x * 1000) / 1000).toString().replace(".", ",");
  }

  function updateStickySummary() {
    if (!summaryEl) return;
    if (!keyRows.length) {
      summaryEl.innerHTML = "";
      return;
    }
    var totals = computeTotalsFromRows(keyRows, answers);
    var perL = perLessonStats(keyRows, answers);
    var secLines = Object.keys(perL)
      .map(function (k) {
        var p = perL[k];
        var label = escapeHtml(lessonNameMap[k] || k);
        return (
          '<div class="flex justify-between gap-2 border-b border-slate-100 py-2 text-xs last:border-0">' +
          "<span class=\"font-semibold text-slate-600\">" +
          label +
          '</span><span class="text-right font-mono text-slate-800">D' +
          p.dogru +
          " Y" +
          p.yanlis +
          " B" +
          p.bos +
          " · Net " +
          formatNet(p.net) +
          "</span></div>"
        );
      })
      .join("");

    summaryEl.innerHTML =
      '<div class="rounded-2xl border-2 border-violet-200 bg-gradient-to-br from-white to-violet-50 p-4 shadow-lg ring-1 ring-violet-100">' +
      '<h3 class="mb-3 flex items-center gap-2 border-b border-violet-100 pb-2 text-sm font-bold text-violet-900">' +
      '<i class="fa-solid fa-chart-simple text-violet-600" aria-hidden="true"></i> Canlı sonuç</h3>' +
      '<div class="grid grid-cols-2 gap-2 text-center">' +
      '<div class="rounded-xl bg-emerald-50 p-2"><div class="text-xs font-bold text-emerald-700">Doğru</div><div class="text-xl font-black text-emerald-900">' +
      totals.dogru +
      '</div></div>' +
      '<div class="rounded-xl bg-rose-50 p-2"><div class="text-xs font-bold text-rose-700">Yanlış</div><div class="text-xl font-black text-rose-900">' +
      totals.yanlis +
      '</div></div>' +
      '<div class="rounded-xl bg-slate-100 p-2"><div class="text-xs font-bold text-slate-600">Boş</div><div class="text-xl font-black text-slate-900">' +
      totals.bos +
      '</div></div>' +
      '<div class="rounded-xl bg-violet-100 p-2"><div class="text-xs font-bold text-violet-800">Net</div><div class="text-xl font-black text-violet-950">' +
      formatNet(totals.net) +
      "</div></div></div>" +
      '<p class="mt-2 text-center text-[10px] font-medium uppercase tracking-wide text-slate-500">ÖSYM: doğru − yanlış ÷ 4</p>' +
      '<div class="mt-3 max-h-48 overflow-y-auto rounded-xl border border-slate-100 bg-white/80 p-2">' +
      (secLines || '<p class="text-xs text-slate-500">Ders özeti yok.</p>') +
      "</div></div>";
  }

  async function onExamSelected() {
    var id = selExam && selExam.value ? String(selExam.value).trim() : "";
    clearManualUi();
    if (!id) {
      setWorkspaceEnabled(false);
      setTab("camera");
      return;
    }
    try {
      var doc = await databases.getDocument(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_EXAMS, id);
      selectedExamDoc = doc;
      var rawKey = doc.answerKey != null ? doc.answerKey : "";
      var parsed = parseExamAnswerKey(rawKey);
      if (parsed.error || !parsed.rows.length) {
        toast(parsed.error || "Cevap anahtarı okunamadı.", { variant: "danger" });
        selectedExamDoc = null;
        setWorkspaceEnabled(false);
        if (selExam) selExam.value = "";
        return;
      }
      await fetchLessonTopicMaps();
      keyRows = parsed.rows;
      answers = new Array(keyRows.length).fill(null);
      setWorkspaceEnabled(true);
      renderManualGrid();
      setTab("camera");
      toast("Deneme yüklendi: " + (doc.examName || "—") + " · " + keyRows.length + " soru.", {
        variant: "success",
      });
    } catch (err) {
      logAppwriteError("smart-optik-page/onExamSelected", err);
      toast("Deneme açılamadı: " + (err && err.message ? err.message : String(err)), {
        variant: "danger",
      });
      setWorkspaceEnabled(false);
      if (selExam) selExam.value = "";
    }
  }

  window.__smartOptikOnEnter = function () {
    try {
      loadExamOptions();
      populateStudentSelect();
    } catch (e) {
      logAppwriteError("smart-optik-page/__smartOptikOnEnter", e);
    }
  };

  if (selExam) {
    selExam.addEventListener("change", function () {
      onExamSelected().catch(function (e) {
        logAppwriteError("smart-optik-page/onExamSelected_async", e);
      });
    });
  }

  if (tabCam) tabCam.addEventListener("click", function () { setTab("camera"); });
  if (tabManual) tabManual.addEventListener("click", function () { setTab("manual"); });

  if (el("aoBtnFile"))
    el("aoBtnFile").addEventListener("click", function () {
      if (el("aoFileInput")) el("aoFileInput").click();
    });

  if (el("aoFileInput"))
    el("aoFileInput").addEventListener("change", function (ev) {
      try {
        var f = ev.target && ev.target.files && ev.target.files[0];
        if (!f || !f.type.match(/^image\//)) {
          toast("Lütfen bir görsel seçin.", { variant: "danger" });
          return;
        }
        smartOptikFileToDataUrl(f).then(function (url) {
          lastBase64 = url;
          var prev = el("aoStillPreview");
          if (prev) {
            prev.src = url;
            prev.hidden = false;
          }
          toast("Görüntü hazır.", { variant: "success" });
        });
      } catch (e) {
        toast("Dosya hatası: " + (e && e.message ? e.message : String(e)), { variant: "danger" });
      }
    });

  if (el("aoBtnCamStart"))
    el("aoBtnCamStart").addEventListener("click", function () {
      try {
        stopCamera();
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          toast("Tarayıcı kamerayı desteklemiyor.", { variant: "danger" });
          return;
        }
        navigator.mediaDevices
          .getUserMedia({ video: { facingMode: "environment" }, audio: false })
          .then(function (s) {
            stream = s;
            if (video) {
              video.srcObject = s;
              video.play().catch(function () {});
            }
            toast("Kamera açıldı. Formu çerçeveye hizalayın.", { variant: "success" });
          })
          .catch(function () {
            toast("Kamera izni verilmedi veya kullanılamıyor.", { variant: "danger" });
          });
      } catch (e) {
        toast("Kamera: " + (e && e.message ? e.message : String(e)), { variant: "danger" });
      }
    });

  if (el("aoBtnCamStop"))
    el("aoBtnCamStop").addEventListener("click", function () {
      stopCamera();
      toast("Kamera kapatıldı.");
    });

  if (el("aoBtnPhotoAnalyze"))
    el("aoBtnPhotoAnalyze").addEventListener("click", function () {
      if (analyzing) return;
      if (!selectedExamDoc || !keyRows.length) {
        toast("Önce deneme seçin.", { variant: "danger" });
        return;
      }
      try {
        var dataUrl = "";
        if (stream && video && (video.videoWidth || 0) > 0) {
          dataUrl = smartOptikCaptureVideoFrameToDataUrl(video, canvas, 0.92);
        }
        if (!dataUrl && lastBase64) dataUrl = lastBase64;
        if (!dataUrl) {
          var img = el("aoStillPreview");
          if (img && !img.hidden && img.src && img.complete) {
            dataUrl = img.src;
          }
        }
        if (!dataUrl) {
          toast("Önce kameradan görüntü alın veya dosyadan fotoğraf seçin.", { variant: "danger" });
          return;
        }
        lastBase64 = dataUrl;
        var overlay = el("aoAnalyzeOverlay");
        analyzing = true;
        if (overlay) overlay.hidden = false;
        var rawKey = selectedExamDoc.answerKey != null ? String(selectedExamDoc.answerKey) : "";
        processOpticalImage(dataUrl, rawKey)
          .then(function () {
            if (overlay) overlay.hidden = true;
            analyzing = false;
            setTab("manual");
            toast("Görüntü işlendi. Manuel sekmeden okumayı kontrol edin.", { variant: "success" });
          })
          .catch(function (e) {
            if (overlay) overlay.hidden = true;
            analyzing = false;
            toast("İşleme hatası: " + (e && e.message ? e.message : String(e)), { variant: "danger" });
          });
      } catch (e) {
        analyzing = false;
        var ov = el("aoAnalyzeOverlay");
        if (ov) ov.hidden = true;
        toast("Analiz başlatılamadı: " + (e && e.message ? e.message : String(e)), {
          variant: "danger",
        });
      }
    });

  if (btnSaveKarne)
    btnSaveKarne.addEventListener("click", async function () {
      try {
        if (!selectedExamDoc || !keyRows.length) {
          toast("Önce deneme seçin ve cevapları girin.", { variant: "danger" });
          return;
        }
        var sid = selStudent && selStudent.value ? String(selStudent.value).trim() : "";
        if (!sid) {
          toast("Öğrenci seçin.", { variant: "danger" });
          return;
        }
        var examId = selectedExamDoc.$id || selectedExamDoc.id || "";
        var examName = selectedExamDoc.examName || "";
        var cid = String(getCoachId() || "").trim();
        var detail = buildExamResultDetail({
          examId: examId,
          examName: examName,
          rows: keyRows,
          student: answers,
          lessonNames: lessonNameMap,
          topicNames: topicNameMap,
        });
        var payload = buildExamResultCreatePayload({
          examId: examId,
          studentId: sid,
          examName: examName,
          detailJson: JSON.stringify(detail),
          coachId: cid || "",
        });
        if (btnSaveKarne) btnSaveKarne.disabled = true;
        await databases.createDocument(
          APPWRITE_DATABASE_ID,
          APPWRITE_COLLECTION_EXAM_RESULTS,
          ID.unique(),
          payload
        );
        toast("Sonuç öğrenci karnesi kaydına yazıldı (ExamResults).", { variant: "success" });
      } catch (err) {
        logAppwriteError("smart-optik-page/saveKarne", err);
        var msg = err && err.message ? String(err.message) : String(err);
        if (/404|not\s*found/i.test(msg)) {
          toast(
            "ExamResults koleksiyonu bulunamadı. Sunucuda `node setup-appwrite.js` çalıştırın (ExamResults şeması).",
            { variant: "danger" }
          );
        } else {
          toast("Kayıt başarısız: " + msg, { variant: "danger" });
        }
      } finally {
        if (btnSaveKarne) btnSaveKarne.disabled = false;
      }
    });

  setWorkspaceEnabled(false);
  setTab("camera");
  loadExamOptions().catch(function (e) {
    logAppwriteError("smart-optik-page/initLoadExams", e);
  });
  populateStudentSelect();
}
