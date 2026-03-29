/**
 * YKS Puan Hesaplama — koç notu kaydet / geçmiş / Appwrite silme (yks_puan_notes).
 */
import { collection, addDoc, query, where, getDocs, deleteDoc, doc, db } from "./appwrite-compat.js";
import { APPWRITE_COLLECTION_YKS_PUAN_NOTES } from "./appwrite-config.js";
import { formatDateTimeTr, parseFlexibleDate } from "./date-format.js";

var ctx = {
  showToast: function () {},
  getCoachId: function () {
    return "";
  },
};

var listenersBound = false;

function textFromDom(id) {
  var el = document.getElementById(id);
  return el && el.textContent ? String(el.textContent).trim() : "—";
}

function setBadgeText(id, val) {
  var el = document.getElementById(id);
  if (el) el.textContent = val || "—";
}

function defaultTitle() {
  try {
    return "YKS hesaplama · " + new Date().toLocaleDateString("tr-TR", { day: "2-digit", month: "long", year: "numeric" });
  } catch (e) {
    return "YKS hesaplama";
  }
}

function findSavedCard(noteId) {
  var id = String(noteId || "");
  try {
    if (typeof CSS !== "undefined" && CSS.escape) {
      return document.querySelector('[data-yks-saved-id="' + CSS.escape(id) + '"]');
    }
  } catch (e) {}
  return document.querySelector('.yks-puan-saved-card[data-yks-saved-id="' + id.replace(/"/g, "") + '"]');
}

function refreshEmptyState() {
  var grid = document.getElementById("yksPuanSavedGrid");
  var empty = document.getElementById("yksPuanSavedEmpty");
  if (!grid || !empty) return;
  var has = grid.querySelector(".yks-puan-saved-card");
  empty.hidden = !!has;
}

function refreshSaveButtonState() {
  var openBtn = document.getElementById("yksPuanSaveOpenBtn");
  if (!openBtn) return;
  var t = document.getElementById("yksPuanDashTytHam");
  var tyt = t && t.textContent ? t.textContent.trim() : "";
  openBtn.disabled = !tyt || tyt === "—";
}

function openSaveModal() {
  var modal = document.getElementById("yksPuanSaveModal");
  var titleInp = document.getElementById("yksPuanSaveTitle");
  var noteTa = document.getElementById("yksPuanSaveNote");
  if (!modal) return;
  setBadgeText("yksPuanSaveBadgeTyt", textFromDom("yksPuanDashTytHam"));
  setBadgeText("yksPuanSaveBadgeAyt", textFromDom("yksPuanDashAytHam"));
  setBadgeText("yksPuanSaveBadgeYer", textFromDom("yksPuanDashYerToplam"));
  if (titleInp) titleInp.value = defaultTitle();
  if (noteTa) noteTa.value = "";
  modal.hidden = false;
  document.body.classList.add("yks-puan-modal-open");
  try {
    if (titleInp) titleInp.focus();
  } catch (e) {}
}

function closeSaveModal() {
  var modal = document.getElementById("yksPuanSaveModal");
  if (!modal) return;
  modal.hidden = true;
  document.body.classList.remove("yks-puan-modal-open");
}

function renderSavedCard(raw, docId) {
  var title = raw.title != null ? String(raw.title) : "";
  var note = raw.coach_note != null ? String(raw.coach_note) : "";
  var tyt = raw.tyt_ham != null ? String(raw.tyt_ham) : "—";
  var ayt = raw.ayt_ham != null ? String(raw.ayt_ham) : "—";
  var alan = raw.alan_label != null ? String(raw.alan_label) : "";
  var created = raw.created_at;
  var d = parseFlexibleDate(created);
  var dateStr = d ? formatDateTimeTr(d) : "—";

  var card = document.createElement("article");
  card.className = "yks-puan-saved-card";
  card.setAttribute("data-yks-saved-id", docId);

  var del = document.createElement("button");
  del.type = "button";
  del.className = "yks-puan-saved-card__delete";
  del.setAttribute("aria-label", "Notu sil");
  del.setAttribute("data-yks-note-delete", docId);
  del.innerHTML = '<i class="fa-solid fa-trash" aria-hidden="true"></i>';

  var h = document.createElement("h4");
  h.className = "yks-puan-saved-card__title";
  h.textContent = title || "Başlıksız";

  var time = document.createElement("time");
  time.className = "yks-puan-saved-card__date";
  time.setAttribute("datetime", created || "");
  time.textContent = dateStr;

  var badges = document.createElement("div");
  badges.className = "yks-puan-saved-card__badges";
  var b1 = document.createElement("span");
  b1.className = "yks-puan-saved-mini-badge yks-puan-saved-mini-badge--tyt";
  b1.textContent = "TYT " + tyt;
  var b2 = document.createElement("span");
  b2.className = "yks-puan-saved-mini-badge yks-puan-saved-mini-badge--ayt";
  b2.textContent = "AYT " + ayt;
  if (alan) {
    var b0 = document.createElement("span");
    b0.className = "yks-puan-saved-mini-badge yks-puan-saved-mini-badge--alan";
    b0.textContent = alan.replace(/^AYT ham ·\s*/i, "").trim() || alan;
    badges.appendChild(b0);
  }
  badges.appendChild(b1);
  badges.appendChild(b2);

  var body = document.createElement("p");
  body.className = "yks-puan-saved-card__note";
  body.textContent = note || "—";

  card.appendChild(del);
  card.appendChild(h);
  card.appendChild(time);
  card.appendChild(badges);
  card.appendChild(body);

  return card;
}

async function loadSavedList() {
  var grid = document.getElementById("yksPuanSavedGrid");
  if (!grid) return;
  var cid = ctx.getCoachId();
  if (!cid) {
    grid.innerHTML = "";
    refreshEmptyState();
    return;
  }
  try {
    var snap = await getDocs(
      query(collection(db, APPWRITE_COLLECTION_YKS_PUAN_NOTES), where("coach_id", "==", cid))
    );
    var rows = [];
    snap.forEach(function (d) {
      rows.push({ id: d.id, raw: d.data() });
    });
    rows.sort(function (a, b) {
      var ta = String((a.raw && a.raw.created_at) || "");
      var tb = String((b.raw && b.raw.created_at) || "");
      return tb.localeCompare(ta);
    });
    grid.innerHTML = "";
    rows.forEach(function (r) {
      grid.appendChild(renderSavedCard(r.raw, r.id));
    });
    refreshEmptyState();
  } catch (e) {
    console.error("[yks-puan-notes] loadSavedList:", e);
    grid.innerHTML = "";
    refreshEmptyState();
  }
}

async function onSaveClick() {
  var cid = ctx.getCoachId();
  if (!cid) {
    ctx.showToast("Oturum bulunamadı; kayıt için giriş yapın.");
    return;
  }
  var titleInp = document.getElementById("yksPuanSaveTitle");
  var noteTa = document.getElementById("yksPuanSaveNote");
  var title = titleInp && titleInp.value.trim() ? titleInp.value.trim() : defaultTitle();
  var coachNote = noteTa ? String(noteTa.value || "").trim() : "";
  var alanEl = document.getElementById("yksPuanDashAytLabel");

  try {
    await addDoc(collection(db, APPWRITE_COLLECTION_YKS_PUAN_NOTES), {
      coach_id: cid,
      title: title,
      coach_note: coachNote,
      tyt_ham: textFromDom("yksPuanDashTytHam"),
      ayt_ham: textFromDom("yksPuanDashAytHam"),
      yer_toplam: textFromDom("yksPuanDashYerToplam"),
      alan_label: alanEl && alanEl.textContent ? alanEl.textContent.trim() : "",
      created_at: new Date().toISOString(),
    });
    ctx.showToast("Kayıt oluşturuldu.", { variant: "success" });
    closeSaveModal();
    await loadSavedList();
  } catch (e) {
    console.error("[yks-puan-notes] save:", e);
    ctx.showToast("Kayıt başarısız (Appwrite koleksiyonu veya izinler).");
  }
}

/**
 * Appwrite’dan notu siler; kartı animasyonla kaldırır.
 * @param {string} noteId
 * @param {HTMLElement} [cardEl]
 */
export async function deleteSavedNote(noteId, cardEl) {
  if (!noteId) return;
  var card = cardEl || findSavedCard(noteId);
  try {
    await deleteDoc(doc(db, APPWRITE_COLLECTION_YKS_PUAN_NOTES, noteId));
    if (card) {
      card.classList.add("yks-puan-saved-card--exit");
      var removed = false;
      function done() {
        if (removed) return;
        removed = true;
        try {
          card.removeEventListener("animationend", done);
        } catch (e) {}
        try {
          card.remove();
        } catch (e2) {}
        refreshEmptyState();
      }
      card.addEventListener("animationend", done);
      window.setTimeout(done, 420);
    } else {
      refreshEmptyState();
    }
    ctx.showToast("Not başarıyla silindi.", { variant: "success" });
  } catch (e) {
    console.error("[yks-puan-notes] delete:", e);
    ctx.showToast("Silinemedi (Appwrite izinleri veya ağ).");
  }
}

/**
 * @param {{ showToast?: (msg: string, opts?: { variant?: string }) => void, getCoachId?: () => string }} options
 */
export function initYksPuanNotesCoach(options) {
  options = options || {};
  ctx.showToast =
    options.showToast ||
    function (msg) {
      try {
        alert(msg);
      } catch (e) {}
    };
  ctx.getCoachId = options.getCoachId || function () {
    return "";
  };

  var form = document.getElementById("yksPuanForm");

  if (!listenersBound) {
    listenersBound = true;

    var openBtn = document.getElementById("yksPuanSaveOpenBtn");
    var modal = document.getElementById("yksPuanSaveModal");
    var backdrop = modal && modal.querySelector(".yks-puan-modal__backdrop");
    var cancelBtn = document.getElementById("yksPuanSaveModalCancel");
    var saveBtn = document.getElementById("yksPuanSaveModalSubmit");
    var grid = document.getElementById("yksPuanSavedGrid");

    if (form) {
      form.addEventListener("yks-puan:updated", refreshSaveButtonState);
    }

    if (openBtn) {
      openBtn.addEventListener("click", function () {
        if (openBtn.disabled) return;
        openSaveModal();
      });
    }
    if (backdrop) backdrop.addEventListener("click", closeSaveModal);
    if (cancelBtn) cancelBtn.addEventListener("click", closeSaveModal);
    if (saveBtn) saveBtn.addEventListener("click", onSaveClick);

    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var m = document.getElementById("yksPuanSaveModal");
      if (m && !m.hidden) closeSaveModal();
    });

    if (grid) {
      grid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-yks-note-delete]");
        if (!btn) return;
        e.preventDefault();
        var id = btn.getAttribute("data-yks-note-delete");
        var card = btn.closest(".yks-puan-saved-card");
        if (id) deleteSavedNote(id, card);
      });
    }

    window.addEventListener("yks:navigate", function (ev) {
      try {
        if (ev.detail && ev.detail.view === "yks-puan") {
          refreshSaveButtonState();
          loadSavedList();
        }
      } catch (e) {}
    });
  }

  refreshSaveButtonState();
  loadSavedList();
}

if (typeof window !== "undefined") {
  window.deleteSavedNote = deleteSavedNote;
}
