/**
 * YKS Koçluk — Panel (Firestore + tüm butonlar)
 * Menüye özellik eklemek için: window.YKSPanel.onNavigate(fn) veya data-nav ile navigate
 */

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getFirestore,
  collection,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  query,
  where,
  getDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

(function () {
  var el = document.getElementById("appointmentsRow");
  if (el) el.dataset.panelOk = "1";
})();

const firebaseConfig = {
  apiKey: "AIzaSyD3RUiCIlcysC6S7TFMbChD8h0cfHeroP8",
  authDomain: "yks-kocluk-8f7c6.firebaseapp.com",
  projectId: "yks-kocluk-8f7c6",
  storageBucket: "yks-kocluk-8f7c6.firebasestorage.app",
  messagingSenderId: "928738467961",
  appId: "1:928738467961:web:7e023f5b8f0ae3637874a8",
  measurementId: "G-GGYN4VBFPR",
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

let kocPanelBootstrapped = false;

function getCoachId() {
  try {
    var imp = sessionStorage.getItem("superAdminViewAsCoach");
    if (imp && String(imp).trim()) return String(imp).trim();
  } catch (e) {}
  return (localStorage.getItem("currentUser") || "").trim();
}

function showImpersonateBanner(coachUsername) {
  if (document.getElementById("impersonateBanner")) return;
  document.body.style.paddingTop = "52px";
  var bar = document.createElement("div");
  bar.id = "impersonateBanner";
  bar.setAttribute("role", "status");
  bar.style.cssText =
    "position:fixed;top:0;left:0;right:0;z-index:99999;padding:0.65rem 1.25rem;background:linear-gradient(90deg,rgba(124,58,237,0.97),rgba(13,159,122,0.94));color:#fff;font-size:0.88rem;font-weight:600;display:flex;align-items:center;justify-content:center;flex-wrap:wrap;gap:0.75rem 1rem;box-shadow:0 4px 24px rgba(0,0,0,0.35);font-family:Outfit,system-ui,sans-serif;";
  bar.innerHTML =
    '<span><i class="fa-solid fa-user-secret" style="margin-right:0.45rem"></i>Kurucu görünümü: <strong>' +
    escapeHtml(coachUsername) +
    '</strong></span><a href="#" id="impersonateExit" style="color:#fff;text-decoration:underline;font-weight:800">Kurucu paneline dön</a>';
  document.body.insertBefore(bar, document.body.firstChild);
  var exit = document.getElementById("impersonateExit");
  if (exit) {
    exit.addEventListener("click", function (e) {
      e.preventDefault();
      try {
        sessionStorage.removeItem("superAdminViewAsCoach");
      } catch (err) {}
      document.body.style.paddingTop = "";
      window.location.href = "super-admin.html";
    });
  }
}

function coachQuery(collectionName) {
  var cid = getCoachId();
  if (!cid) return null;
  return query(collection(db, collectionName), where("coach_id", "==", cid));
}

let firestoreUnsubs = [];
let cachedAppointments = [];
let cachedExams = [];
let cachedStudents = [];
let cachedPayments = [];
let cachedTests = [];
let tmWsCropper = null;
let tmWsPdfDoc = null;
let tmWsCurrentPdfPage = 1;
let tmWsPdfRendering = false;
let tmWsWorkspaceBound = false;
let tmActiveLibId = null;
let tmWsDragBlock = null;
let tmColorStudioBound = false;
let tmHue = 210;
let tmSat = 85;
let tmVal = 42;
const TM_IDB_NAME = "TestMakerProLibrary";
const TM_IDB_VER = 1;
const TM_IDB_STORE = "pdfs";

function tmIdbOpen() {
  return new Promise(function (resolve, reject) {
    var req = indexedDB.open(TM_IDB_NAME, TM_IDB_VER);
    req.onerror = function () {
      reject(req.error);
    };
    req.onupgradeneeded = function () {
      var db = req.result;
      if (!db.objectStoreNames.contains(TM_IDB_STORE)) db.createObjectStore(TM_IDB_STORE, { keyPath: "id" });
    };
    req.onsuccess = function () {
      resolve(req.result);
    };
  });
}

function tmLibPut(rec) {
  return tmIdbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(TM_IDB_STORE, "readwrite");
      tx.objectStore(TM_IDB_STORE).put(rec);
      tx.oncomplete = function () {
        db.close();
        resolve();
      };
      tx.onerror = function () {
        db.close();
        reject(tx.error);
      };
    });
  });
}

function tmLibGetAllMeta() {
  return tmIdbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var out = [];
      var tx = db.transaction(TM_IDB_STORE, "readonly");
      var st = tx.objectStore(TM_IDB_STORE);
      var cur = st.openCursor();
      cur.onsuccess = function (e) {
        var c = e.target.result;
        if (c) {
          out.push({ id: c.value.id, name: c.value.name, addedAt: c.value.addedAt });
          c.continue();
        } else {
          db.close();
          out.sort(function (a, b) {
            return (b.addedAt || 0) - (a.addedAt || 0);
          });
          resolve(out);
        }
      };
      cur.onerror = function () {
        db.close();
        reject(cur.error);
      };
    });
  });
}

function tmLibGetFull(id) {
  return tmIdbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(TM_IDB_STORE, "readonly");
      var req = tx.objectStore(TM_IDB_STORE).get(id);
      req.onsuccess = function () {
        db.close();
        resolve(req.result || null);
      };
      req.onerror = function () {
        db.close();
        reject(req.error);
      };
    });
  });
}

function tmLibDelete(id) {
  return tmIdbOpen().then(function (db) {
    return new Promise(function (resolve, reject) {
      var tx = db.transaction(TM_IDB_STORE, "readwrite");
      tx.objectStore(TM_IDB_STORE).delete(id);
      tx.oncomplete = function () {
        db.close();
        resolve();
      };
      tx.onerror = function () {
        db.close();
        reject(tx.error);
      };
    });
  });
}

function tmLibraryRenderList() {
  var ul = document.getElementById("tmLibraryList");
  if (!ul) return;
  tmLibGetAllMeta()
    .then(function (items) {
      if (items.length === 0) {
        ul.innerHTML =
          '<li class="tm-library__empty">Henüz PDF yok. «PDF ekle» ile yükleyin.</li>';
        return;
      }
      ul.innerHTML = items
        .map(function (it) {
          var active = it.id === tmActiveLibId ? " is-active" : "";
          return (
            '<li class="tm-library__item' +
            active +
            '" data-lib-id="' +
            escapeHtml(it.id) +
            '" title="' +
            escapeHtml(it.name) +
            '">' +
            '<span class="tm-library__item-name">' +
            escapeHtml(it.name) +
            '</span>' +
            '<button type="button" class="tm-library__item-del" data-lib-del="' +
            escapeHtml(it.id) +
            '" aria-label="Sil"><i class="fa-solid fa-trash"></i></button></li>'
          );
        })
        .join("");
    })
    .catch(function (e) {
      console.error(e);
      ul.innerHTML = '<li class="tm-library__empty">Kitaplık okunamadı.</li>';
    });
}

function tmRenumberTmQuestions() {
  var paper = document.getElementById("tmA4Paper");
  var order = [];
  if (paper && paper.classList.contains("tm-template-osym")) {
    document.querySelectorAll("#column-1 .tm-a4-block").forEach(function (el) {
      order.push(el);
    });
    document.querySelectorAll("#column-2 .tm-a4-block").forEach(function (el) {
      order.push(el);
    });
  } else {
    document.querySelectorAll("#tmA4Single .tm-a4-block").forEach(function (el) {
      order.push(el);
    });
  }
  order.forEach(function (el, idx) {
    var b = el.querySelector(".tm-q-badge");
    if (b) b.textContent = "Soru " + (idx + 1) + ")";
  });
}

function tmUpdateA4EmptyVisibility() {
  var n = document.querySelectorAll("#tmA4Layout .tm-a4-block").length;
  var empty = document.getElementById("tmA4Empty");
  var dual = document.getElementById("testContentArea");
  var single = document.getElementById("tmA4Single");
  var paper = document.getElementById("tmA4Paper");
  if (!empty || !dual || !single || !paper) return;
  if (n === 0) {
    empty.style.display = "flex";
    dual.hidden = true;
    single.hidden = true;
    return;
  }
  empty.style.display = "none";
  if (paper.classList.contains("tm-template-osym")) {
    dual.hidden = false;
    single.hidden = true;
  } else {
    dual.hidden = true;
    single.hidden = false;
  }
}

function tmCollectBlocksFromCurrent(mode) {
  var blocks = [];
  if (mode === "osym") {
    blocks = Array.prototype.slice.call(document.querySelectorAll("#column-1 .tm-a4-block")).concat(
      Array.prototype.slice.call(document.querySelectorAll("#column-2 .tm-a4-block"))
    );
  } else {
    blocks = Array.prototype.slice.call(document.querySelectorAll("#tmA4Single .tm-a4-block"));
  }
  return blocks;
}

function tmMigrateLayoutForTemplate(fromMode, toMode) {
  var blocks = tmCollectBlocksFromCurrent(fromMode);
  var L = document.getElementById("column-1");
  var R = document.getElementById("column-2");
  var S = document.getElementById("tmA4Single");
  if (!L || !R || !S) return;
  L.innerHTML = "";
  R.innerHTML = "";
  S.innerHTML = "";
  blocks.forEach(function (b) {
    b.remove();
  });
  if (toMode === "osym") {
    var mid = Math.ceil(blocks.length / 2);
    blocks.forEach(function (b, i) {
      (i < mid ? L : R).appendChild(b);
    });
  } else {
    blocks.forEach(function (b) {
      S.appendChild(b);
    });
  }
  tmUpdateA4EmptyVisibility();
}

function tmGetAppendParent() {
  var paper = document.getElementById("tmA4Paper");
  var empty = document.getElementById("tmA4Empty");
  var dual = document.getElementById("testContentArea");
  var single = document.getElementById("tmA4Single");
  if (!paper || !empty || !dual || !single) return null;
  empty.style.display = "none";
  if (paper.classList.contains("tm-template-osym")) {
    dual.hidden = false;
    single.hidden = true;
    var c1 = document.getElementById("column-1");
    var c2 = document.getElementById("column-2");
    if (!c1 || !c2) return c1;
    var mm = 96 / 25.4;
    var maxColPx = Math.round(248 * mm);
    if (c1.scrollHeight < maxColPx) return c1;
    if (c2.scrollHeight < maxColPx) return c2;
    return c1.scrollHeight <= c2.scrollHeight ? c1 : c2;
  }
  dual.hidden = true;
  single.hidden = false;
  return single;
}

var TM_COLOR_PRESETS = {
  yks: { swatches: ["#1a1a1a", "#374151", "#0f172a", "#1e40af", "#991b1b"], def: "#1a1a1a" },
  pastel: { swatches: ["#B3E5FC", "#C8E6C9", "#F8BBD0", "#81D4FA", "#A5D6A7"], def: "#0288D1" },
  vivid: { swatches: ["#673AB7", "#00BCD4", "#FF5722", "#E91E63", "#FFC107"], def: "#673AB7" },
};

function tmNormalizeHex(h) {
  h = String(h || "").trim();
  if (!h) return null;
  if (h[0] !== "#") h = "#" + h;
  if (h.length === 4)
    h = "#" + h[1] + h[1] + h[2] + h[2] + h[3] + h[3];
  return /^#[0-9A-Fa-f]{6}$/.test(h) ? h.toUpperCase() : null;
}

function tmHexToRgb(hex) {
  var x = tmNormalizeHex(hex);
  if (!x) return null;
  return {
    r: parseInt(x.slice(1, 3), 16),
    g: parseInt(x.slice(3, 5), 16),
    b: parseInt(x.slice(5, 7), 16),
  };
}

function tmRgbToHex(r, g, b) {
  return (
    "#" +
    [r, g, b]
      .map(function (n) {
        return Math.max(0, Math.min(255, Math.round(n)))
          .toString(16)
          .padStart(2, "0");
      })
      .join("")
      .toUpperCase()
  );
}

function tmHsvToRgb(h, s, v) {
  s /= 100;
  v /= 100;
  var c = v * s;
  var x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  var m = v - c;
  var rp = 0,
    gp = 0,
    bp = 0;
  if (h < 60) {
    rp = c;
    gp = x;
  } else if (h < 120) {
    rp = x;
    gp = c;
  } else if (h < 180) {
    gp = c;
    bp = x;
  } else if (h < 240) {
    gp = x;
    bp = c;
  } else if (h < 300) {
    rp = x;
    bp = c;
  } else {
    rp = c;
    bp = x;
  }
  return {
    r: Math.round((rp + m) * 255),
    g: Math.round((gp + m) * 255),
    b: Math.round((bp + m) * 255),
  };
}

function tmRgbToHsv(r, g, b) {
  r /= 255;
  g /= 255;
  b /= 255;
  var max = Math.max(r, g, b);
  var min = Math.min(r, g, b);
  var d = max - min;
  var h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  var s = max === 0 ? 0 : (d / max) * 100;
  var v = max * 100;
  return { h: h, s: s, v: v };
}

function tmApplyAccentHex(hex) {
  var x = tmNormalizeHex(hex);
  if (!x) return;
  var rgb = tmHexToRgb(x);
  if (!rgb) return;
  var paper = document.getElementById("tmA4Paper");
  if (paper) {
    paper.style.setProperty("--tm-accent", x);
    paper.style.setProperty("--tm-accent-rgb", rgb.r + "," + rgb.g + "," + rgb.b);
  }
  document.documentElement.style.setProperty("--tm-studio-accent", x);
}

function tmSyncColorInputsFromHex(hex) {
  var x = tmNormalizeHex(hex);
  if (!x) return;
  var rgb = tmHexToRgb(x);
  if (!rgb) return;
  var hsv = tmRgbToHsv(rgb.r, rgb.g, rgb.b);
  tmHue = hsv.h;
  tmSat = hsv.s;
  tmVal = hsv.v;
  var hi = document.getElementById("tmColorHex");
  var ri = document.getElementById("tmColorR");
  var gi = document.getElementById("tmColorG");
  var bi = document.getElementById("tmColorB");
  if (hi) hi.value = x;
  if (ri) ri.value = String(rgb.r);
  if (gi) gi.value = String(rgb.g);
  if (bi) bi.value = String(rgb.b);
}

function tmDrawHueWheel() {
  var c = document.getElementById("tmHueWheel");
  if (!c) return;
  var ctx = c.getContext("2d");
  var w = c.width;
  var h = c.height;
  var cx = w / 2;
  var cy = h / 2;
  var rOut = Math.min(cx, cy) - 2;
  var rIn = rOut * 0.55;
  ctx.clearRect(0, 0, w, h);
  for (var ang = 0; ang < 360; ang += 1) {
    ctx.beginPath();
    ctx.strokeStyle = "hsl(" + ang + ",100%,50%)";
    ctx.lineWidth = rOut - rIn + 1;
    ctx.arc(cx, cy, (rOut + rIn) / 2, ((ang - 1) * Math.PI) / 180, (ang * Math.PI) / 180);
    ctx.stroke();
  }
  var mr = 6;
  var rad = ((tmHue - 90) * Math.PI) / 180;
  var pr = (rOut + rIn) / 2;
  ctx.beginPath();
  ctx.fillStyle = "#fff";
  ctx.arc(cx + Math.cos(rad) * pr, cy + Math.sin(rad) * pr, mr, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#222";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function tmDrawSatVal() {
  var c = document.getElementById("tmSatVal");
  if (!c) return;
  var ctx = c.getContext("2d");
  var w = c.width;
  var h = c.height;
  var img = ctx.createImageData(w, h);
  var hu = tmHue;
  for (var y = 0; y < h; y++) {
    for (var x = 0; x < w; x++) {
      var s = (x / w) * 100;
      var v = (1 - y / h) * 100;
      var rgb = tmHsvToRgb(hu, s, v);
      var i = (y * w + x) * 4;
      img.data[i] = rgb.r;
      img.data[i + 1] = rgb.g;
      img.data[i + 2] = rgb.b;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  var px = (tmSat / 100) * w;
  var py = (1 - tmVal / 100) * h;
  ctx.beginPath();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.arc(px, py, 5, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "#000";
  ctx.lineWidth = 1;
  ctx.stroke();
}

function tmUpdateCompSwatches() {
  var box = document.getElementById("tmCompSwatches");
  if (!box) return;
  var hex = document.getElementById("tmColorHex");
  var x = hex && tmNormalizeHex(hex.value);
  if (!x) return;
  var rgb = tmHexToRgb(x);
  if (!rgb) return;
  var hsv = tmRgbToHsv(rgb.r, rgb.g, rgb.b);
  var comps = [
    tmRgbToHex.apply(null, Object.values(tmHsvToRgb((hsv.h + 180) % 360, hsv.s, hsv.v))),
    tmRgbToHex.apply(null, Object.values(tmHsvToRgb((hsv.h + 120) % 360, hsv.s, hsv.v))),
    tmRgbToHex.apply(null, Object.values(tmHsvToRgb((hsv.h + 240) % 360, hsv.s, hsv.v))),
    tmRgbToHex.apply(null, Object.values(tmHsvToRgb((hsv.h + 30) % 360, Math.min(100, hsv.s + 15), Math.min(100, hsv.v + 10)))),
  ];
  box.innerHTML = "";
  comps.forEach(function (ch) {
    var b = document.createElement("button");
    b.type = "button";
    b.className = "tm-comp-swatch";
    b.style.background = ch;
    b.title = ch;
    b.addEventListener("click", function () {
      tmApplyAccentHex(ch);
      tmSyncColorInputsFromHex(ch);
      tmDrawHueWheel();
      tmDrawSatVal();
      tmUpdateCompSwatches();
    });
    box.appendChild(b);
  });
}

function tmApplyHsvToAccent() {
  var rgb = tmHsvToRgb(tmHue, tmSat, tmVal);
  var hex = tmRgbToHex(rgb.r, rgb.g, rgb.b);
  tmApplyAccentHex(hex);
  tmSyncColorInputsFromHex(hex);
  tmDrawHueWheel();
  tmUpdateCompSwatches();
}

function initTmColorStudio() {
  if (tmColorStudioBound) return;
  var preset = document.getElementById("tmColorPreset");
  var grid = document.getElementById("tmSwatchGrid");
  var wheel = document.getElementById("tmHueWheel");
  var sat = document.getElementById("tmSatVal");
  if (!preset || !grid || !wheel || !sat) return;
  tmColorStudioBound = true;

  function refillSwatches() {
    var key = preset.value || "yks";
    var p = TM_COLOR_PRESETS[key] || TM_COLOR_PRESETS.yks;
    grid.innerHTML = "";
    p.swatches.forEach(function (col) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tm-swatch";
      btn.style.background = col;
      btn.title = col;
      btn.addEventListener("click", function () {
        grid.querySelectorAll(".tm-swatch").forEach(function (x) {
          x.classList.remove("is-active");
        });
        btn.classList.add("is-active");
        tmApplyAccentHex(col);
        tmSyncColorInputsFromHex(col);
        tmDrawHueWheel();
        tmDrawSatVal();
        tmUpdateCompSwatches();
      });
      grid.appendChild(btn);
    });
    tmApplyAccentHex(p.def);
    tmSyncColorInputsFromHex(p.def);
    tmDrawHueWheel();
    tmDrawSatVal();
    tmUpdateCompSwatches();
    var first = grid.querySelector(".tm-swatch");
    if (first) first.classList.add("is-active");
  }

  preset.addEventListener("change", refillSwatches);

  function wheelPick(e) {
    var rect = wheel.getBoundingClientRect();
    var cx = rect.left + rect.width / 2;
    var cy = rect.top + rect.height / 2;
    var dx = e.clientX - cx;
    var dy = e.clientY - cy;
    var dist = Math.sqrt(dx * dx + dy * dy);
    var rOut = Math.min(rect.width, rect.height) / 2 - 2;
    var rIn = rOut * 0.55;
    if (dist >= rIn && dist <= rOut + 8) {
      tmHue = (Math.round((Math.atan2(dy, dx) * 180) / Math.PI) + 450) % 360;
      tmApplyHsvToAccent();
      tmDrawSatVal();
    }
  }
  wheel.addEventListener("mousedown", function (e) {
    wheelPick(e);
    function mm(ev) {
      wheelPick(ev);
    }
    function mu() {
      document.removeEventListener("mousemove", mm);
      document.removeEventListener("mouseup", mu);
    }
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });

  function svPick(e) {
    var rect = sat.getBoundingClientRect();
    tmSat = Math.max(0, Math.min(100, ((e.clientX - rect.left) / rect.width) * 100));
    tmVal = Math.max(0, Math.min(100, (1 - (e.clientY - rect.top) / rect.height) * 100));
    tmApplyHsvToAccent();
    tmDrawSatVal();
  }
  sat.addEventListener("mousedown", function (e) {
    svPick(e);
    function mm(ev) {
      svPick(ev);
    }
    function mu() {
      document.removeEventListener("mousemove", mm);
      document.removeEventListener("mouseup", mu);
    }
    document.addEventListener("mousemove", mm);
    document.addEventListener("mouseup", mu);
  });

  document.getElementById("tmColorHex").addEventListener("change", function () {
    var x = tmNormalizeHex(document.getElementById("tmColorHex").value);
    if (x) {
      tmApplyAccentHex(x);
      tmSyncColorInputsFromHex(x);
      tmDrawHueWheel();
      tmDrawSatVal();
      tmUpdateCompSwatches();
    }
  });
  ["tmColorR", "tmColorG", "tmColorB"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el)
      el.addEventListener("change", function () {
        var r = parseInt(document.getElementById("tmColorR").value, 10) || 0;
        var g = parseInt(document.getElementById("tmColorG").value, 10) || 0;
        var b = parseInt(document.getElementById("tmColorB").value, 10) || 0;
        var hex = tmRgbToHex(r, g, b);
        tmApplyAccentHex(hex);
        tmSyncColorInputsFromHex(hex);
        tmDrawHueWheel();
        tmDrawSatVal();
        tmUpdateCompSwatches();
      });
  });

  refillSwatches();
}

let apptCarouselOffset = 0;
let randevuChartInstance = null;
let netBasariChartInstance = null;
let examTypeFilter = "all";
let examsPageFilter = "all";
let searchQuery = "";
const navigateCallbacks = [];

let currentView = "dashboard";

function clearFirestoreListeners() {
  firestoreUnsubs.forEach(function (unsub) {
    try {
      unsub();
    } catch (e) {}
  });
  firestoreUnsubs = [];
}

function escapeHtml(text) {
  if (text == null || text === undefined) return "";
  const div = document.createElement("div");
  div.textContent = String(text);
  return div.innerHTML;
}

function toDate(value) {
  if (!value) return null;
  if (value instanceof Timestamp) return value.toDate();
  if (typeof value.toDate === "function") return value.toDate();
  if (value.seconds) return new Date(value.seconds * 1000);
  if (typeof value === "string") {
    const d = new Date(value);
    if (!isNaN(d.getTime())) return d;
    const parts = value.split(/[./]/);
    if (parts.length === 3) {
      return new Date(parseInt(parts[2], 10), parseInt(parts[1], 10) - 1, parseInt(parts[0], 10));
    }
  }
  return null;
}

function appointmentSortTime(data) {
  const d = toDate(data.scheduledAt) || toDate(data.date);
  if (d && data.time && typeof data.time === "string") {
    const m = data.time.match(/(\d{1,2})[.:](\d{2})/);
    if (m) d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
  }
  return d ? d.getTime() : 0;
}

function formatAppointmentMeta(data) {
  const d = toDate(data.scheduledAt) || toDate(data.date);
  const timeStr =
    data.time ||
    (d && !isNaN(d.getTime())
      ? String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0")
      : "");
  if (d && !isNaN(d.getTime())) {
    return d.toLocaleDateString("tr-TR", { day: "numeric", month: "long", year: "numeric" }) + (timeStr ? " · " + timeStr : "");
  }
  return (data.date || "") + (data.time ? " · " + data.time : "") || "Tarih belirtilmedi";
}

function buildAppointmentList(docs) {
  return docs
    .map(function (docSnap) {
      return { ...docSnap.data(), id: docSnap.id };
    })
    .sort(function (a, b) {
      return appointmentSortTime(a) - appointmentSortTime(b);
    })
    .filter(function (x) {
      const t = appointmentSortTime(x);
      return t >= Date.now() - 86400000 || t === 0;
    });
}

function appointmentCardHtml(ap) {
  const name = ap.studentName || ap.ogrenciAdi || ap.name || "Öğrenci";
  const title = ap.title || ap.type || ap.note || "Randevu";
  const id = escapeHtml(ap.id);
  return (
    '<article class="appt-card">' +
    '<div class="appt-card__top">' +
    '<div class="appt-card__icon"><i class="fa-solid fa-bell"></i></div>' +
    '<div class="appt-card__body">' +
    '<p class="appt-card__meta">' +
    escapeHtml(formatAppointmentMeta(ap)) +
    "</p>" +
    '<h3 class="appt-card__student">' +
    escapeHtml(name) +
    "</h3>" +
    '<p class="appt-card__type">' +
    escapeHtml(title) +
    '</p></div></div><div class="appt-card__crud">' +
    '<button type="button" class="btn-crud btn-crud--edit" data-edit-appt="' +
    id +
    '"><i class="fa-solid fa-pen"></i> Düzenle</button>' +
    '<button type="button" class="btn-crud btn-crud--del" data-del-appt="' +
    id +
    '"><i class="fa-solid fa-trash"></i> Sil</button></div></article>'
  );
}

function filterApptsBySearch(list) {
  const q = searchQuery.trim().toLowerCase();
  if (!q) return list;
  return list.filter(function (ap) {
    const name = (ap.studentName || ap.ogrenciAdi || ap.name || "") + " " + (ap.title || ap.type || "");
    return name.toLowerCase().indexOf(q) !== -1;
  });
}

function renderDashboardAppointments() {
  const row = document.getElementById("appointmentsRow");
  if (!row) return;
  const filtered = filterApptsBySearch(cachedAppointments);
  const n = filtered.length;
  if (apptCarouselOffset >= n) apptCarouselOffset = Math.max(0, n - 3);
  if (apptCarouselOffset < 0) apptCarouselOffset = 0;
  const top = filtered.slice(apptCarouselOffset, apptCarouselOffset + 3);

  if (top.length === 0) {
    row.innerHTML =
      '<p class="empty-hint"><i class="fa-solid fa-calendar-xmark"></i> Randevu yok veya aramanızla eşleşmedi.</p>';
  } else {
    row.innerHTML = top.map(appointmentCardHtml).join("");
  }
  const prev = document.getElementById("btnApptPrev");
  const next = document.getElementById("btnApptNext");
  if (prev) prev.disabled = apptCarouselOffset <= 0;
  if (next) next.disabled = apptCarouselOffset + 3 >= filtered.length;
}

function examDateSort(data) {
  const d = toDate(data.examDate) || toDate(data.date) || toDate(data.createdAt);
  return d ? d.getTime() : 0;
}

function examMatchesFilters(row) {
  const tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
  if (examTypeFilter === "TYT" && tur !== "TYT") return false;
  if (examTypeFilter === "AYT" && tur !== "AYT") return false;
  const q = searchQuery.trim().toLowerCase();
  if (q) {
    const blob =
      (row.studentName || row.ogrenciAdi || row.name || "") +
      " " +
      tur +
      " " +
      (row.status || row.durum || "");
    if (blob.toLowerCase().indexOf(q) === -1) return false;
  }
  return true;
}

function examRowHtml(row, colspan) {
  const ogrenci = row.studentName || row.ogrenciAdi || row.name || "—";
  const tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
  const badgeClass = tur === "TYT" ? "badge-tyt" : "badge-ayt";
  const net = row.net != null ? String(row.net) : "—";
  const d = toDate(row.examDate) || toDate(row.date);
  const tarih = d && !isNaN(d.getTime()) ? d.toLocaleDateString("tr-TR") : String(row.date || "—");
  const durum = row.status || row.durum || "—";
  const isOk = /tamamlandı|rapor|hazır/i.test(durum) || row.analyzed === true;
  const statusHtml = isOk
    ? '<span class="status-ok"><i class="fa-solid fa-circle-check"></i> ' + escapeHtml(durum) + "</span>"
    : escapeHtml(durum);
  const eid = escapeHtml(row.id);
  const actions =
    '<span class="crud-cell">' +
    '<button type="button" class="btn-crud btn-crud--edit" data-edit-exam="' +
    eid +
    '"><i class="fa-solid fa-pen"></i> Düzenle</button>' +
    '<button type="button" class="btn-crud btn-crud--del" data-del-exam="' +
    eid +
    '"><i class="fa-solid fa-trash"></i> Sil</button></span>';
  return (
    "<tr data-exam-id=\"" +
    eid +
    "\"><td><strong>" +
    escapeHtml(ogrenci) +
    "</strong></td><td><span class=\"" +
    badgeClass +
    "\">" +
    escapeHtml(tur === "AYT" ? "AYT" : "TYT") +
    "</span></td><td>" +
    escapeHtml(net) +
    " net</td><td>" +
    escapeHtml(tarih) +
    "</td><td>" +
    statusHtml +
    "</td><td>" +
    actions +
    "</td></tr>"
  );
}

function renderDashboardExams() {
  const tbody = document.getElementById("denemeTableBody");
  if (!tbody) return;
  const plain = cachedExams.slice().sort(function (a, b) {
    return examDateSort(b) - examDateSort(a);
  });
  const filtered = plain.filter(examMatchesFilters);
  const slice = filtered.slice(0, 15);
  if (slice.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="6" class="table-empty">Kayıt yok veya filtreye uymuyor.</td></tr>';
    return;
  }
  tbody.innerHTML = slice.map(function (row) {
    return examRowHtml(row, 6);
  }).join("");
}

function renderExamsFullPage() {
  const tbody = document.getElementById("examsPageBody");
  if (!tbody) return;
  const plain = cachedExams.slice().sort(function (a, b) {
    return examDateSort(b) - examDateSort(a);
  });
  let filtered = plain;
  if (examsPageFilter === "TYT") filtered = plain.filter(function (r) {
    return (r.examType || r.type || r.tur || "TYT").toUpperCase() === "TYT";
  });
  else if (examsPageFilter === "AYT") filtered = plain.filter(function (r) {
    return (r.examType || r.type || r.tur || "").toUpperCase() === "AYT";
  });
  if (filtered.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Deneme kaydı yok.</td></tr>';
    return;
  }
  tbody.innerHTML = filtered
    .map(function (row) {
      const ogrenci = row.studentName || row.ogrenciAdi || row.name || "—";
      const tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
      const badgeClass = tur === "TYT" ? "badge-tyt" : "badge-ayt";
      const net = row.net != null ? String(row.net) : "—";
      const d = toDate(row.examDate) || toDate(row.date);
      const tarih = d && !isNaN(d.getTime()) ? d.toLocaleDateString("tr-TR") : "—";
      const durum = row.status || row.durum || "—";
      const eid = escapeHtml(row.id);
      const actions =
        '<span class="crud-cell">' +
        '<button type="button" class="btn-crud btn-crud--edit" data-edit-exam="' +
        eid +
        '"><i class="fa-solid fa-pen"></i> Düzenle</button>' +
        '<button type="button" class="btn-crud btn-crud--del" data-del-exam="' +
        eid +
        '"><i class="fa-solid fa-trash"></i> Sil</button></span>';
      return (
        "<tr><td><strong>" +
        escapeHtml(ogrenci) +
        "</strong></td><td><span class=\"" +
        badgeClass +
        "\">" +
        escapeHtml(tur) +
        "</span></td><td>" +
        escapeHtml(net) +
        "</td><td>" +
        escapeHtml(tarih) +
        "</td><td>" +
        escapeHtml(durum) +
        "</td><td>" +
        actions +
        "</td></tr>"
      );
    })
    .join("");
}

function renderStudentsPage() {
  const grid = document.getElementById("studentsPageGrid");
  if (!grid) return;
  if (cachedStudents.length === 0) {
    grid.innerHTML = '<p class="page-desc">Henüz öğrenci yok. <strong>Yeni Öğrenci</strong> ile ekleyin.</p>';
    return;
  }
  grid.innerHTML = cachedStudents
    .map(function (s) {
      const name = s.name || s.studentName || "Öğrenci";
      var rawAv = s.avatarUrl;
      var src =
        rawAv && /^https?:\/\//i.test(String(rawAv).trim())
          ? String(rawAv).trim().replace(/"/g, "")
          : buildStudentAvatarUrl(name, s.gender);
      const track = s.examGroup || s.track || s.paket || "TYT + AYT";
      const sid = escapeHtml(s.id);
      return (
        '<div class="student-card">' +
        '<img src="' +
        src +
        '" alt="" width="64" height="64" loading="lazy" />' +
        "<h3>" +
        escapeHtml(name) +
        "</h3>" +
        "<p>" +
        escapeHtml(track) +
        '</p><div class="student-card__crud">' +
        '<button type="button" class="btn-crud btn-crud--edit" data-edit-student="' +
        sid +
        '"><i class="fa-solid fa-pen"></i> Düzenle</button>' +
        '<button type="button" class="btn-crud btn-crud--del" data-del-student="' +
        sid +
        '"><i class="fa-solid fa-trash"></i> Sil</button></div></div>'
      );
    })
    .join("");
}

function renderAppointmentsPage() {
  const row = document.getElementById("appointmentsPageRow");
  if (!row) return;
  const list = cachedAppointments;
  if (list.length === 0) {
    row.innerHTML = '<p class="empty-hint">Randevu kaydı yok.</p>';
    return;
  }
  row.innerHTML = list.map(appointmentCardHtml).join("");
}

const WEEK_LABELS = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
const RANDEVU_GUN_ADLARI_TR = [
  "Pazartesi",
  "Salı",
  "Çarşamba",
  "Perşembe",
  "Cuma",
  "Cumartesi",
  "Pazar",
];

function getCalendarWeekStart(d) {
  var weekStart = new Date(d);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  return weekStart;
}

function countAppointmentsThisWeek() {
  var weekStart = getCalendarWeekStart(new Date());
  var weekEnd = weekStart.getTime() + 7 * 86400000;
  var n = 0;
  cachedAppointments.forEach(function (ap) {
    var t = appointmentSortTime(ap);
    if (!t) return;
    var dt = new Date(t).getTime();
    if (dt >= weekStart.getTime() && dt < weekEnd) n++;
  });
  return n;
}

/** Firestore randevu dokümanları — haftalık günlük sütun grafiği (Chart.js) */
function renderAppointmentsChart(docs) {
  var canvas = document.getElementById("randevuChart");
  if (!canvas || typeof Chart === "undefined") return;
  var ctx = canvas.getContext("2d");
  var counts = [0, 0, 0, 0, 0, 0, 0];
  var weekStart = getCalendarWeekStart(new Date());
  var weekEnd = weekStart.getTime() + 7 * 86400000;
  docs.forEach(function (docSnap) {
    var ap = docSnap.data();
    var t = appointmentSortTime(ap);
    if (!t) return;
    var dt = new Date(t).getTime();
    if (dt < weekStart.getTime() || dt >= weekEnd) return;
    var diff = Math.floor((dt - weekStart.getTime()) / 86400000);
    if (diff >= 0 && diff < 7) counts[diff]++;
  });
  if (randevuChartInstance) {
    randevuChartInstance.destroy();
    randevuChartInstance = null;
  }
  randevuChartInstance = new Chart(ctx, {
    type: "bar",
    data: {
      labels: WEEK_LABELS.slice(),
      datasets: [
        {
          label: "Randevu",
          data: counts,
          backgroundColor: "rgba(124, 58, 237, 0.88)",
          hoverBackgroundColor: "rgba(109, 40, 217, 0.95)",
          borderRadius: 10,
          borderSkipped: false,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          displayColors: false,
          callbacks: {
            title: function () {
              return "";
            },
            label: function (item) {
              var i = item.dataIndex;
              return RANDEVU_GUN_ADLARI_TR[i] + ": " + item.raw + " Randevu";
            },
          },
        },
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { font: { size: 11, weight: "600" }, color: "#64748b" },
        },
        y: {
          beginAtZero: true,
          ticks: { stepSize: 1, precision: 0, color: "#64748b" },
          grid: { color: "rgba(124, 58, 237, 0.06)" },
        },
      },
    },
  });
}

function computeAvgNetAchievementPct() {
  var pcts = [];
  cachedStudents.forEach(function (s) {
    var cur = parseFloat(String(s.currentTytNet != null ? s.currentTytNet : "").replace(",", "."), 10);
    var tgt = parseFloat(String(s.targetTytNet != null ? s.targetTytNet : "").replace(",", "."), 10);
    if (isNaN(cur) || isNaN(tgt) || tgt <= 0) return;
    pcts.push(Math.min(100, Math.round((cur / tgt) * 100)));
  });
  if (pcts.length === 0) return null;
  return Math.round(pcts.reduce(function (a, b) {
    return a + b;
  }, 0) / pcts.length);
}

function renderDashboardKpis() {
  var elS = document.getElementById("kpiActiveStudents");
  var elA = document.getElementById("kpiWeekAppointments");
  var elN = document.getElementById("kpiAvgTytNet");
  var elE = document.getElementById("kpiExamCount");
  if (!elS || !elA || !elN || !elE) return;
  var active = cachedStudents.filter(function (s) {
    return (s.status || "Aktif") !== "Pasif";
  }).length;
  elS.textContent = String(active);
  elA.textContent = String(countAppointmentsThisWeek());
  var tytExams = cachedExams.filter(function (e) {
    var x = String(e.examType || e.type || e.tur || "")
      .toUpperCase()
      .trim();
    return x === "TYT" || x.indexOf("TYT") === 0;
  });
  var sum = 0;
  var c = 0;
  tytExams.forEach(function (e) {
    if (e.net == null || e.net === "") return;
    var v = parseFloat(String(e.net).replace(",", "."), 10);
    if (!isNaN(v)) {
      sum += v;
      c++;
    }
  });
  if (c === 0) {
    cachedStudents.forEach(function (s) {
      if (s.currentTytNet == null || s.currentTytNet === "") return;
      var v = parseFloat(String(s.currentTytNet).replace(",", "."), 10);
      if (!isNaN(v)) {
        sum += v;
        c++;
      }
    });
  }
  elN.textContent = c > 0 ? (sum / c).toFixed(1) : "—";
  elE.textContent = String(cachedExams.length);
  var insight = document.getElementById("dashboardInsightText");
  if (insight) {
    var pct = computeAvgNetAchievementPct();
    var parts = [];
    if (pct != null)
      parts.push(
        "Öğrenci kayıtlarına göre ortalama <strong>%" +
          pct +
          "</strong> hedef net düzeyine yaklaşım görülüyor."
      );
    else
      parts.push(
        "Net hedef grafiği için öğrencilerde <strong>güncel net</strong> ve <strong>hedef net</strong> alanlarını doldurun."
      );
    parts.push(
      " Bu hafta <strong>" +
        countAppointmentsThisWeek() +
        "</strong> randevu; panelde <strong>" +
        cachedExams.length +
        "</strong> deneme kaydı."
    );
    insight.innerHTML = parts.join("");
  }
}

function renderNetBasariChart() {
  var canvas = document.getElementById("netBasariChart");
  var pctEl = document.getElementById("netBasariPct");
  if (!canvas || typeof Chart === "undefined") return;
  var pct = computeAvgNetAchievementPct();
  if (netBasariChartInstance) {
    netBasariChartInstance.destroy();
    netBasariChartInstance = null;
  }
  if (pctEl) pctEl.textContent = pct != null ? pct + "%" : "—";
  var ctx = canvas.getContext("2d");
  if (pct == null) {
    netBasariChartInstance = new Chart(ctx, {
      type: "doughnut",
      data: {
        datasets: [
          {
            data: [1],
            backgroundColor: ["#e2e8f0"],
            borderWidth: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: "70%",
        plugins: { legend: { display: false }, tooltip: { enabled: false } },
      },
    });
    return;
  }
  var kalan = Math.max(0, 100 - pct);
  netBasariChartInstance = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Hedefe ulaşma", "Kalan"],
      datasets: [
        {
          data: [pct, kalan],
          backgroundColor: ["#7c3aed", "#ede9fe"],
          borderWidth: 0,
          hoverBackgroundColor: ["#6d28d9", "#ddd6fe"],
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: "70%",
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (item) {
              return item.label + ": %" + item.raw;
            },
          },
        },
      },
    },
  });
}

function refreshDashboardAnalytics() {
  renderDashboardKpis();
  renderNetBasariChart();
}

function renderStudentsList(docs) {
  const list = document.getElementById("activeStudentsList");
  const countEl = document.getElementById("activeStudentCount");
  if (countEl) countEl.textContent = String(cachedStudents.length);
  if (!list) return;
  const top = docs.slice(0, 5);
  if (top.length === 0) {
    list.innerHTML = '<li class="mini-list__empty">Öğrenci yok.</li>';
    return;
  }
  list.innerHTML = top
    .map(function (docSnap) {
      const s = docSnap.data ? docSnap.data() : docSnap;
      const name = s.name || s.studentName || "Öğrenci";
      var rawAv2 = s.avatarUrl;
      var img =
        rawAv2 && /^https?:\/\//i.test(String(rawAv2).trim())
          ? String(rawAv2).trim().replace(/"/g, "")
          : buildStudentAvatarUrl(name, s.gender);
      const track = s.examGroup || s.track || s.paket || "TYT + AYT";
      return (
        "<li><img src=\"" +
        img +
        '" alt="" width="36" height="36" loading="lazy" /><div class="mini-list__info"><div class="mini-list__name">' +
        escapeHtml(name) +
        '</div><div class="mini-list__role">' +
        escapeHtml(track) +
        '</div></div><span class="mini-follow mini-follow--static">Aktif</span></li>'
      );
    })
    .join("");
}

function updateCoachProfile() {
  const greet = document.querySelector(".profile-card__greet");
  if (greet) {
    const h = new Date().getHours();
    const part = h < 12 ? "Günaydın" : h < 18 ? "İyi günler" : "İyi akşamlar";
    greet.innerHTML = part + ", <strong>Koç</strong>";
  }
}

function firestoreErrorHtml(err) {
  const code = err && err.code ? String(err.code) : "";
  if (code === "permission-denied")
    return "<strong>Erişim reddedildi.</strong> Firestore Rules kontrol edin.";
  return escapeHtml((err && err.message) || code || "Hata");
}

function onAppointmentsSnap(snap) {
  cachedAppointments = buildAppointmentList(snap.docs);
  apptCarouselOffset = 0;
  renderDashboardAppointments();
  renderAppointmentsChart(snap.docs);
  renderAppointmentsPage();
  refreshDashboardAnalytics();
}

function onExamsSnap(snap) {
  cachedExams = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderDashboardExams();
  renderExamsFullPage();
  refreshDashboardAnalytics();
}

function onStudentsSnap(snap) {
  cachedStudents = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderStudentsList(snap.docs);
  renderStudentsPage();
  fillStudentSelects();
  refreshDashboardAnalytics();
}

function onPaymentsSnap(snap) {
  cachedPayments = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderPaymentsTable();
  updateMuhasebeStats();
}

function onTestsSnap(snap) {
  cachedTests = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderTestsTable();
}

function renderPaymentsTable() {
  var tbody = document.getElementById("paymentsTableBody");
  if (!tbody) return;
  if (cachedPayments.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Tahsilat kaydı yok.</td></tr>';
    return;
  }
  var sorted = cachedPayments.slice().sort(function (a, b) {
    var da = (b.paymentDate || "").localeCompare(a.paymentDate || "");
    return da || (b.createdAt && a.createdAt ? 0 : 0);
  });
  tbody.innerHTML = sorted
    .map(function (p) {
      var pid = escapeHtml(p.id);
      var amt = p.amount != null ? String(p.amount) : "—";
      return (
        "<tr><td>" +
        escapeHtml(p.studentName || "—") +
        "</td><td><strong>" +
        escapeHtml(amt) +
        "</strong></td><td>" +
        escapeHtml(p.paymentDate || "—") +
        "</td><td>" +
        escapeHtml(p.paymentMethod || "—") +
        '</td><td><span class="crud-cell">' +
        '<button type="button" class="btn-crud btn-crud--edit" data-edit-payment="' +
        pid +
        '"><i class="fa-solid fa-pen"></i> Düzenle</button>' +
        '<button type="button" class="btn-crud btn-crud--del" data-del-payment="' +
        pid +
        '"><i class="fa-solid fa-trash"></i> Sil</button></span></td></tr>'
      );
    })
    .join("");
}

function updateMuhasebeStats() {
  var now = new Date();
  var ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  var monthTotal = 0;
  cachedPayments.forEach(function (p) {
    var d = (p.paymentDate || "").slice(0, 7);
    if (d === ym) monthTotal += parseFloat(p.amount) || 0;
  });
  var inc = document.querySelector("#btnStatIncome .stat-card__val");
  if (inc) inc.textContent = monthTotal > 0 ? monthTotal.toLocaleString("tr-TR") + " ₺" : "—";
}

function renderTestsTable() {
  var tbody = document.getElementById("testsTableBody");
  if (!tbody) return;
  if (cachedTests.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Test kaydı yok.</td></tr>';
    return;
  }
  var sorted = cachedTests.slice().reverse();
  tbody.innerHTML = sorted
    .map(function (t) {
      var tid = escapeHtml(t.id);
      return (
        "<tr><td>" +
        escapeHtml(t.title || "—") +
        "</td><td>" +
        escapeHtml(t.subject || "—") +
        "</td><td>" +
        escapeHtml(t.questionCount != null ? String(t.questionCount) : "—") +
        "</td><td>" +
        escapeHtml(t.status || "—") +
        '</td><td><span class="crud-cell">' +
        '<button type="button" class="btn-crud btn-crud--edit" data-edit-test="' +
        tid +
        '"><i class="fa-solid fa-pen"></i> Düzenle</button>' +
        '<button type="button" class="btn-crud btn-crud--del" data-del-test="' +
        tid +
        '"><i class="fa-solid fa-trash"></i> Sil</button></span></td></tr>'
      );
    })
    .join("");
}

async function firestoreDeleteConfirmed(collectionName, docId) {
  if (!confirm("Bu kaydı silmek istediğinize emin misiniz?")) return;
  try {
    await deleteDoc(doc(db, collectionName, docId));
    showToast("Kayıt silindi.");
  } catch (err) {
    console.error(err);
    alert("Silinemedi: " + (err.message || err));
  }
}

/**
 * DiceBear 8.x — lokal dosya yok; sadece API URL.
 * Erkek: avataaars-neutral | Kadın: lorelei | Tesettür: avataaars + hijab
 */
function buildStudentAvatarUrl(fullName, gender) {
  var n = String(fullName || "ogrenci").trim();
  var seed = encodeURIComponent(n);
  var g = gender === "Kadın" || gender === "Kadin" ? "Kadın" : gender === "Tesettür" ? "Tesettür" : "Erkek";
  if (g === "Erkek") {
    return "https://api.dicebear.com/8.x/avataaars-neutral/svg?seed=" + seed;
  }
  if (g === "Kadın") {
    return "https://api.dicebear.com/8.x/lorelei/svg?seed=" + seed;
  }
  return "https://api.dicebear.com/8.x/avataaars/svg?seed=" + seed + "&top=hijab";
}

function setStudentErpTab(index) {
  var tabs = document.querySelectorAll("[data-student-tab]");
  var panels = document.querySelectorAll("[data-student-panel]");
  tabs.forEach(function (btn, i) {
    var on = i === index;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
  });
  panels.forEach(function (panel, i) {
    panel.hidden = i !== index;
  });
}

function initStudentErpTabs() {
  document.querySelectorAll("[data-student-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var i = parseInt(btn.getAttribute("data-student-tab"), 10);
      if (!isNaN(i)) setStudentErpTab(i);
    });
  });
}

function fillStudentSelects() {
  ["ap_student", "pay_student", "ex_student"].forEach(function (sid) {
    var sel = document.getElementById(sid);
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML =
      sid === "ap_student"
        ? '<option value="">— Öğrenci seçin —</option>'
        : '<option value="">— Seçin —</option>';
    cachedStudents.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name || s.studentName || "Öğrenci (" + s.id.slice(0, 6) + ")";
      sel.appendChild(o);
    });
    if (keep) sel.value = keep;
  });
}

/** Tek seferde yalnızca bir modal açık — HTML id'leri ile eşleşir */
var MODAL_IDS = ["studentModal", "appointmentModal", "testModal", "financeModal", "examModal"];

function closeAllModals() {
  var o = document.getElementById("modalOverlay");
  if (!o) return;
  var sm = document.getElementById("studentModal");
  if (sm && !sm.hidden) resetStudentModalPanes();
  MODAL_IDS.forEach(function (id) {
    var m = document.getElementById(id);
    if (m) m.hidden = true;
  });
  o.classList.remove("is-open");
  o.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

/** Öğrenci modalı: ekleme paneline dön */
function resetStudentModalPanes() {
  var addPane = document.getElementById("studentPaneAdd");
  var editPane = document.getElementById("studentPaneEdit");
  if (addPane) addPane.hidden = false;
  if (editPane) editPane.hidden = true;
  var fa = document.getElementById("formStudentAdd");
  if (fa) fa.reset();
}

/** Sadece bu modalı kapat; başka açık modal yoksa overlay'i de kapatır */
function closeModal(modalId) {
  var m = document.getElementById(modalId);
  var o = document.getElementById("modalOverlay");
  if (!m || !o) return;
  if (modalId === "studentModal") resetStudentModalPanes();
  m.hidden = true;
  var anyStillOpen = MODAL_IDS.some(function (id) {
    var el = document.getElementById(id);
    return el && !el.hidden;
  });
  if (!anyStillOpen) {
    o.classList.remove("is-open");
    o.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }
}

function openModal(modalId) {
  closeAllModals();
  var o = document.getElementById("modalOverlay");
  var m = document.getElementById(modalId);
  if (!o || !m) return;
  m.hidden = false;
  o.classList.add("is-open");
  o.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

function openStudentModal() {
  var form = document.getElementById("formStudentAdd");
  if (!form) return;
  resetStudentModalPanes();
  form.reset();
  setStudentErpTab(0);
  var sub = document.getElementById("modalStudentSubtitle");
  var title = document.getElementById("modalStudentTitle");
  var regDate = document.getElementById("st_registrationDate");
  if (sub) sub.textContent = "Sekmeler arasında gezerek tüm bilgileri doldurun.";
  if (title) title.innerHTML = '<i class="fa-solid fa-id-card"></i> Yeni öğrenci kaydı';
  if (regDate) regDate.value = new Date().toISOString().slice(0, 10);
  form.querySelectorAll('input[name="add_gender"]').forEach(function (r) {
    r.checked = r.value === "Erkek";
  });
  openModal("studentModal");
}

function editStudent(studentId) {
  var s = cachedStudents.find(function (x) {
    return x.id === studentId;
  });
  if (!s) {
    showToast("Öğrenci bulunamadı.");
    return;
  }
  var fn = s.firstName;
  var ln = s.lastName;
  if ((!fn || !ln) && s.name) {
    var parts = String(s.name).trim().split(/\s+/);
    fn = fn || parts[0] || "";
    ln = ln || parts.slice(1).join(" ") || "";
  }
  function ev(id, v) {
    var el = document.getElementById(id);
    if (!el) return;
    el.value = v != null && v !== undefined && v !== "" ? String(v) : "";
  }
  document.getElementById("editStudentDocId").value = studentId;
  document.getElementById("editStudentName").value = fn || "";
  document.getElementById("editStudentSurname").value = ln || "";
  ev("editTcKimlikNo", s.tcKimlikNo);
  ev("editSchoolName", s.schoolName);
  ev("editClassGrade", s.classGrade);
  ev("editExamGroup", s.examGroup != null && s.examGroup !== "" ? s.examGroup : s.track);
  ev("editFieldType", s.fieldType != null && s.fieldType !== "" ? s.fieldType : s.yksAlan);
  ev("editCurrentTytNet", s.currentTytNet);
  ev("editTargetTytNet", s.targetTytNet);
  ev("editParentFullName", s.parentFullName != null ? s.parentFullName : s.parentName);
  ev("editParentRelation", s.parentRelation);
  ev("editParentPhone", s.parentPhone != null ? s.parentPhone : s.phone);
  ev("editEmergencyContactName", s.emergencyContactName);
  var rd = s.registrationDate;
  var rdDt = rd && typeof rd !== "string" ? toDate(rd) : null;
  if (rdDt && !isNaN(rdDt.getTime())) ev("editRegistrationDate", rdDt.toISOString().slice(0, 10));
  else if (rd && typeof rd === "string") ev("editRegistrationDate", rd.slice(0, 10));
  else ev("editRegistrationDate", "");
  ev("editAgreedTotalFee", s.agreedTotalFee);
  ev("editInstallmentCount", s.installmentCount);
  var g = s.gender || "Erkek";
  if (g === "Kadin") g = "Kadın";
  document.querySelectorAll('input[name="edit_gender"]').forEach(function (r) {
    r.checked = r.value === g;
  });
  if (!document.querySelector('input[name="edit_gender"]:checked')) {
    var er = document.querySelector('input[name="edit_gender"][value="Erkek"]');
    if (er) er.checked = true;
  }
  var addPane = document.getElementById("studentPaneAdd");
  var editPane = document.getElementById("studentPaneEdit");
  if (addPane) addPane.hidden = true;
  if (editPane) editPane.hidden = false;
  var sub = document.getElementById("modalStudentSubtitle");
  var title = document.getElementById("modalStudentTitle");
  if (sub) sub.textContent = "Kayıt güncelleniyor. ID: " + studentId.slice(0, 8) + "…";
  if (title) title.innerHTML = '<i class="fa-solid fa-user-pen"></i> Öğrenci düzenle';
  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      openModal("studentModal");
    });
  });
}

async function submitStudentAddForm(e) {
  e.preventDefault();
  var form = e.target;
  var fd = new FormData(form);
  var data = {};
  fd.forEach(function (val, key) {
    if (key === "add_gender") return;
    if (val !== "" && val != null) data[key] = typeof val === "string" ? val.trim() : val;
  });
  var genEl = form.querySelector('input[name="add_gender"]:checked');
  data.gender = genEl ? genEl.value : "Erkek";
  var first = (data.firstName || "").trim();
  var last = (data.lastName || "").trim();
  if (!first || !last) {
    showToast("Ad ve soyad zorunludur.");
    return;
  }
  data.name = (first + " " + last).trim();
  if (!data.parentPhone) {
    showToast("Veli telefonu zorunludur.");
    return;
  }
  data.phone = data.parentPhone;
  if (data.tcKimlikNo && String(data.tcKimlikNo).replace(/\D/g, "").length !== 11) {
    showToast("TCKN 11 hane olmalıdır (veya boş bırakın).");
    return;
  }
  if (data.agreedTotalFee !== undefined && data.agreedTotalFee !== "") {
    var fee = parseFloat(String(data.agreedTotalFee).replace(",", "."), 10);
    data.agreedTotalFee = isNaN(fee) ? data.agreedTotalFee : fee;
  }
  if (data.installmentCount !== undefined && data.installmentCount !== "") {
    var ins = parseInt(data.installmentCount, 10);
    if (!isNaN(ins)) data.installmentCount = Math.min(36, Math.max(1, ins));
  }
  data.avatarUrl = buildStudentAvatarUrl(data.name, data.gender);
  data.track = data.examGroup && data.examGroup !== "" ? data.examGroup : "TYT + AYT";
  data.status = data.status || "Aktif";
  try {
    data.createdAt = serverTimestamp();
    data.coach_id = getCoachId();
    await addDoc(collection(db, "students"), data);
    showToast("Öğrenci başarıyla eklendi.");
    form.reset();
    setStudentErpTab(0);
    closeAllModals();
  } catch (err) {
    console.error(err);
    alert("Kayıt hatası: " + (err.message || err));
  }
}

async function submitStudentEditForm(e) {
  e.preventDefault();
  var editId = (document.getElementById("editStudentDocId") || {}).value;
  editId = editId ? String(editId).trim() : "";
  if (!editId) {
    showToast("Geçersiz kayıt.");
    return;
  }
  var first = (document.getElementById("editStudentName") || {}).value;
  first = first ? String(first).trim() : "";
  var last = (document.getElementById("editStudentSurname") || {}).value;
  last = last ? String(last).trim() : "";
  if (!first || !last) {
    showToast("Ad ve soyad zorunludur.");
    return;
  }
  var parentPhone = (document.getElementById("editParentPhone") || {}).value;
  parentPhone = parentPhone ? String(parentPhone).trim() : "";
  if (!parentPhone) {
    showToast("Veli telefonu zorunludur.");
    return;
  }
  var genEl = document.querySelector('input[name="edit_gender"]:checked');
  var gender = genEl ? genEl.value : "Erkek";
  function gv(id) {
    var el = document.getElementById(id);
    return el && el.value != null ? String(el.value).trim() : "";
  }
  var tckn = gv("editTcKimlikNo");
  if (tckn && String(tckn).replace(/\D/g, "").length !== 11) {
    showToast("TCKN 11 hane olmalıdır (veya boş bırakın).");
    return;
  }
  var data = {
    firstName: first,
    lastName: last,
    name: (first + " " + last).trim(),
    gender: gender,
    parentPhone: parentPhone,
    phone: parentPhone,
    tcKimlikNo: tckn || null,
    schoolName: gv("editSchoolName") || null,
    classGrade: gv("editClassGrade") || null,
    examGroup: gv("editExamGroup") || null,
    fieldType: gv("editFieldType") || null,
    currentTytNet: gv("editCurrentTytNet") || null,
    targetTytNet: gv("editTargetTytNet") || null,
    parentFullName: gv("editParentFullName") || null,
    parentRelation: gv("editParentRelation") || null,
    emergencyContactName: gv("editEmergencyContactName") || null,
    registrationDate: gv("editRegistrationDate") || null,
    agreedTotalFee: gv("editAgreedTotalFee"),
    installmentCount: gv("editInstallmentCount"),
  };
  if (data.agreedTotalFee !== "") {
    var fee2 = parseFloat(String(data.agreedTotalFee).replace(",", "."), 10);
    data.agreedTotalFee = isNaN(fee2) ? null : fee2;
  } else data.agreedTotalFee = null;
  if (data.installmentCount !== "") {
    var ins2 = parseInt(data.installmentCount, 10);
    data.installmentCount = isNaN(ins2) ? null : Math.min(36, Math.max(1, ins2));
  } else data.installmentCount = null;
  data.track = data.examGroup && data.examGroup !== "" ? data.examGroup : "TYT + AYT";
  data.avatarUrl = buildStudentAvatarUrl(data.name, data.gender);
  data.updatedAt = serverTimestamp();
  try {
    await updateDoc(doc(db, "students", editId), data);
    showToast("Öğrenci başarıyla güncellendi.");
    document.getElementById("formStudentEdit").reset();
    document.getElementById("editStudentDocId").value = "";
    resetStudentModalPanes();
    closeAllModals();
  } catch (err) {
    console.error(err);
    alert("Kayıt hatası: " + (err.message || err));
  }
}

function resetAppointmentModalUi() {
  var t = document.getElementById("modalApptTitle");
  if (t) t.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Randevu oluştur';
  var s = document.getElementById("modalApptSubtitle");
  if (s) s.textContent = "Öğrenci ile görüşme planlayın";
  var b = document.getElementById("btnApptSubmit");
  if (b) b.innerHTML = '<i class="fa-solid fa-check"></i> Kaydet';
}

function openAppointmentModalNew() {
  var f = document.getElementById("formAppointment");
  if (f) f.reset();
  var h = document.getElementById("appointmentEditDocId");
  if (h) h.value = "";
  resetAppointmentModalUi();
  fillStudentSelects();
  var d = document.getElementById("ap_date");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  openModal("appointmentModal");
}

function openAppointmentModalEdit(docId) {
  var ap = cachedAppointments.find(function (x) {
    return x.id === docId;
  });
  if (!ap) return;
  fillStudentSelects();
  document.getElementById("appointmentEditDocId").value = docId;
  document.getElementById("ap_student").value = ap.studentId || "";
  var dateStr = ap.date || "";
  if (!dateStr && ap.scheduledAt) {
    var dt = toDate(ap.scheduledAt);
    if (dt && !isNaN(dt.getTime())) dateStr = dt.toISOString().slice(0, 10);
  }
  document.getElementById("ap_date").value = dateStr;
  var tm = ap.time || "";
  if (!tm && ap.scheduledAt) {
    var dt2 = toDate(ap.scheduledAt);
    if (dt2)
      tm =
        String(dt2.getHours()).padStart(2, "0") + ":" + String(dt2.getMinutes()).padStart(2, "0");
  }
  if (tm.length >= 5) tm = tm.slice(0, 5);
  document.getElementById("ap_time").value = tm;
  document.getElementById("ap_duration").value = String(ap.durationMin != null ? ap.durationMin : 45);
  document.getElementById("ap_type").value = ap.meetingType || "Yüz yüze";
  document.getElementById("ap_topic").value = ap.topic || "";
  document.getElementById("ap_notes").value = ap.internalNotes || "";
  document.getElementById("ap_location").value = ap.locationOrLink || "";
  document.getElementById("modalApptTitle").innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Randevu düzenle';
  document.getElementById("btnApptSubmit").innerHTML = '<i class="fa-solid fa-rotate"></i> Güncelle';
  openModal("appointmentModal");
}

async function submitAppointmentForm(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  var editAppt = ((document.getElementById("appointmentEditDocId") || {}).value || "").trim();
  var sid = fd.get("studentId");
  var st = cachedStudents.find(function (x) {
    return x.id === sid;
  });
  if (!st) {
    showToast("Öğrenci seçin.");
    return;
  }
  var d = fd.get("appointmentDate");
  var t = fd.get("appointmentTime");
  var payload = {
    studentId: sid,
    studentName: st.name || st.studentName || "",
    scheduledAt: Timestamp.fromDate(new Date(d + "T" + t)),
    date: d,
    time: t,
    durationMin: parseInt(fd.get("durationMin"), 10) || 45,
    meetingType: fd.get("meetingType") || "",
    topic: fd.get("topic") || "",
    internalNotes: fd.get("internalNotes") || "",
    locationOrLink: fd.get("locationOrLink") || "",
  };
  try {
    if (editAppt) {
      payload.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "appointments", editAppt), payload);
      showToast("Randevu güncellendi.");
    } else {
      payload.createdAt = serverTimestamp();
      payload.coach_id = getCoachId();
      await addDoc(collection(db, "appointments"), payload);
      showToast("Randevu kaydedildi.");
    }
    e.target.reset();
    var h = document.getElementById("appointmentEditDocId");
    if (h) h.value = "";
    resetAppointmentModalUi();
    closeAllModals();
  } catch (err) {
    console.error(err);
    alert(err.message || err);
  }
}

function getTestMakerPayload() {
  var ders = document.getElementById("tm_ders");
  var konu = document.getElementById("tm_konu");
  var zorluk = document.getElementById("tm_zorluk");
  var soru = document.getElementById("tm_soru");
  var baslik = document.getElementById("tm_testAd");
  var layout = document.querySelector('input[name="tm_layout"]:checked');
  var font = document.querySelector('input[name="tm_font"]:checked');
  var theme = document.querySelector('input[name="tm_theme"]:checked');
  return {
    title: (baslik && baslik.value.trim()) || "Adsız test taslağı",
    subject: ders ? ders.value : "",
    topic: konu ? konu.value.trim() : "",
    difficulty: zorluk ? zorluk.value : "Orta",
    questionCount: soru ? parseInt(soru.value, 10) || 40 : 40,
    layout: layout ? layout.value : "yks_cift_sutun",
    layoutLabel:
      layout && layout.value === "yks_cift_sutun"
        ? "YKS Orijinal (Çift Sütun)"
        : layout && layout.value === "tek_sutun_bank"
          ? "Soru Bankası (Tek Sütun)"
          : "Kurumsal Deneme (Kapaklı)",
    fontFamily: font ? font.value : "Times New Roman",
    colorTheme: theme ? theme.value : "matbaa_bw",
    colorThemeLabel:
      theme && theme.value === "matbaa_bw"
        ? "Siyah-Beyaz (Matbaa)"
        : theme && theme.value === "kurumsal_mor"
          ? "Kurumsal (Mavi/Mor)"
          : "Renkli (Soru Bankası)",
  };
}

function initTestMakerTabs() {
  var root = document.getElementById("testMakerRoot");
  if (!root) return;
  root.querySelectorAll(".tm-tab").forEach(function (tab) {
    tab.addEventListener("click", function () {
      var n = tab.getAttribute("data-tm-tab");
      root.querySelectorAll(".tm-tab").forEach(function (t) {
        t.classList.toggle("is-active", t.getAttribute("data-tm-tab") === n);
        t.setAttribute("aria-selected", t.getAttribute("data-tm-tab") === n ? "true" : "false");
      });
      root.querySelectorAll(".tm-panel").forEach(function (p, i) {
        var on = p.id === "tmPanel" + n;
        p.classList.toggle("is-active", on);
        p.hidden = !on;
      });
    });
  });
}

function resetTestMakerModal() {
  var te = document.getElementById("testEditDocId");
  if (te) te.value = "";
  var lbl = document.getElementById("btnPdfTaslakLabel");
  if (lbl) lbl.textContent = "PDF taslağı oluştur";
  var root = document.getElementById("testMakerRoot");
  if (!root) return;
  var first = root.querySelector('.tm-tab[data-tm-tab="1"]');
  if (first) first.click();
}

function setTestRadioGroup(name, value) {
  document.querySelectorAll('input[name="' + name + '"]').forEach(function (inp) {
    inp.checked = inp.value === value;
  });
}

function openTestModalEdit(testId) {
  var t = cachedTests.find(function (x) {
    return x.id === testId;
  });
  if (!t) return;
  var root = document.getElementById("testMakerRoot");
  if (root) {
    var first = root.querySelector('.tm-tab[data-tm-tab="1"]');
    if (first) first.click();
  }
  document.getElementById("testEditDocId").value = testId;
  var ders = document.getElementById("tm_ders");
  if (ders) ders.value = t.subject || "Türkçe";
  var konu = document.getElementById("tm_konu");
  if (konu) konu.value = t.topic || "";
  var z = document.getElementById("tm_zorluk");
  if (z) z.value = t.difficulty || "Orta";
  var soru = document.getElementById("tm_soru");
  if (soru) soru.value = t.questionCount != null ? String(t.questionCount) : "40";
  var ad = document.getElementById("tm_testAd");
  if (ad) ad.value = t.title || "";
  setTestRadioGroup("tm_layout", t.layout || "yks_cift_sutun");
  setTestRadioGroup("tm_font", t.fontFamily || "Times New Roman");
  setTestRadioGroup("tm_theme", t.colorTheme || "matbaa_bw");
  var lbl = document.getElementById("btnPdfTaslakLabel");
  if (lbl) lbl.textContent = "Güncelle";
  openModal("testModal");
}

async function onPdfTaslakClick() {
  var payload = getTestMakerPayload();
  var editTestId = ((document.getElementById("testEditDocId") || {}).value || "").trim();
  console.log("[TestMaker] PDF taslağı seçimleri:", JSON.stringify(payload, null, 2));
  try {
    if (editTestId) {
      await updateDoc(doc(db, "tests", editTestId), {
        ...payload,
        module: "TestMakerPro",
        pdfDraft: true,
        updatedAt: serverTimestamp(),
      });
      showToast("Test güncellendi.");
    } else {
      await addDoc(collection(db, "tests"), {
        ...payload,
        module: "TestMakerPro",
        pdfDraft: true,
        status: "Taslak",
        createdAt: serverTimestamp(),
        coach_id: getCoachId(),
      });
      showToast("Test taslağı kaydedildi — PDF için veriler konsolda.");
    }
    resetTestMakerModal();
    closeAllModals();
  } catch (err) {
    console.error(err);
    showToast("Kayıt hatası: " + (err.message || err));
  }
}

function resetPaymentModalUi() {
  var b = document.getElementById("btnPaymentSubmit");
  if (b) b.innerHTML = '<i class="fa-solid fa-check"></i> Kaydet';
}

function openPaymentModalNew() {
  var f = document.getElementById("formPayment");
  if (f) f.reset();
  var h = document.getElementById("paymentEditDocId");
  if (h) h.value = "";
  resetPaymentModalUi();
  fillStudentSelects();
  var d = document.getElementById("pay_date");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  openModal("financeModal");
}

function openPaymentModalEdit(docId) {
  var p = cachedPayments.find(function (x) {
    return x.id === docId;
  });
  if (!p) return;
  fillStudentSelects();
  document.getElementById("paymentEditDocId").value = docId;
  document.getElementById("pay_student").value = p.studentId || "";
  document.getElementById("pay_amount").value = p.amount != null ? String(p.amount) : "";
  document.getElementById("pay_date").value = p.paymentDate || "";
  document.getElementById("pay_method").value = p.paymentMethod || "Nakit";
  document.getElementById("pay_desc").value = p.description || "";
  document.getElementById("pay_invoice").value = p.invoiceNote || "";
  document.getElementById("btnPaymentSubmit").innerHTML = '<i class="fa-solid fa-rotate"></i> Güncelle';
  openModal("financeModal");
}

async function submitPaymentForm(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  var editPay = ((document.getElementById("paymentEditDocId") || {}).value || "").trim();
  var sid = fd.get("studentId");
  var st = cachedStudents.find(function (x) {
    return x.id === sid;
  });
  if (!st) {
    showToast("Öğrenci seçin.");
    return;
  }
  var payload = {
    studentId: sid,
    studentName: st.name || st.studentName || "",
    amount: parseFloat(fd.get("amount")) || 0,
    paymentDate: fd.get("paymentDate") || new Date().toISOString().slice(0, 10),
    paymentMethod: fd.get("paymentMethod") || "",
    description: fd.get("description") || "",
    invoiceNote: fd.get("invoiceNote") || "",
  };
  try {
    if (editPay) {
      payload.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "payments", editPay), payload);
      showToast("Tahsilat güncellendi.");
    } else {
      payload.createdAt = serverTimestamp();
      payload.coach_id = getCoachId();
      await addDoc(collection(db, "payments"), payload);
      showToast("Tahsilat kaydedildi.");
    }
    e.target.reset();
    var h = document.getElementById("paymentEditDocId");
    if (h) h.value = "";
    resetPaymentModalUi();
    closeAllModals();
  } catch (err) {
    console.error(err);
    alert(err.message || err);
  }
}

function resetExamModalUi() {
  var b = document.getElementById("btnExamSubmit");
  if (b) b.innerHTML = '<i class="fa-solid fa-save"></i> Kaydet';
}

function openExamModalNew() {
  var f = document.getElementById("formExam");
  if (f) f.reset();
  var h = document.getElementById("examEditDocId");
  if (h) h.value = "";
  resetExamModalUi();
  fillStudentSelects();
  var ed = document.getElementById("ex_date");
  if (ed && !ed.value) ed.value = new Date().toISOString().slice(0, 10);
  openModal("examModal");
}

function openExamModalEdit(docId) {
  var ex = cachedExams.find(function (x) {
    return x.id === docId;
  });
  if (!ex) return;
  fillStudentSelects();
  document.getElementById("examEditDocId").value = docId;
  document.getElementById("ex_student").value = ex.studentId || "";
  document.getElementById("ex_type").value = (ex.examType || ex.tur || "TYT").toUpperCase() === "AYT" ? "AYT" : "TYT";
  document.getElementById("ex_net").value = ex.net != null ? String(ex.net) : "";
  var d = toDate(ex.examDate) || toDate(ex.date);
  document.getElementById("ex_date").value =
    d && !isNaN(d.getTime()) ? d.toISOString().slice(0, 10) : ex.date || "";
  document.getElementById("ex_name").value = ex.examName || "";
  document.getElementById("ex_breakdown").value = ex.subjectBreakdown || "";
  document.getElementById("ex_status").value = ex.status || "Kayıt girildi";
  document.getElementById("ex_coach").value = ex.coachExamNote || "";
  document.getElementById("btnExamSubmit").innerHTML = '<i class="fa-solid fa-rotate"></i> Güncelle';
  openModal("examModal");
}

async function submitExamForm(e) {
  e.preventDefault();
  var fd = new FormData(e.target);
  var editEx = ((document.getElementById("examEditDocId") || {}).value || "").trim();
  var sid = fd.get("studentId");
  var st = cachedStudents.find(function (x) {
    return x.id === sid;
  });
  if (!st) {
    showToast("Öğrenci seçin.");
    return;
  }
  var exD = fd.get("examDate");
  var examDateTs = null;
  if (exD) examDateTs = Timestamp.fromDate(new Date(exD));
  var payload = {
    studentId: sid,
    studentName: st.name || st.studentName || "",
    examType: fd.get("examType"),
    tur: fd.get("examType"),
    net: fd.get("net"),
    examDate: examDateTs,
    date: exD || "",
    examName: fd.get("examName") || "",
    subjectBreakdown: fd.get("subjectBreakdown") || "",
    status: fd.get("status") || "Kayıt girildi",
    coachExamNote: fd.get("coachExamNote") || "",
  };
  try {
    if (editEx) {
      payload.updatedAt = serverTimestamp();
      await updateDoc(doc(db, "exams", editEx), payload);
      showToast("Deneme kaydı güncellendi.");
    } else {
      payload.createdAt = serverTimestamp();
      payload.coach_id = getCoachId();
      await addDoc(collection(db, "exams"), payload);
      showToast("Deneme kaydı eklendi.");
    }
    e.target.reset();
    var h = document.getElementById("examEditDocId");
    if (h) h.value = "";
    resetExamModalUi();
    closeAllModals();
  } catch (err) {
    console.error(err);
    alert(err.message || err);
  }
}

function initModals() {
  var overlay = document.getElementById("modalOverlay");
  if (!overlay) return;
  overlay.addEventListener("click", function (ev) {
    var closeBtn = ev.target.closest && ev.target.closest("[data-close-modal]");
    if (closeBtn && overlay.contains(closeBtn)) {
      var modalHost = closeBtn.closest(".modal");
      if (modalHost && modalHost.id) {
        ev.preventDefault();
        closeModal(modalHost.id);
        return;
      }
    }
    if (ev.target === overlay) closeAllModals();
  });
  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape") closeAllModals();
  });
  var fsAdd = document.getElementById("formStudentAdd");
  if (fsAdd) {
    fsAdd.addEventListener("submit", submitStudentAddForm);
    initStudentErpTabs();
  }
  var fsEdit = document.getElementById("formStudentEdit");
  if (fsEdit) fsEdit.addEventListener("submit", submitStudentEditForm);
  var fa = document.getElementById("formAppointment");
  if (fa) fa.addEventListener("submit", submitAppointmentForm);
  initTestMakerTabs();
  var btnPdf = document.getElementById("btnPdfTaslak");
  if (btnPdf) btnPdf.addEventListener("click", onPdfTaslakClick);
  var fp = document.getElementById("formPayment");
  if (fp) fp.addEventListener("submit", submitPaymentForm);
  var fe = document.getElementById("formExam");
  if (fe) fe.addEventListener("submit", submitExamForm);
}

function subscribeFirestore() {
  clearFirestoreListeners();
  var qa = coachQuery("appointments");
  var qe = coachQuery("exams");
  var qs = coachQuery("students");
  var qp = coachQuery("payments");
  var qt = coachQuery("tests");
  if (!qa || !qe || !qs || !qp || !qt) {
    console.warn("[Firestore] coach_id eksik veya sorgu kurulamadı.");
    return;
  }
  firestoreUnsubs.push(
    onSnapshot(
      qa,
      onAppointmentsSnap,
      function (err) {
        console.error(err);
        const row = document.getElementById("appointmentsRow");
        if (row) row.innerHTML = '<p class="empty-hint empty-hint--error">' + firestoreErrorHtml(err) + "</p>";
      }
    )
  );
  firestoreUnsubs.push(
    onSnapshot(
      qe,
      onExamsSnap,
      function (err) {
        const tbody = document.getElementById("denemeTableBody");
        if (tbody)
          tbody.innerHTML =
            '<tr><td colspan="6" class="table-empty table-empty--error">' + firestoreErrorHtml(err) + "</td></tr>";
      }
    )
  );
  firestoreUnsubs.push(
    onSnapshot(
      qs,
      onStudentsSnap,
      function (err) {
        const list = document.getElementById("activeStudentsList");
        if (list) list.innerHTML = "<li class='mini-list__empty'>" + firestoreErrorHtml(err) + "</li>";
      }
    )
  );
  firestoreUnsubs.push(
    onSnapshot(
      qp,
      onPaymentsSnap,
      function (err) {
        var tb = document.getElementById("paymentsTableBody");
        if (tb) tb.innerHTML = "<tr><td colspan='5' class='table-empty table-empty--error'>" + firestoreErrorHtml(err) + "</td></tr>";
      }
    )
  );
  firestoreUnsubs.push(
    onSnapshot(
      qt,
      onTestsSnap,
      function (err) {
        var tb = document.getElementById("testsTableBody");
        if (tb) tb.innerHTML = "<tr><td colspan='5' class='table-empty table-empty--error'>" + firestoreErrorHtml(err) + "</td></tr>";
      }
    )
  );
}

function showToast(msg) {
  const t = document.getElementById("panelToast");
  if (!t) {
    alert(msg);
    return;
  }
  t.textContent = msg;
  t.hidden = false;
  t.classList.add("toast--show");
  clearTimeout(showToast._tm);
  showToast._tm = setTimeout(function () {
    t.classList.remove("toast--show");
    t.hidden = true;
  }, 2800);
}

function destroyTmWsCropper() {
  if (tmWsCropper && typeof tmWsCropper.destroy === "function") {
    try {
      tmWsCropper.destroy();
    } catch (e) {}
    tmWsCropper = null;
  }
}

function testmakerWorkspaceLeave() {
  var app = document.querySelector(".app");
  if (app) app.classList.remove("app--testmaker-workspace");
  destroyTmWsCropper();
  tmWsPdfDoc = null;
  tmWsCurrentPdfPage = 1;
  tmWsPdfRendering = false;
  var addBtn = document.getElementById("tmBtnAddToA4");
  if (addBtn) addBtn.disabled = true;
}

function testmakerWorkspaceEnter() {
  var app = document.querySelector(".app");
  if (app) app.classList.add("app--testmaker-workspace");
  bindTestMakerWorkspace();
  tmLibraryRenderList();
}

function tmPdfNavUpdateDisabled() {
  if (!tmWsPdfDoc) return;
  var t = tmWsPdfDoc.numPages || 1;
  var prev = document.getElementById("tmPdfPagePrev");
  var next = document.getElementById("tmPdfPageNext");
  if (prev) prev.disabled = tmWsCurrentPdfPage <= 1 || tmWsPdfRendering;
  if (next) next.disabled = tmWsCurrentPdfPage >= t || tmWsPdfRendering;
}

/** Önce Cropper destroy; canvas render; img hazır olunca Cropper yeniden. */
function renderPDFPage(pageNum) {
  if (!tmWsPdfDoc || typeof pdfjsLib === "undefined") return Promise.resolve();
  var total = tmWsPdfDoc.numPages || 1;
  var n = Math.max(1, Math.min(total, parseInt(pageNum, 10) || 1));
  tmWsCurrentPdfPage = n;
  var inp = document.getElementById("pdfPageInput");
  if (inp) inp.value = String(n);
  tmPdfNavUpdateDisabled();

  destroyTmWsCropper();

  var img = document.getElementById("tmCropImg");
  var addBtn = document.getElementById("tmBtnAddToA4");
  if (!img) return Promise.resolve();

  img.onload = null;
  img.onerror = null;
  img.removeAttribute("src");
  img.style.display = "none";
  if (addBtn) addBtn.disabled = true;

  tmWsPdfRendering = true;
  tmPdfNavUpdateDisabled();

  return tmWsPdfDoc
    .getPage(n)
    .then(function (page) {
      var scale = 2;
      var vp = page.getViewport({ scale: scale });
      var canvas = document.createElement("canvas");
      canvas.width = vp.width;
      canvas.height = vp.height;
      return page.render({ canvasContext: canvas.getContext("2d"), viewport: vp }).promise.then(function () {
        var dataUrl = canvas.toDataURL("image/png");
        var pageReadyOnce = false;
        function afterImageReady() {
          if (pageReadyOnce) return;
          pageReadyOnce = true;
          img.onload = null;
          img.onerror = null;
          img.style.display = "block";
          try {
            if (typeof Cropper !== "undefined") {
              tmWsCropper = new Cropper(img, {
                viewMode: 1,
                dragMode: "crop",
                autoCropArea: 0.55,
                responsive: true,
                restore: false,
              });
            }
          } catch (err) {
            console.error(err);
            showToast("Kırpma aracı başlatılamadı.");
          }
          if (addBtn) addBtn.disabled = false;
          tmWsPdfRendering = false;
          tmPdfNavUpdateDisabled();
        }
        img.onerror = function () {
          if (pageReadyOnce) return;
          pageReadyOnce = true;
          img.onerror = null;
          tmWsPdfRendering = false;
          if (addBtn) addBtn.disabled = false;
          tmPdfNavUpdateDisabled();
          showToast("Sayfa görüntüsü yüklenemedi.");
        };
        img.src = dataUrl;
        if (typeof img.decode === "function") {
          img
            .decode()
            .then(function () {
              afterImageReady();
            })
            .catch(function () {
              img.onload = function () {
                afterImageReady();
              };
              if (img.complete && img.naturalWidth) requestAnimationFrame(afterImageReady);
            });
        } else {
          img.onload = function () {
            afterImageReady();
          };
          if (img.complete && img.naturalWidth) requestAnimationFrame(afterImageReady);
        }
      });
    })
    .catch(function (e) {
      console.error(e);
      tmWsPdfRendering = false;
      if (addBtn) addBtn.disabled = false;
      tmPdfNavUpdateDisabled();
      showToast("PDF sayfası çizilemedi.");
    });
}

function tmWsLoadImageFile(file) {
  var row = document.getElementById("tmPdfPageRow");
  if (row) row.hidden = true;
  tmWsPdfDoc = null;
  destroyTmWsCropper();
  var img = document.getElementById("tmCropImg");
  var url = URL.createObjectURL(file);
  img.onload = function () {
    URL.revokeObjectURL(url);
    img.style.display = "block";
    if (typeof Cropper !== "undefined") {
      tmWsCropper = new Cropper(img, {
        viewMode: 1,
        dragMode: "crop",
        autoCropArea: 0.55,
        responsive: true,
        restore: false,
      });
    }
    var b = document.getElementById("tmBtnAddToA4");
    if (b) b.disabled = false;
  };
  img.src = url;
}

function tmWsLoadPdfFromBuffer(buf) {
  if (typeof pdfjsLib === "undefined") {
    showToast("PDF.js yüklenemedi.");
    return Promise.resolve();
  }
  var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  return pdfjsLib
    .getDocument({ data: u8 })
    .promise.then(function (doc) {
      tmWsPdfDoc = doc;
      tmWsCurrentPdfPage = 1;
      var pr = document.getElementById("tmPdfPageRow");
      if (pr) pr.hidden = false;
      var tot = document.getElementById("pdfPageTotal");
      if (tot) tot.textContent = String(doc.numPages);
      var pin = document.getElementById("pdfPageInput");
      if (pin) {
        pin.min = "1";
        pin.max = String(Math.max(1, doc.numPages));
        pin.value = "1";
      }
      return renderPDFPage(1);
    })
    .catch(function (e) {
      console.error(e);
      showToast("PDF okunamadı.");
    });
}

function tmWsHandleFile(file) {
  if (!file) return;
  tmActiveLibId = null;
  tmLibraryRenderList();
  var n = file.name.toLowerCase();
  if (n.endsWith(".pdf")) {
    file.arrayBuffer().then(function (buf) {
      tmWsLoadPdfFromBuffer(buf);
    });
  } else if (/\.(png|jpe?g)$/.test(n)) {
    tmWsLoadImageFile(file);
  } else {
    showToast("Yalnızca PNG, JPG veya PDF.");
  }
}

function tmWsCompressJpeg(dataUrl, maxW, q) {
  return new Promise(function (resolve) {
    var im = new Image();
    im.onload = function () {
      var w = im.width,
        h = im.height;
      if (w > maxW) {
        h = Math.round((h * maxW) / w);
        w = maxW;
      }
      var c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      c.getContext("2d").drawImage(im, 0, 0, w, h);
      resolve(c.toDataURL("image/jpeg", q));
    };
    im.onerror = function () {
      resolve(dataUrl);
    };
    im.src = dataUrl;
  });
}

async function tmWsSaveFirestoreDraft() {
  var title = (document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value) || "";
  title = title.trim();
  if (!title) {
    showToast("Test başlığı girin.");
    return;
  }
  var blocks = document.querySelectorAll("#tmA4Paper .tm-a4-block img");
  if (blocks.length === 0) {
    showToast("A4'e en az bir soru ekleyin.");
    return;
  }
  var arr = [];
  var total = 0;
  var maxBytes = 900000;
  for (var i = 0; i < blocks.length; i++) {
    var j = await tmWsCompressJpeg(blocks[i].src, 700, 0.68);
    if (total + j.length > maxBytes) {
      showToast("Firestore ~1MB sınırı: " + arr.length + " soru kaydedildi.");
      break;
    }
    arr.push(j);
    total += j.length;
  }
  if (arr.length === 0) {
    showToast("Kaydedilecek veri çok büyük.");
    return;
  }
  var dateStr =
    (document.getElementById("tmWsTestDate") && document.getElementById("tmWsTestDate").value) ||
    new Date().toISOString().slice(0, 10);
  try {
    await addDoc(collection(db, "tests"), {
      title: title,
      subject: (document.getElementById("tmWsSubject") && document.getElementById("tmWsSubject").value) || "",
      difficulty: (document.getElementById("tmWsDiff") && document.getElementById("tmWsDiff").value) || "Orta",
      testDate: dateStr,
      questionImages: arr,
      questionCount: arr.length,
      workspaceVersion: 2,
      module: "TestMakerWorkspace",
      status: "Taslak",
      pdfDraft: true,
      createdAt: serverTimestamp(),
      coach_id: getCoachId(),
    });
    showToast("Taslak Firestore'a kaydedildi (" + arr.length + " soru).");
  } catch (err) {
    console.error(err);
    alert(err.message || String(err));
  }
}

/**
 * PDF için A4 klonu: sabit px genişlik, çift sütun, kırmızı X ve id çakışması yok.
 */
function tmPreparePrintClone(clone, livePaper, widthPx, mm) {
  clone.removeAttribute("id");
  clone.querySelectorAll("[id]").forEach(function (n) {
    n.removeAttribute("id");
  });

  var acc = getComputedStyle(livePaper).getPropertyValue("--tm-accent").trim() || "#1a1a1a";
  var accRgb = getComputedStyle(livePaper).getPropertyValue("--tm-accent-rgb").trim() || "26,26,26";
  var gut = getComputedStyle(livePaper).getPropertyValue("--tm-gutter").trim() || "#c8c8c8";
  clone.style.cssText =
    "width:" +
    widthPx +
    "px;min-height:" +
    Math.round(297 * mm) +
    "px;max-width:" +
    widthPx +
    "px;margin:0;padding:0;box-sizing:border-box;background:#fff;color:#111;position:relative;overflow:visible;-webkit-print-color-adjust:exact;print-color-adjust:exact;";
  clone.style.setProperty("--tm-accent", acc);
  clone.style.setProperty("--tm-accent-rgb", accRgb);
  clone.style.setProperty("--tm-gutter", gut);

  clone.querySelectorAll(".tm-a4-block__x").forEach(function (btn) {
    btn.remove();
  });
  clone.querySelectorAll(".tm-a4-block").forEach(function (b) {
    b.removeAttribute("draggable");
    b.style.position = "relative";
    b.style.marginBottom = "10px";
    b.style.width = "100%";
    b.style.boxSizing = "border-box";
  });

  var emp = clone.querySelector(".tm-a4-empty");
  if (emp) emp.style.display = "none";

  var liveDual = livePaper.querySelector("#testContentArea");
  var liveSingle = livePaper.querySelector("#tmA4Single");
  var cDual = clone.querySelector(".test-content-area");
  var cSingle = clone.querySelector(".tm-a4-single");

  var padX = Math.round(10 * mm);
  var padB = Math.round(10 * mm);
  var colGap = Math.round(2 * mm);

  if (liveDual && !liveDual.hidden && cDual) {
    cDual.removeAttribute("hidden");
    cDual.style.cssText =
      "display:flex!important;flex-direction:row;flex-wrap:nowrap;align-items:flex-start;width:100%;box-sizing:border-box;padding:0 " +
      padX +
      "px " +
      padB +
      "px;margin:0;min-height:120px;";
    cDual.querySelectorAll(".test-column").forEach(function (col) {
      var rule = col.classList.contains("test-column--with-rule");
      col.style.cssText =
        "flex:1 1 50%!important;width:50%!important;max-width:50%!important;min-width:0;box-sizing:border-box;display:block;" +
        (rule
          ? "border-left:2px solid " + gut + ";padding-left:" + Math.round(4 * mm) + "px;"
          : "padding-right:" + colGap + "px;");
    });
    if (cSingle) {
      cSingle.setAttribute("hidden", "");
      cSingle.style.display = "none";
    }
  } else if (liveSingle && !liveSingle.hidden && cSingle) {
    cSingle.removeAttribute("hidden");
    cSingle.style.cssText =
      "display:block!important;width:100%;box-sizing:border-box;padding:" +
      Math.round(8 * mm) +
      "px " +
      Math.round(12 * mm) +
      "px " +
      Math.round(12 * mm) +
      "px;margin:0;";
    if (cDual) {
      cDual.setAttribute("hidden", "");
      cDual.style.display = "none";
    }
  }

  clone.querySelectorAll(".tm-paper-header").forEach(function (h) {
    var st = window.getComputedStyle(h);
    if (st.display === "none") {
      h.style.display = "none";
      return;
    }
    h.style.display = st.display;
    h.style.visibility = "visible";
    h.style.width = "100%";
    h.style.boxSizing = "border-box";
  });

  clone.querySelectorAll("img").forEach(function (im) {
    im.style.maxWidth = "100%";
    im.style.height = "auto";
    im.style.display = "block";
  });
}

function tmWsDownloadPdf() {
  var paper = document.getElementById("tmA4Paper");
  if (!paper || !paper.querySelector(".tm-a4-block")) {
    showToast("Önce A4'e soru ekleyin.");
    return;
  }
  if (typeof html2pdf === "undefined") {
    alert("html2pdf yüklenmedi. Sayfayı yenileyin.");
    return;
  }

  var prev = document.getElementById("tempPrintArea");
  if (prev && prev.parentNode) prev.parentNode.removeChild(prev);

  var mm = 96 / 25.4;
  var W = Math.round(210 * mm);
  var H = Math.round(297 * mm);

  var area = document.createElement("div");
  area.id = "tempPrintArea";
  area.setAttribute("aria-hidden", "true");
  area.style.cssText =
    "position:absolute;left:-9999px;top:0;width:" +
    W +
    "px;min-height:" +
    H +
    "px;margin:0;padding:0;background:#ffffff;color:#111111;overflow:visible;box-sizing:border-box;";

  var clone = paper.cloneNode(true);
  tmPreparePrintClone(clone, paper, W, mm);
  area.appendChild(clone);
  document.body.appendChild(area);

  var fname =
    ((document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value) || "Deneme_Sinavi")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-") || "Deneme_Sinavi";

  function tmPdfCleanup() {
    var a = document.getElementById("tempPrintArea");
    if (a && a.parentNode) {
      try {
        a.parentNode.removeChild(a);
      } catch (e) {}
    }
  }

  requestAnimationFrame(function () {
    requestAnimationFrame(function () {
      var dualEl = clone.querySelector(".test-content-area");
      if (dualEl && dualEl.style.display !== "none") {
        var mh = 120;
        dualEl.querySelectorAll(".test-column").forEach(function (c) {
          mh = Math.max(mh, c.scrollHeight);
        });
        dualEl.querySelectorAll(".test-column").forEach(function (c) {
          c.style.minHeight = mh + "px";
        });
      }
      var contentH = Math.max(clone.scrollHeight, clone.offsetHeight, H);
      html2pdf()
        .set({
          margin: 0,
          filename: fname + ".pdf",
          image: { type: "jpeg", quality: 1.0 },
          pagebreak: { mode: ["avoid-all", "css"] },
          html2canvas: {
            scale: 2,
            useCORS: true,
            allowTaint: true,
            logging: false,
            letterRendering: true,
            backgroundColor: "#ffffff",
            scrollX: 0,
            scrollY: 0,
            width: W,
            height: contentH,
            windowWidth: W,
            windowHeight: contentH,
          },
          jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
        })
        .from(clone)
        .save()
        .then(function () {
          tmPdfCleanup();
        })
        .catch(function (e) {
          tmPdfCleanup();
          console.error(e);
          showToast("PDF oluşturulamadı.");
        });
    });
  });
}

function tmSyncPaperHeaders() {
  var inst = (document.getElementById("tmWsInstitution") && document.getElementById("tmWsInstitution").value.trim()) || "";
  var course =
    (document.getElementById("tmWsCourse") && document.getElementById("tmWsCourse").value.trim()) ||
    (document.getElementById("tmWsSubject") && document.getElementById("tmWsSubject").value) ||
    "";
  var topic = (document.getElementById("tmWsTopic") && document.getElementById("tmWsTopic").value.trim()) || "";
  var d = document.getElementById("tmWsTestDate");
  var dateStr =
    d && d.value
      ? new Date(d.value + "T12:00:00").toLocaleDateString("tr-TR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : new Date().toLocaleDateString("tr-TR", {
          day: "numeric",
          month: "long",
          year: "numeric",
        });

  var el;
  el = document.getElementById("tmH_osym_inst");
  if (el) el.textContent = inst || "KURUM ADI";
  el = document.getElementById("tmH_osym_date");
  if (el) el.textContent = dateStr;
  el = document.getElementById("tmH_osym_course");
  if (el) el.textContent = course || "DERS ADI";
  el = document.getElementById("tmH_osym_topic");
  if (el) el.textContent = topic || "Konu / ünite";

  el = document.getElementById("tmH_vip_inst");
  if (el) el.textContent = inst || "Kurum Adı";
  el = document.getElementById("tmH_vip_course");
  if (el) el.textContent = course || "Ders";
  el = document.getElementById("tmH_vip_topic");
  if (el) el.textContent = topic || "Konu";

  el = document.getElementById("tmH_foy_inst");
  if (el) el.textContent = inst || "Kurum";
  el = document.getElementById("tmH_foy_course");
  if (el) el.textContent = course || "Ders";
  el = document.getElementById("tmH_foy_topic");
  if (el) el.textContent = topic || "Konu";

  var sn = document.getElementById("tmHdrStudentInput");
  var nn = document.getElementById("tmHdrNetInput");
  var hsn = document.getElementById("tmHdrStudentName");
  var hnet = document.getElementById("tmHdrStudentNet");
  if (hsn) hsn.textContent = (sn && sn.value.trim()) || "—";
  if (hnet) hnet.textContent = (nn && nn.value.trim()) || "—";
}

function tmApplyWorkspaceTemplate() {
  var paper = document.getElementById("tmA4Paper");
  var sel = document.getElementById("tmTemplate");
  if (!paper) return;
  var prev = paper.getAttribute("data-tm-layout") || "osym";
  var mode = (sel && sel.value) || "osym";
  if (mode !== "osym" && mode !== "vip" && mode !== "foy") mode = "osym";
  if (prev !== mode && document.querySelectorAll("#tmA4Layout .tm-a4-block").length > 0) {
    tmMigrateLayoutForTemplate(prev, mode);
  }
  paper.setAttribute("data-tm-layout", mode);
  paper.classList.remove("tm-template-osym", "tm-template-vip", "tm-template-foy");
  paper.classList.add("tm-template-" + mode);
  tmSyncPaperHeaders();
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
}

function bindTestMakerWorkspace() {
  if (tmWsWorkspaceBound) return;
  var root = document.getElementById("tmWorkspaceRoot");
  if (!root) return;
  tmWsWorkspaceBound = true;

  var dateInp = document.getElementById("tmWsTestDate");
  if (dateInp && !dateInp.value) dateInp.value = new Date().toISOString().slice(0, 10);

  var toggle = document.getElementById("btnTmToggleList");
  if (toggle)
    toggle.addEventListener("click", function () {
      var p = document.getElementById("tmSavedListPanel");
      if (!p) return;
      p.hidden = !p.hidden;
      if (!p.hidden) renderTestsTable();
    });

  var dz = document.getElementById("tmDropzone");
  var fin = document.getElementById("tmFileInput");
  if (dz && fin) {
    dz.addEventListener("click", function () {
      fin.click();
    });
    dz.addEventListener("dragover", function (e) {
      e.preventDefault();
      dz.classList.add("tm-dropzone--active");
    });
    dz.addEventListener("dragleave", function () {
      dz.classList.remove("tm-dropzone--active");
    });
    dz.addEventListener("drop", function (e) {
      e.preventDefault();
      dz.classList.remove("tm-dropzone--active");
      var f = e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) tmWsHandleFile(f);
    });
    fin.addEventListener("change", function () {
      var f = fin.files && fin.files[0];
      if (f) tmWsHandleFile(f);
      fin.value = "";
    });
  }

  var btnPrev = document.getElementById("tmPdfPagePrev");
  var btnNext = document.getElementById("tmPdfPageNext");
  var pdfInp = document.getElementById("pdfPageInput");
  if (btnPrev)
    btnPrev.addEventListener("click", function () {
      if (!tmWsPdfDoc || tmWsPdfRendering) return;
      if (tmWsCurrentPdfPage > 1) renderPDFPage(tmWsCurrentPdfPage - 1);
    });
  if (btnNext)
    btnNext.addEventListener("click", function () {
      if (!tmWsPdfDoc || tmWsPdfRendering) return;
      var t = tmWsPdfDoc.numPages || 1;
      if (tmWsCurrentPdfPage < t) renderPDFPage(tmWsCurrentPdfPage + 1);
    });
  if (pdfInp) {
    pdfInp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        pdfInp.blur();
      }
    });
    pdfInp.addEventListener("blur", function () {
      if (!tmWsPdfDoc) return;
      var t = tmWsPdfDoc.numPages || 1;
      var v = parseInt(pdfInp.value, 10);
      if (isNaN(v) || v < 1) {
        pdfInp.value = String(tmWsCurrentPdfPage);
        return;
      }
      if (v > t) v = t;
      if (v !== tmWsCurrentPdfPage) renderPDFPage(v);
      else pdfInp.value = String(tmWsCurrentPdfPage);
    });
  }

  var addA4 = document.getElementById("tmBtnAddToA4");
  if (addA4)
    addA4.addEventListener("click", function () {
      if (!tmWsCropper || typeof tmWsCropper.getCroppedCanvas !== "function") {
        showToast("Önce görsel yükleyip alan seçin.");
        return;
      }
      var canvas = tmWsCropper.getCroppedCanvas({ maxWidth: 2000, maxHeight: 2800 });
      if (!canvas || canvas.width < 8 || canvas.height < 8) {
        showToast("Geçerli bir kırpma alanı seçin.");
        return;
      }
      var dataUrl = canvas.toDataURL("image/png");
      var a4b = tmGetAppendParent();
      if (!a4b) return;
      var wrap = document.createElement("div");
      wrap.className = "tm-a4-block question-item";
      wrap.draggable = true;
      wrap.setAttribute("data-tm-drag", "1");
      var badge = document.createElement("div");
      badge.className = "tm-q-badge";
      var n = document.querySelectorAll("#tmA4Layout .tm-a4-block").length + 1;
      badge.textContent = "Soru " + n + ")";
      var imgW = document.createElement("div");
      imgW.className = "tm-a4-block__imgwrap";
      var img = document.createElement("img");
      img.src = dataUrl;
      img.alt = "";
      img.draggable = false;
      imgW.appendChild(img);
      var xb = document.createElement("button");
      xb.type = "button";
      xb.className = "tm-a4-block__x";
      xb.setAttribute("aria-label", "Kaldır");
      xb.draggable = false;
      xb.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      wrap.appendChild(badge);
      wrap.appendChild(imgW);
      wrap.appendChild(xb);
      a4b.appendChild(wrap);
      tmRenumberTmQuestions();
    });

  var paper = document.getElementById("tmA4Paper");
  var a4layout = document.getElementById("tmA4Layout");
  if (paper)
    paper.addEventListener("click", function (ev) {
      var x = ev.target.closest && ev.target.closest(".tm-a4-block__x");
      if (!x) return;
      ev.preventDefault();
      var bl = x.closest(".tm-a4-block");
      if (bl) bl.remove();
      tmUpdateA4EmptyVisibility();
      tmRenumberTmQuestions();
    });

  if (a4layout) {
    a4layout.addEventListener("dragstart", function (e) {
      var t = e.target.closest && e.target.closest(".tm-a4-block");
      if (!t || !a4layout.contains(t)) return;
      tmWsDragBlock = t;
      t.classList.add("tm-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "tm");
    });
    a4layout.addEventListener("dragend", function () {
      if (tmWsDragBlock) {
        tmWsDragBlock.classList.remove("tm-dragging");
        tmWsDragBlock = null;
      }
      a4layout.querySelectorAll(".tm-drag-over").forEach(function (n) {
        n.classList.remove("tm-drag-over");
      });
      tmRenumberTmQuestions();
    });
    a4layout.addEventListener("dragover", function (e) {
      if (!tmWsDragBlock || !a4layout.contains(tmWsDragBlock)) return;
      var col = e.target.closest && e.target.closest("#column-1, #column-2, #tmA4Single");
      if (!col) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var blocks = Array.prototype.slice.call(col.querySelectorAll(".tm-a4-block"));
      var y = e.clientY;
      var insertBefore = null;
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i] === tmWsDragBlock) continue;
        var rect = blocks[i].getBoundingClientRect();
        if (y < rect.top + rect.height / 2) {
          insertBefore = blocks[i];
          break;
        }
      }
      if (insertBefore) col.insertBefore(tmWsDragBlock, insertBefore);
      else col.appendChild(tmWsDragBlock);
    });
  }

  var libBtn = document.getElementById("tmLibUploadBtn");
  var libInp = document.getElementById("tmLibFileInput");
  if (libBtn && libInp) {
    libBtn.addEventListener("click", function () {
      libInp.click();
    });
    libInp.addEventListener("change", function () {
      var f = libInp.files && libInp.files[0];
      libInp.value = "";
      if (!f || !f.name.toLowerCase().endsWith(".pdf")) {
        showToast("Yalnızca PDF seçin.");
        return;
      }
      f.arrayBuffer().then(function (buf) {
        var id = "pdf_" + Date.now() + "_" + Math.random().toString(36).slice(2, 9);
        tmLibPut({
          id: id,
          name: f.name.slice(0, 180),
          addedAt: Date.now(),
          buffer: buf,
        })
          .then(function () {
            showToast("Kitaplığa eklendi.");
            tmLibraryRenderList();
          })
          .catch(function (err) {
            console.error(err);
            showToast("Kaydedilemedi (IndexedDB).");
          });
      });
    });
  }

  var libList = document.getElementById("tmLibraryList");
  if (libList) {
    libList.addEventListener("click", function (ev) {
      var del = ev.target.closest && ev.target.closest("[data-lib-del]");
      if (del) {
        ev.preventDefault();
        ev.stopPropagation();
        var did = del.getAttribute("data-lib-del");
        if (!did || !confirm("Bu PDF kitaplıktan silinsin mi?")) return;
        tmLibDelete(did).then(function () {
          if (tmActiveLibId === did) tmActiveLibId = null;
          tmLibraryRenderList();
        });
        return;
      }
      var item = ev.target.closest && ev.target.closest("[data-lib-id]");
      if (!item) return;
      var lid = item.getAttribute("data-lib-id");
      if (!lid) return;
      tmActiveLibId = lid;
      tmLibraryRenderList();
      tmLibGetFull(lid).then(function (rec) {
        if (!rec || !rec.buffer) {
          showToast("PDF bulunamadı.");
          return;
        }
        tmWsLoadPdfFromBuffer(rec.buffer);
      });
    });
  }

  var sav = document.getElementById("tmBtnSaveFirestore");
  if (sav) sav.addEventListener("click", tmWsSaveFirestoreDraft);
  var pdf = document.getElementById("tmBtnPdfDownload");
  if (pdf) pdf.addEventListener("click", tmWsDownloadPdf);

  var tmpl = document.getElementById("tmTemplate");
  if (tmpl) tmpl.addEventListener("change", tmApplyWorkspaceTemplate);
  [
    "tmHdrStudentInput",
    "tmHdrNetInput",
    "tmWsTitle",
    "tmWsInstitution",
    "tmWsCourse",
    "tmWsTopic",
    "tmWsSubject",
  ].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", tmSyncPaperHeaders);
    if (el) el.addEventListener("change", tmSyncPaperHeaders);
  });
  var td = document.getElementById("tmWsTestDate");
  if (td) {
    td.addEventListener("change", tmSyncPaperHeaders);
    td.addEventListener("input", tmSyncPaperHeaders);
  }
  tmApplyWorkspaceTemplate();
  initTmColorStudio();
}

function navigateTo(view) {
  if (!view) return;
  var previous = currentView;
  if (previous === "testmaker" && view !== "testmaker") testmakerWorkspaceLeave();
  currentView = view;
  document.querySelectorAll(".main-view").forEach(function (el) {
    const v = el.getAttribute("data-view");
    const on = v === view;
    el.classList.toggle("is-active", on);
    el.hidden = !on;
  });
  document.querySelectorAll("button.sidebar__link[data-nav]").forEach(function (btn) {
    btn.classList.toggle("sidebar__link--active", btn.getAttribute("data-nav") === view);
  });
  var brand = document.querySelector(".sidebar__brand-btn");
  if (brand) brand.classList.toggle("sidebar__brand-btn--active", view === "dashboard");
  navigateCallbacks.forEach(function (fn) {
    try {
      fn(view, { previous: previous });
    } catch (e) {
      console.error(e);
    }
  });
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  if (sidebar && overlay && window.innerWidth <= 992) {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  if (view === "denemeler") renderExamsFullPage();
  if (view === "ogrenciler") renderStudentsPage();
  if (view === "randevu") renderAppointmentsPage();
  if (view === "testmaker") {
    testmakerWorkspaceEnter();
    renderTestsTable();
  }
  if (view === "muhasebe") renderPaymentsTable();
  window.dispatchEvent(new CustomEvent("yks:navigate", { detail: { view: view } }));
}

function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebarOverlay");
  const toggle = document.getElementById("menuToggle");
  const close = document.getElementById("sidebarClose");

  function open() {
    sidebar.classList.add("is-open");
    overlay.classList.add("is-open");
    document.body.style.overflow = "hidden";
  }
  function shut() {
    sidebar.classList.remove("is-open");
    overlay.classList.remove("is-open");
    document.body.style.overflow = "";
  }
  if (toggle) toggle.addEventListener("click", open);
  if (close) close.addEventListener("click", shut);
  if (overlay) overlay.addEventListener("click", shut);
  window.addEventListener("resize", function () {
    if (window.innerWidth > 992) shut();
  });
}

function initNavigation() {
  document.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function () {
      navigateTo(el.getAttribute("data-nav"));
    });
  });
}

function cycleExamFilter() {
  if (examTypeFilter === "all") examTypeFilter = "TYT";
  else if (examTypeFilter === "TYT") examTypeFilter = "AYT";
  else examTypeFilter = "all";
  const labels = { all: "Tümü", TYT: "TYT", AYT: "AYT" };
  const lab = document.getElementById("searchFilterLabel");
  if (lab) {
    lab.hidden = examTypeFilter === "all";
    lab.textContent = "Deneme: " + labels[examTypeFilter];
  }
  showToast("Liste filtresi: " + labels[examTypeFilter]);
  renderDashboardExams();
  apptCarouselOffset = 0;
  renderDashboardAppointments();
}

function cycleExamsPageFilter() {
  if (examsPageFilter === "all") examsPageFilter = "TYT";
  else if (examsPageFilter === "TYT") examsPageFilter = "AYT";
  else examsPageFilter = "all";
  const labels = { all: "Tümü", TYT: "TYT", AYT: "AYT" };
  const btn = document.getElementById("btnExamsFilter");
  if (btn) btn.innerHTML = '<i class="fa-solid fa-filter"></i> Filtre: ' + labels[examsPageFilter];
  renderExamsFullPage();
  showToast("Sayfa filtresi: " + labels[examsPageFilter]);
}

function initAllButtons() {
  function openApptModal() {
    openAppointmentModalNew();
  }
  function openPayModal() {
    openPaymentModalNew();
  }

  var elNewSt = document.getElementById("btnNewStudent");
  if (elNewSt)
    elNewSt.addEventListener("click", function () {
      openStudentModal();
    });
  var elQuickSt = document.getElementById("quickAddStudent");
  if (elQuickSt)
    elQuickSt.addEventListener("click", function () {
      openStudentModal();
    });
  var elPageSt = document.getElementById("btnPageAddStudent");
  if (elPageSt)
    elPageSt.addEventListener("click", function () {
      openStudentModal();
    });

  document.getElementById("btnApptPrev") &&
    document.getElementById("btnApptPrev").addEventListener("click", function () {
      apptCarouselOffset = Math.max(0, apptCarouselOffset - 1);
      renderDashboardAppointments();
    });
  document.getElementById("btnApptNext") &&
    document.getElementById("btnApptNext").addEventListener("click", function () {
      apptCarouselOffset += 1;
      renderDashboardAppointments();
    });

  var searchEl = document.getElementById("searchInput");
  if (searchEl) {
    var debounce;
    searchEl.addEventListener("input", function () {
      searchQuery = searchEl.value || "";
      apptCarouselOffset = 0;
      clearTimeout(debounce);
      debounce = setTimeout(function () {
        renderDashboardExams();
        renderDashboardAppointments();
      }, 200);
    });
  }
  document.getElementById("btnSearchFilter") &&
    document.getElementById("btnSearchFilter").addEventListener("click", cycleExamFilter);

  document.getElementById("btnSeeAllExams") &&
    document.getElementById("btnSeeAllExams").addEventListener("click", function () {
      navigateTo("denemeler");
    });
  document.getElementById("btnExamsFilter") &&
    document.getElementById("btnExamsFilter").addEventListener("click", cycleExamsPageFilter);
  var elAddEx = document.getElementById("btnAddExamRecord");
  if (elAddEx) elAddEx.addEventListener("click", openExamModalNew);

  var elQuickAppt = document.getElementById("quickRandevu");
  if (elQuickAppt) elQuickAppt.addEventListener("click", openApptModal);
  var elQuickTest = document.getElementById("quickTest");
  if (elQuickTest)
    elQuickTest.addEventListener("click", function () {
      navigateTo("testmaker");
    });
  var elAllSt = document.getElementById("btnAllStudents");
  if (elAllSt)
    elAllSt.addEventListener("click", function () {
      navigateTo("ogrenciler");
    });

  var elNewAppt = document.getElementById("btnNewAppointment");
  if (elNewAppt) elNewAppt.addEventListener("click", openApptModal);
  var elTestBank = document.getElementById("btnTestBank");
  if (elTestBank)
    elTestBank.addEventListener("click", function () {
      showToast("Soru bankası — workspace’te görsel/PDF ile soru ekleyebilirsiniz.");
    });

  document.getElementById("btnNewPayment") &&
    document.getElementById("btnNewPayment").addEventListener("click", openPayModal);
  document.getElementById("btnStatIncome") &&
    document.getElementById("btnStatIncome").addEventListener("click", function () {
      showToast("Aylık tahsilat raporu yakında.");
    });
  document.getElementById("btnStatPending") &&
    document.getElementById("btnStatPending").addEventListener("click", function () {
      showToast("Bekleyen ödemeler listesi yakında.");
    });

  document.getElementById("btnProfileMenu") &&
    document.getElementById("btnProfileMenu").addEventListener("click", function () {
      showToast("Profil menüsü — ayarlar yakında.");
    });
  document.getElementById("btnNotify") &&
    document.getElementById("btnNotify").addEventListener("click", function () {
      showToast("Bildirimler yakında.");
    });
  document.getElementById("btnProfileSettings") &&
    document.getElementById("btnProfileSettings").addEventListener("click", function () {
      showToast("Ayarlar yakında.");
    });
  document.getElementById("btnMessages") &&
    document.getElementById("btnMessages").addEventListener("click", function () {
      showToast("Mesajlar yakında.");
    });

  document.getElementById("btnLogout") &&
    document.getElementById("btnLogout").addEventListener("click", function (e) {
      e.preventDefault();
      if (!confirm("Çıkış yapılsın mı?")) return;
      localStorage.removeItem("currentUser");
      signOut(auth).finally(function () {
        window.location.replace("login.html");
      });
    });

  document.addEventListener("click", function (e) {
    var t = e.target;
    var delSt = t.closest && t.closest("[data-del-student]");
    if (delSt) {
      e.preventDefault();
      firestoreDeleteConfirmed("students", delSt.getAttribute("data-del-student"));
      return;
    }
    var edSt = t.closest && t.closest("[data-edit-student]");
    if (edSt) {
      e.preventDefault();
      editStudent(edSt.getAttribute("data-edit-student"));
      return;
    }
    var delAp = t.closest && t.closest("[data-del-appt]");
    if (delAp) {
      e.preventDefault();
      firestoreDeleteConfirmed("appointments", delAp.getAttribute("data-del-appt"));
      return;
    }
    var edAp = t.closest && t.closest("[data-edit-appt]");
    if (edAp) {
      e.preventDefault();
      openAppointmentModalEdit(edAp.getAttribute("data-edit-appt"));
      return;
    }
    var delEx = t.closest && t.closest("[data-del-exam]");
    if (delEx) {
      e.preventDefault();
      firestoreDeleteConfirmed("exams", delEx.getAttribute("data-del-exam"));
      return;
    }
    var edEx = t.closest && t.closest("[data-edit-exam]");
    if (edEx) {
      e.preventDefault();
      openExamModalEdit(edEx.getAttribute("data-edit-exam"));
      return;
    }
    var delPay = t.closest && t.closest("[data-del-payment]");
    if (delPay) {
      e.preventDefault();
      firestoreDeleteConfirmed("payments", delPay.getAttribute("data-del-payment"));
      return;
    }
    var edPay = t.closest && t.closest("[data-edit-payment]");
    if (edPay) {
      e.preventDefault();
      openPaymentModalEdit(edPay.getAttribute("data-edit-payment"));
      return;
    }
    var delTest = t.closest && t.closest("[data-del-test]");
    if (delTest) {
      e.preventDefault();
      firestoreDeleteConfirmed("tests", delTest.getAttribute("data-del-test"));
      return;
    }
    var edTest = t.closest && t.closest("[data-edit-test]");
    if (edTest) {
      e.preventDefault();
      openTestModalEdit(edTest.getAttribute("data-edit-test"));
      return;
    }
  });
}

window.YKSPanel = {
  navigate: navigateTo,
  getView: function () {
    return currentView;
  },
  onNavigate: function (fn) {
    if (typeof fn === "function") navigateCallbacks.push(fn);
  },
  toast: showToast,
  openStudentForm: openStudentModal,
  openAppointmentForm: openAppointmentModalNew,
  closeModals: closeAllModals,
  closeModal: closeModal,
};

function showLoadTimeoutWarning() {
  const row = document.getElementById("appointmentsRow");
  const tbody = document.getElementById("denemeTableBody");
  if (row && row.querySelector(".empty-hint--loading")) {
    row.innerHTML =
      '<p class="empty-hint empty-hint--error">Sayfayı <code>http://</code> ile açın (Live Server).</p>';
  }
  if (tbody && /Yükleniyor/i.test(tbody.textContent || "")) {
    tbody.innerHTML =
      '<tr><td colspan="5" class="table-empty table-empty--error">HTTP ile açın.</td></tr>';
  }
}

function bootstrapKocPanelAfterAuth() {
  if (kocPanelBootstrapped) return;
  kocPanelBootstrapped = true;
  initSidebar();
  initNavigation();
  initModals();
  initAllButtons();
  updateCoachProfile();
  subscribeFirestore();
  navigateTo("dashboard");
  setTimeout(showLoadTimeoutWarning, 12000);
}

onAuthStateChanged(auth, function (user) {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  getDoc(doc(db, "users", user.uid))
    .then(function (snap) {
      var profile = snap.data();
      if (!profile || !profile.role) {
        return signOut(auth).then(function () {
          window.location.replace("login.html");
        });
      }
      if (profile.role === "admin") {
        var viewAs = "";
        try {
          viewAs = (sessionStorage.getItem("superAdminViewAsCoach") || "").trim();
        } catch (e) {}
        if (viewAs) {
          showImpersonateBanner(viewAs);
          bootstrapKocPanelAfterAuth();
          return;
        }
        window.location.replace("super-admin.html");
        return;
      }
      if (profile.role !== "coach") {
        return signOut(auth).then(function () {
          window.location.replace("login.html");
        });
      }
      var uname = profile.username;
      if (!uname && user.email) uname = user.email.split("@")[0];
      localStorage.setItem("currentUser", (uname || "").trim());
      bootstrapKocPanelAfterAuth();
    })
    .catch(function () {
      signOut(auth).finally(function () {
        window.location.replace("login.html");
      });
    });
});
