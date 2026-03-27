/**
 * Appwrite Exams.answerKey (JSON matris) → optik satırları ve ÖSYM net özeti.
 */
import { smartOptikNormalizeLetter } from "./smart-optik-engine.js";

/**
 * @typedef {{ n: number, lessonId: string, topicId: string, answer: string }} AnswerKeyRow
 */

/**
 * @param {string} raw — Exams.answerKey JSON string
 * @returns {{ rows: AnswerKeyRow[], error?: string }}
 */
export function parseExamAnswerKey(raw) {
  if (raw == null || String(raw).trim() === "") {
    return { rows: [], error: "Cevap anahtarı boş." };
  }
  try {
    var data = JSON.parse(String(raw));
    if (!Array.isArray(data)) {
      return { rows: [], error: "Cevap anahtarı dizi formatında olmalı." };
    }
    /** @type {AnswerKeyRow[]} */
    var rows = [];
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      if (!row || typeof row !== "object") continue;
      var n = parseInt(String(row.n != null ? row.n : i + 1), 10);
      if (isNaN(n) || n < 1) n = i + 1;
      rows.push({
        n: n,
        lessonId: String(row.lessonId != null ? row.lessonId : "").trim(),
        topicId: String(row.topicId != null ? row.topicId : "").trim(),
        answer: String(row.answer != null ? row.answer : "").trim(),
      });
    }
    rows.sort(function (a, b) {
      return a.n - b.n;
    });
    if (!rows.length) {
      return { rows: [], error: "Geçerli soru satırı bulunamadı." };
    }
    return { rows: rows };
  } catch (e) {
    return { rows: [], error: "Cevap anahtarı JSON olarak çözülemedi." };
  }
}

/**
 * @param {AnswerKeyRow[]} rows
 * @param {(string|null)[]} student — index ile satır eşleşir
 * @returns {{ dogru: number, yanlis: number, bos: number, net: number, graded: number }}
 */
export function computeTotalsFromRows(rows, student) {
  var dogru = 0;
  var yanlis = 0;
  var bos = 0;
  var graded = 0;
  var n = rows.length;
  for (var i = 0; i < n; i++) {
    var keyLetter = smartOptikNormalizeLetter(rows[i].answer);
    var st = i < (student || []).length ? student[i] : null;
    if (st == null || st === "") {
      bos++;
      continue;
    }
    if (keyLetter == null) continue;
    graded++;
    if (st === keyLetter) dogru++;
    else yanlis++;
  }
  var net = dogru - yanlis / 4;
  return { dogru: dogru, yanlis: yanlis, bos: bos, net: net, graded: graded };
}

/**
 * Ders bazlı ÖSYM neti (aynı formül).
 * @param {AnswerKeyRow[]} rows
 * @param {(string|null)[]} student
 * @returns {Record<string, { lessonId: string, dogru: number, yanlis: number, bos: number, net: number, graded: number }>}
 */
export function perLessonStats(rows, student) {
  /** @type {Record<string, { lessonId: string, dogru: number, yanlis: number, bos: number, net: number, graded: number }>} */
  var acc = {};
  for (var j = 0; j < rows.length; j++) {
    var lid2 = rows[j].lessonId || "_unknown";
    if (!acc[lid2]) {
      acc[lid2] = { lessonId: lid2, dogru: 0, yanlis: 0, bos: 0, net: 0, graded: 0 };
    }
    var keyLetter = smartOptikNormalizeLetter(rows[j].answer);
    var st = j < (student || []).length ? student[j] : null;
    var bucket = acc[lid2];
    if (!bucket) continue;
    if (st == null || st === "") {
      bucket.bos++;
      continue;
    }
    if (keyLetter == null) continue;
    bucket.graded++;
    if (st === keyLetter) bucket.dogru++;
    else bucket.yanlis++;
  }
  Object.keys(acc).forEach(function (k) {
    var b = acc[k];
    b.net = b.dogru - b.yanlis / 4;
  });
  return acc;
}

/**
 * Yanlış cevaplanan konular (topicId bazlı).
 * @param {AnswerKeyRow[]} rows
 * @param {(string|null)[]} student
 * @param {Record<string, string>} topicNames — topicId → isim
 * @returns {Array<{ topicId: string, topicName: string, wrongQuestions: number[] }>}
 */
export function wrongTopicsFromRows(rows, student, topicNames) {
  topicNames = topicNames || {};
  /** @type {Record<string, number[]>} */
  var map = {};
  for (var i = 0; i < rows.length; i++) {
    var keyLetter = smartOptikNormalizeLetter(rows[i].answer);
    var st = i < (student || []).length ? student[i] : null;
    if (st == null || keyLetter == null) continue;
    if (st === keyLetter) continue;
    var tid = rows[i].topicId || "";
    if (!tid) continue;
    if (!map[tid]) map[tid] = [];
    map[tid].push(rows[i].n);
  }
  return Object.keys(map).map(function (tid) {
    return {
      topicId: tid,
      topicName: topicNames[tid] || tid,
      wrongQuestions: map[tid].slice().sort(function (a, b) {
        return a - b;
      }),
    };
  });
}

/**
 * Konu bazlı D/Y/B ve başarı yüzdesi (karne / heatmap).
 * @param {AnswerKeyRow[]} rows
 * @param {(string|null)[]} student
 * @param {Record<string, string>} lessonNames
 * @param {Record<string, string>} topicNames
 * @returns {Array<{ topicId: string, topicName: string, lessonId: string, lessonName: string, correct: number, wrong: number, empty: number, total: number, successPct: number }>}
 */
export function topicPerformanceFromRows(rows, student, lessonNames, topicNames) {
  lessonNames = lessonNames || {};
  topicNames = topicNames || {};
  /** @type {Record<string, { topicId: string, topicName: string, lessonId: string, lessonName: string, correct: number, wrong: number, empty: number }>} */
  var m = {};
  for (var i = 0; i < rows.length; i++) {
    var tid = String(rows[i].topicId || "").trim();
    if (!tid) continue;
    var keyLetter = smartOptikNormalizeLetter(rows[i].answer);
    if (keyLetter == null) continue;
    var st = i < (student || []).length ? student[i] : null;
    var lid = String(rows[i].lessonId || "").trim();
    if (!m[tid]) {
      m[tid] = {
        topicId: tid,
        topicName: topicNames[tid] || tid,
        lessonId: lid,
        lessonName: (lid && lessonNames[lid]) || lid || "—",
        correct: 0,
        wrong: 0,
        empty: 0,
      };
    }
    if (st == null || st === "") m[tid].empty++;
    else if (st === keyLetter) m[tid].correct++;
    else m[tid].wrong++;
  }
  return Object.keys(m).map(function (k) {
    var x = m[k];
    var t = x.correct + x.wrong + x.empty;
    var pct = t > 0 ? Math.round((x.correct / t) * 1000) / 10 : 0;
    return {
      topicId: x.topicId,
      topicName: x.topicName,
      lessonId: x.lessonId,
      lessonName: x.lessonName,
      correct: x.correct,
      wrong: x.wrong,
      empty: x.empty,
      total: t,
      successPct: pct,
    };
  });
}

/**
 * Karnede kayıt için detaylı JSON gövdesi (stringify edilerek saklanır).
 * @param {object} o
 * @param {string} o.examId
 * @param {string} o.examName
 * @param {AnswerKeyRow[]} o.rows
 * @param {(string|null)[]} o.student
 * @param {Record<string, string>} o.lessonNames
 * @param {Record<string, string>} o.topicNames
 */
export function buildExamResultDetail(o) {
  o = o || {};
  var rows = o.rows || [];
  var student = o.student || [];
  var totals = computeTotalsFromRows(rows, student);
  var perL = perLessonStats(rows, student);
  var lessonNames = o.lessonNames || {};
  var topicNames = o.topicNames || {};
  var perLessonArr = Object.keys(perL).map(function (k) {
    var p = perL[k];
    return {
      lessonId: k,
      lessonName: lessonNames[k] || k,
      dogru: p.dogru,
      yanlis: p.yanlis,
      bos: p.bos,
      net: Math.round(p.net * 1000) / 1000,
      graded: p.graded,
    };
  });
  var wrongTopics = wrongTopicsFromRows(rows, student, topicNames);
  var topicPerformance = topicPerformanceFromRows(rows, student, lessonNames, topicNames);
  return {
    kind: "exam_optik_v2",
    examId: o.examId || "",
    examName: o.examName || "",
    scoringRule: "osym",
    netFormula: "dogru - (yanlis / 4)",
    totals: {
      dogru: totals.dogru,
      yanlis: totals.yanlis,
      bos: totals.bos,
      net: Math.round(totals.net * 1000) / 1000,
      graded: totals.graded,
    },
    perLesson: perLessonArr,
    wrongByTopic: wrongTopics,
    topicPerformance: topicPerformance,
    studentAnswers: student.map(function (x) {
      return x == null ? null : x;
    }),
    savedAt: new Date().toISOString(),
  };
}
