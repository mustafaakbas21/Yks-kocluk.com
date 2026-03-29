/**
 * Görüşme Odası — Premium Kokpit (gerçek Appwrite + yks-data + TestMaker köprüsü)
 */
import { YKS_TYT_BRANCHES, YKS_AYT_BY_ALAN, netFromDy } from "./yks-exam-structure.js";
import { normalizeStudentYksAlanKey } from "./hedef-atlas-helpers.js";
import { YKS2026_Mufredat } from "./yks-mufredat.js";
import {
  ensureHedefSimulatorAppwriteData,
  getHedefAppwriteUniversities,
  getAllHedefPrograms,
  hedefUniDisplayName,
  hedefProgramDisplayName,
} from "./hedef-appwrite-catalog.js";
import { buildProgramFromAppwriteV2 } from "./net-sihirbazi-engine.js";
import { createCurrentNetForRowResolver } from "./net-sihirbazi-branch-nets.js";
import { collection, addDoc, getDocs, query, where, serverTimestamp, db } from "./appwrite-compat.js";
import { APPWRITE_COLLECTION_MEETING_LOGS } from "./appwrite-config.js";

function parseTrNum(s) {
  if (s == null || s === "") return NaN;
  return parseFloat(String(s).replace(",", ".").trim());
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

function examDateSortKey(e) {
  var raw = e && (e.date || e.examDate || e.saved_at || e.savedAt);
  if (!raw) return "";
  if (typeof raw.toDate === "function") {
    try {
      return raw.toDate().toISOString();
    } catch (_e) {}
  }
  return String(raw);
}

function buildTytLabelMap() {
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

function buildAytLabelMap(alan) {
  var m = {};
  var pack = YKS_AYT_BY_ALAN[alan || "sayisal"];
  if (!pack) return m;
  pack.branches.forEach(function (b) {
    m[b.id] = b.label;
    m["ayt_" + b.id] = b.label;
  });
  return m;
}

function clampDy(soru, d, y) {
  var s = Number(soru);
  if (isNaN(s) || s <= 0) return { d: 0, y: 0 };
  var dd = Number(d != null ? d : 0);
  var yy = Number(y != null ? y : 0);
  if (isNaN(dd)) dd = 0;
  if (isNaN(yy)) yy = 0;
  dd = Math.max(0, Math.min(s, dd));
  yy = Math.max(0, Math.min(s - dd, yy));
  return { d: dd, y: yy };
}

function karneNetFromRowEntry(row) {
  if (!row || row.soru == null) return NaN;
  var cl = clampDy(row.soru, row.d, row.y);
  return netFromDy(cl.d, cl.y);
}

function normTr(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function shortCourseName(courseKey) {
  return String(courseKey || "")
    .replace(/^TYT\s+/i, "")
    .replace(/^AYT\s+/i, "")
    .trim();
}

/** Merkezi müfredattan zayıf sıraya göre anlamlı konu (Optik vb. öncelikli). */
function pickTopicForCourseWeak(examKey, courseKey, weakIndex) {
  var bag = YKS2026_Mufredat[examKey] || {};
  var topics = bag[courseKey];
  if (!Array.isArray(topics) || !topics.length) return "";
  var opt = topics.find(function (t) {
    return /optik|ışık|dalga|mercek|gölge/i.test(String(t));
  });
  if (opt) return opt;
  var ix = Math.min(topics.length - 1, Math.max(0, Number(weakIndex) || 0));
  return topics[ix] || topics[topics.length - 1];
}

/**
 * Branch anahtarından müfredat ders anahtarı + konu etiketi.
 */
function branchToMufredatCourse(examMode, branchKey, branchLabel) {
  var em = String(examMode || "TYT").toUpperCase();
  var k = String(branchKey || "").toLowerCase();
  var lab = String(branchLabel || "");

  if (em === "TYT") {
    if (k.indexOf("turk") !== -1 || lab.indexOf("Türkçe") !== -1) return { exam: "TYT", course: "TYT Türkçe" };
    if (k.indexOf("fen_kimya") !== -1 || (k.indexOf("kimya") !== -1 && k.indexOf("fen") !== -1))
      return { exam: "TYT", course: "TYT Kimya" };
    if (k.indexOf("fen_biyoloji") !== -1 || k.indexOf("fen_biyo") !== -1 || (k.indexOf("biyo") !== -1 && k.indexOf("fen") !== -1))
      return { exam: "TYT", course: "TYT Biyoloji" };
    if (k.indexOf("fen_fizik") !== -1 || (k.indexOf("fizik") !== -1 && k.indexOf("fen") !== -1))
      return { exam: "TYT", course: "TYT Fizik" };
    if (k.indexOf("kimya") !== -1 || lab.indexOf("Kimya") !== -1) return { exam: "TYT", course: "TYT Kimya" };
    if (k.indexOf("biyo") !== -1 || lab.indexOf("Biyoloji") !== -1) return { exam: "TYT", course: "TYT Biyoloji" };
    if (k.indexOf("fizik") !== -1 || lab.indexOf("Fizik") !== -1) return { exam: "TYT", course: "TYT Fizik" };
    if (k.indexOf("matematik") !== -1 || k === "matematik") return { exam: "TYT", course: "TYT Matematik" };
    if (k.indexOf("fen") !== -1 && k.indexOf("_") === -1) return { exam: "TYT", course: "TYT Fizik" };
    if (k.indexOf("sosyal") !== -1 || k.indexOf("tarih") !== -1) return { exam: "TYT", course: "TYT Tarih" };
    if (k.indexOf("cograf") !== -1 || k.indexOf("coğrafya") !== -1) return { exam: "TYT", course: "TYT Coğrafya" };
    if (k.indexOf("felsefe") !== -1) return { exam: "TYT", course: "TYT Felsefe" };
    if (k.indexOf("din") !== -1) return { exam: "TYT", course: "TYT Din" };
    return { exam: "TYT", course: "TYT Matematik" };
  }

  if (k.indexOf("mat") !== -1 || lab.indexOf("Matematik") !== -1) return { exam: "AYT", course: "AYT Matematik" };
  if (k.indexOf("fizik") !== -1 || lab.indexOf("Fizik") !== -1) return { exam: "AYT", course: "AYT Fizik" };
  if (k.indexOf("kimya") !== -1) return { exam: "AYT", course: "AYT Kimya" };
  if (k.indexOf("biyo") !== -1 || k.indexOf("biyoloji") !== -1) return { exam: "AYT", course: "AYT Biyoloji" };
  if (k.indexOf("edebiyat") !== -1) return { exam: "AYT", course: "AYT Edebiyat" };
  return { exam: "AYT", course: "AYT Matematik" };
}

function aggregateWeakestBranches(exams, studentAlan) {
  var tytMap = buildTytLabelMap();
  var aytMap = buildAytLabelMap(studentAlan);
  var agg = {};
  exams.forEach(function (e) {
    var d = e.yksBranchDetail;
    if (!d || !d.rows || typeof d.rows !== "object") return;
    var examMode = String(d.examMode || "TYT").toUpperCase();
    Object.keys(d.rows).forEach(function (k) {
      var row = d.rows[k];
      var n = karneNetFromRowEntry(row);
      if (isNaN(n)) return;
      var lab =
        examMode === "AYT"
          ? aytMap[k] || String(k).replace(/^ayt_/, "")
          : tytMap[k] || k;
      var key = examMode + "|" + k;
      if (!agg[key]) agg[key] = { sum: 0, count: 0, label: lab, examMode: examMode, branchKey: k };
      agg[key].sum += n;
      agg[key].count++;
    });
  });
  return Object.keys(agg)
    .map(function (k) {
      var x = agg[k];
      return {
        key: k,
        avg: x.sum / Math.max(1, x.count),
        label: x.label,
        examMode: x.examMode,
        branchKey: x.branchKey,
      };
    })
    .sort(function (a, b) {
      return a.avg - b.avg;
    });
}

function examsForStudent(getExams, sid) {
  return getExams().filter(function (e) {
    return String(e.studentId || "") === String(sid);
  });
}

var goTrendChart = null;
var goCountdownTimer = null;
var goQuill = null;

function destroyTrendChart() {
  var canvas = document.getElementById("goTrendCanvas");
  if (canvas && typeof Chart !== "undefined") {
    var ex = Chart.getChart(canvas);
    if (ex) ex.destroy();
  }
  goTrendChart = null;
  var iv = document.getElementById("goTrendIvme");
  if (iv) iv.textContent = "";
}

function renderTrendChart(last5) {
  var canvas = document.getElementById("goTrendCanvas");
  if (!canvas || typeof Chart === "undefined") return;
  destroyTrendChart();
  if (!last5 || !last5.length) return;
  var labels = last5.map(function (e, i) {
    var n = e.examName || e.exam || "D" + (i + 1);
    return n.length > 16 ? n.slice(0, 14) + "…" : n;
  });
  var tytData = last5.map(function (e) {
    var tur = (e.examType || e.type || e.tur || "TYT").toUpperCase();
    if (tur !== "TYT") return null;
    var v = parseTrNum(e.net);
    return isNaN(v) ? null : v;
  });
  var aytData = last5.map(function (e) {
    var tur = (e.examType || e.type || e.tur || "").toUpperCase();
    if (tur !== "AYT") return null;
    var v = parseTrNum(e.net);
    return isNaN(v) ? null : v;
  });
  goTrendChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "TYT net",
          data: tytData,
          borderColor: "#2563eb",
          backgroundColor: "rgba(37, 99, 235, 0.12)",
          tension: 0.35,
          spanGaps: true,
          fill: true,
        },
        {
          label: "AYT net",
          data: aytData,
          borderColor: "#0d9488",
          backgroundColor: "rgba(13, 148, 136, 0.1)",
          tension: 0.35,
          spanGaps: true,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#334155", font: { weight: "600" } } },
      },
      scales: {
        x: { ticks: { color: "#64748b", maxRotation: 40 } },
        y: { beginAtZero: true, ticks: { color: "#64748b" } },
      },
    },
  });
  renderTrendIvme(last5, tytData, aytData);
}

function renderTrendIvme(last5, tytData, aytData) {
  var el = document.getElementById("goTrendIvme");
  if (!el) return;
  if (!last5 || !last5.length) {
    el.textContent = "";
    return;
  }
  function delta(arr) {
    var v = (arr || []).filter(function (x) {
      return x != null && !isNaN(Number(x));
    });
    if (v.length < 2) return null;
    var a = Number(v[0]);
    var b = Number(v[v.length - 1]);
    return b - a;
  }
  var dTyt = delta(tytData);
  var dAyt = delta(aytData);
  var parts = [];
  if (dTyt != null) {
    parts.push(
      "<strong>TYT ivme:</strong> <span class=\"" +
        (dTyt >= 0 ? "go-ivme--up" : "go-ivme--down") +
        "\">" +
        (dTyt >= 0 ? "+" : "") +
        dTyt.toFixed(1) +
        " net</span>"
    );
  }
  if (dAyt != null) {
    parts.push(
      "<strong>AYT ivme:</strong> <span class=\"" +
        (dAyt >= 0 ? "go-ivme--up" : "go-ivme--down") +
        "\">" +
        (dAyt >= 0 ? "+" : "") +
        dAyt.toFixed(1) +
        " net</span>"
    );
  }
  el.innerHTML =
    parts.length > 0
      ? parts.join(" · ")
      : "<span>İvmeyi görmek için aynı türden (TYT veya AYT) en az iki deneme kaydı gerekir.</span>";
}

function startYksCountdown() {
  var el = document.getElementById("goCountdownText");
  if (!el) return;
  var exam = new Date("2026-06-20T10:15:00");
  function tick() {
    var now = new Date();
    var ms = exam.getTime() - now.getTime();
    if (ms <= 0) {
      el.textContent = "Sınav günü!";
      return;
    }
    var s = Math.floor(ms / 1000);
    var days = Math.floor(s / 86400);
    var h = Math.floor((s % 86400) / 3600);
    var m = Math.floor((s % 3600) / 60);
    var sec = s % 60;
    el.textContent =
      days + " gün · " + String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0") + ":" + String(sec).padStart(2, "0");
  }
  if (goCountdownTimer) clearInterval(goCountdownTimer);
  tick();
  goCountdownTimer = setInterval(tick, 1000);
}

function findProgramForStudent(st) {
  var uName = String(st.targetUniversity || "").trim();
  var pName = String(st.targetDepartment || "").trim();
  if (!uName || !pName) return null;
  var unis = getHedefAppwriteUniversities();
  var uni = unis.find(function (u) {
    return normTr(hedefUniDisplayName(u)) === normTr(uName);
  });
  if (!uni) {
    uni = unis.find(function (u) {
      return normTr(hedefUniDisplayName(u)).indexOf(normTr(uName)) !== -1;
    });
  }
  if (!uni) return null;
  var progs = getAllHedefPrograms().filter(function (p) {
    return String(p.uniId) === String(uni.$id);
  });
  var prog = progs.find(function (p) {
    return normTr(hedefProgramDisplayName(p)) === normTr(pName);
  });
  if (!prog) {
    prog = progs.find(function (p) {
      return normTr(hedefProgramDisplayName(p)).indexOf(normTr(pName)) !== -1;
    });
  }
  if (!prog) return null;
  return buildProgramFromAppwriteV2(uni, prog);
}

function renderHedefBars(program, exams, studentAlan) {
  var root = document.getElementById("goHedefBars");
  if (!root) return;
  root.innerHTML = "";
  if (!program) {
    root.innerHTML =
      '<p class="go-muted">Öğrenci kartında hedef üniversite / bölüm seçili değil veya yks-data.json eşleşmesi yok.</p>';
    return;
  }
  var resolver = createCurrentNetForRowResolver(exams, studentAlan);
  var rows = program.rows || [];
  var html = "";
  rows.slice(0, 8).forEach(function (r) {
    var cap = Number(r.targetNet) || 0;
    var cur =
      typeof resolver === "function"
        ? resolver(r, cap, cap, String(r.section) + "_" + String(r.name))
        : 0;
    if (isNaN(cur)) cur = 0;
    cur = Math.round(Math.min(cap, Math.max(0, cur)) * 10) / 10;
    var pct = cap > 0 ? Math.min(100, Math.round((cur / cap) * 100)) : 0;
    var warn = cur < cap * 0.85;
    html +=
      '<div class="go-hedef-row">' +
      '<div class="go-hedef-row__top"><span>' +
      escapeHtml(r.label || r.name) +
      '</span><span class="go-hedef-row__meta">' +
      cur.toFixed(1) +
      " / " +
      cap.toFixed(1) +
      "</span></div>" +
      '<div class="go-progress"><div class="go-progress__fill ' +
      (warn ? "go-progress__fill--warn" : "") +
      '" style="width:' +
      pct +
      '%"></div></div></div>';
  });
  if (!html) {
    html = '<p class="go-muted">Hedef satırı bulunamadı.</p>';
  }
  root.innerHTML = html;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderKarnesi(_tasks) {
  try {
    if (typeof window.refreshGoHpWeeklyView === "function") window.refreshGoHpWeeklyView();
  } catch (e) {}
}

function coachTasksForStudentWeek(getTasks, studentId, weekMonday) {
  var sid = String(studentId || "").trim();
  if (!sid || !weekMonday) return [];
  var mon = new Date(weekMonday.getTime());
  mon.setHours(12, 0, 0, 0);
  var end = new Date(mon.getTime());
  end.setDate(end.getDate() + 6);
  var a = hpLocalISODate(mon);
  var b = hpLocalISODate(end);
  return getTasks().filter(function (t) {
    if (String(t.studentId || "") !== sid) return false;
    var d = String(t.dueDate || "").slice(0, 10);
    return d >= a && d <= b;
  });
}

function lastWeekMonday() {
  var thisMon = hpMondayOfWeek(new Date());
  var d = new Date(thisMon.getTime());
  d.setDate(d.getDate() - 7);
  return d;
}

function meetingSavedAtMs(data) {
  if (!data) return 0;
  var t = data.saved_at;
  if (t == null) return 0;
  if (typeof t.toMillis === "function") {
    try {
      return t.toMillis();
    } catch (_e) {}
  }
  if (typeof t === "string") {
    var ms = Date.parse(t);
    return isNaN(ms) ? 0 : ms;
  }
  if (typeof t === "number") return t;
  return 0;
}

async function loadMeetingNote(getCoachId, studentId) {
  var cid = getCoachId();
  var sid = String(studentId || "").trim();
  if (!cid || !sid) return "";
  try {
    var snap = await getDocs(
      query(collection(db, APPWRITE_COLLECTION_MEETING_LOGS), where("student_id", "==", sid))
    );
    var best = null;
    var bestMs = -1;
    snap.docs.forEach(function (d) {
      var data = typeof d.data === "function" ? d.data() : {};
      if (String(data.coach_id || "") !== String(cid)) return;
      var ms = meetingSavedAtMs(data);
      if (!best || ms > bestMs) {
        best = data;
        bestMs = ms;
      }
    });
    return best ? String(best.body_html || best.bodyHtml || "") : "";
  } catch (_e) {
    return "";
  }
}

async function saveMeetingNote(getCoachId, studentId, html, studentName) {
  var cid = getCoachId();
  var sid = String(studentId || "").trim();
  if (!cid || !sid) throw new Error("Oturum veya öğrenci yok.");
  await addDoc(collection(db, APPWRITE_COLLECTION_MEETING_LOGS), {
    coach_id: cid,
    student_id: sid,
    student_name: String(studentName || "").slice(0, 500),
    body_html: String(html || ""),
    saved_at: serverTimestamp(),
  });
}

function goBuildWeekGoalMeta(titleLine) {
  return JSON.stringify({
    v: 1,
    gorevTipi: "genel_tekrar",
    taskType: "konu",
    topic: String(titleLine || "").trim(),
    notes: "Görüşme Odası — yeni hafta reçetesi",
    resource: "",
    videoUrl: "",
    targetQuestions: null,
    estimatedMinutes: null,
  });
}

function ensureQuill() {
  if (goQuill || typeof Quill === "undefined") return goQuill;
  var ed = document.getElementById("goMeetingNotesEditor");
  if (!ed) return null;
  goQuill = new Quill("#goMeetingNotesEditor", {
    theme: "snow",
    placeholder: "Görüşme notları…",
  });
  return goQuill;
}

export function initGorusmeOdasiCockpit() {
  var sel = document.getElementById("goStudentSelect");
  if (!sel || sel.dataset.goBound) return;
  sel.dataset.goBound = "1";

  var panel = window.YKSPanel;
  if (!panel || typeof panel.navigate !== "function") return;

  function getStudents() {
    return typeof panel.getCachedStudents === "function" ? panel.getCachedStudents() : [];
  }
  function getExams() {
    return typeof panel.getCachedExams === "function" ? panel.getCachedExams() : [];
  }
  function getTasks() {
    return typeof panel.getCachedCoachTasks === "function" ? panel.getCachedCoachTasks() : [];
  }
  function getCoachId() {
    return typeof panel.getCoachId === "function" ? panel.getCoachId() : "";
  }
  function toast(msg) {
    if (typeof panel.toast === "function") panel.toast(msg);
  }

  function fillStudentSelect() {
    var keep = sel.value;
    sel.innerHTML = '<option value="">— Öğrenci seçin —</option>';
    getStudents().forEach(function (s) {
      var o = document.createElement("option");
      o.value = s.id;
      o.textContent = s.name || s.studentName || "Öğrenci";
      sel.appendChild(o);
    });
    if (keep && getStudents().some(function (x) { return x.id === keep; })) sel.value = keep;
  }

  function resolveAvatar(st) {
    var raw = st && st.avatarUrl;
    if (raw && String(raw).indexOf("http") === 0) return raw;
    if (raw && String(raw).indexOf("data:") === 0) return raw;
    var g = (st && st.gender) || "Erkek";
    var pool =
      g === "Kadın" || g === "Kadin"
        ? "https://api.dicebear.com/7.x/avataaars/png?seed=" +
          encodeURIComponent("yks_go_" + String(st.id || "x")) +
          "&size=128&backgroundColor=" +
          "ffd5dc"
        : "https://api.dicebear.com/7.x/avataaars/png?seed=" +
          encodeURIComponent("yks_go_" + String(st.id || "x")) +
          "&size=128&backgroundColor=" +
          "b6e3f4";
    return pool;
  }

  var weakTopicsCache = [];

  function refreshAll() {
    fillStudentSelect();
    var sid = String(sel.value || "").trim();
    var st = getStudents().find(function (x) {
      return x.id === sid;
    });
    var img = document.getElementById("goAvatar");
    var nameEl = document.getElementById("goStudentName");
    var tgtLine = document.getElementById("goTargetLine");
    if (!st) {
      if (img) img.removeAttribute("src");
      if (nameEl) nameEl.textContent = "—";
      if (tgtLine) tgtLine.textContent = "Hedef: —";
      destroyTrendChart();
      document.getElementById("goWeakList").innerHTML = "";
      document.getElementById("goHedefBars").innerHTML = "";
      var kOld = document.getElementById("goKarnesiBody");
      if (kOld) kOld.innerHTML = "";
      try {
        if (typeof window.refreshGoHpWeeklyView === "function") window.refreshGoHpWeeklyView();
      } catch (e) {}
      weakTopicsCache = [];
      return;
    }
    if (img) {
      img.src = resolveAvatar(st);
      img.alt = st.name || "";
    }
    if (nameEl) nameEl.textContent = st.name || st.studentName || "—";
    if (tgtLine) {
      tgtLine.textContent =
        "Hedef: " +
        (String(st.targetUniversity || "").trim() || "—") +
        " · " +
        (String(st.targetDepartment || "").trim() || "—");
    }
    startYksCountdown();

    var exList = examsForStudent(getExams, sid)
      .slice()
      .sort(function (a, b) {
        return examDateSortKey(b).localeCompare(examDateSortKey(a));
      });
    var last5 = exList.slice(0, 5).slice().reverse();
    renderTrendChart(last5);

    var studentAlan = normalizeStudentYksAlanKey(st);
    var weakAgg = aggregateWeakestBranches(
      exList.slice(0, 5),
      studentAlan
    ).slice(0, 3);
    var weakUl = document.getElementById("goWeakList");
    weakTopicsCache = [];
    weakUl.innerHTML = "";
    weakAgg.forEach(function (w, wi) {
      var mc = branchToMufredatCourse(w.examMode, w.branchKey, w.label);
      var topic = pickTopicForCourseWeak(mc.exam, mc.course, wi);
      var disp =
        (mc.exam === "TYT" ? "TYT" : "AYT") +
        " " +
        shortCourseName(mc.course) +
        " - " +
        (topic || w.label);
      weakTopicsCache.push({
        exam: mc.exam,
        subject: mc.course,
        topic: topic || w.label,
        display: disp,
      });
      var li = document.createElement("li");
      li.className = "go-weak-list__item";
      li.innerHTML =
        '<span class="go-weak-badge" aria-hidden="true">🚨</span><span class="go-weak-list__txt">' +
        escapeHtml(disp) +
        "</span>";
      weakUl.appendChild(li);
    });
    if (!weakAgg.length) {
      weakUl.innerHTML = '<li class="go-muted" style="background:#f8fafc;border-color:#e2e8f0;color:#64748b">Son denemelerde branş detayı yok; optik/karne kaydından sonra radar dolacak.</li>';
    }

    ensureHedefSimulatorAppwriteData().then(function () {
      var prog = findProgramForStudent(st);
      renderHedefBars(prog, exList, studentAlan);
    });

    var prevWeek = lastWeekMonday();
    var tasks = coachTasksForStudentWeek(getTasks, sid, prevWeek);
    renderKarnesi(tasks);

    ensureQuill();
    if (goQuill) {
      loadMeetingNote(getCoachId, sid).then(function (html) {
        goQuill.root.innerHTML = html || "";
        var el = document.getElementById("goNotesSavedAt");
        if (el) el.textContent = "";
      });
    }
  }

  sel.addEventListener("change", refreshAll);

  window.addEventListener("go-cockpit-refresh", refreshAll);

  ensureQuill();

  document.getElementById("goBtnSaveNotes").addEventListener("click", function () {
    var sid = String(sel.value || "").trim();
    var st = getStudents().find(function (x) {
      return x.id === sid;
    });
    if (!st || !goQuill) {
      toast("Öğrenci seçin.");
      return;
    }
    var html = goQuill.root.innerHTML;
    saveMeetingNote(getCoachId, sid, html, st.name || st.studentName || "")
      .then(function () {
        var el = document.getElementById("goNotesSavedAt");
        if (el) el.textContent = "Kaydedildi · " + new Date().toLocaleString("tr-TR");
        toast("Görüşme notu kaydedildi.");
      })
      .catch(function (e) {
        console.error(e);
        toast("Kayıt hatası: " + (e && e.message ? e.message : ""));
      });
  });

  document.getElementById("goBtnAddWeekGoals").addEventListener("click", function () {
    var sid = String(sel.value || "").trim();
    var st = getStudents().find(function (x) {
      return x.id === sid;
    });
    if (!st) {
      toast("Öğrenci seçin.");
      return;
    }
    var g1 = (document.getElementById("goWeekGoal1") && document.getElementById("goWeekGoal1").value) || "";
    var g2 = (document.getElementById("goWeekGoal2") && document.getElementById("goWeekGoal2").value) || "";
    var g3 = (document.getElementById("goWeekGoal3") && document.getElementById("goWeekGoal3").value) || "";
    var lines = [g1, g2, g3].map(function (x) { return String(x).trim(); }).filter(Boolean);
    if (!lines.length) {
      toast("En az bir hedef yazın.");
      return;
    }
    var nextMon = hpMondayOfWeek(new Date());
    var today = new Date();
    today.setHours(12, 0, 0, 0);
    if (nextMon <= today) nextMon.setDate(nextMon.getDate() + 7);
    var cid = getCoachId();
    var sname = String(st.name || st.studentName || "").trim();
    var chain = Promise.resolve();
    lines.forEach(function (title, idx) {
      chain = chain.then(function () {
        var due = new Date(nextMon.getTime());
        due.setDate(due.getDate() + idx);
        return addDoc(collection(db, "coach_tasks"), {
          coach_id: cid,
          title: title,
          description: goBuildWeekGoalMeta(title),
          studentId: sid,
          studentName: sname,
          dueDate: hpLocalISODate(due),
          priority: "normal",
          subject: "Genel",
          column: "todo",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      });
    });
    chain
      .then(function () {
        toast("Haftalık hedefler görev olarak eklendi.");
        ["goWeekGoal1", "goWeekGoal2", "goWeekGoal3"].forEach(function (id) {
          var el = document.getElementById(id);
          if (el) el.value = "";
        });
      })
      .catch(function (e) {
        console.error(e);
        toast("Görev eklenemedi.");
      });
  });

  document.getElementById("goBtnTestmakerWeak").addEventListener("click", function () {
    var sid = String(sel.value || "").trim();
    if (!sid) {
      toast("Öğrenci seçin.");
      return;
    }
    if (!weakTopicsCache.length) {
      toast("Önce kanayan yara listesi oluşmalı (branş detaylı deneme gerekir).");
      return;
    }
    var first = weakTopicsCache[0];
    var payload = {
      exam: first.exam,
      subject: first.subject,
      topic: first.topic,
      display: first.display,
      studentId: sid,
      allTopics: weakTopicsCache.slice(),
    };
    try {
      sessionStorage.setItem("gorusmeOdasiAiPrefill", JSON.stringify(payload));
    } catch (e) {}
    panel.navigate("auto-test");
    toast("TestMaker AI ekranına yönlendirildi; ilk zayıf konu seçildi.");
  });

  panel.onNavigate(function (view) {
    if (view === "gorusme-odasi") {
      fillStudentSelect();
      refreshAll();
    }
  });

  fillStudentSelect();
}
