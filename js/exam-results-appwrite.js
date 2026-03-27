/**
 * ExamResults (Appwrite `ExamResults`) — alan adları ve create payload.
 * Şema: `setup-appwrite.js` (exam_id, student_id, coach_id?, exam_name?, detail_json, saved_at).
 *
 * Karne V2 trend ekseni: `exam_name` + `saved_at` döküman alanlarından okunur; Exams koleksiyonuna
 * join/etiket zorunluluğu yok. Tam konu tablosu için `detail_json` içinde güncel `topicPerformance` gerekir.
 */
export const EXAM_RESULTS_FIELDS = {
  exam_id: "exam_id",
  student_id: "student_id",
  coach_id: "coach_id",
  exam_name: "exam_name",
  detail_json: "detail_json",
  saved_at: "saved_at",
};

/**
 * @param {object} p
 * @param {string} p.examId
 * @param {string} p.studentId
 * @param {string} [p.examName] — Karne / trend için görünen ad (Appwrite `exam_name`)
 * @param {string} p.detailJson — JSON string (Akıllı Optik `buildExamResultDetail`; topicPerformance dahil)
 * @param {string} [p.coachId]
 * @param {string} [p.savedAt] — ISO datetime (Appwrite `saved_at`); yoksa şimdi — trend tarih etiketi
 * @returns {Record<string, unknown>}
 */
export function buildExamResultCreatePayload(p) {
  var examId = String(p && p.examId != null ? p.examId : "").trim();
  var studentId = String(p && p.studentId != null ? p.studentId : "").trim();
  if (!examId || !studentId) {
    throw new Error("exam_id ve student_id zorunludur.");
  }
  var detail = p.detailJson;
  if (detail == null) detail = "";
  var detailStr = typeof detail === "string" ? detail : JSON.stringify(detail);
  var out = {
    exam_id: examId,
    student_id: studentId,
    exam_name: String(p.examName != null ? p.examName : "").slice(0, 512),
    detail_json: detailStr,
    saved_at: p.savedAt ? String(p.savedAt) : new Date().toISOString(),
  };
  var cid = p.coachId != null ? String(p.coachId).trim() : "";
  if (cid) out.coach_id = cid;
  return out;
}
