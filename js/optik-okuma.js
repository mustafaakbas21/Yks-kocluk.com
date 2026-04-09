/**
 * Akıllı Optik İşlem Merkezi — bağımsız sayfa (exams plan + ExamResults).
 */
import {
  collection,
  query,
  where,
  getDocs,
  addDoc,
  db,
  auth,
  serverTimestamp,
  setCoachDataIsolation,
  setExamStudentGuard,
  isAppwriteWriteSoftFailure,
} from "./appwrite-compat.js?v=20260408-inst";
import { APPWRITE_COLLECTION_EXAM_RESULTS } from "./appwrite-config.js?v=20260408-inst";
import { netFromDyWithRule } from "./yks-mufredat.js";
import { getCoachPanelGate, getLastCoachGateResult } from "./coach-auth-session.js";
import { exportToBin, buildOptikFixedRecord, runScanlineAnimation } from "./optik-omr-engine.js";

/**
 * Şık ızgarasından soru listesi üretir (referans görüntü pikselinde).
 */
function buildQuestionsFromGridParams(p) {
  var letters = ["A", "B", "C", "D", "E"];
  var questions = [];
  var n = Math.max(1, Math.min(200, Number(p.questionCount) || 1));
  var firstQX = Number(p.firstQX) || 0;
  var firstQY = Number(p.firstQY) || 0;
  var gapX = Number(p.gapX) || 22;
  var gapY = Number(p.gapY) || 14;
  var boxW = Math.max(1, Number(p.boxW) || 12);
  var boxH = Math.max(1, Number(p.boxH) || 12);
  for (var q = 0; q < n; q++) {
    var yy = firstQY + q * gapY;
    var choices = {};
    for (var i = 0; i < letters.length; i++) {
      choices[letters[i]] = {
        x: firstQX + i * gapX,
        y: yy,
        w: boxW,
        h: boxH,
      };
    }
    questions.push({ questionNo: q + 1, choices: choices });
  }
  return questions;
}

/**
 * Varsayılan optik şablon (koordinatlar kalibrasyonla veya yapıştırılan JSON ile güncellenir).
 */
function createDefaultOptikSablon() {
  var refW = 620;
  var refH = 880;

  var studentNumberColumns = [];
  var digitOriginX = 68;
  var digitOriginY = 136;
  var colGap = 32;
  var digitCellW = 15;
  var digitCellH = 14;
  var digitRowGap = 17;
  for (var c = 0; c < 5; c++) {
    var bubbles = [];
    for (var d = 0; d < 10; d++) {
      bubbles.push({
        x: digitOriginX + c * colGap,
        y: digitOriginY + d * digitRowGap,
        w: digitCellW,
        h: digitCellH,
      });
    }
    studentNumberColumns.push({ bubbles: bubbles });
  }

  var bookletType = {
    A: { x: 248, y: 112, w: 18, h: 15 },
    B: { x: 272, y: 112, w: 18, h: 15 },
    C: { x: 296, y: 112, w: 18, h: 15 },
    D: { x: 320, y: 112, w: 18, h: 15 },
  };

  var questions = buildQuestionsFromGridParams({
    firstQX: 302,
    firstQY: 318,
    gapX: 22,
    gapY: 14,
    boxW: 16,
    boxH: 12,
    questionCount: 40,
  });

  return {
    meta: {
      note: "Taslak şablon — Kalibrasyon Modu veya JSON ile güncellenir.",
    },
    referenceSize: { w: refW, h: refH },
    luminanceThreshold: 100,
    studentNumberColumns: studentNumberColumns,
    bookletType: bookletType,
    questions: questions,
  };
}

/** @type {ReturnType<typeof createDefaultOptikSablon>} */
var OPTIK_SABLON = createDefaultOptikSablon();

/**
 * Kalibrasyon çıktısını çalışan şablona uygular (öğrenci no / kitapçık aynı kalır).
 */
function applyCalibratedQuestionsToSablon(exportObj) {
  if (!exportObj || typeof exportObj !== "object") return;
  if (exportObj.referenceSize && exportObj.referenceSize.w && exportObj.referenceSize.h) {
    OPTIK_SABLON.referenceSize.w = Number(exportObj.referenceSize.w);
    OPTIK_SABLON.referenceSize.h = Number(exportObj.referenceSize.h);
  }
  if (exportObj.luminanceThreshold != null) {
    OPTIK_SABLON.luminanceThreshold = Number(exportObj.luminanceThreshold);
  }
  var qs = exportObj.questions;
  if (Array.isArray(qs) && qs.length) {
    OPTIK_SABLON.questions = qs.slice();
  }
}

/**
 * Ortalama luminance & eşik: koyu alan (işaret) → true.
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} x
 * @param {number} y
 * @param {number} width
 * @param {number} height
 * @param {number} [threshold]
 */
function analyzeBubble(ctx, x, y, width, height, threshold) {
  var cw = ctx.canvas.width;
  var ch = ctx.canvas.height;
  var xi = Math.max(0, Math.floor(x));
  var yi = Math.max(0, Math.floor(y));
  var wi = Math.max(1, Math.floor(width));
  var hi = Math.max(1, Math.floor(height));
  if (xi >= cw || yi >= ch) return false;
  if (xi + wi > cw) wi = cw - xi;
  if (yi + hi > ch) hi = ch - yi;
  var th = threshold != null ? threshold : OPTIK_SABLON.luminanceThreshold;
  var imgData = ctx.getImageData(xi, yi, wi, hi);
  var d = imgData.data;
  var sum = 0;
  var n = 0;
  for (var i = 0; i < d.length; i += 4) {
    var r = d[i];
    var g = d[i + 1];
    var b = d[i + 2];
    sum += 0.299 * r + 0.587 * g + 0.114 * b;
    n++;
  }
  var avg = n ? sum / n : 255;
  return avg < th;
}

function optikScaleRectToNatural(rect, refW, refH, natW, natH) {
  var sx = natW / refW;
  var sy = natH / refH;
  return {
    x: Math.floor(rect.x * sx),
    y: Math.floor(rect.y * sy),
    w: Math.max(1, Math.floor(rect.w * sx)),
    h: Math.max(1, Math.floor(rect.h * sy)),
  };
}

function optikYieldFrame() {
  return new Promise(function (resolve) {
    requestAnimationFrame(function () {
      resolve();
    });
  });
}

/**
 * Kalibrasyon: okunan bölgeleri kırmızı çerçeve ile önizleme üzerine çizer.
 * @param {HTMLCanvasElement} debugCanvas
 * @param {HTMLImageElement} imgEl
 * @param {number} natW
 * @param {number} natH
 * @param {Array<{ rect: {x:number,y:number,w:number,h:number}, marked: boolean }>} debugRects
 */
function drawDebugCalibrationOverlay(debugCanvas, imgEl, natW, natH, debugRects) {
  if (!debugCanvas || !imgEl) return;
  var dw = imgEl.clientWidth;
  var dh = imgEl.clientHeight;
  if (dw < 2 || dh < 2) return;
  debugCanvas.width = dw;
  debugCanvas.height = dh;
  debugCanvas.style.width = dw + "px";
  debugCanvas.style.height = dh + "px";
  var ctx = debugCanvas.getContext("2d");
  if (!ctx) return;
  ctx.clearRect(0, 0, dw, dh);
  var sx = dw / natW;
  var sy = dh / natH;
  (debugRects || []).forEach(function (item) {
    var r = item.rect;
    var x = r.x * sx;
    var y = r.y * sy;
    var w = r.w * sx;
    var h = r.h * sy;
    ctx.strokeStyle = item.marked ? "rgba(220, 38, 38, 0.98)" : "rgba(248, 113, 113, 0.65)";
    ctx.lineWidth = item.marked ? 1.75 : 1;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(0, w - 1), Math.max(0, h - 1));
  });
  debugCanvas.classList.remove("hidden");
  debugCanvas.style.display = "block";
}

/**
 * Gerçek piksel OMR: görüntü tam çözünürlükte canvas’a alınır, OPTIK_SABLON ile taranır.
 * @param {HTMLImageElement} imageElement
 * @param {{ overlayEl?: HTMLElement, debugCanvas?: HTMLCanvasElement, questionCount?: number, scanlineMs?: number }} [options]
 */
export async function scanRealOptikImage(imageElement, options) {
  options = options || {};
  var natW = imageElement.naturalWidth || imageElement.width;
  var natH = imageElement.naturalHeight || imageElement.height;
  if (!natW || !natH) {
    throw new Error("Görüntü boyutu yok.");
  }

  var work = document.createElement("canvas");
  work.width = natW;
  work.height = natH;
  work.setAttribute("aria-hidden", "true");
  var ctx = work.getContext("2d");
  if (!ctx) throw new Error("Canvas desteklenmiyor.");
  ctx.drawImage(imageElement, 0, 0, natW, natH);

  if (options.overlayEl) {
    options.overlayEl.classList.remove("hidden");
    options.overlayEl.setAttribute("aria-hidden", "false");
  }
  await runScanlineAnimation(options.overlayEl, options.scanlineMs != null ? options.scanlineMs : 1100);
  if (options.overlayEl) {
    options.overlayEl.classList.add("hidden");
    options.overlayEl.setAttribute("aria-hidden", "true");
  }

  var ref = OPTIK_SABLON.referenceSize;
  var th = OPTIK_SABLON.luminanceThreshold;
  /** @type {Array<{ rect: {x:number,y:number,w:number,h:number}, marked: boolean }>} */
  var debugRects = [];

  function sc(rect) {
    return optikScaleRectToNatural(rect, ref.w, ref.h, natW, natH);
  }

  /** Öğrenci numarası */
  var noDigits = [];
  for (var ci = 0; ci < OPTIK_SABLON.studentNumberColumns.length; ci++) {
    await optikYieldFrame();
    var col = OPTIK_SABLON.studentNumberColumns[ci];
    var markedDigits = [];
    for (var di = 0; di < col.bubbles.length; di++) {
      var dr = sc(col.bubbles[di]);
      var filled = analyzeBubble(ctx, dr.x, dr.y, dr.w, dr.h, th);
      debugRects.push({ rect: dr, marked: filled });
      if (filled) markedDigits.push(di);
    }
    if (markedDigits.length === 0) noDigits.push("0");
    else if (markedDigits.length === 1) noDigits.push(String(markedDigits[0]));
    else noDigits.push("0");
  }
  var studentNo = noDigits.join("").slice(0, 5);

  /** Kitapçık */
  await optikYieldFrame();
  var bkLabels = ["A", "B", "C", "D"];
  var bkMarked = [];
  for (var bi = 0; bi < bkLabels.length; bi++) {
    var L = bkLabels[bi];
    var br = sc(OPTIK_SABLON.bookletType[L]);
    var bf = analyzeBubble(ctx, br.x, br.y, br.w, br.h, th);
    debugRects.push({ rect: br, marked: bf });
    if (bf) bkMarked.push(L);
  }
  var bookletLabel =
    bkMarked.length === 1 ? bkMarked[0] : bkMarked.length > 1 ? "?" : "—";

  /** Sorular */
  var maxQ = Math.min(
    options.questionCount != null ? options.questionCount : OPTIK_SABLON.questions.length,
    OPTIK_SABLON.questions.length
  );
  var answerChars = [];
  var letters = ["A", "B", "C", "D", "E"];
  for (var qi = 0; qi < maxQ; qi++) {
    if (qi % 4 === 0) await optikYieldFrame();
    var qdef = OPTIK_SABLON.questions[qi];
    var markedChoices = [];
    for (var li = 0; li < letters.length; li++) {
      var ch = letters[li];
      var cr = sc(qdef.choices[ch]);
      var cf = analyzeBubble(ctx, cr.x, cr.y, cr.w, cr.h, th);
      debugRects.push({ rect: cr, marked: cf });
      if (cf) markedChoices.push(ch);
    }
    if (markedChoices.length === 0) answerChars.push("Z");
    else if (markedChoices.length === 1) answerChars.push(markedChoices[0]);
    else answerChars.push("X");
  }

  var answersString = answerChars.join("");
  var needPad = options.matrixQuestionCount != null ? options.matrixQuestionCount : 0;
  while (answersString.length < needPad) {
    answersString += "Z";
  }

  var name = "KITAPCIK " + bookletLabel + " · PIXEL-OMR";

  var rawLine = buildOptikFixedRecord(studentNo, name, answersString);

  if (options.debugCanvas && imageElement) {
    drawDebugCalibrationOverlay(options.debugCanvas, imageElement, natW, natH, debugRects);
  }

  return {
    id: "omr-" + Date.now(),
    studentNo: studentNo,
    name: name,
    answersString: answersString,
    rawLine: rawLine,
    source: "pixel_omr",
    bookletType: bookletLabel,
  };
}

const DNM_RECORD = "coach_exam_plan";

/** @type {Array<{ id: string, plan: object }>} */
var cachedPlans = [];
/** @type {Array<{ id: string, name: string }>} */
var cachedStudentList = [];
/** @type {Array<object>} */
var parsedStudents = [];
/** @type {string | null} */
var selectedStudentId = null;
/** @type {object | null} */
var selectedPlan = null;
/** @type {string | null} */
var optikPreviewObjectUrl = null;

function getCoachId() {
  try {
    var imp = sessionStorage.getItem("superAdminViewAsCoach");
    if (imp && String(imp).trim()) return String(imp).trim();
  } catch (e) {}
  var cu = (localStorage.getItem("currentUser") || "").trim();
  if (cu) return cu;
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
  } catch (e2) {}
  return "";
}

function resolveInstitutionId(profile) {
  try {
    var imp = (sessionStorage.getItem("superAdminViewAsCoachInstitutionId") || "").trim();
    if (imp) return imp;
  } catch (e) {}
  if (profile && profile.institutionId != null && String(profile.institutionId).trim()) {
    return String(profile.institutionId).trim();
  }
  return "";
}

function dnmIsCoachPlan(x) {
  return x && (x.recordType === DNM_RECORD || x.isCoachExamPlan === true);
}

function dnmExamDateToIso(data) {
  var d = data && data.date;
  if (!d) return "";
  if (typeof d === "string" && d.length >= 10) return d.slice(0, 10);
  if (d && typeof d.toDate === "function") {
    try {
      return d.toDate().toISOString().slice(0, 10);
    } catch (e) {}
  }
  return "";
}

async function fetchCoachPlans(coachId) {
  if (!coachId) return [];
  function collectFromSnap(snap, bucket) {
    snap.forEach(function (d) {
      var x = typeof d.data === "function" ? d.data() : {};
      var row = Object.assign({ id: d.id }, x);
      if (String(row.coach_id || "") !== String(coachId)) return;
      if (!dnmIsCoachPlan(row)) return;
      bucket.push(row);
    });
  }
  var out = [];
  var snapEq = await getDocs(query(collection(db, "exams"), where("coach_id", "==", coachId)));
  collectFromSnap(snapEq, out);
  if (out.length === 0) {
    var snapAll = await getDocs(collection(db, "exams"));
    collectFromSnap(snapAll, out);
  }
  out.sort(function (a, b) {
    var da = dnmExamDateToIso(a) || "";
    var db = dnmExamDateToIso(b) || "";
    return db.localeCompare(da);
  });
  return out;
}

async function fetchStudentsForCoach(coachId) {
  if (!coachId) return [];
  var snap = await getDocs(query(collection(db, "students"), where("coach_id", "==", coachId)));
  var out = [];
  snap.forEach(function (d) {
    var x = typeof d.data === "function" ? d.data() : {};
    out.push({
      id: d.id,
      name: String(x.name || x.studentName || "Öğrenci").trim(),
    });
  });
  out.sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name), "tr");
  });
  return out;
}

function normalizeAnswerLetter(ch) {
  var c = String(ch != null ? ch : "A").trim().toUpperCase().charAt(0);
  return "ABCDE".indexOf(c) !== -1 ? c : "A";
}

function parseMatrixRaw(planRow) {
  var rawMx = planRow && (planRow.answerKeyMatrix || planRow.answer_key_matrix);
  if (typeof rawMx === "string") {
    try {
      rawMx = JSON.parse(rawMx || "[]");
    } catch (e) {
      rawMx = [];
    }
  }
  if (!Array.isArray(rawMx) || !rawMx.length) return [];
  return rawMx.map(function (x, idx) {
    return {
      questionNo: x.questionNo != null ? Number(x.questionNo) : idx + 1,
      ders: String(x.ders || x.subject || "").trim(),
      konu: String(x.konu || x.topic || "").trim(),
      answer: normalizeAnswerLetter(x.answer != null ? x.answer : x.correct),
    };
  });
}

/**
 * Klasik satır: 5 (no) + 25 (isim) + 5 ayırıcı → şıklar 36. karakterden (indeks 35+).
 * Eski dosyalar: kısa satırlarda 5 + 20 + şıklar (25. indeksten) geriye dönük okunur.
 * @param {string} text
 */
export function parseOptikFile(text) {
  var lines = String(text || "")
    .split(/\r?\n/)
    .map(function (l) {
      return l.trim();
    })
    .filter(Boolean);
  return lines.map(function (line, idx) {
    var studentNo = line.slice(0, 5).trim();
    var name;
    var answersRaw;
    if (line.length >= 36) {
      name = line.slice(5, 30).trim();
      answersRaw = line.slice(35);
    } else {
      name = line.slice(5, 25).trim();
      answersRaw = line.slice(25);
    }
    var answers = answersRaw.toUpperCase().replace(/[^ABCDEXZ]/g, "");
    return {
      id: "optik-" + idx + "-" + studentNo,
      studentNo: studentNo,
      name: name || "Öğrenci " + (idx + 1),
      answersString: answers,
      rawLine: line,
    };
  });
}

function branchIdFromDers(dersLabel, examMode) {
  var s = String(dersLabel || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
  var mode = String(examMode || "TYT").toUpperCase();
  if (mode === "AYT") {
    if (/mat|sayi|geometri/.test(s)) return "matematik";
    if (/fizik|kimya|biyo|fen/.test(s)) return "fen";
    if (/edeb|turk|turkce|turk dili/.test(s)) return "turkce";
    if (/tarih|cograf|felse|din|sosyal/.test(s)) return "sosyal";
    if (/dil|ing|alm|fran/.test(s)) return "dil";
    return "genel";
  }
  if (/turk|turkce|turk dili|sozel mantik|paragraf/.test(s)) return "turkce";
  if (/mat|geometri|sayi/.test(s)) return "matematik";
  if (/fizik|kimya|biyo|fen/.test(s)) return "fen";
  if (/tarih|cograf|felse|din|sosyal/.test(s)) return "sosyal";
  return "turkce";
}

function buildQuestionRows(matrix, answersStr) {
  var sorted = matrix.slice().sort(function (a, b) {
    return (a.questionNo || 0) - (b.questionNo || 0);
  });
  var rows = [];
  for (var i = 0; i < sorted.length; i++) {
    var m = sorted[i];
    var qn = Number(m.questionNo) || i + 1;
    var idx = qn - 1;
    var raw = "";
    if (idx >= 0 && idx < answersStr.length) raw = answersStr.charAt(idx).toUpperCase();
    var st = raw;
    if (raw === "Z") st = "—";
    else if (raw === "X") st = "Çift";
    else if ("ABCDE".indexOf(raw) === -1) st = "—";
    var correct = m.answer;
    var ok = st !== "—" && st !== "Çift" && st === correct;
    rows.push({
      questionNo: qn,
      ders: m.ders || "—",
      konu: m.konu || "—",
      student: st,
      correct: correct,
      ok: ok,
    });
  }
  return rows;
}

function aggregateRows(questionRows, examMode) {
  var acc = {};
  var correct = 0;
  var wrong = 0;
  var empty = 0;
  questionRows.forEach(function (r) {
    var bid = branchIdFromDers(r.ders, examMode);
    if (!acc[bid]) acc[bid] = { soru: 0, d: 0, y: 0, b: 0 };
    acc[bid].soru++;
    if (r.student === "—") {
      acc[bid].b++;
      empty++;
    } else if (r.student === "Çift") {
      acc[bid].y++;
      wrong++;
    } else if (r.ok) {
      acc[bid].d++;
      correct++;
    } else {
      acc[bid].y++;
      wrong++;
    }
  });
  var totalNet = 0;
  Object.keys(acc).forEach(function (k) {
    var g = acc[k];
    totalNet += netFromDyWithRule(g.d, g.y, "osym");
  });
  totalNet = Math.round(totalNet * 1000) / 1000;
  return { rows: acc, computed: { totalNet: totalNet, correctCount: correct, wrongCount: wrong, emptyCount: empty } };
}

function studentAnswersMap(questionRows) {
  var o = {};
  questionRows.forEach(function (r) {
    if (r.student === "—") o[String(r.questionNo)] = "";
    else if (r.student === "Çift") o[String(r.questionNo)] = "X";
    else o[String(r.questionNo)] = r.student;
  });
  return o;
}

function matchStudentDoc(parsed) {
  var key = String(parsed.studentNo || "").replace(/^0+/, "");
  var nameNorm = String(parsed.name || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
  for (var i = 0; i < cachedStudentList.length; i++) {
    var s = cachedStudentList[i];
    var nid = String(s.id || "").replace(/^0+/, "");
    if (key && nid && key === nid) return s.id;
    var nm = String(s.name || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
    if (nameNorm && nm && nm === nameNorm) return s.id;
  }
  return "";
}

function buildDetailJson(plan, questionRows, parsed, studentDocId) {
  var examMode = String(plan.type || plan.examType || plan.tur || "TYT").toUpperCase();
  var agg = aggregateRows(questionRows, examMode);
  var sa = studentAnswersMap(questionRows);
  var compactQ = questionRows.map(function (r) {
    return {
      q: r.questionNo,
      s: r.student,
      c: r.correct,
      k: r.ok ? 1 : r.student === "—" ? 2 : r.student === "Çift" ? 3 : 0,
    };
  });
  return {
    examMode: examMode,
    examSource: "optik_okuma",
    aytAlan: plan.aytAlan || plan.ayt_alan || "",
    computed: agg.computed,
    rows: agg.rows,
    studentAnswers: sa,
    perQuestionCompact: compactQ,
    optikMeta: {
      studentNo: parsed.studentNo,
      displayName: parsed.name,
      matchedStudentId: studentDocId || null,
      planId: plan.id,
      planName: plan.examName || plan.exam_name || "Deneme",
    },
  };
}

function shrinkDetailForAppwrite(detail) {
  var copy = JSON.parse(JSON.stringify(detail));
  function asString() {
    return JSON.stringify(copy);
  }
  var j = asString();
  if (j.length <= 4900) return j;
  delete copy.perQuestionCompact;
  j = asString();
  if (j.length <= 4900) return j;
  copy.studentAnswers = {};
  copy.note = "truncated_for_appwrite_5000";
  j = asString();
  if (j.length <= 4900) return j;
  copy.rows = {};
  j = asString();
  if (j.length <= 4900) return j;
  copy.optikMeta = { planId: copy.optikMeta && copy.optikMeta.planId, note: "minimal_payload" };
  return asString();
}

function showToast(message, kind) {
  var host = document.getElementById("optikToastHost");
  if (!host) return;
  var el = document.createElement("div");
  el.className =
    "pointer-events-auto rounded-xl px-4 py-3 text-sm font-semibold shadow-lg max-w-sm animate-[fadeIn_.2s_ease-out] " +
    (kind === "err"
      ? "bg-red-600 text-white"
      : kind === "ok"
        ? "bg-emerald-600 text-white"
        : "bg-slate-800 text-white");
  el.textContent = message;
  host.appendChild(el);
  setTimeout(function () {
    el.style.opacity = "0";
    el.style.transition = "opacity .3s";
    setTimeout(function () {
      try {
        el.remove();
      } catch (e) {}
    }, 320);
  }, 4200);
}

// ——— Kalibrasyon stüdyosu (interaktif ızgara + JSON) ———

/** @type {{ sectionLabel: string, refW: number, refH: number, firstQX: number, firstQY: number, gapX: number, gapY: number, boxW: number, boxH: number, questionCount: number }} */
var __calibState = {
  sectionLabel: "TYT Türkçe",
  refW: 620,
  refH: 880,
  firstQX: 302,
  firstQY: 318,
  gapX: 22,
  gapY: 14,
  boxW: 16,
  boxH: 12,
  questionCount: 40,
};

/** @type {HTMLImageElement | null} */
var __calibImage = null;
var __calibModalOpen = false;
var __calibRafPending = false;

function __calibReadInputs() {
  function num(id) {
    var el = document.getElementById(id);
    var v = el && el.value;
    var n = parseFloat(v);
    return isNaN(n) ? 0 : n;
  }
  function int(id) {
    return Math.round(num(id));
  }
  if (__calibImage && __calibImage.naturalWidth) {
    __calibState.refW = __calibImage.naturalWidth;
    __calibState.refH = __calibImage.naturalHeight;
  }
  var lbl = document.getElementById("calibSectionLabel");
  __calibState.sectionLabel = (lbl && lbl.value) || "TYT Türkçe";
  __calibState.firstQX = int("calibFirstQX");
  __calibState.firstQY = int("calibFirstQY");
  __calibState.gapX = int("calibGapX");
  __calibState.gapY = int("calibGapY");
  __calibState.boxW = Math.max(1, int("calibBoxW"));
  __calibState.boxH = Math.max(1, int("calibBoxH"));
  __calibState.questionCount = Math.max(1, Math.min(200, int("calibQuestionCount")));
}

function __calibWriteInputsFromState() {
  function setv(id, v) {
    var el = document.getElementById(id);
    if (el) el.value = String(v);
  }
  var elRef = document.getElementById("calibRefSizeLabel");
  if (elRef) {
    elRef.textContent = __calibState.refW + " × " + __calibState.refH + " px (görüntü)";
  }
  setv("calibSectionLabel", __calibState.sectionLabel);
  setv("calibFirstQX", __calibState.firstQX);
  setv("calibFirstQY", __calibState.firstQY);
  setv("calibGapX", __calibState.gapX);
  setv("calibGapY", __calibState.gapY);
  setv("calibBoxW", __calibState.boxW);
  setv("calibBoxH", __calibState.boxH);
  setv("calibQuestionCount", __calibState.questionCount);
  var pairs = [
    ["calibFirstQXRange", "calibFirstQX"],
    ["calibFirstQYRange", "calibFirstQY"],
    ["calibGapXRange", "calibGapX"],
    ["calibGapYRange", "calibGapY"],
    ["calibBoxWRange", "calibBoxW"],
    ["calibBoxHRange", "calibBoxH"],
  ];
  for (var i = 0; i < pairs.length; i++) {
    var r = document.getElementById(pairs[i][0]);
    var n = document.getElementById(pairs[i][1]);
    if (r && n) r.value = n.value;
  }
}

function __calibComputeContain(canvasCssW, canvasCssH, iw, ih) {
  var scale = Math.min(canvasCssW / iw, canvasCssH / ih);
  var dw = iw * scale;
  var dh = ih * scale;
  var ox = (canvasCssW - dw) / 2;
  var oy = (canvasCssH - dh) / 2;
  return { ox: ox, oy: oy, dw: dw, dh: dh };
}

function __calibDrawFrame() {
  __calibRafPending = false;
  if (!__calibModalOpen || !__calibImage || !__calibImage.naturalWidth) return;

  var canvas = document.getElementById("optikCalibCanvas");
  if (!canvas) return;
  var wrap = document.getElementById("optikCalibCanvasWrap") || canvas.parentElement;
  if (!wrap) return;

  __calibReadInputs();

  var cssW = Math.max(320, wrap.clientWidth - 16);
  var cssH = Math.max(240, wrap.clientHeight - 16);
  var dpr = typeof window.devicePixelRatio === "number" ? window.devicePixelRatio : 1;

  canvas.style.width = cssW + "px";
  canvas.style.height = cssH + "px";
  canvas.width = Math.floor(cssW * dpr);
  canvas.height = Math.floor(cssH * dpr);

  var ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.scale(dpr, dpr);
  ctx.fillStyle = "#0f172a";
  ctx.fillRect(0, 0, cssW, cssH);

  var nw = __calibImage.naturalWidth;
  var nh = __calibImage.naturalHeight;
  var fit = __calibComputeContain(cssW, cssH, nw, nh);
  ctx.drawImage(__calibImage, fit.ox, fit.oy, fit.dw, fit.dh);

  var refW = __calibState.refW;
  var refH = __calibState.refH;
  var sx = fit.dw / refW;
  var sy = fit.dh / refH;

  var letters = ["A", "B", "C", "D", "E"];
  var nq = Math.min(200, __calibState.questionCount);
  ctx.lineWidth = 1;
  for (var q = 0; q < nq; q++) {
    var yy = __calibState.firstQY + q * __calibState.gapY;
    for (var li = 0; li < letters.length; li++) {
      var lx = __calibState.firstQX + li * __calibState.gapX;
      var cx = fit.ox + lx * sx;
      var cy = fit.oy + yy * sy;
      var cw = __calibState.boxW * sx;
      var ch = __calibState.boxH * sy;
      ctx.strokeStyle = "rgba(239, 68, 68, 0.92)";
      ctx.strokeRect(Math.round(cx) + 0.5, Math.round(cy) + 0.5, Math.max(0, cw - 1), Math.max(0, ch - 1));
    }
  }
}

function __calibRequestRedraw() {
  if (!__calibModalOpen) return;
  if (__calibRafPending) return;
  __calibRafPending = true;
  requestAnimationFrame(__calibDrawFrame);
}

function __calibBuildExportPayload() {
  __calibReadInputs();
  var questions = buildQuestionsFromGridParams({
    firstQX: __calibState.firstQX,
    firstQY: __calibState.firstQY,
    gapX: __calibState.gapX,
    gapY: __calibState.gapY,
    boxW: __calibState.boxW,
    boxH: __calibState.boxH,
    questionCount: __calibState.questionCount,
  });
  return {
    meta: {
      note: "Kalibrasyon stüdyosu — OPTIK_SABLON ile birleştirin",
      sectionLabel: __calibState.sectionLabel,
      exportedAt: new Date().toISOString(),
    },
    referenceSize: { w: __calibState.refW, h: __calibState.refH },
    luminanceThreshold: OPTIK_SABLON.luminanceThreshold,
    questionGridParams: {
      sectionLabel: __calibState.sectionLabel,
      firstQuestionX: __calibState.firstQX,
      firstQuestionY: __calibState.firstQY,
      choiceGapX: __calibState.gapX,
      rowGapY: __calibState.gapY,
      boxWidth: __calibState.boxW,
      boxHeight: __calibState.boxH,
      questionCount: __calibState.questionCount,
    },
    questions: questions,
    _readme:
      "optik-okuma.js içinde: referenceSize ve questions alanlarını bu nesneyle güncelleyin veya kopyalama sonrası sayfa «Bu oturuma uygula» ile canlı günceller.",
  };
}

function __calibOpenModal() {
  var prev = document.getElementById("optikPreviewImg");
  if (!prev || !prev.naturalWidth || !prev.naturalHeight) {
    showToast("Önce görsel sekmesinden bir optik görüntüsü yükleyin.", "err");
    return;
  }
  __calibImage = prev;
  var nw = prev.naturalWidth;
  var nh = prev.naturalHeight;
  var oldR = OPTIK_SABLON.referenceSize;
  var scaleX = nw / (oldR.w || 1);
  var scaleY = nh / (oldR.h || 1);
  var q0 = OPTIK_SABLON.questions[0];
  var q1 = OPTIK_SABLON.questions[1];
  if (q0 && q0.choices && q0.choices.A) {
    var a0 = q0.choices.A;
    __calibState.firstQX = Math.round(a0.x * scaleX);
    __calibState.firstQY = Math.round(a0.y * scaleY);
    if (q0.choices.B) __calibState.gapX = Math.round((q0.choices.B.x - a0.x) * scaleX);
    if (q1 && q1.choices && q1.choices.A) {
      __calibState.gapY = Math.round((q1.choices.A.y - a0.y) * scaleY);
    }
    __calibState.boxW = Math.max(1, Math.round(a0.w * scaleX));
    __calibState.boxH = Math.max(1, Math.round(a0.h * scaleY));
  }
  __calibState.refW = nw;
  __calibState.refH = nh;
  __calibState.questionCount = Math.min(200, Math.max(1, OPTIK_SABLON.questions.length));
  __calibWriteInputsFromState();

  var mPos = Math.max(nw, nh, 1600);
  var rQx = document.getElementById("calibFirstQXRange");
  var rQy = document.getElementById("calibFirstQYRange");
  if (rQx) {
    rQx.max = String(mPos);
    rQx.min = "0";
  }
  if (rQy) {
    rQy.max = String(mPos);
    rQy.min = "0";
  }
  ["calibFirstQX", "calibFirstQY"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) {
      el.max = String(mPos);
      el.min = "0";
    }
  });

  var modal = document.getElementById("optikCalibModal");
  if (modal) {
    modal.classList.remove("hidden");
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
  }
  __calibModalOpen = true;
  __calibRequestRedraw();
}

function __calibCloseModal() {
  var modal = document.getElementById("optikCalibModal");
  if (modal) {
    modal.classList.add("hidden");
    modal.setAttribute("aria-hidden", "true");
  }
  document.body.style.overflow = "";
  __calibModalOpen = false;
  __calibImage = null;
}

function wireOptikCalibrationModal() {
  var openBtn = document.getElementById("optikOpenCalibBtn");
  var modal = document.getElementById("optikCalibModal");
  if (!openBtn || !modal) return;

  openBtn.addEventListener("click", function () {
    __calibOpenModal();
  });
  modal.querySelectorAll("[data-calib-close]").forEach(function (el) {
    el.addEventListener("click", function () {
      __calibCloseModal();
    });
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && __calibModalOpen) __calibCloseModal();
  });
  window.addEventListener("resize", function () {
    if (__calibModalOpen) __calibRequestRedraw();
  });

  var sliderFields = [
    ["calibFirstQXRange", "calibFirstQX"],
    ["calibFirstQYRange", "calibFirstQY"],
    ["calibGapXRange", "calibGapX"],
    ["calibGapYRange", "calibGapY"],
    ["calibBoxWRange", "calibBoxW"],
    ["calibBoxHRange", "calibBoxH"],
  ];
  sliderFields.forEach(function (pair) {
    var r = document.getElementById(pair[0]);
    var n = document.getElementById(pair[1]);
    if (!r || !n) return;
    r.addEventListener("input", function () {
      n.value = r.value;
      __calibRequestRedraw();
    });
    n.addEventListener("input", function () {
      r.value = n.value;
      __calibRequestRedraw();
    });
  });
  ["calibQuestionCount", "calibSectionLabel"].forEach(function (id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("input", __calibRequestRedraw);
  });

  var copyBtn = document.getElementById("calibCopyJsonBtn");
  if (copyBtn) {
    copyBtn.addEventListener("click", function () {
      var payload = __calibBuildExportPayload();
      var text = JSON.stringify(payload, null, 2);
      function onDone() {
        applyCalibratedQuestionsToSablon(payload);
        showToast("Koordinatlar Kopyalandı", "ok");
      }
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(onDone).catch(function () {
          var ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          try {
            document.execCommand("copy");
            onDone();
          } catch (e2) {
            showToast("Panoya kopyalanamadı.", "err");
          }
          document.body.removeChild(ta);
        });
      } else {
        var ta2 = document.createElement("textarea");
        ta2.value = text;
        document.body.appendChild(ta2);
        ta2.select();
        try {
          document.execCommand("copy");
          onDone();
        } catch (e3) {
          showToast("Panoya kopyalanamadı.", "err");
        }
        document.body.removeChild(ta2);
      }
    });
  }
}

function getSelectedPlanRow() {
  var sel = document.getElementById("optikExamSelect");
  var id = sel && sel.value;
  if (!id) return null;
  var hit = cachedPlans.filter(function (x) {
    return x.id === id;
  })[0];
  return hit ? hit.plan : null;
}

function renderExamSelect() {
  var sel = document.getElementById("optikExamSelect");
  if (!sel) return;
  sel.innerHTML = "";
  if (!cachedPlans.length) {
    var o = document.createElement("option");
    o.value = "";
    o.textContent = "Kayıtlı deneme planı yok";
    sel.appendChild(o);
    return;
  }
  var ph = document.createElement("option");
  ph.value = "";
  ph.textContent = "Deneme seçin…";
  sel.appendChild(ph);
  cachedPlans.forEach(function (x) {
    var p = x.plan;
    var label = (p.examName || p.exam_name || "Deneme") + " · " + (dnmExamDateToIso(p) || "—");
    var o = document.createElement("option");
    o.value = x.id;
    o.textContent = label;
    sel.appendChild(o);
  });
}

function renderStudentStrip() {
  var sec = document.getElementById("optikStudentSection");
  var strip = document.getElementById("optikStudentStrip");
  var cnt = document.getElementById("optikStudentCount");
  if (!sec || !strip) return;
  if (!parsedStudents.length) {
    sec.classList.add("hidden");
    return;
  }
  sec.classList.remove("hidden");
  if (cnt) cnt.textContent = parsedStudents.length + " öğrenci";
  strip.innerHTML = "";
  parsedStudents.forEach(function (stu) {
    var btn = document.createElement("button");
    btn.type = "button";
    btn.setAttribute("role", "tab");
    btn.setAttribute("data-student-id", stu.id);
    btn.className =
      "flex-shrink-0 rounded-xl border px-4 py-3 text-left min-w-[160px] transition-all " +
      (selectedStudentId === stu.id
        ? "border-indigo-500 bg-indigo-50 shadow-md ring-2 ring-indigo-200"
        : "border-slate-200 bg-white hover:border-indigo-200 hover:bg-slate-50");
    var match = matchStudentDoc(stu);
    btn.innerHTML =
      '<div class="text-xs font-bold text-slate-400 tracking-wide">No: ' +
      escapeHtml(stu.studentNo || "—") +
      "</div>" +
      '<div class="text-sm font-extrabold text-slate-900 mt-0.5 truncate max-w-[200px]" title="' +
      escapeHtml(stu.name) +
      '">' +
      escapeHtml(stu.name) +
      "</div>" +
      (match
        ? '<div class="text-[10px] font-bold text-emerald-600 mt-1"><i class="fa-solid fa-link"></i> Eşleşti</div>'
        : '<div class="text-[10px] font-bold text-amber-600 mt-1">Eşleşme yok</div>');
    btn.addEventListener("click", function () {
      selectedStudentId = stu.id;
      renderStudentStrip();
      renderResultTable();
    });
    strip.appendChild(btn);
  });
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderResultTable() {
  var sec = document.getElementById("optikTableSection");
  var tbody = document.getElementById("optikResultBody");
  var title = document.getElementById("optikTableTitle");
  var meta = document.getElementById("optikTableMeta");
  var emptyEl = document.getElementById("optikTableEmpty");
  if (!sec || !tbody) return;
  var plan = getSelectedPlanRow();
  var matrix = plan ? parseMatrixRaw(plan) : [];
  var stu = parsedStudents.filter(function (x) {
    return x.id === selectedStudentId;
  })[0];
  if (!stu) {
    sec.classList.add("hidden");
    return;
  }
  sec.classList.remove("hidden");
  if (!matrix.length) {
    tbody.innerHTML = "";
    if (title) title.textContent = stu.name + " — detay";
    if (meta) meta.textContent = "";
    if (emptyEl) {
      emptyEl.textContent = "Seçilen denemede cevap matrisi yok. «Cevap anahtarı ve matris düzenle» ile ekleyin.";
      emptyEl.classList.remove("hidden");
    }
    return;
  }
  if (emptyEl) emptyEl.classList.add("hidden");
  var qRows = buildQuestionRows(matrix, stu.answersString || "");
  var examMode = String(plan.type || plan.examType || plan.tur || "TYT").toUpperCase();
  var agg = aggregateRows(qRows, examMode);
  if (title) title.textContent = stu.name + " — detay";
  if (meta) {
    meta.textContent =
      "Net: " +
      agg.computed.totalNet +
      " · " +
      agg.computed.correctCount +
      "D " +
      agg.computed.wrongCount +
      "Y " +
      agg.computed.emptyCount +
      "B";
  }
  tbody.innerHTML = "";
  qRows.forEach(function (r) {
    var tr = document.createElement("tr");
    var ok = r.ok;
    var rowBg = ok
      ? "bg-emerald-50/80"
      : r.student === "—"
        ? "bg-slate-50"
        : r.student === "Çift"
          ? "bg-amber-50/90"
          : "bg-red-50/80";
    tr.className = rowBg + " border-b border-slate-100/90";
    var statusCell =
      ok && r.student !== "—"
        ? '<span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500 text-white text-sm font-black shadow-sm">✓</span>'
        : r.student === "—"
          ? '<span class="text-slate-400 text-xs font-bold">Boş</span>'
          : r.student === "Çift"
            ? '<span class="text-amber-700 text-xs font-extrabold" title="Çift işaret">⚠ Çift</span>'
            : '<span class="inline-flex h-8 w-8 items-center justify-center rounded-full bg-red-500 text-white text-sm font-black shadow-sm">✗</span>';
    var stCell =
      r.student === "Çift"
        ? '<span class="font-extrabold text-amber-800">' + escapeHtml(r.student) + "</span>"
        : !ok && r.student !== "—"
          ? '<span class="font-black text-red-700">' + escapeHtml(r.student) + "</span>"
          : '<span class="font-bold text-slate-800">' + escapeHtml(r.student) + "</span>";
    tr.innerHTML =
      "<td class=\"px-4 py-2.5 font-bold text-slate-700\">" +
      r.questionNo +
      "</td>" +
      "<td class=\"px-4 py-2.5 text-slate-700\">" +
      escapeHtml(r.ders) +
      "</td>" +
      "<td class=\"px-4 py-2.5 text-slate-600 text-xs max-w-[200px]\">" +
      escapeHtml(r.konu) +
      "</td>" +
      "<td class=\"px-4 py-2.5\">" +
      stCell +
      "</td>" +
      "<td class=\"px-4 py-2.5 font-bold text-indigo-700\">" +
      escapeHtml(r.correct) +
      "</td>" +
      "<td class=\"px-4 py-2.5 text-center\">" +
      statusCell +
      "</td>";
    tbody.appendChild(tr);
  });
}

function mergeParsedLineKey(r) {
  if (r && (r.source === "pixel_omr" || (r.id && String(r.id).indexOf("omr-") === 0))) {
    return "id:" + r.id;
  }
  var nk =
    String(r.studentNo || "").trim() +
    "|" +
    String(r.name || "")
      .toLowerCase()
      .trim()
      .replace(/\s+/g, " ");
  return "nm:" + nk;
}

function mergeParsedLines(newRows) {
  var byKey = Object.create(null);
  parsedStudents.forEach(function (r) {
    byKey[mergeParsedLineKey(r)] = r;
  });
  newRows.forEach(function (r) {
    byKey[mergeParsedLineKey(r)] = r;
  });
  parsedStudents = Object.keys(byKey).map(function (k) {
    return byKey[k];
  });
}

function refreshParsedDataViews() {
  var ex = document.getElementById("optikExportBinBtn");
  var exTxt = document.getElementById("optikExportTxtBtn");
  if (ex) ex.disabled = parsedStudents.length === 0;
  if (exTxt) exTxt.disabled = parsedStudents.length === 0;
  if (!parsedStudents.length) selectedStudentId = null;
  else if (!selectedStudentId || !parsedStudents.some(function (s) { return s.id === selectedStudentId; })) {
    selectedStudentId = parsedStudents[0].id;
  }
  renderStudentStrip();
  renderResultTable();
}

function wireUploadTabs() {
  var tBulk = document.getElementById("optikTabBulk");
  var tImg = document.getElementById("optikTabImage");
  var pBulk = document.getElementById("optikPanelBulk");
  var pImg = document.getElementById("optikPanelImage");
  if (!tBulk || !tImg || !pBulk || !pImg) return;

  function activate(which) {
    var bulk = which === "bulk";
    tBulk.classList.toggle("optik-tab-btn--active", bulk);
    tImg.classList.toggle("optik-tab-btn--active", !bulk);
    tBulk.setAttribute("aria-selected", bulk ? "true" : "false");
    tImg.setAttribute("aria-selected", bulk ? "false" : "true");
    pBulk.classList.toggle("hidden", !bulk);
    pImg.classList.toggle("hidden", bulk);
  }

  tBulk.addEventListener("click", function () {
    activate("bulk");
  });
  tImg.addEventListener("click", function () {
    activate("image");
  });
}

function wireImageOmPanel() {
  var zone = document.getElementById("optikImageDropZone");
  var input = document.getElementById("optikImageFileInput");
  var fname = document.getElementById("optikImageFileName");
  var shell = document.getElementById("optikPreviewShell");
  var img = document.getElementById("optikPreviewImg");
  var runBtn = document.getElementById("optikRunScanBtn");
  var hint = document.getElementById("optikOmrHint");
  var overlay = document.getElementById("optikScanOverlay");
  var debugCanvas = document.getElementById("optikDebugOverlayCanvas");
  if (!zone || !input || !img || !runBtn) return;

  function setFileLabel(name) {
    if (fname) fname.textContent = name || "Dosya seçilmedi";
  }

  function loadImageFile(file) {
    if (!file) return;
    var low = (file.name || "").toLowerCase();
    if (!/\.(png|jpe?g)$/.test(low) && !/^image\//.test(file.type || "")) {
      showToast("Yalnızca PNG veya JPG yükleyin.", "err");
      return;
    }
    try {
      if (optikPreviewObjectUrl) URL.revokeObjectURL(optikPreviewObjectUrl);
    } catch (e) {}
    optikPreviewObjectUrl = URL.createObjectURL(file);
    img.onload = function () {
      if (shell) shell.classList.remove("hidden");
      img.classList.remove("hidden");
      runBtn.disabled = false;
      if (hint) hint.textContent = "Taramayı başlatın — piksel parlaklığı ile gerçek OMR.";
      if (debugCanvas) {
        debugCanvas.classList.add("hidden");
        debugCanvas.style.display = "none";
      }
      setFileLabel(file.name);
    };
    img.onerror = function () {
      showToast("Görüntü yüklenemedi.", "err");
      setFileLabel("");
    };
    img.src = optikPreviewObjectUrl;
  }

  zone.addEventListener("click", function () {
    input.click();
  });
  zone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", function () {
    var f = input.files && input.files[0];
    if (f) loadImageFile(f);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add("optik-drop-zone--active");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (ev === "drop") {
        var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadImageFile(f);
      }
      zone.classList.remove("optik-drop-zone--active");
    });
  });

  runBtn.addEventListener("click", function () {
    if (!img.naturalWidth) {
      showToast("Önce görüntü yükleyin.", "err");
      return;
    }
    runBtn.disabled = true;
    var plan = getSelectedPlanRow();
    var matrix = plan ? parseMatrixRaw(plan) : [];
    var qCount = matrix.length || OPTIK_SABLON.questions.length;
    scanRealOptikImage(img, {
      overlayEl: overlay,
      debugCanvas: debugCanvas,
      questionCount: qCount,
      matrixQuestionCount: matrix.length || qCount,
    })
      .then(function (row) {
        mergeParsedLines([row]);
        refreshParsedDataViews();
        var s = document.getElementById("optikFileSummary");
        if (s) s.textContent = parsedStudents.length + " öğrenci (görsel + dosya)";
        showToast("Piksel taraması tamamlandı (kırmızı kutu = okunan alan).", "ok");
      })
      .catch(function (e) {
        console.warn(e);
        showToast("Tarama hatası.", "err");
      })
      .then(function () {
        if (img.naturalWidth) runBtn.disabled = false;
      });
  });
}

function wireDropZone() {
  var zone = document.getElementById("optikDropZone");
  var input = document.getElementById("optikFileInput");
  var summary = document.getElementById("optikFileSummary");
  if (!zone || !input) return;

  function setSummary(text) {
    if (summary) summary.textContent = text;
  }

  function readFiles(fileList) {
    var arr = Array.prototype.slice.call(fileList || [], 0);
    var valid = arr.filter(function (f) {
      var n = (f.name || "").toLowerCase();
      return n.endsWith(".bin") || n.endsWith(".txt") || /text|octet|binary/i.test(f.type || "");
    });
    if (!valid.length) {
      showToast("Yalnızca .bin veya .txt dosyaları.", "err");
      return;
    }
    var pending = valid.length;
    var totalLines = 0;
    valid.forEach(function (file) {
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var text = String(reader.result || "");
          var rows = parseOptikFile(text);
          totalLines += rows.length;
          mergeParsedLines(rows);
        } catch (e) {
          console.warn(e);
          showToast("Dosya okunamadı: " + (file.name || ""), "err");
        }
        pending--;
        if (pending === 0) {
          setSummary(valid.length + " dosya · " + parsedStudents.length + " öğrenci satırı");
          refreshParsedDataViews();
          showToast("Dosyalar işlendi.", "ok");
        }
      };
      reader.onerror = function () {
        pending--;
        showToast("Okuma hatası: " + file.name, "err");
      };
      reader.readAsText(file, "UTF-8");
    });
  }

  zone.addEventListener("click", function () {
    input.click();
  });
  zone.addEventListener("keydown", function (e) {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      input.click();
    }
  });
  input.addEventListener("change", function () {
    readFiles(input.files);
    input.value = "";
  });
  ["dragenter", "dragover"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      zone.classList.add("optik-drop-zone--active");
    });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    zone.addEventListener(ev, function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (ev === "drop") readFiles(e.dataTransfer && e.dataTransfer.files);
      zone.classList.remove("optik-drop-zone--active");
    });
  });
}

export async function saveAllResults() {
  var coachId = getCoachId();
  var plan = getSelectedPlanRow();
  if (!coachId) {
    showToast("Koç oturumu bulunamadı.", "err");
    return;
  }
  if (!plan || !plan.id) {
    showToast("Önce bir deneme seçin.", "err");
    return;
  }
  var matrix = parseMatrixRaw(plan);
  if (!matrix.length) {
    showToast("Bu denemede cevap matrisi yok. Koç panelinden matris ekleyin.", "err");
    return;
  }
  if (!parsedStudents.length) {
    showToast("Kaydedilecek öğrenci yok.", "err");
    return;
  }
  var btn = document.getElementById("optikSaveAllBtn");
  if (btn) {
    btn.disabled = true;
  }
  var okCount = 0;
  var failCount = 0;
  var skippedUnmatched = 0;
  try {
    for (var i = 0; i < parsedStudents.length; i++) {
      var stu = parsedStudents[i];
      var matchedId = matchStudentDoc(stu);
      if (!matchedId) {
        skippedUnmatched++;
        continue;
      }
      var qRows = buildQuestionRows(matrix, stu.answersString || "");
      var detail = buildDetailJson(plan, qRows, stu, matchedId);
      var payload = {
        exam_id: String(plan.id),
        student_id: matchedId,
        exam_name: String(plan.examName || plan.exam_name || "Deneme"),
        detail_json: shrinkDetailForAppwrite(detail),
        saved_at: serverTimestamp(),
        coach_id: coachId,
      };
      var cref = collection(db, APPWRITE_COLLECTION_EXAM_RESULTS);
      var res = await addDoc(cref, payload);
      if (res && res.id && !isAppwriteWriteSoftFailure(res)) okCount++;
      else failCount++;
    }
  } catch (e) {
    console.error(e);
    showToast("Kayıt hatası: " + (e && e.message ? e.message : e), "err");
  } finally {
    if (btn) btn.disabled = false;
  }
  if (okCount === 0 && skippedUnmatched > 0 && failCount === 0) {
    showToast(
      "Kayıt yok: " +
        skippedUnmatched +
        " satır panel öğrenci listesiyle eşleşmedi. Öğrenci numarası veya adı, students kaydıyla birebir aynı olmalıdır.",
      "err"
    );
  } else if (okCount > 0 && skippedUnmatched > 0) {
    showToast(
      okCount +
        " kayıt yazıldı · " +
        skippedUnmatched +
        " eşleşmeyen satır atlandı (yalnızca gerçek öğrenci kaydı eşleşince ExamResults oluşturulur).",
      "err"
    );
  } else if (okCount > 0) {
    showToast(okCount + " kayıt yazıldı." + (failCount ? " · " + failCount + " yazım hatası" : ""), failCount ? "err" : "ok");
  } else if (failCount > 0) {
    showToast("Kayıt başarısız: " + failCount + " satır.", "err");
  } else {
    showToast("Kaydedilecek eşleşen öğrenci yok.", "err");
  }
}

async function init() {
  await getCoachPanelGate();
  var gr = getLastCoachGateResult();
  var profile = gr && gr.profile;
  var impCoach = false;
  try {
    impCoach = !!(sessionStorage.getItem("superAdminViewAsCoach") || "").trim();
  } catch (e) {}

  setCoachDataIsolation({
    coachIdForQueries: getCoachId(),
    institutionIdForQueries: resolveInstitutionId(profile),
    appwriteUserId: gr && gr.compatUser && gr.compatUser.uid ? String(gr.compatUser.uid) : "",
    skipDocumentAcl: impCoach,
  });

  var coachId = getCoachId();
  var hint = document.getElementById("optikCoachHint");
  if (hint) {
    hint.textContent = coachId ? "Koç: " + coachId : "";
    hint.title = coachId;
  }

  cachedStudentList = await fetchStudentsForCoach(coachId);
  try {
    setExamStudentGuard(function (sid) {
      return cachedStudentList.some(function (x) {
        return String(x.id) === String(sid);
      });
    });
  } catch (e) {}

  try {
    var plans = await fetchCoachPlans(coachId);
    cachedPlans = plans.map(function (p) {
      return { id: p.id, plan: p };
    });
  } catch (e) {
    console.warn(e);
    cachedPlans = [];
    showToast("Deneme listesi yüklenemedi.", "err");
  }

  renderExamSelect();

  var sel = document.getElementById("optikExamSelect");
  if (sel) {
    sel.addEventListener("change", function () {
      selectedPlan = getSelectedPlanRow();
      var mh = document.getElementById("optikMatrixHint");
      var mx = selectedPlan ? parseMatrixRaw(selectedPlan) : [];
      if (mh) {
        if (selectedPlan && !mx.length) {
          mh.textContent = "Bu planda matris yok — «Cevap anahtarı ve matris düzenle» ile ekleyin.";
          mh.classList.remove("hidden");
        } else {
          mh.classList.add("hidden");
        }
      }
      renderResultTable();
    });
  }

  var matBtn = document.getElementById("optikOpenMatrixBtn");
  if (matBtn && sel) {
    matBtn.addEventListener("click", function (e) {
      var pid = sel.value;
      if (pid) {
        try {
          sessionStorage.setItem("optikReturnPlanId", pid);
        } catch (e2) {}
      }
    });
  }

  wireUploadTabs();
  wireDropZone();
  wireImageOmPanel();
  wireOptikCalibrationModal();

  var exBtn = document.getElementById("optikExportBinBtn");
  var exTxtBtn = document.getElementById("optikExportTxtBtn");
  if (exBtn) {
    exBtn.addEventListener("click", function () {
      if (!parsedStudents.length) return;
      exportToBin(parsedStudents, { filename: "derecepanel_optik_" + Date.now() });
      showToast(".bin dosyası indirildi.", "ok");
    });
    exBtn.title = "5 + 25 + 5 boşluk + şıklar (36. karakterden cevaplar)";
  }
  if (exTxtBtn) {
    exTxtBtn.addEventListener("click", function () {
      if (!parsedStudents.length) return;
      exportToBin(parsedStudents, {
        filename: "derecepanel_optik_" + Date.now(),
        extension: "txt",
        mime: "text/plain;charset=utf-8",
      });
      showToast(".txt indirildi.", "ok");
    });
  }

  var saveBtn = document.getElementById("optikSaveAllBtn");
  if (saveBtn) {
    saveBtn.addEventListener("click", function () {
      void saveAllResults();
    });
  }

  refreshParsedDataViews();
}

void init();
