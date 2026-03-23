/**
 * YKS Koçluk — Panel (Firestore + tüm butonlar)
 * Menüye özellik eklemek için: window.YKSPanel.onNavigate(fn) veya data-nav ile navigate
 */

import {
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  collection,
  onSnapshot,
  addDoc,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  Timestamp,
  query,
  where,
  getDoc,
  getDocs,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

import { YKS_TYT_BRANCHES, YKS_AYT_BY_ALAN, netFromDy, clampDy } from "./yks-exam-structure.js";
import { yksMufredatDatasi } from "./yks-mufredat-data.js";
import { db, auth, studentCreatorAuthKoc as studentCreatorAuth } from "./firebase-config.js";
import {
  saveSoruHavuzuEntry,
  saveManyAiQuestionsToPool,
  dataUrlToBlob,
  fetchSoruHavuzuForCoach,
  deleteSoruHavuzuDoc,
  setSoruHavuzuCozuldu,
  getPoolCoachKey,
} from "./soru-havuzu-core.js";

(function () {
  var el = document.getElementById("appointmentsRow");
  if (el) el.dataset.panelOk = "1";
})();

/** Koç oturumunu düşürmeden öğrenci hesabı oluşturmak için (login.js ile aynı @sistem.com) — auth: studentCreatorAuth (firebase-config) */
const STUDENT_EMAIL_DOMAIN = "@sistem.com";

function sanitizeStudentPortalUsername(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

let kocPanelBootstrapped = false;

/** SPA: script yüklendiği anda (auth beklemeden) gizli olması gereken katmanları kapat */
(function kocPanelRemoveLegacyHavuzPicker() {
  try {
    var ov = document.getElementById("tmHavuzPickerOverlay");
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var btn = document.getElementById("tmBtnOpenHavuzPicker");
    if (btn && btn.parentNode) btn.parentNode.parentNode.removeChild(btn.parentNode);
  } catch (e) {}
})();

(function kocPanelSpaShellEarly() {
  try {
    if (!document.body) return;
    document.body.classList.remove("tm-annotate-open");
    var sh = document.getElementById("avatarGallerySheet");
    if (sh) {
      sh.hidden = true;
      sh.setAttribute("aria-hidden", "true");
    }
    var ann = document.getElementById("viewPdfDuzenle");
    if (ann) {
      ann.hidden = true;
      ann.setAttribute("hidden", "");
    }
  } catch (e) {}
})();

function getCoachId() {
  try {
    var imp = sessionStorage.getItem("superAdminViewAsCoach");
    if (imp && String(imp).trim()) return String(imp).trim();
  } catch (e) {}
  return (localStorage.getItem("currentUser") || "").trim();
}

/** localStorage boşsa Firebase oturumundan kullanıcı adı (giriş e-postası @ öncesi) */
function getCoachIdResolved() {
  var c = getCoachId();
  if (c) return c;
  try {
    var u = auth.currentUser;
    if (u && u.email) {
      var part = String(u.email)
        .split("@")[0]
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_]/g, "");
      if (part) return part;
    }
  } catch (e) {}
  return getPoolCoachKey() || "";
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
let cachedCoachTasks = [];
let currentStudentDetailId = null;
var gorevFilterBound = false;
let tmWsCropper = null;
/** TestMaker Kaynak & kırpma: Soru Kırpma ile aynı PDF.js + sürükleyerek seçim (Cropper.js yok) */
var tmWsMcWrapEl = null;
var tmWsMcInnerEl = null;
var tmWsMcSlotCssW = 0;
var tmWsMcSlotCssH = 0;
var tmWsMcRenderScale = 1;
var tmWsMcPageGapPx = 8;
var tmWsMcScrollRaf = 0;
var tmWsMcSlotPromises = {};
var tmWsLastCropDataUrl = "";
var tmWsManualCropBuiltDocRef = null;
var tmWsMcSingleImageMode = false;
var tmWsMcDragging = false;
var tmWsMcDragMain = null;
var tmWsMcDragWrapper = null;
var tmWsMcDragBox = null;
var tmWsMcDragOx = 0;
var tmWsMcDragOy = 0;
/** TestMaker Kaynak & kırpma PDF önizleme: 1 = sığdır, büyütmek daha net kırpma pikseli üretir */
var tmWsMcZoom = 1;
var tmWsMcPanMode = false;
var tmWsMcPdfPanning = false;
var tmWsMcPdfPanLastX = 0;
var tmWsMcPdfPanLastY = 0;
var TM_WS_MC_ZOOM_MIN = 0.5;
var TM_WS_MC_ZOOM_MAX = 2.75;
var TM_WS_MC_ZOOM_STEP = 1.12;
var tmWsManualCropListenersBound = false;
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
let tmHeaderLogoDataUrl = "";
let tmWsPdfBytes = null;
let tmEditorPageOrder = [];
let tmEditorCurrentIdx = 0;
let tmEditorTool = "draw";
let tmEditorDrawing = false;
let tmEditorPdfScale = 1.45;
let tmEditorShapeDraft = null;
let tmEditorDirty = false;
let tmEditorTempPoint = null;
let tmEditorAnnotations = {};
let tmEditorRedoStack = [];
let tmAnnotReturnSubView = "testmaker";
const TM_TEMPLATE_IDS = ["osym", "vip", "foy", "t01", "t02", "t03", "t04", "t05", "t06", "t07"];
const TM_TEMPLATE_LEGACY_MAP = { t08: "t07", t09: "t07", t10: "t07" };
function tmNormalizeTemplateMode(m) {
  m = String(m || "osym").trim();
  if (TM_TEMPLATE_LEGACY_MAP[m]) m = TM_TEMPLATE_LEGACY_MAP[m];
  if (TM_TEMPLATE_IDS.indexOf(m) === -1) m = "osym";
  return m;
}
function tmTemplatePaperClasses() {
  return TM_TEMPLATE_IDS.map(function (id) {
    return "tm-template-" + id;
  });
}
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
          out.push({
            id: c.value.id,
            name: c.value.name,
            addedAt: c.value.addedAt,
            kind: c.value.kind || "pdf",
          });
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
            '<button type="button" class="tm-library__item-del" data-lib-edit="' +
            escapeHtml(it.id) +
            '" aria-label="Düzenle"><i class="fa-solid fa-pen"></i></button>' +
            '<button type="button" class="tm-library__item-del" data-lib-del="' +
            escapeHtml(it.id) +
            '" aria-label="Sil"><i class="fa-solid fa-trash"></i></button></li>'
          );
        })
        .join("");
      tmRenderSavedPdfLibrary(items);
    })
    .catch(function (e) {
      console.error(e);
      ul.innerHTML = '<li class="tm-library__empty">Kitaplık okunamadı.</li>';
    });
}

function tmSavedPdfRowHtml(it, withCover) {
  var kind = it.kind || "pdf";
  var tag =
    kind === "layout"
      ? ' <span class="tm-library__item-kind">Mizanpaj</span>'
      : "";
  var cover =
    withCover && kind !== "layout"
      ? '<div class="tm-saved-pdf-item__cover" aria-hidden="true"><i class="fa-solid fa-file-pdf"></i><span>PDF</span></div>'
      : "";
  return (
    '<li class="tm-saved-pdf-item" data-lib-id="' +
    escapeHtml(it.id) +
    '" data-lib-kind="' +
    escapeHtml(kind) +
    '">' +
    cover +
    '<span class="tm-saved-pdf-item__name">' +
    escapeHtml(it.name) +
    tag +
    '</span><div class="tm-saved-pdf-item__actions"><button type="button" class="is-edit" data-lib-edit="' +
    escapeHtml(it.id) +
    '"><i class="fa-solid fa-pen"></i> Düzenle</button><button type="button" class="is-del" data-lib-del="' +
    escapeHtml(it.id) +
    '"><i class="fa-solid fa-trash"></i> Sil</button></div></li>'
  );
}

function tmRenderSavedPdfLibrary(items) {
  var host = document.getElementById("tmSavedPdfLibrary");
  var hostPdfEd = document.getElementById("tmPdfEditorSavedList");
  var list = Array.isArray(items) ? items : [];
  if (host) {
    if (!list.length) {
      host.innerHTML = '<li class="tm-library__empty">Hazır PDF yok.</li>';
    } else {
      host.innerHTML = list.map(function (it) {
        return tmSavedPdfRowHtml(it, false);
      }).join("");
    }
  }
  if (hostPdfEd) {
    var pdfs = list.filter(function (it) {
      return (it.kind || "pdf") !== "layout";
    });
    if (!pdfs.length) {
      hostPdfEd.innerHTML =
        '<li class="tm-library__empty">Henüz PDF yok. <strong>PDF yükle</strong> ile ekleyin veya Kütüphane’den aktarın.</li>';
    } else {
      hostPdfEd.innerHTML = pdfs
        .map(function (it) {
          return tmSavedPdfRowHtml(it, true);
        })
        .join("");
    }
  }
}

function tmAnnotatorOpen() {
  var ann = document.getElementById("viewPdfDuzenle");
  var lib = document.getElementById("view-library");
  var cre = document.getElementById("tmViewCreator");
  var headTest = document.querySelector("#tmWorkspaceRoot .tm-workspace__header");
  var headLib = document.querySelector("#view-library .tm-workspace__header");
  var headPdf = document.querySelector("#view-pdf-editor .tm-workspace__header");
  var headAuto = document.querySelector("#view-auto-test .tm-workspace__header");
  var headCrop = document.querySelector("#view-pdf-cropper .tm-workspace__header");
  if (currentView === "library") tmAnnotReturnSubView = "library";
  else if (currentView === "pdf-editor") tmAnnotReturnSubView = "pdf-editor";
  else if (currentView === "auto-test") tmAnnotReturnSubView = "auto-test";
  else if (currentView === "pdf-cropper") tmAnnotReturnSubView = "pdf-cropper";
  else tmAnnotReturnSubView = "testmaker";
  if (ann) ann.hidden = false;
  document.body.classList.add("tm-annotate-open");
  if (lib) lib.hidden = true;
  if (cre) cre.hidden = true;
  if (headTest) headTest.hidden = true;
  if (headLib) headLib.hidden = true;
  if (headPdf) headPdf.hidden = true;
  if (headAuto) headAuto.hidden = true;
  if (headCrop) headCrop.hidden = true;
  tmAnnotToolSync();
  tmEditorBindCanvas();
}

function tmAnnotatorClose() {
  var ann = document.getElementById("viewPdfDuzenle");
  if (ann) ann.hidden = true;
  document.body.classList.remove("tm-annotate-open");
  var ret = tmAnnotReturnSubView;
  if (ret === "library") navigateTo("library");
  else if (ret === "pdf-editor") navigateTo("pdf-editor");
  else if (ret === "auto-test") navigateTo("auto-test");
  else if (ret === "pdf-cropper") navigateTo("pdf-cropper");
  else navigateTo("testmaker");
}

function testmakerSetSubView(mode) {
  navigateTo(mode === "library" ? "library" : "testmaker");
}

function tmSyncRibbonActive(view) {
  document.querySelectorAll("[data-tm-ribbon-nav]").forEach(function (btn) {
    var v = btn.getAttribute("data-tm-ribbon-nav");
    btn.classList.toggle("is-active", v === view);
  });
}

/** TYT/AYT müfredat mock verisi — `js/yks-mufredat-data.js` (yksMufredatDatasi) */
var yksAiCurriculum = yksMufredatDatasi;
try {
  window.yksMufredatDatasi = yksMufredatDatasi;
} catch (e) {}

var tmAiGenWizardBound = false;

/**
 * Sahte AI API: her seferinde yeni rastgele ID + placehold.co görsel kanıt URL’si.
 * @param {string} ders
 * @param {string} konu
 * @param {string} zorluk
 * @param {number} miktar
 * @returns {Promise<Array<{id:string,ders:string,konu:string,zorluk:string,imageUrl:string}>>}
 */
function fetchAIGeneratedQuestions(ders, konu, zorluk, miktar) {
  return new Promise(function (resolve, reject) {
    var n = Math.max(1, Math.min(80, parseInt(miktar, 10) || 1));
    var dersStr = String(ders || "").trim() || "Ders";
    var konuStr = String(konu || "").trim() || "Konu";
    var zStr = String(zorluk || "").trim() || "Orta";
    window.setTimeout(function () {
      try {
        var used = {};
        var list = [];
        for (var i = 0; i < n; i++) {
          var rid;
          do {
            rid = Math.floor(1000 + Math.random() * 90000);
          } while (used[rid]);
          used[rid] = true;
          var idTag = "#Q-" + rid;
          var textBody =
            dersStr + "\n" + konuStr + "\n" + "Zorluk: " + zStr + "\n" + "ID: " + rid;
          var imageUrl =
            "https://placehold.co/800x400/ffffff/1f2937?text=" + encodeURIComponent(textBody);
          list.push({
            id: idTag,
            ders: dersStr,
            konu: konuStr,
            zorluk: zStr,
            imageUrl: imageUrl,
          });
        }
        resolve(list);
      } catch (e) {
        reject(e);
      }
    }, 400);
  });
}

function tmSetAiGenOverlayOpen(isOpen) {
  var el = document.getElementById("tmAiGenOverlay");
  if (!el) return;
  if (isOpen) {
    el.classList.add("tm-ai-gen-overlay--open");
    el.removeAttribute("hidden");
    el.setAttribute("aria-hidden", "false");
  } else {
    el.classList.remove("tm-ai-gen-overlay--open");
    el.setAttribute("hidden", "");
    el.setAttribute("aria-hidden", "true");
  }
}

function tmRemoveAllQuestionItemsFromA4() {
  tmGetQuestionPapers().forEach(function (paper) {
    ["1", "2"].forEach(function (k) {
      var col = paper.querySelector('[data-tm-col="' + k + '"]');
      if (!col) return;
      col.querySelectorAll(".tm-a4-block.question-item").forEach(function (el) {
        el.remove();
      });
    });
    var sing = paper.querySelector(".tm-a4-single");
    if (sing) {
      sing.querySelectorAll(".tm-a4-block.question-item").forEach(function (el) {
        el.remove();
      });
    }
  });
  tmRemoveExtraA4Pages();
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
}

/** Mock API çıktısı: placehold.co <img> + ince meta (açık tema); gri div kullanılmaz */
function tmAppendAiMockQuestionBlock(q) {
  var src = (q && (q.imageUrl || q.image)) || "";
  if (!q || !src) return;
  var wrap = document.createElement("div");
  wrap.className = "tm-a4-block question-item tm-a4-block--ai-mock";
  if (q.id) wrap.setAttribute("data-tm-ai-qid", q.id);
  wrap.draggable = true;
  wrap.setAttribute("data-tm-drag", "1");
  var badge = document.createElement("div");
  badge.className = "tm-q-badge";
  badge.textContent = "Soru …)";
  var meta = document.createElement("div");
  meta.className = "tm-ai-soru-meta";
  meta.textContent =
    (q.ders || "—") + " — " + (q.konu || "—") + " — Zorluk: " + (q.zorluk || "—");
  var imgW = document.createElement("div");
  imgW.className = "tm-a4-block__imgwrap";
  var img = document.createElement("img");
  img.className = "tm-ai-mock-q-img";
  img.setAttribute("crossorigin", "anonymous");
  img.src = src;
  img.alt = (q.id || "Soru") + " — " + (q.ders || "") + " / " + (q.konu || "");
  img.draggable = false;
  img.setAttribute(
    "style",
    "width:100%;height:auto;border-radius:4px;border:1px solid #e5e7eb;display:block;"
  );
  imgW.appendChild(img);
  var xb = document.createElement("button");
  xb.type = "button";
  xb.className = "tm-a4-block__x";
  xb.setAttribute("aria-label", "Kaldır");
  xb.draggable = false;
  xb.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  wrap.appendChild(badge);
  wrap.appendChild(meta);
  wrap.appendChild(imgW);
  wrap.appendChild(xb);
  tmAppendBlockToPaginatedColumns(wrap);
}

function tmAddAiMockQuestionsFromList(questions) {
  if (!questions || !questions.length) return;
  questions.forEach(function (q) {
    tmAppendAiMockQuestionBlock(q);
  });
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
}

function tmApplyAiGenerationToTestmaker(payload, questions) {
  if (!payload) return;
  tmRemoveAllQuestionItemsFromA4();
  var courseEl = document.getElementById("tmWsCourse");
  var topicEl = document.getElementById("tmWsTopic");
  var titleEl = document.getElementById("tmWsTitle");
  var diffEl = document.getElementById("tmWsDiff");
  var subjEl = document.getElementById("tmWsSubject");
  if (courseEl) courseEl.value = payload.subject || "";
  if (topicEl) topicEl.value = payload.topic || "";
  if (titleEl) {
    titleEl.value =
      "AI Test · " +
      (payload.exam || "") +
      " · " +
      (payload.subject || "") +
      " · " +
      (payload.topic || "");
  }
  if (diffEl && payload.diff) {
    var want = String(payload.diff);
    var ok = false;
    for (var i = 0; i < diffEl.options.length; i++) {
      if (diffEl.options[i].value === want) {
        diffEl.selectedIndex = i;
        ok = true;
        break;
      }
    }
    if (!ok) {
      for (var j = 0; j < diffEl.options.length; j++) {
        if (diffEl.options[j].value === "Orta") {
          diffEl.selectedIndex = j;
          break;
        }
      }
    }
  }
  if (subjEl && payload.subject) {
    var sub = String(payload.subject);
    var found = false;
    for (var k = 0; k < subjEl.options.length; k++) {
      if (subjEl.options[k].value === sub) {
        subjEl.selectedIndex = k;
        found = true;
        break;
      }
    }
    if (!found) {
      for (var d = 0; d < subjEl.options.length; d++) {
        if (subjEl.options[d].value === "Diğer") {
          subjEl.selectedIndex = d;
          break;
        }
      }
    }
  }
  try {
    tmSyncPaperHeaders();
  } catch (eHdr) {}
  if (questions && questions.length) {
    tmAddAiMockQuestionsFromList(questions);
    showToast("AI taslağı hazır: " + questions.length + " soru yerleştirildi.");
  } else {
    showToast("Sorular oluşturulamadı.");
  }
}

function initAiTestGenWizard() {
  if (tmAiGenWizardBound) return;
  var form = document.getElementById("formAiTestGen");
  var exam = document.getElementById("aiExamType");
  var subj = document.getElementById("aiSubject");
  var topic = document.getElementById("aiTopic");
  if (!form || !exam || !subj || !topic) return;
  tmAiGenWizardBound = true;

  function fillSubjects() {
    var key = exam.value || "TYT";
    var data = yksAiCurriculum[key] || {};
    subj.innerHTML = "";
    Object.keys(data).forEach(function (name) {
      var o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      subj.appendChild(o);
    });
    fillTopics();
  }

  function fillTopics() {
    var key = exam.value || "TYT";
    var course = subj.value;
    var list = (yksAiCurriculum[key] && yksAiCurriculum[key][course]) || [];
    topic.innerHTML = "";
    list.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      topic.appendChild(o);
    });
  }

  exam.addEventListener("change", fillSubjects);
  subj.addEventListener("change", fillTopics);
  fillSubjects();

  var btnAi = document.getElementById("btnAiGenerateTest");

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    if (btnAi && btnAi.disabled) return;
    var n = parseInt(document.getElementById("aiQuestionCount") && document.getElementById("aiQuestionCount").value, 10);
    if (isNaN(n)) n = 10;
    n = Math.max(1, Math.min(80, n));
    var diffEl = document.getElementById("aiDifficulty");
    var payload = {
      exam: exam.value,
      subject: subj.value,
      topic: topic.value,
      count: n,
      diff: diffEl ? diffEl.value : "Orta",
    };
    if (btnAi) btnAi.disabled = true;
    if (tmAiGenNavigateTimer != null) {
      clearTimeout(tmAiGenNavigateTimer);
      tmAiGenNavigateTimer = null;
    }
    tmSetAiGenOverlayOpen(true);
    tmAiGenNavigateTimer = window.setTimeout(function () {
      tmAiGenNavigateTimer = null;
      fetchAIGeneratedQuestions(payload.subject, payload.topic, payload.diff, payload.count)
        .then(function (questions) {
          try {
            tmSetAiGenOverlayOpen(false);
            navigateTo("testmaker");
          } catch (errNav) {
            console.error("AI üretim geçişi:", errNav);
            showToast("Test tasarımına geçilemedi. Tekrar deneyin.");
            tmSetAiGenOverlayOpen(false);
            if (btnAi) btnAi.disabled = false;
            return;
          }
          requestAnimationFrame(function () {
            try {
              tmApplyAiGenerationToTestmaker(payload, questions);
            } catch (errApply) {
              console.error("AI taslak:", errApply);
              showToast("Taslak yerleştirilirken hata oluştu.");
            }
            var cidAi = getCoachId();
            if (cidAi && questions && questions.length) {
              saveManyAiQuestionsToPool(cidAi, questions, {
                ders: payload.subject,
                konu: payload.topic,
                zorluk: payload.diff,
                sinavTipi: payload.exam || "",
              })
                .then(function (n) {
                  if (n > 0) showToast("AI: " + n + " soru soru_havuzu koleksiyonuna kaydedildi.");
                })
                .catch(function (e) {
                  console.warn("[soru_havuzu] AI persist:", e);
                });
            }
            if (btnAi) btnAi.disabled = false;
          });
        })
        .catch(function (errFetch) {
          console.error("fetchAIGeneratedQuestions:", errFetch);
          showToast("Sorular üretilemedi. Tekrar deneyin.");
          tmSetAiGenOverlayOpen(false);
          if (btnAi) btnAi.disabled = false;
        });
    }, 1500);
  });
}

/** Hazır optik formu — OMR benzeri tek sayfa A4 (jsPDF vektör; PDF indirme aynı) */
function tmDownloadOptikTemplatePdf() {
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    showToast("jsPDF yüklenemedi; sayfayı yenileyin.");
    return;
  }
  var J = window.jspdf.jsPDF;
  var doc = new J({ unit: "mm", format: "a4", orientation: "portrait" });
  var Accent = [175, 0, 95];
  var Ink = [35, 35, 42];
  var Grid = [210, 210, 215];
  var Black = [0, 0, 0];
  var fname =
    ((document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value) || "Optik_Form")
      .trim()
      .replace(/[\\/:*?"<>|]/g, "-") || "Optik_Form";

  var W = 210;
  var H = 297;
  var mL = 11;
  var mR = 11;
  var mT = 8;
  var innerL = mL + 5;
  var innerR = W - mR;
  var innerW = innerR - innerL;

  function setAccent() {
    doc.setDrawColor.apply(doc, Accent);
    doc.setTextColor.apply(doc, Accent);
  }
  function setInk() {
    doc.setDrawColor.apply(doc, Ink);
    doc.setTextColor.apply(doc, Ink);
  }
  function setGrid() {
    doc.setDrawColor.apply(doc, Grid);
  }

  doc.setFont("helvetica", "normal");

  doc.setFillColor.apply(doc, Black);
  var tmY;
  for (tmY = mT + 4; tmY < H - 10; tmY += 8.2) {
    doc.rect(3.2, tmY, 2.6, 4.8, "F");
  }

  setAccent();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text("OPTIK CEVAP FORMU", W / 2, mT + 3, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.2);
  doc.text("210 x 297 mm (A4)  |  Okuyucu hizasi icin sol kenar siyah bloklar", W / 2, mT + 7, { align: "center" });

  setInk();
  doc.setLineWidth(0.35);
  setAccent();
  doc.rect(innerL, mT + 10, innerW, 26);

  doc.setLineWidth(0.12);
  setInk();
  doc.setFontSize(7);
  doc.text("ADI - SOYADI (duz harflerle yaziniz):", innerL + 2, mT + 15);
  doc.line(innerL + 52, mT + 14.2, innerR - 2, mT + 14.2);

  doc.text("TEST / DENEME ADI:", innerL + 2, mT + 21);
  doc.line(innerL + 38, mT + 20.2, innerL + 118, mT + 20.2);
  doc.text("SINAV TARIHI (GG.AA.YYYY):", innerL + 120, mT + 21);
  doc.line(innerL + 158, mT + 20.2, innerR - 2, mT + 20.2);

  doc.setFontSize(6);
  doc.setTextColor(120, 120, 125);
  doc.text("Ad ve soyad arasinda bir bosluk birakiniz.", innerL + 2, mT + 25.5);
  doc.setTextColor.apply(doc, Ink);

  /** Daire merkezine göre metin — A4 OMR okunabilirliği için */
  function tmOptikTextInCircle(cx, cy, txt, fontPt, useBold) {
    doc.setFont("helvetica", useBold ? "bold" : "normal");
    doc.setFontSize(fontPt);
    setInk();
    try {
      doc.text(String(txt), cx, cy, { align: "center", baseline: "middle" });
    } catch (err) {
      var fh = (fontPt * 0.352778) / 2;
      doc.text(String(txt), cx, cy + fh * 0.22, { align: "center" });
    }
  }

  var blockTop = mT + 38;
  var studentBlockH = 62;
  setAccent();
  doc.setLineWidth(0.28);
  doc.rect(innerL, blockTop, innerW, studentBlockH);

  doc.setFontSize(7);
  doc.setFont("helvetica", "bold");
  doc.text("SINIF", innerL + 3, blockTop + 5.2);
  doc.setFont("helvetica", "normal");
  var grades = [
    { t: "9", y: 0 },
    { t: "10", y: 1 },
    { t: "11", y: 2 },
    { t: "12", y: 3 },
    { t: "MZ", y: 4 },
    { t: "HAZ", y: 5 },
  ];
  var gradeCircleR = 1.38;
  var gx;
  for (gx = 0; gx < grades.length; gx++) {
    var gy = blockTop + 9.5 + grades[gx].y * 5.45;
    doc.setFontSize(7.8);
    setInk();
    doc.text(grades[gx].t, innerL + 3.5, gy, { baseline: "middle" });
    var gcx = innerL + 15;
    setAccent();
    doc.circle(gcx, gy, gradeCircleR);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  setInk();
  doc.text("KITAPCIK TURU (birini isaretleyiniz)", innerL + 24, blockTop + 5.2);
  doc.setFont("helvetica", "normal");
  var bk = ["A", "B", "C", "D", "E"];
  var kitBubbleR = 1.38;
  var kitGap = 9.2;
  var kitCx0 = innerL + 30;
  var kitCy = blockTop + 14.8;
  var bi;
  for (bi = 0; bi < 5; bi++) {
    var kcx = kitCx0 + bi * kitGap;
    setAccent();
    doc.circle(kcx, kitCy, kitBubbleR);
    tmOptikTextInCircle(kcx, kitCy, bk[bi], 6.6, true);
  }

  doc.setFontSize(6);
  setInk();
  doc.text("Ornek:", innerL + 24, blockTop + 23.2);
  var exY = blockTop + 21.8;
  setAccent();
  doc.circle(innerL + 36, exY, 1.25);
  doc.setFontSize(5.8);
  setInk();
  doc.text("yanlis", innerL + 40, exY, { baseline: "middle" });
  doc.setFillColor.apply(doc, Accent);
  doc.circle(innerL + 54, exY, 1.25, "F");
  doc.setFontSize(5.8);
  setInk();
  doc.text("dogru", innerL + 58, exY, { baseline: "middle" });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.text("OGRENCI NUMARASI (10 hane)", innerL + 82, blockTop + 27.5);
  doc.setFont("helvetica", "normal");
  var digitCols = 10;
  var digitColW = 6.85;
  var digitRowH = 2.92;
  var digitBubbleR = 1.18;
  var nx0 = innerL + 80;
  var nyHeader = blockTop + 31.2;
  var nyGrid = blockTop + 34.2;
  var d;
  for (d = 0; d < digitCols; d++) {
    var colCx = nx0 + d * digitColW + digitColW / 2;
    doc.setFontSize(5.8);
    setInk();
    doc.text(String(d + 1) + ".", colCx, nyHeader, { align: "center", baseline: "middle" });
    var digit;
    for (digit = 0; digit <= 9; digit++) {
      var dcy = nyGrid + digit * digitRowH;
      setAccent();
      doc.circle(colCx, dcy, digitBubbleR);
      tmOptikTextInCircle(colCx, dcy, String(digit), 5.1, false);
    }
  }

  var ansTop = blockTop + studentBlockH + 5;
  setAccent();
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("CEVAPLAR", innerL + innerW / 2, ansTop, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  setInk();
  doc.text("Her soruda yalnizca bir secenegi tamamen boyayiniz (A-E).", innerL + innerW / 2, ansTop + 4.5, { align: "center" });

  var rowBoxH = 5.65;
  var rowGap = 0.45;
  var rowStride = rowBoxH + rowGap;
  var yAns = ansTop + 10;
  var midCol = innerL + innerW / 2;
  var boxPad = 0.9;
  var leftBoxX = innerL + boxPad;
  var leftBoxW = innerW / 2 - boxPad * 1.75;
  var rightBoxX = midCol + boxPad * 0.85;
  var rightBoxW = innerW / 2 - boxPad * 1.75;
  var colGap = 8.85;
  var bubbleR = 1.38;
  var optBubbleFs = 6.35;
  var qNumFs = 8.2;
  var lettersOpt = ["A", "B", "C", "D", "E"];
  var ansGridH = 25 * rowStride - rowGap;
  setGrid();
  doc.setLineWidth(0.28);
  doc.setDrawColor.apply(doc, Grid);
  doc.rect(innerL + 0.4, yAns, innerW - 0.8, ansGridH);
  var q;
  for (q = 0; q < 25; q++) {
    var rowCy = yAns + q * rowStride + rowBoxH / 2;
    if (rowCy + rowBoxH / 2 > H - 21) break;
    var boxTop = rowCy - rowBoxH / 2;
    setGrid();
    doc.setLineWidth(0.22);
    doc.setDrawColor.apply(doc, Grid);
    doc.rect(leftBoxX, boxTop, leftBoxW, rowBoxH);
    doc.rect(rightBoxX, boxTop, rightBoxW, rowBoxH);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(qNumFs);
    setInk();
    doc.text(String(q + 1) + ".", leftBoxX + 2.2, rowCy, { baseline: "middle" });
    doc.text(String(q + 26) + ".", rightBoxX + 2.2, rowCy, { baseline: "middle" });
    var bubbleY = rowCy;
    var li;
    var optStartL = leftBoxX + 12.5;
    var optStartR = rightBoxX + 12.5;
    for (li = 0; li < 5; li++) {
      var bxL = optStartL + li * colGap;
      var bxR = optStartR + li * colGap;
      setAccent();
      doc.circle(bxL, bubbleY, bubbleR);
      doc.circle(bxR, bubbleY, bubbleR);
      tmOptikTextInCircle(bxL, bubbleY, lettersOpt[li], optBubbleFs, true);
      tmOptikTextInCircle(bxR, bubbleY, lettersOpt[li], optBubbleFs, true);
    }
  }

  setInk();
  doc.setFontSize(5.8);
  doc.text("DerecePanel - TestMaker optik sablonu", innerL, H - 9);
  doc.text("FORM TURU: TYT / genel (5 secenek)", innerR, H - 9, { align: "right" });
  doc.setFontSize(6);
  doc.text("Kursun kalemle daireleri tamamen doldurunuz; silinti ve fazla isaret gecersiz sayilir.", W / 2, H - 5, { align: "center" });

  try {
    doc.save(fname + "_optik_sablon.pdf");
    showToast("Optik şablon PDF indirildi.");
  } catch (e) {
    console.error("tmDownloadOptikTemplatePdf", e);
    showToast("PDF kaydedilemedi.");
  }
}

function tmAddFreeTextBoxToA4() {
  var papers = tmGetQuestionPapers();
  var paper = papers.length ? papers[papers.length - 1] : null;
  if (!paper) return;
  var area = paper.querySelector(".test-content-area") || paper.querySelector("#testContentArea");
  var col = paper.querySelector('[data-tm-col="1"]') || paper.querySelector("#column-1");
  if (!area || !col) return;
  var empty = paper.querySelector(".tm-a4-empty") || document.getElementById("tmA4Empty");
  if (empty) empty.style.display = "none";
  area.hidden = false;
  var outer = document.createElement("div");
  outer.className = "tm-a4-freetext-wrap";
  var wrap = document.createElement("div");
  wrap.className = "tm-a4-freetext";
  wrap.contentEditable = "true";
  wrap.setAttribute("role", "textbox");
  wrap.setAttribute("aria-label", "Serbest metin");
  wrap.innerHTML = "Metin yazın…";
  var xb = document.createElement("button");
  xb.type = "button";
  xb.className = "tm-a4-freetext__x";
  xb.setAttribute("aria-label", "Kaldır");
  xb.innerHTML = '<i class="fa-solid fa-xmark"></i>';
  xb.addEventListener("click", function (e) {
    e.preventDefault();
    e.stopPropagation();
    outer.remove();
    tmUpdateA4EmptyVisibility();
    tmRenumberTmQuestions();
  });
  xb.tabIndex = -1;
  outer.appendChild(wrap);
  outer.appendChild(xb);
  col.appendChild(outer);
  try {
    wrap.focus();
    var r = document.createRange();
    r.selectNodeContents(wrap);
    r.collapse(false);
    var sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  } catch (e) {}
  tmRenumberTmQuestions();
}

function tmSyncWatermarkLayer() {
  var wm = document.getElementById("tmA4Watermark");
  if (!wm) return;
  var inst =
    (document.getElementById("tmWsInstitution") && document.getElementById("tmWsInstitution").value.trim()) || "";
  var hasLogo = !!tmHeaderLogoDataUrl;
  var show = hasLogo || !!inst;
  wm.hidden = !show;
  wm.setAttribute("aria-hidden", show ? "false" : "true");
  wm.classList.toggle("tm-a4-watermark--logo", hasLogo);
  wm.classList.toggle("tm-a4-watermark--text", !hasLogo && !!inst);
  if (hasLogo) {
    wm.style.backgroundImage = 'url("' + String(tmHeaderLogoDataUrl).replace(/"/g, '\\"') + '")';
    wm.textContent = "";
  } else if (inst) {
    wm.style.backgroundImage = "none";
    wm.textContent = inst;
  } else {
    wm.style.backgroundImage = "none";
    wm.textContent = "";
  }
}

async function tmOpenFirestoreTestInAnnotator(testId) {
  var t = cachedTests.filter(function (x) {
    return x.id === testId;
  })[0];
  if (!t || !t.questionImages || !t.questionImages.length) {
    showToast("Test görseli bulunamadı.");
    return;
  }
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    showToast("jsPDF yüklenemedi; sayfayı yenileyin.");
    return;
  }
  try {
    var J = window.jspdf.jsPDF;
    var doc = new J({ unit: "pt", format: "a4", compress: true });
    var pageW = doc.internal.pageSize.getWidth();
    var pageH = doc.internal.pageSize.getHeight();
    var margin = 28;
    for (var i = 0; i < t.questionImages.length; i++) {
      if (i > 0) doc.addPage();
      var dataUrl = t.questionImages[i];
      var fmt = "JPEG";
      if (typeof dataUrl === "string" && /data:image\/png/i.test(dataUrl)) fmt = "PNG";
      var iw = pageW - margin * 2;
      var ih = pageH - margin * 2;
      try {
        var prop = doc.getImageProperties(dataUrl);
        var rw = prop.width || iw;
        var rh = prop.height || ih;
        var ratio = Math.min(iw / rw, ih / rh);
        var w = rw * ratio;
        var h = rh * ratio;
        var x = (pageW - w) / 2;
        var y = (pageH - h) / 2;
        doc.addImage(dataUrl, fmt, x, y, w, h, undefined, fmt === "PNG" ? "FAST" : "MEDIUM");
      } catch (e1) {
        doc.addImage(dataUrl, fmt, margin, margin, iw, ih);
      }
    }
    var buf = doc.output("arraybuffer");
    await tmWsLoadPdfFromBuffer(buf);
    tmAnnotatorOpen();
    showToast("Test PDF anotasyon editöründe açıldı.");
  } catch (err) {
    console.error(err);
    showToast("Test PDF oluşturulamadı.");
  }
}

function tmCloseAllTmFlyouts() {
  document.querySelectorAll(".tm-flyout").forEach(function (el) {
    el.hidden = true;
  });
  ["tmRailBtnTemplate", "tmRailBtnColor", "tmRailBtnLayout"].forEach(function (rid) {
    var b = document.getElementById(rid);
    if (b) {
      b.classList.remove("is-active");
      b.setAttribute("aria-pressed", "false");
    }
  });
}

function tmLoadLayoutFromLibrary(rec) {
  if (!rec || !rec.payload) return;
  navigateTo("testmaker");
  tmRemoveAnswerKeyPaper();
  tmGetQuestionPapers().forEach(function (paper) {
    paper.querySelectorAll("[data-tm-col]").forEach(function (col) {
      col.innerHTML = "";
    });
  });
  tmRemoveExtraA4Pages();
  var p = rec.payload;
  var c = document.getElementById("a4-pages-container");
  if (c && p.layoutContainerClass) {
    tmSetPageLayout(p.layoutContainerClass.indexOf("layout-6") !== -1 ? 6 : 4);
  }
  if (p.template && document.getElementById("tmTemplate")) {
    var tmSel0 = document.getElementById("tmTemplate");
    var tv0 = String(p.template);
    if (TM_TEMPLATE_LEGACY_MAP[tv0]) tv0 = TM_TEMPLATE_LEGACY_MAP[tv0];
    if (TM_TEMPLATE_IDS.indexOf(tv0) === -1) tv0 = "osym";
    tmSel0.value = tv0;
  }
  tmApplyWorkspaceTemplate();
  if (p.meta) {
    var M = p.meta;
    if (M.institution && document.getElementById("tmWsInstitution")) document.getElementById("tmWsInstitution").value = M.institution;
    if (M.course && document.getElementById("tmWsCourse")) document.getElementById("tmWsCourse").value = M.course;
    if (M.topic && document.getElementById("tmWsTopic")) document.getElementById("tmWsTopic").value = M.topic;
    if (M.testDate && document.getElementById("tmWsTestDate")) document.getElementById("tmWsTestDate").value = M.testDate;
  }
  (p.questionImages || []).forEach(function (src, i) {
    tmAddQuestionToA4(src, (p.questionAnswers && p.questionAnswers[i]) || "");
  });
  if (document.getElementById("tmWsTitle")) document.getElementById("tmWsTitle").value = rec.name || "";
  tmSyncPaperHeaders();
}

async function tmSaveLayoutToLocalLibrary() {
  if (tmTotalQuestionBlocks() === 0) {
    showToast("Önce en az bir soru ekleyin.");
    return;
  }
  var title =
    (document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value.trim()) ||
    "Mizanpaj " + new Date().toLocaleString("tr-TR");
  var order = tmGetOrderedQuestionBlocks();
  var imgs = [];
  var answers = [];
  order.forEach(function (el) {
    var im = el.querySelector("img");
    if (im) imgs.push(im.src);
    answers.push(el.getAttribute("data-tm-answer") || "—");
  });
  var thumb = imgs[0] || "";
  var payload = {
    template: (document.getElementById("tmTemplate") && document.getElementById("tmTemplate").value) || "osym",
    layoutContainerClass: document.getElementById("a4-pages-container")
      ? document.getElementById("a4-pages-container").className
      : "a4-pages-container layout-4",
    meta: {
      institution:
        (document.getElementById("tmWsInstitution") && document.getElementById("tmWsInstitution").value) || "",
      course: (document.getElementById("tmWsCourse") && document.getElementById("tmWsCourse").value) || "",
      topic: (document.getElementById("tmWsTopic") && document.getElementById("tmWsTopic").value) || "",
      testDate: (document.getElementById("tmWsTestDate") && document.getElementById("tmWsTestDate").value) || "",
    },
    questionImages: imgs,
    questionAnswers: answers,
  };
  var id = "layout_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
  try {
    await tmLibPut({
      id: id,
      name: title.slice(0, 180),
      addedAt: Date.now(),
      kind: "layout",
      thumbnail: thumb,
      payload: payload,
    });
    showToast("Kütüphaneye kaydedildi (yerel).");
    tmLibraryRenderList();
    tmLibGetAllMeta().then(tmRenderSavedPdfLibrary);
  } catch (e) {
    console.error(e);
    showToast("Kaydedilemedi.");
  }
}

function tmOpenPdfEditorFromLib(lid) {
  if (!lid) return;
  tmActiveLibId = lid;
  tmLibraryRenderList();
  tmLibGetFull(lid).then(function (rec) {
    if (!rec) {
      showToast("Kayıt bulunamadı.");
      return;
    }
    if (rec.kind === "layout") {
      tmLoadLayoutFromLibrary(rec);
      showToast("Mizanpaj Test Tasarımı’na yüklendi.");
      return;
    }
    if (!rec.buffer) {
      showToast("PDF bulunamadı.");
      return;
    }
    tmWsLoadPdfFromBuffer(rec.buffer).then(function () {
      tmAnnotatorOpen();
      showToast("PDF anotasyon editöründe açıldı.");
    });
  });
}

/* ========== A4 yayıncılık motoru: sayfa başına 4/6 soru + otomatik sayfa ========== */

function tmGetQuestionsPerPage() {
  var c = document.getElementById("a4-pages-container");
  if (c && c.classList.contains("layout-6")) return 6;
  return 4;
}

function tmGetAllPapers() {
  var c = document.getElementById("a4-pages-container");
  if (c) {
    /* Her zaman kapsayıcı içi "kök" kağıtlar: üst üste .a4-paper yoksa tek liste.
       Sadece :scope > .a4-paper + need karşılaştırması, need az kalınca 3. sayfayı PDF'ten düşürebiliyordu. */
    var all = Array.prototype.slice.call(c.querySelectorAll(".a4-paper"));
    var roots = all.filter(function (el) {
      var x = el.parentElement;
      while (x && x !== c) {
        if (x.classList && x.classList.contains("a4-paper")) return false;
        x = x.parentElement;
      }
      return true;
    });
    if (roots.length) return roots;
    var list = [];
    try {
      list = Array.prototype.slice.call(c.querySelectorAll(":scope > .a4-paper"));
    } catch (e) {
      list = Array.prototype.filter.call(c.children, function (el) {
        return el.classList && el.classList.contains("a4-paper");
      });
    }
    return list;
  }
  var p = document.getElementById("tmA4Paper");
  return p ? [p] : [];
}

function tmIsAnswerKeyPaper(el) {
  return el && el.getAttribute && el.getAttribute("data-tm-answer-key") === "1";
}

function tmIsOptikHostPaper(el) {
  return el && el.getAttribute && el.getAttribute("data-tm-optik-host") === "1";
}

function tmIsCorporateCoverPaper(el) {
  return el && el.getAttribute && el.getAttribute("data-tm-corporate-cover") === "1";
}

function tmIsBookCoverPaper(el) {
  return el && el.getAttribute && el.getAttribute("data-tm-book-cover") === "1";
}

function tmGetQuestionPapers() {
  return tmGetAllPapers().filter(function (p) {
    return (
      !tmIsAnswerKeyPaper(p) &&
      !tmIsOptikHostPaper(p) &&
      !tmIsCorporateCoverPaper(p) &&
      !tmIsBookCoverPaper(p)
    );
  });
}

function tmGetOrderedQuestionBlocks() {
  var order = [];
  tmGetQuestionPapers().forEach(function (paper) {
    ["1", "2"].forEach(function (k) {
      var col = paper.querySelector('[data-tm-col="' + k + '"]');
      if (!col) return;
      col.querySelectorAll(".tm-a4-block.question-item").forEach(function (el) {
        order.push(el);
      });
    });
  });
  if (order.length === 0) {
    document.querySelectorAll("#tmA4Single .tm-a4-block.question-item").forEach(function (el) {
      order.push(el);
    });
  }
  return order;
}

function tmCountQuestionsOnPaper(paper) {
  if (!paper) return 0;
  return paper.querySelectorAll(".tm-a4-block.question-item").length;
}

function tmTotalQuestionBlocks() {
  var c = document.getElementById("a4-pages-container");
  if (c) return c.querySelectorAll(".tm-a4-block.question-item").length;
  return document.querySelectorAll("#tmA4Paper .tm-a4-block.question-item, #tmA4Layout .tm-a4-block.question-item").length;
}

function tmGetTargetColumnForSlot(paper, slotIndex0, perPage) {
  var half = perPage / 2;
  var colKey = slotIndex0 < half ? "1" : "2";
  return paper.querySelector('[data-tm-col="' + colKey + '"]');
}

function tmRehomeOptikStrip() {
  var strip = document.getElementById("tmOptikStrip");
  var base = document.getElementById("tmA4Paper");
  if (!strip || !base) return;
  strip.hidden = true;
  var layout = base.querySelector(".tm-a4-layout");
  if (layout) layout.appendChild(strip);
}

/** Kapak ilk sırada, cevap anahtarı en sonda (optik artık A4 içinde değil) */
function tmOrderTrailingPages() {
  var c = document.getElementById("a4-pages-container");
  if (!c) return;
  var corp = c.querySelector(".a4-paper[data-tm-corporate-cover='1']");
  if (corp) c.insertBefore(corp, c.firstChild);
  var ak = c.querySelector(".a4-paper[data-tm-answer-key='1']");
  if (ak) c.appendChild(ak);
}

function tmStripCloneIds(root) {
  root.removeAttribute("id");
  root.querySelectorAll("[id]").forEach(function (n) {
    n.removeAttribute("id");
  });
}

function tmRemoveAnswerKeyPaper() {
  var strip = document.getElementById("tmOptikStrip");
  var p0 = document.getElementById("tmA4Paper");
  if (strip && p0) {
    var lay0 = p0.querySelector(".tm-a4-layout");
    if (lay0) lay0.appendChild(strip);
  }
  var c = document.getElementById("a4-pages-container");
  if (!c) return;
  c.querySelectorAll(
    ".a4-paper[data-tm-answer-key='1'], .a4-paper[data-tm-corporate-cover='1'], .a4-paper[data-tm-optik-host='1'], .a4-paper[data-tm-book-cover='1']"
  ).forEach(function (el) {
    el.remove();
  });
}

function tmRemoveExtraA4Pages() {
  tmRemoveAnswerKeyPaper();
  var c = document.getElementById("a4-pages-container");
  if (!c) return;
  var keep = document.getElementById("tmA4Paper");
  c.querySelectorAll(".a4-paper").forEach(function (p) {
    if (p !== keep) p.remove();
  });
  tmRehomeOptikStrip();
}

function tmCreateNewA4Page() {
  var container = document.getElementById("a4-pages-container");
  var tmpl = document.getElementById("tmA4Paper");
  if (!container || !tmpl) return null;
  var clone = tmpl.cloneNode(true);
  tmStripCloneIds(clone);
  clone.classList.add("tm-a4-page--sub");
  var empty = clone.querySelector(".tm-a4-empty");
  if (empty) empty.style.display = "none";
  var tca = clone.querySelector(".test-content-area");
  if (tca) {
    tca.removeAttribute("hidden");
    tca.hidden = false;
    tca.querySelectorAll("[data-tm-col]").forEach(function (col) {
      col.innerHTML = "";
    });
  }
  var single = clone.querySelector(".tm-a4-single");
  if (single) {
    single.innerHTML = "";
    single.hidden = true;
  }
  var dupOptik = clone.querySelector(".tm-optik-strip");
  if (dupOptik) dupOptik.remove();
  var st = tmpl.getAttribute("style") || "";
  clone.setAttribute("style", st);
  var mode = tmNormalizeTemplateMode(tmpl.getAttribute("data-tm-layout"));
  clone.setAttribute("data-tm-layout", mode);
  tmTemplatePaperClasses().forEach(function (tcl) {
    clone.classList.remove(tcl);
    if (tmpl.classList.contains(tcl)) clone.classList.add(tcl);
  });
  var anchor =
    container.querySelector(".a4-paper[data-tm-optik-host='1']") ||
    container.querySelector(".a4-paper[data-tm-corporate-cover='1']") ||
    container.querySelector(".a4-paper[data-tm-answer-key='1']");
  if (anchor) container.insertBefore(clone, anchor);
  else container.appendChild(clone);
  tmSyncPaperHeaders();
  tmRehomeOptikStrip();
  return clone;
}

function tmEnsureAnswerKeyPaper() {
  var c = document.getElementById("a4-pages-container");
  if (!c) return null;
  var ex = c.querySelector(".a4-paper[data-tm-answer-key='1']");
  if (ex) {
    c.appendChild(ex);
    return ex;
  }
  var tmpl = document.getElementById("tmA4Paper");
  if (!tmpl) return null;
  var clone = tmpl.cloneNode(true);
  tmStripCloneIds(clone);
  clone.classList.add("tm-a4-page--sub", "tm-a4-page--answer-key");
  clone.setAttribute("data-tm-answer-key", "1");
  clone.querySelectorAll(".tm-paper-header").forEach(function (h) {
    h.setAttribute("hidden", "");
    h.hidden = true;
  });
  var wm = clone.querySelector(".tm-a4-watermark");
  if (wm) {
    wm.hidden = true;
    wm.setAttribute("aria-hidden", "true");
  }
  var empty = clone.querySelector(".tm-a4-empty");
  if (empty) empty.remove();
  var tca = clone.querySelector(".test-content-area");
  if (tca) {
    tca.hidden = true;
    tca.setAttribute("hidden", "");
    tca.querySelectorAll("[data-tm-col]").forEach(function (col) {
      col.innerHTML = "";
    });
  }
  var single = clone.querySelector(".tm-a4-single");
  if (single) {
    single.hidden = false;
    single.removeAttribute("hidden");
    single.innerHTML =
      '<div class="tm-answer-key-sheet tm-answer-key-sheet--print">' +
      '<h3 class="tm-answer-key-sheet__title">Cevap Anahtarı</h3>' +
      '<p class="tm-answer-key-sheet__sub">Soru numarası — doğru şıkkı</p>' +
      '<div class="tm-answer-key-sheet__body"></div></div>';
  }
  var dupOptik = clone.querySelector(".tm-optik-strip");
  if (dupOptik) dupOptik.remove();
  var st = tmpl.getAttribute("style") || "";
  clone.setAttribute("style", st);
  var mode = tmNormalizeTemplateMode(tmpl.getAttribute("data-tm-layout"));
  clone.setAttribute("data-tm-layout", mode);
  tmTemplatePaperClasses().forEach(function (tcl) {
    clone.classList.remove(tcl);
    if (tmpl.classList.contains(tcl)) clone.classList.add(tcl);
  });
  c.appendChild(clone);
  return clone;
}

function tmSyncCorporateCoverContent() {
  var paper = document.querySelector(".a4-paper[data-tm-corporate-cover='1']");
  if (!paper) return;
  var title =
    (document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value.trim()) || "Test";
  var inst =
    (document.getElementById("tmWsInstitution") && document.getElementById("tmWsInstitution").value.trim()) || "";
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
  var hTitle = paper.querySelector("[data-tm-corp-title]");
  if (hTitle) hTitle.textContent = title;
  var hInst = paper.querySelector("[data-tm-corp-inst]");
  if (hInst) hInst.textContent = inst || "—";
  var hCt = paper.querySelector("[data-tm-corp-ct]");
  if (hCt) hCt.textContent = (course || "—") + " · " + (topic || "—");
  var hDateFact = paper.querySelector("[data-tm-corp-date-fact]") || paper.querySelector("[data-tm-corp-date]");
  if (hDateFact) hDateFact.textContent = dateStr;
  var hMastInst = paper.querySelector("[data-tm-corp-header-inst]");
  if (hMastInst) hMastInst.textContent = inst || "KURUM ADI";
  var hMastDate = paper.querySelector("[data-tm-corp-header-date]");
  if (hMastDate) hMastDate.textContent = dateStr;
  var hCourse = paper.querySelector("[data-tm-corp-course]");
  if (hCourse) hCourse.textContent = course || "Ders";
  var hTopic = paper.querySelector("[data-tm-corp-topic]");
  if (hTopic) hTopic.textContent = topic || "Konu / ünite";
}

function tmSyncBookCoverContent() {
  var paper = document.querySelector(".a4-paper[data-tm-book-cover='1']");
  if (!paper) return;
  var title =
    (document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value.trim()) || "Test";
  var inst =
    (document.getElementById("tmWsInstitution") && document.getElementById("tmWsInstitution").value.trim()) || "";
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
  var hTitle = paper.querySelector("[data-tm-book-title]");
  if (hTitle) hTitle.textContent = title;
  var hMeta = paper.querySelector("[data-tm-book-meta]");
  if (hMeta) {
    hMeta.textContent =
      (inst ? inst + " · " : "") + (course || "Ders") + (topic ? " — " + topic : "") + " · " + dateStr;
  }
}

function tmEnsureBookCoverPaper() {
  var c = document.getElementById("a4-pages-container");
  if (!c) return null;
  var ex = c.querySelector(".a4-paper[data-tm-book-cover='1']");
  if (ex) {
    c.insertBefore(ex, c.firstChild);
    return ex;
  }
  var tmpl = document.getElementById("tmA4Paper");
  if (!tmpl) return null;
  var clone = tmpl.cloneNode(true);
  tmStripCloneIds(clone);
  clone.classList.add("tm-a4-page--sub", "tm-a4-page--book-cover");
  clone.setAttribute("data-tm-book-cover", "1");
  clone.querySelectorAll(".tm-paper-header").forEach(function (h) {
    h.setAttribute("hidden", "");
    h.hidden = true;
  });
  var empty = clone.querySelector(".tm-a4-empty");
  if (empty) empty.remove();
  var tca = clone.querySelector(".test-content-area");
  if (tca) {
    tca.hidden = true;
    tca.setAttribute("hidden", "");
    tca.querySelectorAll("[data-tm-col]").forEach(function (col) {
      col.innerHTML = "";
    });
  }
  var single = clone.querySelector(".tm-a4-single");
  if (single) {
    single.hidden = false;
    single.removeAttribute("hidden");
    single.innerHTML =
      '<div class="tm-book-cover-sheet">' +
      '<p class="tm-book-cover-sheet__ribbon">Kitap kapağı</p>' +
      '<h2 class="tm-book-cover-sheet__title" data-tm-book-title>Test başlığı</h2>' +
      '<p class="tm-book-cover-sheet__meta" data-tm-book-meta>—</p>' +
      '<div class="tm-book-cover-sheet__deco" aria-hidden="true"></div>' +
      '<p class="tm-book-cover-sheet__foot">Bu sayfa PDF’te <strong>ilk sayfa</strong> olarak yer alır; ardından soru sayfaları gelir.</p>' +
      "</div>";
  }
  var dupOptik = clone.querySelector(".tm-optik-strip");
  if (dupOptik) dupOptik.remove();
  var st = tmpl.getAttribute("style") || "";
  clone.setAttribute("style", st);
  var mode = tmNormalizeTemplateMode(tmpl.getAttribute("data-tm-layout"));
  clone.setAttribute("data-tm-layout", mode);
  tmTemplatePaperClasses().forEach(function (tcl) {
    clone.classList.remove(tcl);
    if (tmpl.classList.contains(tcl)) clone.classList.add(tcl);
  });
  c.insertBefore(clone, c.firstChild);
  return clone;
}

function tmEnsureCorporateCoverPaper() {
  var c = document.getElementById("a4-pages-container");
  if (!c) return null;
  var ex = c.querySelector(".a4-paper[data-tm-corporate-cover='1']");
  if (ex) {
    c.insertBefore(ex, c.firstChild);
    return ex;
  }
  var tmpl = document.getElementById("tmA4Paper");
  if (!tmpl) return null;
  var clone = tmpl.cloneNode(true);
  tmStripCloneIds(clone);
  clone.classList.add("tm-a4-page--sub", "tm-a4-page--corporate-cover");
  clone.setAttribute("data-tm-corporate-cover", "1");
  var empty = clone.querySelector(".tm-a4-empty");
  if (empty) empty.remove();
  var tca = clone.querySelector(".test-content-area");
  if (tca) {
    tca.hidden = true;
    tca.setAttribute("hidden", "");
    tca.querySelectorAll("[data-tm-col]").forEach(function (col) {
      col.innerHTML = "";
    });
  }
  var single = clone.querySelector(".tm-a4-single");
  if (single) {
    single.hidden = false;
    single.removeAttribute("hidden");
    single.innerHTML =
      '<div class="tm-corporate-cover-sheet tm-corporate-cover-sheet--spread">' +
      '<header class="tm-corporate-cover-sheet__masthead">' +
      '<span class="tm-corporate-cover-sheet__mast-inst" data-tm-corp-header-inst>KURUM ADI</span>' +
      '<div class="tm-corporate-cover-sheet__mast-center">' +
      '<div class="tm-corporate-cover-sheet__mast-course" data-tm-corp-course>Ders</div>' +
      '<div class="tm-corporate-cover-sheet__mast-topic" data-tm-corp-topic>Konu / ünite</div>' +
      "</div>" +
      '<span class="tm-corporate-cover-sheet__mast-date" data-tm-corp-header-date>—</span>' +
      "</header>" +
      '<hr class="tm-corporate-cover-sheet__mast-rule" />' +
      '<div class="tm-corporate-cover-sheet__twocol" aria-label="Kapak iki sütun alanı">' +
      '<div class="tm-corporate-cover-sheet__twocol-cell"></div>' +
      '<div class="tm-corporate-cover-sheet__twocol-cell"></div>' +
      "</div>" +
      '<div class="tm-corporate-cover-sheet__accent" aria-hidden="true"></div>' +
      '<p class="tm-corporate-cover-sheet__kicker">Kurumsal test dökümanı</p>' +
      '<h2 class="tm-corporate-cover-sheet__title" data-tm-corp-title>Test başlığı</h2>' +
      '<ul class="tm-corporate-cover-sheet__facts">' +
      '<li><span>Kurum</span><strong data-tm-corp-inst>—</strong></li>' +
      '<li><span>Ders / konu</span><strong data-tm-corp-ct>—</strong></li>' +
      '<li><span>Tarih</span><strong data-tm-corp-date-fact>—</strong></li>' +
      "</ul>" +
      '<div class="tm-corporate-cover-sheet__sign">' +
      '<div class="tm-corporate-cover-sheet__sign-line"><span>Öğrenci adı soyadı</span></div>' +
      '<div class="tm-corporate-cover-sheet__sign-line"><span>İmza</span></div>' +
      "</div>" +
      '<p class="tm-corporate-cover-sheet__note">Kapak sayfasıdır; sorular 2. sayfadan başlar. Cevap anahtarı son sayfadadır. Hazır optik için üst şeritte <strong>Optik</strong> ile PDF indirebilirsiniz.</p>' +
      "</div>";
  }
  var dupOptik = clone.querySelector(".tm-optik-strip");
  if (dupOptik) dupOptik.remove();
  var st = tmpl.getAttribute("style") || "";
  clone.setAttribute("style", st);
  var mode = tmNormalizeTemplateMode(tmpl.getAttribute("data-tm-layout"));
  clone.setAttribute("data-tm-layout", mode);
  tmTemplatePaperClasses().forEach(function (tcl) {
    clone.classList.remove(tcl);
    if (tmpl.classList.contains(tcl)) clone.classList.add(tcl);
  });
  c.insertBefore(clone, c.firstChild);
  return clone;
}

function tmEnsureOptikHostPaper() {
  var c = document.getElementById("a4-pages-container");
  if (!c) return null;
  var ex = c.querySelector(".a4-paper[data-tm-optik-host='1']");
  if (ex) return ex;
  var tmpl = document.getElementById("tmA4Paper");
  if (!tmpl) return null;
  var clone = tmpl.cloneNode(true);
  tmStripCloneIds(clone);
  clone.classList.add("tm-a4-page--sub", "tm-a4-page--optik-host");
  clone.setAttribute("data-tm-optik-host", "1");
  var empty = clone.querySelector(".tm-a4-empty");
  if (empty) empty.remove();
  var tca = clone.querySelector(".test-content-area");
  if (tca) {
    tca.hidden = true;
    tca.setAttribute("hidden", "");
    tca.querySelectorAll("[data-tm-col]").forEach(function (col) {
      col.innerHTML = "";
    });
  }
  var single = clone.querySelector(".tm-a4-single");
  if (single) {
    single.innerHTML = "";
    single.hidden = true;
    single.setAttribute("hidden", "");
  }
  var layout = clone.querySelector(".tm-a4-layout");
  if (layout) {
    var wrap = document.createElement("div");
    wrap.className = "tm-optik-host-wrap";
    wrap.innerHTML =
      '<div class="tm-optik-host-heading">' +
      "<h3 class=\"tm-optik-host-title\">Optik işaretleme formu</h3>" +
      '<p class="tm-optik-host-lead">Soru numaralarına göre doğru şıkkı kurşun kalemle işaretleyiniz.</p>' +
      "</div>" +
      '<div class="tm-optik-host-strip-slot"></div>';
    layout.appendChild(wrap);
  }
  var dupOptik = clone.querySelector(".tm-optik-strip");
  if (dupOptik) dupOptik.remove();
  var st = tmpl.getAttribute("style") || "";
  clone.setAttribute("style", st);
  var mode = tmNormalizeTemplateMode(tmpl.getAttribute("data-tm-layout"));
  clone.setAttribute("data-tm-layout", mode);
  tmTemplatePaperClasses().forEach(function (tcl) {
    clone.classList.remove(tcl);
    if (tmpl.classList.contains(tcl)) clone.classList.add(tcl);
  });
  var corp = c.querySelector(".a4-paper[data-tm-corporate-cover='1']");
  var ak = c.querySelector(".a4-paper[data-tm-answer-key='1']");
  if (corp) c.insertBefore(clone, corp);
  else if (ak) c.insertBefore(clone, ak);
  else c.appendChild(clone);
  return clone;
}

function tmSyncAnswerKeyPage() {
  var order = tmGetOrderedQuestionBlocks();
  var c = document.getElementById("a4-pages-container");
  if (!c) return;
  if (order.length === 0) {
    tmRemoveAnswerKeyPaper();
    return;
  }
  c.querySelectorAll(".a4-paper[data-tm-optik-host='1'], .a4-paper[data-tm-book-cover='1']").forEach(function (el) {
    el.remove();
  });
  tmEnsureCorporateCoverPaper();
  var paper = tmEnsureAnswerKeyPaper();
  if (!paper) return;
  tmSyncCorporateCoverContent();
  var body = paper.querySelector(".tm-answer-key-sheet__body");
  if (!body) return;
  body.innerHTML = "";
  var grid = document.createElement("div");
  grid.className = "tm-answer-key-grid tm-answer-key-grid--matrix";
  order.forEach(function (el, idx) {
    var raw = (el.getAttribute("data-tm-answer") || "—").trim();
    var ans = /^[A-Ea-e]$/.test(raw) ? raw.toUpperCase() : raw || "—";
    var cell = document.createElement("div");
    cell.className = "tm-answer-key-grid__cell";
    cell.innerHTML =
      '<span class="tm-ak-num">' +
      String(idx + 1) +
      '</span><span class="tm-ak-val">' +
      escapeHtml(ans) +
      "</span>";
    grid.appendChild(cell);
  });
  body.appendChild(grid);
  c.appendChild(paper);
  tmOrderTrailingPages();
  tmRehomeOptikStrip();
  tmSyncPaperHeaders();
  tmUpdateA4EmptyVisibility();
}

function tmAppendBlockToPaginatedColumns(block) {
  var limit = tmGetQuestionsPerPage();
  var papers = tmGetQuestionPapers();
  if (!papers.length) return;
  var last = papers[papers.length - 1];
  var count = tmCountQuestionsOnPaper(last);
  if (count >= limit) {
    last = tmCreateNewA4Page();
    if (!last) return;
  }
  var col = tmGetTargetColumnForSlot(last, tmCountQuestionsOnPaper(last), limit);
  if (!col) return;
  col.appendChild(block);
}

function tmAddQuestionToA4(imageSrc, answerLetter) {
  if (!imageSrc) return;
  var wrap = document.createElement("div");
  wrap.className = "tm-a4-block question-item";
  wrap.draggable = true;
  wrap.setAttribute("data-tm-drag", "1");
  var raw = answerLetter == null ? "" : String(answerLetter).trim();
  var letter = /^[A-Ea-e]$/.test(raw) ? raw.toUpperCase() : "—";
  wrap.setAttribute("data-tm-answer", letter);
  var badge = document.createElement("div");
  badge.className = "tm-q-badge";
  badge.textContent = "Soru …)";
  var imgW = document.createElement("div");
  imgW.className = "tm-a4-block__imgwrap";
  var img = document.createElement("img");
  img.src = imageSrc;
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
  tmAppendBlockToPaginatedColumns(wrap);
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
}

function tmRedistributeAllQuestions() {
  var blocks = [];
  tmGetQuestionPapers().forEach(function (paper) {
    ["1", "2"].forEach(function (k) {
      var col = paper.querySelector('[data-tm-col="' + k + '"]');
      if (!col) return;
      col.querySelectorAll(".tm-a4-block.question-item").forEach(function (b) {
        blocks.push(b);
      });
    });
  });
  blocks.forEach(function (b) {
    b.remove();
  });
  tmRemoveExtraA4Pages();
  blocks.forEach(function (b) {
    tmAppendBlockToPaginatedColumns(b);
  });
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
}

function tmSetPageLayout(n) {
  n = n === 6 ? 6 : 4;
  var c = document.getElementById("a4-pages-container");
  if (!c) return;
  c.classList.remove("layout-4", "layout-6");
  c.classList.add(n === 6 ? "layout-6" : "layout-4");
  document.querySelectorAll("[data-tm-q-layout]").forEach(function (btn) {
    var v = parseInt(btn.getAttribute("data-tm-q-layout"), 10);
    btn.classList.toggle("is-active", v === n);
  });
  if (tmTotalQuestionBlocks() > 0) tmRedistributeAllQuestions();
}

function tmRenumberTmQuestions() {
  var order = tmGetOrderedQuestionBlocks();
  order.forEach(function (el, idx) {
    var b = el.querySelector(".tm-q-badge");
    if (b) b.textContent = "Soru " + (idx + 1) + ")";
  });
  tmSyncAnswerKeyPage();
}

function tmUpdateA4EmptyVisibility() {
  var n = tmTotalQuestionBlocks();
  var empty = document.getElementById("tmA4Empty");
  var container = document.getElementById("a4-pages-container");
  if (!empty || !container) return;
  if (n === 0) {
    empty.style.display = "flex";
    tmGetAllPapers().forEach(function (p) {
      var ta = p.querySelector(".test-content-area");
      if (ta) ta.hidden = true;
      var si = p.querySelector(".tm-a4-single");
      if (si) si.hidden = true;
    });
    tmRemoveExtraA4Pages();
    return;
  }
  empty.style.display = "none";
  /* tmGetAllPapers() dışında kalan .a4-paper satırlarında hidden kalmasın (PDF / ekran) */
  container.querySelectorAll(".a4-paper").forEach(function (p) {
    if (tmIsAnswerKeyPaper(p)) {
      var taAk = p.querySelector(".test-content-area");
      if (taAk) {
        taAk.hidden = true;
        taAk.setAttribute("hidden", "");
      }
      var siAk = p.querySelector(".tm-a4-single");
      if (siAk) {
        siAk.hidden = false;
        siAk.removeAttribute("hidden");
      }
      return;
    }
    if (tmIsCorporateCoverPaper(p)) {
      var taC = p.querySelector(".test-content-area");
      if (taC) {
        taC.hidden = true;
        taC.setAttribute("hidden", "");
      }
      var siC = p.querySelector(".tm-a4-single");
      if (siC) {
        siC.hidden = false;
        siC.removeAttribute("hidden");
      }
      return;
    }
    if (tmIsOptikHostPaper(p)) {
      var taO = p.querySelector(".test-content-area");
      if (taO) {
        taO.hidden = true;
        taO.setAttribute("hidden", "");
      }
      var siO = p.querySelector(".tm-a4-single");
      if (siO) {
        siO.hidden = true;
        siO.setAttribute("hidden", "");
      }
      return;
    }
    if (tmIsBookCoverPaper(p)) {
      var taB = p.querySelector(".test-content-area");
      if (taB) {
        taB.hidden = true;
        taB.setAttribute("hidden", "");
      }
      var siB = p.querySelector(".tm-a4-single");
      if (siB) {
        siB.hidden = false;
        siB.removeAttribute("hidden");
      }
      return;
    }
    var ta = p.querySelector(".test-content-area");
    if (ta) {
      ta.hidden = false;
      ta.removeAttribute("hidden");
    }
    var si = p.querySelector(".tm-a4-single");
    if (si) si.hidden = true;
  });
}

function tmCollectBlocksFromCurrent(mode) {
  var blocks = [];
  tmGetQuestionPapers().forEach(function (paper) {
    ["1", "2"].forEach(function (k) {
      var col = paper.querySelector('[data-tm-col="' + k + '"]');
      if (!col) return;
      col.querySelectorAll(".tm-a4-block").forEach(function (el) {
        blocks.push(el);
      });
    });
    var s = paper.querySelector(".tm-a4-single");
    if (s)
      s.querySelectorAll(".tm-a4-block").forEach(function (el) {
        blocks.push(el);
      });
  });
  return blocks;
}

function tmMigrateLayoutForTemplate(fromMode, toMode) {
  var blocks = tmCollectBlocksFromCurrent(fromMode);
  tmRemoveAnswerKeyPaper();
  tmGetQuestionPapers().forEach(function (paper) {
    paper.querySelectorAll('[data-tm-col="1"], [data-tm-col="2"]').forEach(function (col) {
      col.innerHTML = "";
    });
    var s = paper.querySelector(".tm-a4-single");
    if (s) s.innerHTML = "";
  });
  tmRemoveExtraA4Pages();
  blocks.forEach(function (b) {
    b.remove();
    tmAppendBlockToPaginatedColumns(b);
  });
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
}

/** @deprecated — yayıncılık motoru tmAddQuestionToA4 kullanır */
function tmGetAppendParent() {
  var paper = document.getElementById("tmA4Paper");
  var empty = document.getElementById("tmA4Empty");
  var dual = document.getElementById("testContentArea");
  var single = document.getElementById("tmA4Single");
  if (!paper || !empty || !dual || !single) return null;
  empty.style.display = "none";
  dual.hidden = false;
  single.hidden = true;
  return document.getElementById("column-1");
}

let tmIroPicker = null;
let tmIroSyncingFromInputs = false;

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

/** HSL (H:0–360, S/L:0–100) → RGB — yayıncılık paleti üretimi */
function tmHslToRgb(h, s, l) {
  function hue2rgb(p, q, t) {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  }
  h = ((Number(h) % 360) + 360) % 360;
  h = h / 360;
  s = Math.max(0, Math.min(100, Number(s))) / 100;
  l = Math.max(0, Math.min(100, Number(l))) / 100;
  var r, g, b;
  if (s === 0) {
    r = g = b = l;
  } else {
    var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    var p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  return {
    r: Math.round(r * 255),
    g: Math.round(g * 255),
    b: Math.round(b * 255),
  };
}

function tmRandRange(min, max) {
  return min + Math.random() * (max - min);
}

/**
 * Benzersiz HEX listesi: Pastel S%40–60 L%85–95; Canlı S%90–100 L%50–60
 */
function tmGenerateUniqueHslHexes(count, sMin, sMax, lMin, lMax) {
  var seen = new Set();
  var out = [];
  var guard = 0;
  var maxIter = Math.max(count * 80, 400);
  while (out.length < count && guard < maxIter) {
    guard++;
    var hue = Math.random() * 360;
    var sat = tmRandRange(sMin, sMax);
    var light = tmRandRange(lMin, lMax);
    var rgb = tmHslToRgb(hue, sat, light);
    var hex = tmRgbToHex(rgb.r, rgb.g, rgb.b);
    if (seen.has(hex)) continue;
    seen.add(hex);
    out.push(hex);
  }
  return out;
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
  var rgbStr = rgb.r + "," + rgb.g + "," + rgb.b;
  tmGetAllPapers().forEach(function (paper) {
    paper.style.setProperty("--tm-accent", x);
    paper.style.setProperty("--accent-color", x);
    paper.style.setProperty("--tm-accent-rgb", rgbStr);
  });
  document.documentElement.style.setProperty("--tm-studio-accent", x);
}

/** skipIro: true ise ColorPicker güncellenmez (iro kaynaklı input döngüsü önleme) */
function tmSyncColorInputsFromHex(hex, skipIro) {
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
  if (!skipIro && tmIroPicker && !tmIroSyncingFromInputs) {
    tmIroSyncingFromInputs = true;
    try {
      tmIroPicker.color.hexString = x;
    } catch (e) {}
    tmIroSyncingFromInputs = false;
  }
}

function tmMarkActivePaletteSwatch(hex) {
  var x = tmNormalizeHex(hex);
  if (!x) return;
  document.querySelectorAll(".tm-swatch--studio").forEach(function (btn) {
    var dh = btn.getAttribute("data-hex");
    btn.classList.toggle("is-active", !!(dh && tmNormalizeHex(dh) === x));
  });
}

function tmApplyAccentFromStudio(hex, skipIroSync) {
  var x = tmNormalizeHex(hex);
  if (!x) return;
  tmApplyAccentHex(x);
  tmSyncColorInputsFromHex(x, !!skipIroSync);
  tmMarkActivePaletteSwatch(x);
  tmUpdateCompSwatches();
}

function tmSetColorStudioTab(mode) {
  var presetView = document.getElementById("tmHazirRenklerView");
  var panelView = document.getElementById("tmRenkPaneliView");
  var tabPreset = document.getElementById("tmColorTabPreset");
  var tabPanel = document.getElementById("tmColorTabPanel");
  var isPreset = mode !== "panel";
  if (presetView) {
    presetView.hidden = !isPreset;
  }
  if (panelView) {
    panelView.hidden = isPreset;
  }
  if (tabPreset) {
    tabPreset.classList.toggle("is-active", isPreset);
    tabPreset.setAttribute("aria-selected", isPreset ? "true" : "false");
  }
  if (tabPanel) {
    tabPanel.classList.toggle("is-active", !isPreset);
    tabPanel.setAttribute("aria-selected", !isPreset ? "true" : "false");
  }
  if (!isPreset) {
    tmEnsureIroPicker();
    requestAnimationFrame(function () {
      try {
        if (tmIroPicker && typeof tmIroPicker.resize === "function") tmIroPicker.resize(undefined);
      } catch (e) {}
    });
  }
}

function tmFillStudioPaletteGrids() {
  var pastelBox = document.getElementById("tmPastelSwatchGrid");
  var vividBox = document.getElementById("tmVividSwatchGrid");
  if (!pastelBox || !vividBox) return;
  var pastels = tmGenerateUniqueHslHexes(40, 40, 60, 85, 95);
  var vivids = tmGenerateUniqueHslHexes(40, 90, 100, 50, 60);
  function fill(box, colors) {
    box.innerHTML = "";
    colors.forEach(function (col) {
      var btn = document.createElement("button");
      btn.type = "button";
      btn.className = "tm-swatch tm-swatch--studio";
      btn.setAttribute("data-hex", col);
      btn.style.background = col;
      btn.title = col;
      btn.addEventListener("click", function () {
        tmApplyAccentFromStudio(col, false);
      });
      box.appendChild(btn);
    });
  }
  fill(pastelBox, pastels);
  fill(vividBox, vivids);
}

function tmEnsureIroPicker() {
  if (tmIroPicker) return;
  if (typeof window.iro === "undefined") return;
  var host = document.getElementById("tmIroPickerHost");
  if (!host || host.childNodes.length > 0) return;
  var Iro = window.iro;
  try {
    var startHex =
      (document.getElementById("tmColorHex") && tmNormalizeHex(document.getElementById("tmColorHex").value)) || "#1A1A1A";
    tmIroPicker = new Iro.ColorPicker(host, {
      width: 228,
      color: startHex,
      borderWidth: 2,
      borderColor: "rgba(255,255,255,0.12)",
      layoutDirection: "vertical",
      wheelLightness: false,
      layout: [
        { component: Iro.ui.Wheel },
        { component: Iro.ui.Box, options: {} },
        { component: Iro.ui.Slider, options: { sliderType: "hue" } },
      ],
    });
    tmIroPicker.on("color:change", function (changes, color) {
      if (tmIroSyncingFromInputs) return;
      var col = color && color.hexString ? color : changes;
      if (!col || !col.hexString) return;
      var hx = (col.hexString || "").toUpperCase();
      if (!tmNormalizeHex(hx)) return;
      tmApplyAccentHex(hx);
      tmSyncColorInputsFromHex(hx, true);
      tmMarkActivePaletteSwatch(hx);
      tmUpdateCompSwatches();
    });
  } catch (err) {
    console.error("iro.js ColorPicker:", err);
    try {
      host.innerHTML = "";
    } catch (e) {}
    tmIroPicker = null;
  }
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
      tmApplyAccentFromStudio(ch, false);
    });
    box.appendChild(b);
  });
}

function initTmColorStudio() {
  if (tmColorStudioBound) return;
  var panel = document.getElementById("color-settings-panel");
  var pastelG = document.getElementById("tmPastelSwatchGrid");
  var vividG = document.getElementById("tmVividSwatchGrid");
  if (!panel || !pastelG || !vividG) return;
  tmColorStudioBound = true;

  tmFillStudioPaletteGrids();

  document.querySelectorAll("[data-tm-color-tab]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var mode = btn.getAttribute("data-tm-color-tab") === "panel" ? "panel" : "preset";
      tmSetColorStudioTab(mode);
    });
  });

  var hexIn = document.getElementById("tmColorHex");
  if (hexIn) {
    hexIn.addEventListener("change", function () {
      var x = tmNormalizeHex(hexIn.value);
      if (x) tmApplyAccentFromStudio(x, false);
    });
  }
  ["tmColorR", "tmColorG", "tmColorB"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el)
      el.addEventListener("change", function () {
        var r = parseInt(document.getElementById("tmColorR").value, 10) || 0;
        var g = parseInt(document.getElementById("tmColorG").value, 10) || 0;
        var b = parseInt(document.getElementById("tmColorB").value, 10) || 0;
        tmApplyAccentFromStudio(tmRgbToHex(r, g, b), false);
      });
  });

  var paper = document.getElementById("tmA4Paper");
  var initial =
    (paper && tmNormalizeHex(getComputedStyle(paper).getPropertyValue("--tm-accent").trim())) || "#1A1A1A";
  tmApplyAccentFromStudio(initial, true);
  tmEnsureIroPicker();
  tmSetColorStudioTab("preset");
}

let apptCarouselOffset = 0;
let randevuChartInstance = null;
let netBasariChartInstance = null;
let examTypeFilter = "all";
let examsPageFilter = "all";
let searchQuery = "";
const navigateCallbacks = [];

let currentView = "dashboard";
/** AI Test Üretici: 1.5s sonra testmaker’a geçiş zamanlayıcısı (iptal / takılma önleme) */
let tmAiGenNavigateTimer = null;

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

function firestoreDocExists(snap) {
  if (!snap) return false;
  return typeof snap.exists === "function" ? snap.exists() : !!snap.exists;
}

var dpHedefRadarChart = null;
var dpInboxDelegationBound = false;

function parseStudentNetVal(v) {
  if (v == null || v === "") return null;
  var n = parseFloat(String(v).replace(",", "."));
  return isNaN(n) ? null : n;
}

function buildDpHedefRowsFromStudent(student) {
  var base = [
    { label: "TYT Türkçe", current: 32, target: 35 },
    { label: "TYT Matematik", current: 35.5, target: 38 },
    { label: "TYT Fen", current: 28, target: 32 },
    { label: "AYT Matematik", current: 33, target: 40 },
  ];
  if (!student) return base;
  var curT = parseStudentNetVal(student.currentTytNet);
  var tgtT = parseStudentNetVal(student.targetTytNet);
  if (curT == null || tgtT == null) return base;
  var c = Math.min(120, Math.max(0, curT));
  var t = Math.min(120, Math.max(0, tgtT));
  base[0].current = Math.min(40, c * 0.28);
  base[0].target = Math.min(40, t * 0.28);
  base[1].current = Math.min(40, c * 0.32);
  base[1].target = Math.min(40, t * 0.32);
  base[2].current = Math.min(40, c * 0.22);
  base[2].target = Math.min(40, t * 0.22);
  base[3].current = Math.min(40, c * 0.28);
  base[3].target = Math.min(40, t * 0.28);
  return base;
}

function renderDpHedefSimulator() {
  var canvas = document.getElementById("dpHedefRadarCanvas");
  var barsEl = document.getElementById("dpHedefBarsCoach");
  var gapEl = document.getElementById("dpHedefGapCoach");
  if (!canvas || typeof Chart === "undefined") return;

  var sel = document.getElementById("dpHedefStudentSelect");
  if (sel) {
    var keep = sel.value;
    sel.innerHTML = '<option value="">— Öğrenci seçin —</option>';
    cachedStudents.forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name || s.studentName || "Öğrenci";
      sel.appendChild(o);
    });
    if (keep && cachedStudents.some(function (x) { return x.id === keep; })) sel.value = keep;
    if (!sel.dataset.dpHedefBound) {
      sel.dataset.dpHedefBound = "1";
      sel.addEventListener("change", function () {
        renderDpHedefSimulator();
      });
    }
  }

  var sid = sel && sel.value ? String(sel.value) : "";
  var student = sid ? cachedStudents.find(function (x) { return x.id === sid; }) : null;

  var uniEl = document.getElementById("dpHedefUniTitle");
  var bolEl = document.getElementById("dpHedefBolumSub");
  if (student) {
    var u = (student.targetUniversity || "").trim();
    var b = (student.targetDepartment || "").trim();
    if (uniEl) uniEl.textContent = u || "Hedef üniversite kayıtlı değil";
    if (bolEl) bolEl.textContent = (b || "Hedef bölüm kayıtlı değil") + " — Güncel vs hedef net";
  } else {
    if (uniEl) uniEl.textContent = "Öğrenci seçin";
    if (bolEl) bolEl.textContent = "Öğrenci kartından hedef üniversite / bölüm atanabilir.";
  }

  var rows = buildDpHedefRowsFromStudent(student);
  var labels = rows.map(function (r) {
    return r.label;
  });
  var current = rows.map(function (r) {
    return r.current;
  });
  var target = rows.map(function (r) {
    return r.target;
  });
  var totalGap = rows.reduce(function (s, r) {
    return s + Math.max(0, r.target - r.current);
  }, 0);

  if (barsEl) {
    barsEl.innerHTML = rows
      .map(function (r) {
        var pct = Math.min(100, (r.current / r.target) * 100);
        var gap = Math.max(0, r.target - r.current);
        var gapTxt = gap > 0 ? "−" + gap.toFixed(1) + " net" : "Hedefe ulaşıldı";
        return (
          '<div class="dp-hedef-bar-row"><span>' +
          escapeHtml(r.label) +
          '</span><div class="dp-track"><div class="dp-fill" style="width:' +
          pct.toFixed(1) +
          '%"></div></div><span>' +
          r.current.toFixed(1) +
          " / " +
          r.target.toFixed(1) +
          " · " +
          escapeHtml(gapTxt) +
          "</span></div>"
        );
      })
      .join("");
  }
  if (gapEl) {
    gapEl.textContent =
      "Kalan net farkı (branş toplamı): " +
      totalGap.toFixed(1) +
      (student && parseStudentNetVal(student.currentTytNet) != null
        ? " — TYT net alanından ölçeklendirildi."
        : " — Varsayılan örnek veri (öğrencide güncel/hedef net girilince güncellenir).");
  }

  var ctx = canvas.getContext("2d");
  if (dpHedefRadarChart) {
    dpHedefRadarChart.destroy();
    dpHedefRadarChart = null;
  }
  dpHedefRadarChart = new Chart(ctx, {
    type: "radar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Güncel net",
          data: current,
          borderColor: "#6c5ce7",
          backgroundColor: "rgba(108, 92, 231, 0.22)",
          pointBackgroundColor: "#6c5ce7",
        },
        {
          label: "Hedef net",
          data: target,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.18)",
          pointBackgroundColor: "#059669",
        },
      ],
    },
    options: {
      scales: {
        r: {
          min: 0,
          suggestedMax: 45,
        },
      },
      plugins: {
        legend: { position: "bottom" },
      },
    },
  });
}

function initDpHedefSimulator() {
  renderDpHedefSimulator();
}

function renderDpGelenSorular() {
  var grid = document.getElementById("dpInboxGrid");
  var empty = document.getElementById("dpInboxEmpty");
  if (!grid) return;
  var list = [];
  try {
    var raw = localStorage.getItem("derece_koca_sor_inbox");
    list = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(list)) list = [];
  } catch (e) {
    list = [];
  }
  if (list.length === 0) {
    grid.innerHTML = "";
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  grid.innerHTML = list
    .map(function (item) {
      var unread = !item.read;
      var dt = new Date(item.at || Date.now());
      var timeStr = isNaN(dt.getTime()) ? "—" : dt.toLocaleString("tr-TR");
      return (
        '<button type="button" class="dp-inbox-card' +
        (unread ? " dp-inbox-card--unread" : "") +
        '" data-inbox-id="' +
        escapeHtml(String(item.id || "")) +
        '" role="listitem">' +
        (unread ? '<span class="dp-inbox-card__badge" aria-label="Okunmadı"></span>' : "") +
        '<span class="dp-inbox-card__from">' +
        escapeHtml(item.student || "Öğrenci") +
        "</span>" +
        '<span class="dp-inbox-card__text">' +
        escapeHtml(item.message || "") +
        "</span>" +
        (item.fileName
          ? '<span class="dp-inbox-card__meta">📎 ' + escapeHtml(item.fileName) + "</span>"
          : "") +
        '<span class="dp-inbox-card__meta">' +
        escapeHtml(timeStr) +
        "</span></button>"
      );
    })
    .join("");
}

function bindDpInboxDelegationOnce() {
  var grid = document.getElementById("dpInboxGrid");
  if (!grid || dpInboxDelegationBound) return;
  dpInboxDelegationBound = true;
  grid.addEventListener("click", function (e) {
    var card = e.target.closest(".dp-inbox-card");
    if (!card) return;
    var id = card.getAttribute("data-inbox-id");
    if (!id) return;
    var raw = localStorage.getItem("derece_koca_sor_inbox");
    var arr = [];
    try {
      arr = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(arr)) arr = [];
    } catch (err) {
      arr = [];
    }
    var changed = false;
    arr.forEach(function (it) {
      if (String(it.id) === String(id) && !it.read) {
        it.read = true;
        changed = true;
      }
    });
    if (changed) {
      try {
        localStorage.setItem("derece_koca_sor_inbox", JSON.stringify(arr));
      } catch (err2) {}
      renderDpGelenSorular();
    }
  });
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

var COACH_FINANCE_MOCK_KEY = "yks_coach_finance_mock_v1";

function loadFinanceMock() {
  try {
    var raw = localStorage.getItem(COACH_FINANCE_MOCK_KEY);
    return raw ? JSON.parse(raw) : { overdueByStudent: {} };
  } catch (e) {
    return { overdueByStudent: {} };
  }
}

function saveFinanceMock(obj) {
  try {
    localStorage.setItem(COACH_FINANCE_MOCK_KEY, JSON.stringify(obj));
  } catch (e) {}
}

function ensureFinanceMockSeeded() {
  if (!cachedStudents || cachedStudents.length === 0) return;
  var m = loadFinanceMock();
  if (m.overdueByStudent && Object.keys(m.overdueByStudent).length > 0) return;
  var due = {};
  cachedStudents.slice(0, Math.min(4, cachedStudents.length)).forEach(function (s, ix) {
    if (ix % 2 === 0) {
      due[s.id] = { amount: 1200 + ix * 350, dueDate: "2025-09-15", note: "Taksit" };
    }
  });
  saveFinanceMock({ overdueByStudent: due });
}

function sumPaymentsForStudent(studentId) {
  return cachedPayments
    .filter(function (p) {
      return (p.studentId || "") === studentId;
    })
    .reduce(function (a, p) {
      return a + (parseFloat(p.amount) || 0);
    }, 0);
}

function getStudentFinanceRow(studentId) {
  var st = cachedStudents.find(function (x) {
    return x.id === studentId;
  });
  var total = st ? parseFloat(st.agreedTotalFee) || 0 : 0;
  var paid = sumPaymentsForStudent(studentId);
  var balance = Math.max(0, total - paid);
  var mock = loadFinanceMock();
  var od = mock.overdueByStudent && mock.overdueByStudent[studentId];
  var overdueAmt = od ? parseFloat(od.amount) || 0 : 0;
  var dueDate = od && od.dueDate ? String(od.dueDate) : "";
  var today = new Date().toISOString().slice(0, 10);
  var isOverdue = overdueAmt > 0 && dueDate && dueDate < today;
  var statusLabel = "—";
  var statusClass = "fin-badge--muted";
  if (total <= 0 && paid <= 0) {
    statusLabel = "—";
    statusClass = "fin-badge--muted";
  } else if (total > 0 && balance <= 0.01) {
    statusLabel = "Tamamlandı";
    statusClass = "fin-badge--done";
  } else if (balance > 0) {
    if (isOverdue) {
      statusLabel = "Gecikmede";
      statusClass = "fin-badge--late";
    } else {
      statusLabel = "Borçlu";
      statusClass = "fin-badge--debt";
    }
  }
  return {
    total: total,
    paid: paid,
    balance: balance,
    statusLabel: statusLabel,
    statusClass: statusClass,
    overdueAmt: overdueAmt,
    dueDate: dueDate,
    isOverdue: isOverdue,
  };
}

function fmtTryMoney(n) {
  if (n == null || isNaN(n)) return "—";
  return (
    n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) + " ₺"
  );
}

function renderStudentDetailMuhasebeTab(studentId) {
  ensureFinanceMockSeeded();
  var fin = getStudentFinanceRow(studentId);
  var alertEl = document.getElementById("sdFinanceAlert");
  if (alertEl) {
    if (fin.isOverdue && fin.overdueAmt > 0) {
      alertEl.hidden = false;
      alertEl.innerHTML =
        '<span aria-hidden="true">⚠️</span> Bu öğrencinin <strong>' +
        fmtTryMoney(fin.overdueAmt) +
        "</strong> gecikmiş borcu bulunmaktadır! (Vade: " +
        escapeHtml(fin.dueDate || "—") +
        ")";
    } else {
      alertEl.hidden = true;
      alertEl.innerHTML = "";
    }
  }
  var tEl = document.getElementById("sdFinTotal");
  var pEl = document.getElementById("sdFinPaid");
  var bEl = document.getElementById("sdFinBalance");
  if (tEl) tEl.textContent = fin.total > 0 ? fmtTryMoney(fin.total) : "—";
  if (pEl) pEl.textContent = fin.paid > 0 ? fmtTryMoney(fin.paid) : "—";
  if (bEl) bEl.textContent = fin.total > 0 ? fmtTryMoney(fin.balance) : "—";
  var tb = document.getElementById("sdFinPaymentsBody");
  if (tb) {
    var pays = cachedPayments.filter(function (p) {
      return (p.studentId || "") === studentId;
    });
    pays.sort(function (a, b) {
      return (b.paymentDate || "").localeCompare(a.paymentDate || "");
    });
    if (pays.length === 0) {
      tb.innerHTML = '<tr><td colspan="4" class="table-empty">Henüz tahsilat kaydı yok.</td></tr>';
    } else {
      tb.innerHTML = pays
        .map(function (p) {
          return (
            "<tr><td>" +
            escapeHtml(p.paymentDate || "—") +
            "</td><td><strong>" +
            escapeHtml(p.amount != null ? String(p.amount) : "—") +
            "</strong></td><td>" +
            escapeHtml(p.paymentMethod || "—") +
            "</td><td>" +
            escapeHtml(p.description || "—") +
            "</td></tr>"
          );
        })
        .join("");
    }
  }
}

function renderStudentsPage() {
  var root = document.getElementById("studentsCardsRoot");
  if (!root) return;
  if (cachedStudents.length === 0) {
    root.innerHTML =
      '<p class="table-empty" style="grid-column:1/-1;margin:0">Henüz öğrenci yok. <strong>Yeni Öğrenci</strong> ile ekleyin.</p>';
    return;
  }
  root.innerHTML = cachedStudents
    .map(function (s) {
      var name = s.name || s.studentName || "Öğrenci";
      var track = s.examGroup || s.track || s.paket || "TYT + AYT";
      var sid = escapeHtml(s.id);
      var rawAv = s.avatarUrl;
      var src =
        rawAv && /^https?:\/\//i.test(String(rawAv).trim())
          ? String(rawAv).trim()
          : buildStudentAvatarUrl(name, s.gender);
      return (
        '<article class="student-card">' +
        '<img src="' +
        escapeHtml(src) +
        '" alt="" width="80" height="80" loading="lazy" />' +
        "<h3>" +
        escapeHtml(name) +
        "</h3>" +
        "<p>" +
        escapeHtml(track) +
        '</p><div class="student-card__crud">' +
        '<button type="button" class="btn-crud btn-crud--detail" data-student-detail="' +
        sid +
        '"><i class="fa-solid fa-id-card"></i> Detay</button>' +
        '<button type="button" class="btn-crud btn-crud--edit" data-edit-student="' +
        sid +
        '"><i class="fa-solid fa-pen"></i> Düzenle</button>' +
        '<button type="button" class="btn-crud btn-crud--del" data-del-student="' +
        sid +
        '"><i class="fa-solid fa-trash"></i> Sil</button></div></article>'
      );
    })
    .join("");
}

function renderMuhasebeStudentLedger() {
  var tbody = document.getElementById("muhasebeCariBody");
  if (!tbody) return;
  ensureFinanceMockSeeded();
  if (cachedStudents.length === 0) {
    tbody.innerHTML =
      '<tr><td colspan="7" class="table-empty">Henüz öğrenci yok. Öğrenci ekleyin veya <strong>Kayıt</strong> bölümünden anlaşma girin.</td></tr>';
    return;
  }
  tbody.innerHTML = cachedStudents
    .map(function (s) {
      var name = s.name || s.studentName || "Öğrenci";
      var track = s.examGroup || s.track || s.paket || "TYT + AYT";
      var sid = escapeHtml(s.id);
      var fin = getStudentFinanceRow(s.id);
      var totDisp = fin.total > 0 ? fmtTryMoney(fin.total) : "—";
      var paidDisp = fin.paid > 0 ? fmtTryMoney(fin.paid) : "—";
      var balDisp = fin.total > 0 ? fmtTryMoney(fin.balance) : "—";
      var badge =
        '<span class="fin-badge ' +
        fin.statusClass +
        '">' +
        escapeHtml(fin.statusLabel) +
        "</span>";
      return (
        "<tr><td><strong>" +
        escapeHtml(name) +
        "</strong></td><td>" +
        escapeHtml(track) +
        "</td><td>" +
        totDisp +
        "</td><td>" +
        paidDisp +
        "</td><td>" +
        balDisp +
        "</td><td>" +
        badge +
        '</td><td><span class="crud-cell">' +
        '<button type="button" class="btn btn--sm btn--purple" data-muh-tahsilat="' +
        sid +
        '"><i class="fa-solid fa-plus"></i> Tahsilat Ekle</button></span></td></tr>'
      );
    })
    .join("");
}

var SD_NOTE_KEY = "yks_student_coach_notes_v1";

function sdLoadNotesMap() {
  try {
    var raw = localStorage.getItem(SD_NOTE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function sdSaveNote(studentId, text) {
  var m = sdLoadNotesMap();
  m[studentId] = text;
  try {
    localStorage.setItem(SD_NOTE_KEY, JSON.stringify(m));
  } catch (e) {}
}

/**
 * Firestore `students` belge ID'sini değiştirir; deneme/randevu/tahsilat/görev kayıtlarındaki studentId güncellenir.
 */
async function migrateStudentDocumentId(oldId, newIdRaw) {
  var cid = getCoachId();
  var newId = String(newIdRaw || "").trim();
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(newId)) {
    showToast("Yeni ID yalnızca harf, rakam, alt çizgi ve tire içerebilir (1–80 karakter).");
    return;
  }
  if (newId === oldId) return;
  var st = cachedStudents.find(function (x) {
    return x.id === oldId;
  });
  if (!st || String(st.coach_id || "") !== String(cid)) {
    showToast("Bu kayıt bulunamadı veya size ait değil.");
    return;
  }
  var newRef = doc(db, "students", newId);
  var exNew = await getDoc(newRef);
  if (firestoreDocExists(exNew)) {
    showToast("Bu ID ile zaten bir öğrenci kaydı var.");
    return;
  }
  var oldRef = doc(db, "students", oldId);
  var exOld = await getDoc(oldRef);
  if (!firestoreDocExists(exOld)) {
    showToast("Öğrenci kaydı bulunamadı.");
    return;
  }
  var pdata = Object.assign({}, exOld.data());
  delete pdata.id;
  try {
    await setDoc(newRef, pdata);
    var subSnap = await getDocs(collection(db, "students", oldId, "atananKaynaklar"));
    var si;
    for (si = 0; si < subSnap.docs.length; si++) {
      var subd = subSnap.docs[si];
      await setDoc(doc(db, "students", newId, "atananKaynaklar", subd.id), subd.data());
    }
    async function patchCol(rows, colName) {
      for (var ri = 0; ri < rows.length; ri++) {
        var row = rows[ri];
        try {
          await updateDoc(doc(db, colName, row.id), { studentId: newId });
        } catch (e) {
          console.warn("[migrateStudentDocumentId]", colName, row.id, e);
        }
      }
    }
    await patchCol(
      cachedExams.filter(function (e) {
        return e.studentId === oldId && (e.coach_id == null || e.coach_id === cid);
      }),
      "exams"
    );
    await patchCol(
      cachedAppointments.filter(function (a) {
        return a.studentId === oldId && (a.coach_id == null || a.coach_id === cid);
      }),
      "appointments"
    );
    await patchCol(
      cachedPayments.filter(function (p) {
        return p.studentId === oldId && (p.coach_id == null || p.coach_id === cid);
      }),
      "payments"
    );
    await patchCol(
      cachedCoachTasks.filter(function (t) {
        return t.studentId === oldId && (t.coach_id == null || t.coach_id === cid);
      }),
      "coach_tasks"
    );
    for (si = 0; si < subSnap.docs.length; si++) {
      await deleteDoc(doc(db, "students", oldId, "atananKaynaklar", subSnap.docs[si].id));
    }
    await deleteDoc(oldRef);
    try {
      var m = sdLoadNotesMap();
      if (m[oldId]) {
        m[newId] = m[oldId];
        delete m[oldId];
        localStorage.setItem(SD_NOTE_KEY, JSON.stringify(m));
      }
    } catch (e) {}
    try {
      var mock = loadFinanceMock();
      if (mock.overdueByStudent && mock.overdueByStudent[oldId] != null) {
        mock.overdueByStudent[newId] = mock.overdueByStudent[oldId];
        delete mock.overdueByStudent[oldId];
        saveFinanceMock(mock);
      }
    } catch (e) {}
    if (kkSelectedStudentId === oldId) {
      kkSelectedStudentId = newId;
      kkSubscribeStudentAssignments(newId);
    }
    if (hpSelectedStudentId === oldId) {
      hpSelectedStudentId = newId;
    }
    currentStudentDetailId = newId;
    var inp = document.getElementById("studentDetailNewIdInput");
    if (inp) inp.value = "";
    showToast("Kayıt ID güncellendi.");
  } catch (err) {
    console.error(err);
    showToast("ID güncellenemedi: " + (err.message || err));
  }
}

function parseTrNum(s) {
  if (s == null || s === "") return NaN;
  return parseFloat(String(s).replace(",", ".").trim());
}

function normName(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function examsForStudent(sid) {
  return cachedExams.filter(function (e) {
    return e.studentId === sid;
  });
}

function renderStudentDetailTrendChart(sid) {
  var canvas = document.getElementById("studentDetailTrendChart");
  if (!canvas || typeof Chart === "undefined") return;
  var ex = examsForStudent(sid)
    .slice()
    .sort(function (a, b) {
      return examDateSort(a) - examDateSort(b);
    });
  var existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  if (ex.length === 0) return;
  var labels = ex.map(function (e, i) {
    var n = e.examName || e.exam || "D" + (i + 1);
    return n.length > 18 ? n.slice(0, 16) + "…" : n;
  });
  var tytData = ex.map(function (e) {
    var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
    if (tur !== "TYT") return null;
    var v = parseTrNum(e.net);
    return isNaN(v) ? null : v;
  });
  var aytData = ex.map(function (e) {
    var tur = (e.examType || e.type || e.tur || "").toUpperCase();
    if (tur !== "AYT") return null;
    var v = parseTrNum(e.net);
    return isNaN(v) ? null : v;
  });
  new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "TYT net",
          data: tytData,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.1)",
          tension: 0.3,
          spanGaps: true,
          fill: true,
        },
        {
          label: "AYT net",
          data: aytData,
          borderColor: "#0d9488",
          backgroundColor: "rgba(13, 148, 136, 0.08)",
          tension: 0.3,
          spanGaps: true,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#334155" } },
      },
      scales: {
        x: { ticks: { color: "#64748b", maxRotation: 45 } },
        y: { beginAtZero: true, ticks: { color: "#64748b" } },
      },
    },
  });
}

function resetStudentDetailTabs() {
  document.querySelectorAll(".sd-erp-tab").forEach(function (b, i) {
    var on = i === 0;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  document.querySelectorAll(".sd-erp-panel").forEach(function (p) {
    p.hidden = p.getAttribute("data-sd-panel") !== "0";
  });
}

function renderStudentDetailPage() {
  var sid = currentStudentDetailId;
  resetStudentDetailTabs();
  var st = sid ? cachedStudents.find(function (x) {
    return x.id === sid;
  }) : null;
  var nameEl = document.getElementById("studentDetailName");
  var metaEl = document.getElementById("studentDetailMeta");
  var imgEl = document.getElementById("studentDetailAvatar");
  if (!nameEl || !st) {
    if (nameEl) nameEl.textContent = "Öğrenci bulunamadı";
    return;
  }
  var name = st.name || st.studentName || "Öğrenci";
  nameEl.textContent = name;
  var rawAv = st.avatarUrl;
  var src =
    rawAv && /^https?:\/\//i.test(String(rawAv).trim())
      ? String(rawAv).trim()
      : buildStudentAvatarUrl(name, st.gender);
  if (imgEl) {
    imgEl.src = src;
    imgEl.alt = name;
  }
  var meta = [];
  if (st.track || st.examGroup) meta.push("<strong>Alan:</strong> " + escapeHtml(st.track || st.examGroup || ""));
  if (st.schoolName) meta.push("<strong>Okul:</strong> " + escapeHtml(st.schoolName));
  if (st.classGrade) meta.push("<strong>Sınıf:</strong> " + escapeHtml(st.classGrade));
  if (st.parentPhone || st.phone) meta.push("<strong>Veli tel:</strong> " + escapeHtml(st.parentPhone || st.phone || ""));
  if (st.targetTytNet) meta.push("<strong>Hedef TYT:</strong> " + escapeHtml(String(st.targetTytNet)));
  if (metaEl) metaEl.innerHTML = meta.length ? meta.join("<br/>") : "Kayıtlı ek bilgi yok.";
  var idDisp = document.getElementById("studentDetailDocIdDisplay");
  var idInp = document.getElementById("studentDetailNewIdInput");
  if (idDisp) idDisp.textContent = sid || "—";
  if (idInp) idInp.value = "";
  var ex = examsForStudent(sid);
  document.getElementById("sdKpiExams").textContent = String(ex.length);
  var tytVals = [];
  var aytVals = [];
  ex.forEach(function (e) {
    var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
    var v = parseTrNum(e.net);
    if (isNaN(v)) return;
    if (tur === "TYT") tytVals.push(v);
    else if (tur === "AYT") aytVals.push(v);
  });
  function avg(arr) {
    if (!arr.length) return "—";
    var s = arr.reduce(function (a, b) {
      return a + b;
    }, 0);
    return (s / arr.length).toFixed(2);
  }
  document.getElementById("sdKpiTyt").textContent = avg(tytVals);
  document.getElementById("sdKpiAyt").textContent = avg(aytVals);
  var openTasks = cachedCoachTasks.filter(function (t) {
    return (t.studentId || "") === sid && (t.column || "todo") !== "done";
  });
  document.getElementById("sdKpiTasks").textContent = String(openTasks.length);
  renderStudentDetailTrendChart(sid);
  var tbody = document.getElementById("studentDetailExamsBody");
  if (tbody) {
    if (ex.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="table-empty">Henüz deneme kaydı yok.</td></tr>';
    } else {
      tbody.innerHTML = ex
        .slice()
        .sort(function (a, b) {
          return examDateSort(b) - examDateSort(a);
        })
        .map(function (row) {
          var tur = (row.examType || row.type || row.tur || "TYT").toUpperCase();
          var badge = tur === "AYT" ? "badge-ayt" : "badge-tyt";
          var d = toDate(row.examDate) || toDate(row.date);
          var tarih = d && !isNaN(d.getTime()) ? d.toLocaleDateString("tr-TR") : "—";
          var br = "";
          if (row.yksBranchDetail && typeof row.yksBranchDetail === "object") {
            try {
              br = JSON.stringify(row.yksBranchDetail).slice(0, 200);
            } catch (e) {
              br = "—";
            }
          } else if (row.subjectBreakdown) {
            br = String(row.subjectBreakdown).slice(0, 200);
          } else br = "—";
          return (
            "<tr><td><strong>" +
            escapeHtml(row.examName || "—") +
            '</strong></td><td><span class="' +
            badge +
            '">' +
            escapeHtml(tur) +
            "</span></td><td>" +
            escapeHtml(row.net != null ? String(row.net) : "—") +
            "</td><td>" +
            escapeHtml(tarih) +
            "</td><td>" +
            escapeHtml(row.status || "—") +
            '</td><td><div class="sd-branch-mini">' +
            escapeHtml(br) +
            "</div></td></tr>"
          );
        })
        .join("");
    }
  }
  var taskHost = document.getElementById("studentDetailTasks");
  if (taskHost) {
    var ts = cachedCoachTasks.filter(function (t) {
      return (t.studentId || "") === sid;
    });
    if (ts.length === 0) taskHost.innerHTML = "<p>Görev yok.</p>";
    else {
      taskHost.innerHTML =
        "<ul style=\"margin:0;padding-left:1.2rem\">" +
        ts
          .map(function (t) {
            return (
              "<li><strong>" +
              escapeHtml(t.title || "") +
              "</strong> — " +
              escapeHtml(t.column || "todo") +
              (t.dueDate ? " · " + escapeHtml(t.dueDate) : "") +
              "</li>"
            );
          })
          .join("") +
        "</ul>";
    }
  }
  var apHost = document.getElementById("studentDetailAppts");
  if (apHost) {
    var aps = cachedAppointments.filter(function (a) {
      return (a.studentId || "") === sid;
    });
    if (aps.length === 0) apHost.innerHTML = "<p>Randevu yok.</p>";
    else {
      apHost.innerHTML =
        "<ul style=\"margin:0;padding-left:1.2rem\">" +
        aps
          .map(function (a) {
            return (
              "<li>" +
              escapeHtml(a.title || a.type || "Randevu") +
              " — " +
              escapeHtml(a.date || a.appointmentDate || "") +
              "</li>"
            );
          })
          .join("") +
        "</ul>";
    }
  }
  var veliEl = document.getElementById("sdVeliPanel");
  if (veliEl) {
    var pv = st.parentFullName || st.parentName || "—";
    var pr = st.parentRelation || "—";
    var ph = st.parentPhone || st.phone || "—";
    veliEl.innerHTML =
      "<p><strong>Veli adı:</strong> " +
      escapeHtml(pv) +
      "</p><p><strong>Yakınlık:</strong> " +
      escapeHtml(pr) +
      "</p><p><strong>Telefon:</strong> " +
      escapeHtml(ph) +
      "</p>";
  }
  renderStudentDetailMuhasebeTab(sid);
  var noteEl = document.getElementById("studentDetailCoachNote");
  if (noteEl) {
    var notes = sdLoadNotesMap();
    noteEl.value = notes[sid] || "";
  }
}

function openStudentDetail(studentId) {
  if (!studentId) return;
  currentStudentDetailId = String(studentId).trim();
  navigateTo("ogrenci-detay");
}

function refreshStudentDetailIfOpen() {
  if (currentView === "ogrenci-detay" && currentStudentDetailId) renderStudentDetailPage();
}

/** Aynı denemeyi (tür + tarih + ad) gruplamak için anahtar */
function karneExamStableKey(e) {
  var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
  if (tur !== "TYT" && tur !== "AYT") tur = "TYT";
  var d = String(e.date || "").trim();
  var n = String(e.examName || "Deneme").trim() || "Deneme";
  return tur + "|" + d + "|" + n;
}

function karneGetFilters() {
  var st = document.getElementById("karneSelectStudent");
  var ex = document.getElementById("karneSelectExam");
  return {
    studentId: st && st.value ? st.value : "all",
    examKey: ex && ex.value ? ex.value : "all",
  };
}

function karneFilterExamList(list, examKey) {
  if (!examKey || examKey === "all") return list;
  return list.filter(function (e) {
    return karneExamStableKey(e) === examKey;
  });
}

function populateKarneStudentSelect() {
  var sel = document.getElementById("karneSelectStudent");
  if (!sel) return;
  var keep = sel.value;
  sel.innerHTML = '<option value="all">Tüm öğrenciler</option>';
  cachedStudents.forEach(function (s) {
    var o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name || s.studentName || "Öğrenci (" + s.id.slice(0, 6) + ")";
    sel.appendChild(o);
  });
  if (keep && Array.prototype.some.call(sel.options, function (opt) {
    return opt.value === keep;
  })) {
    sel.value = keep;
  }
}

function populateKarneExamSelect() {
  var sel = document.getElementById("karneSelectExam");
  if (!sel) return;
  var keep = sel.value;
  var keys = {};
  cachedExams.forEach(function (e) {
    var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
    if (tur !== "TYT" && tur !== "AYT") return;
    var k = karneExamStableKey(e);
    if (!keys[k]) {
      keys[k] = {
        key: k,
        label: (tur === "AYT" ? "AYT" : "TYT") + " · " + (e.date || "—") + " · " + (e.examName || "Deneme"),
      };
    }
  });
  var arr = Object.keys(keys).map(function (k) {
    return keys[k];
  });
  arr.sort(function (a, b) {
    return String(b.key).localeCompare(String(a.key));
  });
  sel.innerHTML = '<option value="all">Tüm denemeler</option>';
  arr.forEach(function (item) {
    var o = document.createElement("option");
    o.value = item.key;
    o.textContent = item.label;
    sel.appendChild(o);
  });
  if (keep && Array.prototype.some.call(sel.options, function (opt) {
    return opt.value === keep;
  })) {
    sel.value = keep;
  }
}

function populateKarneSelects() {
  populateKarneStudentSelect();
  populateKarneExamSelect();
}

var karneFiltersBound = false;
function bindKarneFilters() {
  if (karneFiltersBound) return;
  var ss = document.getElementById("karneSelectStudent");
  var se = document.getElementById("karneSelectExam");
  if (!ss || !se) return;
  karneFiltersBound = true;
  ss.addEventListener("change", function () {
    renderKarneReport();
  });
  se.addEventListener("change", function () {
    renderKarneReport();
  });
}

/** Her deneme anahtarı için öğrenci → sıra (aynı nette aynı sıra) */
function buildKarnePerExamRankMap() {
  var groups = {};
  cachedExams.forEach(function (e) {
    var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
    if (tur !== "TYT" && tur !== "AYT") return;
    var net = parseTrNum(e.net);
    if (isNaN(net)) return;
    var k = karneExamStableKey(e);
    if (!groups[k]) groups[k] = [];
    groups[k].push({ studentId: e.studentId, net: net });
  });
  var sidRank = {};
  Object.keys(groups).forEach(function (k) {
    var merged = {};
    groups[k].forEach(function (it) {
      var sid = it.studentId;
      if (!merged[sid] || it.net > merged[sid].net) merged[sid] = it;
    });
    var arr = Object.keys(merged).map(function (sid) {
      return { studentId: sid, net: merged[sid].net };
    });
    arr.sort(function (a, b) {
      return b.net - a.net;
    });
    var currentRank = 1;
    for (var i = 0; i < arr.length; i++) {
      if (i > 0 && arr[i].net < arr[i - 1].net) currentRank = i + 1;
      if (!sidRank[k]) sidRank[k] = {};
      sidRank[k][arr[i].studentId] = {
        rank: currentRank,
        total: arr.length,
        net: arr[i].net,
      };
    }
  });
  return sidRank;
}

function karneBuildTytBranchLabelMap() {
  var m = {};
  YKS_TYT_BRANCHES.forEach(function (br) {
    if (br.alt && br.alt.length) {
      br.alt.forEach(function (a) {
        m[br.id + "_" + a.id] = br.label + " · " + a.label;
      });
    } else {
      m[br.id] = br.label;
    }
  });
  return m;
}

function karneBuildAytBranchLabelMap(alan) {
  var m = {};
  var pack = YKS_AYT_BY_ALAN[alan || "sayisal"];
  if (!pack) return m;
  pack.branches.forEach(function (b) {
    m[b.id] = b.label;
    m["ayt_" + b.id] = b.label;
  });
  return m;
}

function karneNetFromRowEntry(row) {
  if (!row || row.soru == null) return NaN;
  var cl = clampDy(row.soru, row.d, row.y);
  return netFromDy(cl.d, cl.y);
}

/** yksBranchDetail → TYT / AYT branş net listeleri */
function karneExtractBranchesFromYksDetail(detail) {
  var out = { tyt: [], ayt: [] };
  if (!detail || typeof detail !== "object") return out;
  if (detail.bulkImport && detail.branchNets && typeof detail.branchNets === "object") {
    var em = String(detail.examMode || "TYT").toUpperCase();
    var nets = detail.branchNets;
    var alan = detail.aytAlan || "sayisal";
    var tytMap = karneBuildTytBranchLabelMap();
    var aytMap = karneBuildAytBranchLabelMap(alan);
    if (em === "TYT") {
      Object.keys(nets).forEach(function (k) {
        var v = parseTrNum(nets[k]);
        if (isNaN(v)) return;
        out.tyt.push({ key: k, label: tytMap[k] || k, net: v });
      });
    } else {
      Object.keys(nets).forEach(function (k) {
        var v = parseTrNum(nets[k]);
        if (isNaN(v)) return;
        out.ayt.push({ key: k, label: aytMap[k] || k, net: v });
      });
    }
    return out;
  }
  if (detail.rows && typeof detail.rows === "object") {
    var examMode = String(detail.examMode || "TYT").toUpperCase();
    var alan = detail.aytAlan || "sayisal";
    var tytMap = karneBuildTytBranchLabelMap();
    var aytMap = karneBuildAytBranchLabelMap(alan);
    Object.keys(detail.rows).forEach(function (k) {
      var row = detail.rows[k];
      var n = karneNetFromRowEntry(row);
      if (isNaN(n)) return;
      if (examMode === "AYT") {
        out.ayt.push({ key: k, label: aytMap[k] || String(k).replace(/^ayt_/, ""), net: n });
      } else {
        out.tyt.push({ key: k, label: tytMap[k] || k, net: n });
      }
    });
  }
  return out;
}

function karneAggregateStudentBranches(exams) {
  var tyt = {};
  var ayt = {};
  exams.forEach(function (e) {
    var parts = karneExtractBranchesFromYksDetail(e.yksBranchDetail);
    parts.tyt.forEach(function (b) {
      if (!tyt[b.key]) tyt[b.key] = { label: b.label, sum: 0, count: 0 };
      tyt[b.key].sum += b.net;
      tyt[b.key].count++;
    });
    parts.ayt.forEach(function (b) {
      if (!ayt[b.key]) ayt[b.key] = { label: b.label, sum: 0, count: 0 };
      ayt[b.key].sum += b.net;
      ayt[b.key].count++;
    });
  });
  function toList(o) {
    return Object.keys(o)
      .map(function (k) {
        var x = o[k];
        return { key: k, label: x.label, avg: x.sum / x.count, n: x.count };
      })
      .sort(function (a, b) {
        return a.label.localeCompare(b.label, "tr");
      });
  }
  return { tyt: toList(tyt), ayt: toList(ayt) };
}

/** Her branş için öğrenci ortalamalarına göre sınıf sırası */
function buildKarneBranchRankMaps(examKey) {
  var tytScores = {};
  var aytScores = {};
  cachedStudents.forEach(function (s) {
    var ex = examsForStudent(s.id);
    if (examKey && examKey !== "all") {
      ex = ex.filter(function (e) {
        return karneExamStableKey(e) === examKey;
      });
    }
    var agg = karneAggregateStudentBranches(ex);
    agg.tyt.forEach(function (b) {
      if (!tytScores[b.key]) tytScores[b.key] = [];
      tytScores[b.key].push({ studentId: s.id, avg: b.avg });
    });
    agg.ayt.forEach(function (b) {
      if (!aytScores[b.key]) aytScores[b.key] = [];
      aytScores[b.key].push({ studentId: s.id, avg: b.avg });
    });
  });
  function rankGroup(scores) {
    var ranks = {};
    Object.keys(scores).forEach(function (key) {
      var arr = scores[key].slice().sort(function (a, b) {
        return b.avg - a.avg;
      });
      var cr = 1;
      for (var i = 0; i < arr.length; i++) {
        if (i > 0 && arr[i].avg < arr[i - 1].avg) cr = i + 1;
        if (!ranks[key]) ranks[key] = {};
        ranks[key][arr[i].studentId] = { rank: cr, total: arr.length };
      }
    });
    return ranks;
  }
  return { tyt: rankGroup(tytScores), ayt: rankGroup(aytScores) };
}

function buildKarneStudentSummaries(opt) {
  opt = opt || {};
  var studentId = opt.studentId || "all";
  var examKey = opt.examKey || "all";
  var rankMap = buildKarnePerExamRankMap();
  var branchRanks = buildKarneBranchRankMaps(examKey);
  var studentsList = cachedStudents;
  if (studentId && studentId !== "all") {
    studentsList = cachedStudents.filter(function (s) {
      return s.id === studentId;
    });
  }
  var rows = studentsList.map(function (s) {
    var sid = s.id;
    var ex = karneFilterExamList(examsForStudent(sid), examKey);
    var tyt = [];
    var ayt = [];
    ex.forEach(function (e) {
      var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
      var v = parseTrNum(e.net);
      if (isNaN(v)) return;
      if (tur === "TYT") tyt.push(v);
      else if (tur === "AYT") ayt.push(v);
    });
    function avNum(a) {
      if (!a.length) return 0;
      return a.reduce(function (x, y) {
        return x + y;
      }, 0) / a.length;
    }
    var at = avNum(tyt);
    var aa = avNum(ayt);
    var examHistory = ex
      .filter(function (e) {
        var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
        return tur === "TYT" || tur === "AYT";
      })
      .map(function (e) {
        var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
        var net = parseTrNum(e.net);
        var k = karneExamStableKey(e);
        var rr = rankMap[k] && rankMap[k][sid];
        var br = karneExtractBranchesFromYksDetail(e.yksBranchDetail);
        return {
          examName: e.examName || "Deneme",
          date: e.date || "",
          type: tur,
          net: isNaN(net) ? null : net,
          netStr: isNaN(net) ? "—" : Number(net).toFixed(2),
          rank: rr ? rr.rank : "",
          totalInClass: rr ? rr.total : "",
          detailTyt: br.tyt,
          detailAyt: br.ayt,
          hasDetail: br.tyt.length > 0 || br.ayt.length > 0,
        };
      })
      .sort(function (a, b) {
        var c = String(b.date || "").localeCompare(String(a.date || ""));
        if (c !== 0) return c;
        return String(a.examName || "").localeCompare(String(b.examName || ""));
      });
    var branchAgg = karneAggregateStudentBranches(ex);
    branchAgg.tyt.forEach(function (b) {
      var rr = branchRanks.tyt[b.key] && branchRanks.tyt[b.key][sid];
      b.rankDisp = rr ? rr.rank + " / " + rr.total : "—";
    });
    branchAgg.ayt.forEach(function (b) {
      var rr = branchRanks.ayt[b.key] && branchRanks.ayt[b.key][sid];
      b.rankDisp = rr ? rr.rank + " / " + rr.total : "—";
    });
    return {
      studentId: sid,
      name: s.name || s.studentName || "—",
      nTyt: tyt.length,
      nAyt: ayt.length,
      avgTytNum: tyt.length ? at : null,
      avgAytNum: ayt.length ? aa : null,
      avgTyt: tyt.length ? at.toFixed(2) : "—",
      avgAyt: ayt.length ? aa.toFixed(2) : "—",
      total: at + aa,
      examHistory: examHistory,
      tytBranches: branchAgg.tyt,
      aytBranches: branchAgg.ayt,
    };
  });
  rows.sort(function (a, b) {
    return b.total - a.total;
  });
  var cr = 1;
  for (var i = 0; i < rows.length; i++) {
    if (i > 0 && rows[i].total < rows[i - 1].total) cr = i + 1;
    rows[i].rankOverall = cr;
  }
  var tytList = rows
    .filter(function (r) {
      return r.nTyt > 0;
    })
    .slice()
    .sort(function (a, b) {
      return (b.avgTytNum || 0) - (a.avgTytNum || 0);
    });
  cr = 1;
  for (var j = 0; j < tytList.length; j++) {
    if (j > 0 && tytList[j].avgTytNum < tytList[j - 1].avgTytNum) cr = j + 1;
    tytList[j].rankTyt = cr;
  }
  var aytList = rows
    .filter(function (r) {
      return r.nAyt > 0;
    })
    .slice()
    .sort(function (a, b) {
      return (b.avgAytNum || 0) - (a.avgAytNum || 0);
    });
  cr = 1;
  for (var k = 0; k < aytList.length; k++) {
    if (k > 0 && aytList[k].avgAytNum < aytList[k - 1].avgAytNum) cr = k + 1;
    aytList[k].rankAyt = cr;
  }
  var tytMap = {};
  tytList.forEach(function (r) {
    tytMap[r.studentId] = r.rankTyt;
  });
  var aytMap = {};
  aytList.forEach(function (r) {
    aytMap[r.studentId] = r.rankAyt;
  });
  rows.forEach(function (r) {
    r.rankTytDisp = r.nTyt > 0 && tytMap[r.studentId] != null ? String(tytMap[r.studentId]) : "—";
    r.rankAytDisp = r.nAyt > 0 && aytMap[r.studentId] != null ? String(aytMap[r.studentId]) : "—";
  });
  return rows;
}

function karneHtmlMiniBranchTable(title, kind, list) {
  var h = "";
  h += '<div class="karne-branch-panel karne-branch-panel--' + kind + '">';
  h += '<div class="karne-branch-panel__head">' + title + "</div>";
  if (!list.length) {
    h += '<p class="karne-branch-panel__empty">Bu türde branş kaydı yok (deneme analizi / optik ile ders bazlı girilmiş deneme yok).</p>';
  } else {
    h += '<table class="karne-branch-table">';
    h += "<thead><tr><th>Ders / alan</th><th>Ort. net</th><th>Deneme #</th><th>Sınıf sırası</th></tr></thead><tbody>";
    list.forEach(function (b) {
      h +=
        "<tr><td>" +
        escapeHtml(b.label) +
        "</td><td>" +
        b.avg.toFixed(2) +
        "</td><td>" +
        b.n +
        "</td><td>" +
        escapeHtml(b.rankDisp) +
        "</td></tr>";
    });
    h += "</tbody></table>";
  }
  h += "</div>";
  return h;
}

function karneHtmlExamBranchMini(list, kind) {
  if (!list.length) return "";
  var lab = kind === "tyt" ? "TYT dersleri" : "AYT dersleri";
  var h = '<div class="karne-exam-branches karne-exam-branches--' + kind + '">';
  h += '<span class="karne-exam-branches__label">' + lab + "</span>";
  h += "<table class=\"karne-branch-table karne-branch-table--compact\"><thead><tr><th>Ders</th><th>Net</th></tr></thead><tbody>";
  list.forEach(function (b) {
    h += "<tr><td>" + escapeHtml(b.label) + "</td><td>" + b.net.toFixed(2) + "</td></tr>";
  });
  h += "</tbody></table></div>";
  return h;
}

function buildKarneReportHtml() {
  var filt = karneGetFilters();
  var rows = buildKarneStudentSummaries(filt);
  var stamp = new Date().toLocaleString("tr-TR");
  var examLabel = "Tüm denemeler";
  var exSel = document.getElementById("karneSelectExam");
  if (exSel && exSel.options && exSel.selectedIndex >= 0) {
    examLabel = exSel.options[exSel.selectedIndex].textContent || examLabel;
  }
  var studentLabel = "Tüm öğrenciler";
  var stSel = document.getElementById("karneSelectStudent");
  if (stSel && stSel.options && stSel.selectedIndex >= 0) {
    studentLabel = stSel.options[stSel.selectedIndex].textContent || studentLabel;
  }
  var oneStudent = filt.studentId && filt.studentId !== "all";
  var mainTitle = oneStudent ? "Karne raporu" : "Sınıf karne raporu";
  if (oneStudent && rows.length) {
    mainTitle = "Karne — " + rows[0].name;
  }
  var h = "";
  h += '<div class="karne-report karne-report--template">';
  h += '<div class="karne-report__hero">';
  h += '<div class="karne-report__hero-inner">';
  h += '<p class="karne-report__badge">YKS Koçluk</p>';
  h += "<h2>" + escapeHtml(mainTitle) + "</h2>";
  h +=
    '<p class="karne-report__lead">TYT ve AYT ayrı ortalamalar; ders bazlı özetler; seçilen deneme kapsamına göre ortalamalar ve sıralar güncellenir.</p>';
  h +=
    '<p class="karne-report__filters"><strong>Filtre:</strong> Öğrenci: ' +
    escapeHtml(studentLabel) +
    " · Deneme: " +
    escapeHtml(examLabel) +
    "</p>";
  h += '<p class="karne-report__meta">Oluşturulma: ' + escapeHtml(stamp) + "</p>";
  h += "</div></div>";
  if (!rows.length) {
    h += '<section class="karne-section"><p class="karne-empty karne-empty--big">Seçime uygun öğrenci veya deneme kaydı bulunamadı.</p></section>';
    h += '<footer class="karne-report__footer">YKS Koçluk · Karne</footer></div>';
    return h;
  }

  h += '<section class="karne-section karne-section--summary">';
  h += "<h3><span class=\"karne-sec-num\">1</span> Genel özet</h3>";
  h += '<div class="karne-table-wrap">';
  h += "<table class=\"karne-table karne-table--summary\">";
  h += "<thead><tr>";
  h += "<th>Sıra</th><th>Öğrenci</th>";
  h += '<th colspan="3" class="karne-th-group karne-th-tyt">TYT</th>';
  h += '<th colspan="3" class="karne-th-group karne-th-ayt">AYT</th>';
  h += "<th>Toplam ort.</th>";
  h += "</tr><tr>";
  h += "<th></th><th></th>";
  h += "<th>#</th><th>Ort.</th><th>Sıra</th>";
  h += "<th>#</th><th>Ort.</th><th>Sıra</th>";
  h += "<th>TYT+AYT</th>";
  h += "</tr></thead><tbody>";
  rows.forEach(function (r) {
    h +=
      "<tr>" +
      "<td>" +
      r.rankOverall +
      "</td><td><strong>" +
      escapeHtml(r.name) +
      "</strong></td>" +
      "<td>" +
      r.nTyt +
      "</td><td>" +
      r.avgTyt +
      "</td><td>" +
      r.rankTytDisp +
      "</td>" +
      "<td>" +
      r.nAyt +
      "</td><td>" +
      r.avgAyt +
      "</td><td>" +
      r.rankAytDisp +
      "</td>" +
      "<td>" +
      (r.total > 0 ? r.total.toFixed(2) : "—") +
      "</td></tr>";
  });
  h += "</tbody></table></div>";
  h +=
    '<p class="karne-footnote">Genel sıra: TYT ve AYT ortalama net toplamına göre. Ders sıraları yalnızca ilgili branşta verisi olan öğrenciler arasında hesaplanır.</p>';
  h += "</section>";

  h += '<section class="karne-section karne-section--detail">';
  h +=
    "<h3><span class=\"karne-sec-num\">2</span> " +
    (oneStudent ? "Branş özeti ve denemeler" : "Öğrenci kartları — branş ortalamaları ve denemeler") +
    "</h3>";
  h +=
    '<p class="karne-footnote karne-footnote--block">' +
    (filt.examKey !== "all"
      ? "Seçilen deneme kapsamındaki kayıtlara göre ortalamalar ve sıralar hesaplanmıştır."
      : "Her öğrenci için TYT ve AYT panelleri ayrıdır. Branş ortalamaları ders bazlı kayıtlı denemelerden gelir.") +
    " Aşağıda toplam net ve varsa ders dökümü listelenir.</p>";
  rows.forEach(function (r) {
    h += '<article class="karne-student-card">';
    h += '<div class="karne-student-card__head">';
    h += "<h4>" + escapeHtml(r.name) + "</h4>";
    h +=
      '<p class="karne-student-meta">Genel: ' +
      r.rankOverall +
      " · TYT: " +
      r.rankTytDisp +
      " · AYT: " +
      r.rankAytDisp +
      "</p>";
    h += "</div>";
    h += '<div class="karne-student-split">';
    h += karneHtmlMiniBranchTable("TYT — ders ortalamaları", "tyt", r.tytBranches);
    h += karneHtmlMiniBranchTable("AYT — ders ortalamaları", "ayt", r.aytBranches);
    h += "</div>";
    if (!r.examHistory.length) {
      h += '<p class="karne-empty">Kayıtlı deneme yok.</p>';
    } else {
      h += '<div class="karne-table-wrap karne-table-wrap--exam"><table class="karne-table karne-table--exams">';
      h +=
        "<thead><tr><th>Tarih</th><th>Deneme</th><th>Tür</th><th>Toplam net</th><th>Deneme sırası (sınıf)</th></tr></thead><tbody>";
      r.examHistory.forEach(function (ex) {
        var rankCell =
          ex.rank !== "" && ex.totalInClass
            ? escapeHtml(String(ex.rank)) + " / " + escapeHtml(String(ex.totalInClass))
            : "—";
        h +=
          "<tr class=\"karne-exam-row\">" +
          "<td>" +
          escapeHtml(ex.date || "—") +
          "</td><td>" +
          escapeHtml(ex.examName) +
          "</td><td><span class=\"karne-tag karne-tag--" +
          (ex.type === "AYT" ? "ayt" : "tyt") +
          "\">" +
          escapeHtml(ex.type) +
          "</span></td><td><strong>" +
          escapeHtml(ex.netStr) +
          "</strong></td><td>" +
          rankCell +
          "</td></tr>";
        if (ex.hasDetail) {
          h += '<tr class="karne-exam-detail"><td colspan="5">';
          h += '<div class="karne-exam-detail__box">';
          h += karneHtmlExamBranchMini(ex.detailTyt, "tyt");
          h += karneHtmlExamBranchMini(ex.detailAyt, "ayt");
          h += "</div></td></tr>";
        }
      });
      h += "</tbody></table></div>";
    }
    h += "</article>";
  });
  h += "</section>";

  h += '<footer class="karne-report__footer">YKS Koçluk · Karne şablonu · TYT / AYT ve ders bazlı özet</footer>';
  h += "</div>";
  return h;
}

function renderKarneReport() {
  populateKarneSelects();
  bindKarneFilters();
  var el = document.getElementById("karnePrintArea");
  if (el) el.innerHTML = buildKarneReportHtml();
  refreshKarneKpis();
}

function buildKarneTsv() {
  var rows = buildKarneStudentSummaries(karneGetFilters());
  var lines = [
    "#\tÖğrenci\tGenel sıra\tTYT #\tTYT ort\tTYT sıra\tAYT #\tAYT ort\tAYT sıra\tToplam ort",
  ];
  rows.forEach(function (r, idx) {
    lines.push(
      idx +
        1 +
        "\t" +
        String(r.name).replace(/\t/g, " ") +
        "\t" +
        r.rankOverall +
        "\t" +
        r.nTyt +
        "\t" +
        String(r.avgTyt).replace(/\t/g, "") +
        "\t" +
        r.rankTytDisp +
        "\t" +
        r.nAyt +
        "\t" +
        String(r.avgAyt).replace(/\t/g, "") +
        "\t" +
        r.rankAytDisp +
        "\t" +
        (r.total > 0 ? r.total.toFixed(2) : "")
    );
  });
  return lines.join("\n");
}

function downloadKarnePdf() {
  var source = document.getElementById("karnePrintArea");
  if (!source || !source.querySelector(".karne-report")) {
    showToast("Önce raporu oluşturun (filtre seçip «Karnı yenile»).");
    return;
  }
  var h2p = window.html2pdf;
  if (typeof h2p !== "function") {
    showToast("PDF kütüphanesi yüklenemedi; sayfayı yenileyin.");
    return;
  }
  var fname = "karne-yks-" + new Date().toISOString().slice(0, 10) + ".pdf";
  var wrap = document.createElement("div");
  wrap.className = "karne-pdf-export-root";
  wrap.setAttribute("aria-hidden", "true");
  wrap.style.cssText =
    "position:fixed;left:0;top:0;width:1120px;max-width:none;max-height:none;height:auto;overflow:visible;background:#fff;z-index:2147483000;opacity:0.02;pointer-events:none;box-sizing:border-box;padding:12px;";
  wrap.innerHTML = source.innerHTML;
  document.body.appendChild(wrap);
  function runPdf() {
  var opt = {
    margin: [6, 6, 6, 6],
    filename: fname,
    image: { type: "jpeg", quality: 0.92 },
    html2canvas: {
      scale: Math.min(2, (window.devicePixelRatio || 1) * 1.5),
      useCORS: true,
      logging: false,
      scrollY: 0,
      scrollX: 0,
      windowWidth: wrap.scrollWidth,
      windowHeight: Math.max(wrap.scrollHeight, 800),
    },
    jsPDF: { unit: "mm", format: "a4", orientation: "landscape" },
    pagebreak: { mode: ["css", "legacy"] },
  };
  showToast("PDF hazırlanıyor…");
  function cleanup() {
    try {
      if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
    } catch (e) {}
  }
  try {
    var worker = h2p().set(opt).from(wrap).save();
    if (worker && typeof worker.then === "function") {
      worker
        .then(function () {
          cleanup();
          showToast("PDF indirildi.");
        })
        .catch(function (err) {
          console.error(err);
          cleanup();
          showToast("PDF oluşturulamadı.");
        });
    } else {
      setTimeout(function () {
        cleanup();
        showToast("PDF indirildi.");
      }, 800);
    }
  } catch (err) {
    console.error(err);
    cleanup();
    showToast("PDF oluşturulamadı.");
  }
  }
  requestAnimationFrame(function () {
    requestAnimationFrame(runPdf);
  });
}

function refreshKarneKpis() {
  var ks = document.getElementById("karneKpiStudents");
  var ke = document.getElementById("karneKpiExams");
  if (ks) ks.textContent = String(cachedStudents.length);
  if (ke) ke.textContent = String(cachedExams.length);
}

/* --- Optik okuyucu — elle giriş (ders bazlı D/Y) --- */
var optikManualBound = false;
var optikManualState = {
  examMode: "TYT",
  aytAlan: "sayisal",
  rows: {},
};

function optikManualEnsureRow(key, soru) {
  if (!optikManualState.rows[key]) optikManualState.rows[key] = { d: 0, y: 0, soru: soru };
  optikManualState.rows[key].soru = soru;
  return optikManualState.rows[key];
}

function optikManualSyncRowInput(key, soru) {
  var r = optikManualEnsureRow(key, soru);
  var cl = clampDy(soru, r.d, r.y);
  r.d = cl.d;
  r.y = cl.y;
  return r;
}

function optikManualClearRows() {
  optikManualState.rows = {};
}

function optikManualComputeTotals() {
  var totalNet = 0;
  var totalD = 0;
  var totalY = 0;
  var totalSoru = 0;
  Object.keys(optikManualState.rows).forEach(function (k) {
    var r = optikManualState.rows[k];
    if (!r || !r.soru) return;
    var cl = clampDy(r.soru, r.d, r.y);
    r.d = cl.d;
    r.y = cl.y;
    totalD += cl.d;
    totalY += cl.y;
    totalSoru += r.soru;
    totalNet += netFromDy(cl.d, cl.y);
  });
  var totalB = Math.max(0, totalSoru - totalD - totalY);
  return { totalNet: totalNet, totalD: totalD, totalY: totalY, totalB: totalB, totalSoru: totalSoru };
}

function optikManualBranchNetForKey(key) {
  var r = optikManualState.rows[key];
  if (!r || !r.soru) return 0;
  var cl = clampDy(r.soru, r.d, r.y);
  return netFromDy(cl.d, cl.y);
}

function optikManualHtmlDyRow(label, rowKey, soru) {
  optikManualSyncRowInput(rowKey, soru);
  var r = optikManualState.rows[rowKey];
  var b = Math.max(0, soru - r.d - r.y);
  var n = netFromDy(r.d, r.y);
  return (
    "<tr><td style=\"text-align:left;font-weight:600\">" +
    escapeHtml(label) +
    "</td><td>" +
    soru +
    '</td><td><input type="number" min="0" max="' +
    soru +
    '" data-optik-key="' +
    rowKey +
    '" data-field="d" value="' +
    r.d +
    '" /></td><td><input type="number" min="0" max="' +
    soru +
    '" data-optik-key="' +
    rowKey +
    '" data-field="y" value="' +
    r.y +
    '" /></td><td>' +
    b +
    "</td><td><strong>" +
    n.toFixed(2) +
    "</strong></td></tr>"
  );
}

function optikManualUpdateKpi() {
  var t = optikManualComputeTotals();
  var netEl = document.getElementById("optikManualKpiNet");
  var dEl = document.getElementById("optikManualKpiD");
  var yEl = document.getElementById("optikManualKpiY");
  var bEl = document.getElementById("optikManualKpiB");
  if (netEl) netEl.textContent = t.totalSoru ? t.totalNet.toFixed(2) : "—";
  if (dEl) dEl.textContent = t.totalSoru ? String(t.totalD) : "—";
  if (yEl) yEl.textContent = t.totalSoru ? String(t.totalY) : "—";
  if (bEl) bEl.textContent = t.totalSoru ? String(t.totalB) : "—";
  document.querySelectorAll("#optikManualBranchRoot [data-optik-net-sum]").forEach(function (el) {
    var keys = el.getAttribute("data-optik-keys");
    if (!keys) return;
    var sum = 0;
    keys.split(",").forEach(function (k) {
      sum += optikManualBranchNetForKey(k.trim());
    });
    el.textContent = sum.toFixed(2) + " net";
  });
}

function renderOptikManualBranchRoot() {
  var root = document.getElementById("optikManualBranchRoot");
  if (!root) return;
  var html = "";
  if (optikManualState.examMode === "TYT") {
    YKS_TYT_BRANCHES.forEach(function (br) {
      if (br.alt && br.alt.length) {
        var keys = br.alt
          .map(function (a) {
            return br.id + "_" + a.id;
          })
          .join(",");
        html += '<details class="eds-da__branch" open><summary>' + escapeHtml(br.label);
        html += ' <span class="eds-da__branch-net" data-optik-net-sum="' + br.id + '" data-optik-keys="' + keys + '"></span>';
        html += "</summary><table class=\"eds-da__dy-table\"><thead><tr><th>Alan</th><th>S</th><th>D</th><th>Y</th><th>B</th><th>Net</th></tr></thead><tbody>";
        br.alt.forEach(function (a) {
          var rk = br.id + "_" + a.id;
          html += optikManualHtmlDyRow(a.label, rk, a.soru);
        });
        html += "</tbody></table></details>";
      } else {
        var rowSingle = optikManualHtmlDyRow(br.label, br.id, br.soru);
        html += '<details class="eds-da__branch" open><summary>' + escapeHtml(br.label);
        html += ' <span class="eds-da__branch-net">' + optikManualBranchNetForKey(br.id).toFixed(2) + " net</span>";
        html += "</summary><table class=\"eds-da__dy-table\"><thead><tr><th>Alan</th><th>S</th><th>D</th><th>Y</th><th>B</th><th>Net</th></tr></thead><tbody>";
        html += rowSingle;
        html += "</tbody></table></details>";
      }
    });
  } else {
    var alan = YKS_AYT_BY_ALAN[optikManualState.aytAlan];
    if (alan) {
      alan.branches.forEach(function (br) {
        var rk = "ayt_" + br.id;
        var rowAyt = optikManualHtmlDyRow(br.label, rk, br.soru);
        html += '<details class="eds-da__branch" open><summary>' + escapeHtml(br.label);
        html += ' <span class="eds-da__branch-net">' + optikManualBranchNetForKey(rk).toFixed(2) + " net</span>";
        html += "</summary><table class=\"eds-da__dy-table\"><thead><tr><th>Alan</th><th>S</th><th>D</th><th>Y</th><th>B</th><th>Net</th></tr></thead><tbody>";
        html += rowAyt;
        html += "</tbody></table></details>";
      });
    }
  }
  root.innerHTML = html;
  optikManualUpdateKpi();
}

function optikManualRecomputeFromDom() {
  document.querySelectorAll("#optikManualBranchRoot [data-optik-key]").forEach(function (inp) {
    var key = inp.getAttribute("data-optik-key");
    var field = inp.getAttribute("data-field");
    var r = optikManualState.rows[key];
    if (!r) return;
    var n = parseInt(inp.value, 10);
    if (field === "d") r.d = isNaN(n) ? 0 : n;
    if (field === "y") r.y = isNaN(n) ? 0 : n;
    var cl = clampDy(r.soru, r.d, r.y);
    r.d = cl.d;
    r.y = cl.y;
    inp.value = field === "d" ? cl.d : cl.y;
  });
  optikManualUpdateKpi();
}

function optikManualBuildBranchDetailObject() {
  return {
    examMode: optikManualState.examMode,
    aytAlan: optikManualState.examMode === "AYT" ? optikManualState.aytAlan : null,
    rows: JSON.parse(JSON.stringify(optikManualState.rows)),
    weakTopics: [],
    computed: optikManualComputeTotals(),
  };
}

function optikManualBuildSubjectBreakdownText() {
  var o = optikManualBuildBranchDetailObject();
  var lines = [];
  lines.push(o.examMode + (o.examMode === "AYT" ? " · " + o.aytAlan : ""));
  Object.keys(o.rows).forEach(function (k) {
    var r = o.rows[k];
    var cl = clampDy(r.soru, r.d, r.y);
    lines.push(k + ": D" + cl.d + " Y" + cl.y + " → " + netFromDy(cl.d, cl.y).toFixed(2) + " net");
  });
  return lines.join("\n");
}

function optikManualSetExamMode(mode) {
  optikManualState.examMode = mode;
  optikManualClearRows();
  document.querySelectorAll("[data-optik-manual-exam]").forEach(function (b) {
    var on = b.getAttribute("data-optik-manual-exam") === mode;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-selected", on ? "true" : "false");
  });
  var wrap = document.getElementById("optikManualAytAlanWrap");
  if (wrap) wrap.hidden = mode !== "AYT";
  renderOptikManualBranchRoot();
}

function initOptikManualPage() {
  fillStudentSelects();
  var d = document.getElementById("optikManualExamDate");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  var alan = document.getElementById("optikManualAytAlan");
  if (alan) optikManualState.aytAlan = alan.value || "sayisal";
  renderOptikManualBranchRoot();
}

function bindOptikManualForm() {
  if (optikManualBound) return;
  var rootPanel = document.getElementById("optikManualBranchPanel");
  var sel = document.getElementById("optikManualStudent");
  if (!rootPanel || !sel) return;
  optikManualBound = true;

  rootPanel.addEventListener(
    "change",
    function (e) {
      var t = e.target;
      if (!t || !t.getAttribute || !t.getAttribute("data-optik-key")) return;
      optikManualRecomputeFromDom();
      renderOptikManualBranchRoot();
    },
    true
  );

  document.querySelectorAll("[data-optik-manual-exam]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      optikManualSetExamMode(btn.getAttribute("data-optik-manual-exam") || "TYT");
    });
  });

  var alanSel = document.getElementById("optikManualAytAlan");
  if (alanSel) {
    alanSel.addEventListener("change", function () {
      optikManualState.aytAlan = alanSel.value || "sayisal";
      optikManualClearRows();
      renderOptikManualBranchRoot();
    });
  }

  document.getElementById("btnOptikManualReset") &&
    document.getElementById("btnOptikManualReset").addEventListener("click", function () {
      optikManualClearRows();
      var t = document.getElementById("optikManualExamName");
      if (t) t.value = "";
      var d = document.getElementById("optikManualExamDate");
      if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
      var out = document.getElementById("optikManualResult");
      if (out) out.textContent = "";
      renderOptikManualBranchRoot();
      showToast("Form sıfırlandı.");
    });

  document.getElementById("btnOptikManualSave") &&
    document.getElementById("btnOptikManualSave").addEventListener("click", async function () {
      var sid = sel.value;
      if (!sid) {
        showToast("Öğrenci seçin.");
        return;
      }
      var st = cachedStudents.find(function (x) {
        return x.id === sid;
      });
      if (!st) {
        showToast("Öğrenci bulunamadı.");
        return;
      }
      var tot = optikManualComputeTotals();
      if (!tot.totalSoru) {
        showToast("Branşlara D/Y girin.");
        return;
      }
      var titleEl = document.getElementById("optikManualExamName");
      var dateEl = document.getElementById("optikManualExamDate");
      var examName = (titleEl && titleEl.value.trim()) || "Optik elle giriş";
      var exD = dateEl && dateEl.value;
      var examDateTs = exD ? Timestamp.fromDate(new Date(exD)) : null;
      var examType = optikManualState.examMode;
      var payload = {
        studentId: sid,
        studentName: st.name || st.studentName || "",
        examType: examType,
        tur: examType,
        net: String(tot.totalNet.toFixed(2)),
        examDate: examDateTs,
        date: exD || "",
        examName: examName,
        subjectBreakdown: optikManualBuildSubjectBreakdownText(),
        status: "Kayıt girildi",
        coachExamNote: "",
        yksBranchDetail: optikManualBuildBranchDetailObject(),
      };
      try {
        payload.createdAt = serverTimestamp();
        payload.coach_id = getCoachId();
        await addDoc(collection(db, "exams"), payload);
        showToast("Deneme Firestore'a kaydedildi.");
        var out = document.getElementById("optikManualResult");
        if (out) out.textContent = "Kayıt oluşturuldu: " + examName + " — toplam net " + tot.totalNet.toFixed(2);
        renderExamsFullPage();
        renderDashboardExams();
      } catch (err) {
        console.error(err);
        alert(err.message || err);
      }
    });
}

/* --- Optik toplu içe aktarma — format seçimi --- */
function optikBulkFirestoreType(mode) {
  if (mode === "simple") {
    var s = document.getElementById("optikBulkSimpleExamType");
    return (s && s.value) || "TYT";
  }
  if (mode === "tyt_brans") return "TYT";
  return "AYT";
}

function optikBulkAytAlanFromMode(mode) {
  if (mode === "ayt_sayisal") return "sayisal";
  if (mode === "ayt_ea") return "esit_agirlik";
  if (mode === "ayt_sozel") return "sozel";
  if (mode === "ayt_dil") return "dil";
  return "sayisal";
}

function optikBulkBuildYksDetail(mode, nets) {
  if (mode === "simple") return null;
  var total = 0;
  nets.forEach(function (n) {
    total += n;
  });
  if (mode === "tyt_brans") {
    return {
      examMode: "TYT",
      bulkImport: true,
      bulkMode: "tyt_brans",
      branchNets: {
        turkce: nets[0],
        matematik: nets[1],
        fen: nets[2],
        sosyal: nets[3],
      },
      computed: { totalNet: total },
    };
  }
  var alan = optikBulkAytAlanFromMode(mode);
  var def = YKS_AYT_BY_ALAN[alan];
  if (!def || !def.branches) return { examMode: "AYT", aytAlan: alan, bulkImport: true, computed: { totalNet: total } };
  var branchNets = {};
  def.branches.forEach(function (br, i) {
    if (nets[i] != null && !isNaN(nets[i])) branchNets[br.id] = nets[i];
  });
  return {
    examMode: "AYT",
    aytAlan: alan,
    bulkImport: true,
    bulkMode: mode,
    branchNets: branchNets,
    computed: { totalNet: total },
  };
}

function optikBulkSubjectLines(mode, detail) {
  if (!detail || !detail.branchNets) return "";
  var lines = [];
  Object.keys(detail.branchNets).forEach(function (k) {
    lines.push(k + ": " + Number(detail.branchNets[k]).toFixed(2) + " net");
  });
  return lines.join("\n");
}

function optikBulkExpectedColumnCount(mode) {
  if (mode === "simple") return 2;
  if (mode === "tyt_brans") return 5;
  if (mode === "ayt_sayisal" || mode === "ayt_ea") return 5;
  if (mode === "ayt_sozel") return 8;
  if (mode === "ayt_dil") return 2;
  return 2;
}

function optikBulkParseNets(mode, parts) {
  var n0 = optikBulkExpectedColumnCount(mode);
  if (parts.length < n0) return { err: "Beklenen sütun: " + n0 + ", gelen: " + parts.length };
  var nets = [];
  var i;
  if (mode === "simple") {
    var v = parseTrNum(parts[1]);
    if (isNaN(v)) return { err: "Net okunamadı" };
    return { nets: [v] };
  }
  for (i = 1; i < n0; i++) {
    var x = parseTrNum(parts[i]);
    if (isNaN(x)) return { err: "Sütun " + (i + 1) + " net okunamadı" };
    nets.push(x);
  }
  return { nets: nets };
}

function optikBulkResolveStudent(key) {
  return (
    cachedStudents.find(function (s) {
      return s.id === key;
    }) ||
    cachedStudents.find(function (s) {
      return normName(s.name || s.studentName) === normName(key);
    })
  );
}

function optikBulkUpdateHint() {
  var host = document.getElementById("optikBulkHint");
  var mode = (document.getElementById("optikBulkMode") || {}).value || "simple";
  var simpleWrap = document.getElementById("optikBulkSimpleExamWrap");
  var autoP = document.getElementById("optikBulkTypeAuto");
  if (simpleWrap) simpleWrap.style.display = mode === "simple" ? "" : "none";
  if (autoP) {
    autoP.style.display = mode === "simple" ? "none" : "block";
  }
  if (!host) return;
  var h = {
    simple:
      "<strong>Tek NET:</strong> Her satır: <code>öğrenciID veya ad soyad</code> + sekme + <code>net</code> (ör. <code>abc123Tab32,5</code>).",
    tyt_brans:
      "<strong>TYT 4 branş:</strong> <code>öğrenci</code> + 4 sütun: Türkçe net, Matematik net, Fen net, Sosyal net (ayırıcı tab veya noktalı virgül).",
    ayt_sayisal:
      "<strong>AYT Sayısal:</strong> öğrenci + Mat, Fizik, Kimya, Biyo netleri (4 sütun).",
    ayt_ea: "<strong>AYT EA:</strong> öğrenci + Mat, Edebiyat, Tarih-1, Coğrafya-1 netleri.",
    ayt_sozel:
      "<strong>AYT Sözel:</strong> öğrenci + 7 ders neti (sıra: Edebiyat, Tarih-1, Tarih-2, Coğ-1, Coğ-2, Felsefe, Din).",
    ayt_dil: "<strong>AYT Dil:</strong> öğrenci + YDT neti (tek sütun).",
  };
  host.innerHTML = '<p class="eds-da__hint" style="margin:0.5rem 0 0">' + (h[mode] || h.simple) + "</p>";
}

function initOptikKarneTools() {
  bindOptikManualForm();
  initOptikManualPage();

  var modeSel = document.getElementById("optikBulkMode");
  if (modeSel && !modeSel.dataset.boundHint) {
    modeSel.dataset.boundHint = "1";
    modeSel.addEventListener("change", optikBulkUpdateHint);
    optikBulkUpdateHint();
  }

  var tabManual = document.getElementById("optikTabManual");
  var tabBulk = document.getElementById("optikTabBulk");
  var panelManual = document.getElementById("optikPanelManual");
  var panelBulk = document.getElementById("optikPanelBulk");
  function setOptikMain(which) {
    var isMan = which === "manual";
    if (panelManual) panelManual.hidden = !isMan;
    if (panelBulk) panelBulk.hidden = isMan;
    if (tabManual) {
      tabManual.classList.toggle("is-active", isMan);
      tabManual.setAttribute("aria-selected", isMan ? "true" : "false");
    }
    if (tabBulk) {
      tabBulk.classList.toggle("is-active", !isMan);
      tabBulk.setAttribute("aria-selected", !isMan ? "true" : "false");
    }
    if (isMan) initOptikManualPage();
  }
  if (tabManual && !tabManual.dataset.bound) {
    tabManual.dataset.bound = "1";
    tabManual.addEventListener("click", function () {
      setOptikMain("manual");
    });
  }
  if (tabBulk && !tabBulk.dataset.bound) {
    tabBulk.dataset.bound = "1";
    tabBulk.addEventListener("click", function () {
      setOptikMain("bulk");
    });
  }

  var dIn = document.getElementById("optikImportExamDate");
  if (dIn && !dIn.value) dIn.value = new Date().toISOString().slice(0, 10);
  var btnO = document.getElementById("btnOptikImportRun");
  if (btnO && !btnO.dataset.bound) {
    btnO.dataset.bound = "1";
    btnO.addEventListener("click", async function () {
      var ta = document.getElementById("optikBulkTextarea");
      var out = document.getElementById("optikImportResult");
      var mode = (document.getElementById("optikBulkMode") || {}).value || "simple";
      var examType = optikBulkFirestoreType(mode);
      var examName = ((document.getElementById("optikImportExamName") || {}).value || "").trim() || "Toplu optik";
      var dateStr = ((document.getElementById("optikImportExamDate") || {}).value || "").trim();
      var examDateTs = dateStr ? Timestamp.fromDate(new Date(dateStr)) : null;
      if (!ta || !ta.value.trim()) {
        if (out) out.textContent = "Metin alanı boş.";
        return;
      }
      var lines = ta.value.split(/\r?\n/);
      var ok = 0;
      var fail = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i].trim();
        if (!line || line.charAt(0) === "#") continue;
        var parts = line.split(/\t|;/).map(function (x) {
          return x.trim();
        });
        var need = optikBulkExpectedColumnCount(mode);
        if (parts.length < need) {
          fail.push("Satır " + (i + 1) + ": en az " + need + " sütun gerekli");
          continue;
        }
        var key = parts[0];
        var parsed = optikBulkParseNets(mode, parts);
        if (parsed.err) {
          fail.push("Satır " + (i + 1) + ": " + parsed.err);
          continue;
        }
        var stud = optikBulkResolveStudent(key);
        if (!stud) {
          fail.push(key + ": eşleşen öğrenci yok");
          continue;
        }
        var detail = optikBulkBuildYksDetail(mode, parsed.nets);
        var totalNet = 0;
        parsed.nets.forEach(function (x) {
          totalNet += x;
        });
        var subj =
          mode === "simple"
            ? "Optik toplu içe aktarma (tek net)"
            : "Optik toplu — " + mode + "\n" + optikBulkSubjectLines(mode, detail);
        try {
          var row = {
            studentId: stud.id,
            studentName: stud.name || stud.studentName || "",
            examType: examType,
            tur: examType,
            net: String(totalNet.toFixed(2)),
            examDate: examDateTs,
            date: dateStr || "",
            examName: examName,
            subjectBreakdown: subj,
            status: "Kayıt girildi",
            coachExamNote: "",
            createdAt: serverTimestamp(),
            coach_id: getCoachId(),
          };
          if (detail) row.yksBranchDetail = detail;
          await addDoc(collection(db, "exams"), row);
          ok++;
        } catch (err) {
          fail.push((stud.name || key) + ": " + (err.message || err));
        }
      }
      if (out) {
        out.textContent =
          "Tamam: " + ok + " kayıt." + (fail.length ? " Uyarı: " + fail.slice(0, 12).join(" | ") : "");
      }
      showToast("Optik aktarım: " + ok + " kayıt.");
      renderExamsFullPage();
      renderDashboardExams();
    });
  }
  var btnK = document.getElementById("btnKarneBuild");
  if (btnK && !btnK.dataset.bound) {
    btnK.dataset.bound = "1";
    btnK.addEventListener("click", function () {
      var el = document.getElementById("karnePrintArea");
      renderKarneReport();
      showToast("Karne raporu güncellendi.");
    });
  }
  var btnPdf = document.getElementById("btnKarnePdf");
  if (btnPdf && !btnPdf.dataset.bound) {
    btnPdf.dataset.bound = "1";
    btnPdf.addEventListener("click", function () {
      downloadKarnePdf();
    });
  }
  var btnP = document.getElementById("btnKarnePrint");
  if (btnP && !btnP.dataset.bound) {
    btnP.dataset.bound = "1";
    btnP.addEventListener("click", function () {
      window.print();
    });
  }
  var btnCopy = document.getElementById("btnKarneCopyTsv");
  if (btnCopy && !btnCopy.dataset.bound) {
    btnCopy.dataset.bound = "1";
    btnCopy.addEventListener("click", function () {
      var tsv = buildKarneTsv();
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(tsv).then(
          function () {
            showToast("TSV panoya kopyalandı (Excel’e yapıştırın).");
          },
          function () {
            showToast("Kopyalanamadı.");
          }
        );
      } else {
        showToast("Panoya kopyalama desteklenmiyor.");
      }
    });
  }
  var btnClr = document.getElementById("btnOptikClear");
  if (btnClr && !btnClr.dataset.bound) {
    btnClr.dataset.bound = "1";
    btnClr.addEventListener("click", function () {
      var ta = document.getElementById("optikBulkTextarea");
      var out = document.getElementById("optikImportResult");
      if (ta) ta.value = "";
      if (out) out.textContent = "";
    });
  }
  var btnDemo = document.getElementById("btnOptikDemoFill");
  if (btnDemo && !btnDemo.dataset.bound) {
    btnDemo.dataset.bound = "1";
    btnDemo.addEventListener("click", function () {
      var ta = document.getElementById("optikBulkTextarea");
      if (!ta) return;
      var mode = (document.getElementById("optikBulkMode") || {}).value || "simple";
      var lines = [];
      function rnd(a, b) {
        return a + Math.random() * (b - a);
      }
      cachedStudents.slice(0, 3).forEach(function (s) {
        if (mode === "simple") {
          lines.push(s.id + "\t" + rnd(70, 88).toFixed(1).replace(".", ","));
        } else if (mode === "tyt_brans") {
          lines.push(
            s.id +
              "\t" +
              rnd(32, 38).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(28, 36).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(12, 18).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(14, 19).toFixed(1).replace(".", ",")
          );
        } else if (mode === "ayt_sayisal") {
          lines.push(
            s.id +
              "\t" +
              rnd(30, 38).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(8, 13).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(8, 12).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(8, 12).toFixed(1).replace(".", ",")
          );
        } else if (mode === "ayt_ea") {
          lines.push(
            s.id +
              "\t" +
              rnd(28, 36).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(18, 22).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(7, 9).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(4, 6).toFixed(1).replace(".", ",")
          );
        } else if (mode === "ayt_sozel") {
          lines.push(
            s.id +
              "\t" +
              rnd(18, 22).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(8, 10).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(8, 10).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(4, 5).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(8, 10).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(8, 10).toFixed(1).replace(".", ",") +
              "\t" +
              rnd(4, 5).toFixed(1).replace(".", ",")
          );
        } else if (mode === "ayt_dil") {
          lines.push(s.id + "\t" + rnd(75, 92).toFixed(1).replace(".", ","));
        }
      });
      if (lines.length === 0) {
        lines.push("# Önce öğrenci ekleyin veya satırı elle düzenleyin");
      }
      ta.value = lines.join("\n");
      showToast("Örnek şablon yazıldı (seçilen formata göre).");
    });
  }
  var csvInp = document.getElementById("optikCsvFile");
  if (csvInp && !csvInp.dataset.bound) {
    csvInp.dataset.bound = "1";
    csvInp.addEventListener("change", function () {
      var f = csvInp.files && csvInp.files[0];
      csvInp.value = "";
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        var ta = document.getElementById("optikBulkTextarea");
        if (ta && typeof reader.result === "string") {
          ta.value = reader.result.replace(/\r\n/g, "\n");
          showToast("Dosya metin alanına yüklendi.");
        }
      };
      reader.readAsText(f, "UTF-8");
    });
  }
  var btnN = document.getElementById("btnStudentDetailSaveNote");
  if (btnN && !btnN.dataset.bound) {
    btnN.dataset.bound = "1";
    btnN.addEventListener("click", function () {
      var sid = currentStudentDetailId;
      var el = document.getElementById("studentDetailCoachNote");
      if (!sid || !el) return;
      sdSaveNote(sid, el.value);
      showToast("Not kaydedildi (tarayıcı).");
    });
  }
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

/** Bugünden başlayan 7 gün — grafik ekseni (1. etiket = bugün, örn. "20 Mart Cuma") */
function buildRollingAppointmentChartAxis() {
  var start = new Date();
  start.setHours(0, 0, 0, 0);
  var startMs = start.getTime();
  function trTitle(s) {
    if (!s) return "";
    return s.charAt(0).toLocaleUpperCase("tr-TR") + s.slice(1);
  }
  function formatAxisLabel(d) {
    var dayNum = d.getDate();
    var monthStr = d.toLocaleDateString("tr-TR", { month: "long" });
    var wdStr = d.toLocaleDateString("tr-TR", { weekday: "long" });
    return dayNum + " " + trTitle(monthStr) + " " + trTitle(wdStr);
  }
  var labels = [];
  var longNames = [];
  for (var i = 0; i < 7; i++) {
    var d = new Date(startMs + i * 86400000);
    labels.push(formatAxisLabel(d));
    longNames.push(
      d.toLocaleDateString("tr-TR", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    );
  }
  return { startMs: startMs, labels: labels, longNames: longNames };
}

/** Dashboard üstü — YKS 2026 (20 Haziran 2026 10:15) animasyonlu sayaç */
function initDashboardYksCountdownWidget() {
  var root = document.getElementById("yks-countdown-widget");
  if (!root || root.getAttribute("data-yks-widget-init") === "1") return;
  root.setAttribute("data-yks-widget-init", "1");
  var targetMs = new Date(2026, 5, 20, 10, 15, 0).getTime();
  var elD = document.getElementById("yks-widget-days");
  var elH = document.getElementById("yks-widget-hours");
  var elM = document.getElementById("yks-widget-minutes");
  var elS = document.getElementById("yks-widget-seconds");
  function pulseEl(el) {
    if (!el) return;
    el.classList.remove("is-tick");
    void el.offsetWidth;
    el.classList.add("is-tick");
  }
  function setAnim(el, nextStr) {
    if (!el) return;
    if (el.textContent !== String(nextStr)) {
      el.textContent = String(nextStr);
      pulseEl(el);
    }
  }
  function tick() {
    var diff = targetMs - Date.now();
    if (diff <= 0) {
      setAnim(elD, "0");
      setAnim(elH, "00");
      setAnim(elM, "00");
      setAnim(elS, "00");
      return;
    }
    var totalSec = Math.floor(diff / 1000);
    var days = Math.floor(totalSec / 86400);
    totalSec %= 86400;
    var h = Math.floor(totalSec / 3600);
    totalSec %= 3600;
    var m = Math.floor(totalSec / 60);
    var s = totalSec % 60;
    setAnim(elD, String(days));
    setAnim(elH, String(h).padStart(2, "0"));
    setAnim(elM, String(m).padStart(2, "0"));
    setAnim(elS, String(s).padStart(2, "0"));
  }
  tick();
  setInterval(tick, 1000);
}

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
  var roll = buildRollingAppointmentChartAxis();
  var labels = roll.labels;
  var longNames = roll.longNames;
  var counts = [0, 0, 0, 0, 0, 0, 0];
  docs.forEach(function (docSnap) {
    var ap = docSnap.data();
    var t = appointmentSortTime(ap);
    if (!t) return;
    var day = new Date(t);
    day.setHours(0, 0, 0, 0);
    var diff = Math.round((day.getTime() - roll.startMs) / 86400000);
    if (diff >= 0 && diff < 7) counts[diff]++;
  });
  if (randevuChartInstance) {
    randevuChartInstance.destroy();
    randevuChartInstance = null;
  }
  try {
    randevuChartInstance = new Chart(ctx, {
      type: "bar",
      data: {
        labels: labels,
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
                return (longNames[i] || labels[i]) + ": " + item.raw + " randevu";
              },
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              font: { size: 10, weight: "600", family: "Inter, system-ui, sans-serif" },
              color: "#64748b",
              maxRotation: 48,
              minRotation: 0,
              autoSkip: false,
            },
          },
          y: {
            beginAtZero: true,
            ticks: { stepSize: 1, precision: 0, color: "#64748b" },
            grid: { color: "rgba(124, 58, 237, 0.06)" },
          },
        },
      },
    });
  } catch (chartErr) {
    console.error("[Chart] Randevu grafiği:", chartErr);
    randevuChartInstance = null;
  }
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
  refreshStudentDetailIfOpen();
}

function onExamsSnap(snap) {
  cachedExams = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderDashboardExams();
  renderExamsFullPage();
  refreshDashboardAnalytics();
  refreshStudentDetailIfOpen();
  if (currentView === "karne") renderKarneReport();
}

function onStudentsSnap(snap) {
  cachedStudents = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  renderStudentsList(snap.docs);
  renderStudentsPage();
  fillStudentSelects();
  refreshDashboardAnalytics();
  if (
    currentView === "ogrenci-detay" &&
    currentStudentDetailId &&
    !cachedStudents.some(function (s) {
      return s.id === currentStudentDetailId;
    })
  ) {
    currentStudentDetailId = null;
    showToast("Öğrenci silindi veya erişilemiyor.");
    navigateTo("ogrenciler");
    return;
  }
  refreshStudentDetailIfOpen();
  if (currentView === "karne") renderKarneReport();
  if (currentView === "kaynak-kitap") refreshKaynakKitapView();
  if (currentView === "kutuphanem") refreshKutuphanemList();
  if (currentView === "haftalik-program") refreshHpView();
  if (currentView === "hedef-simulator") renderDpHedefSimulator();
  refreshMuhasebeDashboard();
}

function onPaymentsSnap(snap) {
  cachedPayments = snap.docs.map(function (d) {
    return { ...d.data(), id: d.id };
  });
  refreshMuhasebeDashboard();
  renderStudentsPage();
  refreshStudentDetailIfOpen();
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
  ensureFinanceMockSeeded();
  var now = new Date();
  var ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
  var monthTotal = 0;
  cachedPayments.forEach(function (p) {
    var d = (p.paymentDate || "").slice(0, 7);
    if (d === ym) monthTotal += parseFloat(p.amount) || 0;
  });
  var expected = 0;
  var overdueSum = 0;
  cachedStudents.forEach(function (s) {
    var f = getStudentFinanceRow(s.id);
    expected += f.balance;
    if (f.isOverdue) overdueSum += f.overdueAmt;
  });
  var k1 = document.getElementById("muhasebeKpiThisMonth");
  var k2 = document.getElementById("muhasebeKpiExpected");
  var k3 = document.getElementById("muhasebeKpiOverdue");
  if (k1) k1.textContent = monthTotal > 0 ? monthTotal.toLocaleString("tr-TR") + " ₺" : "0 ₺";
  if (k2) k2.textContent = expected > 0 ? expected.toLocaleString("tr-TR") + " ₺" : "0 ₺";
  if (k3) k3.textContent = overdueSum > 0 ? overdueSum.toLocaleString("tr-TR") + " ₺" : "0 ₺";
}

function normalizePhoneForWa(raw) {
  var d = String(raw || "").replace(/\D/g, "");
  if (d.length === 10 && d.charAt(0) === "5") return "90" + d;
  if (d.length === 11 && d.slice(0, 2) === "05") return "9" + d.slice(1);
  if (d.length >= 12 && d.slice(0, 2) === "90") return d;
  return d || "";
}

function renderMuhasebeOverdueTable() {
  var tbody = document.getElementById("muhasebeOverdueBody");
  if (!tbody) return;
  ensureFinanceMockSeeded();
  var rows = [];
  cachedStudents.forEach(function (s) {
    var f = getStudentFinanceRow(s.id);
    if (!f.isOverdue || f.overdueAmt <= 0) return;
    var phone = normalizePhoneForWa(s.parentPhone || s.phone || "");
    rows.push({
      name: s.name || s.studentName || "—",
      phone: phone,
      phoneDisp: s.parentPhone || s.phone || "—",
      amount: f.overdueAmt,
      due: f.dueDate || "—",
      sid: s.id,
    });
  });
  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="table-empty">Geciken kayıt yok.</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(function (r) {
      return (
        "<tr><td>" +
        escapeHtml(r.name) +
        "</td><td>" +
        escapeHtml(r.phoneDisp) +
        "</td><td><strong>" +
        escapeHtml(String(r.amount)) +
        " ₺</strong></td><td>" +
        escapeHtml(r.due) +
        '</td><td><button type="button" class="btn-wa-remind" data-muh-wa="' +
        escapeHtml(r.phone) +
        '" data-muh-student="' +
        escapeHtml(r.name) +
        '"><i class="fa-brands fa-whatsapp"></i> Hatırlat</button></td></tr>'
      );
    })
    .join("");
}

function refreshMuhasebeDashboard() {
  renderMuhasebeStudentLedger();
  renderPaymentsTable();
  updateMuhasebeStats();
  renderMuhasebeOverdueTable();
}

function tmFormatFirestoreDate(val) {
  if (!val) return "—";
  if (typeof val.toDate === "function") {
    try {
      return val.toDate().toLocaleDateString("tr-TR", { day: "numeric", month: "short", year: "numeric" });
    } catch (e) {}
  }
  if (typeof val === "string") return val;
  return "—";
}

function renderTestsTable() {
  var grid = document.getElementById("tmTestsGrid");
  var tbody = document.getElementById("testsTableBody");
  if (cachedTests.length === 0) {
    if (grid) grid.innerHTML = '<p class="tm-tests-grid__empty">Henüz kayıtlı test yok. Test Oluşturucu ile taslak kaydedin.</p>';
    if (tbody) tbody.innerHTML = "";
    return;
  }
  var sorted = cachedTests.slice().reverse();
  if (grid) {
    grid.innerHTML = sorted
    .map(function (t) {
      var tid = escapeHtml(t.id);
        var thumb =
          t.questionImages && t.questionImages[0]
            ? t.questionImages[0]
            : "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="120" height="160" fill="none"><rect width="120" height="160" rx="12" fill="#1e1e24"/><text x="60" y="88" text-anchor="middle" fill="#71717a" font-size="11" font-family="system-ui">Test</text></svg>');
        var dateLabel = tmFormatFirestoreDate(t.testDate) !== "—" ? tmFormatFirestoreDate(t.testDate) : tmFormatFirestoreDate(t.createdAt);
      return (
          '<article class="tm-test-card" data-tm-test-id="' +
          tid +
          '"><div class="tm-test-card__thumb"><img src="' +
          thumb +
          '" alt="" loading="lazy" /></div><div class="tm-test-card__body"><h3 class="tm-test-card__title">' +
          escapeHtml(t.title || "Adsız test") +
          '</h3><p class="tm-test-card__meta"><i class="fa-regular fa-calendar"></i> ' +
          escapeHtml(dateLabel) +
          '</p><div class="tm-test-card__actions"><button type="button" class="tm-test-card__btn tm-test-card__btn--edit" data-tm-acrobat-test="' +
          tid +
          '"><i class="fa-solid fa-file-pen"></i> Düzenle</button><button type="button" class="tm-test-card__btn tm-test-card__btn--del" data-del-test="' +
          tid +
          '"><i class="fa-solid fa-trash"></i> Sil</button></div></div></article>'
      );
    })
    .join("");
  }
  if (tbody) tbody.innerHTML = "";
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

/** 40 pastel çizgi film avatar — gerçek fotoğraf yok (Dicebear avataaars) */
var YKS_CARTOON_BG = ["b6e3f4", "c0aede", "ffd5dc", "d1d4f9", "ffdfbf", "bae6fd", "bbf7d0", "fde68a"];
var YKS_CARTOON_AVATAR_POOL = Array.from({ length: 40 }, function (_, i) {
  var bg = YKS_CARTOON_BG[i % YKS_CARTOON_BG.length];
  return (
    "https://api.dicebear.com/7.x/avataaars/png?seed=" +
    encodeURIComponent("yks_pastel_" + (i + 1)) +
    "&size=128&backgroundColor=" +
    bg
  );
});
var studentAddAvatarState = { mode: "preset", url: YKS_CARTOON_AVATAR_POOL[0], customDataUrl: "" };
var studentEditAvatarState = { mode: "preset", url: YKS_CARTOON_AVATAR_POOL[0], customDataUrl: "" };

function normalizeGender(gender) {
  if (gender === "Kadın" || gender === "Kadin") return "Kadın";
  if (gender === "Tesettür") return "Tesettür";
  return "Erkek";
}

function getAvatarPoolByGender(gender) {
  return YKS_CARTOON_AVATAR_POOL;
}

function hashSimple(str) {
  var s = String(str || "");
  var h = 0;
  for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

function pickDeterministicAvatar(fullName, gender) {
  var pool = getAvatarPoolByGender(gender);
  return pool[hashSimple(String(fullName || "ogrenci")) % pool.length];
}

function buildStudentAvatarUrl(fullName, gender) {
  return pickDeterministicAvatar(fullName, gender);
}

function getSelectedAddGender() {
  var el = document.querySelector('input[name="add_gender"]:checked');
  return normalizeGender(el ? el.value : "Erkek");
}

function updateStudentAvatarMetaText(gender, isCustom) {
  var meta = document.getElementById("stAvatarMeta");
  if (!meta) return;
  if (isCustom) {
    meta.textContent = "Kişisel resim seçildi";
    return;
  }
  meta.textContent = "YKS adayı avatar havuzu — 40 çizgi film (pastel)";
}

function updateEditStudentAvatarMeta(isCustom) {
  var meta = document.getElementById("stEditAvatarMeta");
  if (!meta) return;
  meta.textContent = isCustom ? "Kişisel resim" : "YKS adayı avatar havuzu — 40 çizgi film (pastel)";
}

function setEditStudentAvatarPreview(url, options) {
  var img = document.getElementById("stEditAvatarPreview");
  if (!img || !url) return;
  img.src = url;
  var custom = options && options.mode === "custom";
  studentEditAvatarState.mode = custom ? "custom" : "preset";
  if (custom) {
    studentEditAvatarState.customDataUrl = url;
    studentEditAvatarState.url = "";
  } else {
    studentEditAvatarState.url = url;
    studentEditAvatarState.customDataUrl = "";
  }
  updateEditStudentAvatarMeta(!!custom);
}

function pickRandomAvatarForEditForm() {
  var pool = getAvatarPoolByGender("Erkek");
  if (!pool || !pool.length) return;
  var next = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && next === studentEditAvatarState.url) {
    next = pool[(pool.indexOf(next) + 1) % pool.length];
  }
  setEditStudentAvatarPreview(next, { mode: "preset" });
}

function setStudentAvatarPreview(url, options) {
  var img = document.getElementById("stAvatarPreview");
  if (!img || !url) return;
  img.src = url;
  studentAddAvatarState.url = url;
  studentAddAvatarState.mode = options && options.mode === "custom" ? "custom" : "preset";
  if (studentAddAvatarState.mode !== "custom") studentAddAvatarState.customDataUrl = "";
  updateStudentAvatarMetaText(getSelectedAddGender(), studentAddAvatarState.mode === "custom");
}

function pickRandomAvatarForAddForm() {
  var pool = YKS_CARTOON_AVATAR_POOL;
  if (!pool || !pool.length) return;
  var next = pool[Math.floor(Math.random() * pool.length)];
  if (pool.length > 1 && next === studentAddAvatarState.url) {
    next = pool[(pool.indexOf(next) + 1) % pool.length];
  }
  setStudentAvatarPreview(next, { mode: "preset" });
}

function fileToResizedDataUrl(file, sizePx, quality) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement("canvas");
        c.width = sizePx;
        c.height = sizePx;
        var ctx = c.getContext("2d");
        var ratio = Math.max(sizePx / img.width, sizePx / img.height);
        var w = Math.round(img.width * ratio);
        var h = Math.round(img.height * ratio);
        var x = Math.round((sizePx - w) / 2);
        var y = Math.round((sizePx - h) / 2);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, sizePx, sizePx);
        ctx.drawImage(img, x, y, w, h);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = function () {
        reject(new Error("Gorsel okunamadi"));
      };
      img.src = reader.result;
    };
    reader.onerror = function () {
      reject(new Error("Dosya okunamadi"));
    };
    reader.readAsDataURL(file);
  });
}

function closeAvatarGallerySheet() {
  var sheet = document.getElementById("avatarGallerySheet");
  if (sheet) {
    sheet.hidden = true;
    sheet.setAttribute("aria-hidden", "true");
  }
}

/** Oturum açıldıktan sonra shell: yalnızca Dashboard, avatar/PDF katmanları kapalı */
function applySpaInitialShellState() {
  closeAvatarGallerySheet();
  document.body.classList.remove("tm-annotate-open");
  var ann = document.getElementById("viewPdfDuzenle");
  if (ann) {
    ann.hidden = true;
    ann.setAttribute("hidden", "");
  }
  var app = document.querySelector(".app");
  if (app) app.classList.remove("app--testmaker-workspace");
  currentView = "dashboard";
  document.querySelectorAll(".main-view").forEach(function (el) {
    var v = el.getAttribute("data-view");
    var on = v === "dashboard";
    el.classList.toggle("is-active", on);
    el.hidden = !on;
  });
  var cre = document.getElementById("tmViewCreator");
  if (cre) cre.hidden = true;
  document.querySelectorAll(".sidebar__link[data-nav]").forEach(function (btn) {
    var nv = btn.getAttribute("data-nav");
    btn.classList.toggle("sidebar__link--active", nv === "dashboard");
  });
  var tmLi0 = document.querySelector(".sidebar__item--testmaker");
  var tmAcc0 = document.getElementById("sidebarTmToggle");
  if (tmLi0) tmLi0.classList.remove("sidebar__item--tm-open");
  if (tmAcc0) {
    tmAcc0.setAttribute("aria-expanded", "false");
    tmAcc0.classList.remove("sidebar__link--active");
  }
}

function openAvatarGallerySheet(target) {
  var stModal = document.getElementById("studentModal");
  if (!stModal || stModal.hidden) {
    return;
  }
  window.__avatarPickTarget = target === "edit" ? "edit" : "add";
  var sheet = document.getElementById("avatarGallerySheet");
  var grid = document.getElementById("avatarGalleryGrid");
  if (grid && grid.getAttribute("data-built") !== "1") {
    grid.innerHTML = YKS_CARTOON_AVATAR_POOL.map(function (url, idx) {
      return (
        '<button type="button" class="avatar-gallery__cell" data-avatar-idx="' +
        idx +
        '"><img src="' +
        escapeHtml(url) +
        '" alt="" loading="lazy" width="72" height="72" decoding="async"/></button>'
      );
    }).join("");
    grid.setAttribute("data-built", "1");
    grid.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-avatar-idx]");
      if (!b) return;
      var idx = parseInt(b.getAttribute("data-avatar-idx"), 10);
      var u = YKS_CARTOON_AVATAR_POOL[idx];
      if (!u) return;
      if (window.__avatarPickTarget === "edit") {
        setEditStudentAvatarPreview(u, { mode: "preset" });
      } else {
        setStudentAvatarPreview(u, { mode: "preset" });
      }
      closeAvatarGallerySheet();
    });
  }
  if (sheet) {
    sheet.hidden = false;
    sheet.setAttribute("aria-hidden", "false");
  }
}

function initAvatarGalleryUi() {
  document.querySelectorAll("[data-close-avatar-gallery]").forEach(function (el) {
    el.addEventListener("click", function (e) {
      e.preventDefault();
      closeAvatarGallerySheet();
    });
  });
}

function initStudentAvatarPicker() {
  var randomBtn = document.getElementById("btnStAvatarRandom");
  var uploadBtn = document.getElementById("btnStAvatarUpload");
  var galleryBtn = document.getElementById("btnStAvatarGallery");
  var fileInput = document.getElementById("stAvatarFile");
  if (!randomBtn || !uploadBtn || !fileInput) return;

  randomBtn.addEventListener("click", function () {
    pickRandomAvatarForAddForm();
  });
  if (galleryBtn) {
    galleryBtn.addEventListener("click", function () {
      openAvatarGallerySheet("add");
    });
  }
  uploadBtn.addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", async function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    if (!/^image\//i.test(f.type || "")) {
      showToast("Lutfen bir gorsel secin.");
      return;
    }
    try {
      var dataUrl = await fileToResizedDataUrl(f, 180, 0.85);
      studentAddAvatarState.customDataUrl = dataUrl;
      setStudentAvatarPreview(dataUrl, { mode: "custom" });
    } catch (e) {
      console.error(e);
      showToast("Resim islenemedi.");
    }
  });

  document.querySelectorAll('input[name="add_gender"]').forEach(function (r) {
    r.addEventListener("change", function () {
      if (studentAddAvatarState.mode === "custom") {
        updateStudentAvatarMetaText(getSelectedAddGender(), true);
        return;
      }
      pickRandomAvatarForAddForm();
    });
  });
}

function initStudentEditAvatarControls() {
  var randomBtn = document.getElementById("btnStEditAvatarRandom");
  var uploadBtn = document.getElementById("btnStEditAvatarUpload");
  var galleryBtn = document.getElementById("btnStEditAvatarGallery");
  var fileInput = document.getElementById("stEditAvatarFile");
  if (!randomBtn || !uploadBtn || !fileInput) return;
  randomBtn.addEventListener("click", function () {
    pickRandomAvatarForEditForm();
  });
  if (galleryBtn) {
    galleryBtn.addEventListener("click", function () {
      openAvatarGallerySheet("edit");
    });
  }
  uploadBtn.addEventListener("click", function () {
    fileInput.click();
  });
  fileInput.addEventListener("change", async function () {
    var f = fileInput.files && fileInput.files[0];
    fileInput.value = "";
    if (!f) return;
    if (!/^image\//i.test(f.type || "")) {
      showToast("Lutfen bir gorsel secin.");
      return;
    }
    try {
      var dataUrl = await fileToResizedDataUrl(f, 180, 0.85);
      studentEditAvatarState.customDataUrl = dataUrl;
      setEditStudentAvatarPreview(dataUrl, { mode: "custom" });
    } catch (e) {
      console.error(e);
      showToast("Resim islenemedi.");
    }
  });
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
  [
    "ap_student",
    "pay_student",
    "ex_student",
    "daStudentSelect",
    "optikManualStudent",
    "gorevSelectStudent",
    "gorevFilterStudent",
    "kkStudentSelect",
    "hpStudentSelect",
  ].forEach(function (sid) {
    var sel = document.getElementById(sid);
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML =
      sid === "gorevFilterStudent"
        ? '<option value="">— Tüm öğrenciler —</option>'
        : sid === "gorevSelectStudent"
          ? '<option value="">— Opsiyonel (genel ödev) —</option>'
          : sid === "ap_student" ||
              sid === "daStudentSelect" ||
              sid === "optikManualStudent" ||
              sid === "kkStudentSelect" || sid === "hpStudentSelect"
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

/* --- Deneme Analizleri: EDS tarzı branş + yerel trend + Firestore --- */
var DA_CHART_STORAGE_KEY = "yks_deneme_analiz_chart_v1";
var edsDenemeBound = false;

var edsDaState = {
  examMode: "TYT",
  aytAlan: "sayisal",
  rows: {},
  weakTopics: {},
};

function daLoadChartStore() {
  try {
    var raw = localStorage.getItem(DA_CHART_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function daSaveChartStore(obj) {
  try {
    localStorage.setItem(DA_CHART_STORAGE_KEY, JSON.stringify(obj));
  } catch (e) {}
}

function daGetSeries(studentId) {
  if (!studentId) return [];
  var all = daLoadChartStore();
  return Array.isArray(all[studentId]) ? all[studentId] : [];
}

function daAppendChartPoint(studentId, label, tyt, ayt) {
  var all = daLoadChartStore();
  if (!all[studentId]) all[studentId] = [];
  all[studentId].push({
    label: label,
    tyt: tyt,
    ayt: ayt,
    at: Date.now(),
  });
  daSaveChartStore(all);
  return all[studentId];
}

function edsEnsureRow(key, soru) {
  if (!edsDaState.rows[key]) edsDaState.rows[key] = { d: 0, y: 0, soru: soru };
  edsDaState.rows[key].soru = soru;
  return edsDaState.rows[key];
}

function edsSyncRowInput(key, soru) {
  var r = edsEnsureRow(key, soru);
  var cl = clampDy(soru, r.d, r.y);
  r.d = cl.d;
  r.y = cl.y;
  return r;
}

function edsClearRows() {
  edsDaState.rows = {};
  edsDaState.weakTopics = {};
}

function denemeAnalizChartBaseOptions() {
  return {
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: {
        position: "top",
        labels: {
          color: "#334155",
          font: { size: 12, weight: "600" },
          usePointStyle: true,
          padding: 14,
        },
      },
      tooltip: {
        backgroundColor: "rgba(15, 23, 42, 0.94)",
        titleColor: "#f8fafc",
        bodyColor: "#e2e8f0",
        borderColor: "rgba(37, 99, 235, 0.45)",
        borderWidth: 1,
        padding: 12,
      },
    },
    scales: {
      x: {
        ticks: { color: "#64748b", maxRotation: 45, minRotation: 0 },
        grid: { color: "rgba(148, 163, 184, 0.2)" },
      },
      y: {
        beginAtZero: true,
        ticks: { color: "#64748b" },
        grid: { color: "rgba(148, 163, 184, 0.15)" },
      },
    },
  };
}

function edsComputeTotals() {
  var totalNet = 0;
  var totalD = 0;
  var totalY = 0;
  var totalSoru = 0;
  Object.keys(edsDaState.rows).forEach(function (k) {
    var r = edsDaState.rows[k];
    if (!r || !r.soru) return;
    var cl = clampDy(r.soru, r.d, r.y);
    r.d = cl.d;
    r.y = cl.y;
    var b = Math.max(0, r.soru - cl.d - cl.y);
    totalD += cl.d;
    totalY += cl.y;
    totalSoru += r.soru;
    totalNet += netFromDy(cl.d, cl.y);
  });
  var totalB = Math.max(0, totalSoru - totalD - totalY);
  return { totalNet: totalNet, totalD: totalD, totalY: totalY, totalB: totalB, totalSoru: totalSoru };
}

function edsBranchNetForKey(key) {
  var r = edsDaState.rows[key];
  if (!r || !r.soru) return 0;
  var cl = clampDy(r.soru, r.d, r.y);
  return netFromDy(cl.d, cl.y);
}

function edsTytRadarArrays() {
  var tNet = edsBranchNetForKey("turkce");
  var mNet = edsBranchNetForKey("matematik");
  var fenNet = edsBranchNetForKey("fen_fizik") + edsBranchNetForKey("fen_kimya") + edsBranchNetForKey("fen_biyo");
  var sosNet =
    edsBranchNetForKey("sosyal_tarih") +
    edsBranchNetForKey("sosyal_cografya") +
    edsBranchNetForKey("sosyal_felsefe") +
    edsBranchNetForKey("sosyal_din");
  return {
    labels: ["Türkçe", "Matematik", "Fen", "Sosyal"],
    data: [tNet, mNet, fenNet, sosNet],
  };
}

function edsAytRadarArrays() {
  var alan = YKS_AYT_BY_ALAN[edsDaState.aytAlan];
  if (!alan) return { labels: [], data: [] };
  var labels = [];
  var data = [];
  alan.branches.forEach(function (br) {
    labels.push(br.label);
    data.push(edsBranchNetForKey("ayt_" + br.id));
  });
  return { labels: labels, data: data };
}

function renderDenemeAnalizChart() {
  var canvas = document.getElementById("denemeAnalizChart");
  if (!canvas || typeof Chart === "undefined") return;
  var existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  var sel = document.getElementById("daStudentSelect");
  var sid = sel && sel.value;
  var series = daGetSeries(sid);
  var labels = series.map(function (p) {
    return (p.label && String(p.label).trim()) || "Kayıt";
  });
  var tytData = series.map(function (p) {
    return p.tyt != null && p.tyt !== "" ? Number(p.tyt) : null;
  });
  var aytData = series.map(function (p) {
    return p.ayt != null && p.ayt !== "" ? Number(p.ayt) : null;
  });
  new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "TYT toplam net",
          data: tytData,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.12)",
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          spanGaps: false,
          pointRadius: 4,
        },
        {
          label: "AYT toplam net",
          data: aytData,
          borderColor: "#0d9488",
          backgroundColor: "rgba(13, 148, 136, 0.1)",
          borderWidth: 2.5,
          tension: 0.35,
          fill: true,
          spanGaps: false,
          pointRadius: 4,
        },
      ],
    },
    options: denemeAnalizChartBaseOptions(),
  });
}

function renderDenemeRadarChart() {
  var canvas = document.getElementById("denemeRadarChart");
  if (!canvas || typeof Chart === "undefined") return;
  var existing = Chart.getChart(canvas);
  if (existing) existing.destroy();
  var pack = edsDaState.examMode === "TYT" ? edsTytRadarArrays() : edsAytRadarArrays();
  var maxV = 0;
  pack.data.forEach(function (v) {
    if (v > maxV) maxV = v;
  });
  var sugMax = Math.max(10, Math.ceil(maxV / 5) * 5 + 5);
  new Chart(canvas, {
    type: "radar",
    data: {
      labels: pack.labels,
      datasets: [
        {
          label: "Branş net",
          data: pack.data,
          borderColor: "#1e40af",
          backgroundColor: "rgba(30, 64, 175, 0.22)",
          borderWidth: 2,
          pointBackgroundColor: "#2563eb",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        r: {
          min: 0,
          max: sugMax,
          ticks: { color: "#64748b", backdropColor: "transparent" },
          grid: { color: "rgba(148, 163, 184, 0.25)" },
          pointLabels: { color: "#334155", font: { size: 11 } },
        },
      },
      plugins: {
        legend: { display: false },
      },
    },
  });
}

function edsUpdateKpi() {
  var t = edsComputeTotals();
  var netEl = document.getElementById("edsDaKpiNet");
  var dEl = document.getElementById("edsDaKpiD");
  var yEl = document.getElementById("edsDaKpiY");
  var bEl = document.getElementById("edsDaKpiB");
  var rateEl = document.getElementById("edsDaKpiRate");
  if (netEl) netEl.textContent = t.totalSoru ? t.totalNet.toFixed(2) : "—";
  if (dEl) dEl.textContent = t.totalSoru ? String(t.totalD) : "—";
  if (yEl) yEl.textContent = t.totalSoru ? String(t.totalY) : "—";
  if (bEl) bEl.textContent = t.totalSoru ? String(t.totalB) : "—";
  if (rateEl) {
    rateEl.textContent =
      t.totalSoru > 0 ? "Net / soru: " + (t.totalNet / t.totalSoru).toFixed(3) : "Net / soru üstünden";
  }
  document.querySelectorAll("[data-eds-net-sum]").forEach(function (el) {
    var id = el.getAttribute("data-eds-net-sum");
    if (!id) return;
    var sum = 0;
    el.getAttribute("data-eds-keys").split(",").forEach(function (k) {
      sum += edsBranchNetForKey(k.trim());
    });
    el.textContent = sum.toFixed(2) + " net";
  });
}

function edsHtmlDyRow(label, rowKey, soru) {
  edsSyncRowInput(rowKey, soru);
  var r = edsDaState.rows[rowKey];
  var b = Math.max(0, soru - r.d - r.y);
  var n = netFromDy(r.d, r.y);
  return (
    "<tr><td style=\"text-align:left;font-weight:600\">" +
    escapeHtml(label) +
    "</td><td>" +
    soru +
    '</td><td><input type="number" min="0" max="' +
    soru +
    '" data-eds-key="' +
    rowKey +
    '" data-field="d" value="' +
    r.d +
    '" /></td><td><input type="number" min="0" max="' +
    soru +
    '" data-eds-key="' +
    rowKey +
    '" data-field="y" value="' +
    r.y +
    '" /></td><td>' +
    b +
    "</td><td><strong>" +
    n.toFixed(2) +
    "</strong></td></tr>"
  );
}

function renderEdsBranchRoot() {
  var root = document.getElementById("edsDaBranchRoot");
  if (!root) return;
  var html = "";
  if (edsDaState.examMode === "TYT") {
    YKS_TYT_BRANCHES.forEach(function (br) {
      if (br.alt && br.alt.length) {
        var keys = br.alt
          .map(function (a) {
            return br.id + "_" + a.id;
          })
          .join(",");
        html += '<details class="eds-da__branch" open><summary>' + escapeHtml(br.label);
        html += ' <span class="eds-da__branch-net" data-eds-net-sum="' + br.id + '" data-eds-keys="' + keys + '"></span>';
        html += "</summary><table class=\"eds-da__dy-table\"><thead><tr><th>Alan</th><th>S</th><th>D</th><th>Y</th><th>B</th><th>Net</th></tr></thead><tbody>";
        br.alt.forEach(function (a) {
          var rk = br.id + "_" + a.id;
          html += edsHtmlDyRow(a.label, rk, a.soru);
        });
        html += "</tbody></table></details>";
      } else {
        var rowSingle = edsHtmlDyRow(br.label, br.id, br.soru);
        html += '<details class="eds-da__branch" open><summary>' + escapeHtml(br.label);
        html += ' <span class="eds-da__branch-net">' + edsBranchNetForKey(br.id).toFixed(2) + " net</span>";
        html += "</summary><table class=\"eds-da__dy-table\"><thead><tr><th>Alan</th><th>S</th><th>D</th><th>Y</th><th>B</th><th>Net</th></tr></thead><tbody>";
        html += rowSingle;
        html += "</tbody></table></details>";
      }
    });
  } else {
    var alan = YKS_AYT_BY_ALAN[edsDaState.aytAlan];
    if (alan) {
      alan.branches.forEach(function (br) {
        var rk = "ayt_" + br.id;
        var rowAyt = edsHtmlDyRow(br.label, rk, br.soru);
        html += '<details class="eds-da__branch" open><summary>' + escapeHtml(br.label);
        html += ' <span class="eds-da__branch-net">' + edsBranchNetForKey(rk).toFixed(2) + " net</span>";
        html += "</summary><table class=\"eds-da__dy-table\"><thead><tr><th>Alan</th><th>S</th><th>D</th><th>Y</th><th>B</th><th>Net</th></tr></thead><tbody>";
        html += rowAyt;
        html += "</tbody></table></details>";
      });
    }
  }
  root.innerHTML = html;
  edsUpdateKpi();
  renderDenemeRadarChart();
}

function edsCollectTopicList() {
  var list = [];
  if (edsDaState.examMode === "TYT") {
    YKS_TYT_BRANCHES.forEach(function (br) {
      (br.konular || []).forEach(function (k) {
        if (list.indexOf(k) === -1) list.push(k);
      });
    });
  } else {
    var alan = YKS_AYT_BY_ALAN[edsDaState.aytAlan];
    if (alan) {
      alan.branches.forEach(function (br) {
        (br.konular || []).forEach(function (k) {
          if (list.indexOf(k) === -1) list.push(k);
        });
      });
    }
  }
  return list.sort();
}

function renderEdsTopicChips() {
  var host = document.getElementById("edsDaTopicTags");
  if (!host) return;
  var topics = edsCollectTopicList();
  host.innerHTML = topics
    .map(function (t) {
      var on = edsDaState.weakTopics[t] ? " is-on" : "";
      return (
        '<button type="button" class="eds-da__topic-chip' +
        on +
        '" data-topic="' +
        escapeHtml(t) +
        '">' +
        escapeHtml(t) +
        "</button>"
      );
    })
    .join("");
}

function edsRecomputeFromDom() {
  document.querySelectorAll("#edsDaBranchRoot [data-eds-key]").forEach(function (inp) {
    var key = inp.getAttribute("data-eds-key");
    var field = inp.getAttribute("data-field");
    var r = edsDaState.rows[key];
    if (!r) return;
    var n = parseInt(inp.value, 10);
    if (field === "d") r.d = isNaN(n) ? 0 : n;
    if (field === "y") r.y = isNaN(n) ? 0 : n;
    var cl = clampDy(r.soru, r.d, r.y);
    r.d = cl.d;
    r.y = cl.y;
    inp.value = field === "d" ? cl.d : cl.y;
  });
  edsUpdateKpi();
  renderDenemeRadarChart();
}

function edsInitDefaultDate() {
  var d = document.getElementById("daExamDate");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
}

function edsBuildBranchDetailObject() {
  var weak = [];
  Object.keys(edsDaState.weakTopics).forEach(function (k) {
    if (edsDaState.weakTopics[k]) weak.push(k);
  });
  return {
    examMode: edsDaState.examMode,
    aytAlan: edsDaState.aytAlan,
    rows: JSON.parse(JSON.stringify(edsDaState.rows)),
    weakTopics: weak,
    computed: edsComputeTotals(),
  };
}

function edsBuildSubjectBreakdownText() {
  var o = edsBuildBranchDetailObject();
  var lines = [];
  lines.push(o.examMode + (o.examMode === "AYT" ? " · " + o.aytAlan : ""));
  Object.keys(o.rows).forEach(function (k) {
    var r = o.rows[k];
    var cl = clampDy(r.soru, r.d, r.y);
    lines.push(k + ": D" + cl.d + " Y" + cl.y + " → " + netFromDy(cl.d, cl.y).toFixed(2) + " net");
  });
  if (o.weakTopics.length) lines.push("İşaretlenen konular: " + o.weakTopics.join(", "));
  return lines.join("\n");
}

function initDenemeAnalizPage() {
  fillStudentSelects();
  edsInitDefaultDate();
  var alan = document.getElementById("daAytAlan");
  if (alan) alan.value = edsDaState.aytAlan;
  renderEdsBranchRoot();
  renderEdsTopicChips();
  renderDenemeAnalizChart();
}

function bindDenemeAnalizForm() {
  if (edsDenemeBound) return;
  var root = document.getElementById("edsDaBranchRoot");
  var sel = document.getElementById("daStudentSelect");
  if (!root || !sel) return;
  edsDenemeBound = true;

  document.getElementById("edsDaBranchPanel") &&
    document.getElementById("edsDaBranchPanel").addEventListener(
      "change",
      function (e) {
        var t = e.target;
        if (!t || !t.getAttribute || !t.getAttribute("data-eds-key")) return;
        edsRecomputeFromDom();
        renderEdsBranchRoot();
      },
      true
    );

  document.getElementById("edsDaTopicTags") &&
    document.getElementById("edsDaTopicTags").addEventListener("click", function (e) {
      var btn = e.target.closest(".eds-da__topic-chip");
      if (!btn) return;
      var topic = btn.getAttribute("data-topic");
      if (!topic) return;
      edsDaState.weakTopics[topic] = !edsDaState.weakTopics[topic];
      btn.classList.toggle("is-on", edsDaState.weakTopics[topic]);
    });

  function setExamMode(mode) {
    edsDaState.examMode = mode;
    edsClearRows();
    document.querySelectorAll("[data-da-exam]").forEach(function (b) {
      var on = b.getAttribute("data-da-exam") === mode;
      b.classList.toggle("is-active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    var wrap = document.getElementById("daAytAlanWrap");
    if (wrap) wrap.hidden = mode !== "AYT";
    renderEdsBranchRoot();
    renderEdsTopicChips();
  }

  document.querySelectorAll("[data-da-exam]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      setExamMode(btn.getAttribute("data-da-exam") || "TYT");
    });
  });

  var alanSel = document.getElementById("daAytAlan");
  if (alanSel) {
    alanSel.addEventListener("change", function () {
      edsDaState.aytAlan = alanSel.value || "sayisal";
      edsClearRows();
      renderEdsBranchRoot();
      renderEdsTopicChips();
    });
  }

  document.getElementById("btnDaResetForm") &&
    document.getElementById("btnDaResetForm").addEventListener("click", function () {
      edsClearRows();
      var t = document.getElementById("daExamTitle");
      if (t) t.value = "";
      edsInitDefaultDate();
      renderEdsBranchRoot();
      renderEdsTopicChips();
      showToast("Form sıfırlandı.");
    });

  document.getElementById("btnDaSaveLocal") &&
    document.getElementById("btnDaSaveLocal").addEventListener("click", function () {
      var sid = sel.value;
      if (!sid) {
        showToast("Öğrenci seçin.");
        return;
      }
      var titleEl = document.getElementById("daExamTitle");
      var name = (titleEl && titleEl.value.trim()) || "Deneme";
      var tot = edsComputeTotals();
      if (!tot.totalSoru) {
        showToast("Önce branşlara D/Y girin.");
        return;
      }
      var tytPt = edsDaState.examMode === "TYT" ? tot.totalNet : null;
      var aytPt = edsDaState.examMode === "AYT" ? tot.totalNet : null;
      daAppendChartPoint(sid, name, tytPt, aytPt);
      renderDenemeAnalizChart();
      showToast("Yerel trend grafiğe eklendi.");
    });

  document.getElementById("btnDaSaveFirestore") &&
    document.getElementById("btnDaSaveFirestore").addEventListener("click", async function () {
      var sid = sel.value;
      if (!sid) {
        showToast("Öğrenci seçin.");
        return;
      }
      var st = cachedStudents.find(function (x) {
        return x.id === sid;
      });
      if (!st) {
        showToast("Öğrenci bulunamadı.");
        return;
      }
      var tot = edsComputeTotals();
      if (!tot.totalSoru) {
        showToast("Branş verisi girilmedi.");
        return;
      }
      var titleEl = document.getElementById("daExamTitle");
      var dateEl = document.getElementById("daExamDate");
      var examName = (titleEl && titleEl.value.trim()) || "Deneme analizi";
      var exD = dateEl && dateEl.value;
      var examDateTs = exD ? Timestamp.fromDate(new Date(exD)) : null;
      var examType = edsDaState.examMode;
      var payload = {
        studentId: sid,
        studentName: st.name || st.studentName || "",
        examType: examType,
        tur: examType,
        net: String(tot.totalNet.toFixed(2)),
        examDate: examDateTs,
        date: exD || "",
        examName: examName,
        subjectBreakdown: edsBuildSubjectBreakdownText(),
        status: "Analiz tamamlandı",
        coachExamNote: "",
        yksBranchDetail: edsBuildBranchDetailObject(),
      };
      try {
        payload.createdAt = serverTimestamp();
        payload.coach_id = getCoachId();
        await addDoc(collection(db, "exams"), payload);
        showToast("Deneme Firestore'a kaydedildi.");
        renderExamsFullPage();
        renderDashboardExams();
      } catch (err) {
        console.error(err);
        alert(err.message || err);
      }
    });

  sel.addEventListener("change", function () {
    renderDenemeAnalizChart();
  });
}

/* --- Haftalık program + mockTasks (Görev Takibi ile senkron) --- */
var mockTasks = [];
var MOCK_TASKS_STORAGE_KEY = "yks_mock_tasks_v1";
try {
  if (typeof globalThis !== "undefined") globalThis.mockTasks = mockTasks;
} catch (e) {}

/** YKS müfredat örnekleri — ders → konu listesi */
var YKS_HP_MUFRADAT = {
  "TYT Matematik": ["Üslü Sayılar", "Köklü Sayılar", "Sayma ve Olasılık", "Fonksiyonlar", "Trigonometri", "Limit"],
  "TYT Türkçe": ["Sözcükte Anlam", "Cümlede Anlam", "Paragraf", "Yazım Kuralları", "Anlatım Bozuklukları"],
  "TYT Fen": ["Madde ve Endüstri", "Atom", "Kuvvet ve Hareket", "Enerji", "Elektrik"],
  "AYT Matematik": ["Limit", "Süreklilik", "Türev", "İntegral", "Olasılık"],
  "AYT Edebiyat": ["Divan Edebiyatı", "Halk Edebiyatı", "Servet-i Fünun", "Milli Edebiyat"],
  "Paragraf": ["Ana Düşünce", "Yardımcı Düşünce", "Paragraf Tamamlama"],
};

function loadMockTasksFromStorage() {
  try {
    var r = localStorage.getItem(MOCK_TASKS_STORAGE_KEY);
    var next = r ? JSON.parse(r) : [];
    if (!Array.isArray(next)) next = [];
    mockTasks.length = 0;
    next.forEach(function (item) {
      mockTasks.push(item);
    });
  } catch (e) {
    mockTasks.length = 0;
  }
}

function saveMockTasksToStorage() {
  try {
    localStorage.setItem(MOCK_TASKS_STORAGE_KEY, JSON.stringify(mockTasks));
  } catch (e) {}
}

/** Koç → öğrenci paneli: Firestore `studentPortalPlans/{öğrenciFirestoreId}` */

function getOgrenciVerisiTargetStudentId() {
  var sid = "";
  try {
    if (currentView === "haftalik-program" && hpSelectedStudentId) sid = String(hpSelectedStudentId).trim();
  } catch (e) {}
  if (!sid) {
    var gf = document.getElementById("gorevFilterStudent");
    if (gf && gf.value) sid = String(gf.value).trim();
  }
  if (!sid) {
    try {
      if (hpSelectedStudentId) sid = String(hpSelectedStudentId).trim();
    } catch (e2) {}
  }
  return sid;
}

function buildOgrenciVerisiPayload(studentId) {
  loadMockTasksFromStorage();
  rebuildGorevKanbanStateFromCache();
  var sid = String(studentId || "").trim();
  var anchorDate = typeof hpWeekAnchor !== "undefined" && hpWeekAnchor ? hpWeekAnchor : new Date();
  var mon = hpMondayOfWeek(anchorDate);
  var dayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  var dayNames = ["Pazartesi", "Salı", "Çarşamba", "Perşembe", "Cuma", "Cumartesi", "Pazar"];
  var week = [];
  var i;
  for (i = 0; i < 7; i++) {
    var dt = new Date(mon.getTime());
    dt.setDate(mon.getDate() + i);
    var iso = hpLocalISODate(dt);
    var dateLabel = dt.toLocaleDateString("tr-TR", { day: "numeric", month: "long" });
    var tasksForDay = mockTasks
      .filter(function (t) {
        return (
          String(t.studentId || "") === sid &&
          String(t.dueDate || "").slice(0, 10) === iso &&
          t.column !== "done"
        );
      })
      .map(function (t) {
        var det = [];
        if (t.topic) det.push(String(t.topic));
        if (t.resource) det.push("Kaynak: " + t.resource);
        if (t.notes) det.push(t.notes);
        return {
          id: t.id,
          title: hpBuildMockTitle(t),
          detail: det.join(" · ") || "—",
          done: false,
        };
      });
    week.push({
      key: dayKeys[i],
      day: dayNames[i],
      date: dateLabel,
      tasks: tasksForDay,
    });
  }

  var stu = cachedStudents.find(function (x) {
    return String(x.id) === sid;
  });
  var studentName = stu ? String(stu.name || stu.studentName || "").trim() : "";

  var gorevSnapshot = [];
  if (gorevKanbanState) {
    ["todo", "late", "doing", "done"].forEach(function (col) {
      (gorevKanbanState[col] || []).forEach(function (gt) {
        if (String(gt.studentId || "") !== sid) return;
        gorevSnapshot.push({
          id: gt.id,
          title: gt.title,
          description: gt.description || "",
          dueDate: gt.dueDate || "",
          column: col,
        });
      });
    });
  }

  var pool = mockTasks.filter(function (t) {
    return String(t.studentId || "") === sid && t.column !== "done";
  });
  pool.sort(function (a, b) {
    return String(a.dueDate || "").localeCompare(String(b.dueDate || ""));
  });
  var next = pool[0];
  var nextTaskId = next ? next.id : "";
  var nextTask = {
    title: next ? hpBuildMockTitle(next) : "—",
    detail: next
      ? (next.resource ? next.resource + " · " : "") +
        (next.topic || "") +
        " · Teslim: " +
        String(next.dueDate || "")
      : "Koçtan atanmış haftalık görev yok",
    done: false,
  };

  return {
    version: 1,
    updatedAt: Date.now(),
    studentId: sid,
    studentName: studentName,
    weekAnchor: hpLocalISODate(mon),
    week: week,
    nextTaskId: nextTaskId,
    nextTask: nextTask,
    gorevSnapshot: gorevSnapshot,
  };
}

async function saveOgrenciVerisiBridge(opts) {
  opts = opts || {};
  loadMockTasksFromStorage();
  var sid = opts.studentIdOverride ? String(opts.studentIdOverride).trim() : getOgrenciVerisiTargetStudentId();
  if (!sid) {
    if (!opts.silent) showToast("Önce bir öğrenci seçin (Haftalık Program veya Görev Takibi filtresi).");
    return;
  }
  try {
    var payload = buildOgrenciVerisiPayload(sid);
    var planRef = doc(db, "studentPortalPlans", sid);
    var prevSnap = await getDoc(planRef);
    var prevDone = {};
    var prevExists = typeof prevSnap.exists === "function" ? prevSnap.exists() : prevSnap.exists;
    if (prevExists) {
      var pd = prevSnap.data();
      if (pd && pd.taskDoneMap && typeof pd.taskDoneMap === "object") prevDone = pd.taskDoneMap;
    }
    payload.week.forEach(function (day) {
      (day.tasks || []).forEach(function (t) {
        if (prevDone[t.id]) t.done = true;
      });
    });
    if (prevDone[payload.nextTaskId]) payload.nextTask.done = true;
    var cid = getCoachId();
    await setDoc(
      planRef,
      {
        version: payload.version,
        studentId: payload.studentId,
        studentName: payload.studentName,
        weekAnchor: payload.weekAnchor,
        week: payload.week,
        nextTaskId: payload.nextTaskId,
        nextTask: payload.nextTask,
        gorevSnapshot: payload.gorevSnapshot,
        taskDoneMap: prevDone,
        updatedAt: serverTimestamp(),
        coachId: cid || null,
      },
      { merge: true }
    );
    if (!opts.silent) showToast("Öğrenci planı Firestore'a kaydedildi.");
  } catch (e) {
    console.error(e);
    if (!opts.silent) showToast("Kayıt başarısız: " + (e && e.message ? e.message : ""));
  }
}

function hpBuildMockTitle(t) {
  var typeMap = { konu: "📖 Konu", soru: "📝 Soru", deneme: "🎯 Deneme" };
  var tl = typeMap[t.taskType] || "Görev";
  return tl + " · " + String(t.subject || "").trim() + " — " + String(t.topic || "").trim();
}

function hpBuildMockDesc(t) {
  var parts = [];
  if (t.resource) parts.push("Kaynak: " + t.resource);
  if (t.videoUrl) parts.push("Link: " + t.videoUrl);
  if (t.notes) parts.push(t.notes);
  return parts.join("\n");
}

function hpEffectiveMockKanbanColumn(t) {
  var c = t.column || "todo";
  if (c === "done" || c === "doing") return c;
  var d = String(t.dueDate || "").slice(0, 10);
  if (!d) return "todo";
  var today = new Date().toISOString().slice(0, 10);
  /** Gelecek tarihli haftalık ödevler de Görev Takibi (Yapılacaklar) sütununda görünsün */
  if (d > today) return "todo";
  if (d < today && c === "todo") return "late";
  return "todo";
}

function normalizeMockTaskForKanban(t) {
  return {
    id: t.id,
    title: hpBuildMockTitle(t),
    description: hpBuildMockDesc(t),
    studentId: t.studentId || "",
    studentName: t.studentName || "",
    dueDate: t.dueDate || "",
    priority: "normal",
    subject: t.subject || "",
    createdAt: typeof t.createdAt === "number" ? t.createdAt : Date.now(),
  };
}

/* --- Görev Takibi — Kanban + HTML5 Drag & Drop --- */
var GOREV_KANBAN_STORAGE_KEY = "yks_gorev_kanban_v2";
var GOREV_KANBAN_LEGACY_KEY = "yks_gorev_kanban_v1";
var gorevKanbanState = null;
var gorevComposerBound = false;

function gorevTimestampToMs(ts) {
  if (!ts) return Date.now();
  if (typeof ts.toMillis === "function") return ts.toMillis();
  if (typeof ts === "number") return ts;
  return Date.now();
}

function normalizeGorevTask(t) {
  if (!t || !t.id) return null;
  var title = String(t.title || t.text || "").trim();
  if (!title) return null;
  var pr = t.priority;
  if (pr !== "high" && pr !== "low") pr = "normal";
  return {
    id: t.id,
    title: title,
    description: String(t.description || "").trim(),
    studentId: String(t.studentId || ""),
    studentName: String(t.studentName || "").trim(),
    dueDate: String(t.dueDate || "").trim(),
    priority: pr,
    subject: String(t.subject || "").trim(),
    createdAt: gorevTimestampToMs(t.createdAt),
  };
}

function loadGorevKanbanStateRaw() {
  function parseCols(raw) {
    try {
      if (!raw) return { todo: [], doing: [], done: [] };
      var o = JSON.parse(raw);
      return {
        todo: Array.isArray(o.todo) ? o.todo : [],
        doing: Array.isArray(o.doing) ? o.doing : [],
        done: Array.isArray(o.done) ? o.done : [],
      };
    } catch (e) {
      return { todo: [], doing: [], done: [] };
    }
  }
  try {
    var raw2 = localStorage.getItem(GOREV_KANBAN_STORAGE_KEY);
    if (raw2) {
      var st = parseCols(raw2);
      ["todo", "doing", "done"].forEach(function (k) {
        st[k] = st[k].map(normalizeGorevTask).filter(Boolean);
      });
      return st;
    }
    var raw1 = localStorage.getItem(GOREV_KANBAN_LEGACY_KEY);
    if (raw1) {
      var legacy = parseCols(raw1);
      ["todo", "doing", "done"].forEach(function (k) {
        legacy[k] = legacy[k].map(normalizeGorevTask).filter(Boolean);
      });
      return legacy;
    }
  } catch (e) {}
  return { todo: [], doing: [], done: [] };
}

function rebuildGorevKanbanStateFromCache() {
  loadMockTasksFromStorage();
  gorevKanbanState = { todo: [], late: [], doing: [], done: [] };
  var filterEl = document.getElementById("gorevFilterStudent");
  var filterId = filterEl && filterEl.value ? String(filterEl.value).trim() : "";

  function studentMatches(sid) {
    return !filterId || String(sid || "") === filterId;
  }

  if (cachedCoachTasks && cachedCoachTasks.length) {
    var list = filterId
      ? cachedCoachTasks.filter(function (t) {
          return String(t.studentId || "") === filterId;
        })
      : cachedCoachTasks.slice();
    list.forEach(function (t) {
      var col = t.column || "todo";
      if (col !== "todo" && col !== "doing" && col !== "done" && col !== "late") col = "todo";
      if (col === "todo" && gorevIsOverdue(t, "todo")) col = "late";
      var row = normalizeGorevTask(t);
      if (row) gorevKanbanState[col].push(row);
    });
  }

  mockTasks.forEach(function (t) {
    if (!studentMatches(t.studentId)) return;
    var col = hpEffectiveMockKanbanColumn(t);
    if (col === null) return;
    var row = normalizeMockTaskForKanban(t);
    if (row) gorevKanbanState[col].push(row);
  });

  ["todo", "late", "doing", "done"].forEach(function (k) {
    gorevKanbanState[k].sort(function (a, b) {
      return (a.createdAt || 0) - (b.createdAt || 0);
    });
  });
}

function onCoachTasksSnap(snap) {
  var hint = document.getElementById("gorevFirestoreHint");
  if (hint) {
    hint.hidden = true;
    hint.textContent = "";
  }
  cachedCoachTasks = snap.docs.map(function (d) {
    var data = d.data();
    return {
      id: d.id,
      coach_id: data.coach_id,
      title: data.title,
      description: data.description || "",
      studentId: data.studentId || "",
      studentName: data.studentName || "",
      dueDate: data.dueDate || "",
      priority: data.priority || "normal",
      subject: data.subject || "",
      column: data.column || "todo",
      createdAt: data.createdAt,
      updatedAt: data.updatedAt,
    };
  });
  rebuildGorevKanbanStateFromCache();
  renderGorevKanbanCards();
  refreshStudentDetailIfOpen();
}

async function migrateLocalGorevTasksToFirestoreOnce() {
  try {
    if (localStorage.getItem("yks_coach_tasks_migrated_v1")) return;
    var cid = getCoachId();
    if (!cid) return;
    var st = loadGorevKanbanStateRaw();
    var n = 0;
    for (var ki = 0; ki < 3; ki++) {
      var col = ["todo", "doing", "done"][ki];
      var arr = st[col] || [];
      for (var j = 0; j < arr.length; j++) {
        var t = normalizeGorevTask(arr[j]);
        if (!t) continue;
        n++;
        await addDoc(collection(db, "coach_tasks"), {
          coach_id: cid,
          title: t.title,
          description: t.description,
          studentId: t.studentId,
          studentName: t.studentName,
          dueDate: t.dueDate,
          priority: t.priority,
          subject: t.subject,
          column: col,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }
    }
    localStorage.setItem("yks_coach_tasks_migrated_v1", "1");
    if (n > 0) {
      try {
        localStorage.removeItem(GOREV_KANBAN_STORAGE_KEY);
        localStorage.removeItem(GOREV_KANBAN_LEGACY_KEY);
      } catch (e) {}
      showToast("Yerel görevler Firestore'a aktarıldı (" + n + ").");
    }
  } catch (e) {
    console.error("[migrate coach_tasks]", e);
    showToast("Görev aktarımı başarısız. Konsolu kontrol edin.");
  }
}

function findGorevTaskLocation(taskId) {
  if (!gorevKanbanState) return null;
  var keys = ["todo", "late", "doing", "done"];
  for (var i = 0; i < keys.length; i++) {
    var k = keys[i];
    var ix = gorevKanbanState[k].findIndex(function (t) {
      return t.id === taskId;
    });
    if (ix >= 0) return { col: k, index: ix };
  }
  return null;
}

function gorevIsOverdue(task, colKey) {
  if (colKey === "done" || !task || !task.dueDate) return false;
  var today = new Date().toISOString().slice(0, 10);
  return String(task.dueDate) < today;
}

function gorevPriorityLabel(pr) {
  if (pr === "high") return "Yüksek";
  if (pr === "low") return "Düşük";
  return "Normal";
}

function renderGorevKanbanCards() {
  if (!gorevKanbanState) return;
  var map = { todo: "kanbanTodo", late: "kanbanLate", doing: "kanbanDoing", done: "kanbanDone" };
  Object.keys(map).forEach(function (key) {
    var host = document.getElementById(map[key]);
    if (!host) return;
    host.innerHTML = "";
    gorevKanbanState[key].forEach(function (task) {
      var t = normalizeGorevTask(task) || task;
      var card = document.createElement("div");
      card.className = "kanban-card";
      if (t.priority === "high") card.classList.add("kanban-card--pri-high");
      else if (t.priority === "low") card.classList.add("kanban-card--pri-low");
      if (gorevIsOverdue(t, key)) card.classList.add("kanban-card--overdue");
      card.setAttribute("draggable", "true");
      card.setAttribute("data-task-id", t.id);

      var head = document.createElement("div");
      head.className = "kanban-card__head";
      var p = document.createElement("p");
      p.className = "kanban-card__text";
      p.textContent = t.title || t.text || "";
      head.appendChild(p);
      var del = document.createElement("button");
      del.type = "button";
      del.className = "kanban-card__del";
      del.setAttribute("data-task-del", t.id);
      del.setAttribute("aria-label", "Görevi sil");
      del.innerHTML = '<i class="fa-solid fa-xmark"></i>';
      del.draggable = false;
      head.appendChild(del);
      card.appendChild(head);

      var meta = document.createElement("div");
      meta.className = "kanban-card__meta";
      var chips = [];
      if (t.studentName || t.studentId) {
        var st = document.createElement("span");
        st.className = "kanban-card__chip kanban-card__chip--student";
        st.innerHTML = '<i class="fa-solid fa-user-graduate" aria-hidden="true"></i> ' + escapeHtml(t.studentName || "Öğrenci");
        chips.push(st);
      }
      if (t.subject) {
        var sj = document.createElement("span");
        sj.className = "kanban-card__chip";
        sj.textContent = t.subject;
        chips.push(sj);
      }
      if (t.dueDate) {
        var du = document.createElement("span");
        du.className = "kanban-card__chip kanban-card__chip--due";
        du.innerHTML =
          '<i class="fa-regular fa-calendar" aria-hidden="true"></i> ' +
          escapeHtml(t.dueDate) +
          (gorevIsOverdue(t, key) ? ' <strong class="kanban-card__late">Gecikti</strong>' : "");
        chips.push(du);
      }
      if (t.priority && t.priority !== "normal") {
        var pr = document.createElement("span");
        pr.className = "kanban-card__chip kanban-card__chip--pri";
        pr.textContent = gorevPriorityLabel(t.priority);
        chips.push(pr);
      }
      chips.forEach(function (c) {
        meta.appendChild(c);
      });
      if (chips.length) card.appendChild(meta);

      if (t.description) {
        var desc = document.createElement("p");
        desc.className = "kanban-card__desc";
        desc.textContent = t.description;
        card.appendChild(desc);
      }

      host.appendChild(card);
    });
  });
  var bTodo = document.getElementById("kanbanBadgeTodo");
  var bLate = document.getElementById("kanbanBadgeLate");
  var bDoing = document.getElementById("kanbanBadgeDoing");
  var bDone = document.getElementById("kanbanBadgeDone");
  if (bTodo) bTodo.textContent = String(gorevKanbanState.todo.length);
  if (bLate) bLate.textContent = String(gorevKanbanState.late.length);
  if (bDoing) bDoing.textContent = String(gorevKanbanState.doing.length);
  if (bDone) bDone.textContent = String(gorevKanbanState.done.length);
}

function moveGorevKanbanTask(taskId, toCol) {
  if (
    !gorevKanbanState ||
    (toCol !== "todo" && toCol !== "late" && toCol !== "doing" && toCol !== "done")
  ) {
    return;
  }
  var loc = findGorevTaskLocation(taskId);
  if (!loc) return;
  if (loc.col === toCol) return;

  if (String(taskId).indexOf("mt_") === 0) {
    var mt = mockTasks.find(function (x) {
      return x.id === taskId;
    });
    if (!mt) return;
    if (toCol === "late") mt.column = "todo";
    else mt.column = toCol;
    if (toCol === "todo" && mt.dueDate) {
      var today = new Date().toISOString().slice(0, 10);
      if (mt.dueDate < today) mt.dueDate = today;
    }
    saveMockTasksToStorage();
    rebuildGorevKanbanStateFromCache();
    renderGorevKanbanCards();
    return;
  }

  var cid = getCoachId();
  if (!cid) {
    showToast("Oturum bilgisi yok.");
    return;
  }
  var fireCol = toCol === "late" ? "late" : toCol;
  updateDoc(doc(db, "coach_tasks", taskId), { column: fireCol, updatedAt: serverTimestamp() }).catch(function (e) {
    console.error(e);
    showToast("Taşınamadı.");
  });
}

function removeGorevKanbanTask(taskId) {
  if (!taskId) return;
  if (String(taskId).indexOf("mt_") === 0) {
    for (var mi = mockTasks.length - 1; mi >= 0; mi--) {
      if (mockTasks[mi].id === taskId) mockTasks.splice(mi, 1);
    }
    saveMockTasksToStorage();
    rebuildGorevKanbanStateFromCache();
    renderGorevKanbanCards();
    refreshHpWeekIfVisible();
    showToast("Görev silindi.");
    return;
  }
  var cid = getCoachId();
  if (!cid) {
    showToast("Oturum bilgisi yok.");
    return;
  }
  deleteDoc(doc(db, "coach_tasks", taskId))
    .then(function () {
      showToast("Görev silindi.");
    })
    .catch(function (e) {
      console.error(e);
      showToast("Silinemedi.");
    });
}

function addGorevKanbanTaskFromForm(payload) {
  var title = String((payload && payload.title) || "").trim();
  if (!title) {
    showToast("Ödev başlığı girin.");
    return;
  }
  var cid = getCoachId();
  if (!cid) {
    showToast("Oturum bilgisi yok.");
    return;
  }
  var sid = String((payload && payload.studentId) || "").trim();
  var sname = "";
  if (sid) {
    var st = cachedStudents.find(function (x) {
      return x.id === sid;
    });
    if (st) sname = String(st.name || st.studentName || "").trim() || "Öğrenci";
  }
  var pr = payload && payload.priority;
  if (pr !== "high" && pr !== "low") pr = "normal";
  addDoc(collection(db, "coach_tasks"), {
    coach_id: cid,
    title: title,
    description: String((payload && payload.description) || "").trim(),
    studentId: sid,
    studentName: sname,
    dueDate: String((payload && payload.dueDate) || "").trim(),
    priority: pr,
    subject: String((payload && payload.subject) || "").trim(),
    column: "todo",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  })
    .then(function () {
      showToast("Ödev eklendi.");
    })
    .catch(function (e) {
      console.error(e);
      showToast("Kaydedilemedi.");
    });
}

function clearKanbanDropOver() {
  document.querySelectorAll(".kanban-col__cards--over").forEach(function (z) {
    z.classList.remove("kanban-col__cards--over");
  });
}

function setupGorevKanbanDragDrop() {
  var board = document.getElementById("view-gorev-takibi");
  if (!board || board.getAttribute("data-kanban-dnd") === "1") return;
  board.setAttribute("data-kanban-dnd", "1");
  board.addEventListener("dragstart", function (e) {
    if (e.target.closest && e.target.closest(".kanban-card__del")) {
      e.preventDefault();
      return;
    }
    var card = e.target.closest(".kanban-card");
    if (!card || !board.contains(card)) return;
    e.dataTransfer.setData("text/plain", card.getAttribute("data-task-id") || "");
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("kanban-card--dragging");
  });
  board.addEventListener("click", function (e) {
    var del = e.target.closest && e.target.closest("[data-task-del]");
    if (!del || !board.contains(del)) return;
    e.preventDefault();
    e.stopPropagation();
    var id = del.getAttribute("data-task-del");
    if (!id || !confirm("Bu görevi silmek istiyor musunuz?")) return;
    removeGorevKanbanTask(id);
  });
  board.addEventListener("dragend", function (e) {
    var card = e.target.closest(".kanban-card");
    if (card) card.classList.remove("kanban-card--dragging");
    clearKanbanDropOver();
  });
  board.addEventListener("dragover", function (e) {
    var zone = e.target.closest(".kanban-col__cards");
    if (!zone || !board.contains(zone)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    clearKanbanDropOver();
    zone.classList.add("kanban-col__cards--over");
  });
  board.addEventListener("dragleave", function (e) {
    var zone = e.target.closest(".kanban-col__cards");
    if (!zone || !board.contains(zone)) return;
    if (!e.relatedTarget || !zone.contains(e.relatedTarget)) {
      zone.classList.remove("kanban-col__cards--over");
    }
  });
  board.addEventListener("drop", function (e) {
    var zone = e.target.closest(".kanban-col__cards");
    if (!zone || !board.contains(zone)) return;
    e.preventDefault();
    clearKanbanDropOver();
    var id = e.dataTransfer.getData("text/plain");
    var colEl = zone.closest("[data-kanban-col]");
    var toCol = colEl && colEl.getAttribute("data-kanban-col");
    if (!id || !toCol) return;
    moveGorevKanbanTask(id, toCol);
  });
}

function bindGorevTakibiComposerOnce() {
  if (gorevComposerBound) return;
  var addBtn = document.getElementById("btnGorevTakibiAdd");
  var composer = document.getElementById("gorevTakibiComposer");
  var titleEl = document.getElementById("gorevTakibiTitle");
  var descEl = document.getElementById("gorevTakibiDesc");
  var studentSel = document.getElementById("gorevSelectStudent");
  var dueEl = document.getElementById("gorevDueDate");
  var priEl = document.getElementById("gorevPriority");
  var subjEl = document.getElementById("gorevSubject");
  var confirmBtn = document.getElementById("gorevTakibiConfirm");
  var cancelBtn = document.getElementById("gorevTakibiCancel");
  if (!addBtn || !composer || !titleEl || !confirmBtn || !cancelBtn) return;
  gorevComposerBound = true;

  function openComposer() {
    composer.hidden = false;
    try {
      fillStudentSelects();
    } catch (e) {}
    titleEl.focus();
  }
  function closeComposer() {
    composer.hidden = true;
    titleEl.value = "";
    if (descEl) descEl.value = "";
    if (studentSel) studentSel.value = "";
    if (dueEl) dueEl.value = "";
    if (priEl) priEl.value = "normal";
    if (subjEl) subjEl.value = "";
  }

  function submitComposer() {
    addGorevKanbanTaskFromForm({
      title: titleEl.value,
      description: descEl ? descEl.value : "",
      studentId: studentSel ? studentSel.value : "",
      dueDate: dueEl ? dueEl.value : "",
      priority: priEl ? priEl.value : "normal",
      subject: subjEl ? subjEl.value : "",
    });
    closeComposer();
  }

  addBtn.addEventListener("click", function () {
    if (composer.hidden) openComposer();
    else closeComposer();
  });
  cancelBtn.addEventListener("click", closeComposer);
  confirmBtn.addEventListener("click", submitComposer);
}

function bindGorevFilterOnce() {
  if (gorevFilterBound) return;
  var sel = document.getElementById("gorevFilterStudent");
  if (!sel) return;
  gorevFilterBound = true;
  sel.addEventListener("change", function () {
    rebuildGorevKanbanStateFromCache();
    renderGorevKanbanCards();
  });
}

function initGorevTakibiPage() {
  try {
    fillStudentSelects();
  } catch (e) {}
  rebuildGorevKanbanStateFromCache();
  renderGorevKanbanCards();
  setupGorevKanbanDragDrop();
  bindGorevTakibiComposerOnce();
  bindGorevFilterOnce();
  migrateLocalGorevTasksToFirestoreOnce();
}

/** Tek seferde yalnızca bir modal açık — HTML id'leri ile eşleşir */
var MODAL_IDS = ["studentModal", "appointmentModal", "testModal", "financeModal", "examModal", "kkModalAta", "hpWeeklyTaskModal"];

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
  if (modalId === "hpWeeklyTaskModal") hpResetWeeklyTaskModalChrome();
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
  studentAddAvatarState.mode = "preset";
  studentAddAvatarState.customDataUrl = "";
  studentAddAvatarState.url = YKS_CARTOON_AVATAR_POOL[0];
  setStudentAvatarPreview(studentAddAvatarState.url, { mode: "preset" });
  openModal("studentModal");
  var stPw = document.getElementById("st_studentPassword");
  var stPw2 = document.getElementById("st_studentPasswordConfirm");
  if (stPw) stPw.value = "";
  if (stPw2) stPw2.value = "";
  if (window.YksHedefUniPicker) {
    window.YksHedefUniPicker.init().then(function () {
      window.YksHedefUniPicker.resetAddForm();
    });
  }
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
  if (window.YksHedefUniPicker) {
    window.YksHedefUniPicker.init().then(function () {
      window.YksHedefUniPicker.fillEditForm(s.portalUsername, s.targetUniversity, s.targetDepartment);
    });
  }
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
  var sub = document.getElementById("modalStudentSubtitle");
  var title = document.getElementById("modalStudentTitle");
  if (sub) sub.textContent = "Kayıt güncelleniyor. ID: " + studentId.slice(0, 8) + "…";
  if (title) title.innerHTML = '<i class="fa-solid fa-user-pen"></i> Öğrenci düzenle';
  var fullNm = ((fn || "") + " " + (ln || "")).trim();
  var av = s.avatarUrl || buildStudentAvatarUrl(fullNm || (s.name || ""), g);
  var isData = av && String(av).indexOf("data:") === 0;
  setEditStudentAvatarPreview(av, { mode: isData ? "custom" : "preset" });
  openModal("studentModal");
  if (addPane) addPane.hidden = true;
  if (editPane) editPane.hidden = false;
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
  data.avatarUrl =
    studentAddAvatarState.mode === "custom" && studentAddAvatarState.customDataUrl
      ? studentAddAvatarState.customDataUrl
      : studentAddAvatarState.url || buildStudentAvatarUrl(data.name, data.gender);
  data.track = data.examGroup && data.examGroup !== "" ? data.examGroup : "TYT + AYT";
  data.status = data.status || "Aktif";

  var passEl = document.getElementById("st_studentPassword");
  var pass2El = document.getElementById("st_studentPasswordConfirm");
  var pass = passEl ? String(passEl.value || "") : "";
  var pass2 = pass2El ? String(pass2El.value || "") : "";
  var portalRaw = (data.portalUsername || "").trim();
  var wantAuth = !!(portalRaw || pass || pass2);

  if (wantAuth) {
    var u = sanitizeStudentPortalUsername(portalRaw);
    if (!u) {
      showToast("Portal kullanıcı adı yalnızca a-z, 0-9 ve _ içerebilir (giriş için gerekli).");
      return;
    }
    if (pass.length < 6) {
      showToast("Giriş şifresi en az 6 karakter olmalıdır.");
      return;
    }
    if (pass !== pass2) {
      showToast("Şifreler eşleşmiyor.");
      return;
    }
    data.portalUsername = u;
  } else {
    delete data.portalUsername;
  }

  try {
    data.createdAt = serverTimestamp();
    data.coach_id = getCoachId();

    if (wantAuth) {
      var email = data.portalUsername + STUDENT_EMAIL_DOMAIN;
      var cred = await createUserWithEmailAndPassword(studentCreatorAuth, email, pass);
      await setDoc(doc(db, "users", cred.user.uid), {
        username: data.portalUsername,
        role: "student",
        coach_id: getCoachId(),
        fullName: data.name || null,
        frozen: false,
        plainPassword: pass,
        createdAt: serverTimestamp(),
        lastPasswordChangeAt: serverTimestamp(),
      });
      data.studentAuthUid = cred.user.uid;
      try {
        await signOut(studentCreatorAuth);
      } catch (so) {}
    }

    await addDoc(collection(db, "students"), data);
    showToast(
      wantAuth
        ? "Öğrenci kaydedildi; giriş: kullanıcı adı «" + data.portalUsername + "» (şifre: belirlediğiniz)."
        : "Öğrenci başarıyla eklendi (giriş hesabı oluşturulmadı)."
    );
    form.reset();
    if (passEl) passEl.value = "";
    if (pass2El) pass2El.value = "";
    if (window.YksHedefUniPicker) window.YksHedefUniPicker.resetAddForm();
    setStudentErpTab(0);
    closeAllModals();
  } catch (err) {
    console.error(err);
    var msg = err.message || String(err);
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kayıtlı.";
    try {
      await signOut(studentCreatorAuth);
    } catch (so2) {}
    alert("Kayıt hatası: " + msg);
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
    portalUsername: gv("editPortalUsername") || null,
    targetUniversity: gv("editTargetUniversity") || null,
    targetDepartment: gv("editTargetDepartment") || null,
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
  data.avatarUrl =
    studentEditAvatarState.mode === "custom" && studentEditAvatarState.customDataUrl
      ? studentEditAvatarState.customDataUrl
      : studentEditAvatarState.url || buildStudentAvatarUrl(data.name, gender);
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

function openPaymentModalNew(presetStudentId) {
  var f = document.getElementById("formPayment");
  if (f) f.reset();
  var h = document.getElementById("paymentEditDocId");
  if (h) h.value = "";
  resetPaymentModalUi();
  fillStudentSelects();
  var d = document.getElementById("pay_date");
  if (d && !d.value) d.value = new Date().toISOString().slice(0, 10);
  if (presetStudentId) {
    var sel = document.getElementById("pay_student");
    if (sel) sel.value = presetStudentId;
  }
  openModal("financeModal");
}

function openPaymentModalForStudent(studentId) {
  openPaymentModalNew(studentId);
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
  var pm = p.paymentMethod || "Nakit";
  if (pm === "Kredi kartı") pm = "Kredi Kartı";
  document.getElementById("pay_method").value = pm;
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
    if (ev.key !== "Escape") return;
    var sheet = document.getElementById("avatarGallerySheet");
    if (sheet && !sheet.hidden) {
      closeAvatarGallerySheet();
      return;
    }
    closeAllModals();
  });
  var fsAdd = document.getElementById("formStudentAdd");
  if (fsAdd) {
    fsAdd.addEventListener("submit", submitStudentAddForm);
    initStudentErpTabs();
    initStudentAvatarPicker();
  }
  initAvatarGalleryUi();
  initStudentEditAvatarControls();
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
  var qgt = coachQuery("coach_tasks");
  if (!qa || !qe || !qs || !qp || !qt || !qgt) {
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
  firestoreUnsubs.push(
    onSnapshot(
      qgt,
      onCoachTasksSnap,
      function (err) {
        console.error(err);
        var hint = document.getElementById("gorevFirestoreHint");
        if (hint) {
          hint.hidden = false;
          hint.textContent = "Görevler yüklenemedi: " + (err.message || String(err));
        }
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
  tmWsManualCropRemoveSelection();
}

function testmakerWorkspaceLeave() {
  var app = document.querySelector(".app");
  if (app) app.classList.remove("app--testmaker-workspace");
  var ann = document.getElementById("viewPdfDuzenle");
  var head = document.querySelector("#tmWorkspaceRoot .tm-workspace__header");
  var headLib = document.querySelector("#view-library .tm-workspace__header");
  var headPdf = document.querySelector("#view-pdf-editor .tm-workspace__header");
  var headAuto = document.querySelector("#view-auto-test .tm-workspace__header");
  var headCrop = document.querySelector("#view-pdf-cropper .tm-workspace__header");
  document.body.classList.remove("tm-annotate-open");
  if (ann) ann.hidden = true;
  if (head) head.hidden = false;
  if (headLib) headLib.hidden = false;
  if (headPdf) headPdf.hidden = false;
  if (headAuto) headAuto.hidden = false;
  if (headCrop) headCrop.hidden = false;
  destroyTmWsCropper();
  tmWsPdfDoc = null;
  tmWsPdfBytes = null;
  tmEditorPageOrder = [];
  tmEditorAnnotations = {};
  tmEditorClearRedo();
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

/** Test Tasarımı: sorular, ek A4 sayfaları, kaynak PDF/görsel, üst şerit ve logo sıfırlanır (ilk girişe yakın). */
function tmResetTestCreatorWorkspace() {
  tmCloseAllTmFlyouts();

  var container = document.getElementById("a4-pages-container");
  if (container) {
    tmRemoveAnswerKeyPaper();
    container.querySelectorAll(".a4-paper").forEach(function (paper) {
      paper.querySelectorAll('[data-tm-col="1"], [data-tm-col="2"]').forEach(function (col) {
        col.innerHTML = "";
      });
      var sing = paper.querySelector(".tm-a4-single");
      if (sing) {
        sing.innerHTML = "";
        sing.hidden = true;
      }
    });
  }
  tmRemoveExtraA4Pages();

  destroyTmWsCropper();
  tmWsManualCropBuiltDocRef = null;
  tmWsLastCropDataUrl = "";
  tmWsManualCropRemoveSelection();
  tmWsUpdateAnswerKeyUiVisibility();
  tmWsMcSingleImageMode = false;
  tmWsMcZoom = 1;
  tmWsMcPanMode = false;
  tmWsMcPdfPanning = false;
  var panRes = document.getElementById("tmWsPdfPanToggle");
  if (panRes) panRes.setAttribute("aria-pressed", "false");
  var wCropRes = document.getElementById("tmWsPdfCropCanvasWrap");
  if (wCropRes) wCropRes.classList.remove("tm-ws-pdf-crop--pan-mode", "tm-ws-pdf-crop--pan-dragging");
  var wsInner = document.getElementById("tmWsPdfCropScrollInner");
  if (wsInner) wsInner.innerHTML = "";
  if (typeof tmWsManualCropUpdateZoomUi === "function") tmWsManualCropUpdateZoomUi();
  var img = document.getElementById("tmCropImg");
  if (img) {
    img.onload = null;
    img.onerror = null;
    img.removeAttribute("src");
    img.style.display = "none";
  }
  var row = document.getElementById("tmPdfPageRow");
  if (row) row.hidden = true;
  var tot = document.getElementById("pdfPageTotal");
  if (tot) tot.textContent = "0";
  var pin = document.getElementById("pdfPageInput");
  if (pin) {
    pin.value = "1";
    pin.removeAttribute("max");
  }
  tmWsPdfDoc = null;
  tmWsPdfBytes = null;
  tmEditorPageOrder = [];
  tmEditorAnnotations = {};
  tmEditorClearRedo();
  tmWsCurrentPdfPage = 1;
  tmWsPdfRendering = false;
  var th = document.getElementById("tmEditorThumbs");
  if (th) th.innerHTML = "";

  tmActiveLibId = null;

  var addBtn = document.getElementById("tmBtnAddToA4");
  if (addBtn) addBtn.disabled = true;

  var fin = document.getElementById("tmFileInput");
  if (fin) fin.value = "";
  var libInp = document.getElementById("tmLibFileInput");
  if (libInp) libInp.value = "";

  function setVal(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = v;
  }
  setVal("tmWsTitle", "");
  setVal("tmWsCourse", "");
  setVal("tmWsTopic", "");
  setVal("tmHdrStudentInput", "");
  setVal("tmHdrNetInput", "");
  setVal("tmWsInstitution", "");

  var subj = document.getElementById("tmWsSubject");
  if (subj) subj.selectedIndex = 0;
  var diff = document.getElementById("tmWsDiff");
  if (diff) {
    for (var di = 0; di < diff.options.length; di++) {
      if (diff.options[di].value === "Orta") {
        diff.selectedIndex = di;
        break;
      }
    }
  }
  var dateInp = document.getElementById("tmWsTestDate");
  if (dateInp) dateInp.value = new Date().toISOString().slice(0, 10);

  var tmpl = document.getElementById("tmTemplate");
  if (tmpl) tmpl.value = "osym";

  tmSetPageLayout(4);

  tmHeaderLogoDataUrl = "";

  var strip = document.getElementById("tmOptikStrip");
  var optBtn = document.getElementById("tmRailBtnOptik");
  if (strip) strip.hidden = true;
  if (optBtn) {
    optBtn.classList.remove("is-active");
    optBtn.setAttribute("aria-pressed", "false");
  }

  tmApplyWorkspaceTemplate();
  try {
    tmApplyAccentFromStudio("#1A1A1A", true);
  } catch (eAcc) {}

  tmSyncPaperHeaders();
  tmApplyHeaderLogo();
  tmSyncWatermarkLayer();
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
  tmLibraryRenderList();
  showToast("Tasarım sıfırlandı.");
}

function tmOnWorkspaceRefreshClick() {
  var n = tmTotalQuestionBlocks();
  var imgEl = document.getElementById("tmCropImg");
  var hasSrc = !!tmWsPdfDoc || !!(imgEl && imgEl.getAttribute("src")) || !!tmWsLastCropDataUrl;
  var metaTouched =
    (document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value.trim()) ||
    (document.getElementById("tmWsCourse") && document.getElementById("tmWsCourse").value.trim()) ||
    (document.getElementById("tmWsTopic") && document.getElementById("tmWsTopic").value.trim()) ||
    (document.getElementById("tmWsInstitution") && document.getElementById("tmWsInstitution").value.trim()) ||
    (document.getElementById("tmHdrStudentInput") && document.getElementById("tmHdrStudentInput").value.trim()) ||
    (document.getElementById("tmHdrNetInput") && document.getElementById("tmHdrNetInput").value.trim());
  if (n > 0 || hasSrc || metaTouched) {
    if (!confirm("Tüm sorular, açık PDF/görsel ve test bilgileri silinecek. Devam edilsin mi?")) return;
  }
  tmResetTestCreatorWorkspace();
}

function tmPdfNavUpdateDisabled() {
  if (!tmWsPdfDoc) {
    tmWsManualCropUpdateZoomUi();
    return;
  }
  var t = tmWsPdfDoc.numPages || 1;
  var prev = document.getElementById("tmPdfPagePrev");
  var next = document.getElementById("tmPdfPageNext");
  if (prev) prev.disabled = tmWsCurrentPdfPage <= 1 || tmWsPdfRendering;
  if (next) next.disabled = tmWsCurrentPdfPage >= t || tmWsPdfRendering;
  tmWsManualCropUpdateZoomUi();
}

function tmWsManualCropUpdateZoomUi() {
  var zIn = document.getElementById("tmWsPdfZoomIn");
  var zOut = document.getElementById("tmWsPdfZoomOut");
  var zLab = document.getElementById("tmWsPdfZoomLabel");
  var zReset = document.getElementById("tmWsPdfZoomReset");
  var panT = document.getElementById("tmWsPdfPanToggle");
  var pdfOk = !!(tmWsPdfDoc && !tmWsMcSingleImageMode);
  var pct = Math.round(tmWsMcZoom * 100);
  var busy = !!tmWsPdfRendering;
  if (zLab) zLab.textContent = "%" + pct;
  if (zIn) zIn.disabled = !pdfOk || busy || tmWsMcZoom >= TM_WS_MC_ZOOM_MAX - 0.02;
  if (zOut) zOut.disabled = !pdfOk || busy || tmWsMcZoom <= TM_WS_MC_ZOOM_MIN + 0.02;
  if (zReset) zReset.disabled = !pdfOk || busy || Math.abs(tmWsMcZoom - 1) < 0.02;
  if (panT) panT.disabled = !pdfOk || busy;
}

function tmWsManualCropRemoveSelection() {
  var wrap = document.getElementById("tmWsPdfCropCanvasWrap");
  if (!wrap) return;
  wrap.querySelectorAll(".tm-crop-sel-rect").forEach(function (el) {
    if (el.parentNode) el.parentNode.removeChild(el);
  });
}

function tmWsUpdateAnswerKeyUiVisibility() {
  var row = document.getElementById("tmWsAnswerKeyRow");
  if (!row) return;
  var has = !!(tmWsLastCropDataUrl && typeof tmWsLastCropDataUrl === "string" && tmWsLastCropDataUrl.length > 32);
  row.hidden = !has;
  row.querySelectorAll("[data-tm-letter]").forEach(function (btn) {
    btn.disabled = !has;
  });
}

function tmWsManualCropScheduleSync() {
  if (tmWsMcScrollRaf) cancelAnimationFrame(tmWsMcScrollRaf);
  tmWsMcScrollRaf = requestAnimationFrame(function () {
    tmWsMcScrollRaf = 0;
    tmWsManualCropSyncVisiblePages();
  });
}

function tmWsManualCropUnloadSlotIfFar(slot, wrapRect, buffer) {
  var r = slot.getBoundingClientRect();
  if (r.bottom >= wrapRect.top - buffer && r.top <= wrapRect.bottom + buffer) return;
  if (slot.dataset.rendered !== "1") return;
  var main = slot.querySelector(".tm-pdf-crop-slot-canvas");
  if (main) {
    main.width = 1;
    main.height = 1;
    main.removeAttribute("style");
  }
  slot.dataset.rendered = "0";
  var n = parseInt(slot.getAttribute("data-page"), 10);
  if (!isNaN(n)) delete tmWsMcSlotPromises[n];
}

function tmWsManualCropEnsureSlotRendered(n, slot) {
  if (!tmWsPdfDoc || !slot || slot.dataset.rendered === "1") return;
  if (tmWsMcSlotPromises[n]) return;
  var main = slot.querySelector(".tm-pdf-crop-slot-canvas");
  if (!main) return;
  tmWsMcSlotPromises[n] = tmWsPdfDoc
    .getPage(n)
    .then(function (pdfPage) {
      var vp = pdfPage.getViewport({ scale: tmWsMcRenderScale });
      main.width = vp.width;
      main.height = vp.height;
      main.style.width = tmWsMcSlotCssW + "px";
      main.style.height = tmWsMcSlotCssH + "px";
      var ctx = main.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return pdfPage.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        slot.dataset.rendered = "1";
        delete tmWsMcSlotPromises[n];
      });
    })
    .catch(function (err) {
      console.error(err);
      delete tmWsMcSlotPromises[n];
    });
}

function tmWsManualCropUpdatePageFromScroll() {
  if (!tmWsMcWrapEl || !tmWsMcInnerEl) return;
  if (tmWsMcSingleImageMode) return;
  if (!tmWsPdfDoc) return;
  var mid = tmWsMcWrapEl.scrollTop + tmWsMcWrapEl.clientHeight / 2;
  var slots = tmWsMcInnerEl.children;
  var best = 1;
  for (var i = 0; i < slots.length; i++) {
    var el = slots[i];
    var top = el.offsetTop;
    var h = el.offsetHeight;
    if (mid >= top && mid < top + h) {
      best = i + 1;
      break;
    }
    if (top <= mid) best = i + 1;
  }
  var t = tmWsPdfDoc.numPages || 1;
  best = Math.max(1, Math.min(t, best));
  if (best !== tmWsCurrentPdfPage) {
    tmWsCurrentPdfPage = best;
    var pin = document.getElementById("pdfPageInput");
    if (pin) pin.value = String(best);
    tmPdfNavUpdateDisabled();
    tmWsLastCropDataUrl = "";
    tmWsManualCropRemoveSelection();
    tmWsUpdateAnswerKeyUiVisibility();
  }
}

function tmWsManualCropSyncVisiblePages() {
  if (!tmWsMcWrapEl || !tmWsMcInnerEl) return;
  if (tmWsMcSingleImageMode || !tmWsPdfDoc) return;
  var rect = tmWsMcWrapEl.getBoundingClientRect();
  var buffer = 220;
  var unloadBuf = 400;
  var slots = tmWsMcInnerEl.querySelectorAll(".tm-pdf-cropper-page-slot");
  slots.forEach(function (slot) {
    var r = slot.getBoundingClientRect();
    var n = parseInt(slot.getAttribute("data-page"), 10);
    if (isNaN(n)) return;
    var near = r.bottom >= rect.top - buffer && r.top <= rect.bottom + buffer;
    if (near) tmWsManualCropEnsureSlotRendered(n, slot);
    else tmWsManualCropUnloadSlotIfFar(slot, rect, unloadBuf);
  });
  tmWsManualCropUpdatePageFromScroll();
}

function tmWsManualCropScrollToPage(p) {
  if (!tmWsMcInnerEl || !tmWsMcWrapEl || !tmWsPdfDoc) return;
  var t = tmWsPdfDoc.numPages || 1;
  p = Math.max(1, Math.min(t, p));
  var slot = tmWsMcInnerEl.querySelector('.tm-pdf-cropper-page-slot[data-page="' + p + '"]');
  if (!slot) return;
  tmWsMcWrapEl.scrollTop = Math.max(0, slot.offsetTop - 10);
  tmWsCurrentPdfPage = p;
  tmPdfNavUpdateDisabled();
  tmWsManualCropScheduleSync();
}

function tmWsManualCropBuildContinuousView(doc) {
  var inner = document.getElementById("tmWsPdfCropScrollInner");
  var wrap = document.getElementById("tmWsPdfCropCanvasWrap");
  if (!inner || !wrap) return Promise.reject(new Error("tmWsPdfCrop DOM eksik"));
  tmWsMcInnerEl = inner;
  tmWsMcWrapEl = wrap;
  tmWsMcSlotPromises = {};
  tmWsMcSingleImageMode = false;
  inner.innerHTML = "";
  return doc.getPage(1).then(function (p1) {
    var base = p1.getViewport({ scale: 1 });
    var maxW = Math.max(200, wrap.clientWidth - 16);
    var fitScale = maxW / base.width;
    var displayScale = fitScale * tmWsMcZoom;
    var vp = p1.getViewport({ scale: displayScale });
    var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
    var minRasterW = 2400;
    var maxRasterW = 6400;
    var rasterScale = Math.max(displayScale * dpr * 1.25, minRasterW / base.width);
    if (base.width * rasterScale > maxRasterW) rasterScale = maxRasterW / base.width;
    tmWsMcSlotCssW = vp.width;
    tmWsMcSlotCssH = vp.height;
    tmWsMcRenderScale = rasterScale;
    var n = doc.numPages || 0;
    var i;
    for (i = 1; i <= n; i++) {
      var slot = document.createElement("div");
      slot.className = "tm-pdf-cropper-page-slot";
      slot.setAttribute("data-page", String(i));
      if (i < n) slot.style.marginBottom = tmWsMcPageGapPx + "px";
      var badge = document.createElement("div");
      badge.className = "tm-pdf-cropper-page-slot__badge";
      badge.textContent = "Sayfa " + i;
      var holder = document.createElement("div");
      holder.className = "tm-pdf-cropper-slot-inner pdf-canvas-wrapper";
      holder.style.position = "relative";
      holder.style.display = "inline-block";
      var cMain = document.createElement("canvas");
      cMain.className = "tm-pdf-crop-slot-canvas";
      cMain.setAttribute("aria-label", "PDF sayfa " + i);
      holder.appendChild(cMain);
      slot.appendChild(badge);
      slot.appendChild(holder);
      inner.appendChild(slot);
    }
    wrap.scrollTop = 0;
    tmWsManualCropScheduleSync();
    return Promise.resolve();
  });
}

function tmWsManualCropRebuildView(keepPage) {
  if (!tmWsPdfDoc || tmWsMcSingleImageMode) return Promise.resolve();
  var wrap = document.getElementById("tmWsPdfCropCanvasWrap");
  var inner = document.getElementById("tmWsPdfCropScrollInner");
  var ratioX = 0.5;
  var ratioY = 0.5;
  if (wrap && inner && inner.scrollHeight > 0) {
    var cx = wrap.scrollLeft + wrap.clientWidth * 0.5;
    var cy = wrap.scrollTop + wrap.clientHeight * 0.5;
    ratioX = cx / Math.max(inner.scrollWidth, 1);
    ratioY = cy / Math.max(inner.scrollHeight, 1);
    ratioX = Math.max(0, Math.min(1, ratioX));
    ratioY = Math.max(0, Math.min(1, ratioY));
  }
  tmWsLastCropDataUrl = "";
  tmWsManualCropRemoveSelection();
  tmWsUpdateAnswerKeyUiVisibility();
  tmWsManualCropBuiltDocRef = null;
  return tmWsManualCropBuildContinuousView(tmWsPdfDoc).then(function () {
    tmWsManualCropBuiltDocRef = tmWsPdfDoc;
    function restoreScrollAnchor() {
      var w = document.getElementById("tmWsPdfCropCanvasWrap");
      var inn = document.getElementById("tmWsPdfCropScrollInner");
      if (!w || !inn) return;
      var nw = inn.scrollWidth;
      var nh = inn.scrollHeight;
      var sl = ratioX * nw - w.clientWidth * 0.5;
      var st = ratioY * nh - w.clientHeight * 0.5;
      w.scrollLeft = Math.max(0, Math.min(Math.max(0, nw - w.clientWidth), sl));
      w.scrollTop = Math.max(0, Math.min(Math.max(0, nh - w.clientHeight), st));
      tmWsManualCropScheduleSync();
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(restoreScrollAnchor);
    });
  });
}

function tmWsManualCropEnsurePdfView(doc) {
  if (tmWsManualCropBuiltDocRef === doc && tmWsMcInnerEl && tmWsMcInnerEl.children.length) {
    return Promise.resolve();
  }
  tmWsManualCropBuiltDocRef = doc;
  tmWsLastCropDataUrl = "";
  tmWsManualCropRemoveSelection();
  tmWsUpdateAnswerKeyUiVisibility();
  return tmWsManualCropBuildContinuousView(doc);
}

function tmWsManualCropBindOnce() {
  if (tmWsManualCropListenersBound) return;
  var wrap = document.getElementById("tmWsPdfCropCanvasWrap");
  if (!wrap) return;
  tmWsManualCropListenersBound = true;

  function applyWsZoomStep(dir) {
    if (!tmWsPdfDoc || tmWsMcSingleImageMode) return;
    var next =
      tmWsMcZoom * (dir > 0 ? TM_WS_MC_ZOOM_STEP : 1 / TM_WS_MC_ZOOM_STEP);
    next = Math.max(TM_WS_MC_ZOOM_MIN, Math.min(TM_WS_MC_ZOOM_MAX, next));
    if (Math.abs(next - tmWsMcZoom) < 0.001) return;
    tmWsMcZoom = next;
    tmWsManualCropUpdateZoomUi();
    tmWsManualCropRebuildView(tmWsCurrentPdfPage);
  }

  wrap.addEventListener(
    "wheel",
    function (e) {
      if (!tmWsPdfDoc || tmWsMcSingleImageMode) return;
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        applyWsZoomStep(e.deltaY < 0 ? 1 : -1);
        return;
      }
      if (e.shiftKey) {
        e.preventDefault();
        wrap.scrollLeft += e.deltaY;
      }
    },
    { passive: false }
  );

  var zIn = document.getElementById("tmWsPdfZoomIn");
  var zOut = document.getElementById("tmWsPdfZoomOut");
  var zReset = document.getElementById("tmWsPdfZoomReset");
  var panToggle = document.getElementById("tmWsPdfPanToggle");
  if (zIn) zIn.addEventListener("click", function () { applyWsZoomStep(1); });
  if (zOut) zOut.addEventListener("click", function () { applyWsZoomStep(-1); });
  if (zReset)
    zReset.addEventListener("click", function () {
      if (!tmWsPdfDoc || tmWsMcSingleImageMode || Math.abs(tmWsMcZoom - 1) < 0.02) return;
      tmWsMcZoom = 1;
      tmWsManualCropUpdateZoomUi();
      tmWsManualCropRebuildView(tmWsCurrentPdfPage);
    });
  if (panToggle)
    panToggle.addEventListener("click", function () {
      if (!tmWsPdfDoc || tmWsMcSingleImageMode) return;
      tmWsMcPanMode = !tmWsMcPanMode;
      panToggle.setAttribute("aria-pressed", tmWsMcPanMode ? "true" : "false");
      wrap.classList.toggle("tm-ws-pdf-crop--pan-mode", tmWsMcPanMode);
      if (!tmWsMcPanMode) {
        tmWsMcPdfPanning = false;
        wrap.classList.remove("tm-ws-pdf-crop--pan-dragging");
      }
    });

  wrap.addEventListener(
    "mousedown",
    function (e) {
      if (!tmWsMcPanMode || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      tmWsMcPdfPanning = true;
      wrap.classList.add("tm-ws-pdf-crop--pan-dragging");
      tmWsMcPdfPanLastX = e.clientX;
      tmWsMcPdfPanLastY = e.clientY;
    },
    true
  );

  wrap.addEventListener(
    "scroll",
    function () {
      tmWsManualCropScheduleSync();
    },
    { passive: true }
  );
  wrap.addEventListener("mousedown", function (e) {
    if (!tmWsMcInnerEl) return;
    if (tmWsMcPanMode) return;
    var mainCanvas = e.target.closest && e.target.closest(".tm-pdf-crop-slot-canvas");
    if (!mainCanvas) return;
    if (e.button !== 0) return;
    var slot = mainCanvas.closest(".tm-pdf-cropper-page-slot");
    if (!slot) return;
    var holder = mainCanvas.closest(".pdf-canvas-wrapper");
    if (!holder) return;
    var pageNum = parseInt(slot.getAttribute("data-page"), 10);
    if (!isNaN(pageNum)) tmWsCurrentPdfPage = pageNum;
    var pin = document.getElementById("pdfPageInput");
    if (pin) pin.value = String(tmWsCurrentPdfPage);
    tmPdfNavUpdateDisabled();
    tmWsManualCropRemoveSelection();
    var wr = holder.getBoundingClientRect();
    var ox = e.clientX - wr.left;
    var oy = e.clientY - wr.top;
    var box = document.createElement("div");
    box.className = "tm-crop-sel-rect";
    box.setAttribute("aria-hidden", "true");
    box.style.left = ox + "px";
    box.style.top = oy + "px";
    box.style.width = "0px";
    box.style.height = "0px";
    holder.appendChild(box);
    tmWsMcDragWrapper = holder;
    tmWsMcDragBox = box;
    tmWsMcDragOx = ox;
    tmWsMcDragOy = oy;
    tmWsMcDragMain = mainCanvas;
    tmWsMcDragging = true;
    e.preventDefault();
  });
  window.addEventListener("mousemove", function (e) {
    if (tmWsMcPdfPanning) {
      var dx = e.clientX - tmWsMcPdfPanLastX;
      var dy = e.clientY - tmWsMcPdfPanLastY;
      wrap.scrollLeft -= dx;
      wrap.scrollTop -= dy;
      tmWsMcPdfPanLastX = e.clientX;
      tmWsMcPdfPanLastY = e.clientY;
      return;
    }
    if (!tmWsMcDragging || !tmWsMcDragWrapper || !tmWsMcDragBox) return;
    var wr = tmWsMcDragWrapper.getBoundingClientRect();
    var curX = e.clientX - wr.left;
    var curY = e.clientY - wr.top;
    var left = Math.min(tmWsMcDragOx, curX);
    var top = Math.min(tmWsMcDragOy, curY);
    var ww = Math.abs(curX - tmWsMcDragOx);
    var hh = Math.abs(curY - tmWsMcDragOy);
    left = Math.max(0, Math.min(left, wr.width));
    top = Math.max(0, Math.min(top, wr.height));
    ww = Math.min(ww, wr.width - left);
    hh = Math.min(hh, wr.height - top);
    tmWsMcDragBox.style.left = left + "px";
    tmWsMcDragBox.style.top = top + "px";
    tmWsMcDragBox.style.width = ww + "px";
    tmWsMcDragBox.style.height = hh + "px";
  });
  window.addEventListener("mouseup", function () {
    if (tmWsMcPdfPanning) {
      tmWsMcPdfPanning = false;
      wrap.classList.remove("tm-ws-pdf-crop--pan-dragging");
    }
    if (!tmWsMcDragging || !tmWsMcDragMain || !tmWsMcDragWrapper || !tmWsMcDragBox) return;
    var mainCanvas = tmWsMcDragMain;
    var doneBox = tmWsMcDragBox;
    var L = parseFloat(tmWsMcDragBox.style.left) || 0;
    var T = parseFloat(tmWsMcDragBox.style.top) || 0;
    var Wb = parseFloat(tmWsMcDragBox.style.width) || 0;
    var Hb = parseFloat(tmWsMcDragBox.style.height) || 0;
    tmWsMcDragging = false;
    tmWsMcDragMain = null;
    tmWsMcDragWrapper = null;
    tmWsMcDragBox = null;
    if (Wb < 4 || Hb < 4) {
      tmWsManualCropRemoveSelection();
      return;
    }
    var cr = mainCanvas.getBoundingClientRect();
    var wr2 = mainCanvas.closest(".pdf-canvas-wrapper");
    if (!wr2) {
      tmWsManualCropRemoveSelection();
      return;
    }
    var wr = wr2.getBoundingClientRect();
    var cOffL = cr.left - wr.left;
    var cOffT = cr.top - wr.top;
    var dispL = L - cOffL;
    var dispT = T - cOffT;
    var dw = cr.width;
    var dh = cr.height;
    var ix0 = Math.max(0, dispL);
    var iy0 = Math.max(0, dispT);
    var ix1 = Math.min(dw, dispL + Wb);
    var iy1 = Math.min(dh, dispT + Hb);
    var dispWi = ix1 - ix0;
    var dispHi = iy1 - iy0;
    if (dispWi < 4 || dispHi < 4) {
      tmWsManualCropRemoveSelection();
      return;
    }
    var scaleX = mainCanvas.width / Math.max(dw, 1);
    var scaleY = mainCanvas.height / Math.max(dh, 1);
    var x = Math.round(ix0 * scaleX);
    var y = Math.round(iy0 * scaleY);
    var w = Math.round(dispWi * scaleX);
    var h = Math.round(dispHi * scaleY);
    x = Math.max(0, Math.min(x, mainCanvas.width - 1));
    y = Math.max(0, Math.min(y, mainCanvas.height - 1));
    w = Math.min(w, mainCanvas.width - x);
    h = Math.min(h, mainCanvas.height - y);
    var off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    var octx = off.getContext("2d");
    try {
      octx.drawImage(mainCanvas, x, y, w, h, 0, 0, w, h);
      tmWsLastCropDataUrl = off.toDataURL("image/png");
      doneBox.classList.add("tm-crop-sel-rect--pending");
      doneBox.setAttribute("aria-label", "Kırpma alanı — şıkkı seçin");
      tmWsUpdateAnswerKeyUiVisibility();
    } catch (err) {
      console.error(err);
      showToast("Kırpma başarısız.");
      tmWsManualCropRemoveSelection();
    }
  });

  tmWsManualCropUpdateZoomUi();
}

/** PDF sayfa gezgini + sürekli kaydırma + Soru Kırpma ile aynı dikdörtgen seçim */
function renderPDFPage(pageNum) {
  if (!tmWsPdfDoc || typeof pdfjsLib === "undefined") return Promise.resolve();
  var total = tmWsPdfDoc.numPages || 1;
  var n = Math.max(1, Math.min(total, parseInt(pageNum, 10) || 1));
  tmWsCurrentPdfPage = n;
  var orderIdx = tmEditorPageOrder.indexOf(n);
  if (orderIdx >= 0) tmEditorCurrentIdx = orderIdx;
  var inp = document.getElementById("pdfPageInput");
  if (inp) inp.value = String(n);
  tmPdfNavUpdateDisabled();

  destroyTmWsCropper();
  tmWsManualCropBindOnce();

  var addBtn = document.getElementById("tmBtnAddToA4");
  if (addBtn) addBtn.disabled = true;

  tmWsPdfRendering = true;
  tmPdfNavUpdateDisabled();

  return tmWsManualCropEnsurePdfView(tmWsPdfDoc)
    .then(function () {
      tmWsManualCropScrollToPage(n);
      tmWsLastCropDataUrl = "";
      tmWsManualCropRemoveSelection();
      tmWsUpdateAnswerKeyUiVisibility();
      if (addBtn) addBtn.disabled = false;
      tmWsPdfRendering = false;
      tmPdfNavUpdateDisabled();
      tmEditorRenderThumbs();
      tmEditorRenderCurrentPage();
    })
    .catch(function (e) {
      console.error(e);
      tmWsPdfRendering = false;
      if (addBtn) addBtn.disabled = false;
      tmPdfNavUpdateDisabled();
      showToast("PDF önizlemesi açılamadı.");
    });
}

function tmEditorGetPageState(pageNo) {
  if (!tmEditorAnnotations[pageNo]) {
    tmEditorAnnotations[pageNo] = { actions: [] };
  }
  return tmEditorAnnotations[pageNo];
}

function tmEditorGetCurrentPageNo() {
  return tmEditorPageOrder[tmEditorCurrentIdx] || 1;
}

function tmAnnotToolSync() {
  var b = document.querySelector("[data-tm-annot].is-active");
  tmEditorTool = b ? b.getAttribute("data-tm-annot") || "draw" : "draw";
}

function tmEditorReplayActions(ctx, actions, scale) {
  var s = scale == null ? 1 : scale;
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  actions.forEach(function (a) {
    if (!a) return;
    if (a.type === "text") {
      ctx.save();
      ctx.font = "600 18px Inter, system-ui, sans-serif";
      ctx.fillStyle = "#0f172a";
      ctx.fillText(String(a.text || ""), (a.x || 0) * s, (a.y || 0) * s);
      ctx.restore();
      return;
    }
    if (a.type === "rect") {
      ctx.save();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2.4 * s;
      ctx.strokeRect((a.x || 0) * s, (a.y || 0) * s, (a.w || 0) * s, (a.h || 0) * s);
      ctx.restore();
      return;
    }
    if (a.type === "circle") {
      ctx.save();
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2.4 * s;
      ctx.beginPath();
      ctx.ellipse(
        (a.cx || 0) * s,
        (a.cy || 0) * s,
        Math.max((a.rx || 0) * s, 0.5),
        Math.max((a.ry || 0) * s, 0.5),
        0,
        0,
        Math.PI * 2
      );
      ctx.stroke();
      ctx.restore();
      return;
    }
    var pts = a.points;
    if (!pts || pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0].x * s, pts[0].y * s);
    for (var i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x * s, pts[i].y * s);
    if (a.type === "erase") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.strokeStyle = "rgba(0,0,0,1)";
      ctx.lineWidth = 22 * s;
      ctx.stroke();
      ctx.restore();
    } else if (a.type === "hi") {
      ctx.strokeStyle = "rgba(253, 224, 71, 0.55)";
      ctx.lineWidth = 14 * s;
      ctx.stroke();
    } else {
      ctx.strokeStyle = "#22d3ee";
      ctx.lineWidth = 2.4 * s;
      ctx.stroke();
    }
  });
  ctx.restore();
}

function tmEditorDrawOverlay() {
  var canvas = document.getElementById("tmEditorOverlayCanvas");
  if (!canvas) return;
  var ctx = canvas.getContext("2d");
  var pageNo = tmEditorGetCurrentPageNo();
  var st = tmEditorGetPageState(pageNo);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  tmEditorReplayActions(ctx, st.actions, 1);
  if (tmEditorShapeDraft) {
    var d = tmEditorShapeDraft;
    ctx.save();
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(34, 211, 238, 0.9)";
    ctx.lineWidth = 2;
    if (d.type === "rect") {
      var rx = Math.min(d.x, d.x2);
      var ry = Math.min(d.y, d.y2);
      var rw = Math.abs(d.x2 - d.x);
      var rh = Math.abs(d.y2 - d.y);
      ctx.strokeRect(rx, ry, rw, rh);
    } else if (d.type === "circle") {
      var cx = (d.x + d.x2) / 2;
      var cy = (d.y + d.y2) / 2;
      var rxx = Math.abs(d.x2 - d.x) / 2;
      var ryy = Math.abs(d.y2 - d.y) / 2;
      ctx.beginPath();
      ctx.ellipse(cx, cy, Math.max(rxx, 2), Math.max(ryy, 2), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }
}

function tmEditorClearRedo() {
  tmEditorRedoStack = [];
}

function tmEditorUndoLast() {
  if (!tmWsPdfDoc) return;
  var st = tmEditorGetPageState(tmEditorGetCurrentPageNo());
  if (st.actions && st.actions.length) {
    var last = st.actions.pop();
    if (last) tmEditorRedoStack.push(last);
    tmEditorDirty = true;
    tmEditorDrawOverlay();
  }
}

function tmEditorRedoLast() {
  if (!tmWsPdfDoc || !tmEditorRedoStack.length) return;
  var st = tmEditorGetPageState(tmEditorGetCurrentPageNo());
  st.actions.push(tmEditorRedoStack.pop());
  tmEditorDirty = true;
  tmEditorDrawOverlay();
}

function tmEditorCanvasPoint(ev, canvas) {
  var r = canvas.getBoundingClientRect();
  var x = ((ev.clientX - r.left) / Math.max(1, r.width)) * canvas.width;
  var y = ((ev.clientY - r.top) / Math.max(1, r.height)) * canvas.height;
  return { x: x, y: y };
}

function tmEditorBindCanvas() {
  var ov = document.getElementById("tmEditorOverlayCanvas");
  if (!ov || ov._tmBound) return;
  ov._tmBound = true;
  ov.addEventListener("pointerdown", function (ev) {
    if (!tmWsPdfDoc) return;
    tmAnnotToolSync();
    var pageNo = tmEditorGetCurrentPageNo();
    var st = tmEditorGetPageState(pageNo);
    var p = tmEditorCanvasPoint(ev, ov);
    if (tmEditorTool === "text") {
      var txt = window.prompt("Metin girin:", "Not");
      if (txt && String(txt).trim()) {
        tmEditorClearRedo();
        st.actions.push({ type: "text", x: p.x, y: p.y, text: String(txt).trim().slice(0, 280) });
      }
      tmEditorDirty = true;
      tmEditorDrawOverlay();
      return;
    }
    if (tmEditorTool === "rect" || tmEditorTool === "circle") {
      tmEditorDrawing = true;
      tmEditorClearRedo();
      tmEditorShapeDraft = { type: tmEditorTool === "rect" ? "rect" : "circle", x: p.x, y: p.y, x2: p.x, y2: p.y };
      tmEditorDrawOverlay();
      return;
    }
    tmEditorDrawing = true;
    var kind = tmEditorTool === "highlight" ? "hi" : tmEditorTool === "erase" ? "erase" : "draw";
    tmEditorClearRedo();
    st.actions.push({ type: kind, points: [p] });
  });
  ov.addEventListener("pointermove", function (ev) {
    if (!tmWsPdfDoc) return;
    if (tmEditorShapeDraft && tmEditorDrawing) {
      var p = tmEditorCanvasPoint(ev, ov);
      tmEditorShapeDraft.x2 = p.x;
      tmEditorShapeDraft.y2 = p.y;
      tmEditorDrawOverlay();
      return;
    }
    if (!tmEditorDrawing) return;
    var st = tmEditorGetPageState(tmEditorGetCurrentPageNo());
    var cur = st.actions[st.actions.length - 1];
    if (!cur || !cur.points) return;
    var p2 = tmEditorCanvasPoint(ev, ov);
    cur.points.push(p2);
    tmEditorDrawOverlay();
  });
  ov.addEventListener("pointerup", function () {
    if (!tmWsPdfDoc) return;
    if (tmEditorShapeDraft && tmEditorDrawing) {
      var st2 = tmEditorGetPageState(tmEditorGetCurrentPageNo());
      var d = tmEditorShapeDraft;
      tmEditorShapeDraft = null;
      tmEditorDrawing = false;
      var x0 = Math.min(d.x, d.x2);
      var y0 = Math.min(d.y, d.y2);
      var ww = Math.abs(d.x2 - d.x);
      var hh = Math.abs(d.y2 - d.y);
      if (ww >= 3 && hh >= 3) {
        tmEditorClearRedo();
        if (d.type === "rect") {
          st2.actions.push({ type: "rect", x: x0, y: y0, w: ww, h: hh });
        } else {
          st2.actions.push({
            type: "circle",
            cx: (d.x + d.x2) / 2,
            cy: (d.y + d.y2) / 2,
            rx: ww / 2,
            ry: hh / 2,
          });
        }
        tmEditorDirty = true;
      }
      tmEditorDrawOverlay();
      return;
    }
    if (!tmEditorDrawing) return;
    tmEditorDrawing = false;
    tmEditorTempPoint = null;
    tmEditorDirty = true;
    tmEditorDrawOverlay();
  });
}

async function tmEditorRenderCurrentPage() {
  if (!tmWsPdfDoc) return;
  var pageNo = tmEditorGetCurrentPageNo();
  var page = await tmWsPdfDoc.getPage(pageNo);
  var vp = page.getViewport({ scale: tmEditorPdfScale });
  var base = document.getElementById("tmEditorBaseCanvas");
  var ov = document.getElementById("tmEditorOverlayCanvas");
  if (!base || !ov) return;
  base.width = vp.width;
  base.height = vp.height;
  ov.width = vp.width;
  ov.height = vp.height;
  await page.render({ canvasContext: base.getContext("2d"), viewport: vp }).promise;
  tmEditorDrawOverlay();
}

async function tmEditorRenderThumbs() {
  var host = document.getElementById("tmEditorThumbs");
  if (!host) return;
  host.innerHTML = "";
  if (!tmWsPdfDoc || !tmEditorPageOrder.length) return;
  for (var i = 0; i < tmEditorPageOrder.length; i++) {
    var pno = tmEditorPageOrder[i];
    var page = await tmWsPdfDoc.getPage(pno);
    var vp = page.getViewport({ scale: 0.2 });
    var c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    await page.render({ canvasContext: c.getContext("2d"), viewport: vp }).promise;
    var row = document.createElement("div");
    row.className = "tm-editor-thumb" + (i === tmEditorCurrentIdx ? " is-active" : "");
    row.setAttribute("data-idx", String(i));
    row.innerHTML =
      '<img alt="Sayfa önizleme" src="' +
      c.toDataURL("image/jpeg", 0.72) +
      '"><div class="tm-editor-thumb__title">Sayfa ' +
      pno +
      '</div><div class="tm-editor-thumb__actions"><button type="button" title="Yukarı" data-tm-thumb-up="' +
      i +
      '"><i class="fa-solid fa-arrow-up"></i></button><button type="button" title="Aşağı" data-tm-thumb-down="' +
      i +
      '"><i class="fa-solid fa-arrow-down"></i></button><button type="button" title="Sil" data-tm-thumb-del="' +
      i +
      '"><i class="fa-solid fa-trash"></i></button></div>';
    host.appendChild(row);
  }
}

function tmEditorInitFromPdf() {
  if (!tmWsPdfDoc) return;
  tmEditorPageOrder = [];
  tmEditorAnnotations = {};
  tmEditorClearRedo();
  for (var i = 1; i <= (tmWsPdfDoc.numPages || 1); i++) tmEditorPageOrder.push(i);
  tmEditorCurrentIdx = 0;
  tmEditorRenderThumbs();
  tmEditorRenderCurrentPage();
}

async function tmEditorExportPdf() {
  if (!tmWsPdfDoc || !tmEditorPageOrder.length) {
    showToast("Önce bir PDF yükleyin.");
    return;
  }
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    showToast("PDF export kütüphanesi yüklenemedi.");
    return;
  }
  var jsPDFCtor = window.jspdf.jsPDF;
  var docOut = null;
  for (var i = 0; i < tmEditorPageOrder.length; i++) {
    var pno = tmEditorPageOrder[i];
    var page = await tmWsPdfDoc.getPage(pno);
    var vp = page.getViewport({ scale: 2 });
    var c = document.createElement("canvas");
    c.width = vp.width;
    c.height = vp.height;
    var ctx = c.getContext("2d");
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    var st = tmEditorGetPageState(pno);
    tmEditorReplayActions(ctx, st.actions || [], 2 / tmEditorPdfScale);
    var wmm = (c.width * 25.4) / 96;
    var hmm = (c.height * 25.4) / 96;
    if (!docOut) docOut = new jsPDFCtor({ orientation: wmm > hmm ? "landscape" : "portrait", unit: "mm", format: [wmm, hmm] });
    else docOut.addPage([wmm, hmm], wmm > hmm ? "landscape" : "portrait");
    docOut.addImage(c.toDataURL("image/jpeg", 0.92), "JPEG", 0, 0, wmm, hmm);
  }
  var fn = ((document.getElementById("tmWsTitle") || {}).value || "duzenlenmis_pdf").trim().replace(/[\\/:*?"<>|]/g, "-");
  docOut.save((fn || "duzenlenmis_pdf") + "_v2.pdf");
  showToast("Düzenlenmiş PDF indirildi.");
}

function tmWsLoadImageFile(file) {
  var row = document.getElementById("tmPdfPageRow");
  if (row) row.hidden = true;
  tmWsMcZoom = 1;
  tmWsMcPanMode = false;
  tmWsMcPdfPanning = false;
  var panEl = document.getElementById("tmWsPdfPanToggle");
  if (panEl) panEl.setAttribute("aria-pressed", "false");
  tmWsPdfDoc = null;
  tmWsPdfBytes = null;
  tmEditorPageOrder = [];
  tmEditorAnnotations = {};
  tmEditorClearRedo();
  var th = document.getElementById("tmEditorThumbs");
  if (th) th.innerHTML = "";
  destroyTmWsCropper();
  tmWsManualCropBindOnce();
  tmWsCurrentPdfPage = 1;
  tmWsManualCropBuiltDocRef = null;
  tmWsLastCropDataUrl = "";
  tmWsManualCropRemoveSelection();
  tmWsUpdateAnswerKeyUiVisibility();
  var inner = document.getElementById("tmWsPdfCropScrollInner");
  var wrap = document.getElementById("tmWsPdfCropCanvasWrap");
  var addBtn = document.getElementById("tmBtnAddToA4");
  if (!inner || !wrap) return;
  inner.innerHTML = "";
  tmWsMcInnerEl = inner;
  tmWsMcWrapEl = wrap;
  tmWsMcSlotPromises = {};
  tmWsMcSingleImageMode = true;
  var url = URL.createObjectURL(file);
  var im = new Image();
  im.onload = function () {
    URL.revokeObjectURL(url);
    if (wrap) wrap.classList.remove("tm-ws-pdf-crop--pan-mode", "tm-ws-pdf-crop--pan-dragging");
    var maxW = Math.max(200, wrap.clientWidth - 16);
    var sc = Math.min(1, maxW / im.width);
    var w = Math.round(im.width * sc);
    var h = Math.round(im.height * sc);
    var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
    var minRasterW = 2400;
    var mul = Math.max(dpr * 1.25, minRasterW / Math.max(im.width * sc, 1));
    if (im.width * sc * mul > 6400) mul = 6400 / Math.max(im.width * sc, 1);
    tmWsMcSlotCssW = w;
    tmWsMcSlotCssH = h;
    tmWsMcRenderScale = ((im.width * sc * mul) / w) * sc;
    var slot = document.createElement("div");
    slot.className = "tm-pdf-cropper-page-slot";
    slot.setAttribute("data-page", "1");
    var badge = document.createElement("div");
    badge.className = "tm-pdf-cropper-page-slot__badge";
    badge.textContent = "Görsel";
    var holder = document.createElement("div");
    holder.className = "tm-pdf-cropper-slot-inner pdf-canvas-wrapper";
    holder.style.position = "relative";
    holder.style.display = "inline-block";
    var c = document.createElement("canvas");
    c.className = "tm-pdf-crop-slot-canvas";
    c.width = Math.max(1, Math.round(im.width * sc * mul));
    c.height = Math.max(1, Math.round(im.height * sc * mul));
    c.style.width = w + "px";
    c.style.height = h + "px";
    var cctx = c.getContext("2d");
    cctx.imageSmoothingEnabled = true;
    cctx.imageSmoothingQuality = "high";
    cctx.drawImage(im, 0, 0, c.width, c.height);
    slot.dataset.rendered = "1";
    holder.appendChild(c);
    slot.appendChild(badge);
    slot.appendChild(holder);
    inner.appendChild(slot);
    wrap.scrollTop = 0;
    if (addBtn) addBtn.disabled = false;
    tmWsManualCropUpdateZoomUi();
  };
  im.onerror = function () {
    URL.revokeObjectURL(url);
    showToast("Görsel yüklenemedi.");
  };
  im.src = url;
}

function tmWsLoadPdfFromBuffer(buf) {
      if (typeof pdfjsLib === "undefined") {
        showToast("PDF.js yüklenemedi.");
    return Promise.resolve();
  }
  var u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  tmWsPdfBytes = u8;
  return pdfjsLib
    .getDocument({ data: u8 })
        .promise.then(function (doc) {
          tmWsPdfDoc = doc;
      tmWsMcZoom = 1;
      tmWsMcPanMode = false;
      tmWsMcPdfPanning = false;
      var panEl = document.getElementById("tmWsPdfPanToggle");
      if (panEl) panEl.setAttribute("aria-pressed", "false");
      var wCrop = document.getElementById("tmWsPdfCropCanvasWrap");
      if (wCrop) wCrop.classList.remove("tm-ws-pdf-crop--pan-mode", "tm-ws-pdf-crop--pan-dragging");
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
      return renderPDFPage(1).then(function () {
        tmEditorInitFromPdf();
      });
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
  var order = tmGetOrderedQuestionBlocks();
  if (order.length === 0) {
    showToast("A4'e en az bir soru ekleyin.");
    return;
  }
  var arr = [];
  var ansArr = [];
  var total = 0;
  var maxBytes = 900000;
  for (var i = 0; i < order.length; i++) {
    var imgEl = order[i].querySelector("img");
    if (!imgEl) continue;
    var j = await tmWsCompressJpeg(imgEl.src, 700, 0.68);
    if (total + j.length > maxBytes) {
      showToast("Firestore ~1MB sınırı: " + arr.length + " soru kaydedildi.");
      break;
    }
    arr.push(j);
    ansArr.push(order[i].getAttribute("data-tm-answer") || "—");
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
      questionAnswers: ansArr,
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
    "px;margin:0!important;padding:0;box-sizing:border-box;background:#fff;color:#111;position:relative;left:0;top:0;overflow:visible;-webkit-print-color-adjust:exact;print-color-adjust:exact;";
  clone.style.setProperty("--tm-accent", acc);
  clone.style.setProperty("--accent-color", acc);
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

  var liveDual = livePaper.querySelector(".test-content-area");
  var liveSingle = livePaper.querySelector(".tm-a4-single");
  var cDual = clone.querySelector(".test-content-area");
  var cSingle = clone.querySelector(".tm-a4-single");
  var dualHasQuestions = !!(liveDual && liveDual.querySelector(".tm-a4-block.question-item"));

  var padX = Math.round(10 * mm);
  var padB = Math.round(10 * mm);
  var colGap = Math.round(2 * mm);

  /* Alt sayfalarda hidden yanlış kalırsa bile soru varsa çift sütunu PDF’e zorla */
  if (cDual && (dualHasQuestions || (liveDual && !liveDual.hidden))) {
    cDual.removeAttribute("hidden");
    cDual.hidden = false;
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
  } else if (
    cSingle &&
    liveSingle &&
    (liveSingle.querySelector(".tm-a4-block.question-item") || !liveSingle.hidden)
  ) {
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

  var liveHeaders = livePaper.querySelectorAll(".tm-paper-header");
  clone.querySelectorAll(".tm-paper-header").forEach(function (h, i) {
    var liveH = liveHeaders[i];
    var st = liveH ? window.getComputedStyle(liveH) : window.getComputedStyle(h);
    if (st.display === "none") {
      h.style.display = "none";
      return;
    }
    h.style.display = st.display;
    h.style.visibility = "visible";
    h.style.opacity = "1";
    h.style.width = "100%";
    h.style.boxSizing = "border-box";
  });

  clone.querySelectorAll("img").forEach(function (im) {
    im.style.maxWidth = "100%";
    im.style.height = "auto";
    im.style.display = "block";
  });
}

/**
 * PDF (html2canvas → canvas.toDataURL) harici origin img yüzünden "tainted canvas" ile patlar.
 * Yakalamadan önce http(s) görselleri fetch+CORS ile data URL yaparız; sonra src geri yüklenir.
 */
function tmPdfInlineRemoteImages(paper) {
  if (!paper) return Promise.resolve();
  var imgs = paper.querySelectorAll("img[src]");
  if (!imgs.length) return Promise.resolve();
  return Promise.all(
    Array.prototype.map.call(imgs, function (img) {
      var src = (img.getAttribute("src") || "").trim();
      if (!src || /^data:/i.test(src) || /^blob:/i.test(src)) return Promise.resolve();
      return fetch(src, { mode: "cors", credentials: "omit", cache: "force-cache" })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.blob();
        })
        .then(function (blob) {
          return new Promise(function (resolve) {
            var fr = new FileReader();
            fr.onloadend = function () {
              var du = fr.result;
              if (du && typeof du === "string") {
                img.setAttribute("data-tm-pdf-src-backup", src);
                img.src = du;
                img.removeAttribute("crossorigin");
              }
              resolve();
            };
            fr.onerror = function () {
              resolve();
            };
            fr.readAsDataURL(blob);
          });
        })
        .catch(function () {
          /* CORS / ağ: orijinal src kalır; toDataURL yine hata verebilir */
        });
    })
  );
}

function tmPdfRestorePaperImages(paper) {
  if (!paper || !paper.querySelectorAll) return;
  paper.querySelectorAll("img[data-tm-pdf-src-backup]").forEach(function (img) {
    var b = img.getAttribute("data-tm-pdf-src-backup");
    if (b) img.src = b;
    img.removeAttribute("data-tm-pdf-src-backup");
  });
}

function tmWsDownloadPdf() {
  tmUpdateA4EmptyVisibility();
  var papers = tmGetAllPapers();
  if (!papers.length || tmTotalQuestionBlocks() === 0) {
    showToast("Önce A4'e soru ekleyin.");
    return;
  }
  if (!(window.jspdf && window.jspdf.jsPDF)) {
    showToast("jsPDF yüklenemedi; sayfayı yenileyin.");
    return;
  }
  if (typeof html2canvas === "undefined") {
    showToast("html2canvas yüklenemedi; sayfayı yenileyin.");
    return;
  }

  ["tempPrintArea", "tmPdfBlocker", "tmPdfSinglePageHost"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el && el.parentNode) {
      try {
        el.parentNode.removeChild(el);
      } catch (e) {}
    }
  });

  var J = window.jspdf.jsPDF;
  var fname =
    ((document.getElementById("tmWsTitle") && document.getElementById("tmWsTitle").value) || "Deneme_Sinavi")
    .trim()
      .replace(/[\\/:*?"<>|]/g, "-") || "Deneme_Sinavi";

  function tmWaitImages(root, timeoutMs) {
    var imgs = root.querySelectorAll("img");
    if (!imgs.length) return Promise.resolve();
    var deadline = Date.now() + (timeoutMs || 12000);
    return Promise.all(
      Array.prototype.map.call(imgs, function (img) {
        if (img.complete && img.naturalWidth > 0) return Promise.resolve();
        return new Promise(function (resolve) {
          function done() {
            resolve();
          }
          img.addEventListener("load", done, { once: true });
          img.addEventListener("error", done, { once: true });
          var t = setInterval(function () {
            if (img.complete || Date.now() > deadline) {
              clearInterval(t);
              done();
            }
          }, 80);
        });
      })
    );
  }

  function tmPdfCleanupAll() {
    ["tmPdfBlocker", "tmPdfSinglePageHost", "tempPrintArea"].forEach(function (id) {
      var el = document.getElementById(id);
      if (el && el.parentNode) {
        try {
          el.parentNode.removeChild(el);
        } catch (e) {}
      }
    });
  }

  if (!document.getElementById("tmPdfCaptureUi")) {
    var stCap = document.createElement("style");
    stCap.id = "tmPdfCaptureUi";
    stCap.textContent =
      ".tm-pdf-live-capture .tm-a4-block__x{display:none!important;pointer-events:none!important;}";
    document.head.appendChild(stCap);
  }

  var scrollHost =
    document.querySelector(".tm-a4-preview-scroll.tm-a4-workspace-scroll") ||
    document.querySelector(".tm-a4-preview-scroll--focus") ||
    document.querySelector(".tm-a4-preview-scroll");
  var savedScroll = scrollHost
    ? { el: scrollHost, x: scrollHost.scrollLeft, y: scrollHost.scrollTop }
    : null;

  var blocker = document.createElement("div");
  blocker.id = "tmPdfBlocker";
  blocker.setAttribute("aria-live", "polite");
  blocker.style.cssText =
    "position:fixed;inset:0;background:rgba(15,23,42,0.58);z-index:2147483646;display:flex;align-items:center;justify-content:center;padding:1.5rem;";
  blocker.innerHTML =
    '<p style="margin:0;color:#f8fafc;font:600 15px system-ui,Segoe UI,sans-serif;text-align:center;max-width:22rem;line-height:1.45">PDF oluşturuluyor…<br><span style="font-size:12px;font-weight:500;opacity:0.9">Her sayfa ayrı işlenir; birkaç saniye sürebilir.</span></p>';
  document.body.appendChild(blocker);

  var pdf = null;
  var anyPageOk = false;

  function tmCenterPaperInScrollHost(paper, host) {
    if (!paper || !host || !host.contains(paper)) return;
    try {
      var er = paper.getBoundingClientRect();
      var hr = host.getBoundingClientRect();
      host.scrollLeft += er.left + er.width / 2 - hr.left - hr.width / 2;
      host.scrollTop += er.top + er.height / 2 - hr.top - hr.height / 2;
    } catch (eC) {}
  }

  function capturePageAtIndex(idx) {
    var paper = papers[idx];
    return new Promise(function (resolve) {
      paper.classList.add("tm-pdf-live-capture");
      try {
        paper.scrollIntoView({ block: "center", inline: "nearest", behavior: "auto" });
      } catch (e0) {
        try {
          paper.scrollIntoView(true);
        } catch (e1) {}
      }
      if (scrollHost) tmCenterPaperInScrollHost(paper, scrollHost);
      tmWaitImages(paper, 15000)
        .then(function () {
          return new Promise(function (rafDone) {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                if (scrollHost) tmCenterPaperInScrollHost(paper, scrollHost);
                setTimeout(rafDone, 220);
              });
            });
          });
        })
        .then(function () {
          return tmPdfInlineRemoteImages(paper);
        })
        .then(function () {
          return new Promise(function (afterInline) {
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                setTimeout(afterInline, 80);
              });
            });
          });
        })
        .then(function () {
          /* Harici img → data URL sonrası taint yok; toDataURL güvenli */
          var dpr = window.devicePixelRatio || 1;
          var scaleCap = Math.min(3, Math.max(2, dpr * 1.25));
          return html2canvas(paper, {
            scale: scaleCap,
            useCORS: true,
            allowTaint: true,
            logging: false,
            backgroundColor: "#ffffff",
            scrollX: 0,
            scrollY: 0,
            foreignObjectRendering: false,
          });
        })
        .then(function (canvas) {
          try {
            var imgData = canvas.toDataURL("image/png");
            if (!pdf) {
              pdf = new J({ unit: "mm", format: "a4", orientation: "portrait" });
            } else {
              pdf.addPage();
            }
            pdf.addImage(imgData, "PNG", 0, 0, 210, 297);
            anyPageOk = true;
          } catch (err) {
            console.error("tmWsDownloadPdf toDataURL / addImage", idx + 1, err);
          }
        })
        .catch(function (e) {
          console.error("tmWsDownloadPdf html2canvas", idx + 1, e);
        })
        .then(function () {
          try {
            tmPdfRestorePaperImages(paper);
          } catch (eRestore) {}
          paper.classList.remove("tm-pdf-live-capture");
          resolve();
        });
    });
  }

  function runSequential(i) {
    if (i >= papers.length) return Promise.resolve();
    return capturePageAtIndex(i).then(function () {
      return runSequential(i + 1);
    });
  }

  var fontReady = document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve();
  fontReady
    .then(function () {
      return runSequential(0);
    })
    .then(function () {
      tmPdfCleanupAll();
      if (savedScroll && savedScroll.el) {
        try {
          savedScroll.el.scrollLeft = savedScroll.x;
          savedScroll.el.scrollTop = savedScroll.y;
        } catch (eScroll) {}
      }
      if (pdf && anyPageOk) {
        pdf.save(fname + ".pdf");
        showToast("PDF indirildi.");
      } else {
        showToast(
          "PDF oluşturulamadı. İnternet bağlantınızı kontrol edin; harici görseller yüklenememiş olabilir. Ayrıntı için tarayıcı konsoluna (F12) bakın."
        );
      }
    })
    .catch(function (e) {
      console.error(e);
      tmPdfCleanupAll();
      if (savedScroll && savedScroll.el) {
        try {
          savedScroll.el.scrollLeft = savedScroll.x;
          savedScroll.el.scrollTop = savedScroll.y;
        } catch (eScroll2) {}
      }
      showToast("PDF oluşturulamadı.");
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

  var sn = document.getElementById("tmHdrStudentInput");
  var nn = document.getElementById("tmHdrNetInput");
  var studentVal = (sn && sn.value.trim()) || "—";
  var netVal = (nn && nn.value.trim()) || "—";

  tmGetAllPapers().forEach(function (paper) {
    var defI = inst || "KURUM ADI";
    var defC = course || "DERS ADI";
    var defT = topic || "Konu / ünite";
    paper.querySelectorAll(".tm-h-field--inst").forEach(function (el) {
      el.textContent = inst || defI;
    });
    paper.querySelectorAll(".tm-h-field--date").forEach(function (el) {
      el.textContent = dateStr;
    });
    paper.querySelectorAll(".tm-h-field--course").forEach(function (el) {
      el.textContent = defC;
    });
    paper.querySelectorAll(".tm-h-field--topic").forEach(function (el) {
      el.textContent = defT;
    });
    paper.querySelectorAll(".tm-h-field--student").forEach(function (el) {
      el.textContent = studentVal;
    });
    paper.querySelectorAll(".tm-h-field--net").forEach(function (el) {
      el.textContent = netVal;
    });

    var hOsym = paper.querySelector(".tm-paper-header--osym");
    if (hOsym) {
      var elx = hOsym.querySelector(".tm-h-osym__inst");
      if (elx) elx.textContent = inst || "KURUM ADI";
      elx = hOsym.querySelector(".tm-h-osym__date");
      if (elx) elx.textContent = dateStr;
      elx = hOsym.querySelector(".tm-h-osym__course");
      if (elx) elx.textContent = defC;
      elx = hOsym.querySelector(".tm-h-osym__topic");
      if (elx) elx.textContent = defT;
    }
    var hVip = paper.querySelector(".tm-paper-header--vip");
    if (hVip) {
      var logo = hVip.querySelector(".tm-h-vip__logo span");
      if (logo) logo.textContent = inst || "Kurum Adı";
      var el2 = hVip.querySelector(".tm-h-vip__course");
      if (el2) el2.textContent = course || "Ders";
      el2 = hVip.querySelector(".tm-h-vip__topic");
      if (el2) el2.textContent = topic || "Konu";
      var strs = hVip.querySelectorAll(".tm-h-vip__student strong");
      if (strs.length >= 2) {
        strs[0].textContent = studentVal;
        strs[1].textContent = netVal;
      }
    }
    var hFoy = paper.querySelector(".tm-paper-header--foy");
    if (hFoy) {
      var instWrap = hFoy.querySelector(".tm-h-foy__inst");
      if (instWrap) {
        var isp = instWrap.querySelector("span");
        if (isp) isp.textContent = inst || "Kurum";
        else instWrap.textContent = inst || "Kurum";
      }
      var sub = hFoy.querySelector(".tm-h-foy__sub");
      if (sub) {
        var spans = sub.querySelectorAll("span");
        if (spans.length >= 2) {
          spans[0].textContent = course || "Ders";
          spans[1].textContent = topic || "Konu";
        } else {
          sub.textContent = (course || "Ders") + " — " + (topic || "Konu");
        }
      }
    }
  });

  tmApplyHeaderLogo();
  tmSyncWatermarkLayer();
}

function tmApplyHeaderLogo() {
  var logos = document.querySelectorAll(".tm-header-logo");
  logos.forEach(function (img) {
    if (!tmHeaderLogoDataUrl) {
      img.hidden = true;
      img.removeAttribute("src");
      return;
    }
    img.hidden = false;
    img.src = tmHeaderLogoDataUrl;
  });
  document.querySelectorAll(".tm-header-logo-fallback").forEach(function (el) {
    el.hidden = !!tmHeaderLogoDataUrl;
  });

  tmSyncCorporateCoverContent();
}

function tmApplyWorkspaceTemplate() {
  var paper0 = document.getElementById("tmA4Paper");
  var sel = document.getElementById("tmTemplate");
  if (!paper0) return;
  var prev = tmNormalizeTemplateMode(paper0.getAttribute("data-tm-layout"));
  var mode = tmNormalizeTemplateMode((sel && sel.value) || "osym");
  if (prev !== mode && tmTotalQuestionBlocks() > 0) {
    tmMigrateLayoutForTemplate(prev, mode);
  }
  var tclasses = tmTemplatePaperClasses();
  tmGetAllPapers().forEach(function (paper) {
    paper.setAttribute("data-tm-layout", mode);
    tclasses.forEach(function (c) {
      paper.classList.remove(c);
    });
    paper.classList.add("tm-template-" + mode);
  });
  tmSyncPaperHeaders();
  tmUpdateA4EmptyVisibility();
  tmRenumberTmQuestions();
}

/** PDF Soru Kırpma (Digitizer): PDF.js + sürekli kaydırma + kauçuk bant + localStorage havuzu */
var tmPdfCropperModuleInited = false;
var tmPdfCropDoc = null;
var tmPdfCropPage = 1;
var tmPdfCropLastPreviewDataUrl = "";
var tmPdfCropScrollInner = null;
var tmPdfCropWrapEl = null;
var tmPdfCropSlotCssW = 0;
var tmPdfCropSlotCssH = 0;
var tmPdfCropRenderScale = 1;
var tmPdfCropPageGapPx = 14;
var tmPdfCropScrollRaf = 0;
var tmPdfCropSlotPromises = {};
/** 1 = panel genişliğine sığdır; 1'den büyük = yakınlaştırma (daha çok piksel, daha net kırpma) */
var tmPdfCropZoom = 1;
var tmPdfCropPanMode = false;
var TM_PDF_CROP_ZOOM_MIN = 0.5;
var TM_PDF_CROP_ZOOM_MAX = 2.75;
var TM_PDF_CROP_ZOOM_STEP = 1.12;

function tmPdfCropUpdateZoomUi() {
  var zIn = document.getElementById("tmPdfCropZoomIn");
  var zOut = document.getElementById("tmPdfCropZoomOut");
  var zLab = document.getElementById("tmPdfCropZoomLabel");
  var zReset = document.getElementById("tmPdfCropZoomReset");
  var panT = document.getElementById("tmPdfCropPanToggle");
  var has = !!tmPdfCropDoc;
  var pct = Math.round(tmPdfCropZoom * 100);
  if (zLab) zLab.textContent = "%" + pct;
  if (zIn) zIn.disabled = !has || tmPdfCropZoom >= TM_PDF_CROP_ZOOM_MAX - 0.02;
  if (zOut) zOut.disabled = !has || tmPdfCropZoom <= TM_PDF_CROP_ZOOM_MIN + 0.02;
  if (zReset) zReset.disabled = !has || Math.abs(tmPdfCropZoom - 1) < 0.02;
  if (panT) panT.disabled = !has;
}

function tmPdfCropFillKonuForDers(ders) {
  var sel = document.getElementById("tmCropKonu");
  if (!sel) return;
  var topics = [];
  ["TYT", "AYT"].forEach(function (ex) {
    var bag = yksAiCurriculum[ex];
    if (bag && bag[ders]) {
      bag[ders].forEach(function (t) {
        if (topics.indexOf(t) === -1) topics.push(t);
      });
    }
  });
  if (!topics.length) topics = ["Genel"];
  sel.innerHTML = topics
    .map(function (t) {
      return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + "</option>";
    })
    .join("");
}

function tmPdfCropUpdateNav() {
  var total = tmPdfCropDoc ? tmPdfCropDoc.numPages : 0;
  var prev = document.getElementById("tmPdfCropPrev");
  var next = document.getElementById("tmPdfCropNext");
  var inp = document.getElementById("tmPdfCropPageInput");
  var totalEl = document.getElementById("tmPdfCropPageTotal");
  if (totalEl) totalEl.textContent = total ? "/ " + total : "/ —";
  if (inp && document.activeElement !== inp) {
    inp.value = total ? String(tmPdfCropPage) : "";
  }
  if (prev) prev.disabled = !tmPdfCropDoc || tmPdfCropPage <= 1;
  if (next) next.disabled = !tmPdfCropDoc || !total || tmPdfCropPage >= total;
  tmPdfCropUpdateZoomUi();
}

function tmPdfCropRemoveCropSelectionBox() {
  var old = document.getElementById("crop-selection-box");
  if (old && old.parentNode) old.parentNode.removeChild(old);
}

function tmPdfCropClearPreview() {
  tmPdfCropLastPreviewDataUrl = "";
  var img = document.getElementById("tmCropPreviewImg");
  var empty = document.getElementById("tmCropPreviewEmpty");
  if (img) {
    img.removeAttribute("src");
    img.hidden = true;
  }
  if (empty) empty.hidden = false;
}

function tmPdfCropScheduleSyncVisible() {
  if (tmPdfCropScrollRaf) cancelAnimationFrame(tmPdfCropScrollRaf);
  tmPdfCropScrollRaf = requestAnimationFrame(function () {
    tmPdfCropScrollRaf = 0;
    tmPdfCropSyncVisiblePages();
  });
}

function tmPdfCropUnloadSlotIfFar(slot, wrapRect, buffer) {
  var r = slot.getBoundingClientRect();
  if (r.bottom >= wrapRect.top - buffer && r.top <= wrapRect.bottom + buffer) return;
  if (slot.dataset.rendered !== "1") return;
  var main = slot.querySelector(".tm-pdf-crop-slot-canvas");
  if (main) {
    main.width = 1;
    main.height = 1;
    main.removeAttribute("style");
  }
  slot.dataset.rendered = "0";
  var n = parseInt(slot.getAttribute("data-page"), 10);
  if (!isNaN(n)) delete tmPdfCropSlotPromises[n];
}

function tmPdfCropEnsureSlotRendered(n, slot) {
  if (!tmPdfCropDoc || !slot || slot.dataset.rendered === "1") return;
  if (tmPdfCropSlotPromises[n]) return;
  var main = slot.querySelector(".tm-pdf-crop-slot-canvas");
  if (!main) return;
  tmPdfCropSlotPromises[n] = tmPdfCropDoc
    .getPage(n)
    .then(function (pdfPage) {
      var vp = pdfPage.getViewport({ scale: tmPdfCropRenderScale });
      main.width = vp.width;
      main.height = vp.height;
      main.style.width = tmPdfCropSlotCssW + "px";
      main.style.height = tmPdfCropSlotCssH + "px";
      var ctx = main.getContext("2d");
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      return pdfPage.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        slot.dataset.rendered = "1";
        delete tmPdfCropSlotPromises[n];
      });
    })
    .catch(function (err) {
      console.error(err);
      delete tmPdfCropSlotPromises[n];
    });
}

function tmPdfCropUpdateCurrentPageFromScroll() {
  if (!tmPdfCropWrapEl || !tmPdfCropScrollInner || !tmPdfCropDoc) return;
  var mid = tmPdfCropWrapEl.scrollTop + tmPdfCropWrapEl.clientHeight / 2;
  var slots = tmPdfCropScrollInner.children;
  var best = 1;
  for (var i = 0; i < slots.length; i++) {
    var el = slots[i];
    var top = el.offsetTop;
    var h = el.offsetHeight;
    if (mid >= top && mid < top + h) {
      best = i + 1;
      break;
    }
    if (top <= mid) best = i + 1;
  }
  var t = tmPdfCropDoc.numPages || 1;
  best = Math.max(1, Math.min(t, best));
  if (best !== tmPdfCropPage) {
    tmPdfCropPage = best;
    tmPdfCropUpdateNav();
  }
}

function tmPdfCropSyncVisiblePages() {
  if (!tmPdfCropWrapEl || !tmPdfCropScrollInner || !tmPdfCropDoc) return;
  var rect = tmPdfCropWrapEl.getBoundingClientRect();
  var buffer = 280;
  var unloadBuf = 480;
  var slots = tmPdfCropScrollInner.querySelectorAll(".tm-pdf-cropper-page-slot");
  slots.forEach(function (slot) {
    var r = slot.getBoundingClientRect();
    var n = parseInt(slot.getAttribute("data-page"), 10);
    if (isNaN(n)) return;
    var near = r.bottom >= rect.top - buffer && r.top <= rect.bottom + buffer;
    if (near) tmPdfCropEnsureSlotRendered(n, slot);
    else tmPdfCropUnloadSlotIfFar(slot, rect, unloadBuf);
  });
  tmPdfCropUpdateCurrentPageFromScroll();
}

function tmPdfCropScrollToPage(p) {
  if (!tmPdfCropScrollInner || !tmPdfCropWrapEl || !tmPdfCropDoc) return;
  var t = tmPdfCropDoc.numPages || 1;
  p = Math.max(1, Math.min(t, p));
  var slot = tmPdfCropScrollInner.querySelector('.tm-pdf-cropper-page-slot[data-page="' + p + '"]');
  if (!slot) return;
  tmPdfCropWrapEl.scrollTop = Math.max(0, slot.offsetTop - 10);
  tmPdfCropPage = p;
  tmPdfCropUpdateNav();
  tmPdfCropScheduleSyncVisible();
}

function tmPdfCropBuildContinuousView(doc) {
  var inner = document.getElementById("tmPdfCropScrollInner");
  var wrap = document.getElementById("tmPdfCropCanvasWrap");
  if (!inner || !wrap) return Promise.reject(new Error("PDF kırpıcı DOM eksik"));
  tmPdfCropScrollInner = inner;
  tmPdfCropWrapEl = wrap;
  tmPdfCropSlotPromises = {};
  inner.innerHTML = "";
  return doc.getPage(1).then(function (p1) {
    var base = p1.getViewport({ scale: 1 });
    var maxW = Math.max(260, wrap.clientWidth - 20);
    var fitScale = maxW / base.width;
    var displayScale = fitScale * tmPdfCropZoom;
    var vp = p1.getViewport({ scale: displayScale });
    /* Görüntü ölçeği + yüksek DPI raster: kırpılan PNG’de yeterli piksel (yakınlaştırma da çözünürlüğü artırır). */
    var dpr = Math.min(Math.max(window.devicePixelRatio || 1, 2), 3);
    var minRasterW = 2400;
    var maxRasterW = 6400;
    var rasterScale = Math.max(displayScale * dpr * 1.25, minRasterW / base.width);
    if (base.width * rasterScale > maxRasterW) rasterScale = maxRasterW / base.width;
    tmPdfCropSlotCssW = vp.width;
    tmPdfCropSlotCssH = vp.height;
    tmPdfCropRenderScale = rasterScale;
    var n = doc.numPages || 0;
    var i;
    for (i = 1; i <= n; i++) {
      var slot = document.createElement("div");
      slot.className = "tm-pdf-cropper-page-slot";
      slot.setAttribute("data-page", String(i));
      if (i < n) slot.style.marginBottom = tmPdfCropPageGapPx + "px";
      var badge = document.createElement("div");
      badge.className = "tm-pdf-cropper-page-slot__badge";
      badge.textContent = "Sayfa " + i;
      var holder = document.createElement("div");
      holder.className = "tm-pdf-cropper-slot-inner pdf-canvas-wrapper";
      if (i === 1) holder.id = "pdf-canvas-wrapper";
      holder.style.position = "relative";
      holder.style.display = "inline-block";
      var cMain = document.createElement("canvas");
      cMain.className = "tm-pdf-crop-slot-canvas";
      if (i === 1) cMain.id = "pdf-main-canvas";
      cMain.setAttribute("aria-label", "PDF sayfa " + i);
      holder.appendChild(cMain);
      slot.appendChild(badge);
      slot.appendChild(holder);
      inner.appendChild(slot);
    }
    wrap.scrollTop = 0;
    tmPdfCropPage = 1;
    tmPdfCropUpdateNav();
    tmPdfCropScheduleSyncVisible();
    return Promise.resolve();
  });
}

function tmPdfCropRebuildView(keepPage) {
  if (!tmPdfCropDoc) return Promise.resolve();
  var wrap = document.getElementById("tmPdfCropCanvasWrap");
  var inner = document.getElementById("tmPdfCropScrollInner");
  var anchorPage =
    keepPage != null && !isNaN(Number(keepPage)) && Number(keepPage) > 0
      ? Number(keepPage)
      : tmPdfCropPage;
  var ratioX = 0.5;
  var ratioY = 0.5;
  var slotAnchorRatio = null;
  if (wrap && inner && inner.scrollHeight > 0) {
    var cx = wrap.scrollLeft + wrap.clientWidth * 0.5;
    var cy = wrap.scrollTop + wrap.clientHeight * 0.5;
    ratioX = cx / Math.max(inner.scrollWidth, 1);
    ratioY = cy / Math.max(inner.scrollHeight, 1);
    ratioX = Math.max(0, Math.min(1, ratioX));
    ratioY = Math.max(0, Math.min(1, ratioY));
    var slot = inner.querySelector('.tm-pdf-cropper-page-slot[data-page="' + anchorPage + '"]');
    if (slot) {
      var slotH = slot.offsetHeight || 1;
      slotAnchorRatio = (cy - slot.offsetTop) / slotH;
      slotAnchorRatio = Math.max(0, Math.min(1, slotAnchorRatio));
    }
  }
  tmPdfCropClearPreview();
  tmPdfCropRemoveCropSelectionBox();
  return tmPdfCropBuildContinuousView(tmPdfCropDoc).then(function () {
    function restoreScrollAnchor() {
      var w = document.getElementById("tmPdfCropCanvasWrap");
      var inn = document.getElementById("tmPdfCropScrollInner");
      if (!w || !inn) return;
      var nw = inn.scrollWidth;
      var nh = inn.scrollHeight;
      var slot2 = inn.querySelector('.tm-pdf-cropper-page-slot[data-page="' + anchorPage + '"]');
      if (slot2 && slotAnchorRatio != null) {
        var st = slot2.offsetTop + slotAnchorRatio * (slot2.offsetHeight || 1) - w.clientHeight * 0.5;
        w.scrollTop = Math.max(0, Math.min(Math.max(0, nh - w.clientHeight), st));
        var sl = ratioX * nw - w.clientWidth * 0.5;
        w.scrollLeft = Math.max(0, Math.min(Math.max(0, nw - w.clientWidth), sl));
      } else {
        var sl2 = ratioX * nw - w.clientWidth * 0.5;
        var st2 = ratioY * nh - w.clientHeight * 0.5;
        w.scrollLeft = Math.max(0, Math.min(Math.max(0, nw - w.clientWidth), sl2));
        w.scrollTop = Math.max(0, Math.min(Math.max(0, nh - w.clientHeight), st2));
      }
      tmPdfCropPage = anchorPage;
      tmPdfCropUpdateNav();
      tmPdfCropScheduleSyncVisible();
    }
    requestAnimationFrame(function () {
      requestAnimationFrame(restoreScrollAnchor);
    });
  });
}

function initPdfCropperModule() {
  if (tmPdfCropperModuleInited) return;
  var wrap = document.getElementById("tmPdfCropCanvasWrap");
  var inner = document.getElementById("tmPdfCropScrollInner");
  var inp = document.getElementById("pdf-upload");
  if (!wrap || !inner || !inp) return;
  if (typeof pdfjsLib === "undefined") {
    console.warn("pdfjsLib yüklenmedi; PDF kırpma devre dışı.");
    return;
  }
  tmPdfCropperModuleInited = true;
  tmPdfCropWrapEl = wrap;
  tmPdfCropScrollInner = inner;

  var dragging = false;
  var dragMain = null;
  var dragWrapper = null;
  var dragBox = null;
  var dragOx = 0;
  var dragOy = 0;
  var pdfCropPanning = false;
  var pdfCropPanLastX = 0;
  var pdfCropPanLastY = 0;

  var dersEl = document.getElementById("tmCropDers");
  tmPdfCropFillKonuForDers((dersEl && dersEl.value) || "Matematik");
  if (dersEl)
    dersEl.addEventListener("change", function () {
      tmPdfCropFillKonuForDers(dersEl.value);
    });

  var pageInp = document.getElementById("tmPdfCropPageInput");
  function commitPdfCropPageInput() {
    if (!pageInp || !tmPdfCropDoc) return;
    var raw = (pageInp.value || "").replace(/\D/g, "");
    var v = parseInt(raw, 10);
    var t = tmPdfCropDoc.numPages || 1;
    if (isNaN(v) || v < 1) {
      tmPdfCropUpdateNav();
      return;
    }
    v = Math.min(t, v);
    tmPdfCropClearPreview();
    tmPdfCropScrollToPage(v);
  }
  if (pageInp) {
    pageInp.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        commitPdfCropPageInput();
        pageInp.blur();
      }
    });
    pageInp.addEventListener("blur", function () {
      commitPdfCropPageInput();
    });
  }

  inp.addEventListener("change", function () {
    var f = inp.files && inp.files[0];
    inp.value = "";
    if (!f) return;
    var reader = new FileReader();
    reader.onload = function () {
      var buf = new Uint8Array(reader.result);
      pdfjsLib
        .getDocument({ data: buf })
        .promise.then(function (doc) {
          tmPdfCropDoc = doc;
          tmPdfCropZoom = 1;
          tmPdfCropPanMode = false;
          pdfCropPanning = false;
          var pBtn = document.getElementById("tmPdfCropPanToggle");
          if (pBtn) pBtn.setAttribute("aria-pressed", "false");
          wrap.classList.remove("tm-pdf-cropper--pan-mode", "tm-pdf-cropper--pan-dragging");
          tmPdfCropClearPreview();
          tmPdfCropPage = 1;
          tmPdfCropUpdateNav();
          return tmPdfCropBuildContinuousView(doc);
        })
        .catch(function (err) {
          console.error(err);
          showToast("PDF okunamadı.");
        });
    };
    reader.onerror = function () {
      showToast("Dosya okunamadı.");
    };
    reader.readAsArrayBuffer(f);
  });

  var prev = document.getElementById("tmPdfCropPrev");
  var next = document.getElementById("tmPdfCropNext");
  if (prev)
    prev.addEventListener("click", function () {
      if (!tmPdfCropDoc || tmPdfCropPage <= 1) return;
      tmPdfCropClearPreview();
      tmPdfCropScrollToPage(tmPdfCropPage - 1);
    });
  if (next)
    next.addEventListener("click", function () {
      if (!tmPdfCropDoc) return;
      var t = tmPdfCropDoc.numPages || 1;
      if (tmPdfCropPage >= t) return;
      tmPdfCropClearPreview();
      tmPdfCropScrollToPage(tmPdfCropPage + 1);
    });

  function tmPdfCropApplyZoomStep(dir) {
    if (!tmPdfCropDoc) return;
    var next =
      tmPdfCropZoom * (dir > 0 ? TM_PDF_CROP_ZOOM_STEP : 1 / TM_PDF_CROP_ZOOM_STEP);
    next = Math.max(TM_PDF_CROP_ZOOM_MIN, Math.min(TM_PDF_CROP_ZOOM_MAX, next));
    if (Math.abs(next - tmPdfCropZoom) < 0.001) return;
    tmPdfCropZoom = next;
    tmPdfCropUpdateZoomUi();
    tmPdfCropRebuildView(tmPdfCropPage);
  }

  var zIn = document.getElementById("tmPdfCropZoomIn");
  var zOut = document.getElementById("tmPdfCropZoomOut");
  var zReset = document.getElementById("tmPdfCropZoomReset");
  var panToggle = document.getElementById("tmPdfCropPanToggle");
  if (zIn) zIn.addEventListener("click", function () { tmPdfCropApplyZoomStep(1); });
  if (zOut) zOut.addEventListener("click", function () { tmPdfCropApplyZoomStep(-1); });
  if (zReset)
    zReset.addEventListener("click", function () {
      if (!tmPdfCropDoc || Math.abs(tmPdfCropZoom - 1) < 0.02) return;
      tmPdfCropZoom = 1;
      tmPdfCropUpdateZoomUi();
      tmPdfCropRebuildView(tmPdfCropPage);
    });
  if (panToggle)
    panToggle.addEventListener("click", function () {
      if (!tmPdfCropDoc) return;
      tmPdfCropPanMode = !tmPdfCropPanMode;
      panToggle.setAttribute("aria-pressed", tmPdfCropPanMode ? "true" : "false");
      wrap.classList.toggle("tm-pdf-cropper--pan-mode", tmPdfCropPanMode);
      if (!tmPdfCropPanMode) {
        pdfCropPanning = false;
        wrap.classList.remove("tm-pdf-cropper--pan-dragging");
      }
    });

  wrap.addEventListener(
    "mousedown",
    function (e) {
      if (!tmPdfCropPanMode || !tmPdfCropDoc || e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();
      pdfCropPanning = true;
      wrap.classList.add("tm-pdf-cropper--pan-dragging");
      pdfCropPanLastX = e.clientX;
      pdfCropPanLastY = e.clientY;
    },
    true
  );

  wrap.addEventListener(
    "scroll",
    function () {
      tmPdfCropScheduleSyncVisible();
    },
    { passive: true }
  );

  wrap.addEventListener("mousedown", function (e) {
    if (!tmPdfCropDoc) return;
    if (tmPdfCropPanMode) return;
    var mainCanvas = e.target.closest && e.target.closest(".tm-pdf-crop-slot-canvas");
    if (!mainCanvas) return;
    if (e.button !== 0) return;
    var slot = mainCanvas.closest(".tm-pdf-cropper-page-slot");
    if (!slot) return;
    var holder = mainCanvas.closest(".pdf-canvas-wrapper");
    if (!holder) return;
    var pageNum = parseInt(slot.getAttribute("data-page"), 10);
    if (!isNaN(pageNum)) tmPdfCropPage = pageNum;
    tmPdfCropRemoveCropSelectionBox();
    var wr = holder.getBoundingClientRect();
    var ox = e.clientX - wr.left;
    var oy = e.clientY - wr.top;
    var box = document.createElement("div");
    box.id = "crop-selection-box";
    box.className = "tm-crop-sel-rect";
    box.setAttribute("aria-hidden", "true");
    box.style.left = ox + "px";
    box.style.top = oy + "px";
    box.style.width = "0px";
    box.style.height = "0px";
    holder.appendChild(box);
    dragWrapper = holder;
    dragBox = box;
    dragOx = ox;
    dragOy = oy;
    dragMain = mainCanvas;
    dragging = true;
    tmPdfCropUpdateNav();
    e.preventDefault();
  });

  window.addEventListener("mousemove", function (e) {
    if (pdfCropPanning) {
      var dx = e.clientX - pdfCropPanLastX;
      var dy = e.clientY - pdfCropPanLastY;
      wrap.scrollLeft -= dx;
      wrap.scrollTop -= dy;
      pdfCropPanLastX = e.clientX;
      pdfCropPanLastY = e.clientY;
      return;
    }
    if (!dragging || !dragWrapper || !dragBox || !dragMain) return;
    var wr = dragWrapper.getBoundingClientRect();
    var curX = e.clientX - wr.left;
    var curY = e.clientY - wr.top;
    var left = Math.min(dragOx, curX);
    var top = Math.min(dragOy, curY);
    var ww = Math.abs(curX - dragOx);
    var hh = Math.abs(curY - dragOy);
    left = Math.max(0, Math.min(left, wr.width));
    top = Math.max(0, Math.min(top, wr.height));
    ww = Math.min(ww, wr.width - left);
    hh = Math.min(hh, wr.height - top);
    dragBox.style.left = left + "px";
    dragBox.style.top = top + "px";
    dragBox.style.width = ww + "px";
    dragBox.style.height = hh + "px";
  });

  window.addEventListener("mouseup", function () {
    if (pdfCropPanning) {
      pdfCropPanning = false;
      wrap.classList.remove("tm-pdf-cropper--pan-dragging");
    }
    if (!dragging || !dragMain || !dragWrapper || !dragBox) return;
    var mainCanvas = dragMain;
    var L = parseFloat(dragBox.style.left) || 0;
    var T = parseFloat(dragBox.style.top) || 0;
    var Wb = parseFloat(dragBox.style.width) || 0;
    var Hb = parseFloat(dragBox.style.height) || 0;
    tmPdfCropRemoveCropSelectionBox();
    dragging = false;
    dragMain = null;
    dragWrapper = null;
    dragBox = null;
    if (Wb < 4 || Hb < 4) return;
    var cr = mainCanvas.getBoundingClientRect();
    var wr2 = mainCanvas.closest(".pdf-canvas-wrapper");
    if (!wr2) return;
    var wr = wr2.getBoundingClientRect();
    var cOffL = cr.left - wr.left;
    var cOffT = cr.top - wr.top;
    var dispL = L - cOffL;
    var dispT = T - cOffT;
    var dw = cr.width;
    var dh = cr.height;
    var ix0 = Math.max(0, dispL);
    var iy0 = Math.max(0, dispT);
    var ix1 = Math.min(dw, dispL + Wb);
    var iy1 = Math.min(dh, dispT + Hb);
    var dispWi = ix1 - ix0;
    var dispHi = iy1 - iy0;
    if (dispWi < 4 || dispHi < 4) return;
    var scaleX = mainCanvas.width / Math.max(dw, 1);
    var scaleY = mainCanvas.height / Math.max(dh, 1);
    var x = Math.round(ix0 * scaleX);
    var y = Math.round(iy0 * scaleY);
    var w = Math.round(dispWi * scaleX);
    var h = Math.round(dispHi * scaleY);
    x = Math.max(0, Math.min(x, mainCanvas.width - 1));
    y = Math.max(0, Math.min(y, mainCanvas.height - 1));
    w = Math.min(w, mainCanvas.width - x);
    h = Math.min(h, mainCanvas.height - y);
    var off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    var octx = off.getContext("2d");
    try {
      octx.drawImage(mainCanvas, x, y, w, h, 0, 0, w, h);
      tmPdfCropLastPreviewDataUrl = off.toDataURL("image/png");
    } catch (err) {
      console.error(err);
      showToast("Kırpma başarısız.");
      return;
    }
    var imgPreview = document.getElementById("tmCropPreviewImg");
    var empty = document.getElementById("tmCropPreviewEmpty");
    if (imgPreview) {
      imgPreview.src = tmPdfCropLastPreviewDataUrl;
      imgPreview.hidden = false;
    }
    if (empty) empty.hidden = true;
  });

  var saveBtn = document.getElementById("tmPdfCropSavePool");
  if (saveBtn)
    saveBtn.addEventListener("click", function () {
      if (!tmPdfCropLastPreviewDataUrl || typeof tmPdfCropLastPreviewDataUrl !== "string") {
        showToast("Önce PDF üzerinde bir alan seçin.");
        return;
      }
      var sinavTipi = (document.getElementById("tmCropSinav") || {}).value || "TYT";
      var ders = (document.getElementById("tmCropDers") || {}).value || "";
      var konu = (document.getElementById("tmCropKonu") || {}).value || "";
      var zorluk = (document.getElementById("tmCropZorluk") || {}).value || "";
      var cidCrop = getCoachId();
      if (!cidCrop) {
        showToast("Koç oturumu gerekli.");
        return;
      }
      saveBtn.disabled = true;
      var blob;
      try {
        blob = dataUrlToBlob(tmPdfCropLastPreviewDataUrl);
      } catch (e1) {
        console.error(e1);
        showToast("Görsel işlenemedi.");
        saveBtn.disabled = false;
        return;
      }
      saveSoruHavuzuEntry({
        coachKey: cidCrop,
        imageBlob: blob,
        ders: ders,
        konu: konu,
        zorluk: zorluk,
        sinavTipi: sinavTipi,
        source: "pdf_crop",
      })
        .then(function () {
          showToast("Kırpma soru_havuzu koleksiyonuna kaydedildi.");
        })
        .catch(function (err) {
          console.error(err);
          showToast("Kayıt başarısız (Storage / Firestore kuralları?).");
        })
        .finally(function () {
          saveBtn.disabled = false;
        });
    });

  tmPdfCropUpdateZoomUi();
}

/** PDF kırpıcı yalnızca manuel mod (AI / FastAPI kaldırıldı) */
function tmPdfCropperSetMode() {
  var manual = document.getElementById("tmPdfCropperManualPane");
  var side = document.querySelector(".tm-pdf-cropper-side");
  if (manual) manual.hidden = false;
  if (side) side.hidden = false;
}

function soruArsivDersMatchesSinav(sinavFilter, ders) {
  if (!sinavFilter) return true;
  var bagT = yksAiCurriculum.TYT && yksAiCurriculum.TYT[ders];
  var bagA = yksAiCurriculum.AYT && yksAiCurriculum.AYT[ders];
  if (sinavFilter === "TYT") return !!bagT;
  if (sinavFilter === "AYT") return !!bagA;
  return true;
}

function soruArsivItemMatchesSinav(sinavFilter, item) {
  if (!sinavFilter) return true;
  if (item.sinavTipi === "TYT" || item.sinavTipi === "AYT") return item.sinavTipi === sinavFilter;
  return soruArsivDersMatchesSinav(sinavFilter, item.ders || "");
}

function soruArsivFillKonuOptions() {
  var dersEl = document.getElementById("arsivFilterDers");
  var sinavEl = document.getElementById("arsivFilterSinav");
  var konuEl = document.getElementById("arsivFilterKonu");
  if (!dersEl || !konuEl) return;
  var ders = dersEl.value;
  var sinav = sinavEl && sinavEl.value;
  if (!ders) {
    konuEl.innerHTML = '<option value="">Tümü</option>';
    return;
  }
  var topics = [];
  var exams = sinav ? [sinav] : ["TYT", "AYT"];
  exams.forEach(function (ex) {
    var bag = yksAiCurriculum[ex];
    if (bag && bag[ders]) {
      bag[ders].forEach(function (t) {
        if (topics.indexOf(t) === -1) topics.push(t);
      });
    }
  });
  if (!topics.length) topics = ["Genel"];
  konuEl.innerHTML =
    '<option value="">Tümü</option>' +
    topics
      .map(function (t) {
        return '<option value="' + escapeHtml(t) + '">' + escapeHtml(t) + "</option>";
      })
      .join("");
}

function soruArsivPopulateDers() {
  var sel = document.getElementById("arsivFilterDers");
  var sinavEl = document.getElementById("arsivFilterSinav");
  if (!sel) return;
  var sinav = sinavEl && sinavEl.value;
  var set = {};
  var exams = sinav ? [sinav] : ["TYT", "AYT"];
  exams.forEach(function (ex) {
    var bag = yksAiCurriculum[ex];
    if (!bag) return;
    Object.keys(bag).forEach(function (d) {
      set[d] = true;
    });
  });
  var list = Object.keys(set).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
  var opts = '<option value="">Tümü</option>';
  list.forEach(function (d) {
    opts += '<option value="' + escapeHtml(d) + '">' + escapeHtml(d) + "</option>";
  });
  sel.innerHTML = opts;
}

var soruArsivFirestoreCache = [];

async function soruArsivFetchPoolFresh() {
  var cid = getCoachId();
  if (!cid) {
    soruArsivFirestoreCache = [];
    return soruArsivFirestoreCache;
  }
  try {
    soruArsivFirestoreCache = await fetchSoruHavuzuForCoach(cid);
  } catch (e) {
    console.warn("[soru_havuzu] liste:", e);
    soruArsivFirestoreCache = [];
  }
  return soruArsivFirestoreCache;
}

function soruArsivReadPool() {
  return soruArsivFirestoreCache;
}

function soruArsivReadSepet() {
  try {
    var raw = localStorage.getItem("koc_testmaker_sepet");
    var arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function soruArsivWriteSepet(ids) {
  try {
    localStorage.setItem("koc_testmaker_sepet", JSON.stringify(ids));
  } catch (e) {}
}

function soruArsivToggleCozuldu(qid) {
  soruArsivFetchPoolFresh()
    .then(function () {
      var arr = soruArsivReadPool();
      var cur = null;
      for (var k = 0; k < arr.length; k++) {
        if (String(arr[k].id) === String(qid)) {
          cur = arr[k];
          break;
        }
      }
      if (!cur) {
        showToast("Kayıt bulunamadı.");
        return null;
      }
      return setSoruHavuzuCozuldu(String(qid), !cur.cozuldu).then(function () {
        return true;
      });
    })
    .then(function (ok) {
      if (ok === true) return renderSoruHavuzuArsivi();
    })
    .catch(function (e) {
      console.warn(e);
      showToast("Durum güncellenemedi.");
    });
}

function soruArsivAddToSepet(qid) {
  var ids = soruArsivReadSepet();
  if (ids.some(function (x) { return String(x) === String(qid); })) {
    showToast("Bu soru zaten sepette.");
    return;
  }
  ids.push(qid);
  soruArsivWriteSepet(ids);
  showToast("Soru Test Maker sepetine eklendi (mock).");
}

function soruArsivFilterItems(arr) {
  var sinav = (document.getElementById("arsivFilterSinav") || {}).value || "";
  var ders = (document.getElementById("arsivFilterDers") || {}).value || "";
  var konu = (document.getElementById("arsivFilterKonu") || {}).value || "";
  return arr.filter(function (it) {
    if (!soruArsivItemMatchesSinav(sinav, it)) return false;
    if (ders && (it.ders || "") !== ders) return false;
    if (konu && (it.konu || "") !== konu) return false;
    return true;
  });
}

async function renderSoruHavuzuArsivi() {
  var grid = document.getElementById("havuz-galeri-grid");
  if (!grid) return;
  grid.innerHTML = '<p class="soru-arsivi-empty">Yükleniyor…</p>';
  await soruArsivFetchPoolFresh();
  var all = soruArsivReadPool();
  var items = soruArsivFilterItems(all);
  if (!items.length) {
    grid.innerHTML =
      '<p class="soru-arsivi-empty">Kriterlere uygun soru yok. Filtreleri “Tümü” yapıp tekrar deneyin, <strong>Soru Havuzu Yönetimi</strong> veya PDF kırpıcıdan ekleyin.</p>';
    return;
  }
  grid.innerHTML = items
    .map(function (it) {
      var id = escapeHtml(it.id);
      var src = escapeHtml(it.imageUrl || it.imageBase64 || "");
      var st = it.sinavTipi
        ? '<span class="soru-arsivi-badge">' + escapeHtml(it.sinavTipi) + "</span>"
        : "";
      var cozuldu = !!it.cozuldu;
      var statusClass = cozuldu ? "soru-arsivi-status--cozuldu" : "soru-arsivi-status--bekliyor";
      var statusText = cozuldu ? "Çözüldü" : "Bekliyor";
      return (
        '<article class="soru-arsivi-card" data-havuz-q-id="' +
        id +
        '"><div class="soru-arsivi-card__img-wrap"><img src="' +
        src +
        '" alt="Soru" loading="lazy" /></div><div class="soru-arsivi-card__body"><div class="soru-arsivi-card__badges">' +
        st +
        '<span class="soru-arsivi-badge soru-arsivi-badge--zorluk">' +
        escapeHtml(it.zorluk || "—") +
        '</span></div><div class="soru-arsivi-card__detail"><div class="soru-arsivi-meta-row">' +
        '<span class="soru-arsivi-meta-lbl">Ders</span>' +
        '<span class="soru-arsivi-meta-val">' +
        escapeHtml(it.ders || "—") +
        "</span></div>" +
        '<div class="soru-arsivi-meta-row">' +
        '<span class="soru-arsivi-meta-lbl">Konu</span>' +
        '<span class="soru-arsivi-meta-val">' +
        escapeHtml(it.konu || "—") +
        "</span></div>" +
        '<div class="soru-arsivi-status-row">' +
        '<span class="soru-arsivi-status ' +
        statusClass +
        '">' +
        statusText +
        "</span>" +
        '<button type="button" class="soru-arsivi-btn-cozum" data-havuz-cozum="' +
        id +
        '" title="Çözüm durumunu değiştir"><i class="fa-solid fa-arrows-rotate"></i></button></div></div>' +
        '<div class="soru-arsivi-card__actions">' +
        '<button type="button" class="soru-arsivi-btn-sepet" data-havuz-sepet="' +
        id +
        '"><i class="fa-solid fa-cart-shopping"></i> Sepete Ekle</button>' +
        '<button type="button" class="soru-arsivi-card__del" data-havuz-del="' +
        id +
        '"><i class="fa-solid fa-trash"></i> Sil</button></div></div></article>'
      );
    })
    .join("");
}

var soruArsiviUiBound = false;
var arsivUploadPendingFiles = [];

function arsivFileIsImage(f) {
  var t = (f.type || "").toLowerCase();
  if (t.indexOf("image/") === 0) return true;
  return /\.(png|jpe?g|webp)$/i.test(f.name || "");
}

function arsivFileIsPdf(f) {
  var t = (f.type || "").toLowerCase();
  return t === "application/pdf" || /\.pdf$/i.test(f.name || "");
}

function arsivAddFilesFromList(fileList) {
  var arr = [];
  if (!fileList || !fileList.length) return arr;
  for (var i = 0; i < fileList.length; i++) {
    var f = fileList[i];
    if (arsivFileIsImage(f) || arsivFileIsPdf(f)) arr.push(f);
  }
  return arr;
}

function arsivUploadFillDersKonu() {
  var sinEl = document.getElementById("arsivUploadSinav");
  var dersEl = document.getElementById("arsivUploadDers");
  var konuEl = document.getElementById("arsivUploadKonu");
  if (!sinEl || !dersEl || !konuEl) return;
  var ex = sinEl.value || "TYT";
  var bag = yksAiCurriculum[ex] || {};
  var dersler = Object.keys(bag).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
  dersEl.innerHTML = "";
  dersler.forEach(function (d) {
    var o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    dersEl.appendChild(o);
  });
  function fillKonu() {
    var d = dersEl.value;
    var list = (bag[d] || []).slice();
    konuEl.innerHTML = "";
    if (!list.length) {
      var ox = document.createElement("option");
      ox.value = "Genel";
      ox.textContent = "Genel";
      konuEl.appendChild(ox);
      return;
    }
    list.forEach(function (t) {
      var o = document.createElement("option");
      o.value = t;
      o.textContent = t;
      konuEl.appendChild(o);
    });
  }
  dersEl.onchange = fillKonu;
  fillKonu();
}

function arsivPdfFirstPageToBlob(buf) {
  if (typeof pdfjsLib === "undefined") return Promise.reject(new Error("pdfjs"));
  return pdfjsLib
    .getDocument({ data: buf })
    .promise.then(function (doc) {
      return doc.getPage(1);
    })
    .then(function (page) {
      var vp = page.getViewport({ scale: 2 });
      var canvas = document.createElement("canvas");
      canvas.width = Math.floor(vp.width);
      canvas.height = Math.floor(vp.height);
      var ctx = canvas.getContext("2d");
      return page.render({ canvasContext: ctx, viewport: vp }).promise.then(function () {
        return new Promise(function (resolve, reject) {
          canvas.toBlob(
            function (b) {
              if (b) resolve(b);
              else reject(new Error("toBlob"));
            },
            "image/png",
            0.92
          );
        });
      });
    });
}

function initArsivManualUploadUi() {
  var form = document.getElementById("soruArsiviUploadForm");
  if (!form || form.dataset.arsivBind === "1") return;
  var pick = document.getElementById("btnArsivUploadPick");
  var finp = document.getElementById("arsivUploadFile");
  var save = document.getElementById("btnArsivUploadSave");
  var fnEl = document.getElementById("arsivUploadFileName");
  var sinEl = document.getElementById("arsivUploadSinav");
  var drop = document.getElementById("arsivUploadDropzone");
  if (!pick || !finp || !save) return;
  form.dataset.arsivBind = "1";
  try {
    finp.setAttribute("multiple", "multiple");
  } catch (e) {}

  function updatePending(filesArr) {
    arsivUploadPendingFiles = filesArr && filesArr.length ? filesArr.slice() : [];
    if (fnEl) {
      if (!arsivUploadPendingFiles.length) fnEl.textContent = "";
      else if (arsivUploadPendingFiles.length === 1) fnEl.textContent = arsivUploadPendingFiles[0].name;
      else fnEl.textContent = arsivUploadPendingFiles.length + " dosya seçildi";
    }
    save.disabled = arsivUploadPendingFiles.length === 0;
  }

  function onFilesChosen(fileList) {
    var added = arsivAddFilesFromList(fileList);
    if (!added.length) {
      showToast("PNG, JPG, WebP veya PDF dosyası seçin.");
      return;
    }
    updatePending(added);
  }

  arsivUploadFillDersKonu();
  if (sinEl) sinEl.addEventListener("change", arsivUploadFillDersKonu);
  pick.addEventListener("click", function () {
    finp.click();
  });
  finp.addEventListener("change", function () {
    if (finp.files && finp.files.length) onFilesChosen(finp.files);
    else updatePending([]);
  });

  if (drop) {
    drop.addEventListener("click", function (e) {
      if (e.target === drop || drop.contains(e.target)) finp.click();
    });
    drop.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        finp.click();
      }
    });
    drop.addEventListener("dragover", function (e) {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.add("soru-arsivi-dropzone--active");
    });
    drop.addEventListener("dragleave", function (e) {
      e.preventDefault();
      if (e.target === drop) drop.classList.remove("soru-arsivi-dropzone--active");
    });
    drop.addEventListener("drop", function (e) {
      e.preventDefault();
      e.stopPropagation();
      drop.classList.remove("soru-arsivi-dropzone--active");
      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length)
        onFilesChosen(e.dataTransfer.files);
    });
  }

  save.addEventListener("click", function () {
    if (!arsivUploadPendingFiles.length) return;
    var cid = getCoachIdResolved();
    if (!cid) {
      showToast("Koç kullanıcı adı bulunamadı (localStorage). Çıkış yapıp tekrar giriş deneyin.");
      return;
    }

    function startUploadPipeline() {
      if (!auth.currentUser || !auth.currentUser.uid) {
        showToast("Firebase oturumu yok — birkaç saniye sonra tekrar deneyin veya sayfayı yenileyin.");
        save.disabled = false;
        return;
      }
      save.disabled = true;
      var base = {
        coachKey: cid,
        ders: (document.getElementById("arsivUploadDers") || {}).value || "",
        konu: (document.getElementById("arsivUploadKonu") || {}).value || "",
        zorluk: (document.getElementById("arsivUploadZorluk") || {}).value || "",
        sinavTipi: (document.getElementById("arsivUploadSinav") || {}).value || "",
        source: "manual",
      };
      var files = arsivUploadPendingFiles.slice();
      var idx = 0;
      var ok = 0;

      function runNext() {
        if (idx >= files.length) {
          showToast(ok + " soru havuza kaydedildi.");
          finp.value = "";
          updatePending([]);
          save.disabled = true;
          renderSoruHavuzuArsivi().catch(function () {});
          return;
        }
        var f = files[idx];
        idx++;
        var job;
        if (arsivFileIsImage(f)) {
          job = saveSoruHavuzuEntry(Object.assign({}, base, { imageBlob: f }));
        } else if (arsivFileIsPdf(f)) {
          job = new Promise(function (resolve, reject) {
            var r = new FileReader();
            r.onload = function () {
              arsivPdfFirstPageToBlob(new Uint8Array(r.result))
                .then(function (blob) {
                  return saveSoruHavuzuEntry(Object.assign({}, base, { imageBlob: blob, source: "manual_pdf_page1" }));
                })
                .then(resolve)
                .catch(reject);
            };
            r.onerror = function () {
              reject(new Error("Dosya okunamadı"));
            };
            r.readAsArrayBuffer(f);
          });
        } else {
          runNext();
          return;
        }
        Promise.resolve(job)
          .then(function () {
            ok++;
            runNext();
          })
          .catch(function (e) {
            console.error("[soru_havuzu]", e);
            var msg =
              e && (e.code || e.message)
                ? String(e.code ? e.code + ": " + (e.message || "") : e.message)
                : "bilinmeyen hata";
            showToast("Kayıt başarısız: " + msg);
            save.disabled = false;
          });
      }
      runNext();
    }

    if (auth.currentUser && auth.currentUser.uid) {
      startUploadPipeline();
      return;
    }
    showToast("Oturum hazırlanıyor…");
    var unsub = onAuthStateChanged(auth, function (u) {
      try {
        unsub();
      } catch (e) {}
      if (u && u.uid) startUploadPipeline();
      else {
        showToast("Giriş oturumu yok. Sayfayı yenileyin.");
        save.disabled = false;
      }
    });
  });
}

function initSoruArsiviModule() {
  initArsivManualUploadUi();
  if (soruArsiviUiBound) return;
  soruArsiviUiBound = true;
  soruArsivPopulateDers();
  soruArsivFillKonuOptions();
  var sinavEl = document.getElementById("arsivFilterSinav");
  var dersEl = document.getElementById("arsivFilterDers");
  var btn = document.getElementById("btnSoruArsiviAra");
  if (sinavEl)
    sinavEl.addEventListener("change", function () {
      soruArsivPopulateDers();
      soruArsivFillKonuOptions();
    });
  if (dersEl)
    dersEl.addEventListener("change", function () {
      soruArsivFillKonuOptions();
    });
  if (btn) btn.addEventListener("click", renderSoruHavuzuArsivi);
  var grid = document.getElementById("havuz-galeri-grid");
  if (grid)
    grid.addEventListener("click", function (ev) {
      var t = ev.target;
      var del = t.closest && t.closest("[data-havuz-del]");
      if (del) {
        var qidDel = del.getAttribute("data-havuz-del");
        if (!qidDel || !confirm("Bu soruyu arşivden silmek istiyor musunuz?")) return;
        deleteSoruHavuzuDoc(qidDel)
          .then(function () {
            var sepet = soruArsivReadSepet().filter(function (id) {
              return String(id) !== String(qidDel);
            });
            soruArsivWriteSepet(sepet);
            showToast("Soru silindi.");
            return renderSoruHavuzuArsivi();
          })
          .catch(function (e) {
            console.warn(e);
            showToast("Silinemedi (Firestore kuralları?).");
          });
        return;
      }
      var coz = t.closest && t.closest("[data-havuz-cozum]");
      if (coz) {
        var qidC = coz.getAttribute("data-havuz-cozum");
        if (qidC) soruArsivToggleCozuldu(qidC);
        return;
      }
      var sep = t.closest && t.closest("[data-havuz-sepet]");
      if (sep) {
        var qidS = sep.getAttribute("data-havuz-sepet");
        if (qidS) soruArsivAddToSepet(qidS);
      }
    });
  if (grid && !grid.querySelector(".soru-arsivi-card")) {
    grid.innerHTML =
      '<p class="soru-arsivi-empty">Filtreleri seçip <strong>Soru Ara</strong> ile Firestore <code>soru_havuzu</code> kayıtlarını listeleyin.</p>';
  }
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
  tmEditorBindCanvas();
  document.querySelectorAll("[data-tm-tool]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      tmEditorTool = btn.getAttribute("data-tm-tool") || "draw";
      document.querySelectorAll("[data-tm-tool]").forEach(function (b2) {
        b2.classList.toggle("is-active", b2 === btn);
      });
    });
  });
  document.querySelectorAll("[data-tm-annot]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll("[data-tm-annot]").forEach(function (b2) {
        b2.classList.toggle("is-active", b2 === btn);
      });
      tmAnnotToolSync();
    });
  });
  var annotClose = document.getElementById("tmAnnotClose");
  if (annotClose)
    annotClose.addEventListener("click", function () {
      tmAnnotatorClose();
    });
  var saveLib = document.getElementById("tmBtnSaveToLibrary");
  if (saveLib) saveLib.addEventListener("click", tmSaveLayoutToLocalLibrary);
  var railT = document.getElementById("tmRailBtnTemplate");
  var railC = document.getElementById("tmRailBtnColor");
  var railL = document.getElementById("tmRailBtnLayout");
  var ft = document.getElementById("tmFlyoutTemplate");
  var fc = document.getElementById("tmFlyoutColor");
  var fl = document.getElementById("tmFlyoutLayout");
  if (railT && ft) {
    railT.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = ft.hidden;
      tmCloseAllTmFlyouts();
      ft.hidden = !open;
      if (!ft.hidden) {
        railT.classList.add("is-active");
        railT.setAttribute("aria-pressed", "true");
      }
    });
  }
  if (railC && fc) {
    railC.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = fc.hidden;
      tmCloseAllTmFlyouts();
      fc.hidden = !open;
      if (!fc.hidden) {
        railC.classList.add("is-active");
        railC.setAttribute("aria-pressed", "true");
      }
    });
  }
  if (railL && fl) {
    railL.addEventListener("click", function (e) {
      e.stopPropagation();
      var open = fl.hidden;
      tmCloseAllTmFlyouts();
      fl.hidden = !open;
      if (!fl.hidden) {
        railL.classList.add("is-active");
        railL.setAttribute("aria-pressed", "true");
      }
    });
  }
  document.querySelectorAll("[data-tm-q-layout]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var v = parseInt(btn.getAttribute("data-tm-q-layout"), 10);
      tmSetPageLayout(v);
    });
  });
  document.querySelectorAll("[data-tm-flyout-close]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      tmCloseAllTmFlyouts();
    });
  });
  document.addEventListener("click", function (ev) {
    var t = ev.target;
    if (!t || !t.closest) return;
    if (t.closest(".tm-flyout") || t.closest(".tm-rail") || t.closest(".tm-format-ribbon") || t.closest(".tm-ribbon-tile")) return;
    if (document.querySelector(".tm-flyout:not([hidden])")) tmCloseAllTmFlyouts();
  });
  var railLogo = document.getElementById("tmRailBtnLogo");
  var railTxt = document.getElementById("tmRailBtnText");
  var railOpt = document.getElementById("tmRailBtnOptik");
  var logoInpEarly = document.getElementById("tmLogoInput");
  if (railLogo && logoInpEarly) {
    railLogo.addEventListener("click", function () {
      logoInpEarly.click();
    });
  }
  if (railTxt) railTxt.addEventListener("click", tmAddFreeTextBoxToA4);
  if (railOpt) railOpt.addEventListener("click", tmDownloadOptikTemplatePdf);
  var undoBtn = document.getElementById("tmAnnotUndo");
  if (undoBtn) undoBtn.addEventListener("click", tmEditorUndoLast);
  var undoTool = document.getElementById("tmAnnotUndoTool");
  if (undoTool) undoTool.addEventListener("click", tmEditorUndoLast);
  var redoBtn = document.getElementById("tmAnnotRedo");
  if (redoBtn) redoBtn.addEventListener("click", tmEditorRedoLast);
  var redoTool = document.getElementById("tmAnnotRedoTool");
  if (redoTool) redoTool.addEventListener("click", tmEditorRedoLast);
  var zIn = document.getElementById("tmAnnotZoomIn");
  var zOut = document.getElementById("tmAnnotZoomOut");
  if (zIn)
    zIn.addEventListener("click", function () {
      tmEditorPdfScale = Math.min(2.35, Math.round((tmEditorPdfScale + 0.12) * 100) / 100);
      tmEditorRenderCurrentPage();
    });
  if (zOut)
    zOut.addEventListener("click", function () {
      tmEditorPdfScale = Math.max(0.82, Math.round((tmEditorPdfScale - 0.12) * 100) / 100);
      tmEditorRenderCurrentPage();
    });
  var thumbHost = document.getElementById("tmEditorThumbs");
  if (thumbHost)
    thumbHost.addEventListener("click", function (ev) {
      var row = ev.target.closest && ev.target.closest(".tm-editor-thumb");
      if (row && row.hasAttribute("data-idx")) {
        tmEditorCurrentIdx = Math.max(0, Math.min(tmEditorPageOrder.length - 1, parseInt(row.getAttribute("data-idx"), 10) || 0));
        tmEditorClearRedo();
        tmEditorRenderThumbs();
        tmEditorRenderCurrentPage();
      }
      var up = ev.target.closest && ev.target.closest("[data-tm-thumb-up]");
      var down = ev.target.closest && ev.target.closest("[data-tm-thumb-down]");
      var del = ev.target.closest && ev.target.closest("[data-tm-thumb-del]");
      if (up) {
        var ui = parseInt(up.getAttribute("data-tm-thumb-up"), 10);
        if (ui > 0) {
          var t = tmEditorPageOrder[ui - 1];
          tmEditorPageOrder[ui - 1] = tmEditorPageOrder[ui];
          tmEditorPageOrder[ui] = t;
          tmEditorCurrentIdx = ui - 1;
          tmEditorClearRedo();
          tmEditorRenderThumbs();
          tmEditorRenderCurrentPage();
        }
      } else if (down) {
        var di = parseInt(down.getAttribute("data-tm-thumb-down"), 10);
        if (di >= 0 && di < tmEditorPageOrder.length - 1) {
          var t2 = tmEditorPageOrder[di + 1];
          tmEditorPageOrder[di + 1] = tmEditorPageOrder[di];
          tmEditorPageOrder[di] = t2;
          tmEditorCurrentIdx = di + 1;
          tmEditorClearRedo();
          tmEditorRenderThumbs();
          tmEditorRenderCurrentPage();
        }
      } else if (del) {
        var ri = parseInt(del.getAttribute("data-tm-thumb-del"), 10);
        if (tmEditorPageOrder.length <= 1) {
          showToast("Son sayfa silinemez.");
          return;
        }
        if (ri >= 0 && ri < tmEditorPageOrder.length) {
          tmEditorPageOrder.splice(ri, 1);
          if (tmEditorCurrentIdx >= tmEditorPageOrder.length) tmEditorCurrentIdx = tmEditorPageOrder.length - 1;
          tmEditorClearRedo();
          tmEditorRenderThumbs();
          tmEditorRenderCurrentPage();
        }
      }
    });
  var clrBtn = document.getElementById("tmEditorClearCurrent");
  if (clrBtn)
    clrBtn.addEventListener("click", function () {
      if (!tmWsPdfDoc) return;
      var pageNo = tmEditorGetCurrentPageNo();
      tmEditorAnnotations[pageNo] = { actions: [] };
      tmEditorClearRedo();
      tmEditorDrawOverlay();
    });
  var expBtn = document.getElementById("tmEditorExportPdf");
  if (expBtn) expBtn.addEventListener("click", tmEditorExportPdf);

  var akRow = document.getElementById("tmWsAnswerKeyRow");
  if (akRow) {
    akRow.addEventListener("click", function (ev) {
      var btn = ev.target.closest && ev.target.closest("[data-tm-letter]");
      if (!btn) return;
      if (!tmWsLastCropDataUrl || typeof tmWsLastCropDataUrl !== "string") {
        showToast("Önce PDF veya görsel üzerinde köşeden sürükleyerek alan seçin.");
        return;
      }
      var letter = String(btn.getAttribute("data-tm-letter") || "").toUpperCase();
      if (!/^[A-E]$/.test(letter)) return;
      tmAddQuestionToA4(tmWsLastCropDataUrl, letter);
      tmWsLastCropDataUrl = "";
      tmWsManualCropRemoveSelection();
      tmWsUpdateAnswerKeyUiVisibility();
      showToast("Soru eklendi — " + letter);
    });
  }
  var addA4 = document.getElementById("tmBtnAddToA4");
  if (addA4)
    addA4.addEventListener("click", function () {
      showToast("Doğru şıkkı (A–E) seçerek soruyu ekleyin.");
    });

  var pagesHost = document.getElementById("a4-pages-container");
  if (pagesHost)
    pagesHost.addEventListener("click", function (ev) {
      var x = ev.target.closest && ev.target.closest(".tm-a4-block__x");
      if (!x) return;
      ev.preventDefault();
      var bl = x.closest(".tm-a4-block");
      if (bl) bl.remove();
      tmUpdateA4EmptyVisibility();
      tmRenumberTmQuestions();
    });

  if (pagesHost) {
    pagesHost.addEventListener("dragstart", function (e) {
      var t = e.target.closest && e.target.closest(".tm-a4-block.question-item");
      if (!t || !pagesHost.contains(t)) return;
      tmWsDragBlock = t;
      t.classList.add("tm-dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "tm");
    });
    pagesHost.addEventListener("dragend", function () {
      if (tmWsDragBlock) {
        tmWsDragBlock.classList.remove("tm-dragging");
        tmWsDragBlock = null;
      }
      pagesHost.querySelectorAll(".tm-drag-over").forEach(function (n) {
        n.classList.remove("tm-drag-over");
      });
      tmRenumberTmQuestions();
    });
    pagesHost.addEventListener("dragover", function (e) {
      if (!tmWsDragBlock || !pagesHost.contains(tmWsDragBlock)) return;
      var col =
        e.target.closest &&
        e.target.closest(
          '[data-tm-col="1"], [data-tm-col="2"], #column-1, #column-2, #tmA4Single'
        );
      if (!col || !pagesHost.contains(col)) return;
      var dropPaper = col.closest(".a4-paper");
      if (
        dropPaper &&
        (tmIsAnswerKeyPaper(dropPaper) ||
          tmIsCorporateCoverPaper(dropPaper) ||
          tmIsOptikHostPaper(dropPaper) ||
          tmIsBookCoverPaper(dropPaper))
      )
        return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      var blocks = Array.prototype.slice.call(col.querySelectorAll(".tm-a4-block.question-item"));
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
      var ed = ev.target.closest && ev.target.closest("[data-lib-edit]");
      if (ed) {
        ev.preventDefault();
        ev.stopPropagation();
        tmOpenPdfEditorFromLib(ed.getAttribute("data-lib-edit"));
        return;
      }
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
  function onSavedPdfLibraryClick(ev) {
    var del = ev.target.closest && ev.target.closest("[data-lib-del]");
    if (del) {
      var did = del.getAttribute("data-lib-del");
      if (!did || !confirm("Bu PDF kitaplıktan silinsin mi?")) return;
      tmLibDelete(did).then(function () {
        if (tmActiveLibId === did) tmActiveLibId = null;
        tmLibraryRenderList();
      });
      return;
    }
    var editBtn = ev.target.closest && ev.target.closest("[data-lib-edit]");
    if (editBtn) {
      tmOpenPdfEditorFromLib(editBtn.getAttribute("data-lib-edit"));
    }
  }
  document.querySelectorAll(".tm-saved-pdf-library").forEach(function (ul) {
    ul.addEventListener("click", onSavedPdfLibraryClick);
  });

  var pdfEdBtn = document.getElementById("tmPdfEditorLibUploadBtn");
  var pdfEdInp = document.getElementById("tmPdfEditorLibFileInput");
  if (pdfEdBtn && pdfEdInp) {
    pdfEdBtn.addEventListener("click", function () {
      pdfEdInp.click();
    });
    pdfEdInp.addEventListener("change", function () {
      var f = pdfEdInp.files && pdfEdInp.files[0];
      pdfEdInp.value = "";
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
            showToast("PDF eklendi.");
            tmLibraryRenderList();
          })
          .catch(function (err) {
            console.error(err);
            showToast("Kaydedilemedi (IndexedDB).");
          });
      });
    });
  }

  var sav = document.getElementById("tmBtnSaveFirestore");
  if (sav) sav.addEventListener("click", tmWsSaveFirestoreDraft);
  var pdf = document.getElementById("tmBtnPdfDownload");
  if (pdf) pdf.addEventListener("click", tmWsDownloadPdf);
  var refreshWs = document.getElementById("tmBtnWorkspaceRefresh");
  if (refreshWs) refreshWs.addEventListener("click", tmOnWorkspaceRefreshClick);

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
  var logoInp = document.getElementById("tmLogoInput");
  if (logoInp) {
    logoInp.addEventListener("change", async function () {
      var f = logoInp.files && logoInp.files[0];
      logoInp.value = "";
      if (!f) return;
      if (!/^image\//i.test(f.type || "")) {
        showToast("Logo için PNG/JPG görsel seçin.");
        return;
      }
      try {
        tmHeaderLogoDataUrl = await fileToResizedDataUrl(f, 220, 0.9);
        tmApplyHeaderLogo();
        tmSyncWatermarkLayer();
        showToast("Kurum logosu güncellendi.");
      } catch (e) {
        console.error(e);
        showToast("Logo yüklenemedi.");
      }
    });
  }
  tmApplyWorkspaceTemplate();
  tmApplyHeaderLogo();
  tmSyncWatermarkLayer();
  initTmColorStudio();
  tmWsManualCropBindOnce();
  initPdfCropperModule();
}

function navigateTo(view) {
  if (!view) return;
  var hasMainView = false;
  document.querySelectorAll(".main-view").forEach(function (el) {
    if (el.getAttribute("data-view") === view) hasMainView = true;
  });
  if (!hasMainView) {
    console.warn("[YKSPanel] Geçersiz görünüm (main-view bulunamadı):", view);
    return;
  }
  var previous = currentView;
  if (tmAiGenNavigateTimer != null && previous === "auto-test" && view !== "auto-test") {
    clearTimeout(tmAiGenNavigateTimer);
    tmAiGenNavigateTimer = null;
    tmSetAiGenOverlayOpen(false);
    var btnCancelAi = document.getElementById("btnAiGenerateTest");
    if (btnCancelAi) btnCancelAi.disabled = false;
  }
  var wasTm =
    previous === "testmaker" ||
    previous === "library" ||
    previous === "pdf-editor" ||
    previous === "auto-test" ||
    previous === "pdf-cropper" ||
    previous === "soru-arsivi";
  var nowTm =
    view === "testmaker" ||
    view === "library" ||
    view === "pdf-editor" ||
    view === "auto-test" ||
    view === "pdf-cropper" ||
    view === "soru-arsivi";
  if (wasTm && !nowTm) testmakerWorkspaceLeave();
  try {
  document.querySelectorAll(".main-view").forEach(function (el) {
    const v = el.getAttribute("data-view");
    const on = v === view;
    el.classList.toggle("is-active", on);
    el.hidden = !on;
  });
  currentView = view;
  document.querySelectorAll("button.sidebar__link[data-nav]").forEach(function (btn) {
    var nv = btn.getAttribute("data-nav");
    var on =
      nv === view ||
      (nv === "ogrenciler" && view === "ogrenci-detay") ||
      (nv === "testmaker" &&
        (view === "testmaker" ||
          view === "library" ||
          view === "pdf-editor" ||
          view === "auto-test" ||
          view === "pdf-cropper" ||
          view === "soru-arsivi"));
    btn.classList.toggle("sidebar__link--active", on);
  });
  document.querySelectorAll("button.sidebar__sublink[data-nav]").forEach(function (btn) {
    var snv = btn.getAttribute("data-nav");
    btn.classList.toggle("is-active", snv === view);
  });
  var daLi = document.querySelector(".sidebar__item--deneme");
  var daAcc = document.getElementById("sidebarDaToggle");
  if (daLi && daAcc) {
    var inDa =
      view === "denemeler" || view === "optik-okuyucu" || view === "karne" || view === "konu-mr";
    daLi.classList.toggle("sidebar__item--da-open", inDa);
    daAcc.classList.toggle("sidebar__link--active", inDa);
    daAcc.setAttribute("aria-expanded", inDa ? "true" : "false");
  }
  var ogrLi = document.querySelector(".sidebar__item--ogrenci");
  var ogrAcc = document.getElementById("sidebarOgrToggle");
  if (ogrLi && ogrAcc) {
    var inOgr =
      view === "ogrenciler" || view === "ogrenci-detay" || view === "kaynak-kitap" || view === "kutuphanem";
    ogrLi.classList.toggle("sidebar__item--ogr-open", inOgr);
    ogrAcc.classList.toggle("sidebar__link--active", inOgr);
    ogrAcc.setAttribute("aria-expanded", inOgr ? "true" : "false");
  }
  var rvLi = document.querySelector(".sidebar__item--randevu");
  var rvAcc = document.getElementById("sidebarRvToggle");
  if (rvLi && rvAcc) {
    var inRv = view === "randevu" || view === "kocluk-gorusmeleri";
    rvLi.classList.toggle("sidebar__item--rv-open", inRv);
    rvAcc.classList.toggle("sidebar__link--active", inRv);
    rvAcc.setAttribute("aria-expanded", inRv ? "true" : "false");
  }
  var tmLiNav = document.querySelector(".sidebar__item--testmaker");
  var tmAccNav = document.getElementById("sidebarTmToggle");
  if (tmLiNav && tmAccNav) {
    var inTmNav =
      view === "testmaker" ||
      view === "library" ||
      view === "pdf-editor" ||
      view === "auto-test" ||
      view === "pdf-cropper" ||
      view === "soru-arsivi";
    tmLiNav.classList.toggle("sidebar__item--tm-open", inTmNav);
    tmAccNav.setAttribute("aria-expanded", inTmNav ? "true" : "false");
    tmAccNav.classList.toggle("sidebar__link--active", inTmNav);
  }
  document.querySelectorAll("[data-tm-nav-action]").forEach(function (btn) {
    var a = btn.getAttribute("data-tm-nav-action");
    btn.classList.toggle(
      "is-active",
      (a === "library" && view === "library") ||
        (a === "creator" && view === "testmaker") ||
        (a === "pdf-editor" && view === "pdf-editor") ||
        (a === "auto-test" && view === "auto-test") ||
        (a === "pdf-cropper" && view === "pdf-cropper") ||
        (a === "soru-arsivi" && view === "soru-arsivi")
    );
  });
  tmSyncRibbonActive(view);
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
  if (view === "denemeler") {
    renderExamsFullPage();
    initDenemeAnalizPage();
    bindDenemeAnalizForm();
  }
  if (view === "optik-okuyucu" || view === "karne") {
    initOptikKarneTools();
  }
  if (view === "optik-okuyucu") {
    var od = document.getElementById("optikImportExamDate");
    if (od && !od.value) od.value = new Date().toISOString().slice(0, 10);
  }
  if (view === "karne") {
    refreshKarneKpis();
    renderKarneReport();
  }
  if (view === "ogrenciler") renderStudentsPage();
  if (view === "ogrenci-detay") {
    renderStudentDetailPage();
  }
  if (view === "gorev-takibi") initGorevTakibiPage();
  if (view === "haftalik-program") initHaftalikProgramDnD();
  if (view === "randevu") renderAppointmentsPage();
  if (
    view === "testmaker" ||
    view === "library" ||
    view === "pdf-editor" ||
    view === "auto-test" ||
    view === "pdf-cropper" ||
    view === "soru-arsivi"
  ) {
    testmakerWorkspaceEnter();
    renderTestsTable();
    tmLibraryRenderList();
  }
  if (view === "pdf-cropper") initPdfCropperModule();
  if (view === "soru-arsivi") {
    initSoruArsiviModule();
    renderSoruHavuzuArsivi();
  }
  var cre = document.getElementById("tmViewCreator");
  if (cre) cre.hidden = view !== "testmaker";
  if (view === "muhasebe") refreshMuhasebeDashboard();
  if (view === "kaynak-kitap") refreshKaynakKitapView();
  if (view === "kutuphanem") {
    bindKutuphanemFormOnce();
    refreshKutuphanemList();
  }
  if (view === "hedef-simulator") initDpHedefSimulator();
  if (view === "gelen-sorular") {
    bindDpInboxDelegationOnce();
    renderDpGelenSorular();
  }
  window.dispatchEvent(new CustomEvent("yks:navigate", { detail: { view: view } }));
  } catch (err) {
    console.error("[YKSPanel] navigateTo:", err);
    try {
      currentView = previous;
      document.querySelectorAll(".main-view").forEach(function (el) {
        var v = el.getAttribute("data-view");
        var on = v === previous;
        el.classList.toggle("is-active", on);
        el.hidden = !on;
      });
    } catch (e2) {
      console.error(e2);
    }
  }
}

/** TestMaker alt menüsü: görünüm kimliği → navigateTo (sidebar SPA) */
function displayTestmakerView(viewDomId) {
  if (!viewDomId) return;
  if (viewDomId === "view-ai-parser") {
    navigateTo("pdf-cropper");
    return;
  }
  var map = {
    "view-testmaker": "testmaker",
    "view-auto-test": "auto-test",
    "view-library": "library",
    "view-pdf-editor": "pdf-editor",
    "view-pdf-cropper": "pdf-cropper",
    "view-soru-arsivi": "soru-arsivi",
  };
  var route = map[viewDomId];
  if (route) {
    navigateTo(route);
    return;
  }
  console.warn("[YKSPanel] displayTestmakerView: eşleşmeyen DOM id:", viewDomId);
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

/** Yan menü: aynı anda yalnızca bir alt menü (tıklanınca diğerlerini kapat) */
function closeSidebarAccordionsExcept(exceptLi) {
  var pairs = [
    [".sidebar__item--testmaker", "sidebar__item--tm-open", "sidebarTmToggle"],
    [".sidebar__item--deneme", "sidebar__item--da-open", "sidebarDaToggle"],
    [".sidebar__item--ogrenci", "sidebar__item--ogr-open", "sidebarOgrToggle"],
    [".sidebar__item--randevu", "sidebar__item--rv-open", "sidebarRvToggle"]
  ];
  pairs.forEach(function (row) {
    var li = document.querySelector(row[0]);
    if (!li || li === exceptLi) return;
    li.classList.remove(row[1]);
    var btn = document.getElementById(row[2]);
    if (btn) btn.setAttribute("aria-expanded", "false");
  });
}

function initNavigation() {
  document.body.addEventListener("click", function (ev) {
    var rib = ev.target.closest && ev.target.closest("[data-tm-ribbon-nav]");
    if (!rib) return;
    ev.preventDefault();
    var m = rib.getAttribute("data-tm-ribbon-nav");
    if (m) navigateTo(m);
  });
  document.querySelectorAll("[data-nav]").forEach(function (el) {
    el.addEventListener("click", function () {
      navigateTo(el.getAttribute("data-nav"));
    });
  });
  var tmSubmenu = document.getElementById("sidebarTmSubmenu");
  if (tmSubmenu) {
    tmSubmenu.addEventListener("click", function (e) {
      var el = e.target && e.target.closest && e.target.closest(".sidebar__sublink[data-tm-nav-action]");
      if (!el || !tmSubmenu.contains(el)) return;
      e.preventDefault();
      e.stopPropagation();
      var vid =
        el.getAttribute("data-testmaker-view") ||
        el.getAttribute("data-target");
      if (vid) {
        displayTestmakerView(vid);
        return;
      }
      var action = el.getAttribute("data-tm-nav-action");
      if (action === "library") navigateTo("library");
      else if (action === "pdf-editor") navigateTo("pdf-editor");
      else if (action === "auto-test") navigateTo("auto-test");
      else if (action === "pdf-cropper" || action === "ai-parser") navigateTo("pdf-cropper");
      else if (action === "soru-arsivi") navigateTo("soru-arsivi");
      else navigateTo("testmaker");
    });
  }

  /* Yan menü akordeonları: tek açık + aria-expanded */
  (function initSidebarAccordions() {
    var items = [
      { liSel: ".sidebar__item--testmaker", openClass: "sidebar__item--tm-open", btnId: "sidebarTmToggle" },
      { liSel: ".sidebar__item--deneme", openClass: "sidebar__item--da-open", btnId: "sidebarDaToggle" },
      { liSel: ".sidebar__item--ogrenci", openClass: "sidebar__item--ogr-open", btnId: "sidebarOgrToggle" },
      { liSel: ".sidebar__item--randevu", openClass: "sidebar__item--rv-open", btnId: "sidebarRvToggle" }
    ];
    items.forEach(function (cfg) {
      var li = document.querySelector(cfg.liSel);
      var mainBtn = li && document.getElementById(cfg.btnId);
      if (!li || !mainBtn) return;
      mainBtn.addEventListener(
        "click",
        function (ev) {
          ev.preventDefault();
          ev.stopPropagation();
          var open = li.classList.toggle(cfg.openClass);
          mainBtn.setAttribute("aria-expanded", open ? "true" : "false");
          if (open) closeSidebarAccordionsExcept(li);
        },
        true
      );
    });
  })();
}

var hpSelectedStudentId = "";
var hpWeekAnchor = null;
var hpPendingDrop = null;
/** Haftalık modal: yeni görev yerine mevcut mockTasks kaydını güncelle */
var hpEditingTaskId = null;

function hpFillStudentSelectOnly() {
  var sel = document.getElementById("hpStudentSelect");
  if (!sel) return;
  var keep = sel.value || hpSelectedStudentId;
  sel.innerHTML = '<option value="">— Öğrenci seçin —</option>';
  cachedStudents.forEach(function (s) {
    var o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name || s.studentName || "Öğrenci (" + s.id.slice(0, 6) + ")";
    sel.appendChild(o);
  });
  if (keep && cachedStudents.some(function (x) { return x.id === keep; })) {
    sel.value = keep;
  }
  hpSelectedStudentId = sel.value || "";
}

function hpLocalISODate(d) {
  var y = d.getFullYear();
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return y + "-" + m + "-" + day;
}

function hpMondayOfWeek(ref) {
  var d = new Date(ref);
  d.setHours(12, 0, 0, 0);
  var day = d.getDay();
  var diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function hpRefreshWeekRangeLabel(monday) {
  var el = document.getElementById("hpWeekRangeLabel");
  if (!el) return;
  var sun = new Date(monday);
  sun.setDate(monday.getDate() + 6);
  var o1 = { day: "numeric", month: "long", year: "numeric" };
  el.textContent =
    monday.toLocaleDateString("tr-TR", o1) + " — " + sun.toLocaleDateString("tr-TR", o1);
}

function hpBuildWeekGridDOM() {
  var grid = document.getElementById("hpWeekGrid");
  if (!grid) return;
  var mon = hpMondayOfWeek(hpWeekAnchor || new Date());
  hpRefreshWeekRangeLabel(mon);
  var dayShort = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  grid.innerHTML = "";
  for (var i = 0; i < 7; i++) {
    var dt = new Date(mon.getTime());
    dt.setDate(mon.getDate() + i);
    var iso = hpLocalISODate(dt);
    var sub = dt.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
    var col = document.createElement("div");
    col.className = "hp-day";
    col.setAttribute("data-hp-day-iso", iso);
    col.innerHTML =
      '<div class="hp-day__head">' +
      dayShort[i] +
      '<span class="hp-day__num">' +
      sub +
      "</span></div>" +
      '<div class="hp-day__drop" data-hp-drop="' +
      iso +
      '" data-hp-day-idx="' +
      i +
      '"></div>';
    grid.appendChild(col);
  }
}

function hpRenderWeekTaskCards() {
  if (!hpSelectedStudentId) return;
  document.querySelectorAll(".hp-day__drop").forEach(function (drop) {
    var iso = drop.getAttribute("data-hp-drop");
    drop.innerHTML = "";
    mockTasks
      .filter(function (t) {
        return (
          t.studentId === hpSelectedStudentId &&
          String(t.dueDate || "").slice(0, 10) === iso &&
          t.column !== "done"
        );
      })
      .forEach(function (t) {
        var card = document.createElement("div");
        card.className = "hp-week-card";
        card.setAttribute("data-hp-task-id", t.id);
        var typeMap = { konu: "📖 Konu", soru: "📝 Soru", deneme: "🎯 Deneme" };
        card.innerHTML =
          '<div class="hp-week-card__type">' +
          (typeMap[t.taskType] || "Görev") +
          "</div>" +
          '<span class="hp-week-card__title">' +
          escapeHtml(t.subject || "") +
          "</span>" +
          '<span class="hp-week-card__meta">' +
          escapeHtml(t.topic || "") +
          "</span>" +
          (t.resource
            ? '<span class="hp-week-card__src">' + escapeHtml(t.resource) + "</span>"
            : "") +
          '<button type="button" class="hp-week-card__edit" data-hp-task-edit="' +
          escapeHtml(t.id) +
          '" aria-label="Düzenle" title="Düzenle"><i class="fa-solid fa-pen"></i></button>' +
          '<button type="button" class="hp-week-card__del" data-hp-task-del="' +
          escapeHtml(t.id) +
          '" aria-label="Kaldır">×</button>';
        drop.appendChild(card);
      });
  });
}

function hpPopulateSubjectTopics() {
  var sub = document.getElementById("hpMtSubject");
  var top = document.getElementById("hpMtTopic");
  if (!sub || !top) return;
  var keys = Object.keys(YKS_HP_MUFRADAT);
  sub.innerHTML = keys.map(function (k) {
    return "<option value=\"" + escapeHtml(k) + "\">" + escapeHtml(k) + "</option>";
  }).join("");
  function fillTopics() {
    var sk = sub.value;
    var arr = YKS_HP_MUFRADAT[sk] || [];
    top.innerHTML = arr
      .map(function (x) {
        return "<option value=\"" + escapeHtml(x) + "\">" + escapeHtml(x) + "</option>";
      })
      .join("");
  }
  sub.onchange = fillTopics;
  fillTopics();
}

function hpResetWeeklyTaskModalChrome() {
  hpEditingTaskId = null;
  var tt = document.getElementById("hpWeeklyTaskModalTitle");
  if (tt) {
    tt.innerHTML = '<i class="fa-solid fa-calendar-plus"></i> Görev planla';
  }
}

function hpOpenWeeklyTaskModal(tool, dateIso) {
  hpResetWeeklyTaskModalChrome();
  hpPendingDrop = { tool: tool, dateIso: dateIso };
  hpPopulateSubjectTopics();
  var toolEl = document.getElementById("hpMtToolType");
  var dateEl = document.getElementById("hpMtDate");
  var vid = document.getElementById("hpMtVideo");
  var res = document.getElementById("hpMtResource");
  var notes = document.getElementById("hpMtNotes");
  var sub = document.getElementById("hpWeeklyTaskModalSubtitle");
  if (toolEl) toolEl.value = tool;
  if (dateEl) dateEl.value = dateIso;
  if (vid) vid.value = "";
  if (res) res.value = "";
  if (notes) notes.value = "";
  var labels = { konu: "Konu çalışma", soru: "Soru çözme", deneme: "Deneme çözme" };
  if (sub) sub.textContent = (labels[tool] || "Görev") + " · " + dateIso;
  openModal("hpWeeklyTaskModal");
}

function hpOpenWeeklyTaskModalForEdit(taskId) {
  var task = mockTasks.find(function (x) {
    return x.id === taskId;
  });
  if (!task || task.studentId !== hpSelectedStudentId) {
    showToast("Görev bulunamadı.");
    return;
  }
  hpEditingTaskId = taskId;
  hpPendingDrop = { tool: task.taskType || "konu", dateIso: String(task.dueDate || "").slice(0, 10) };
  hpPopulateSubjectTopics();
  var toolEl = document.getElementById("hpMtToolType");
  var dateEl = document.getElementById("hpMtDate");
  var vid = document.getElementById("hpMtVideo");
  var res = document.getElementById("hpMtResource");
  var notes = document.getElementById("hpMtNotes");
  var subEl = document.getElementById("hpMtSubject");
  var topEl = document.getElementById("hpMtTopic");
  var subti = document.getElementById("hpWeeklyTaskModalSubtitle");
  var tt = document.getElementById("hpWeeklyTaskModalTitle");
  if (toolEl) toolEl.value = task.taskType || "konu";
  if (dateEl) dateEl.value = String(task.dueDate || "").slice(0, 10);
  if (vid) vid.value = task.videoUrl || "";
  if (res) res.value = task.resource || "";
  if (notes) notes.value = task.notes || "";
  if (subEl) {
    subEl.value = task.subject || "";
    try {
      subEl.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {
      if (typeof subEl.onchange === "function") subEl.onchange();
    }
  }
  if (topEl && task.topic) {
    topEl.value = task.topic;
  }
  if (subti) {
    subti.textContent = "Görevi düzenle · " + String(task.dueDate || "").slice(0, 10);
  }
  if (tt) {
    tt.innerHTML = '<i class="fa-solid fa-pen-to-square"></i> Görevi düzenle';
  }
  openModal("hpWeeklyTaskModal");
}

function hpSaveWeeklyTaskFromModal() {
  if (!hpSelectedStudentId) {
    showToast("Önce öğrenci seçin.");
    return;
  }
  if (!hpEditingTaskId && (!hpPendingDrop || !hpPendingDrop.dateIso)) {
    showToast("Öğrenci veya tarih eksik.");
    return;
  }
  var stu = cachedStudents.find(function (x) {
    return x.id === hpSelectedStudentId;
  });
  var subj = document.getElementById("hpMtSubject");
  var top = document.getElementById("hpMtTopic");
  var dateEl = document.getElementById("hpMtDate");
  var res = document.getElementById("hpMtResource");
  var vid = document.getElementById("hpMtVideo");
  var notes = document.getElementById("hpMtNotes");
  var toolEl = document.getElementById("hpMtToolType");
  if (!subj || !top || !dateEl) return;
  var s = String(subj.value || "").trim();
  var k = String(top.value || "").trim();
  if (!s || !k) {
    showToast("Ders ve konu seçin.");
    return;
  }
  var d = String(dateEl.value || "").trim();
  if (!d) {
    showToast("Tarih girin.");
    return;
  }

  if (hpEditingTaskId) {
    var existing = mockTasks.find(function (x) {
      return x.id === hpEditingTaskId;
    });
    if (!existing) {
      showToast("Görev bulunamadı.");
      hpResetWeeklyTaskModalChrome();
      closeModal("hpWeeklyTaskModal");
      return;
    }
    existing.taskType = (toolEl && toolEl.value) || existing.taskType || "konu";
    existing.subject = s;
    existing.topic = k;
    existing.resource = res ? String(res.value || "").trim() : "";
    existing.videoUrl = vid ? String(vid.value || "").trim() : "";
    existing.notes = notes ? String(notes.value || "").trim() : "";
    existing.dueDate = d;
    if (stu) {
      existing.studentName = String(stu.name || stu.studentName || "").trim() || existing.studentName;
    }
    saveMockTasksToStorage();
    hpPendingDrop = null;
    hpResetWeeklyTaskModalChrome();
    closeModal("hpWeeklyTaskModal");
    showToast("Görev güncellendi.");
    hpRenderWeekTaskCards();
    rebuildGorevKanbanStateFromCache();
    renderGorevKanbanCards();
    void saveOgrenciVerisiBridge({ silent: true, studentIdOverride: hpSelectedStudentId }).catch(function (e) {
      console.warn(e);
    });
    return;
  }

  var task = {
    id: "mt_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8),
    studentId: hpSelectedStudentId,
    studentName: stu ? String(stu.name || stu.studentName || "").trim() : "",
    taskType: (toolEl && toolEl.value) || (hpPendingDrop && hpPendingDrop.tool) || "konu",
    subject: s,
    topic: k,
    resource: res ? String(res.value || "").trim() : "",
    videoUrl: vid ? String(vid.value || "").trim() : "",
    notes: notes ? String(notes.value || "").trim() : "",
    dueDate: d,
    column: "todo",
    createdAt: Date.now(),
  };
  loadMockTasksFromStorage();
  mockTasks.push(task);
  saveMockTasksToStorage();
  hpPendingDrop = null;
  closeModal("hpWeeklyTaskModal");
  showToast("Görev kaydedildi.");
  hpRenderWeekTaskCards();
  rebuildGorevKanbanStateFromCache();
  renderGorevKanbanCards();
  void saveOgrenciVerisiBridge({ silent: true, studentIdOverride: hpSelectedStudentId }).catch(function (e) {
    console.warn(e);
  });
}

function refreshHpWeekIfVisible() {
  var v = document.getElementById("view-haftalik-program");
  if (v && !v.hidden && hpSelectedStudentId) {
    hpRenderWeekTaskCards();
  }
}

function refreshHpView() {
  var view = document.getElementById("view-haftalik-program");
  if (!view || view.hidden) return;
  hpFillStudentSelectOnly();
  var emptyEl = document.getElementById("hpEmptyState");
  var ws = document.getElementById("hpWorkspace");
  var strip = document.getElementById("hpStudentStrip");
  if (strip) {
    strip.innerHTML = "";
    cachedStudents.forEach(function (s) {
      var name = s.name || s.studentName || "Öğrenci";
      var initials = name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (p) {
          return p[0];
        })
        .join("")
        .toUpperCase() || "?";
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "hp-student-chip" + (s.id === hpSelectedStudentId ? " is-active" : "");
      chip.setAttribute("data-hp-sid", s.id);
      chip.innerHTML =
        '<span class="hp-student-chip__av">' +
        escapeHtml(initials) +
        "</span><span>" +
        escapeHtml(name.length > 22 ? name.slice(0, 20) + "…" : name) +
        "</span>";
      strip.appendChild(chip);
    });
  }
  if (!hpSelectedStudentId) {
    if (emptyEl) emptyEl.hidden = false;
    if (ws) ws.hidden = true;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  if (ws) ws.hidden = false;
  hpWeekAnchor = hpWeekAnchor || new Date();
  hpBuildWeekGridDOM();
  hpRenderWeekTaskCards();
}

/** Haftalık program — öğrenci zorunlu, HTML5 DnD, modal, mockTasks senkron */
function initHaftalikProgramDnD() {
  var root = document.getElementById("view-haftalik-program");
  if (!root) return;
  if (!root.getAttribute("data-hp-dnd-init")) {
    root.setAttribute("data-hp-dnd-init", "1");
    hpWeekAnchor = new Date();

    root.addEventListener("dragstart", function (e) {
      var tool = e.target && e.target.closest && e.target.closest(".hp-tool");
      if (!tool || !root.contains(tool)) return;
      try {
        e.dataTransfer.setData(
          "application/json",
          JSON.stringify({ hpTool: true, tool: tool.getAttribute("data-hp-tool") })
        );
        e.dataTransfer.setData("text/plain", "hp-tool");
      } catch (err) {}
      e.dataTransfer.effectAllowed = "copy";
      tool.classList.add("hp-tool--dragging");
    });
    root.addEventListener("dragend", function (e) {
      var tool = e.target && e.target.closest && e.target.closest(".hp-tool");
      if (tool) tool.classList.remove("hp-tool--dragging");
      root.querySelectorAll(".hp-day__drop--over").forEach(function (n) {
        n.classList.remove("hp-day__drop--over");
      });
    });
    root.addEventListener("dragover", function (e) {
      var dz = e.target && e.target.closest && e.target.closest(".hp-day__drop");
      if (!dz || !root.contains(dz)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
      root.querySelectorAll(".hp-day__drop--over").forEach(function (n) {
        n.classList.remove("hp-day__drop--over");
      });
      dz.classList.add("hp-day__drop--over");
    });
    root.addEventListener("dragleave", function (e) {
      var dz = e.target && e.target.closest && e.target.closest(".hp-day__drop");
      if (!dz || !root.contains(dz)) return;
      if (!e.relatedTarget || !dz.contains(e.relatedTarget)) {
        dz.classList.remove("hp-day__drop--over");
      }
    });
    root.addEventListener("drop", function (e) {
      var dz = e.target && e.target.closest && e.target.closest(".hp-day__drop");
      if (!dz || !root.contains(dz)) return;
      e.preventDefault();
      dz.classList.remove("hp-day__drop--over");
      if (!hpSelectedStudentId) {
        showToast("Önce öğrenci seçin.");
        return;
      }
      var raw = e.dataTransfer.getData("application/json");
      var tool = "konu";
      try {
        var o = raw ? JSON.parse(raw) : null;
        if (o && o.hpTool) tool = o.tool || "konu";
      } catch (e2) {}
      var iso = dz.getAttribute("data-hp-drop");
      if (!iso) return;
      hpOpenWeeklyTaskModal(tool, iso);
    });

    root.addEventListener("click", function (e) {
      var ed = e.target && e.target.closest && e.target.closest("[data-hp-task-edit]");
      if (ed && root.contains(ed)) {
        e.preventDefault();
        var tid = ed.getAttribute("data-hp-task-edit");
        if (tid) hpOpenWeeklyTaskModalForEdit(tid);
        return;
      }
      var del = e.target && e.target.closest && e.target.closest("[data-hp-task-del]");
      if (!del || !root.contains(del)) return;
      e.preventDefault();
      var id = del.getAttribute("data-hp-task-del");
      if (!id || !confirm("Bu görevi haftalık plandan kaldırmak istiyor musunuz?")) return;
      for (var hi = mockTasks.length - 1; hi >= 0; hi--) {
        if (mockTasks[hi].id === id) mockTasks.splice(hi, 1);
      }
      saveMockTasksToStorage();
      hpRenderWeekTaskCards();
      rebuildGorevKanbanStateFromCache();
      renderGorevKanbanCards();
      showToast("Görev kaldırıldı.");
    });

    var sel = document.getElementById("hpStudentSelect");
    if (sel) {
      sel.addEventListener("change", function () {
        hpSelectedStudentId = sel.value || "";
        refreshHpView();
      });
    }
    var strip = document.getElementById("hpStudentStrip");
    if (strip) {
      strip.addEventListener("click", function (e) {
        var ch = e.target && e.target.closest && e.target.closest(".hp-student-chip");
        if (!ch) return;
        var sid = ch.getAttribute("data-hp-sid");
        if (!sid) return;
        hpSelectedStudentId = sid;
        var sEl = document.getElementById("hpStudentSelect");
        if (sEl) sEl.value = sid;
        refreshHpView();
      });
    }
    var btnSave = document.getElementById("hpMtSave");
    if (btnSave) {
      btnSave.addEventListener("click", function () {
        hpSaveWeeklyTaskFromModal();
      });
    }
  }
  refreshHpView();
}

function initYksFeaturePages() {
  var btn = document.getElementById("btnKoclukNotEkle");
  if (btn && !btn.dataset.bound) {
    btn.dataset.bound = "1";
    btn.addEventListener("click", function () {
      showToast("Görüşme notu (taslak): form sonraki sürümde Firestore ile bağlanacak.");
    });
  }
  initKaynakKitapModuleOnce();
}

/* --- Kaynak / Kitap — Firestore: kaynaklar + students/{id}/atananKaynaklar --- */
var kkKaynakBound = false;
var kkSelectedStudentId = "";
var kkPrevStudentId = "";
var kkOpenBookId = null;

/** Koçun kütüphanesi (kaynaklar koleksiyonundan) */
var KK_LIBRARY_CACHE = [];
var kkLibUnsub = null;
var kkAssignUnsub = null;
var kkAssignedBooksCache = [];
var kkPrevStudentForAssignSub = "";

function kkNewTopicId() {
  return "t_" + Math.random().toString(36).slice(2, 10);
}

function kkNormalizeFirestoreTopics(raw) {
  if (Array.isArray(raw) && raw.length) {
    return raw.map(function (t, i) {
      return {
        id: t.id || "t_" + i + "_" + Math.random().toString(36).slice(2, 6),
        name: t.name || "Konu",
        status: typeof t.status === "number" ? t.status : 0,
      };
    });
  }
  return [{ id: kkNewTopicId(), name: "Genel çalışma", status: 0 }];
}

function kkStartLibraryFirestoreListeners() {
  if (kkLibUnsub) {
    try {
      kkLibUnsub();
    } catch (e) {}
    kkLibUnsub = null;
  }
  var cid = getCoachId();
  if (!cid) return;
  var qy = query(collection(db, "kaynaklar"), where("coach_id", "==", cid));
  kkLibUnsub = onSnapshot(
    qy,
    function (snap) {
      KK_LIBRARY_CACHE = [];
      snap.forEach(function (d) {
        var data = d.data();
        KK_LIBRARY_CACHE.push({
          id: d.id,
          title: data.title || "",
          subject: data.subject || "",
          totalPages:
            typeof data.totalPages === "number" ? data.totalPages : parseInt(data.totalPages, 10) || 0,
          publisher: data.publisher || "",
        });
      });
      KK_LIBRARY_CACHE.sort(function (a, b) {
        return String(a.title || "").localeCompare(String(b.title || ""), "tr");
      });
      kkFillLibraryDropdown();
      if (currentView === "kutuphanem") refreshKutuphanemList();
    },
    function (err) {
      console.warn("[kaynaklar]", err);
    }
  );
}

function kkUnsubscribeStudentAssignments() {
  if (kkAssignUnsub) {
    try {
      kkAssignUnsub();
    } catch (e) {}
    kkAssignUnsub = null;
  }
  kkAssignedBooksCache = [];
}

function kkSubscribeStudentAssignments(studentId) {
  if (studentId === kkPrevStudentForAssignSub && kkAssignUnsub) return;
  kkPrevStudentForAssignSub = studentId || "";
  kkUnsubscribeStudentAssignments();
  if (!studentId) return;
  kkAssignUnsub = onSnapshot(
    collection(db, "students", studentId, "atananKaynaklar"),
    function (snap) {
      kkAssignedBooksCache = [];
      snap.forEach(function (d) {
        var x = d.data();
        kkAssignedBooksCache.push({
          id: d.id,
          libId: x.libraryId || "",
          title: x.title || "",
          publisher: x.publisher || "—",
          subject: x.subject || "",
          difficulty: x.difficulty || "—",
          correctTotal: x.correctTotal || 0,
          wrongTotal: x.wrongTotal || 0,
          topics: kkNormalizeFirestoreTopics(x.topics),
          totalPages: typeof x.totalPages === "number" ? x.totalPages : 0,
        });
      });
      kkAssignedBooksCache.sort(function (a, b) {
        return String(a.title || "").localeCompare(String(b.title || ""), "tr");
      });
      var view = document.getElementById("view-kaynak-kitap");
      var root = document.getElementById("kkBooksRoot");
      if (view && !view.hidden && root && kkSelectedStudentId === studentId) {
        kkRenderBooks(root);
      }
    },
    function (err) {
      console.warn("[atananKaynaklar]", err);
    }
  );
}

function kkGetStudentBooksSlice() {
  return { books: kkAssignedBooksCache.slice() };
}

function kkFillLibraryDropdown() {
  var sel = document.getElementById("kkLibSelect");
  var fSub = document.getElementById("kkLibFilterSubject");
  if (!sel) return;
  var filterSub = fSub ? fSub.value : "";
  sel.innerHTML = '<option value="">— Kütüphaneden seçin —</option>';
  KK_LIBRARY_CACHE.filter(function (x) {
    return !filterSub || x.subject === filterSub;
  }).forEach(function (lib) {
    var o = document.createElement("option");
    o.value = lib.id;
    o.textContent =
      (lib.title || "Kitap") + " · " + (lib.subject || "") + " · " + (lib.totalPages || 0) + " s./test";
    sel.appendChild(o);
  });
}

function refreshKutuphanemList() {
  var root = document.getElementById("kutuphaneListRoot");
  if (!root) return;
  if (KK_LIBRARY_CACHE.length === 0) {
    root.innerHTML =
      '<p class="kk-lib-empty" style="margin:0">Henüz kitap eklenmedi. Yukarıdaki formdan ekleyin.</p>';
    return;
  }
  root.innerHTML =
    '<div class="kutu-lib-grid">' +
    KK_LIBRARY_CACHE.map(function (lib) {
      return (
        '<div class="kutu-lib-card">' +
        "<div><h4>" +
        escapeHtml(lib.title) +
        "</h4>" +
        '<p class="kutu-lib-meta">' +
        escapeHtml(lib.subject) +
        " · " +
        escapeHtml(String(lib.totalPages)) +
        " sayfa/test</p></div></div>"
      );
    }).join("") +
    "</div>";
}

function bindKutuphanemFormOnce() {
  var form = document.getElementById("formKutuphaneYeni");
  if (!form || form.dataset.kutuBound) return;
  form.dataset.kutuBound = "1";
  form.addEventListener("submit", async function (e) {
    e.preventDefault();
    var cid = getCoachId();
    if (!cid) {
      showToast("Oturum bulunamadı.");
      return;
    }
    var titleEl = document.getElementById("kutuKitapAdi");
    var subEl = document.getElementById("kutuDers");
    var totEl = document.getElementById("kutuToplam");
    var title = titleEl ? String(titleEl.value || "").trim() : "";
    var subject = subEl ? String(subEl.value || "").trim() : "";
    var total = totEl ? parseInt(totEl.value, 10) : 0;
    if (!title || !subject) {
      showToast("Kitap adı ve ders zorunludur.");
      return;
    }
    if (isNaN(total) || total < 1) {
      showToast("Geçerli bir sayfa/test sayısı girin (en az 1).");
      return;
    }
    try {
      await addDoc(collection(db, "kaynaklar"), {
        coach_id: cid,
        title: title,
        subject: subject,
        totalPages: total,
        createdAt: serverTimestamp(),
      });
      showToast("Kitap kütüphaneye eklendi.");
      form.reset();
    } catch (err) {
      console.error(err);
      showToast("Kayıt başarısız: " + (err && err.message ? err.message : ""));
    }
  });
}

function kkTopicProgress(book) {
  var topics = book.topics || [];
  if (topics.length === 0) return 0;
  var done = topics.filter(function (t) {
    return t.status === 2;
  }).length;
  return Math.round((100 * done) / topics.length);
}

function kkEfficiencyBadge(correct, wrong) {
  var t = (correct || 0) + (wrong || 0);
  if (t === 0) return { cls: "kk-badge--muted", text: "Performans bekleniyor" };
  var pct = Math.round((100 * correct) / t);
  var label = pct >= 70 ? "Uygun" : pct >= 40 ? "Orta seviye" : "Zor Geliyor";
  var cls = pct >= 70 ? "kk-badge--ok" : pct >= 40 ? "kk-badge--mid" : "kk-badge--low";
  return { cls: cls, text: "%" + pct + " Başarı — " + label };
}

function kkClosedBadgeLine(book) {
  var tp = kkTopicProgress(book);
  var eff = kkEfficiencyBadge(book.correctTotal, book.wrongTotal);
  if ((book.correctTotal || 0) + (book.wrongTotal || 0) > 0) {
    return { badge: eff, sub: "Konu tamamlama %" + tp };
  }
  return { badge: { cls: "kk-badge--muted", text: "Konu %" + tp + " · " + eff.text }, sub: "" };
}

function kkFillStudentSelectOnly() {
  var sel = document.getElementById("kkStudentSelect");
  if (!sel) return;
  var keep = sel.value || kkSelectedStudentId;
  sel.innerHTML = '<option value="">— Öğrenci seçin —</option>';
  cachedStudents.forEach(function (s) {
    var o = document.createElement("option");
    o.value = s.id;
    o.textContent = s.name || s.studentName || "Öğrenci (" + s.id.slice(0, 6) + ")";
    sel.appendChild(o);
  });
  if (keep && cachedStudents.some(function (x) { return x.id === keep; })) {
    sel.value = keep;
  }
  kkSelectedStudentId = sel.value || "";
}

function refreshKaynakKitapView() {
  var view = document.getElementById("view-kaynak-kitap");
  if (!view || view.hidden) return;
  var sel = document.getElementById("kkStudentSelect");
  var strip = document.getElementById("kkStudentStrip");
  var emptyEl = document.getElementById("kkEmptyState");
  var root = document.getElementById("kkBooksRoot");
  var btnNew = document.getElementById("btnKkYeniKaynak");
  if (sel) {
    kkFillStudentSelectOnly();
  }
  if (kkPrevStudentId !== kkSelectedStudentId) {
    kkOpenBookId = null;
    kkPrevStudentId = kkSelectedStudentId;
  }
  if (strip) {
    strip.innerHTML = "";
    cachedStudents.forEach(function (s) {
      var name = s.name || s.studentName || "Öğrenci";
      var initials = name
        .trim()
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (p) {
          return p[0];
        })
        .join("")
        .toUpperCase() || "?";
      var chip = document.createElement("button");
      chip.type = "button";
      chip.className = "kk-student-chip" + (s.id === kkSelectedStudentId ? " is-active" : "");
      chip.setAttribute("data-kk-sid", s.id);
      chip.setAttribute("role", "tab");
      chip.setAttribute("aria-selected", s.id === kkSelectedStudentId ? "true" : "false");
      chip.innerHTML =
        '<span class="kk-student-chip__av">' +
        escapeHtml(initials) +
        "</span><span>" +
        escapeHtml(name.length > 22 ? name.slice(0, 20) + "…" : name) +
        "</span>";
      strip.appendChild(chip);
    });
  }
  if (btnNew) btnNew.disabled = !kkSelectedStudentId;
  if (!kkSelectedStudentId) {
    kkSubscribeStudentAssignments("");
    if (emptyEl) {
      emptyEl.hidden = false;
    }
    if (root) {
      root.hidden = true;
      root.innerHTML = "";
    }
    return;
  }
  kkSubscribeStudentAssignments(kkSelectedStudentId);
  if (emptyEl) emptyEl.hidden = true;
  if (root) {
    root.hidden = false;
    kkRenderBooks(root);
  }
}

function kkRenderBooks(root) {
  var data = kkGetStudentBooksSlice();
  var books = data.books || [];
  if (books.length === 0) {
    root.innerHTML =
      '<p class="kk-lib-empty" style="margin:0">Bu öğrenciye henüz kaynak eklenmedi. «Yeni Kaynak Ata» ile kütüphaneden ekleyin.</p>';
    return;
  }
  var html = books
    .map(function (book) {
      var prog = kkTopicProgress(book);
      var line = kkClosedBadgeLine(book);
      var isOpen = kkOpenBookId === book.id;
      var eff = kkEfficiencyBadge(book.correctTotal, book.wrongTotal);
      var topics = book.topics || [];
      var topicRows = topics
        .map(function (topic, ti) {
          var st = topic.status != null ? topic.status : 0;
          return (
            '<div class="kk-topic-row" data-kk-book="' +
            escapeHtml(book.id) +
            '" data-kk-topic-ix="' +
            ti +
            '">' +
            '<span class="kk-topic-name">' +
            escapeHtml(topic.name) +
            "</span>" +
            '<div class="kk-topic-actions">' +
            '<button type="button" class="kk-st' +
            (st === 0 ? " is-on" : "") +
            '" data-kk-st="0" title="Bekliyor"><i class="fa-regular fa-square"></i> Bekliyor</button>' +
            '<button type="button" class="kk-st' +
            (st === 1 ? " is-on" : "") +
            '" data-kk-st="1" title="Ödev verildi"><i class="fa-solid fa-play"></i> Ödev</button>' +
            '<button type="button" class="kk-st' +
            (st === 2 ? " is-on" : "") +
            '" data-kk-st="2" title="Bitti"><i class="fa-solid fa-check"></i> Bitti</button>' +
            "</div></div>"
          );
        })
        .join("");
      return (
        '<div class="kk-acc' +
        (isOpen ? " is-open" : "") +
        '" data-kk-book-id="' +
        escapeHtml(book.id) +
        '">' +
        '<button type="button" class="kk-acc__head" data-kk-toggle="' +
        escapeHtml(book.id) +
        '" aria-expanded="' +
        (isOpen ? "true" : "false") +
        '">' +
        '<div class="kk-acc__head-main">' +
        '<h3 class="kk-acc__title">' +
        escapeHtml(book.title) +
        ' <i class="fa-solid fa-chevron-down kk-acc__chev" aria-hidden="true"></i></h3>' +
        '<p class="kk-acc__meta">' +
        escapeHtml(book.publisher || "—") +
        (book.subject ? " · " + escapeHtml(book.subject) : "") +
        "</p>" +
        '<div class="kk-acc__progress-wrap"><div class="yks-progress" aria-hidden="true"><div class="yks-progress__bar" style="width:' +
        prog +
        '%"></div></div></div>' +
        "</div>" +
        '<div class="kk-acc__side">' +
        '<span class="kk-badge ' +
        line.badge.cls +
        '">' +
        escapeHtml(line.badge.text) +
        "</span>" +
        (line.sub ? '<span class="kk-acc__meta">' + escapeHtml(line.sub) + "</span>" : "") +
        "</div></button>" +
        '<div class="kk-acc__body"' +
        (isOpen ? "" : " hidden") +
        ">" +
        '<div class="kk-perf" data-kk-perf-book="' +
        escapeHtml(book.id) +
        '">' +
        '<p class="kk-perf__lbl">Performans girişi (hızlı)</p>' +
        "<label><span>Doğru</span>" +
        '<input type="number" min="0" step="1" class="kk-inp-d" value="" placeholder="0" aria-label="Doğru sayısı" /></label>' +
        "<label><span>Yanlış</span>" +
        '<input type="number" min="0" step="1" class="kk-inp-y" value="" placeholder="0" aria-label="Yanlış sayısı" /></label>' +
        '<button type="button" class="btn btn--sm btn--purple" data-kk-perf-save="' +
        escapeHtml(book.id) +
        '"><i class="fa-solid fa-bolt"></i> Güncelle</button>' +
        "<p style='flex:1 1 100%;margin:0;font-size:0.72rem;color:#94a3b8'>Toplam: D " +
        (book.correctTotal || 0) +
        " · Y " +
        (book.wrongTotal || 0) +
        " · Rozet: " +
        escapeHtml(eff.text) +
        "</p></div>" +
        topicRows +
        "</div></div>"
      );
    })
    .join("");
  root.innerHTML = html;
}

function kkSetTopicStatus(studentId, bookId, topicIndex, status) {
  var book = kkAssignedBooksCache.find(function (b) {
    return b.id === bookId;
  });
  if (!book || !book.topics[topicIndex]) return;
  book.topics[topicIndex].status = status;
  updateDoc(doc(db, "students", studentId, "atananKaynaklar", bookId), { topics: book.topics }).catch(function (e) {
    console.error(e);
    showToast("Konu durumu kaydedilemedi.");
  });
}

function kkAddPerformance(studentId, bookId, d, y) {
  var book = kkAssignedBooksCache.find(function (b) {
    return b.id === bookId;
  });
  if (!book) return;
  book.correctTotal = (book.correctTotal || 0) + d;
  book.wrongTotal = (book.wrongTotal || 0) + y;
  updateDoc(doc(db, "students", studentId, "atananKaynaklar", bookId), {
    correctTotal: book.correctTotal,
    wrongTotal: book.wrongTotal,
  }).catch(function (e) {
    console.error(e);
    showToast("Performans kaydedilemedi.");
  });
}

async function kkAssignBookFromLibrary() {
  var sel = document.getElementById("kkLibSelect");
  var libId = sel ? sel.value : "";
  if (!kkSelectedStudentId) {
    showToast("Öğrenci seçin.");
    return;
  }
  if (!libId) {
    showToast("Kütüphaneden bir kitap seçin.");
    return;
  }
  var lib = KK_LIBRARY_CACHE.find(function (x) {
    return x.id === libId;
  });
  if (!lib) return;
  if (kkAssignedBooksCache.some(function (b) { return b.libId === libId; })) {
    showToast("Bu kaynak zaten atanmış.");
    return;
  }
  try {
    await addDoc(collection(db, "students", kkSelectedStudentId, "atananKaynaklar"), {
      coach_id: getCoachId(),
      libraryId: lib.id,
      title: lib.title,
      subject: lib.subject,
      totalPages: lib.totalPages,
      publisher: lib.publisher || "",
      topics: [{ id: kkNewTopicId(), name: "Genel çalışma", status: 0 }],
      correctTotal: 0,
      wrongTotal: 0,
      assignedAt: serverTimestamp(),
    });
    showToast("Kaynak öğrenciye eklendi.");
    closeModal("kkModalAta");
  } catch (e) {
    console.error(e);
    showToast("Atama başarısız: " + (e && e.message ? e.message : ""));
  }
}

function initKaynakKitapModuleOnce() {
  if (kkKaynakBound) return;
  kkKaynakBound = true;
  document.addEventListener("click", function (e) {
    var t = e.target;
    if (!t || !t.closest) return;
    if (!t.closest("#view-kaynak-kitap") && !t.closest("#kkModalAta")) return;
    var stripChip = t.closest(".kk-student-chip");
    if (stripChip && stripChip.getAttribute("data-kk-sid")) {
      e.preventDefault();
      kkSelectedStudentId = stripChip.getAttribute("data-kk-sid");
      var sel = document.getElementById("kkStudentSelect");
      if (sel) sel.value = kkSelectedStudentId;
      refreshKaynakKitapView();
      return;
    }
    var toggle = t.closest("[data-kk-toggle]");
    if (toggle && t.closest("#kkBooksRoot")) {
      e.preventDefault();
      var bid = toggle.getAttribute("data-kk-toggle");
      kkOpenBookId = kkOpenBookId === bid ? null : bid;
      refreshKaynakKitapView();
      return;
    }
    var stBtn = t.closest(".kk-st");
    if (stBtn && t.closest(".kk-topic-row")) {
      e.preventDefault();
      var row = stBtn.closest(".kk-topic-row");
      var bookId = row.getAttribute("data-kk-book");
      var ti = parseInt(row.getAttribute("data-kk-topic-ix"), 10);
      var stVal = parseInt(stBtn.getAttribute("data-kk-st"), 10);
      if (!kkSelectedStudentId || !bookId || isNaN(ti)) return;
      kkSetTopicStatus(kkSelectedStudentId, bookId, ti, stVal);
      refreshKaynakKitapView();
      return;
    }
    var ps = t.closest("[data-kk-perf-save]");
    if (ps) {
      e.preventDefault();
      var bookId2 = ps.getAttribute("data-kk-perf-save");
      var wrap = document.querySelector('.kk-perf[data-kk-perf-book="' + bookId2 + '"]');
      if (!wrap || !kkSelectedStudentId) return;
      var inpD = wrap.querySelector(".kk-inp-d");
      var inpY = wrap.querySelector(".kk-inp-y");
      var dv = inpD ? parseInt(inpD.value, 10) : 0;
      var yv = inpY ? parseInt(inpY.value, 10) : 0;
      if (isNaN(dv) || dv < 0) dv = 0;
      if (isNaN(yv) || yv < 0) yv = 0;
      if (dv === 0 && yv === 0) {
        showToast("Doğru veya yanlış girin.");
        return;
      }
      kkAddPerformance(kkSelectedStudentId, bookId2, dv, yv);
      if (inpD) inpD.value = "";
      if (inpY) inpY.value = "";
      showToast("Performans güncellendi; rozet yenilendi.");
      refreshKaynakKitapView();
      return;
    }
    var addBtn = t.closest("#btnKkAssignConfirm");
    if (addBtn) {
      e.preventDefault();
      kkAssignBookFromLibrary();
      return;
    }
  });
  var sel = document.getElementById("kkStudentSelect");
  if (sel && !sel.dataset.kkBound) {
    sel.dataset.kkBound = "1";
    sel.addEventListener("change", function () {
      kkSelectedStudentId = sel.value || "";
      refreshKaynakKitapView();
    });
  }
  var btnNew = document.getElementById("btnKkYeniKaynak");
  if (btnNew && !btnNew.dataset.kkBound) {
    btnNew.dataset.kkBound = "1";
    btnNew.addEventListener("click", function () {
      if (!kkSelectedStudentId) {
        showToast("Önce öğrenci seçin.");
        return;
      }
      var sel = document.getElementById("kkStudentSelect");
      var lab = document.getElementById("kkModalStudentLabel");
      if (lab && sel) {
        var opt = sel.options[sel.selectedIndex];
        lab.textContent = opt ? opt.textContent : "—";
      }
      kkFillLibraryDropdown();
      openModal("kkModalAta");
    });
  }
  var f1 = document.getElementById("kkLibFilterSubject");
  if (f1 && !f1.dataset.kkBound) {
    f1.dataset.kkBound = "1";
    f1.addEventListener("change", kkFillLibraryDropdown);
  }
  bindKutuphanemFormOnce();
  kkStartLibraryFirestoreListeners();
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

  var btnMuhTah = document.getElementById("btnMuhasebeNewTahsilat");
  if (btnMuhTah) btnMuhTah.addEventListener("click", openPayModal);
  var btnSdTah = document.getElementById("btnSdQuickTahsilat");
  if (btnSdTah) {
    btnSdTah.addEventListener("click", function () {
      if (currentStudentDetailId) openPaymentModalForStudent(currentStudentDetailId);
      else showToast("Öğrenci seçin.");
    });
  }

  (function initStudentDetailErpTabs() {
    document.querySelectorAll(".sd-erp-tab").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = btn.getAttribute("data-sd-tab");
        document.querySelectorAll(".sd-erp-tab").forEach(function (b) {
          var on = b.getAttribute("data-sd-tab") === idx;
          b.classList.toggle("is-active", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        document.querySelectorAll(".sd-erp-panel").forEach(function (p) {
          p.hidden = p.getAttribute("data-sd-panel") !== idx;
        });
        if (idx === "1" && currentStudentDetailId) {
          setTimeout(function () {
            renderStudentDetailTrendChart(currentStudentDetailId);
          }, 60);
        }
      });
    });
  })();

  var btnChStudentId = document.getElementById("btnStudentDetailChangeId");
  if (btnChStudentId && !btnChStudentId.dataset.bound) {
    btnChStudentId.dataset.bound = "1";
    btnChStudentId.addEventListener("click", async function () {
      var sid = currentStudentDetailId;
      var inp = document.getElementById("studentDetailNewIdInput");
      var nv = inp ? inp.value : "";
      if (!sid) return;
      btnChStudentId.disabled = true;
      try {
        await migrateStudentDocumentId(sid, nv);
      } finally {
        btnChStudentId.disabled = false;
      }
    });
  }

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
    var ovKaydet = t.closest && t.closest("[data-ogrenci-verisi-kaydet]");
    if (ovKaydet) {
      e.preventDefault();
      void saveOgrenciVerisiBridge().catch(function (err) {
        console.warn(err);
      });
      return;
    }
    var det = t.closest && t.closest("[data-student-detail]");
    if (det) {
      e.preventDefault();
      openStudentDetail(det.getAttribute("data-student-detail"));
      return;
    }
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
    var tahMuh = t.closest && t.closest("[data-muh-tahsilat]");
    if (tahMuh) {
      e.preventDefault();
      openPaymentModalForStudent(tahMuh.getAttribute("data-muh-tahsilat"));
      return;
    }
    var waBtn = t.closest && t.closest("[data-muh-wa]");
    if (waBtn) {
      e.preventDefault();
      var num = waBtn.getAttribute("data-muh-wa") || "";
      var stu = waBtn.getAttribute("data-muh-student") || "";
      if (num.length >= 10) {
        var msg = encodeURIComponent(
          "Merhaba, " +
            (stu || "öğrenci") +
            " için vadesi geçen ödeme hatırlatması — YKS Koçluk."
        );
        window.open("https://wa.me/" + num + "?text=" + msg, "_blank", "noopener,noreferrer");
      } else showToast("Veli telefonu eksik veya geçersiz.");
      return;
    }
    var acrobatT = t.closest && t.closest("[data-tm-acrobat-test]");
    if (acrobatT) {
      e.preventDefault();
      tmOpenFirestoreTestInAnnotator(acrobatT.getAttribute("data-tm-acrobat-test"));
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
  getMockTasks: function () {
    return mockTasks;
  },
  navigate: navigateTo,
  openStudentDetail: openStudentDetail,
  displayTestmakerView: displayTestmakerView,
  fetchAIGeneratedQuestions: fetchAIGeneratedQuestions,
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
  applySpaInitialShellState();
initSidebar();
initNavigation();
initModals();
  initAiTestGenWizard();
initAllButtons();
  initYksFeaturePages();
  initDashboardYksCountdownWidget();
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
    .then(async function (snap) {
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
      var setSnap = await getDoc(doc(db, "settings", "app"));
      var maint = firestoreDocExists(setSnap) && setSnap.data().maintenance === true;
      var impersonate = false;
      try {
        impersonate = !!(sessionStorage.getItem("superAdminViewAsCoach") || "").trim();
      } catch (e) {}
      if (maint && !impersonate) {
        await signOut(auth);
        try {
          localStorage.setItem("loginFlashError", "Bakımdayız. Şu an yalnızca kurucu girişi açıktır.");
        } catch (e) {}
        window.location.replace("login.html");
        return;
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
