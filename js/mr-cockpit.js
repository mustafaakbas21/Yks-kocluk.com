/**
 * MR (Emar) — Konu / Soru / Deneme akademik röntgen
 * Müfredat: yks-mufredat.js · Kaynak: atanan_kaynaklar · Deneme: exams.yksBranchDetail
 */
import { YKS2026_Mufredat } from "./yks-mufredat.js";
import { clampDy } from "./yks-exam-structure.js";
import { collection, query, where, onSnapshot, doc, setDoc, getDoc, db } from "./appwrite-compat.js";
import { APPWRITE_COLLECTION_MR_PROFILES, APPWRITE_COLLECTION_ATANAN_KAYNAKLAR } from "./appwrite-config.js";

var MR_LS = "mr_student_id_v1";
var state = {
  layer: "TYT",
  aytAlan: "sayisal",
  studentId: "",
  konu: {},
  soru: {},
  books: [],
  unsubBooks: null,
  saving: false,
};

/** TYT müfredat ders adı → optik yksBranchDetail.rows anahtarları */
var MR_TYT_LESSON_KEYS = {
  "TYT Türkçe": ["turkce"],
  "TYT Matematik": ["matematik"],
  "TYT Geometri": ["matematik"],
  "TYT Tarih": ["sosyal_tarih"],
  "TYT Coğrafya": ["sosyal_cografya"],
  "TYT Felsefe": ["sosyal_felsefe"],
  "TYT Din": ["sosyal_din"],
  "TYT Fizik": ["fen_fizik"],
  "TYT Kimya": ["fen_kimya"],
  "TYT Biyoloji": ["fen_biyo"],
};

/** AYT: alan → müfredat ders adı → yksBranchDetail.rows anahtarları (optik elle giriş ile uyumlu) */
var MR_AYT_LESSON_KEYS = {
  sayisal: {
    "AYT Matematik": ["ayt_mat"],
    "AYT Geometri": ["ayt_mat"],
    "AYT Fizik": ["ayt_fizik"],
    "AYT Kimya": ["ayt_kimya"],
    "AYT Biyoloji": ["ayt_biyo"],
  },
  esit_agirlik: {
    "AYT Matematik": ["ayt_mat"],
    "AYT Geometri": ["ayt_mat"],
    "AYT Edebiyat": ["ayt_edebiyat"],
    "AYT Tarih-1": ["ayt_tarih1"],
    "AYT Coğrafya-1": ["ayt_cografya1"],
    "AYT Felsefe Grubu": ["ayt_felsefe"],
  },
  sozel: {
    "AYT Edebiyat": ["ayt_edebiyat"],
    "AYT Tarih-1": ["ayt_tarih1"],
    "AYT Tarih-2": ["ayt_tarih2"],
    "AYT Coğrafya-1": ["ayt_cografya1"],
    "AYT Coğrafya-2": ["ayt_cografya2"],
    "AYT Felsefe Grubu": ["ayt_felsefe"],
    "AYT Din Kültürü ve Ahlak Bilgisi": ["ayt_din"],
  },
};

/** AYT seçimine göre hangi müfredat dersleri listelensin */
var MR_AYT_VISIBLE = {
  sayisal: ["AYT Matematik", "AYT Geometri", "AYT Fizik", "AYT Kimya", "AYT Biyoloji"],
  esit_agirlik: ["AYT Matematik", "AYT Geometri", "AYT Edebiyat", "AYT Tarih-1", "AYT Coğrafya-1", "AYT Felsefe Grubu"],
  sozel: [
    "AYT Edebiyat",
    "AYT Tarih-1",
    "AYT Tarih-2",
    "AYT Coğrafya-1",
    "AYT Coğrafya-2",
    "AYT Felsefe Grubu",
    "AYT Din Kültürü ve Ahlak Bilgisi",
  ],
};

function panel() {
  return window.YKSPanel || {};
}

function toast(msg) {
  var t = panel().toast;
  if (typeof t === "function") t(msg);
  else alert(msg);
}

function coachId() {
  var g = panel().getCoachId;
  return typeof g === "function" ? g() : "";
}

function students() {
  var gs = panel().getCachedStudents;
  return typeof gs === "function" ? gs() || [] : [];
}

function examsForStudent(sid) {
  var ge = panel().getCachedExams;
  var list = typeof ge === "function" ? ge() || [] : [];
  return list.filter(function (e) {
    return String(e.studentId || "") === String(sid);
  });
}

function topicKey(exam, lesson, topic) {
  return exam + "::" + lesson + "::" + topic;
}

/** konu_json: eski sürüm boolean veya { done, assignId, solved } */
function getKonuEntry(k) {
  var v = state.konu[k];
  if (v == null) return { done: false, assignId: "", solved: "" };
  if (typeof v === "boolean") return { done: v, assignId: "", solved: "" };
  return {
    done: !!v.done,
    assignId: v.assignId != null ? String(v.assignId) : "",
    solved: v.solved != null && v.solved !== "" ? v.solved : "",
  };
}

function setKonuEntry(k, patch) {
  var cur = getKonuEntry(k);
  state.konu[k] = {
    done: patch.done !== undefined ? !!patch.done : cur.done,
    assignId: patch.assignId !== undefined ? String(patch.assignId || "") : cur.assignId,
    solved: patch.solved !== undefined ? patch.solved : cur.solved,
  };
}

function mrDocId(sid) {
  return String(sid || "")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 36);
}

async function loadProfile(studentId) {
  state.konu = {};
  state.soru = {};
  if (!studentId) return;
  var did = mrDocId(studentId);
  try {
    var snap = await getDoc(doc(db, APPWRITE_COLLECTION_MR_PROFILES, did));
    if (!snap.exists()) return;
    var d = snap.data();
    try {
      if (d.konu_json) state.konu = JSON.parse(d.konu_json) || {};
    } catch (_e) {}
    try {
      if (d.soru_json) state.soru = JSON.parse(d.soru_json) || {};
    } catch (_e) {}
  } catch (err) {
    console.warn("[MR] profil okunamadı:", err);
  }
}

async function saveProfilePartial() {
  var sid = state.studentId;
  if (!sid || state.saving) return;
  var cid = coachId();
  if (!cid) {
    toast("Oturum (koç) bulunamadı.");
    return;
  }
  state.saving = true;
  try {
    var did = mrDocId(sid);
    await setDoc(doc(db, APPWRITE_COLLECTION_MR_PROFILES, did), {
      student_id: sid,
      coach_id: cid,
      konu_json: JSON.stringify(state.konu),
      soru_json: JSON.stringify(state.soru),
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[MR] kayıt:", err);
    toast("MR kaydı yazılamadı (koleksiyon/izin kontrolü).");
  } finally {
    state.saving = false;
  }
}

function subscribeBooks(studentId) {
  if (state.unsubBooks) {
    try {
      state.unsubBooks();
    } catch (_e) {}
    state.unsubBooks = null;
  }
  state.books = [];
  if (!studentId) return;
  state.unsubBooks = onSnapshot(
    query(collection(db, APPWRITE_COLLECTION_ATANAN_KAYNAKLAR), where("student_id", "==", studentId)),
    function (snap) {
      state.books = [];
      snap.forEach(function (d) {
        var x = d.data();
        state.books.push({
          assignId: d.id,
          title: x.title || "",
          subject: x.subject || "",
          libId: x.libraryId || "",
        });
      });
      state.books.sort(function (a, b) {
        return String(a.title).localeCompare(String(b.title), "tr");
      });
      var vSoru = document.querySelector('.main-view[data-view="mr-soru"]:not([hidden])');
      if (vSoru) renderSoruMount();
      var vKonu = document.querySelector('.main-view[data-view="mr-konu"]:not([hidden])');
      if (vKonu) renderKonuMount();
    },
    function (err) {
      console.warn("[MR] atanan kaynaklar:", err);
    }
  );
}

function booksForLesson(lessonName) {
  var ln = String(lessonName || "").toLowerCase();
  return state.books.filter(function (b) {
    var s = String(b.subject || "").toLowerCase();
    if (!s) return true;
    return s === ln || s.indexOf(ln.replace(/^tyt\s+|^ayt\s+/i, "")) >= 0 || ln.indexOf(s.slice(0, 8)) >= 0;
  });
}

function lessonKeysForDeneme(layer, lessonName) {
  if (layer === "TYT") return MR_TYT_LESSON_KEYS[lessonName] || [];
  var alan = state.aytAlan && MR_AYT_LESSON_KEYS[state.aytAlan] ? state.aytAlan : "sayisal";
  var bag = MR_AYT_LESSON_KEYS[alan] || {};
  return bag[lessonName] || [];
}

function aggregateBranchDy(exams) {
  var agg = {};
  exams.forEach(function (e) {
    var det = e.yksBranchDetail;
    if (!det || !det.rows) return;
    Object.keys(det.rows).forEach(function (k) {
      var r = det.rows[k];
      var s = Number(r.soru) || 0;
      var d = Number(r.d) || 0;
      var y = Number(r.y) || 0;
      var cl = clampDy(s, d, y);
      var b = Math.max(0, s - cl.d - cl.y);
      if (!agg[k]) agg[k] = { d: 0, y: 0, b: 0 };
      agg[k].d += cl.d;
      agg[k].y += cl.y;
      agg[k].b += b;
    });
  });
  return agg;
}

function splitEven(total, n) {
  if (n <= 0) return [];
  var base = Math.floor(total / n);
  var rem = total - base * n;
  var out = [];
  for (var i = 0; i < n; i++) out.push(base + (i < rem ? 1 : 0));
  return out;
}

function splitDyBToTopics(d, y, b, n) {
  if (n <= 0) return [];
  var td = splitEven(d, n);
  var ty = splitEven(y, n);
  var tb = splitEven(b, n);
  var rows = [];
  for (var i = 0; i < n; i++) {
    rows.push({ d: td[i] || 0, y: ty[i] || 0, b: tb[i] || 0 });
  }
  return rows;
}

function pctSuccess(d, y, b) {
  var t = d + y + b;
  if (!t) return 0;
  return Math.round((100 * d) / t);
}

function ringSvg(pct, size) {
  size = size || 44;
  var r = (size - 6) / 2;
  var c = 2 * Math.PI * r;
  var off = c * (1 - Math.min(100, Math.max(0, pct)) / 100);
  return (
    '<svg class="mr-ring" width="' +
    size +
    '" height="' +
    size +
    '" viewBox="0 0 ' +
    size +
    " " +
    size +
    '">' +
    '<circle cx="' +
    size / 2 +
    '" cy="' +
    size / 2 +
    '" r="' +
    r +
    '" fill="none" stroke="#e5e7eb" stroke-width="4"/>' +
    '<circle cx="' +
    size / 2 +
    '" cy="' +
    size / 2 +
    '" r="' +
    r +
    '" fill="none" stroke="#2563eb" stroke-width="4" stroke-dasharray="' +
    c +
    '" stroke-dashoffset="' +
    off +
    '" transform="rotate(-90 ' +
    size / 2 +
    " " +
    size / 2 +
    ')" stroke-linecap="round"/>' +
    '<text x="50%" y="50%" dominant-baseline="middle" text-anchor="middle" font-size="9" class="mr-ring__lbl">' +
    Math.round(pct) +
    "%</text></svg>"
  );
}

function mufredatLessonsList() {
  var layer = state.layer;
  var block = YKS2026_Mufredat[layer];
  if (!block) return [];
  if (layer === "TYT") return Object.keys(block);
  var vis = MR_AYT_VISIBLE[state.aytAlan] || Object.keys(block);
  return vis.filter(function (L) {
    return block[L];
  });
}

function lessonProgressKonu(layer, lessonName, topics) {
  if (!topics.length) return 0;
  var done = 0;
  topics.forEach(function (top) {
    var k = topicKey(layer, lessonName, top);
    if (getKonuEntry(k).done) done++;
  });
  return (100 * done) / topics.length;
}

function lessonProgressSoru(layer, lessonName, topics) {
  if (!topics.length) return 0;
  var done = 0;
  topics.forEach(function (top) {
    var k = topicKey(layer, lessonName, top);
    if (state.soru[k] && state.soru[k].done) done++;
  });
  return (100 * done) / topics.length;
}

function renderAccordionKonu(mount) {
  var layer = state.layer;
  var block = YKS2026_Mufredat[layer];
  if (!block) {
    mount.innerHTML = '<p class="mr-empty">Katman bulunamadı.</p>';
    return;
  }
  var lessons = mufredatLessonsList();
  var html = '<div class="mr-acc">';
  lessons.forEach(function (lessonName) {
    var topics = block[lessonName] || [];
    var pct = lessonProgressKonu(layer, lessonName, topics);
    var rows = topics
      .map(function (top) {
        var k = topicKey(layer, lessonName, top);
        var ke = getKonuEntry(k);
        var on = ke.done;
        var sel = String(ke.assignId || "");
        var solved = ke.solved !== "" && ke.solved != null ? ke.solved : "";
        var opts =
          '<option value="">— Kitap seçin —</option>' +
          booksForLesson(lessonName)
            .map(function (b) {
              return (
                "<option value=\"" +
                escapeHtml(b.assignId) +
                "\"" +
                (b.assignId === sel ? " selected" : "") +
                ">" +
                escapeHtml(b.title) +
                "</option>"
              );
            })
            .join("");
        return (
          '<div class="mr-topic-row mr-topic-row--soru" data-mr-k="' +
          encodeURIComponent(k) +
          '">' +
          '<span class="mr-topic-name">' +
          escapeHtml(top) +
          "</span>" +
          '<select class="mr-book-select" data-mr-konu-book>' +
          opts +
          "</select>" +
          '<label><span class="mr-hint">Çözülen soru</span><input type="number" min="0" class="mr-soru-input" data-mr-konu-solved placeholder="Çözülen soru" value="' +
          escapeHtml(String(solved)) +
          '"/></label>' +
          '<button type="button" class="mr-toggle ' +
          (on ? "mr-toggle--on" : "mr-toggle--off") +
          '" data-mr-toggle-konu="1">' +
          (on ? "Konu Bitti" : "Konu Bitmemiş") +
          "</button></div>"
        );
      })
      .join("");
    html +=
      '<details class="mr-acc__item" open>' +
      '<summary class="mr-acc__summary">' +
      '<span class="mr-acc__title">' +
      escapeHtml(lessonName) +
      "</span>" +
      ringSvg(pct) +
      '<span class="mr-acc__chev" aria-hidden="true"><i class="fa-solid fa-chevron-down"></i></span>' +
      "</summary>" +
      '<div class="mr-topics">' +
      rows +
      "</div></details>";
  });
  html += "</div>";
  mount.innerHTML = html;
}

function renderAccordionSoru(mount) {
  var layer = state.layer;
  var block = YKS2026_Mufredat[layer];
  if (!block) {
    mount.innerHTML = '<p class="mr-empty">Katman bulunamadı.</p>';
    return;
  }
  var html = '<div class="mr-acc">';
  mufredatLessonsList().forEach(function (lessonName) {
    var topics = block[lessonName] || [];
    var pct = lessonProgressSoru(layer, lessonName, topics);
    var rows = topics
      .map(function (top) {
        var k = topicKey(layer, lessonName, top);
        var st = state.soru[k] || {};
        var sel = String(st.assignId || "");
        var solved = st.solved != null ? st.solved : "";
        var done = !!st.done;
        var opts =
          '<option value="">— Kitap seçin —</option>' +
          booksForLesson(lessonName)
            .map(function (b) {
              return (
                "<option value=\"" +
                escapeHtml(b.assignId) +
                "\"" +
                (b.assignId === sel ? " selected" : "") +
                ">" +
                escapeHtml(b.title) +
                "</option>"
              );
            })
            .join("");
        return (
          '<div class="mr-topic-row mr-topic-row--soru" data-mr-k="' +
          encodeURIComponent(k) +
          '">' +
          '<span class="mr-topic-name">' +
          escapeHtml(top) +
          "</span>" +
          '<select class="mr-book-select" data-mr-book>' +
          opts +
          "</select>" +
          '<label><span class="mr-hint">Çözülen soru</span><input type="number" min="0" class="mr-soru-input" data-mr-solved placeholder="Çözülen soru" value="' +
          escapeHtml(String(solved)) +
          '"/></label>' +
          '<button type="button" class="mr-toggle ' +
          (done ? "mr-toggle--on" : "mr-toggle--off") +
          '" data-mr-toggle-soru="1">' +
          (done ? "Çözüm Bitti" : "Çözüm Bitmedi") +
          "</button></div>"
        );
      })
      .join("");
    html +=
      '<details class="mr-acc__item" open>' +
      '<summary class="mr-acc__summary">' +
      '<span class="mr-acc__title">' +
      escapeHtml(lessonName) +
      "</span>" +
      ringSvg(pct) +
      '<span class="mr-acc__chev"><i class="fa-solid fa-chevron-down"></i></span>' +
      "</summary>" +
      '<div class="mr-topics">' +
      rows +
      "</div></details>";
  });
  html += "</div>";
  mount.innerHTML = html;
}

function renderAccordionDeneme(mount) {
  var layer = state.layer;
  var block = YKS2026_Mufredat[layer];
  var ex = examsForStudent(state.studentId);
  var branchAgg = aggregateBranchDy(ex);
  if (!block) {
    mount.innerHTML = '<p class="mr-empty">Katman bulunamadı.</p>';
    return;
  }
  var html = '<div class="mr-acc">';
  if (!ex.length) {
    html +=
      '<p class="mr-empty" style="margin:0 0 1rem">Bu öğrenci için henüz <strong>deneme kaydı</strong> yok. Akıllı Optik veya deneme girişi sonrası branş D/Y burada özetlenir.</p>';
  }
  mufredatLessonsList().forEach(function (lessonName) {
    var topics = block[lessonName] || [];
    var keys = lessonKeysForDeneme(layer, lessonName);
    var d = 0,
      y = 0,
      b = 0;
    keys.forEach(function (bk) {
      var x = branchAgg[bk];
      if (x) {
        d += x.d;
        y += x.y;
        b += x.b;
      }
    });
    var parts = splitDyBToTopics(d, y, b, topics.length);
    var lessonPct = pctSuccess(d, y, b);
    var rows = topics
      .map(function (top, i) {
        var p = parts[i] || { d: 0, y: 0, b: 0 };
        var pc = pctSuccess(p.d, p.y, p.b);
        return (
          '<div class="mr-topic-row mr-topic-row--deneme">' +
          '<span class="mr-topic-name">' +
          escapeHtml(top) +
          "</span>" +
          '<div class="mr-badges">' +
          '<span class="mr-badge mr-badge--d">D ' +
          p.d +
          "</span>" +
          '<span class="mr-badge mr-badge--y">Y ' +
          p.y +
          "</span>" +
          '<span class="mr-badge mr-badge--b">B ' +
          p.b +
          "</span></div>" +
          ringSvg(pc, 56) +
          "</div>"
        );
      })
      .join("");
    html +=
      '<details class="mr-acc__item" open>' +
      '<summary class="mr-acc__summary">' +
      '<span class="mr-acc__title">' +
      escapeHtml(lessonName) +
      "</span>" +
      ringSvg(lessonPct) +
      '<span class="mr-acc__chev"><i class="fa-solid fa-chevron-down"></i></span>' +
      "</summary>" +
      '<div class="mr-topics">' +
      rows +
      '<p class="mr-hint">Branş toplamları müfredat konularına eşit paylaştırıldı (gerçek konu bazlı optik şeması bağlandığında güncellenir).</p></div></details>';
  });
  html += "</div>";
  mount.innerHTML = html;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function bindMountKonu(mount) {
  mount.querySelectorAll("[data-mr-konu-book]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var row = sel.closest(".mr-topic-row");
      if (!row) return;
      var k = decodeURIComponent(row.getAttribute("data-mr-k") || "");
      if (!k) return;
      var e = getKonuEntry(k);
      setKonuEntry(k, { assignId: sel.value || "", done: e.done, solved: e.solved });
      saveProfilePartial();
    });
  });
  mount.querySelectorAll("[data-mr-konu-solved]").forEach(function (inp) {
    inp.addEventListener("change", function () {
      var row = inp.closest(".mr-topic-row");
      if (!row) return;
      var k = decodeURIComponent(row.getAttribute("data-mr-k") || "");
      if (!k) return;
      var e = getKonuEntry(k);
      var n = parseInt(inp.value, 10);
      setKonuEntry(k, { solved: isNaN(n) ? 0 : n, done: e.done, assignId: e.assignId });
      saveProfilePartial();
    });
  });
  mount.querySelectorAll("[data-mr-toggle-konu]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var row = btn.closest(".mr-topic-row");
      if (!row) return;
      var k = decodeURIComponent(row.getAttribute("data-mr-k") || "");
      if (!k) return;
      var e0 = getKonuEntry(k);
      setKonuEntry(k, { done: !e0.done, assignId: e0.assignId, solved: e0.solved });
      saveProfilePartial();
      renderKonuMount();
    });
  });
}

function bindMountSoru(mount) {
  mount.querySelectorAll("[data-mr-book]").forEach(function (sel) {
    sel.addEventListener("change", function () {
      var row = sel.closest(".mr-topic-row");
      if (!row) return;
      var k = decodeURIComponent(row.getAttribute("data-mr-k") || "");
      if (!k) return;
      if (!state.soru[k]) state.soru[k] = {};
      state.soru[k].assignId = sel.value || "";
      saveProfilePartial();
    });
  });
  mount.querySelectorAll("[data-mr-solved]").forEach(function (inp) {
    inp.addEventListener("change", function () {
      var row = inp.closest(".mr-topic-row");
      if (!row) return;
      var k = decodeURIComponent(row.getAttribute("data-mr-k") || "");
      if (!k) return;
      if (!state.soru[k]) state.soru[k] = {};
      var n = parseInt(inp.value, 10);
      state.soru[k].solved = isNaN(n) ? 0 : n;
      saveProfilePartial();
    });
  });
  mount.querySelectorAll("[data-mr-toggle-soru]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      var row = btn.closest(".mr-topic-row");
      if (!row) return;
      var k = decodeURIComponent(row.getAttribute("data-mr-k") || "");
      if (!k) return;
      if (!state.soru[k]) state.soru[k] = {};
      state.soru[k].done = !state.soru[k].done;
      saveProfilePartial();
      renderSoruMount();
    });
  });
}

function renderKonuMount() {
  var mount = document.getElementById("mrAccordionKonu");
  if (!mount) return;
  if (!state.studentId) {
    mount.innerHTML = '<p class="mr-empty">Öğrenci seçin; teorik konu işaretleri bu öğrenciye kaydedilir.</p>';
    return;
  }
  renderAccordionKonu(mount);
  bindMountKonu(mount);
}

function renderSoruMount() {
  var mount = document.getElementById("mrAccordionSoru");
  if (!mount) return;
  if (!state.studentId) {
    mount.innerHTML = '<p class="mr-empty">Öğrenci seçin; kitap ve soru adedi Appwrite MR profiline yazılır.</p>';
    return;
  }
  renderAccordionSoru(mount);
  bindMountSoru(mount);
}

function renderDenemeMount() {
  var mount = document.getElementById("mrAccordionDeneme");
  if (!mount) return;
  if (!state.studentId) {
    mount.innerHTML = '<p class="mr-empty">Öğrenci seçin; deneme D/Y verisi geçmiş sınavlardan okunur.</p>';
    return;
  }
  renderAccordionDeneme(mount);
}

function syncLayerUi() {
  document.querySelectorAll(".mr-layer button[data-mr-layer]").forEach(function (b) {
    b.classList.toggle("is-active", b.getAttribute("data-mr-layer") === state.layer);
  });
  document.querySelectorAll(".mr-ayt").forEach(function (el) {
    el.hidden = state.layer !== "AYT";
  });
  document.querySelectorAll("[data-mr-ayt-alan]").forEach(function (sel) {
    sel.value = state.aytAlan;
  });
}

function fillStudentSelects() {
  var list = students();
  document.querySelectorAll(".mr-student-select").forEach(function (sel) {
    var prev = state.studentId || localStorage.getItem(MR_LS) || "";
    sel.innerHTML =
      '<option value="">— Öğrenci seçin —</option>' +
      list
        .map(function (s) {
          return (
            "<option value=\"" +
            escapeHtml(s.id) +
            "\"" +
            (s.id === prev ? " selected" : "") +
            ">" +
            escapeHtml(s.name || s.studentName || s.id) +
            "</option>"
          );
        })
        .join("");
  });
}

function bindStudentSelects() {
  document.querySelectorAll(".mr-student-select").forEach(function (sel) {
    if (sel.dataset.mrBound) return;
    sel.dataset.mrBound = "1";
    sel.addEventListener("change", function () {
      state.studentId = String(sel.value || "").trim();
      if (state.studentId) localStorage.setItem(MR_LS, state.studentId);
      else localStorage.removeItem(MR_LS);
      document.querySelectorAll(".mr-student-select").forEach(function (s2) {
        if (s2 !== sel) s2.value = state.studentId;
      });
      loadProfile(state.studentId).then(function () {
        subscribeBooks(state.studentId);
        renderKonuMount();
        renderSoruMount();
        renderDenemeMount();
      });
    });
  });
}

function bindLayerControls() {
  document.querySelectorAll(".mr-layer button[data-mr-layer]").forEach(function (b) {
    if (b.dataset.mrBound) return;
    b.dataset.mrBound = "1";
    b.addEventListener("click", function () {
      state.layer = b.getAttribute("data-mr-layer") || "TYT";
      syncLayerUi();
      renderKonuMount();
      renderSoruMount();
      renderDenemeMount();
    });
  });
  document.querySelectorAll("[data-mr-ayt-alan]").forEach(function (sel) {
    if (sel.dataset.mrBound) return;
    sel.dataset.mrBound = "1";
    sel.addEventListener("change", function () {
      state.aytAlan = sel.value || "sayisal";
      document.querySelectorAll("[data-mr-ayt-alan]").forEach(function (s2) {
        if (s2 !== sel) s2.value = state.aytAlan;
      });
      renderKonuMount();
      renderSoruMount();
      renderDenemeMount();
    });
  });
}

export function initMrCockpit(view) {
  fillStudentSelects();
  bindStudentSelects();
  bindLayerControls();
  syncLayerUi();
  var sel = document.querySelector(".mr-student-select");
  state.studentId = sel && sel.value ? String(sel.value) : localStorage.getItem(MR_LS) || "";
  if (state.studentId) {
    loadProfile(state.studentId).then(function () {
      subscribeBooks(state.studentId);
      if (view === "mr-konu") renderKonuMount();
      else if (view === "mr-soru") renderSoruMount();
      else if (view === "mr-deneme") renderDenemeMount();
    });
  } else {
    renderKonuMount();
    renderSoruMount();
    renderDenemeMount();
  }
}

export function refreshMrIfActive() {
  var v = panel().getView && panel().getView();
  if (v === "mr-konu" || v === "mr-soru" || v === "mr-deneme") initMrCockpit(v);
}
