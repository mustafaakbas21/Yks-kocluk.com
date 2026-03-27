/**
 * Akıllı Optik — ÖSYM net motoru (ders bazlı) + Appwrite uyumlu JSON çıktısı.
 * Net (test içi): doğru − (yanlış / 4)
 */

export const SMART_OPTIK_LETTERS = ["A", "B", "C", "D", "E"];

/** TYT: 120 soru */
export const SMART_OPTIK_TYT_SECTIONS = [
  { id: "turkce", label: "Türkçe", questionCount: 40 },
  { id: "sosyal", label: "Sosyal Bilimler", questionCount: 20 },
  { id: "temel_mat", label: "Temel Matematik", questionCount: 40 },
  { id: "fen", label: "Fen Bilimleri", questionCount: 20 },
];

/** AYT: 160 soru */
export const SMART_OPTIK_AYT_SECTIONS = [
  {
    id: "edebiyat_sosyal1",
    label: "Türk Dili ve Edebiyatı / Sosyal Bilimler-1",
    questionCount: 40,
  },
  { id: "sosyal2", label: "Sosyal Bilimler-2", questionCount: 40 },
  { id: "matematik", label: "Matematik", questionCount: 40 },
  { id: "fen", label: "Fen Bilimleri", questionCount: 40 },
];

/**
 * @param {string} ch
 * @returns {string|null} A–E veya null
 */
export function smartOptikNormalizeLetter(ch) {
  if (ch == null || ch === "") return null;
  var u = String(ch).trim().toUpperCase();
  if (u === "." || u === "-" || u === " " || u === "X") return null;
  if (/^[ABCDE]$/.test(u)) return u;
  return null;
}

/**
 * Tek satır anahtar → dizi (uzunluk total veya kısa kalır).
 * @param {string} raw
 * @param {number} total
 * @returns {(string|null)[]}
 */
export function smartOptikParseKeyString(raw, total) {
  var s = String(raw || "").toUpperCase().replace(/\s+/g, "");
  var out = [];
  for (var i = 0; i < total; i++) {
    var c = i < s.length ? s.charAt(i) : "";
    out.push(smartOptikNormalizeLetter(c));
  }
  return out;
}

/**
 * Bölüm bazlı istatistik + net.
 * @param {(string|null)[]} student — öğrenci cevapları
 * @param {(string|null)[]} key — aynı uzunlukta; null = bu soru karşılaştırılmaz
 * @returns {{ dogru: number, yanlis: number, bos: number, isaretli: number, net: number, graded: number }}
 */
export function smartOptikComputeSectionStats(student, key) {
  var dogru = 0;
  var yanlis = 0;
  var bos = 0;
  var isaretli = 0;
  var graded = 0;
  var n = Math.max(student.length, key.length);
  for (var i = 0; i < n; i++) {
    var st = i < student.length ? student[i] : null;
    var ky = i < key.length ? key[i] : null;
    if (st == null || st === "") {
      bos++;
      continue;
    }
    isaretli++;
    if (ky == null || ky === "") continue;
    graded++;
    if (st === ky) dogru++;
    else yanlis++;
  }
  var net = dogru - yanlis / 4;
  return { dogru: dogru, yanlis: yanlis, bos: bos, isaretli: isaretli, net: net, graded: graded };
}

export class SmartOptikEngine {
  /**
   * @param {"TYT"|"AYT"} examType
   */
  constructor(examType) {
    this.examType = examType === "AYT" ? "AYT" : "TYT";
    this.sections =
      this.examType === "TYT" ? SMART_OPTIK_TYT_SECTIONS.slice() : SMART_OPTIK_AYT_SECTIONS.slice();
  }

  getSections() {
    return this.sections;
  }

  getTotalQuestions() {
    return this.sections.reduce(function (acc, s) {
      return acc + s.questionCount;
    }, 0);
  }

  /**
   * @returns {{ sectionId: string, start: number, end: number }[]}
   */
  getSectionRanges() {
    var start = 0;
    var ranges = [];
    this.sections.forEach(function (sec) {
      var end = start + sec.questionCount;
      ranges.push({ sectionId: sec.id, start: start, end: end, label: sec.label, questionCount: sec.questionCount });
      start = end;
    });
    return ranges;
  }

  /**
   * Düz dizi → bölüm bazlı dilimler.
   * @param {(string|null)[]} flat
   * @returns {Record<string, (string|null)[]>}
   */
  flatToSections(flat) {
    var out = {};
    var pos = 0;
    this.sections.forEach(function (sec) {
      out[sec.id] = (flat || []).slice(pos, pos + sec.questionCount);
      pos += sec.questionCount;
    });
    return out;
  }

  sectionsToFlat(sectionMap) {
    var flat = [];
    this.sections.forEach(function (sec) {
      var arr = sectionMap[sec.id] || [];
      for (var i = 0; i < sec.questionCount; i++) {
        flat.push(i < arr.length ? arr[i] : null);
      }
    });
    return flat;
  }

  /**
   * @param {Record<string, (string|null)[]>} studentBySection
   * @param {string} keyString — tek satır A–E
   * @returns {{
   *   sections: Array<{ sectionId: string, label: string, stats: object, answers: (string|null)[] }>,
   *   totals: { dogru: number, yanlis: number, bos: number, isaretli: number, net: number, graded: number }
   * }}
   */
  evaluate(studentBySection, keyString) {
    var studentFlat = this.sectionsToFlat(studentBySection);
    var keyFlat = smartOptikParseKeyString(keyString, this.getTotalQuestions());
    var ranges = this.getSectionRanges();
    var sectionResults = [];
    var td = 0,
      ty = 0,
      tb = 0,
      ti = 0,
      tg = 0;
    var totalNet = 0;

    ranges.forEach(
      function (r) {
        var st = studentFlat.slice(r.start, r.end);
        var ky = keyFlat.slice(r.start, r.end);
        var stats = smartOptikComputeSectionStats(st, ky);
        totalNet += stats.net;
        td += stats.dogru;
        ty += stats.yanlis;
        tb += stats.bos;
        ti += stats.isaretli;
        tg += stats.graded;
        sectionResults.push({
          sectionId: r.sectionId,
          label: r.label,
          questionCount: r.questionCount,
          answers: st,
          keySlice: ky,
          stats: stats,
        });
      }.bind(this)
    );

    return {
      sections: sectionResults,
      totals: {
        dogru: td,
        yanlis: ty,
        bos: tb,
        isaretli: ti,
        net: totalNet,
        graded: tg,
      },
    };
  }

  /**
   * Appwrite `tests` / özel koleksiyon için önerilen gövde (alan adlarını şemaya göre eşleştirin).
   * @param {object} opts
   * @param {Record<string, (string|null)[]>} opts.studentBySection
   * @param {string} [opts.keyString]
   * @param {string|null} [opts.imageBase64] — data URL veya ham base64
   * @param {string} [opts.source] — "manual" | "camera_mock" | "camera"
   * @param {string} [opts.coachId]
   * @param {string} [opts.studentId]
   */
  toAppwritePayload(opts) {
    opts = opts || {};
    var evald = this.evaluate(opts.studentBySection || {}, opts.keyString || "");
    var now = new Date().toISOString();
    return {
      kind: "smart_optik_result",
      examType: this.examType,
      scoringRule: "osym",
      netFormula: "dogru - (yanlis / 4) /* her ders kendi içinde */",
      source: opts.source || "manual",
      coach_id: opts.coachId || null,
      studentId: opts.studentId || null,
      capturedImageBase64: opts.imageBase64 || null,
      keyString: opts.keyString || "",
      sections: evald.sections.map(function (s) {
        return {
          sectionId: s.sectionId,
          label: s.label,
          questionCount: s.questionCount,
          answers: s.answers,
          dogru: s.stats.dogru,
          yanlis: s.stats.yanlis,
          bos: s.stats.bos,
          net: s.stats.net,
        };
      }),
      totals: evald.totals,
      createdAt: now,
      updatedAt: now,
    };
  }
}
