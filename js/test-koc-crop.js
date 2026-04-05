/**
 * Elite Kırpma & Düzenleme Motoru — test-koc-crop.html
 * Floating toolbar (kutu üstü), gizli canvas JPEG kırpma, liste senkronu (pointer-up / debounce).
 */

const BG_PRIMARY = "assets/test-koc-crop/image_0.png";
const HANDLE_RADIUS = 7;
const HANDLE_HIT = 14;
const MIN_BOX = 16;
/** Liste + OCR metin güncellemesi — hafif debounce (kırpma motoru bundan bağımsız) */
const LIST_DEBOUNCE_MS = 300;
const JPEG_QUALITY = 0.88;

const OCR_SAMPLES_TR = [
  "f(x)=(a-2)x²+(a-3)x+1 ifadesinde a ∈ ℝ için ...",
  "lim(x→0) (sin x)/x ifadesinin değeri nedir?",
  "Bir ABC üçgeninde |AB|=5 cm, |AC|=7 cm ve m(∠A)=60° ise ...",
  "2ⁿ + 2ⁿ⁺¹ + 2ⁿ⁺² toplamı kaçtır? (n ∈ ℕ)",
  "pH = -log[H⁺] bağıntısına göre ...",
];

function uid() {
  return "q-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7);
}

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

function showToast(msg, variant) {
  var host = document.getElementById("tkcToastHost");
  if (!host) return;
  var el = document.createElement("div");
  el.className = "tkc-toast" + (variant === "ok" ? " tkc-toast--ok" : variant === "warn" ? " tkc-toast--warn" : "");
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(function () {
    el.style.opacity = "0";
    el.style.transition = "opacity 0.35s";
    setTimeout(function () {
      if (el.parentNode) el.parentNode.removeChild(el);
    }, 400);
  }, 3200);
}

/** Yatay projeksiyon ile içerik bantları (basit otomatik kırp) */
function detectHorizontalBands(ctx, w, h) {
  var idata = ctx.getImageData(0, 0, w, h);
  var d = idata.data;
  var row = new Float64Array(h);
  var xStep = w > 1200 ? 4 : 2;
  for (var y = 0; y < h; y++) {
    var sum = 0;
    var n = 0;
    for (var x = 0; x < w; x += xStep) {
      var i = (y * w + x) * 4;
      sum += 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      n++;
    }
    row[y] = sum / Math.max(n, 1);
  }
  var WHITE = 248;
  var MIN_H = 72;
  var marginX = Math.max(8, Math.floor(w * 0.02));
  var boxes = [];
  var y = 0;
  while (y < h) {
    while (y < h && row[y] >= WHITE) y++;
    var y0 = y;
    while (y < h && row[y] < WHITE) y++;
    var y1 = y;
    if (y1 - y0 >= MIN_H) {
      var yt = Math.max(0, y0 - 6);
      var yb = Math.min(h, y1 + 6);
      boxes.push({ x: marginX, y: yt, w: w - 2 * marginX, h: yb - yt });
    }
  }
  if (boxes.length < 2 && h > 200) {
    var rows = Math.min(8, Math.max(3, Math.floor(h / 420)));
    var rh = Math.floor(h / rows);
    boxes = [];
    for (var r = 0; r < rows; r++) {
      var top = r * rh + 10;
      var hh = r === rows - 1 ? h - top - 10 : rh - 20;
      if (hh >= MIN_H) boxes.push({ x: marginX, y: top, w: w - 2 * marginX, h: hh });
    }
  }
  return boxes;
}

var HANDLES = [
  { id: "nw", cx: 0, cy: 0 },
  { id: "n", cx: 0.5, cy: 0 },
  { id: "ne", cx: 1, cy: 0 },
  { id: "e", cx: 1, cy: 0.5 },
  { id: "se", cx: 1, cy: 1 },
  { id: "s", cx: 0.5, cy: 1 },
  { id: "sw", cx: 0, cy: 1 },
  { id: "w", cx: 0, cy: 0.5 },
];

function EliteCropEngine() {
  this.canvas = document.getElementById("cropCanvas");
  this.ctx = this.canvas && this.canvas.getContext("2d");
  this.wrap = document.getElementById("cropCanvasWrap");
  this.floatLayer = document.getElementById("tkcFloatingLayer");
  this.boxes = [];
  this.selectedId = null;
  this.bgImage = null;
  this.manualOnce = false;
  this.addRepeat = false;
  this.dirty = true;
  this.listDirty = true;
  this.rafScheduled = false;
  this._listTimer = null;
  this._ocrInputTimer = null;
  this._sampleIdx = 0;

  /** Görüntü kırpma — yalnızca pointer-up / finalize’da kullanılır */
  this._hiddenCropCanvas = document.createElement("canvas");
  this._floatUi = null;
  this._floatOcrInput = null;
  this._floatEditBtn = null;
  this._ocrPanelOpen = false;

  this.drag = null;
  this.rubber = null;

  this._onResize = this._onResize.bind(this);
  this._onPointerDown = this._onPointerDown.bind(this);
  this._onPointerMove = this._onPointerMove.bind(this);
  this._onPointerUp = this._onPointerUp.bind(this);
  this._onWrapScroll = this._onWrapScroll.bind(this);
}

EliteCropEngine.prototype.init = function () {
  if (!this.canvas || !this.ctx) return;
  this._buildFloatingUi();
  this._wireUi();
  this._loadBackground(BG_PRIMARY, true);
  window.addEventListener("resize", this._onResize);
  if (this.wrap) this.wrap.addEventListener("scroll", this._onWrapScroll, { passive: true });
  this.scheduleListSync(true);
};

EliteCropEngine.prototype._buildFloatingUi = function () {
  var host = this.floatLayer;
  if (!host) return;
  host.innerHTML = "";
  var root = document.createElement("div");
  root.className = "tkc-float-ui";
  root.id = "tkcFloatUi";
  root.hidden = true;
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Seçili kutu araçları");

  var bar = document.createElement("div");
  bar.className = "tkc-float-toolbar";

  var btnDel = document.createElement("button");
  btnDel.type = "button";
  btnDel.className = "tkc-float-btn tkc-float-btn--danger";
  btnDel.title = "Kutuyu sil";
  btnDel.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';
  btnDel.setAttribute("aria-label", "Sil");

  var btnEdit = document.createElement("button");
  btnEdit.type = "button";
  btnEdit.className = "tkc-float-btn tkc-float-btn--edit";
  btnEdit.title = "OCR metnini düzenle";
  btnEdit.innerHTML = '<i class="fa-solid fa-pen" aria-hidden="true"></i>';
  btnEdit.setAttribute("aria-label", "Düzenle");
  btnEdit.setAttribute("aria-pressed", "false");

  var ocrWrap = document.createElement("div");
  ocrWrap.className = "tkc-float-ocr";
  ocrWrap.id = "tkcFloatOcrWrap";
  ocrWrap.hidden = true;

  var ocrIn = document.createElement("input");
  ocrIn.type = "text";
  ocrIn.className = "tkc-float-ocr-input";
  ocrIn.id = "tkcFloatOcrInput";
  ocrIn.placeholder = "OCR / soru metni";
  ocrIn.setAttribute("autocomplete", "off");
  ocrIn.setAttribute("spellcheck", "true");
  ocrIn.setAttribute("lang", "tr");

  ocrWrap.appendChild(ocrIn);
  bar.appendChild(btnDel);
  bar.appendChild(btnEdit);
  root.appendChild(bar);
  root.appendChild(ocrWrap);
  host.appendChild(root);

  this._floatUi = root;
  this._floatOcrInput = ocrIn;
  this._floatEditBtn = btnEdit;

  var self = this;
  function stop(e) {
    e.stopPropagation();
  }
  [root, bar, btnDel, btnEdit, ocrWrap, ocrIn].forEach(function (el) {
    el.addEventListener("pointerdown", stop);
    el.addEventListener("mousedown", stop);
  });

  btnDel.addEventListener("click", function (e) {
    e.stopPropagation();
    self.deleteSelected();
  });

  btnEdit.addEventListener("click", function (e) {
    e.stopPropagation();
    self._toggleOcrPanel();
  });

  ocrIn.addEventListener("input", function () {
    self._onFloatingOcrInput();
  });
  ocrIn.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") {
      self._setOcrPanel(false);
    }
  });
};

EliteCropEngine.prototype._toggleOcrPanel = function () {
  this._setOcrPanel(!this._ocrPanelOpen);
};

EliteCropEngine.prototype._setOcrPanel = function (open) {
  this._ocrPanelOpen = !!open;
  var wrap = document.getElementById("tkcFloatOcrWrap");
  if (wrap) wrap.hidden = !this._ocrPanelOpen;
  if (this._floatEditBtn) this._floatEditBtn.setAttribute("aria-pressed", this._ocrPanelOpen ? "true" : "false");
  if (this._ocrPanelOpen && this._floatOcrInput) {
    var self = this;
    requestAnimationFrame(function () {
      self._floatOcrInput.focus();
      self._floatOcrInput.select();
    });
  }
  this._positionFloatingUi();
};

EliteCropEngine.prototype._onFloatingOcrInput = function () {
  var self = this;
  if (!this.selectedId || !this._floatOcrInput) return;
  var b = this.boxes.find(function (x) {
    return x.id === self.selectedId;
  });
  if (!b) return;
  b.ocrText = this._floatOcrInput.value;
  b.edited = true;
  if (this._ocrInputTimer) clearTimeout(this._ocrInputTimer);
  this._ocrInputTimer = setTimeout(function () {
    self._ocrInputTimer = null;
    self.scheduleListSync(true);
  }, LIST_DEBOUNCE_MS);
};

EliteCropEngine.prototype._syncFloatingOcrFromBox = function () {
  var b = this.boxes.find(
    function (x) {
      return x.id === this.selectedId;
    }.bind(this)
  );
  if (this._floatOcrInput) {
    this._floatOcrInput.value = b && b.ocrText != null ? String(b.ocrText) : "";
  }
};

EliteCropEngine.prototype._onWrapScroll = function () {
  this._positionFloatingUi();
};

/** Kutu sağ üst köşesinin üzerine yerleştir (wrap içi koordinatlar) */
EliteCropEngine.prototype._positionFloatingUi = function () {
  if (!this._floatUi || !this.wrap || !this.canvas || !this.selectedId) return;
  var b = this.boxes.find(
    function (x) {
      return x.id === this.selectedId;
    }.bind(this)
  );
  if (!b) return;

  var cvs = this.canvas;
  var ox = cvs.offsetLeft;
  var oy = cvs.offsetTop;
  var scaleX = cvs.clientWidth / Math.max(cvs.width, 1);
  var scaleY = cvs.clientHeight / Math.max(cvs.height, 1);

  var bx = b.x * scaleX + ox;
  var by = b.y * scaleY + oy;
  var bw = b.w * scaleX;
  var bh = b.h * scaleY;

  this._floatUi.hidden = false;
  this._floatUi.style.display = "flex";

  var tw = this._floatUi.offsetWidth || 120;
  var th = this._floatUi.offsetHeight || 40;

  var pad = 6;
  var left = bx + bw - tw - pad;
  var top = by - th - pad;

  if (left < ox + pad) left = ox + pad;
  if (left + tw > ox + cvs.clientWidth - pad) left = ox + cvs.clientWidth - tw - pad;
  if (top < oy + pad) {
    top = by + bh + pad;
  }
  if (top + th > oy + cvs.clientHeight - pad) {
    top = oy + cvs.clientHeight - th - pad;
  }

  this._floatUi.style.left = Math.round(left) + "px";
  this._floatUi.style.top = Math.round(top) + "px";

  var host = this.floatLayer;
  if (host) host.setAttribute("aria-hidden", "false");
};

EliteCropEngine.prototype._hideFloatingUi = function () {
  if (this._floatUi) {
    this._floatUi.hidden = true;
  }
  this._setOcrPanel(false);
  var host = this.floatLayer;
  if (host) host.setAttribute("aria-hidden", "true");
};

/**
 * Gizli canvas ile JPEG kırpma (drawImage sx,sy,sw,sh → tam boyut).
 */
EliteCropEngine.prototype._computeJpegCrop = function (b) {
  var cw = this.canvas.width;
  var ch = this.canvas.height;
  var sx = clamp(Math.floor(b.x), 0, cw - 1);
  var sy = clamp(Math.floor(b.y), 0, ch - 1);
  var sw = clamp(Math.floor(b.w), MIN_BOX, cw - sx);
  var sh = clamp(Math.floor(b.h), MIN_BOX, ch - sy);

  var src = this.bgImage;
  if (!src) {
    src = this.canvas;
  }

  var c = this._hiddenCropCanvas;
  c.width = sw;
  c.height = sh;
  var ctx = c.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#f1f5f9";
  ctx.fillRect(0, 0, sw, sh);
  try {
    ctx.drawImage(src, sx, sy, sw, sh, 0, 0, sw, sh);
    return c.toDataURL("image/jpeg", JPEG_QUALITY);
  } catch (e) {
    console.warn("[tkc] JPEG kırpma başarısız (CORS / tainted canvas):", e && e.message);
    return "";
  }
};

/** Tek kutu için kırpma + liste güncellemesi tetikleyicisi */
EliteCropEngine.prototype._finalizeBoxCrop = function (boxId) {
  var b = this.boxes.find(function (x) {
    return x.id === boxId;
  });
  if (!b) return;
  var url = this._computeJpegCrop(b);
  b.cropDataUrl = url || null;
  b.cropRevision = (b.cropRevision || 0) + 1;
  this.listDirty = true;
};

EliteCropEngine.prototype._loadBackground = function (src, isFallback) {
  var self = this;
  var img = new Image();
  img.crossOrigin = "anonymous";
  img.onload = function () {
    self.bgImage = img;
    self.canvas.width = img.naturalWidth;
    self.canvas.height = img.naturalHeight;
    self._updateSizeLabel();
    self.markDirty();
    self._refreshAllCrops();
    self.scheduleListSync(true);
    if (!isFallback) showToast("Görsel yüklendi.", "ok");
  };
  img.onerror = function () {
    if (!isFallback) {
      self._loadBackground("", true);
      return;
    }
    self._drawPlaceholderPattern();
    showToast("image_0.png bulunamadı; yer tutucu tuval kullanılıyor. assets/test-koc-crop/image_0.png ekleyin.", "warn");
  };
  if (isFallback && !src) {
    self._drawPlaceholderPattern();
    return;
  }
  img.src = src;
};

EliteCropEngine.prototype._drawPlaceholderPattern = function () {
  var w = 800;
  var h = 1100;
  this.canvas.width = w;
  this.canvas.height = h;
  var ctx = this.ctx;
  ctx.fillStyle = "#f8fafc";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#cbd5e1";
  ctx.lineWidth = 1;
  for (var g = 0; g < w; g += 40) {
    ctx.beginPath();
    ctx.moveTo(g, 0);
    ctx.lineTo(g, h);
    ctx.stroke();
  }
  for (g = 0; g < h; g += 40) {
    ctx.beginPath();
    ctx.moveTo(0, g);
    ctx.lineTo(w, g);
    ctx.stroke();
  }
  ctx.fillStyle = "#64748b";
  ctx.font = "600 18px Plus Jakarta Sans, sans-serif";
  ctx.fillText("Test kitapçığı — image_0.png", 32, 48);
  ctx.font = "14px Plus Jakarta Sans, sans-serif";
  ctx.fillText("Bu alan gerçek görsel yüklendiğinde kitapçık arka planı olur.", 32, 78);
  this.bgImage = null;
  this._updateSizeLabel();
  this.markDirty();
  this._refreshAllCrops();
  this.scheduleListSync(true);
};

EliteCropEngine.prototype._refreshAllCrops = function () {
  var self = this;
  this.boxes.forEach(function (b) {
    self._finalizeBoxCrop(b.id);
  });
  this.scheduleListSync(true);
};

EliteCropEngine.prototype._updateSizeLabel = function () {
  var el = document.getElementById("tkcCanvasSizeLabel");
  if (el) el.textContent = "Tuval: " + this.canvas.width + " × " + this.canvas.height + " px";
};

EliteCropEngine.prototype.clientToCanvas = function (clientX, clientY) {
  var rect = this.canvas.getBoundingClientRect();
  var sx = this.canvas.width / Math.max(rect.width, 1e-6);
  var sy = this.canvas.height / Math.max(rect.height, 1e-6);
  return {
    x: (clientX - rect.left) * sx,
    y: (clientY - rect.top) * sy,
  };
};

EliteCropEngine.prototype._wireUi = function () {
  var self = this;
  this.canvas.addEventListener("pointerdown", this._onPointerDown);
  window.addEventListener("pointermove", this._onPointerMove);
  window.addEventListener("pointerup", this._onPointerUp);
  window.addEventListener("pointercancel", this._onPointerUp);

  document.getElementById("btnAutoCrop").addEventListener("click", function () {
    self.runAutoCrop();
  });
  document.getElementById("btnManualCrop").addEventListener("click", function () {
    self.addRepeat = false;
    self.manualOnce = true;
    self._setBtnPressed("btnManualCrop", true);
    self._setBtnPressed("btnAddGreenBox", false);
    self._hint("Manuel kırp: tuvalde bir kez sürükleyerek kutu çizin.");
    self._syncWrapClass();
  });
  document.getElementById("btnAddGreenBox").addEventListener("click", function () {
    self.manualOnce = false;
    self.addRepeat = !self.addRepeat;
    self._setBtnPressed("btnAddGreenBox", self.addRepeat);
    self._setBtnPressed("btnManualCrop", false);
    self.manualOnce = false;
    self._hint(self.addRepeat ? "Yeşil kutu modu: her sürüklemeyle yeni kutu eklenir." : "");
    self._syncWrapClass();
  });
  document.getElementById("btnReset").addEventListener("click", function () {
    self.resetSession();
  });
  document.getElementById("btnSave").addEventListener("click", function () {
    self.saveJson();
  });

  var fin = document.getElementById("tkcFileInput");
  if (fin) {
    fin.addEventListener("change", function (e) {
      var f = e.target.files && e.target.files[0];
      if (!f || !f.type.match(/^image\//)) return;
      var url = URL.createObjectURL(f);
      var im = new Image();
      im.onload = function () {
        self.bgImage = im;
        self.canvas.width = im.naturalWidth;
        self.canvas.height = im.naturalHeight;
        self._updateSizeLabel();
        self.markDirty();
        self._refreshAllCrops();
        URL.revokeObjectURL(url);
        showToast("Görsel tuvalde.", "ok");
      };
      im.src = url;
    });
  }
};

EliteCropEngine.prototype._setBtnPressed = function (id, on) {
  var b = document.getElementById(id);
  if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
};

EliteCropEngine.prototype._hint = function (t) {
  var h = document.getElementById("tkcModeHint");
  if (h) h.textContent = t || "";
};

EliteCropEngine.prototype._syncWrapClass = function () {
  if (!this.wrap) return;
  var draw = this.manualOnce || this.addRepeat;
  this.wrap.classList.toggle("tkc-canvas-wrap--draw", draw);
  this.wrap.classList.toggle("tkc-canvas-wrap--move", !draw && !!this.selectedId);
};

EliteCropEngine.prototype.markDirty = function () {
  this.dirty = true;
  this._scheduleFrame();
};

EliteCropEngine.prototype._scheduleFrame = function () {
  var self = this;
  if (this.rafScheduled) return;
  this.rafScheduled = true;
  requestAnimationFrame(function () {
    self.rafScheduled = false;
    self._paint();
    self._positionFloatingUi();
  });
};

EliteCropEngine.prototype._paint = function () {
  if (!this.dirty) return;
  this.dirty = false;
  var ctx = this.ctx;
  var w = this.canvas.width;
  var h = this.canvas.height;
  ctx.clearRect(0, 0, w, h);
  if (this.bgImage) {
    ctx.drawImage(this.bgImage, 0, 0, w, h);
  } else {
    ctx.fillStyle = "#f1f5f9";
    ctx.fillRect(0, 0, w, h);
  }

  var self = this;
  var ordered = this.boxes.slice().sort(function (a, b) {
    if (a.id === self.selectedId) return 1;
    if (b.id === self.selectedId) return -1;
    return 0;
  });

  ordered.forEach(function (b) {
    self._drawBox(b, b.id === self.selectedId);
  });

  if (this.rubber) {
    var r = this.rubber;
    ctx.strokeStyle = "rgba(34, 197, 94, 0.85)";
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    ctx.setLineDash([]);
  }
};

EliteCropEngine.prototype._drawBox = function (b, selected) {
  var ctx = this.ctx;
  ctx.save();
  ctx.strokeStyle = selected ? "#16a34a" : "#22c55e";
  ctx.lineWidth = selected ? 2.5 : 1.75;
  ctx.fillStyle = "rgba(34, 197, 94, 0.06)";
  ctx.fillRect(b.x, b.y, b.w, b.h);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  if (selected) {
    HANDLES.forEach(function (H) {
      var hx = b.x + H.cx * b.w;
      var hy = b.y + H.cy * b.h;
      ctx.beginPath();
      ctx.arc(hx, hy, HANDLE_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      ctx.strokeStyle = "#15803d";
      ctx.lineWidth = 2;
      ctx.stroke();
    });
  }
  ctx.restore();
};

EliteCropEngine.prototype._hitHandle = function (mx, my, b) {
  for (var i = 0; i < HANDLES.length; i++) {
    var H = HANDLES[i];
    var hx = b.x + H.cx * b.w;
    var hy = b.y + H.cy * b.h;
    if (Math.abs(mx - hx) <= HANDLE_HIT && Math.abs(my - hy) <= HANDLE_HIT) return H.id;
  }
  return null;
};

EliteCropEngine.prototype._hitBoxBody = function (mx, my, b) {
  return mx >= b.x && mx <= b.x + b.w && my >= b.y && my <= b.y + b.h;
};

EliteCropEngine.prototype._pickBox = function (mx, my) {
  for (var i = this.boxes.length - 1; i >= 0; i--) {
    var b = this.boxes[i];
    if (this._hitBoxBody(mx, my, b)) return b;
  }
  return null;
};

EliteCropEngine.prototype._onPointerDown = function (e) {
  if (!this.canvas.contains(e.target)) return;
  e.preventDefault();
  this.canvas.setPointerCapture(e.pointerId);
  var p = this.clientToCanvas(e.clientX, e.clientY);
  var mx = p.x;
  var my = p.y;

  if (this.manualOnce || this.addRepeat) {
    this.rubber = { x0: mx, y0: my, x: mx, y: my, w: 0, h: 0 };
    this.drag = { type: "rubber" };
    return;
  }

  if (this.selectedId) {
    var sb = this.boxes.find(function (x) {
      return x.id === this.selectedId;
    }, this);
    if (sb) {
      var h = this._hitHandle(mx, my, sb);
      if (h) {
        this.drag = { type: "resize", id: sb.id, handle: h, start: { x: mx, y: my }, orig: { x: sb.x, y: sb.y, w: sb.w, h: sb.h } };
        return;
      }
    }
  }

  var hit = this._pickBox(mx, my);
  if (hit) {
    this.select(hit.id);
    this.drag = { type: "move", id: hit.id, start: { x: mx, y: my }, orig: { x: hit.x, y: hit.y, w: hit.w, h: hit.h } };
    return;
  }

  this.select(null);
};

EliteCropEngine.prototype._onPointerMove = function (e) {
  if (!this.drag) return;
  var p = this.clientToCanvas(e.clientX, e.clientY);
  var mx = clamp(p.x, 0, this.canvas.width);
  var my = clamp(p.y, 0, this.canvas.height);

  if (this.drag.type === "rubber" && this.rubber) {
    var r = this.rubber;
    r.x = Math.min(r.x0, mx);
    r.y = Math.min(r.y0, my);
    r.w = Math.abs(mx - r.x0);
    r.h = Math.abs(my - r.y0);
    this.markDirty();
    return;
  }

  if (this.drag.type === "move") {
    var b = this.boxes.find(function (x) {
      return x.id === this.drag.id;
    }, this);
    if (!b) return;
    var dx = mx - this.drag.start.x;
    var dy = my - this.drag.start.y;
    b.x = clamp(this.drag.orig.x + dx, 0, this.canvas.width - b.w);
    b.y = clamp(this.drag.orig.y + dy, 0, this.canvas.height - b.h);
    b.edited = true;
    this.markDirty();
    this._positionFloatingUi();
    return;
  }

  if (this.drag.type === "resize") {
    var b2 = this.boxes.find(function (x) {
      return x.id === this.drag.id;
    }, this);
    if (!b2) return;
    var ox = this.drag.orig.x;
    var oy = this.drag.orig.y;
    var ow = this.drag.orig.w;
    var oh = this.drag.orig.h;
    var ex = ox + ow;
    var ey = oy + oh;
    var hid = this.drag.handle;
    switch (hid) {
      case "nw":
        ox = mx;
        oy = my;
        break;
      case "n":
        oy = my;
        break;
      case "ne":
        ex = mx;
        oy = my;
        break;
      case "e":
        ex = mx;
        break;
      case "se":
        ex = mx;
        ey = my;
        break;
      case "s":
        ey = my;
        break;
      case "sw":
        ox = mx;
        ey = my;
        break;
      case "w":
        ox = mx;
        break;
      default:
        break;
    }
    var left = Math.min(ox, ex);
    var top = Math.min(oy, ey);
    var right = Math.max(ox, ex);
    var bottom = Math.max(oy, ey);
    var nw = Math.max(MIN_BOX, right - left);
    var nh = Math.max(MIN_BOX, bottom - top);
    left = clamp(left, 0, this.canvas.width - nw);
    top = clamp(top, 0, this.canvas.height - nh);
    if (left + nw > this.canvas.width) nw = this.canvas.width - left;
    if (top + nh > this.canvas.height) nh = this.canvas.height - top;
    b2.x = left;
    b2.y = top;
    b2.w = nw;
    b2.h = nh;
    b2.edited = true;
    this.markDirty();
    this._positionFloatingUi();
  }
};

EliteCropEngine.prototype._onPointerUp = function (e) {
  var self = this;
  var cropIds = [];

  if (this.drag && this.drag.type === "rubber" && this.rubber) {
    var r = this.rubber;
    if (r.w >= MIN_BOX && r.h >= MIN_BOX) {
      var newId = this._addBox(
        {
          x: r.x,
          y: r.y,
          w: r.w,
          h: r.h,
          ocrText: OCR_SAMPLES_TR[this._sampleIdx % OCR_SAMPLES_TR.length],
          isNew: true,
          edited: false,
        },
        true
      );
      if (newId) cropIds.push(newId);
      this._sampleIdx++;
    }
    this.rubber = null;
    if (this.manualOnce) {
      this.manualOnce = false;
      this._setBtnPressed("btnManualCrop", false);
      this._hint("");
    }
    this._syncWrapClass();
  } else if (this.drag && (this.drag.type === "move" || this.drag.type === "resize")) {
    cropIds.push(this.drag.id);
  }

  this.drag = null;
  try {
    if (this.canvas && e.pointerId != null) this.canvas.releasePointerCapture(e.pointerId);
  } catch (_err) {}

  cropIds.forEach(function (id) {
    self._finalizeBoxCrop(id);
  });
  if (cropIds.length) {
    self.scheduleListSync(true);
  }

  this.markDirty();
};

EliteCropEngine.prototype._addBox = function (partial, silentToast) {
  var b = {
    id: uid(),
    x: partial.x,
    y: partial.y,
    w: partial.w,
    h: partial.h,
    ocrText: partial.ocrText || "",
    isNew: !!partial.isNew,
    edited: !!partial.edited,
    cropDataUrl: null,
    cropRevision: 0,
  };
  this.boxes.push(b);
  this.select(b.id);
  this.markDirty();
  if (!silentToast) showToast("Kutu eklendi.", "ok");
  return b.id;
};

EliteCropEngine.prototype.select = function (id) {
  this.selectedId = id;
  var lab = document.getElementById("tkcSelectionLabel");
  if (lab) lab.textContent = id ? "Seçim: " + id : "";

  if (!id) {
    this._hideFloatingUi();
  } else {
    this._syncFloatingOcrFromBox();
    this._setOcrPanel(false);
    requestAnimationFrame(function () {
      this._positionFloatingUi();
    }.bind(this));
  }

  this.markDirty();
  this._syncWrapClass();
  this.scheduleListSync(true);
};

EliteCropEngine.prototype.deleteSelected = function () {
  if (!this.selectedId) return;
  var sid = this.selectedId;
  this.boxes = this.boxes.filter(function (x) {
    return x.id !== sid;
  });
  showToast("Kutu silindi.", "ok");
  this.select(null);
  this.markDirty();
  this.scheduleListSync(true);
};

EliteCropEngine.prototype.runAutoCrop = function () {
  if (!this.canvas.width || !this.canvas.height) return;
  var off = document.createElement("canvas");
  off.width = this.canvas.width;
  off.height = this.canvas.height;
  var octx = off.getContext("2d");
  if (this.bgImage) {
    octx.drawImage(this.bgImage, 0, 0, off.width, off.height);
  } else {
    octx.drawImage(this.canvas, 0, 0);
  }
  var bands = detectHorizontalBands(octx, off.width, off.height);
  if (!bands.length) {
    showToast("Otomatik kutu bulunamadı.", "warn");
    return;
  }
  var self = this;
  var ids = [];
  bands.forEach(function (rect, i) {
    var id = self._addBox(
      {
        x: rect.x,
        y: rect.y,
        w: rect.w,
        h: rect.h,
        ocrText: OCR_SAMPLES_TR[i % OCR_SAMPLES_TR.length],
        isNew: true,
        edited: false,
      },
      true
    );
    if (id) ids.push(id);
  });
  ids.forEach(function (id) {
    self._finalizeBoxCrop(id);
  });
  showToast(bands.length + " kutu otomatik oluşturuldu.", "ok");
  this.manualOnce = false;
  this.addRepeat = false;
  this._setBtnPressed("btnManualCrop", false);
  this._setBtnPressed("btnAddGreenBox", false);
  this._hint("");
  this._syncWrapClass();
  this.scheduleListSync(true);
};

EliteCropEngine.prototype.resetSession = function () {
  this.boxes = [];
  this.select(null);
  this.manualOnce = false;
  this.addRepeat = false;
  this._setBtnPressed("btnManualCrop", false);
  this._setBtnPressed("btnAddGreenBox", false);
  this._hint("");
  this.rubber = null;
  this.drag = null;
  if (this.bgImage) {
    this.canvas.width = this.bgImage.naturalWidth;
    this.canvas.height = this.bgImage.naturalHeight;
  } else {
    this._drawPlaceholderPattern();
  }
  this._updateSizeLabel();
  this.markDirty();
  this.scheduleListSync(true);
  showToast("Sıfırlandı.", "ok");
};

EliteCropEngine.prototype.saveJson = function () {
  var payload = {
    version: 2,
    canvas: { w: this.canvas.width, h: this.canvas.height },
    image: BG_PRIMARY,
    boxes: this.boxes.map(function (b) {
      return {
        id: b.id,
        x: Math.round(b.x),
        y: Math.round(b.y),
        w: Math.round(b.w),
        h: Math.round(b.h),
        ocrText: b.ocrText || "",
        cropJpegDataUrl: b.cropDataUrl || null,
      };
    }),
    savedAt: new Date().toISOString(),
  };
  var blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  var a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "elite-crop-" + Date.now() + ".json";
  a.click();
  URL.revokeObjectURL(a.href);
  this.boxes.forEach(function (b) {
    b.isNew = false;
  });
  this.scheduleListSync(true);
  showToast("Kayıt indirildi.", "ok");
};

EliteCropEngine.prototype.scheduleListSync = function (immediate) {
  var self = this;
  this.listDirty = true;
  if (immediate) {
    if (this._listTimer) clearTimeout(this._listTimer);
    this._listTimer = null;
    this._renderList();
    return;
  }
  if (this._listTimer) clearTimeout(this._listTimer);
  this._listTimer = setTimeout(function () {
    self._listTimer = null;
    self._renderList();
  }, LIST_DEBOUNCE_MS);
};

EliteCropEngine.prototype._renderList = function () {
  if (!this.listDirty) return;
  this.listDirty = false;
  var ul = document.getElementById("croppedQuestionsList");
  if (!ul) return;
  ul.innerHTML = "";
  var self = this;
  if (!this.boxes.length) {
    var empty = document.createElement("li");
    empty.className = "tkc-list-empty";
    empty.style.gridColumn = "1 / -1";
    empty.style.padding = "1.25rem";
    empty.style.textAlign = "center";
    empty.style.color = "var(--gray-500)";
    empty.style.fontSize = "0.88rem";
    empty.textContent = "Henüz kutu yok. Otomatik kırp, manuel kırp veya yeşil kutu ekleyerek başlayın.";
    ul.appendChild(empty);
    return;
  }
  this.boxes.forEach(function (b) {
    var li = document.createElement("li");
    li.className = "tkc-crop-card" + (b.id === self.selectedId ? " tkc-crop-card--selected" : "");
    li.dataset.boxId = b.id;
    li.addEventListener("click", function () {
      self.select(b.id);
    });

    var thumbWrap = document.createElement("div");
    thumbWrap.className = "tkc-crop-card__thumb-wrap";
    var badges = document.createElement("div");
    badges.className = "tkc-crop-card__badges";
    if (b.isNew) {
      var bn = document.createElement("span");
      bn.className = "tkc-badge tkc-badge--new";
      bn.textContent = "Yeni";
      badges.appendChild(bn);
    }
    var bl = document.createElement("span");
    bl.className = "tkc-badge tkc-badge--live";
    bl.textContent = "JPEG";
    badges.appendChild(bl);
    if (b.edited) {
      var be = document.createElement("span");
      be.className = "tkc-badge tkc-badge--edit";
      be.textContent = "Düzenlendi";
      badges.appendChild(be);
    }
    thumbWrap.appendChild(badges);

    if (b.cropDataUrl) {
      var img = document.createElement("img");
      img.className = "tkc-crop-card__thumb";
      img.alt = "Kırpılmış soru";
      img.src = b.cropDataUrl;
      thumbWrap.appendChild(img);
    } else {
      var pend = document.createElement("div");
      pend.className = "tkc-crop-card__thumb tkc-crop-card__thumb--pending";
      pend.textContent = "Önizleme hazırlanıyor…";
      thumbWrap.appendChild(pend);
    }

    var body = document.createElement("div");
    body.className = "tkc-crop-card__body";
    var idEl = document.createElement("div");
    idEl.className = "tkc-crop-card__id";
    idEl.textContent = b.id;
    var ocrEl = document.createElement("div");
    ocrEl.className = "tkc-crop-card__ocr";
    ocrEl.textContent = b.ocrText || "(OCR yok)";
    body.appendChild(idEl);
    body.appendChild(ocrEl);

    li.appendChild(thumbWrap);
    li.appendChild(body);
    ul.appendChild(li);
  });
};

EliteCropEngine.prototype._onResize = function () {
  this.markDirty();
  this._positionFloatingUi();
};

var engine = new EliteCropEngine();
window.__tkcEngine = engine;
engine.init();
