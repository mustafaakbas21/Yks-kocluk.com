/**
 * Profesyonel deneme tanımı — Appwrite `exam_definitions`, konu hiyerarşisi + cevap anahtarı.
 */
import { YKS_TYT_BRANCHES, YKS_AYT_BY_ALAN } from "./yks-exam-structure.js";
import {
  collection,
  addDoc,
  getDocs,
  query,
  where,
  db,
  serverTimestamp,
} from "./appwrite-compat.js";

export const EXAM_DEFINITIONS_COLLECTION = "exam_definitions";

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function buildExamQuestionMeta(examType, aytAlan) {
  var branches = [];
  var q = 0;
  if (String(examType).toUpperCase() === "TYT") {
    YKS_TYT_BRANCHES.forEach(function (br) {
      var startQ = q + 1;
      q += br.soru;
      branches.push({
        id: br.id,
        label: br.label,
        soru: br.soru,
        startQ: startQ,
        endQ: q,
        topics: (br.konular || []).map(function (t, i) {
          return { id: br.id + "_k" + i, label: t };
        }),
      });
    });
  } else {
    var pack = YKS_AYT_BY_ALAN[aytAlan || "sayisal"] || YKS_AYT_BY_ALAN.sayisal;
    pack.branches.forEach(function (br) {
      var startQ = q + 1;
      q += br.soru;
      branches.push({
        id: br.id,
        label: br.label,
        soru: br.soru,
        startQ: startQ,
        endQ: q,
        topics: (br.konular || []).map(function (t, i) {
          return { id: br.id + "_k" + i, label: t };
        }),
      });
    });
  }
  return { examType: String(examType).toUpperCase(), aytAlan: aytAlan || null, branches: branches, totalQuestions: q };
}

function normalizeAnswerKey(raw, n) {
  var s = String(raw || "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .replace(/[^ABCDE.]/g, "");
  if (s.length < n) return { ok: false, err: "Cevap anahtarı en az " + n + " karakter olmalı (A–E veya . boş için)." };
  s = s.slice(0, n);
  var out = "";
  for (var i = 0; i < n; i++) {
    var c = s.charAt(i);
    out += /[ABCDE]/.test(c) ? c : ".";
  }
  return { ok: true, key: out };
}

function renderTopicHierarchy(meta) {
  var h = '<div class="exam-def-topics">';
  meta.branches.forEach(function (b) {
    h += '<details class="exam-def-topic-group" open>';
    h +=
      "<summary><strong>" +
      esc(b.label) +
      "</strong> · Soru " +
      b.startQ +
      "–" +
      b.endQ +
      " (" +
      b.soru +
      ")</summary>";
    h += '<ul class="exam-def-topic-list">';
    b.topics.forEach(function (t) {
      h += "<li>" + esc(t.label) + "</li>";
    });
    h += "</ul></details>";
  });
  h += "</div>";
  return h;
}

export async function loadExamDefinitionsForCoach(getCoachId) {
  var cid = getCoachId();
  if (!cid) return [];
  try {
    var q = query(collection(db, EXAM_DEFINITIONS_COLLECTION), where("coach_id", "==", cid));
    var snap = await getDocs(q);
    var out = [];
    snap.forEach(function (d) {
      var data = typeof d.data === "function" ? d.data() : {};
      out.push({
        id: d.id,
        examName: data.examName || "",
        examCode: data.examCode || "",
        examDate: data.examDate || "",
        examType: data.examType || "TYT",
      });
    });
    out.sort(function (a, b) {
      return String(b.examDate || "").localeCompare(String(a.examDate || ""));
    });
    return out;
  } catch (e) {
    console.warn("[exam_definitions] list", e);
    return [];
  }
}

function fillExternalSelects(list) {
  ["daLinkExamDef", "optikLinkExamDef"].forEach(function (id) {
    var sel = document.getElementById(id);
    if (!sel) return;
    var keep = sel.value;
    sel.innerHTML = '<option value="">— Şablon yok —</option>';
    list.forEach(function (x) {
      var o = document.createElement("option");
      o.value = x.id;
      o.textContent = (x.examCode || x.examName || x.id).slice(0, 80);
      sel.appendChild(o);
    });
    if (keep && Array.prototype.some.call(sel.options, function (opt) { return opt.value === keep; })) {
      sel.value = keep;
    }
  });
}

/**
 * @param {{ getCoachId: function, showToast: function, onListChanged?: function }} ctx
 */
export function initExamDefinitionProfessionalUI(ctx) {
  var root = document.getElementById("examDefProRoot");
  if (!root || root.dataset.examDefBound) return;
  root.dataset.examDefBound = "1";

  root.innerHTML =
    '<div class="exam-def-pro">' +
    '<h3 class="exam-def-pro__title"><i class="fa-solid fa-clipboard-list"></i> Profesyonel deneme tanımı</h3>' +
    '<p class="exam-def-pro__lead">TYT / AYT yapısı ÖSYM soru sayılarına göre üretilir. Konular <code>yks-exam-structure</code> ile eşlenir; Appwrite’da <strong>' +
    esc(EXAM_DEFINITIONS_COLLECTION) +
    "</strong> koleksiyonuna yazılır.</p>" +
    '<div class="exam-def-pro__grid">' +
    '<label class="exam-def-pro__field"><span>Deneme adı</span><input type="text" id="examDefName" maxlength="200" placeholder="Örn. Kurum TYT-5" /></label>' +
    '<label class="exam-def-pro__field"><span>Deneme kodu</span><input type="text" id="examDefCode" maxlength="64" placeholder="Örn. KRM-TYT-2026-05" /></label>' +
    '<label class="exam-def-pro__field"><span>Deneme tarihi</span><input type="date" id="examDefDate" /></label>' +
    '<label class="exam-def-pro__field"><span>Deneme tipi</span>' +
    '<select id="examDefType"><option value="TYT">TYT (120 soru)</option><option value="AYT">AYT</option></select></label>' +
    '<label class="exam-def-pro__field" id="examDefAytAlanWrap" hidden><span>AYT alanı</span>' +
    '<select id="examDefAytAlan">' +
    '<option value="sayisal">Sayısal</option>' +
    '<option value="esit_agirlik">Eşit ağırlık</option>' +
    '<option value="sozel">Sözel</option>' +
    '<option value="dil">Dil</option>' +
    "</select></label>" +
    "</div>" +
    '<div class="exam-def-pro__counts" id="examDefCounts"></div>' +
    '<div class="exam-def-pro__topics-wrap"><h4>Konu hiyerarşisi</h4><div id="examDefTopicTree"></div></div>' +
    '<label class="exam-def-pro__field exam-def-pro__field--full"><span>Cevap anahtarı (ardışık ' +
    '<span id="examDefKeyLen">0</span> harf: A–E veya . boş)</span>' +
    '<textarea id="examDefAnswerKey" rows="4" placeholder="Örn. AABDEC..."></textarea></label>' +
    '<p class="exam-def-pro__hint" id="examDefKeyHint"></p>' +
    '<div class="exam-def-pro__actions">' +
    '<button type="button" class="btn btn--purple" id="examDefSaveBtn"><i class="fa-solid fa-cloud-arrow-up"></i> Appwrite’a kaydet</button>' +
    '<button type="button" class="btn btn-eds-secondary" id="examDefResetBtn">Formu temizle</button>' +
    "</div>" +
    '<div class="exam-def-pro__saved"><h4>Kayıtlı şablonlar</h4><ul id="examDefSavedList" class="exam-def-saved-list"></ul></div>' +
    "</div>";

  var typeEl = document.getElementById("examDefType");
  var alanEl = document.getElementById("examDefAytAlan");
  var alanWrap = document.getElementById("examDefAytAlanWrap");
  var countsEl = document.getElementById("examDefCounts");
  var treeEl = document.getElementById("examDefTopicTree");
  var keyEl = document.getElementById("examDefAnswerKey");
  var keyLenEl = document.getElementById("examDefKeyLen");
  var keyHintEl = document.getElementById("examDefKeyHint");

  function currentMeta() {
    var t = typeEl && typeEl.value === "AYT" ? "AYT" : "TYT";
    var alan = t === "AYT" && alanEl ? alanEl.value : "sayisal";
    return buildExamQuestionMeta(t, alan);
  }

  function refreshMetaUi() {
    var meta = currentMeta();
    if (alanWrap) alanWrap.hidden = meta.examType !== "AYT";
    var chips = meta.branches
      .map(function (b) {
        return (
          '<span class="exam-def-chip">' + esc(b.label) + " · " + b.soru + " soru</span>"
        );
      })
      .join("");
    if (countsEl) countsEl.innerHTML = '<div class="exam-def-chips">' + chips + "</div>";
    if (treeEl) treeEl.innerHTML = renderTopicHierarchy(meta);
    if (keyLenEl) keyLenEl.textContent = String(meta.totalQuestions);
    if (keyHintEl) {
      keyHintEl.textContent = "Toplam " + meta.totalQuestions + " soru — anahtar tam uzunlukta olmalı.";
    }
    if (keyEl) keyEl.setAttribute("maxlength", String(Math.max(400, meta.totalQuestions)));
  }

  async function refreshList() {
    var list = await loadExamDefinitionsForCoach(ctx.getCoachId);
    var ul = document.getElementById("examDefSavedList");
    if (ul) {
      ul.innerHTML = list.length
        ? list
            .map(function (x) {
              return (
                "<li><strong>" +
                esc(x.examName || x.examCode) +
                "</strong> · " +
                esc(x.examType) +
                " · " +
                esc(x.examDate || "—") +
                " <code>" +
                esc(x.examCode || "") +
                "</code></li>"
              );
            })
            .join("")
        : "<li class=\"muted\">Henüz şablon yok.</li>";
    }
    fillExternalSelects(list);
    if (typeof ctx.onListChanged === "function") ctx.onListChanged(list);
  }

  typeEl &&
    typeEl.addEventListener("change", function () {
      refreshMetaUi();
    });
  alanEl &&
    alanEl.addEventListener("change", function () {
      refreshMetaUi();
    });

  document.getElementById("examDefResetBtn") &&
    document.getElementById("examDefResetBtn").addEventListener("click", function () {
      var n = document.getElementById("examDefName");
      var c = document.getElementById("examDefCode");
      var d = document.getElementById("examDefDate");
      if (n) n.value = "";
      if (c) c.value = "";
      if (d) d.value = "";
      if (keyEl) keyEl.value = "";
      ctx.showToast("Alanlar temizlendi.");
    });

  document.getElementById("examDefSaveBtn") &&
    document.getElementById("examDefSaveBtn").addEventListener("click", async function () {
      try {
        var name = ((document.getElementById("examDefName") || {}).value || "").trim();
        var code = ((document.getElementById("examDefCode") || {}).value || "").trim();
        var dateStr = ((document.getElementById("examDefDate") || {}).value || "").trim();
        if (!name) {
          ctx.showToast("Deneme adı zorunlu.");
          return;
        }
        if (!code) {
          ctx.showToast("Deneme kodu zorunlu.");
          return;
        }
        var meta = currentMeta();
        var ak = normalizeAnswerKey((keyEl && keyEl.value) || "", meta.totalQuestions);
        if (!ak.ok) {
          ctx.showToast(ak.err || "Cevap anahtarı hatalı.");
          return;
        }
        var payload = {
          coach_id: ctx.getCoachId(),
          examName: name,
          examCode: code,
          examDate: dateStr,
          examType: meta.examType,
          aytAlan: meta.examType === "AYT" ? alanEl.value || "sayisal" : null,
          questionMetaJson: JSON.stringify(meta),
          topicHierarchyJson: JSON.stringify(meta.branches),
          answerKey: ak.key,
          totalQuestions: meta.totalQuestions,
          scoringRule: "osym",
          version: 1,
          createdAt: serverTimestamp(),
        };
        await addDoc(collection(db, EXAM_DEFINITIONS_COLLECTION), payload);
        ctx.showToast("Deneme şablonu kaydedildi.");
        if (keyEl) keyEl.value = "";
        await refreshList();
      } catch (e) {
        console.error(e);
        ctx.showToast("Kayıt başarısız: " + (e.message || e));
      }
    });

  var dd = document.getElementById("examDefDate");
  if (dd && !dd.value) dd.value = new Date().toISOString().slice(0, 10);
  refreshMetaUi();
  refreshList();
}
