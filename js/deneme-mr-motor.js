/**
 * Deneme MR (Emar) motoru — sınav cevap anahtarı matrisi ile öğrenci cevaplarını karşılaştırır,
 * konu bazlı eksikleri üretir (Akıllı Analiz).
 */
export const MR_CRITICAL_ERROR_RATIO = 0.5;

/**
 * @param {string} ders
 * @returns {string}
 */
export function subjectLabelFromDers(ders) {
  var s = String(ders || "").trim();
  if (!s) return "Genel";
  return s.replace(/^(TYT|AYT|YDT|LGS)\s+/i, "").trim() || s;
}

/**
 * @param {string} ch
 * @returns {boolean}
 */
function isEmptyAnswerChar(ch) {
  var c = String(ch || "").trim().toUpperCase();
  return c === "" || c === "-" || c === "*" || c === "?" || c === "X" || c === "BOS" || c === "BOŞ";
}

/**
 * @param {unknown} letter
 * @returns {string}
 */
function normalizeChoiceLetter(letter) {
  var s = String(letter != null ? letter : "").trim().toUpperCase();
  if (!s) return "";
  var c0 = s.charAt(0);
  if ("ABCDE".indexOf(c0) !== -1) return c0;
  return s.length ? c0 : "";
}

/**
 * Öğrenci cevap haritası: soru numarası → şık (veya boş).
 * @param {unknown} studentAnswers
 * @returns {Record<number, string>}
 */
export function normalizeStudentAnswersMap(studentAnswers) {
  /** @type {Record<number, string>} */
  var out = Object.create(null);
  if (studentAnswers == null) return out;

  if (typeof studentAnswers === "string") {
    var t = studentAnswers.trim();
    if (t.charAt(0) === "{" || t.charAt(0) === "[") {
      try {
        studentAnswers = JSON.parse(t);
      } catch (_e) {
        return out;
      }
    } else if (t.length >= 3 && /^[ABCDEabce\s*\-.,;0-9]+$/i.test(t)) {
      var compact = t.replace(/\s+/g, "").replace(/[^ABCDEabce*\-]/gi, "");
      for (var i = 0; i < compact.length; i++) {
        var ch = compact.charAt(i);
        var u = ch.toUpperCase();
        out[i + 1] = u === "*" || u === "-" ? "" : u;
      }
      return out;
    } else {
      return out;
    }
  }

  if (Array.isArray(studentAnswers)) {
    studentAnswers.forEach(function (p) {
      if (!p || typeof p !== "object") return;
      var q =
        p.questionNo != null
          ? p.questionNo
          : p.q != null
            ? p.q
            : p.n != null
              ? p.n
              : p.soru != null
                ? p.soru
                : p.no;
      var a =
        p.choice != null
          ? p.choice
          : p.answer != null
            ? p.answer
            : p.cevap != null
              ? p.cevap
              : p.shik != null
                ? p.shik
                : p.secilen;
      if (q == null || q === "") return;
      var qn = parseInt(String(q).replace(/^\D+/, "").replace(/\D/g, ""), 10);
      if (isNaN(qn) || qn < 1) return;
      out[qn] = a;
    });
    return out;
  }

  if (typeof studentAnswers === "object") {
    var nested = studentAnswers.answers || studentAnswers.cevaplar || studentAnswers.map;
    if (nested && typeof nested === "object") {
      var sub = normalizeStudentAnswersMap(nested);
      if (Object.keys(sub).length) return sub;
    }
    Object.keys(studentAnswers).forEach(function (k) {
      if (
        k === "computed" ||
        k === "rows" ||
        k === "examMode" ||
        k === "aytAlan" ||
        k === "weakTopics" ||
        k === "bulkImport" ||
        k === "branchNets" ||
        k === "answers" ||
        k === "cevaplar"
      ) {
        return;
      }
      var qn = parseInt(String(k).replace(/\D/g, ""), 10);
      if (!isNaN(qn) && qn >= 1) out[qn] = /** @type {{ [k: string]: unknown }} */ (studentAnswers)[k];
    });
  }
  return out;
}

/**
 * ExamResults.detail_json veya benzeri nesneden soru → şık haritası çıkarır.
 * @param {Record<string, unknown> | null | undefined} detail
 * @returns {Record<number, string>}
 */
export function extractStudentAnswersFromExamDetail(detail) {
  if (!detail || typeof detail !== "object") return {};

  var o = /** @type {Record<string, unknown>} */ (detail);
  var tryKeys = [
    o.studentAnswers,
    o.student_answers,
    o.answers,
    o.perQuestion,
    o.per_question,
    o.questionMap,
    o.question_answers,
    o.soruCevaplari,
    o.soru_cevaplari,
  ];
  for (var i = 0; i < tryKeys.length; i++) {
    var m = normalizeStudentAnswersMap(tryKeys[i]);
    if (Object.keys(m).length) return m;
  }

  var sheet = o.optikSheet || o.optik_sheet || o.answerSheet || o.answer_sheet || o.cevap_dizisi || o.cevaplar_string;
  if (typeof sheet === "string" && sheet.trim()) {
    var fromSheet = normalizeStudentAnswersMap(sheet);
    if (Object.keys(fromSheet).length) return fromSheet;
  }

  if (o.optik && typeof o.optik === "object") {
    var fromOptik = normalizeStudentAnswersMap(o.optik);
    if (Object.keys(fromOptik).length) return fromOptik;
  }

  return {};
}

/**
 * @param {Record<string, unknown>} row
 * @returns {string}
 */
export function topicKeyFromMatrixRow(row) {
  var subj = subjectLabelFromDers(String(row.ders || row.subject || ""));
  var top = String(row.konu || row.topic || "Genel").trim() || "Genel";
  return subj + "\x1f" + top;
}

/**
 * @param {unknown[]} examMatrix
 * @returns {Record<string, number>}
 */
export function buildTopicQuestionCounts(examMatrix) {
  var counts = Object.create(null);
  if (!Array.isArray(examMatrix)) return counts;
  examMatrix.forEach(function (raw, idx) {
    var row = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
    var qn = row.questionNo != null ? Number(row.questionNo) : idx + 1;
    if (isNaN(qn) || qn < 1) return;
    var k = topicKeyFromMatrixRow(row);
    counts[k] = (counts[k] || 0) + 1;
  });
  return counts;
}

/**
 * Matristeki her soru için öğrenci cevabını doğru şıkla karşılaştırır; yanlış/boş kayıtları döner.
 * @param {unknown} studentAnswers — ham nesne / dizi / JSON string
 * @param {unknown[]} examMatrix — { questionNo?, ders?, konu?, answer? | correct? }[]
 * @returns {{ questionNo: number, type: 'wrong'|'empty', subject: string, topic: string, ders: string, expected: string, got: string }[]}
 */
export function analyzeStudentDeficiencies(studentAnswers, examMatrix) {
  var matrix = Array.isArray(examMatrix) ? examMatrix : [];
  /** @type {Record<number, { ders: string, konu: string, correct: string }>} */
  var matrixByQ = Object.create(null);
  matrix.forEach(function (raw, idx) {
    var row = raw && typeof raw === "object" ? /** @type {Record<string, unknown>} */ (raw) : {};
    var q = row.questionNo != null ? Number(row.questionNo) : idx + 1;
    if (isNaN(q) || q < 1) return;
    var correct = normalizeChoiceLetter(row.answer != null ? row.answer : row.correct);
    if (!correct) correct = "A";
    matrixByQ[q] = {
      ders: String(row.ders || row.subject || "").trim(),
      konu: String(row.konu || row.topic || "").trim(),
      correct: correct,
    };
  });

  var answers = normalizeStudentAnswersMap(studentAnswers);
  /** @type {{ questionNo: number, type: 'wrong'|'empty', subject: string, topic: string, ders: string, expected: string, got: string }[]} */
  var out = [];
  var qNums = Object.keys(matrixByQ)
    .map(function (x) {
      return parseInt(x, 10);
    })
    .filter(function (n) {
      return !isNaN(n);
    })
    .sort(function (a, b) {
      return a - b;
    });

  for (var i = 0; i < qNums.length; i++) {
    var qn = qNums[i];
    var m = matrixByQ[qn];
    var rawA = answers[qn];
    var got = rawA != null && rawA !== "" ? normalizeChoiceLetter(rawA) : "";
    if (isEmptyAnswerChar(rawA) || got === "") {
      out.push({
        questionNo: qn,
        type: "empty",
        subject: subjectLabelFromDers(m.ders),
        topic: m.konu || "Genel",
        ders: m.ders,
        expected: m.correct,
        got: "",
      });
      continue;
    }
    if (got !== m.correct) {
      out.push({
        questionNo: qn,
        type: "wrong",
        subject: subjectLabelFromDers(m.ders),
        topic: m.konu || "Genel",
        ders: m.ders,
        expected: m.correct,
        got: got,
      });
    }
  }
  return out;
}

/**
 * @param {{ questionNo: number, type: 'wrong'|'empty', subject: string, topic: string }[]} deficiencyItems
 * @param {unknown[]} examMatrix
 * @returns {{ subject: string, topic: string, wrong_count: number, empty_count: number, error_count: number, critical: boolean, severity_high: boolean, status: string }[]}
 */
export function aggregateTopicDeficiencies(deficiencyItems, examMatrix) {
  var topicQCounts = buildTopicQuestionCounts(examMatrix);
  /** @type {Record<string, { subject: string, topic: string, wrong: number, empty: number }>} */
  var buckets = Object.create(null);

  (deficiencyItems || []).forEach(function (d) {
    var sub = d.subject || "Genel";
    var top = d.topic || "Genel";
    var k = sub + "\x1f" + top;
    if (!buckets[k]) buckets[k] = { subject: sub, topic: top, wrong: 0, empty: 0 };
    if (d.type === "wrong") buckets[k].wrong++;
    else buckets[k].empty++;
  });

  /** @type {{ subject: string, topic: string, wrong_count: number, empty_count: number, error_count: number, critical: boolean, severity_high: boolean, status: string }[]} */
  var rows = [];
  Object.keys(buckets).forEach(function (k) {
    var b = buckets[k];
    var err = b.wrong + b.empty;
    if (err < 1) return;
    var tq = topicQCounts[k] != null ? topicQCounts[k] : err;
    var ratio = tq > 0 ? err / tq : 1;
    var severityHigh = ratio >= MR_CRITICAL_ERROR_RATIO;
    rows.push({
      subject: b.subject,
      topic: b.topic,
      wrong_count: b.wrong,
      empty_count: b.empty,
      error_count: err,
      critical: true,
      severity_high: severityHigh,
      status: "needs_study",
    });
  });

  rows.sort(function (a, b) {
    if (b.error_count !== a.error_count) return b.error_count - a.error_count;
    return String(a.topic).localeCompare(String(b.topic), "tr");
  });
  return rows;
}

/**
 * Appwrite createDocument gövdeleri (her konu bir satır).
 * @param {{ coachId: string, examId: string, studentId: string, examResultId: string, aggregated: ReturnType<typeof aggregateTopicDeficiencies>, analyzedAtIso?: string }} p
 * @returns {Record<string, unknown>[]}
 */
export function buildMrDeficiencyWritePayloads(p) {
  var coachId = String(p.coachId || "").trim();
  var examId = String(p.examId || "").trim();
  var studentId = String(p.studentId || "").trim();
  var examResultId = String(p.examResultId || "").trim();
  var at = p.analyzedAtIso || new Date().toISOString();
  return (p.aggregated || []).map(function (r) {
    return {
      coach_id: coachId,
      student_id: studentId,
      exam_id: examId,
      exam_result_id: examResultId,
      subject: r.subject,
      topic: r.topic,
      error_count: r.error_count,
      wrong_count: r.wrong_count,
      empty_count: r.empty_count,
      status: r.status || "needs_study",
      critical: !!r.critical,
      severity_high: !!r.severity_high,
      analyzed_at: at,
    };
  });
}
