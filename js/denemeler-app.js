/**
 * Deneme Analizi — Denemeler listesi + Yeni deneme (Exams / Lessons / Topics, Appwrite).
 */
import { ID, Query } from "./appwrite-browser.js";
import {
  databases,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_EXAMS,
  APPWRITE_COLLECTION_LESSONS,
  APPWRITE_COLLECTION_TOPICS,
} from "./appwrite-config.js";
import { logAppwriteError } from "./appwrite-compat.js";

var STATUS_PLAN = "Planlandı";
var STATUS_READ = "Okunuyor";
var STATUS_DONE = "Bitti";

function esc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function attr(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;");
}

function formatExamDate(iso) {
  if (!iso) return "—";
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return esc(String(iso));
    return esc(
      d.toLocaleString("tr-TR", {
        day: "2-digit",
        month: "short",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    );
  } catch (e) {
    return esc(String(iso));
  }
}

function statusPill(status) {
  var s = String(status || "").trim();
  var cfg =
    s === STATUS_PLAN
      ? { emoji: "🔴", label: STATUS_PLAN, cls: "dnm-pill--plan" }
      : s === STATUS_READ
        ? { emoji: "🟡", label: STATUS_READ, cls: "dnm-pill--read" }
        : s === STATUS_DONE
          ? { emoji: "🟢", label: STATUS_DONE, cls: "dnm-pill--done" }
          : { emoji: "", label: s || "—", cls: "dnm-pill--muted" };
  return (
    '<span class="dnm-pill ' +
    cfg.cls +
    '">' +
    (cfg.emoji ? '<span class="dnm-pill__dot" aria-hidden="true">' + cfg.emoji + "</span>" : "") +
    '<span class="dnm-pill__txt">' +
    esc(cfg.label) +
    "</span></span>"
  );
}

/**
 * @param {{ showToast: function, getCoachId: function(): string }} ctx
 */
export function initDenemelerPage(ctx) {
  var showToast = ctx && typeof ctx.showToast === "function" ? ctx.showToast : function () {};
  var getCoachId =
    ctx && typeof ctx.getCoachId === "function"
      ? ctx.getCoachId
      : function () {
          return "";
        };

  var root = document.getElementById("view-deneme-analiz-denemeler");
  if (!root || root.dataset.dnmBound === "1") return;
  root.dataset.dnmBound = "1";

  var lessonsCache = [];
  var topicsCache = [];
  var matrixRowCount = 0;

  var elLoad = document.getElementById("dnmLoading");
  var elErr = document.getElementById("dnmError");
  var elBody = document.getElementById("dnmTableBody");
  var elEmpty = document.getElementById("dnmEmpty");
  var elWrap = document.getElementById("dnmTableWrap");
  var btnNew = document.getElementById("btnDnmNewExam");
  var modal = document.getElementById("dnmModal");
  var elModalFetchErr = document.getElementById("dnmModalFetchErr");
  var inpName = document.getElementById("dnmExamName");
  var inpDate = document.getElementById("dnmExamDate");
  var selType = document.getElementById("dnmExamType");
  var inpQ = document.getElementById("dnmQCount");
  var btnMatrix = document.getElementById("btnDnmBuildMatrix");
  var tblMatrix = document.getElementById("dnmMatrixTable");
  var bodyMatrix = document.getElementById("dnmMatrixBody");
  var btnSave = document.getElementById("btnDnmSave");

  function setLoading(on) {
    if (elLoad) elLoad.hidden = !on;
    if (elWrap && elBody) {
      elWrap.style.opacity = on ? "0.45" : "1";
      elWrap.style.pointerEvents = on ? "none" : "";
    }
  }

  function showListError(msg) {
    if (elErr) {
      elErr.textContent = msg || "";
      elErr.hidden = !msg;
    }
  }

  async function fetchLessons() {
    var res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_LESSONS, [
      Query.limit(500),
    ]);
    var docs = (res && res.documents) || [];
    docs.sort(function (a, b) {
      return String(a.lessonName || "").localeCompare(String(b.lessonName || ""), "tr");
    });
    return docs;
  }

  async function fetchTopics() {
    var res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_TOPICS, [
      Query.limit(2000),
    ]);
    var docs = (res && res.documents) || [];
    docs.sort(function (a, b) {
      return String(a.topicName || "").localeCompare(String(b.topicName || ""), "tr");
    });
    return docs;
  }

  async function fetchExamsForCoach() {
    var cid = String(getCoachId() || "").trim();
    var res;
    try {
      var queries = [Query.limit(500)];
      if (cid) queries.unshift(Query.equal("coach_id", cid));
      res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_EXAMS, queries);
    } catch (err) {
      if (cid) {
        logAppwriteError("denemeler-app.js/fetchExamsForCoach/fallback", err);
        res = await databases.listDocuments(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_EXAMS, [
          Query.limit(500),
        ]);
      } else {
        throw err;
      }
    }
    var docs = (res && res.documents) || [];
    if (cid) {
      docs = docs.filter(function (d) {
        var x = d.coach_id != null ? d.coach_id : d.coachId;
        if (x === undefined || x === null || String(x).trim() === "") return false;
        return String(x) === cid;
      });
    }
    docs.sort(function (a, b) {
      var ta = new Date(a.date || a.$createdAt || 0).getTime();
      var tb = new Date(b.date || b.$createdAt || 0).getTime();
      return tb - ta;
    });
    return docs;
  }

  async function loadExamsList() {
    showListError("");
    setLoading(true);
    if (elEmpty) elEmpty.hidden = true;
    if (elBody) elBody.innerHTML = "";
    try {
      var docs = await fetchExamsForCoach();
      if (!docs.length) {
        if (elEmpty) elEmpty.hidden = false;
        setLoading(false);
        return;
      }
      if (elEmpty) elEmpty.hidden = true;
      var frag = document.createDocumentFragment();
      docs.forEach(function (d) {
        var tr = document.createElement("tr");
        tr.className = "dnm-tr";
        var id = d.$id || d.id || "";
        tr.innerHTML =
          '<td class="dnm-td dnm-td--name"><span class="dnm-cell-title">' +
          esc(d.examName || "—") +
          "</span></td>" +
          '<td class="dnm-td dnm-td--muted">' +
          formatExamDate(d.date) +
          "</td>" +
          '<td class="dnm-td">' +
          esc(d.type || "—") +
          "</td>" +
          '<td class="dnm-td">' +
          statusPill(d.status) +
          "</td>" +
          '<td class="dnm-td dnm-td--actions"><button type="button" class="dnm-icon-btn dnm-icon-btn--danger" data-dnm-del="' +
          attr(id) +
          '" title="Sil"><i class="fa-solid fa-trash" aria-hidden="true"></i></button></td>';
        frag.appendChild(tr);
      });
      elBody.appendChild(frag);
    } catch (err) {
      logAppwriteError("denemeler-app.js/loadExamsList", err);
      showListError(
        "Denemeler yüklenemedi. Koleksiyon veya izinleri kontrol edin: " +
          (err && err.message ? String(err.message) : String(err))
      );
    } finally {
      setLoading(false);
    }
  }

  window.__denemelerPageRefresh = loadExamsList;

  if (elBody) {
    elBody.addEventListener("click", async function (ev) {
      var btn = ev.target.closest && ev.target.closest("[data-dnm-del]");
      if (!btn) return;
      var id = btn.getAttribute("data-dnm-del");
      if (!id || !window.confirm("Bu denemeyi silmek istediğinize emin misiniz?")) return;
      btn.disabled = true;
      try {
        await databases.deleteDocument(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_EXAMS, id);
        showToast("Deneme silindi.", { variant: "success" });
        await loadExamsList();
      } catch (err) {
        logAppwriteError("denemeler-app.js/deleteExam", err);
        showToast("Silinemedi: " + (err && err.message ? err.message : err), { variant: "danger" });
      } finally {
        btn.disabled = false;
      }
    });
  }

  function openModal(preferredDatetimeLocal) {
    if (!modal) return;
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
    document.body.style.overflow = "hidden";
    if (inpName) inpName.value = "";
    if (inpDate) inpDate.value = preferredDatetimeLocal != null ? String(preferredDatetimeLocal) : "";
    if (selType) selType.value = "";
    if (inpQ) inpQ.value = "";
    if (bodyMatrix) bodyMatrix.innerHTML = "";
    if (tblMatrix) tblMatrix.hidden = true;
    matrixRowCount = 0;
    if (elModalFetchErr) {
      elModalFetchErr.hidden = true;
      elModalFetchErr.textContent = "";
    }
    loadModalReferenceData();
  }

  function closeModal() {
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "";
  }

  async function loadModalReferenceData() {
    if (elModalFetchErr) {
      elModalFetchErr.hidden = true;
      elModalFetchErr.textContent = "";
    }
    try {
      var pair = await Promise.all([fetchLessons(), fetchTopics()]);
      lessonsCache = pair[0];
      topicsCache = pair[1];
      if (!lessonsCache.length) {
        if (elModalFetchErr) {
          elModalFetchErr.textContent =
            "Ders listesi boş. Appwrite’da Lessons koleksiyonuna kayıt ekleyin.";
          elModalFetchErr.hidden = false;
        }
      }
    } catch (err) {
      logAppwriteError("denemeler-app.js/loadModalReferenceData", err);
      if (elModalFetchErr) {
        elModalFetchErr.textContent =
          "Ders/konu verileri alınamadı: " + (err && err.message ? err.message : err);
        elModalFetchErr.hidden = false;
      }
    }
  }

  function topicsForLesson(lessonId) {
    var lid = String(lessonId || "").trim();
    return topicsCache.filter(function (t) {
      return String(t.lessonId || "").trim() === lid;
    });
  }

  function lessonOptionsHtml(selectedId) {
    var sel = String(selectedId || "");
    var o = '<option value="">Ders seçin</option>';
    lessonsCache.forEach(function (L) {
      var id = L.$id || "";
      var nm = L.lessonName != null ? L.lessonName : "";
      o +=
        '<option value="' +
        attr(id) +
        '"' +
        (id === sel ? " selected" : "") +
        ">" +
        esc(nm || id) +
        "</option>";
    });
    return o;
  }

  function topicOptionsHtml(lessonId, selectedTopicId) {
    var list = topicsForLesson(lessonId);
    var sel = String(selectedTopicId || "");
    var o = '<option value="">Konu seçin</option>';
    list.forEach(function (T) {
      var id = T.$id || "";
      var nm = T.topicName != null ? T.topicName : "";
      o +=
        '<option value="' +
        attr(id) +
        '"' +
        (id === sel ? " selected" : "") +
        ">" +
        esc(nm || id) +
        "</option>";
    });
    return o;
  }

  function wireMatrixRow(tr) {
    var les = tr.querySelector(".dnm-sel-lesson");
    var top = tr.querySelector(".dnm-sel-topic");
    if (!les || !top) return;
    les.addEventListener("change", function () {
      top.innerHTML = topicOptionsHtml(les.value, "");
      top.disabled = !les.value;
    });
  }

  function buildMatrix() {
    var n = parseInt(String((inpQ && inpQ.value) || ""), 10);
    if (isNaN(n) || n < 1 || n > 200) {
      showToast("Soru sayısı 1–200 arasında olmalıdır.", { variant: "danger" });
      return;
    }
    if (!lessonsCache.length) {
      showToast("Önce ders verileri yüklenmeli. Sayfayı yenileyip tekrar deneyin.", { variant: "danger" });
      return;
    }
    matrixRowCount = n;
    if (!bodyMatrix || !tblMatrix) return;
    bodyMatrix.innerHTML = "";
    var frag = document.createDocumentFragment();
    var letters = ["A", "B", "C", "D", "E"];
    for (var i = 1; i <= n; i++) {
      var tr = document.createElement("tr");
      var ansOpts = letters
        .map(function (L) {
          return "<option value=\"" + L + "\">" + L + "</option>";
        })
        .join("");
      tr.innerHTML =
        '<td class="dnm-matrix-n">' +
        i +
        "</td>" +
        '<td><select class="dnm-select dnm-sel-lesson" required data-q="' +
        i +
        '">' +
        lessonOptionsHtml("") +
        "</select></td>" +
        '<td><select class="dnm-select dnm-sel-topic" required disabled data-q="' +
        i +
        '">' +
        topicOptionsHtml("", "") +
        "</select></td>" +
        '<td><select class="dnm-select dnm-sel-answer" required data-q="' +
        i +
        '">' +
        '<option value="">—</option>' +
        ansOpts +
        "</select></td>";
      wireMatrixRow(tr);
      frag.appendChild(tr);
    }
    bodyMatrix.appendChild(frag);
    tblMatrix.hidden = false;
  }

  function collectMatrixPayload() {
    var rows = [];
    if (!bodyMatrix || matrixRowCount < 1) return { ok: false, err: "Önce matrisi oluşturun." };
    for (var i = 1; i <= matrixRowCount; i++) {
      var les = bodyMatrix.querySelector('.dnm-sel-lesson[data-q="' + i + '"]');
      var top = bodyMatrix.querySelector('.dnm-sel-topic[data-q="' + i + '"]');
      var ans = bodyMatrix.querySelector('.dnm-sel-answer[data-q="' + i + '"]');
      if (!les || !top || !ans) return { ok: false, err: "Tablo eksik." };
      var lessonId = String(les.value || "").trim();
      var topicId = String(top.value || "").trim();
      var answer = String(ans.value || "").trim();
      if (!lessonId || !topicId || !answer) {
        return { ok: false, err: "Soru " + i + ": ders, konu ve cevap seçilmeli." };
      }
      rows.push({
        n: i,
        lessonId: lessonId,
        topicId: topicId,
        answer: answer,
      });
    }
    return { ok: true, rows: rows };
  }

  async function saveExam() {
    var name = (inpName && inpName.value.trim()) || "";
    var dateVal = (inpDate && inpDate.value) || "";
    var typ = (selType && selType.value) || "";
    if (!name || !dateVal || !typ) {
      showToast("Deneme adı, tarih ve yayın türü zorunludur.", { variant: "danger" });
      return;
    }
    var matrix = collectMatrixPayload();
    if (!matrix.ok) {
      showToast(matrix.err || "Matris geçersiz.", { variant: "danger" });
      return;
    }
    var isoDate;
    try {
      isoDate = new Date(dateVal).toISOString();
    } catch (e) {
      showToast("Tarih geçersiz.", { variant: "danger" });
      return;
    }
    var cid = String(getCoachId() || "").trim();
    var answerKeyJson = JSON.stringify(matrix.rows);
    var payload = {
      examName: name,
      date: isoDate,
      type: typ,
      status: STATUS_PLAN,
      answerKey: answerKeyJson,
    };
    if (cid) payload.coach_id = cid;

    if (btnSave) btnSave.disabled = true;
    try {
      await databases.createDocument(
        APPWRITE_DATABASE_ID,
        APPWRITE_COLLECTION_EXAMS,
        ID.unique(),
        payload
      );
      showToast("Deneme kaydedildi.", { variant: "success" });
      closeModal();
      await loadExamsList();
      if (typeof window.__danaTakvimRefreshExams === "function") {
        try {
          await window.__danaTakvimRefreshExams();
        } catch (eR) {
          void eR;
        }
      }
    } catch (err) {
      logAppwriteError("denemeler-app.js/saveExam", err);
      showToast("Kayıt başarısız: " + (err && err.message ? err.message : err), { variant: "danger" });
    } finally {
      if (btnSave) btnSave.disabled = false;
    }
  }

  if (btnNew) btnNew.addEventListener("click", function () {
    openModal("");
  });

  window.__denemelerOpenNewExamModal = function (preferredDatetimeLocal) {
    openModal(preferredDatetimeLocal != null ? preferredDatetimeLocal : "");
  };
  if (btnMatrix) btnMatrix.addEventListener("click", buildMatrix);
  if (btnSave) btnSave.addEventListener("click", function () { saveExam(); });

  modal &&
    modal.addEventListener("click", function (ev) {
      if (ev.target.getAttribute && ev.target.getAttribute("data-dnm-close") != null) closeModal();
    });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && modal && !modal.hidden) closeModal();
  });
}
