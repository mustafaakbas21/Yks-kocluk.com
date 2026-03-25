/**
 * Hedef Simülatörü — YÖK Atlas örnek verisi ile radar / bar / net tablosu ortak mantığı
 */

export function parseStudentNetVal(v) {
  var n = parseFloat(String(v == null ? "" : v).replace(",", "."));
  return isNaN(n) ? null : n;
}

function esc(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Öğrencide TYT net alanı yoksa kullanılan dört özet satır */
export function buildDefaultRowsFromStudent(student) {
  var base = [
    { label: "TYT Türkçe", current: 32, target: 35, section: "TYT" },
    { label: "TYT Matematik", current: 35.5, target: 38, section: "TYT" },
    { label: "TYT Fen", current: 28, target: 32, section: "TYT" },
    { label: "AYT Matematik", current: 33, target: 40, section: "AYT" },
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

/** @param {object|null} student */
export function buildAtlasRowsFromProgram(program, student) {
  if (!program || !program.rows || !program.rows.length) return null;
  var curT = student ? parseStudentNetVal(student.currentTytNet) : null;
  var tgtT = student ? parseStudentNetVal(student.targetTytNet) : null;
  var ratio = curT != null && tgtT != null && tgtT > 0 ? Math.min(1.15, Math.max(0.45, curT / tgtT)) : 0.92;
  return program.rows.map(function (r) {
    var target = r.targetNet;
    var current = Math.round(Math.min(target, target * ratio * 0.96) * 10) / 10;
    return {
      label: r.section + " " + r.name,
      current: current,
      target: target,
      section: r.section,
    };
  });
}

export function buildSimulatorRows(atlasProgram, student) {
  if (atlasProgram && atlasProgram.rows && atlasProgram.rows.length) {
    var ar = buildAtlasRowsFromProgram(atlasProgram, student);
    if (ar && ar.length) return ar;
  }
  return buildDefaultRowsFromStudent(student);
}

export function sumGap(rows) {
  return rows.reduce(function (s, r) {
    return s + Math.max(0, r.target - r.current);
  }, 0);
}

/**
 * @param {Array<{ label: string, current: number, target: number, section?: string }>} rows
 */
export function netTemplateTableHtml(rows) {
  if (!rows || !rows.length) return "";
  function isTyt(r) {
    return (r.section || "").toUpperCase() === "TYT" || /^TYT\b/i.test(r.label);
  }
  function isAyt(r) {
    return (r.section || "").toUpperCase() === "AYT" || /^AYT\b/i.test(r.label);
  }
  var tyt = rows.filter(isTyt);
  var ayt = rows.filter(isAyt);
  function sectionRows(list, title) {
    if (!list.length) return "";
    var sec =
      '<tr><td colspan="4" class="hedef-atlas-net__sec">' + esc(title) + "</td></tr>";
    var trs = list
      .map(function (r) {
        var gap = r.target - r.current;
        var gapCls = gap > 0 ? "is-behind" : gap < 0 ? "is-ahead" : "is-ok";
        var gapTxt = gap === 0 ? "0" : (gap > 0 ? "+" + gap.toFixed(1) : gap.toFixed(1));
        return (
          "<tr><td>" +
          esc(r.label) +
          "</td><td>" +
          r.target.toFixed(1) +
          "</td><td>" +
          r.current.toFixed(1) +
          '</td><td class="' +
          gapCls +
          '">' +
          esc(gapTxt) +
          "</td></tr>"
        );
      })
      .join("");
    return sec + trs;
  }
  return (
    '<div class="hedef-atlas-net-wrap">' +
    '<table class="hedef-atlas-net-table">' +
    "<thead><tr><th>Ders</th><th>YÖK Atlas hedef neti</th><th>Güncel net</th><th>Fark</th></tr></thead><tbody>" +
    sectionRows(tyt, "TYT netleri") +
    sectionRows(ayt, "AYT netleri") +
    "</tbody></table>" +
    '<p class="hedef-atlas-net-footnote">Örnek veri — resmî YÖK yerleştirme taban puanları değildir.</p>' +
    "</div>"
  );
}

/**
 * Aynı görünen ada sahip kayıtları tekilleştirir (ilk gelen korunur). `Set` + `name` anahtarı.
 * @param {Array<{ name?: string }>} items
 * @param {string} [nameKey] varsayılan "name"
 */
export function dedupeNamedRecordsByDisplayName(items, nameKey) {
  var key = nameKey || "name";
  var seen = new Set();
  var out = [];
  (items || []).forEach(function (item) {
    var raw = String(item && item[key] != null ? item[key] : "").trim();
    if (!raw) return;
    var norm = raw.toLocaleLowerCase("tr");
    if (seen.has(norm)) return;
    seen.add(norm);
    out.push(item);
  });
  return out;
}

/** `{ name: string }` öğeleri Türkçe A–Z sıralar (üniversite ve program şablonu listeleri için). */
export function sortNamedItemsAlphabeticalTr(list) {
  return (list || []).slice().sort(function (a, b) {
    return String((a && a.name) || "").localeCompare(String((b && b.name) || ""), "tr", { sensitivity: "base" });
  });
}

/** Üniversite/bölüm select + arama kutusu: yazılan metne göre seçenekleri gizler (ilk seçenek hep görünür). */
export function wireSearchFilterForSelect(filterInput, selectEl) {
  if (!filterInput || !selectEl) return;
  filterInput.addEventListener("input", function () {
    var q = String(filterInput.value || "")
      .toLowerCase()
      .trim();
    Array.from(selectEl.options).forEach(function (opt, i) {
      if (i === 0) {
        opt.hidden = false;
        return;
      }
      opt.hidden = !!(q && String(opt.textContent || "").toLowerCase().indexOf(q) === -1);
    });
  });
}
