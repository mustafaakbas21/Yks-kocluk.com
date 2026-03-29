/**
 * Öğrenci — Ders Anlatımı / Kütüphane (koçun paylaştığı tahtalar).
 */
import { collection, getDocs, query, where, getDoc, doc, db } from "./appwrite-compat.js";
import {
  APPWRITE_COLLECTION_BOARDS,
  APPWRITE_COLLECTION_SHARED_BOARDS,
} from "./appwrite-config.js";
import { mountStudentReadOnlyBoard, disposeStudentReadOnlyBoard } from "./derece-board.js";

var pendingBoardId = null;
var lastMountedBoardId = null;

function escHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatSharedAt(iso) {
  if (!iso) return "";
  try {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString("tr-TR", { dateStyle: "medium", timeStyle: "short" });
  } catch (_e) {
    return "";
  }
}

export function openSharedBoard(boardId) {
  pendingBoardId = boardId ? String(boardId).trim() : null;
  if (typeof window.__ospNavigate === "function") window.__ospNavigate("ders-board");
}

export function disposeOspStudentBoardView() {
  pendingBoardId = null;
  lastMountedBoardId = null;
  disposeStudentReadOnlyBoard();
  var empty = document.getElementById("ospDersBoardEmpty");
  var wrap = document.getElementById("ospDersBoardCanvasWrap");
  if (empty) empty.hidden = false;
  if (wrap) wrap.hidden = true;
}

export async function refreshOspStudentLibrary() {
  var grid = document.getElementById("ospSharedBoardGrid");
  if (!grid) return;
  var sid = window.OspPortal && window.OspPortal.studentDocId;
  if (!sid) {
    grid.innerHTML =
      '<p class="osp-student-board__hint" style="margin:0">Profil yüklenene kadar bekleyin veya yeniden giriş yapın.</p>';
    return;
  }
  grid.innerHTML =
    '<p class="osp-student-board__hint" style="margin:0">Yükleniyor…</p>';
  try {
    var snap = await getDocs(
      query(
        collection(db, APPWRITE_COLLECTION_SHARED_BOARDS),
        where("student_ids", "contains", sid)
      )
    );
    var items = [];
    snap.forEach(function (d) {
      var data = typeof d.data === "function" ? d.data() : {};
      items.push({
        shareId: d.id,
        boardId: data.board_id || "",
        sharedAt: data.shared_at || "",
      });
    });
    if (!items.length) {
      var snapAll = await getDocs(collection(db, APPWRITE_COLLECTION_SHARED_BOARDS));
      snapAll.forEach(function (d) {
        var data = typeof d.data === "function" ? d.data() : {};
        var ids = data.student_ids;
        if (!Array.isArray(ids) || ids.indexOf(sid) === -1) return;
        items.push({
          shareId: d.id,
          boardId: data.board_id || "",
          sharedAt: data.shared_at || "",
        });
      });
    }
    if (!items.length) {
      grid.innerHTML =
        '<p class="osp-student-board__hint" style="margin:0">Henüz koçun gönderdiği tahta yok.</p>';
      return;
    }
    items.sort(function (a, b) {
      return String(b.sharedAt).localeCompare(String(a.sharedAt));
    });

    var html = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!it.boardId) continue;
      var bSnap = await getDoc(doc(db, APPWRITE_COLLECTION_BOARDS, it.boardId));
      var title = "Tahta";
      var thumb = "";
      if (bSnap.exists()) {
        var bd = bSnap.data();
        title = bd.title || title;
        try {
          var arr = JSON.parse(bd.thumbnails_json || "[]");
          if (Array.isArray(arr) && arr[0]) thumb = arr[0];
        } catch (_e) {}
      }
      var meta = formatSharedAt(it.sharedAt);
      html.push(
        '<button type="button" class="osp-shared-card" data-osp-open-board="' +
          escHtml(it.boardId) +
          '">' +
          '<div class="osp-shared-card__thumb">' +
          (thumb
            ? '<img src="' + escHtml(thumb) + '" alt="" />'
            : '<i class="fa-solid fa-chalkboard" style="font-size:2rem;color:#94a3b8"></i>') +
          "</div>" +
          '<div class="osp-shared-card__body">' +
          '<p class="osp-shared-card__title">' +
          escHtml(title) +
          "</p>" +
          '<p class="osp-shared-card__meta">' +
          (meta ? escHtml(meta) : "Paylaşıldı") +
          "</p>" +
          "</div></button>"
      );
    }
    grid.innerHTML = html.length ? html.join("") : '<p class="osp-student-board__hint" style="margin:0">Liste boş.</p>';

    grid.querySelectorAll("[data-osp-open-board]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-osp-open-board");
        if (id) openSharedBoard(id);
      });
    });
  } catch (err) {
    console.error("[osp-student-ders]", err);
    grid.innerHTML =
      '<p class="osp-student-board__hint" style="margin:0;color:#b91c1c">Liste yüklenemedi. SharedBoards koleksiyonu tanımlı mı?</p>';
  }
}

export async function mountOspStudentBoardIfPending() {
  var empty = document.getElementById("ospDersBoardEmpty");
  var wrap = document.getElementById("ospDersBoardCanvasWrap");
  var root = document.getElementById("ospStudentReadOnlyRoot");
  if (!empty || !wrap || !root) return;

  if (!pendingBoardId) {
    if (lastMountedBoardId) {
      empty.hidden = true;
      wrap.hidden = false;
      return;
    }
    disposeStudentReadOnlyBoard();
    empty.hidden = false;
    wrap.hidden = true;
    return;
  }

  var boardId = pendingBoardId;
  pendingBoardId = null;
  empty.hidden = true;
  wrap.hidden = false;

  try {
    var bSnap = await getDoc(doc(db, APPWRITE_COLLECTION_BOARDS, boardId));
    if (!bSnap.exists()) {
      lastMountedBoardId = null;
      disposeStudentReadOnlyBoard();
      empty.hidden = false;
      wrap.hidden = true;
      if (typeof window.ospToast === "function") window.ospToast("Tahta bulunamadı.");
      return;
    }
    var bd = bSnap.data();
    mountStudentReadOnlyBoard(root, {
      title: bd.title || "Tahta",
      pagesJson: bd.pages_json || "[]",
    });
    lastMountedBoardId = boardId;
  } catch (err) {
    console.error("[osp-student-ders] mount", err);
    lastMountedBoardId = null;
    disposeStudentReadOnlyBoard();
    empty.hidden = false;
    wrap.hidden = true;
    if (typeof window.ospToast === "function") window.ospToast("Tahta açılamadı.");
  }
}

window.OspStudentDers = {
  openSharedBoard: openSharedBoard,
  refreshOspStudentLibrary: refreshOspStudentLibrary,
  mountOspStudentBoardIfPending: mountOspStudentBoardIfPending,
  disposeOspStudentBoardView: disposeOspStudentBoardView,
};
