/**
 * DereceBoard V2 — PDF arka plan, kağıt şablonları, şekiller, lazer, otomatik kayıt.
 */
import { collection, addDoc, db, doc, getDocs, query, updateDoc, where } from "./appwrite-compat.js";
import {
  APPWRITE_COLLECTION_BOARDS,
  APPWRITE_COLLECTION_SHARED_BOARDS,
  APPWRITE_COLLECTION_STUDENTS,
} from "./appwrite-config.js";

var rootEl = null;
var pages = [];
var pageIndex = 0;
var currentTool = "pen-black";
/** El (pan) aracı — sürüklerken tuval kaydırma */
var handPanDragging = false;
var handPanCanvasRef = null;
var handPanLast = { x: 0, y: 0 };
var handPanGlobalListenersBound = false;
var editMode = false;
var popoverEl = null;
var brushWidths = { pen: 3, highlighter: 22, eraser: 28 };
var penColors = {
  "pen-black": "#0f172a",
  "pen-red": "#dc2626",
  highlighter: "rgba(255, 235, 59, 0.42)",
};
var boardTitle = "Yeni tahta";
var initialized = false;
var historyDebounce = null;
var currentBoardDocId = null;
var autoSaveTimer = null;
var paperSelectProgrammatic = false;
var shapesPopoverEl = null;
var lastInkColor = "#0f172a";
var isRestoringCanvas = false;
/** 50+ PDF sayfasında raster sadece görünür alana yaklaşınca yüklenir */
var BOARD_LAZY_PDF_PAGES = 50;
var boardPdfObserver = null;
/** Yeni sayfa / Sayfa Ekle için seçili ISO kağıt boyutu */
var boardPageSizeKey = "A4";
/** Kaydırma ile hangi sayfanın önde olduğunu izler (sayfa sayacı) */
var boardNavObserver = null;
var boardNavFlushRaf = null;
var boardNavSheetRatios = new WeakMap();

function boardPageDimensionsFor(sizeKey) {
  var k = sizeKey || boardPageSizeKey || "A4";
  if (k === "A3") {
    var w3 = 900;
    return { w: w3, h: Math.round((w3 * 420) / 297) };
  }
  if (k === "A5") {
    var w5 = 520;
    return { w: w5, h: Math.round((w5 * 210) / 148) };
  }
  var w4 = 816;
  return { w: w4, h: Math.round((w4 * 297) / 210) };
}

function boardNavThresholds() {
  var a = [];
  for (var t = 0; t <= 20; t++) a.push(t / 20);
  return a;
}

function getCoachId() {
  try {
    var imp = sessionStorage.getItem("superAdminViewAsCoach");
    if (imp && String(imp).trim()) return String(imp).trim();
  } catch (_e) {}
  return (localStorage.getItem("currentUser") || "").trim();
}

function toast(msg) {
  if (window.YKSPanel && typeof window.YKSPanel.toast === "function") {
    window.YKSPanel.toast(msg);
    return;
  }
  alert(msg);
}

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function collectBoardPayload() {
  var payloadPages = [];
  var thumbs = [];
  for (var i = 0; i < pages.length; i++) {
    var c = pages[i].canvas;
    payloadPages.push(c.toJSON(["selectable", "evented"]));
    thumbs.push(c.toDataURL({ format: "png", multiplier: 0.22 }));
  }
  var titleInput = rootEl.querySelector("#dereceBoardTitleInput");
  var title = (titleInput && titleInput.value) || boardTitle || "Tahta";
  return { payloadPages: payloadPages, thumbs: thumbs, title: title };
}

async function persistBoardDocument() {
  var cid = getCoachId();
  if (!cid) throw new Error("no_coach");
  var p = collectBoardPayload();
  var payload = {
    coach_id: cid,
    title: p.title,
    pages_json: JSON.stringify(p.payloadPages),
    thumbnails_json: JSON.stringify(p.thumbs),
    updated_at: new Date().toISOString(),
  };
  if (currentBoardDocId) {
    await updateDoc(doc(db, APPWRITE_COLLECTION_BOARDS, currentBoardDocId), payload);
    return currentBoardDocId;
  }
  var res = await addDoc(collection(db, APPWRITE_COLLECTION_BOARDS), payload);
  currentBoardDocId = res.id;
  return currentBoardDocId;
}

function scheduleAutoSave() {
  if (isRestoringCanvas) return;
  if (!getCoachId()) return;
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(function () {
    autoSaveTimer = null;
    void (async function () {
      try {
        await persistBoardDocument();
      } catch (e) {
        console.warn("[DereceBoard] otomatik kayıt", e);
      }
    })();
  }, 10000);
}

async function saveBoardDocument() {
  return persistBoardDocument();
}

function closeShareModal() {
  var modal = rootEl && rootEl.querySelector("#dereceBoardShareModal");
  if (!modal) return;
  modal.hidden = true;
  modal.setAttribute("aria-hidden", "true");
}

async function openShareModal() {
  var modal = rootEl.querySelector("#dereceBoardShareModal");
  var list = rootEl.querySelector("#dereceBoardShareList");
  if (!modal || !list) return;
  list.innerHTML =
    '<p class="derece-board__modal-lead" style="margin:0">Öğrenciler yükleniyor…</p>';
  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
  var cid = getCoachId();
  if (!cid) {
    list.innerHTML = '<p class="derece-board__modal-lead" style="margin:0;color:#b91c1c">Oturum bulunamadı.</p>';
    return;
  }
  try {
    var snap = await getDocs(
      query(collection(db, APPWRITE_COLLECTION_STUDENTS), where("coach_id", "==", cid))
    );
    list.innerHTML = "";
    if (!snap.size) {
      list.innerHTML =
        '<p class="derece-board__modal-lead" style="margin:0">Bu koça bağlı öğrenci kaydı yok.</p>';
      return;
    }
    snap.forEach(function (d) {
      var data = typeof d.data === "function" ? d.data() : {};
      var name = data.name || data.studentName || "Öğrenci";
      var lab = document.createElement("label");
      lab.className = "derece-board__share-row";
      lab.innerHTML =
        '<input type="checkbox" value="' +
        escHtml(d.id) +
        '" /> <span>' +
        escHtml(name) +
        "</span>";
      list.appendChild(lab);
    });
  } catch (err) {
    console.error("[DereceBoard] öğrenci listesi", err);
    list.innerHTML =
      '<p class="derece-board__modal-lead" style="margin:0;color:#b91c1c">Liste yüklenemedi.</p>';
  }
}

async function confirmShareStudents() {
  var ids = [];
  rootEl.querySelectorAll("#dereceBoardShareList input[type=checkbox]:checked").forEach(function (inp) {
    if (inp.value) ids.push(inp.value);
  });
  if (!ids.length) {
    toast("En az bir öğrenci seçin.");
    return;
  }
  try {
    var boardId = await persistBoardDocument();
    await addDoc(collection(db, APPWRITE_COLLECTION_SHARED_BOARDS), {
      board_id: boardId,
      coach_id: getCoachId(),
      student_ids: ids,
      shared_at: new Date().toISOString(),
    });
    closeShareModal();
    toast("Seçilen öğrencilere gönderildi (SharedBoards).");
  } catch (err) {
    console.error("[DereceBoard] paylaşım", err);
    toast("Gönderilemedi. SharedBoards koleksiyonu ve şema tanımlı mı kontrol edin.");
  }
}

function ensureFabric() {
  if (typeof fabric === "undefined") {
    console.error("[DereceBoard] Fabric.js yüklenmedi.");
    return false;
  }
  return true;
}

function getShapeStrokeColor() {
  return lastInkColor || penColors["pen-black"];
}

function makePatternTileDataUrl(type) {
  var s = 48;
  var c = document.createElement("canvas");
  c.width = s;
  c.height = s;
  var ctx = c.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, s, s);
  ctx.strokeStyle = "rgba(15,23,42,0.12)";
  ctx.lineWidth = 1;
  if (type === "grid") {
    for (var i = 0; i <= s; i += 12) {
      ctx.beginPath();
      ctx.moveTo(i + 0.5, 0);
      ctx.lineTo(i + 0.5, s);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i + 0.5);
      ctx.lineTo(s, i + 0.5);
      ctx.stroke();
    }
  } else if (type === "lined") {
    for (var j = 24; j < s; j += 24) {
      ctx.beginPath();
      ctx.moveTo(0, j + 0.5);
      ctx.lineTo(s, j + 0.5);
      ctx.stroke();
    }
  } else if (type === "dotted") {
    ctx.fillStyle = "rgba(15,23,42,0.2)";
    for (var x = 4; x < s; x += 12) {
      for (var y = 4; y < s; y += 12) {
        ctx.beginPath();
        ctx.arc(x, y, 1.1, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }
  return c.toDataURL("image/png");
}

function applyPaperTypeToCanvas(canvas, type, state) {
  if (!canvas || !ensureFabric()) return;
  if (state) state.paperType = type;
  if (type === "white") {
    canvas.setBackgroundImage(null, function () {
      canvas.setBackgroundColor("rgba(255,255,255,0)", function () {
        canvas.requestRenderAll();
      });
    });
    return;
  }
  var tile = makePatternTileDataUrl(type);
  var im = new Image();
  im.onload = function () {
    try {
      var pattern = new fabric.Pattern({ source: im, repeat: "repeat" });
      canvas.setBackgroundColor(pattern, function () {
        canvas.requestRenderAll();
      });
    } catch (_e) {
      canvas.setBackgroundColor("#ffffff", function () {
        canvas.requestRenderAll();
      });
    }
  };
  im.onerror = function () {
    canvas.setBackgroundColor("#ffffff", function () {
      canvas.requestRenderAll();
    });
  };
  im.src = tile;
}

function syncPaperSelectFromPage() {
  var sel = rootEl && rootEl.querySelector("[data-db-paper-select]");
  if (!sel || !pages[pageIndex]) return;
  paperSelectProgrammatic = true;
  sel.value = pages[pageIndex].paperType || "white";
  paperSelectProgrammatic = false;
}

function setupLaserFade(path, canvas) {
  path.set({
    stroke: "#ff1538",
    strokeWidth: 4.5,
    fill: "",
    shadow: { color: "rgba(255,20,60,0.9)", blur: 18, offsetX: 0, offsetY: 0 },
    strokeLineCap: "round",
    strokeLineJoin: "round",
  });
  if (path.setCoords) path.setCoords();
  var start = typeof performance !== "undefined" ? performance.now() : Date.now();
  var dur = 2000;
  function frame() {
    var now = typeof performance !== "undefined" ? performance.now() : Date.now();
    var t = (now - start) / dur;
    if (t >= 1) {
      try {
        canvas.remove(path);
      } catch (_e) {}
      canvas.requestRenderAll();
      return;
    }
    path.set({ opacity: 1 - t });
    canvas.requestRenderAll();
    var raf = fabric.util.requestAnimFrame || requestAnimationFrame;
    raf(frame);
  }
  var raf0 = fabric.util.requestAnimFrame || requestAnimationFrame;
  raf0(frame);
}

function openShapesPopover(anchor) {
  if (!shapesPopoverEl || !anchor) return;
  var rect = anchor.getBoundingClientRect();
  shapesPopoverEl.classList.add("is-open");
  shapesPopoverEl.style.left = Math.min(window.innerWidth - 200, rect.right + 8) + "px";
  shapesPopoverEl.style.top = Math.max(8, rect.top - 4) + "px";
}

function closeShapesPopover() {
  if (shapesPopoverEl) shapesPopoverEl.classList.remove("is-open");
}

function getBoardSheetScrollRoot() {
  return rootEl ? rootEl.querySelector(".derece-board__sheet-wrap") : null;
}

function ensureBoardPdfObserver() {
  if (boardPdfObserver || typeof IntersectionObserver === "undefined") return;
  var root = getBoardSheetScrollRoot();
  if (!root) return;
  boardPdfObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        var sheet = en.target;
        var st = null;
        for (var i = 0; i < pages.length; i++) {
          if (pages[i].sheet === sheet) {
            st = pages[i];
            break;
          }
        }
        if (!st || !st.pdfLazyPending || st.pdfBgDone) return;
        st.pdfLazyPending = false;
        boardPdfObserver.unobserve(sheet);
        void renderPdfOntoFabricState(st);
      });
    },
    { root: root, rootMargin: "280px 0px", threshold: 0.01 }
  );
}

function disconnectBoardPdfObserver() {
  if (boardPdfObserver) {
    boardPdfObserver.disconnect();
    boardPdfObserver = null;
  }
}

function disconnectBoardNavObserver() {
  if (boardNavObserver) {
    boardNavObserver.disconnect();
    boardNavObserver = null;
  }
  boardNavFlushRaf = null;
}

function fallbackPageIndexByViewportCenter() {
  var root = getBoardSheetScrollRoot();
  if (!root || !pages.length) return 0;
  var r = root.getBoundingClientRect();
  var mid = r.top + r.height / 2;
  var best = 0;
  var bestDist = Infinity;
  for (var i = 0; i < pages.length; i++) {
    var sh = pages[i].sheet;
    if (!sh || !sh.isConnected) continue;
    var sr = sh.getBoundingClientRect();
    if (sr.height < 1) continue;
    var c = sr.top + sr.height / 2;
    var d = Math.abs(c - mid);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

function flushBoardNavIntersection() {
  boardNavFlushRaf = null;
  if (!rootEl || !pages.length) return;
  var bestI = pageIndex;
  var bestR = -1;
  for (var i = 0; i < pages.length; i++) {
    var sh = pages[i].sheet;
    if (!sh) continue;
    var ratio = boardNavSheetRatios.get(sh);
    if (typeof ratio !== "number") ratio = 0;
    if (ratio > bestR) {
      bestR = ratio;
      bestI = i;
    }
  }
  if (bestR < 0.02 && pages.length) {
    bestI = fallbackPageIndexByViewportCenter();
  }
  applyVisiblePageIndexFromScroll(bestI);
}

function ensureBoardNavObserver() {
  var root = getBoardSheetScrollRoot();
  if (!root || boardNavObserver || typeof IntersectionObserver === "undefined") return;
  boardNavObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (en) {
        boardNavSheetRatios.set(en.target, en.intersectionRatio);
      });
      if (!boardNavFlushRaf) {
        boardNavFlushRaf = requestAnimationFrame(flushBoardNavIntersection);
      }
    },
    { root: root, rootMargin: "-12% 0px -12% 0px", threshold: boardNavThresholds() }
  );
}

function observeBoardNavSheet(sheet) {
  if (!sheet) return;
  ensureBoardNavObserver();
  if (boardNavObserver) boardNavObserver.observe(sheet);
}

function ensureInfiniteWhiteTail() {
  var wrap = getBoardSheetScrollRoot();
  if (!wrap) return;
  var tail = wrap.querySelector(".derece-board__infinite-tail");
  if (!tail) {
    tail = document.createElement("div");
    tail.className = "derece-board__infinite-tail";
    tail.setAttribute("aria-hidden", "true");
    wrap.appendChild(tail);
  } else {
    wrap.appendChild(tail);
  }
}

function updatePaginationBar() {
  if (!rootEl) return;
  var cur = rootEl.querySelector("#dereceBoardPageCurrent");
  var tot = rootEl.querySelector("#dereceBoardPageTotal");
  var n = Math.max(1, pages.length);
  var idx = pages.length ? Math.min(n - 1, Math.max(0, pageIndex)) : 0;
  if (cur) cur.textContent = String(idx + 1);
  if (tot) tot.textContent = String(n);
}

function refreshPagerButtons() {
  if (!rootEl) return;
  var prev = rootEl.querySelector("[data-db-page-prev]");
  var next = rootEl.querySelector("[data-db-page-next]");
  if (prev) prev.disabled = pages.length < 2 || pageIndex <= 0;
  if (next) next.disabled = pages.length < 2 || pageIndex >= pages.length - 1;
}

function applyVisiblePageIndexFromScroll(i) {
  if (i < 0 || i >= pages.length) return;
  if (i === pageIndex) {
    updatePaginationBar();
    refreshPagerButtons();
    return;
  }
  pageIndex = i;
  pages.forEach(function (p, pi) {
    p.sheet.classList.toggle("derece-board__sheet--current", pi === i);
    p.sheet.hidden = false;
  });
  rootEl.querySelectorAll(".derece-board__thumb").forEach(function (tw, pi) {
    tw.classList.toggle("is-current", pi === i);
  });
  syncPaperSelectFromPage();
  var c = getCurrentCanvas();
  if (c) {
    try {
      c.calcOffset();
    } catch (_e) {}
    applyToolToCanvas(c, currentTool);
  }
  updatePaginationBar();
  refreshPagerButtons();
}

async function renderPdfOntoFabricState(state) {
  if (!state || state.pdfBgDone || !state._pdfDocRef || state.pdfPageIndex == null) return;
  if (state._pdfRendering) return;
  state._pdfRendering = true;
  var pdf = state._pdfDocRef;
  var canvas = state.canvas;
  try {
    var boxW = Math.floor(canvas.getWidth());
    var boxH = Math.floor(canvas.getHeight());
    if (boxW < 1 || boxH < 1) {
      var el = canvas.getElement && canvas.getElement();
      if (el) {
        boxW = el.width || 816;
        boxH = el.height || 1154;
      }
    }
    var page = await pdf.getPage(state.pdfPageIndex);
    var baseVp = page.getViewport({ scale: 1 });
    var sc = Math.min(boxW / baseVp.width, boxH / baseVp.height);
    var viewport = page.getViewport({ scale: sc });
    var rw = Math.floor(viewport.width);
    var rh = Math.floor(viewport.height);
    var off = document.createElement("canvas");
    off.width = rw;
    off.height = rh;
    var ctx = off.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: viewport }).promise;
    var dataUrl = off.toDataURL("image/png");
    await new Promise(function (resolve, reject) {
      fabric.Image.fromURL(
        dataUrl,
        function (img) {
          if (!img) {
            state._pdfRendering = false;
            reject(new Error("pdf_image"));
            return;
          }
          var iw = img.width || rw;
          var ih = img.height || rh;
          canvas.setDimensions({ width: boxW, height: boxH });
          var ox = Math.max(0, (boxW - rw) / 2);
          var oy = Math.max(0, (boxH - rh) / 2);
          img.set({
            scaleX: rw / iw,
            scaleY: rh / ih,
            left: ox,
            top: oy,
            originX: "left",
            originY: "top",
          });
          canvas.setBackgroundImage(img, function () {
            state.paperType = "white";
            canvas.setBackgroundColor("rgba(255,255,255,0)", function () {
              syncPaperSelectFromPage();
              canvas.renderAll();
              pushHistoryFor(canvas, state);
              scheduleAutoSave();
              scheduleThumbUpdate(state);
              state.pdfBgDone = true;
              state._pdfRendering = false;
              try {
                canvas.calcOffset();
              } catch (_e) {}
              resolve();
            });
          });
        },
        { crossOrigin: "anonymous" }
      );
    });
  } catch (err) {
    state._pdfRendering = false;
    console.error("[DereceBoard] PDF sayfa", state.pdfPageIndex, err);
    toast("PDF sayfa " + state.pdfPageIndex + " yüklenemedi.");
  }
}

async function importPdfAllPages(file) {
  if (!file) return;
  var pdfjs = typeof pdfjsLib !== "undefined" ? pdfjsLib : null;
  if (!pdfjs || !pdfjs.getDocument) {
    toast("PDF.js yüklenemedi; sayfayı yenileyin.");
    return;
  }
  try {
    var buf = await file.arrayBuffer();
    var pdf = await pdfjs.getDocument({ data: buf }).promise;
    var n = pdf.numPages;
    if (n < 1) {
      toast("PDF boş.");
      return;
    }
    var useLazy = n >= BOARD_LAZY_PDF_PAGES && typeof IntersectionObserver !== "undefined";
    if (useLazy) ensureBoardPdfObserver();
    var a4 = boardPageDimensionsFor("A4");

    for (var pnum = 1; pnum <= n; pnum++) {
      var st = createPageInternal(null, a4.w, a4.h, {
        skipShowPage: true,
        pdfDocRef: pdf,
        pdfPageIndex: pnum,
        lazyPdf: useLazy,
      });
      if (!st) break;
      if (!useLazy) {
        await renderPdfOntoFabricState(st);
      } else if (boardPdfObserver) {
        boardPdfObserver.observe(st.sheet);
      }
    }
    showPage(pages.length - 1, { scroll: true });
    updatePaginationBar();
    refreshPagerButtons();
    toast(n + " PDF sayfası tahtaya eklendi (A4 tuval, sığdırılmış).");
  } catch (err) {
    console.error("[DereceBoard] PDF", err);
    toast("PDF okunamadı.");
  }
}

function bindShapeInteractions(canvas, state) {
  state._shapeDrag = { active: false, ox: 0, oy: 0, preview: null };

  function removePreview() {
    if (state._shapeDrag.preview) {
      try {
        canvas.remove(state._shapeDrag.preview);
      } catch (_e) {}
      state._shapeDrag.preview = null;
    }
  }

  function finalizeShape(x0, y0, x1, y1) {
    var col = getShapeStrokeColor();
    var sw = 3;
    var tool = currentTool;
    var left = Math.min(x0, x1);
    var top = Math.min(y0, y1);
    var rw = Math.abs(x1 - x0);
    var rh = Math.abs(y1 - y0);
    var obj = null;
    if (tool === "shape-line") {
      obj = new fabric.Line([x0, y0, x1, y1], {
        stroke: col,
        strokeWidth: sw,
        fill: "",
        selectable: true,
        evented: true,
      });
    } else if (tool === "shape-rect") {
      if (rw < 2 && rh < 2) return;
      obj = new fabric.Rect({
        left: left,
        top: top,
        width: rw,
        height: rh,
        fill: "",
        stroke: col,
        strokeWidth: sw,
      });
    } else if (tool === "shape-circle") {
      var cx = (x0 + x1) / 2;
      var cy = (y0 + y1) / 2;
      var r = Math.max(rw, rh) / 2;
      if (r < 3) return;
      obj = new fabric.Circle({
        left: cx,
        top: cy,
        radius: r,
        originX: "center",
        originY: "center",
        fill: "",
        stroke: col,
        strokeWidth: sw,
      });
    } else if (tool === "shape-triangle") {
      if (rw < 2 || rh < 2) return;
      obj = new fabric.Polygon(
        [
          { x: 0, y: 0 },
          { x: rw, y: 0 },
          { x: 0, y: rh },
        ],
        { left: left, top: top, fill: "", stroke: col, strokeWidth: sw }
      );
    }
    if (obj) {
      canvas.add(obj);
      canvas.setActiveObject(obj);
      canvas.requestRenderAll();
      pushHistoryFor(canvas, state);
      scheduleAutoSave();
    }
  }

  canvas.on("mouse:down", function (opt) {
    if (!currentTool || currentTool.indexOf("shape-") !== 0) return;
    if (opt.target) return;
    var p = canvas.getPointer(opt.e);
    state._shapeDrag.active = true;
    state._shapeDrag.ox = p.x;
    state._shapeDrag.oy = p.y;
    removePreview();
  });

  canvas.on("mouse:move", function (opt) {
    if (!state._shapeDrag.active) return;
    var p = canvas.getPointer(opt.e);
    var x0 = state._shapeDrag.ox;
    var y0 = state._shapeDrag.oy;
    var x1 = p.x;
    var y1 = p.y;
    var col = getShapeStrokeColor();
    removePreview();
    var pr = null;
    if (currentTool === "shape-line") {
      pr = new fabric.Line([x0, y0, x1, y1], {
        stroke: col,
        strokeWidth: 2,
        strokeDashArray: [6, 6],
        fill: "",
        selectable: false,
        evented: false,
      });
    } else if (currentTool === "shape-rect") {
      pr = new fabric.Rect({
        left: Math.min(x0, x1),
        top: Math.min(y0, y1),
        width: Math.abs(x1 - x0),
        height: Math.abs(y1 - y0),
        fill: "rgba(59,130,246,0.08)",
        stroke: col,
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
    } else if (currentTool === "shape-circle") {
      var cx = (x0 + x1) / 2;
      var cy = (y0 + y1) / 2;
      var r = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) / 2;
      pr = new fabric.Circle({
        left: cx,
        top: cy,
        radius: Math.max(r, 1),
        originX: "center",
        originY: "center",
        fill: "rgba(59,130,246,0.08)",
        stroke: col,
        strokeWidth: 2,
        selectable: false,
        evented: false,
      });
    } else if (currentTool === "shape-triangle") {
      var l = Math.min(x0, x1);
      var t = Math.min(y0, y1);
      var w = Math.abs(x1 - x0);
      var h = Math.abs(y1 - y0);
      pr = new fabric.Polygon(
        [
          { x: 0, y: 0 },
          { x: w, y: 0 },
          { x: 0, y: h },
        ],
        {
          left: l,
          top: t,
          fill: "rgba(59,130,246,0.08)",
          stroke: col,
          strokeWidth: 2,
          selectable: false,
          evented: false,
        }
      );
    }
    if (pr) {
      state._shapeDrag.preview = pr;
      canvas.add(pr);
      canvas.requestRenderAll();
    }
  });

  canvas.on("mouse:up", function (opt) {
    if (!state._shapeDrag.active) return;
    state._shapeDrag.active = false;
    var x0 = state._shapeDrag.ox;
    var y0 = state._shapeDrag.oy;
    removePreview();
    var p = canvas.getPointer(opt.e);
    finalizeShape(x0, y0, p.x, p.y);
  });
}

function getCurrentCanvas() {
  var p = pages[pageIndex];
  return p ? p.canvas : null;
}

function canvasHistoryJson(canvas) {
  if (!canvas) return "{}";
  return JSON.stringify(canvas.toJSON(["selectable", "evented"]));
}

function pushHistoryFor(canvas, state) {
  if (!state) return;
  var json = canvasHistoryJson(canvas);
  state.history = state.history.slice(0, state.histStep + 1);
  state.history.push(json);
  state.histStep = state.history.length - 1;
  scheduleThumbUpdate(state);
}

function scheduleThumbUpdate(state) {
  if (!state || !state.canvas) return;
  clearTimeout(state._thumbT);
  state._thumbT = setTimeout(function () {
    try {
      var url = state.canvas.toDataURL({ format: "png", multiplier: 0.18 });
      if (state.thumbImg) state.thumbImg.src = url;
    } catch (_e) {}
  }, 280);
}

function endHandPanGlobal() {
  if (!handPanDragging) return;
  var cPan = handPanCanvasRef;
  handPanDragging = false;
  handPanCanvasRef = null;
  if (cPan && currentTool === "hand") {
    try {
      cPan.setCursor("grab");
      cPan.hoverCursor = "grab";
    } catch (_e) {}
  }
}

function bindHandPan(canvas) {
  if (!canvas) return;
  canvas.on("mouse:down", function (opt) {
    if (currentTool !== "hand") return;
    var e = opt.e;
    if (e && typeof e.button === "number" && e.button !== 0) return;
    if (!e) return;
    handPanDragging = true;
    handPanCanvasRef = canvas;
    handPanLast.x = e.clientX;
    handPanLast.y = e.clientY;
    try {
      canvas.setCursor("grabbing");
      canvas.hoverCursor = "grabbing";
    } catch (_e) {}
  });

  canvas.on("mouse:move", function (opt) {
    if (!handPanDragging || handPanCanvasRef !== canvas || currentTool !== "hand") return;
    var e = opt.e;
    if (!e) return;
    var dx = e.clientX - handPanLast.x;
    var dy = e.clientY - handPanLast.y;
    handPanLast.x = e.clientX;
    handPanLast.y = e.clientY;
    if (dx === 0 && dy === 0) return;
    if (typeof fabric !== "undefined" && fabric.Point) {
      canvas.relativePan(new fabric.Point(dx, dy));
    } else {
      var v = canvas.viewportTransform;
      if (v) {
        v[4] += dx;
        v[5] += dy;
        canvas.setViewportTransform(v);
      }
    }
    canvas.requestRenderAll();
  });

  canvas.on("mouse:up", function () {
    endHandPanGlobal();
  });
}

function bindHandPanGlobalListeners() {
  if (handPanGlobalListenersBound) return;
  handPanGlobalListenersBound = true;
  window.addEventListener("mouseup", endHandPanGlobal);
  window.addEventListener("touchend", endHandPanGlobal, { passive: true });
}

function applyToolToCanvas(canvas, tool) {
  if (!canvas || !ensureFabric()) return;

  if (tool === "hand") {
    canvas.isDrawingMode = false;
    canvas.selection = false;
    canvas.forEachObject(function (o) {
      o.selectable = false;
      o.evented = false;
    });
    canvas.defaultCursor = "grab";
    canvas.hoverCursor = "grab";
    try {
      canvas.setCursor("grab");
    } catch (_e) {}
    return;
  }

  canvas.isDrawingMode = false;
  canvas.selection = false;
  canvas.defaultCursor = "default";
  canvas.forEachObject(function (o) {
    o.selectable = false;
    o.evented = true;
  });

  if (tool && tool.indexOf("shape-") === 0) {
    canvas.defaultCursor = "crosshair";
    return;
  }

  if (tool === "laser") {
    canvas.isDrawingMode = true;
    var lb = new fabric.PencilBrush(canvas);
    lb.decimate = 1.2;
    lb.color = "rgba(255,24,48,0.92)";
    lb.width = 5;
    lb.globalCompositeOperation = "source-over";
    canvas.freeDrawingBrush = lb;
    canvas.defaultCursor = "crosshair";
    return;
  }

  if (tool === "lasso") {
    canvas.selection = true;
    canvas.isDrawingMode = false;
    canvas.forEachObject(function (o) {
      o.selectable = true;
      o.evented = true;
    });
    canvas.defaultCursor = "move";
    return;
  }

  if (tool === "text") {
    canvas.defaultCursor = "text";
    return;
  }

  canvas.isDrawingMode = true;
  var b = new fabric.PencilBrush(canvas);
  b.decimate = 2.5;

  if (tool === "pen-black") {
    b.color = penColors["pen-black"];
    b.width = brushWidths.pen;
    b.globalCompositeOperation = "source-over";
  } else if (tool === "pen-red") {
    b.color = penColors["pen-red"];
    b.width = brushWidths.pen;
    b.globalCompositeOperation = "source-over";
  } else if (tool === "highlighter") {
    b.color = penColors.highlighter;
    b.width = brushWidths.highlighter;
    b.globalCompositeOperation = "source-over";
  } else if (tool === "eraser") {
    b.color = "rgba(0,0,0,1)";
    b.width = brushWidths.eraser;
    b.globalCompositeOperation = "destination-out";
  }
  canvas.freeDrawingBrush = b;
}

function setTool(tool) {
  endHandPanGlobal();
  currentTool = tool;
  if (tool === "pen-black") lastInkColor = penColors["pen-black"];
  else if (tool === "pen-red") lastInkColor = penColors["pen-red"];
  else if (tool === "highlighter") lastInkColor = penColors.highlighter;
  rootEl.querySelectorAll("[data-db-tool]").forEach(function (btn) {
    btn.classList.toggle("is-active", btn.getAttribute("data-db-tool") === tool);
  });
  var c = getCurrentCanvas();
  var st = pages[pageIndex];
  if (c && st) applyToolToCanvas(c, tool);
  closePopover();
  closeShapesPopover();
}

function undo() {
  var st = pages[pageIndex];
  if (!st || st.histStep <= 0) return;
  st.histStep--;
  isRestoringCanvas = true;
  st.canvas.loadFromJSON(st.history[st.histStep], function () {
    st.canvas.renderAll();
    isRestoringCanvas = false;
    applyToolToCanvas(st.canvas, currentTool);
    scheduleThumbUpdate(st);
    syncPaperSelectFromPage();
  });
}

function redo() {
  var st = pages[pageIndex];
  if (!st || st.histStep >= st.history.length - 1) return;
  st.histStep++;
  isRestoringCanvas = true;
  st.canvas.loadFromJSON(st.history[st.histStep], function () {
    st.canvas.renderAll();
    isRestoringCanvas = false;
    applyToolToCanvas(st.canvas, currentTool);
    scheduleThumbUpdate(st);
    syncPaperSelectFromPage();
  });
}

function addTextAt(canvas, x, y) {
  var t = new fabric.IText("Metin", {
    left: x,
    top: y,
    fill: "#0f172a",
    fontFamily: "Plus Jakarta Sans, Inter, sans-serif",
    fontSize: 22,
  });
  canvas.add(t);
  canvas.setActiveObject(t);
  canvas.requestRenderAll();
  var stForHist = null;
  for (var hi = 0; hi < pages.length; hi++) {
    if (pages[hi].canvas === canvas) {
      stForHist = pages[hi];
      break;
    }
  }
  pushHistoryFor(canvas, stForHist || pages[pageIndex]);
  scheduleAutoSave();
}

function activatePageFromCanvas(state) {
  var pi = pages.indexOf(state);
  if (pi < 0 || !rootEl) return;
  pageIndex = pi;
  rootEl.querySelectorAll(".derece-board__thumb").forEach(function (tw, tpi) {
    tw.classList.toggle("is-current", tpi === pi);
  });
  pages.forEach(function (p, i) {
    p.sheet.classList.toggle("derece-board__sheet--current", i === pi);
    p.sheet.hidden = false;
  });
  syncPaperSelectFromPage();
  try {
    state.canvas.calcOffset();
  } catch (_e) {}
  applyToolToCanvas(state.canvas, currentTool);
  updatePaginationBar();
  refreshPagerButtons();
}

function syncStackPageLabels() {
  pages.forEach(function (p, pi) {
    if (p.pageLabelEl) p.pageLabelEl.textContent = "Sayfa " + (pi + 1);
    if (p.thumbImg) p.thumbImg.alt = "Sayfa " + (pi + 1);
  });
}

function createPageInternal(initialJson, w, h, options) {
  options = options || {};
  if (!ensureFabric()) return null;
  if (typeof w !== "number" || w < 1) w = 1000;
  if (typeof h !== "number" || h < 1) h = 680;
  var idx = pages.length;
  var sheet = document.createElement("div");
  sheet.className = "derece-board__sheet derece-board__sheet--stack";
  sheet.hidden = false;

  var labelRow = document.createElement("div");
  labelRow.className = "derece-board__page-label-row";
  var labelEl = document.createElement("span");
  labelEl.className = "derece-board__page-label";
  labelEl.textContent = "Sayfa " + (idx + 1);
  labelRow.appendChild(labelEl);
  sheet.appendChild(labelRow);

  var host = document.createElement("div");
  host.className = "derece-board__canvas-host derece-board__canvas-host--ruled";
  var canvasEl = document.createElement("canvas");
  canvasEl.width = w;
  canvasEl.height = h;
  host.appendChild(canvasEl);
  sheet.appendChild(host);
  var wrap = rootEl.querySelector(".derece-board__sheet-wrap");
  ensureInfiniteWhiteTail();
  var tailEl = wrap.querySelector(".derece-board__infinite-tail");
  if (tailEl) wrap.insertBefore(sheet, tailEl);
  else wrap.appendChild(sheet);

  var canvas = new fabric.Canvas(canvasEl, {
    backgroundColor: "rgba(255,255,255,0)",
    preserveObjectStacking: true,
    width: w,
    height: h,
  });

  var hasPdf = !!options.pdfDocRef && options.pdfPageIndex != null;
  var lazyPdf = !!options.lazyPdf && hasPdf;
  var state = {
    canvas: canvas,
    sheet: sheet,
    history: [],
    histStep: -1,
    thumbImg: null,
    thumbWrap: null,
    paperType: "white",
    pageLabelEl: labelEl,
    _pdfDocRef: options.pdfDocRef || null,
    pdfPageIndex: hasPdf ? options.pdfPageIndex : null,
    pdfLazyPending: lazyPdf,
    pdfBgDone: !hasPdf,
    _pdfRendering: false,
  };

  function bindHistory() {
    var pushDebounced = function () {
      if (isRestoringCanvas) return;
      if (historyDebounce) clearTimeout(historyDebounce);
      historyDebounce = setTimeout(function () {
        if (isRestoringCanvas) return;
        pushHistoryFor(canvas, state);
        scheduleAutoSave();
      }, 60);
    };
    canvas.on("path:created", function (opt) {
      if (currentTool === "laser" && opt.path) {
        setupLaserFade(opt.path, canvas);
        return;
      }
      if (opt.path) {
        opt.path.set({ selectable: true, evented: true });
      }
      pushHistoryFor(canvas, state);
      scheduleAutoSave();
    });
    canvas.on("object:modified", pushDebounced);
    canvas.on("object:removed", pushDebounced);
    canvas.on("text:changed", pushDebounced);
    canvas.on("object:added", function () {
      if (isRestoringCanvas) return;
      scheduleAutoSave();
    });
  }
  bindHistory();

  canvas.on("mouse:down", function () {
    activatePageFromCanvas(state);
  });

  bindShapeInteractions(canvas, state);
  bindHandPan(canvas);

  canvas.on("mouse:down", function (opt) {
    if (currentTool !== "text") return;
    if (opt.target) return;
    var p = canvas.getPointer(opt.e);
    addTextAt(canvas, p.x, p.y);
  });

  pages.push(state);

  if (initialJson) {
    isRestoringCanvas = true;
    canvas.loadFromJSON(initialJson, function () {
      canvas.renderAll();
      isRestoringCanvas = false;
      pushHistoryFor(canvas, state);
      state.history = [canvasHistoryJson(canvas)];
      state.histStep = 0;
      state.paperType = state.paperType || "white";
      applyPaperTypeToCanvas(canvas, state.paperType, state);
    });
  } else {
    state.history = [canvasHistoryJson(canvas)];
    state.histStep = 0;
    applyPaperTypeToCanvas(canvas, state.paperType || "white", state);
  }

  applyToolToCanvas(canvas, currentTool);
  addPageThumbnail(state, idx);
  observeBoardNavSheet(sheet);
  updatePaginationBar();
  refreshPagerButtons();
  if (!options.skipShowPage) {
    showPage(idx, { scroll: true, smooth: true });
  }
  return state;
}

function createPage(initialJson) {
  var dim = boardPageDimensionsFor(boardPageSizeKey);
  return createPageInternal(initialJson, dim.w, dim.h, {});
}

function addPageThumbnail(state, idx) {
  var strip = rootEl.querySelector(".derece-board__page-strip");
  var wrap = document.createElement("div");
  wrap.className = "derece-board__thumb";
  wrap.dataset.pageIndex = String(idx);
  var img = document.createElement("img");
  img.alt = "Sayfa " + (idx + 1);
  img.src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  var rm = document.createElement("button");
  rm.type = "button";
  rm.className = "derece-board__thumb-remove";
  rm.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
  rm.setAttribute("aria-label", "Sayfayı sil");
  rm.addEventListener("click", function (e) {
    e.stopPropagation();
    if (!editMode) return;
    var i = parseInt(wrap.dataset.pageIndex, 10);
    if (!isNaN(i)) removePage(i);
  });
  wrap.appendChild(img);
  wrap.appendChild(rm);
  strip.appendChild(wrap);
  state.thumbImg = img;
  state.thumbWrap = wrap;
  wrap.addEventListener("click", function () {
    var i = parseInt(wrap.dataset.pageIndex, 10);
    if (!isNaN(i)) showPage(i, { scroll: true });
  });
  scheduleThumbUpdate(state);
}

function showPage(i, opts) {
  opts = opts || {};
  var doScroll = opts.scroll !== false;
  if (i < 0 || i >= pages.length) return;
  pageIndex = i;
  pages.forEach(function (p, pi) {
    p.sheet.hidden = false;
    p.sheet.classList.toggle("derece-board__sheet--current", pi === i);
  });
  rootEl.querySelectorAll(".derece-board__thumb").forEach(function (tw, pi) {
    tw.classList.toggle("is-current", pi === i);
  });
  var c = getCurrentCanvas();
  if (c) {
    try {
      c.calcOffset();
    } catch (_e) {}
    applyToolToCanvas(c, currentTool);
  }
  syncPaperSelectFromPage();
  if (doScroll && pages[i].sheet) {
    var behavior = opts.smooth ? "smooth" : "auto";
    pages[i].sheet.scrollIntoView({ behavior: behavior, block: "nearest" });
  }
  updatePaginationBar();
  refreshPagerButtons();
}

function removePage(idx) {
  if (pages.length <= 1) {
    toast("En az bir sayfa kalmalı.");
    return;
  }
  var st = pages[idx];
  if (st.canvas) {
    try {
      st.canvas.dispose();
    } catch (_e) {}
  }
  if (st.sheet && st.sheet.parentNode) st.sheet.parentNode.removeChild(st.sheet);
  if (st.thumbWrap && st.thumbWrap.parentNode) st.thumbWrap.parentNode.removeChild(st.thumbWrap);
  pages.splice(idx, 1);
  pages.forEach(function (p, i) {
    if (p.thumbWrap) p.thumbWrap.dataset.pageIndex = String(i);
  });
  syncStackPageLabels();
  if (pageIndex >= pages.length) pageIndex = pages.length - 1;
  showPage(pageIndex, { scroll: true });
  scheduleAutoSave();
}

function toggleEditMode() {
  editMode = !editMode;
  rootEl.classList.toggle("derece-board--edit-mode", editMode);
  var label = rootEl.querySelector(".derece-board__toggle-edit-label");
  if (label) label.textContent = editMode ? "Düzenlemeyi bitir" : "Düzenle";
}

function clearCurrentPageCanvas() {
  var st = pages[pageIndex];
  if (!st || !st.canvas) return;
  isRestoringCanvas = true;
  try {
    st.canvas.clear();
    applyPaperTypeToCanvas(st.canvas, st.paperType || "white", st);
  } finally {
    isRestoringCanvas = false;
  }
  applyToolToCanvas(st.canvas, currentTool);
  pushHistoryFor(st.canvas, st);
  scheduleAutoSave();
  scheduleThumbUpdate(st);
}

function renderPopoverSwatches(toolKey) {
  var wrap = popoverEl.querySelector(".derece-board__popover-colors");
  if (!wrap) return;
  var sets = {
    "pen-black": ["#0f172a", "#334155", "#1e40af", "#0d9488"],
    "pen-red": ["#991b1b", "#dc2626", "#f97316", "#be123c"],
    highlighter: [
      "rgba(255, 235, 59, 0.45)",
      "rgba(250, 204, 21, 0.45)",
      "rgba(52, 211, 153, 0.45)",
      "rgba(96, 165, 250, 0.45)",
    ],
  };
  var list = sets[toolKey];
  if (!list) return;
  wrap.innerHTML = "";
  list.forEach(function (col) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "derece-board__swatch";
    b.style.background = col;
    b.setAttribute("data-color", col);
    if (
      (toolKey === "pen-black" && penColors["pen-black"] === col) ||
      (toolKey === "pen-red" && penColors["pen-red"] === col) ||
      (toolKey === "highlighter" && penColors.highlighter === col)
    ) {
      b.classList.add("is-on");
    }
    b.addEventListener("click", function () {
      if (toolKey === "pen-black") penColors["pen-black"] = col;
      else if (toolKey === "pen-red") penColors["pen-red"] = col;
      else if (toolKey === "highlighter") penColors.highlighter = col;
      wrap.querySelectorAll(".derece-board__swatch").forEach(function (s) {
        s.classList.toggle("is-on", s === b);
      });
      setTool(toolKey);
    });
    wrap.appendChild(b);
  });
}

function openPopover(anchor, toolKey) {
  if (!popoverEl) return;
  var rect = anchor.getBoundingClientRect();
  popoverEl.classList.add("is-open");
  popoverEl.dataset.tool = toolKey;
  popoverEl.style.left = Math.min(window.innerWidth - 220, rect.right + 8) + "px";
  popoverEl.style.top = Math.max(8, rect.top - 4) + "px";
  var range = popoverEl.querySelector('input[type="range"]');
  if (range) {
    if (toolKey === "highlighter") {
      range.min = "12";
      range.max = "48";
      range.value = String(brushWidths.highlighter);
    } else if (toolKey === "eraser") {
      range.min = "8";
      range.max = "48";
      range.value = String(brushWidths.eraser);
    } else {
      range.min = "1";
      range.max = "24";
      range.value = String(brushWidths.pen);
    }
  }
  renderPopoverSwatches(toolKey);
}

function closePopover() {
  if (popoverEl) popoverEl.classList.remove("is-open");
}

function bindPopoverColors() {
  if (!popoverEl) return;
  var range = popoverEl.querySelector('input[type="range"]');
  if (range) {
    range.addEventListener("input", function () {
      var v = parseInt(range.value, 10);
      var tk = popoverEl.dataset.tool;
      if (tk === "highlighter") brushWidths.highlighter = v;
      else if (tk === "eraser") brushWidths.eraser = v;
      else brushWidths.pen = v;
      setTool(tk);
    });
  }
}

async function saveToLibrary() {
  if (!getCoachId()) {
    toast("Oturum bulunamadı; kayıt yapılamadı.");
    return;
  }
  try {
    await saveBoardDocument();
    toast("Kütüphaneye kaydedildi (Appwrite boards).");
  } catch (err) {
    console.error("[DereceBoard]", err);
    toast(
      "Kayıt başarısız. Appwrite’da «boards» koleksiyonu ve alanlar tanımlı mı kontrol edin."
    );
  }
}

function getJsPDFConstructor() {
  try {
    if (typeof window !== "undefined" && window.jspdf && window.jspdf.jsPDF) {
      return window.jspdf.jsPDF;
    }
  } catch (_e) {}
  return null;
}

function pad2(n) {
  return n < 10 ? "0" + n : String(n);
}

function addImageFitToPdfPage(pdf, dataUrl, canvasW, canvasH, multiplier) {
  var pxW = canvasW * multiplier;
  var pxH = canvasH * multiplier;
  var aspect = pxW / (pxH || 1);
  var pageW = pdf.internal.pageSize.getWidth();
  var pageH = pdf.internal.pageSize.getHeight();
  var m = 10;
  var maxW = pageW - 2 * m;
  var maxH = pageH - 2 * m;
  var wMm;
  var hMm;
  if (maxW / maxH > aspect) {
    hMm = maxH;
    wMm = maxH * aspect;
  } else {
    wMm = maxW;
    hMm = maxW / aspect;
  }
  var x = m + (maxW - wMm) / 2;
  var y = m + (maxH - hMm) / 2;
  pdf.addImage(dataUrl, "PNG", x, y, wMm, hMm);
}

async function exportBoardToPdf(exportBtn) {
  var JsPDF = getJsPDFConstructor();
  if (!JsPDF) {
    toast("PDF kütüphanesi yüklenemedi; sayfayı yenileyin.");
    return;
  }
  if (!pages.length) {
    toast("Dışa aktarılacak sayfa yok.");
    return;
  }
  var btn = exportBtn;
  var origHtml = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML =
    '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Yükleniyor…';
  await new Promise(function (resolve) {
    requestAnimationFrame(function () {
      requestAnimationFrame(resolve);
    });
  });
  try {
    var mult = 2;
    var pdf = null;
    for (var i = 0; i < pages.length; i++) {
      var c = pages[i].canvas;
      var cw = c.getWidth();
      var ch = c.getHeight();
      if (cw < 1 || ch < 1) continue;
      var orient = cw >= ch ? "landscape" : "portrait";
      var dataUrl = c.toDataURL({ format: "png", multiplier: mult });
      if (pdf === null) {
        pdf = new JsPDF({ unit: "mm", format: "a4", orientation: orient });
      } else {
        pdf.addPage("a4", orient);
      }
      addImageFitToPdfPage(pdf, dataUrl, cw, ch, mult);
    }
    if (pdf === null) {
      toast("Geçerli tuval bulunamadı.");
      return;
    }
    var d = new Date();
    var stamp =
      d.getFullYear() +
      "-" +
      pad2(d.getMonth() + 1) +
      "-" +
      pad2(d.getDate()) +
      "_" +
      pad2(d.getHours()) +
      pad2(d.getMinutes());
    pdf.save("DereceBoard_Notlari_" + stamp + ".pdf");
  } catch (err) {
    console.error("[DereceBoard] PDF export", err);
    toast("PDF oluşturulamadı.");
  } finally {
    btn.disabled = false;
    btn.innerHTML = origHtml;
  }
}

function wireToolbar() {
  rootEl.querySelectorAll("[data-db-tool]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var t = btn.getAttribute("data-db-tool");
      if (t === "pen-black" || t === "pen-red" || t === "highlighter") {
        setTool(t);
        openPopover(btn, t);
        return;
      }
      setTool(t);
    });
  });

  var pagePrev = rootEl.querySelector("[data-db-page-prev]");
  if (pagePrev) {
    pagePrev.addEventListener("click", function () {
      if (pageIndex > 0) showPage(pageIndex - 1, { scroll: true, smooth: true });
    });
  }
  var pageNext = rootEl.querySelector("[data-db-page-next]");
  if (pageNext) {
    pageNext.addEventListener("click", function () {
      if (pageIndex < pages.length - 1) showPage(pageIndex + 1, { scroll: true, smooth: true });
    });
  }
  var pageSizeSel = rootEl.querySelector("[data-db-page-size]");
  if (pageSizeSel) {
    pageSizeSel.value = boardPageSizeKey || "A4";
    pageSizeSel.addEventListener("change", function () {
      boardPageSizeKey = pageSizeSel.value || "A4";
    });
  }

  var pdfIn = rootEl.querySelector("#dereceBoardPdfInput");
  var pdfImportBtns = rootEl.querySelectorAll("[data-db-pdf-import]");
  if (pdfIn) {
    pdfImportBtns.forEach(function (pdfBtn) {
      pdfBtn.addEventListener("click", function () {
        pdfIn.click();
      });
    });
    pdfIn.addEventListener("change", function () {
      var f = pdfIn.files && pdfIn.files[0];
      if (f) void importPdfAllPages(f);
      pdfIn.value = "";
    });
  }

  var paperSel = rootEl.querySelector("[data-db-paper-select]");
  if (paperSel) {
    paperSel.addEventListener("change", function () {
      if (paperSelectProgrammatic) return;
      var v = paperSel.value || "white";
      var st = pages[pageIndex];
      var c = getCurrentCanvas();
      if (st && c) {
        applyPaperTypeToCanvas(c, v, st);
        pushHistoryFor(c, st);
        scheduleAutoSave();
      }
    });
  }

  var shToggle = rootEl.querySelector("[data-db-shapes-toggle]");
  if (shToggle) {
    shToggle.addEventListener("click", function (e) {
      e.stopPropagation();
      if (shapesPopoverEl && shapesPopoverEl.classList.contains("is-open")) closeShapesPopover();
      else openShapesPopover(shToggle);
    });
  }

  var u = rootEl.querySelector("[data-db-undo]");
  if (u) u.addEventListener("click", undo);
  var r = rootEl.querySelector("[data-db-redo]");
  if (r) r.addEventListener("click", redo);
  rootEl.querySelectorAll("[data-db-save-lib]").forEach(function (sv) {
    sv.addEventListener("click", function () { void saveToLibrary(); });
  });
  var ed = rootEl.querySelector("[data-db-toggle-edit]");
  if (ed) ed.addEventListener("click", toggleEditMode);
  rootEl.querySelectorAll("[data-db-page-add-top]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      createPage(null);
    });
  });
  var clr = rootEl.querySelector("[data-db-clear-canvas]");
  if (clr) clr.addEventListener("click", clearCurrentPageCanvas);
  rootEl.addEventListener("click", function (ev) {
    var add = ev.target.closest && ev.target.closest("[data-db-page-add]");
    if (add && rootEl.contains(add)) {
      ev.preventDefault();
      createPage(null);
    }
  });
  document.addEventListener("click", function (ev) {
    if (popoverEl && popoverEl.classList.contains("is-open")) {
      if (!popoverEl.contains(ev.target) && !(ev.target.closest && ev.target.closest("[data-db-tool]"))) {
        closePopover();
      }
    }
    if (shapesPopoverEl && shapesPopoverEl.classList.contains("is-open")) {
      if (shapesPopoverEl.contains(ev.target)) return;
      if (ev.target.closest && ev.target.closest("[data-db-shapes-toggle]")) return;
      closeShapesPopover();
    }
  });

  rootEl.querySelectorAll("[data-db-share-open]").forEach(function (shOpen) {
    shOpen.addEventListener("click", function () { void openShareModal(); });
  });
  rootEl.querySelectorAll("[data-db-share-close]").forEach(function (btn) {
    btn.addEventListener("click", closeShareModal);
  });
  var shGo = rootEl.querySelector("[data-db-share-confirm]");
  if (shGo) shGo.addEventListener("click", function () { void confirmShareStudents(); });

  rootEl.querySelectorAll("[data-db-pdf-export]").forEach(function (pdfExportBtn) {
    pdfExportBtn.addEventListener("click", function () {
      void exportBoardToPdf(pdfExportBtn);
    });
  });
}

export function initDereceBoard() {
  rootEl = document.getElementById("dereceBoardRoot");
  if (!rootEl || !ensureFabric()) return;
  if (initialized) {
    showPage(pageIndex, { scroll: false });
    updatePaginationBar();
    refreshPagerButtons();
    return;
  }
  initialized = true;
  currentBoardDocId = null;
  popoverEl = rootEl.querySelector("#dereceBoardPopover") || rootEl.querySelector(".derece-board__popover");
  shapesPopoverEl = rootEl.querySelector("#dereceBoardShapesPopover");

  pages = [];
  pageIndex = 0;
  disconnectBoardPdfObserver();
  disconnectBoardNavObserver();
  rootEl.querySelector(".derece-board__sheet-wrap").innerHTML = "";
  rootEl.querySelector(".derece-board__page-strip").innerHTML =
    '<button type="button" class="derece-board__page-add" data-db-page-add title="Sayfa ekle">+</button>';

  wireToolbar();
  bindPopoverColors();
  bindHandPanGlobalListeners();

  createPage(null);

  var sheetScroll = rootEl.querySelector(".derece-board__sheet-wrap");
  var boardScrollCalcRaf = null;
  if (sheetScroll && !sheetScroll.dataset.dbScrollBound) {
    sheetScroll.dataset.dbScrollBound = "1";
    sheetScroll.addEventListener(
      "scroll",
      function () {
        if (boardScrollCalcRaf) return;
        boardScrollCalcRaf = requestAnimationFrame(function () {
          boardScrollCalcRaf = null;
          pages.forEach(function (p) {
            if (p.canvas) {
              try {
                p.canvas.calcOffset();
              } catch (_e) {}
            }
          });
          if (typeof IntersectionObserver === "undefined" && pages.length) {
            applyVisiblePageIndexFromScroll(fallbackPageIndexByViewportCenter());
          }
        });
      },
      { passive: true }
    );
  }

  window.addEventListener("resize", function () {
    pages.forEach(function (p) {
      if (p.canvas) {
        try {
          p.canvas.calcOffset();
        } catch (_e) {}
      }
    });
  });
}

/** Öğrenci paneli — koçtan gelen tahta (salt okunur) */
var studentReadOnlyPages = [];
var studentReadOnlyIndex = 0;
var studentReadOnlyResizeBound = false;

function applyReadOnlyCanvas(canvas) {
  if (!canvas) return;
  canvas.isDrawingMode = false;
  canvas.selection = false;
  canvas.defaultCursor = "default";
  canvas.forEachObject(function (o) {
    o.selectable = false;
    o.evented = false;
  });
}

function showStudentReadOnlyPage(i) {
  if (i < 0 || i >= studentReadOnlyPages.length) return;
  studentReadOnlyIndex = i;
  studentReadOnlyPages.forEach(function (p, pi) {
    p.sheet.hidden = pi !== i;
  });
  var strip = studentReadOnlyPages[0] && studentReadOnlyPages[0].stripParent;
  if (strip) {
    strip.querySelectorAll(".derece-board__thumb").forEach(function (tw, pi) {
      tw.classList.toggle("is-current", pi === i);
    });
  }
  var c = studentReadOnlyPages[i] && studentReadOnlyPages[i].canvas;
  if (c) {
    c.calcOffset();
    applyReadOnlyCanvas(c);
  }
}

function addStudentReadOnlyThumb(state, idx, strip) {
  var wrap = document.createElement("div");
  wrap.className = "derece-board__thumb";
  wrap.dataset.pageIndex = String(idx);
  var img = document.createElement("img");
  img.alt = "Sayfa " + (idx + 1);
  img.src =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  wrap.appendChild(img);
  strip.appendChild(wrap);
  state.thumbImg = img;
  state.thumbWrap = wrap;
  wrap.addEventListener("click", function () {
    var j = parseInt(wrap.dataset.pageIndex, 10);
    if (!isNaN(j)) showStudentReadOnlyPage(j);
  });
  try {
    if (state.canvas) {
      img.src = state.canvas.toDataURL({ format: "png", multiplier: 0.22 });
    }
  } catch (_e) {}
}

function createStudentReadOnlyPage(initialJson, sheetWrap, strip) {
  if (!ensureFabric()) return null;
  var idx = studentReadOnlyPages.length;
  var sheet = document.createElement("div");
  sheet.className = "derece-board__sheet";
  sheet.hidden = idx !== 0;
  var host = document.createElement("div");
  host.className = "derece-board__canvas-host";
  var canvasEl = document.createElement("canvas");
  canvasEl.width = 1000;
  canvasEl.height = 680;
  host.appendChild(canvasEl);
  sheet.appendChild(host);
  sheetWrap.appendChild(sheet);

  var canvas = new fabric.Canvas(canvasEl, {
    backgroundColor: "#ffffff",
    preserveObjectStacking: true,
  });

  var state = {
    canvas: canvas,
    sheet: sheet,
    stripParent: strip,
  };
  studentReadOnlyPages.push(state);

  if (initialJson) {
    canvas.loadFromJSON(initialJson, function () {
      canvas.renderAll();
      applyReadOnlyCanvas(canvas);
      try {
        if (state.thumbImg) state.thumbImg.src = canvas.toDataURL({ format: "png", multiplier: 0.22 });
      } catch (_e) {}
    });
  } else {
    applyReadOnlyCanvas(canvas);
  }

  addStudentReadOnlyThumb(state, idx, strip);
  return state;
}

export function disposeStudentReadOnlyBoard() {
  studentReadOnlyPages.forEach(function (st) {
    if (st.canvas) {
      try {
        st.canvas.dispose();
      } catch (_e) {}
    }
    if (st.sheet && st.sheet.parentNode) st.sheet.parentNode.removeChild(st.sheet);
    if (st.thumbWrap && st.thumbWrap.parentNode) st.thumbWrap.parentNode.removeChild(st.thumbWrap);
  });
  studentReadOnlyPages = [];
  studentReadOnlyIndex = 0;
}

/**
 * @param {HTMLElement} rootEl — .derece-board içi (sheet-wrap + page-strip + başlık)
 * @param {{ title?: string, pagesJson: string }} payload — pages_json (boards dokümanı)
 */
export function mountStudentReadOnlyBoard(rootEl, payload) {
  disposeStudentReadOnlyBoard();
  if (!rootEl || !ensureFabric()) return;
  var sheetWrap = rootEl.querySelector(".derece-board__sheet-wrap");
  var strip = rootEl.querySelector(".derece-board__page-strip");
  var titleEl =
    rootEl.querySelector(".osp-student-board__title") ||
    rootEl.querySelector("[data-osp-student-board-title]");
  if (titleEl && payload && payload.title) titleEl.textContent = payload.title;
  if (!sheetWrap || !strip) return;
  sheetWrap.innerHTML = "";
  strip.innerHTML = "";

  var raw = (payload && payload.pagesJson) || "[]";
  var arr = [];
  try {
    arr = JSON.parse(raw);
  } catch (_e) {
    arr = [];
  }
  if (!Array.isArray(arr) || !arr.length) {
    var ph = document.createElement("p");
    ph.className = "osp-student-board__hint";
    ph.style.margin = "1rem";
    ph.textContent = "Bu tahtada sayfa bulunamadı.";
    sheetWrap.appendChild(ph);
    return;
  }
  for (var i = 0; i < arr.length; i++) {
    createStudentReadOnlyPage(arr[i], sheetWrap, strip);
  }
  showStudentReadOnlyPage(0);

  if (!studentReadOnlyResizeBound) {
    studentReadOnlyResizeBound = true;
    window.addEventListener("resize", function () {
      var st = studentReadOnlyPages[studentReadOnlyIndex];
      if (st && st.canvas) st.canvas.calcOffset();
    });
  }
}

function registerNavigation() {
  function tryRegister() {
    if (window.YKSPanel && typeof window.YKSPanel.onNavigate === "function") {
      window.YKSPanel.onNavigate(function (view) {
        if (view === "ders-board") initDereceBoard();
      });
      return true;
    }
    return false;
  }
  if (!tryRegister()) {
    var n = 0;
    var t = setInterval(function () {
      n++;
      if (tryRegister() || n > 80) clearInterval(t);
    }, 50);
  }
}

registerNavigation();

window.initDereceBoard = initDereceBoard;
