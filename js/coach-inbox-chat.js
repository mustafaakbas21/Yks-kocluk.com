/**
 * Koç paneli — Gelen Sorular: WhatsApp tarzı iki sütunlu sohbet (Appwrite messages + Realtime).
 * localStorage demo kullanılmaz; koleksiyon yoksa UI çökmez.
 */
import { ID, Query } from "./appwrite-browser.js";
import {
  client,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_MESSAGES,
} from "./appwrite-config.js";
import {
  databasesListDocumentsOrSoft,
  databasesCreateDocumentOrSoft,
  databasesUpdateDocumentOrSoft,
  isAppwriteWriteSoftFailure,
} from "./appwrite-compat.js";

function esc(t) {
  if (t == null) return "";
  var d = document.createElement("div");
  d.textContent = String(t);
  return d.innerHTML;
}

function isCollectionMissingErr(e) {
  if (!e) return false;
  var c = e.code;
  var ty = String(e.type || "").toLowerCase();
  var msg = String(e.message || "").toLowerCase();
  if (c === 404 || ty.indexOf("not_found") !== -1) return true;
  return /collection.*not found|unknown collection|could not be found/i.test(msg);
}

function logMissingOnce() {
  if (logMissingOnce._done) return;
  logMissingOnce._done = true;
  console.warn(
    "[CoachChat] Messages koleksiyonu eksik veya erişilemiyor. Appwrite Console’da «" +
      APPWRITE_COLLECTION_MESSAGES +
      "» oluşturun veya `node setup-appwrite.js` çalıştırın."
  );
}

function parseMsgTime(doc) {
  var raw = doc.timestamp || doc.$createdAt;
  if (!raw) return 0;
  var d = new Date(raw);
  var t = d.getTime();
  return isNaN(t) ? 0 : t;
}

var __cleanup = null;

/**
 * @param {{ getCoachId: () => string, getStudents: () => Array<Record<string, unknown>>, showToast?: (msg: string) => void, resolveStudentAvatarUrl: (s: Record<string, unknown>) => string }} opts
 */
export function initCoachInboxChatView(opts) {
  if (__cleanup) {
    try {
      __cleanup();
    } catch (_e) {}
    __cleanup = null;
  }

  var getCoachId = opts.getCoachId;
  var getStudents = opts.getStudents;
  var showToast = opts.showToast || function () {};
  var avatarUrl = opts.resolveStudentAvatarUrl;

  var errEl = document.getElementById("coachChatErr");
  var listEl = document.getElementById("coachChatStudentList");
  var emptyState = document.getElementById("coachChatEmpty");
  var threadWrap = document.getElementById("coachChatThread");
  var peerAvatar = document.getElementById("coachChatPeerAvatar");
  var peerName = document.getElementById("coachChatPeerName");
  var messagesEl = document.getElementById("coachChatMessages");
  var inputEl = document.getElementById("coachChatInput");
  var sendBtn = document.getElementById("coachChatSend");

  if (!listEl || !messagesEl || !threadWrap || !emptyState) return;

  var coachId = String((getCoachId && getCoachId()) || "").trim();
  var selectedStudentId = null;
  var threadIds = Object.create(null);
  var unreadByStudent = Object.create(null);
  var collectionBroken = false;
  var unsubRealtime = null;

  function setErr(msg) {
    if (!errEl) return;
    if (msg) {
      errEl.hidden = false;
      errEl.textContent = msg;
    } else {
      errEl.hidden = true;
      errEl.textContent = "";
    }
  }

  function scrollThreadToBottom(smooth) {
    requestAnimationFrame(function () {
      if (!messagesEl) return;
      messagesEl.scrollTo({
        top: messagesEl.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    });
  }

  function appendBubble(doc, coachSent) {
    if (!messagesEl || !doc || threadIds[doc.$id]) return;
    threadIds[doc.$id] = true;
    var row = document.createElement("div");
    row.className = "coach-chat-msg coach-chat-msg--" + (coachSent ? "out" : "in");
    row.setAttribute("data-msg-id", doc.$id);
    var text = document.createElement("div");
    text.className = "coach-chat-msg__bubble";
    text.innerHTML = esc(doc.text || "").replace(/\n/g, "<br/>");
    var meta = document.createElement("div");
    meta.className = "coach-chat-msg__time";
    var ts = parseMsgTime(doc);
    meta.textContent = ts
      ? new Date(ts).toLocaleString("tr-TR", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "short" })
      : "—";
    row.appendChild(text);
    row.appendChild(meta);
    messagesEl.appendChild(row);
  }

  async function fetchUnreadMap(students) {
    if (collectionBroken || !coachId) return {};
    var set = Object.create(null);
    for (var i = 0; i < students.length; i++) set[String(students[i].id)] = true;
    try {
      var res = await databasesListDocumentsOrSoft(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_MESSAGES, [
        Query.equal("receiver_id", coachId),
        Query.limit(500),
      ]);
      if (isAppwriteWriteSoftFailure(res)) {
        collectionBroken = true;
        logMissingOnce();
        return {};
      }
      var counts = Object.create(null);
      (res.documents || []).forEach(function (d) {
        if (d.read_at) return;
        var sid = String(d.sender_id || "");
        if (set[sid]) counts[sid] = (counts[sid] || 0) + 1;
      });
      return counts;
    } catch (e) {
      if (isCollectionMissingErr(e)) {
        collectionBroken = true;
        logMissingOnce();
      }
      return {};
    }
  }

  async function fetchThreadDocs(studentId) {
    if (collectionBroken || !coachId) return [];
    try {
      var q1 = [
        Query.equal("sender_id", coachId),
        Query.equal("receiver_id", studentId),
        Query.limit(120),
      ];
      var q2 = [
        Query.equal("sender_id", studentId),
        Query.equal("receiver_id", coachId),
        Query.limit(120),
      ];
      var r1 = await databasesListDocumentsOrSoft(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_MESSAGES, q1);
      var r2 = await databasesListDocumentsOrSoft(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_MESSAGES, q2);
      if (isAppwriteWriteSoftFailure(r1) || isAppwriteWriteSoftFailure(r2)) {
        collectionBroken = true;
        logMissingOnce();
        return [];
      }
      var map = Object.create(null);
      (r1.documents || []).forEach(function (d) {
        map[d.$id] = d;
      });
      (r2.documents || []).forEach(function (d) {
        map[d.$id] = d;
      });
      return Object.keys(map)
        .map(function (k) {
          return map[k];
        })
        .sort(function (a, b) {
          return parseMsgTime(a) - parseMsgTime(b);
        });
    } catch (e) {
      if (isCollectionMissingErr(e)) {
        collectionBroken = true;
        logMissingOnce();
      }
      throw e;
    }
  }

  async function markIncomingRead(studentId) {
    if (collectionBroken || !coachId) return;
    try {
      var res = await databasesListDocumentsOrSoft(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_MESSAGES, [
        Query.equal("sender_id", studentId),
        Query.equal("receiver_id", coachId),
        Query.limit(200),
      ]);
      if (isAppwriteWriteSoftFailure(res)) return;
      var nowIso = new Date().toISOString();
      for (var i = 0; i < (res.documents || []).length; i++) {
        var d = res.documents[i];
        if (d.read_at) continue;
        var ur = await databasesUpdateDocumentOrSoft(APPWRITE_DATABASE_ID, APPWRITE_COLLECTION_MESSAGES, d.$id, {
          read_at: nowIso,
        });
        if (isAppwriteWriteSoftFailure(ur)) {
          /* tek belge izin/şema — diğerlerine devam */
        }
      }
    } catch (_e) {}
  }

  async function renderStudentList() {
    var students = (getStudents && getStudents()) || [];
    if (!coachId) {
      listEl.innerHTML =
        '<p class="coach-chat-sidebar__hint">Oturum bulunamadı. Yeniden giriş yapın.</p>';
      return;
    }
    unreadByStudent = await fetchUnreadMap(students);
    if (students.length === 0) {
      listEl.innerHTML = '<p class="coach-chat-sidebar__hint">Henüz kayıtlı öğrenci yok.</p>';
      return;
    }
    listEl.innerHTML = students
      .map(function (s) {
        var sid = String(s.id || "");
        var name = String(s.name || s.studentName || "Öğrenci");
        var src = avatarUrl(s);
        var n = unreadByStudent[sid] || 0;
        var active = selectedStudentId === sid ? " is-active" : "";
        var badge = n > 0 ? '<span class="coach-chat-student__badge" title="Okunmamış">' + Math.min(n, 99) + "</span>" : "";
        return (
          '<button type="button" class="coach-chat-student' +
          active +
          '" data-student-id="' +
          esc(sid) +
          '" aria-label="' +
          esc(name) +
          '">' +
          '<span class="coach-chat-student__avatar-wrap"><img src="' +
          esc(src) +
          '" alt="" width="44" height="44" loading="lazy" decoding="async"/>' +
          badge +
          "</span>" +
          '<span class="coach-chat-student__name">' +
          esc(name) +
          "</span></button>"
        );
      })
      .join("");
  }

  async function openThread(student) {
    if (!student) return;
    if (collectionBroken) {
      setErr("Mesajlar koleksiyonu yapılandırılmamış veya erişilemiyor.");
      showToast("Sohbet için Appwrite’da «messages» koleksiyonunu oluşturun.");
      return;
    }
    var sid = String(student.id || "");
    selectedStudentId = sid;
    emptyState.hidden = true;
    threadWrap.hidden = false;
    if (peerAvatar) {
      peerAvatar.src = avatarUrl(student);
      peerAvatar.alt = String(student.name || "Öğrenci");
    }
    if (peerName) peerName.textContent = String(student.name || student.studentName || "Öğrenci");

    messagesEl.innerHTML =
      '<p class="coach-chat-loading" role="status">Mesajlar yükleniyor…</p>';
    threadIds = Object.create(null);
    setErr("");

    try {
      var docs = await fetchThreadDocs(sid);
      messagesEl.innerHTML = "";
      for (var i = 0; i < docs.length; i++) {
        var d = docs[i];
        var out = String(d.sender_id || "") === coachId;
        appendBubble(d, out);
      }
      if (!docs.length) {
        messagesEl.innerHTML =
          '<p class="coach-chat-thread__placeholder">Henüz mesaj yok. Aşağıdan yazarak başlayın.</p>';
      }
      void markIncomingRead(sid);
      unreadByStudent[sid] = 0;
      await renderStudentList();
      scrollThreadToBottom(false);
    } catch (e) {
      messagesEl.innerHTML = "";
      setErr("Mesajlar yüklenemedi.");
      showToast("Mesajlar yüklenemedi.");
    }
  }

  async function sendMessage() {
    if (!selectedStudentId || !coachId || collectionBroken) return;
    var raw = inputEl ? String(inputEl.value || "").trim() : "";
    if (!raw) return;
    if (inputEl) inputEl.value = "";
    try {
      var doc = await databasesCreateDocumentOrSoft(
        APPWRITE_DATABASE_ID,
        APPWRITE_COLLECTION_MESSAGES,
        ID.unique(),
        {
          sender_id: coachId,
          receiver_id: selectedStudentId,
          text: raw,
          timestamp: new Date().toISOString(),
        }
      );
      if (isAppwriteWriteSoftFailure(doc)) {
        collectionBroken = true;
        logMissingOnce();
        setErr("Mesajlar koleksiyonu yapılandırılmamış veya izin yok.");
        showToast("Mesaj gönderilemedi.");
        if (inputEl) inputEl.value = raw;
        return;
      }
      var placeholder = messagesEl.querySelector(".coach-chat-thread__placeholder");
      if (placeholder) placeholder.remove();
      appendBubble(doc, true);
      scrollThreadToBottom(true);
    } catch (e) {
      if (isCollectionMissingErr(e)) {
        collectionBroken = true;
        logMissingOnce();
        setErr("Mesajlar koleksiyonu yapılandırılmamış.");
      } else {
        setErr("Gönderilemedi. İzin veya bağlantıyı kontrol edin.");
        showToast("Mesaj gönderilemedi.");
      }
      if (inputEl) inputEl.value = raw;
    }
  }

  function onRealtime(ev) {
    try {
      var payload = ev && ev.payload != null ? ev.payload : ev;
      if (!payload || typeof payload !== "object") return;
      var id = payload.$id;
      if (!id) return;
      var s = String(payload.sender_id || "");
      var r = String(payload.receiver_id || "");
      if (!selectedStudentId || !coachId) return;
      var pair =
        (s === coachId && r === selectedStudentId) || (s === selectedStudentId && r === coachId);
      if (!pair) {
        if (r === coachId && s !== coachId) {
          unreadByStudent[s] = (unreadByStudent[s] || 0) + 1;
          void renderStudentList();
        }
        return;
      }
      if (threadIds[id]) return;
      var coachSent = s === coachId;
      var placeholder = messagesEl.querySelector(".coach-chat-thread__placeholder");
      if (placeholder) placeholder.remove();
      appendBubble(payload, coachSent);
      if (!coachSent) {
        void markIncomingRead(selectedStudentId);
        unreadByStudent[selectedStudentId] = 0;
        void renderStudentList();
      }
      scrollThreadToBottom(true);
    } catch (_e) {}
  }

  function startRealtime() {
    if (collectionBroken) return;
    try {
      if (typeof client.subscribe !== "function") return;
      var ch =
        "databases." +
        APPWRITE_DATABASE_ID +
        ".collections." +
        APPWRITE_COLLECTION_MESSAGES +
        ".documents";
      var ret;
      try {
        ret = client.subscribe(ch, onRealtime);
      } catch (e0) {
        ret = client.subscribe([ch], onRealtime);
      }
      if (ret != null && typeof ret.then === "function") {
        ret
          .then(function (u) {
            if (typeof u === "function") unsubRealtime = u;
          })
          .catch(function () {});
      } else if (typeof ret === "function") {
        unsubRealtime = ret;
      }
    } catch (e) {
      console.warn("[CoachChat] Realtime aboneliği başlatılamadı:", e && e.message ? e.message : e);
    }
  }

  var ac = new AbortController();
  var sig = { signal: ac.signal };

  listEl.addEventListener(
    "click",
    function (e) {
      var btn = e.target.closest(".coach-chat-student");
      if (!btn) return;
      var sid = btn.getAttribute("data-student-id");
      var students = (getStudents && getStudents()) || [];
      var st = students.find(function (x) {
        return String(x.id) === sid;
      });
      if (st) void openThread(st);
    },
    sig
  );

  if (sendBtn) {
    sendBtn.addEventListener(
      "click",
      function () {
        void sendMessage();
      },
      sig
    );
  }
  if (inputEl) {
    inputEl.addEventListener(
      "keydown",
      function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          void sendMessage();
        }
      },
      sig
    );
  }

  void renderStudentList().then(function () {
    if (!collectionBroken) startRealtime();
  });

  __cleanup = function () {
    try {
      ac.abort();
    } catch (_e) {}
    try {
      if (typeof unsubRealtime === "function") unsubRealtime();
    } catch (_e2) {}
    unsubRealtime = null;
    selectedStudentId = null;
    threadIds = Object.create(null);
  };
}

export function destroyCoachInboxChatView() {
  if (__cleanup) {
    try {
      __cleanup();
    } catch (_e) {}
    __cleanup = null;
  }
}
