/**
 * Kurucu / Koç paneli — Zoho Gelen Kutusu (/api/get-zoho-emails) + Cevapla (compose)
 */

var SA_INBOX_IDS = {
  loader: "saInboxLoader",
  list: "saInboxList",
  err: "saInboxError",
  skel: "saInboxSkeleton",
  modal: "saMailModal",
  modalSubject: "saMailModalSubject",
  modalMeta: "saMailModalMeta",
  modalBody: "saMailModalBody",
  refreshBtn: "btnZohoInboxRefresh",
  closeAttr: "data-sa-mail-close",
};

var KOC_INBOX_IDS = {
  loader: "kocInboxLoader",
  list: "kocInboxList",
  err: "kocInboxError",
  skel: "kocInboxSkeleton",
  modal: "kocMailModal",
  modalSubject: "kocMailModalSubject",
  modalMeta: "kocMailModalMeta",
  modalBody: "kocMailModalBody",
  refreshBtn: "btnKocZohoInboxRefresh",
  closeAttr: "data-koc-mail-close",
};

var inboxIds = SA_INBOX_IDS;

/** @param {"sa" | "koc"} preset */
export function configureZohoInboxPreset(preset) {
  inboxIds = preset === "koc" ? KOC_INBOX_IDS : SA_INBOX_IDS;
}

function esc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function extractEmailAddress(fromStr) {
  if (!fromStr) return "";
  var s = String(fromStr).trim();
  var m = s.match(/<([^>\s]+@[^>\s]+)>/);
  if (m) return m[1].trim();
  var m2 = s.match(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/);
  return m2 ? m2[0] : s;
}

function replySubject(subject) {
  var s = (subject || "").trim();
  if (!s) return "Re: ";
  if (/^re:\s/i.test(s)) return s;
  return "Re: " + s;
}

function sanitizeHtml(html) {
  var d = document.createElement("div");
  d.innerHTML = html || "";
  d.querySelectorAll("script, iframe, object, embed").forEach(function (n) {
    n.remove();
  });
  return d.innerHTML;
}

function bentoSkeletonHtml() {
  var cards = "";
  for (var i = 0; i < 8; i++) {
    cards +=
      '<div class="sa-mail-bento__card sa-mail-bento__card--skeleton">' +
      '<span class="sa-mail-sk sa-mail-sk--from"></span>' +
      '<span class="sa-mail-sk sa-mail-sk--subj"></span>' +
      '<span class="sa-mail-sk sa-mail-sk--date"></span>' +
      "</div>";
  }
  return '<div class="sa-mail-bento__grid">' + cards + "</div>";
}

/** Sayfa / yenile: liste + iskelet */
export async function loadEmails() {
  var loader = document.getElementById(inboxIds.loader);
  var listEl = document.getElementById(inboxIds.list);
  var errEl = document.getElementById(inboxIds.err);
  var skelHost = document.getElementById(inboxIds.skel);

  if (errEl) {
    errEl.hidden = true;
    errEl.textContent = "";
  }
  if (listEl) listEl.innerHTML = "";
  if (loader) loader.hidden = false;
  if (skelHost) skelHost.innerHTML = bentoSkeletonHtml();

  try {
    var res = await fetch("/api/get-zoho-emails?limit=10", {
      method: "GET",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
    });
    var data = await res.json();

    if (loader) loader.hidden = true;

    if (!data || !data.ok) {
      var msg =
        (data && data.error) ||
        "Mailler yüklenemedi. Ortam değişkenlerini (ZOHO_CLIENT_ID, SECRET, REFRESH_TOKEN) kontrol edin.";
      if (errEl) {
        errEl.textContent = msg;
        errEl.hidden = false;
      }
      if (listEl) {
        listEl.innerHTML = '<p class="sa-mail-empty">' + esc(msg) + "</p>";
      }
      return;
    }

    var emails = data.emails || [];
    if (!listEl) return;

    if (!emails.length) {
      listEl.innerHTML =
        '<p class="sa-mail-empty">Gelen kutuda gösterilecek posta yok.</p>';
      return;
    }

    var grid = document.createElement("div");
    grid.className = "sa-mail-bento__grid";
    grid.setAttribute("role", "list");

    emails.forEach(function (m) {
      var card = document.createElement("article");
      card.className =
        "sa-mail-bento__card" + (m.isUnread ? " sa-mail-bento__card--unread" : "");
      card.setAttribute("role", "listitem");
      card.setAttribute("data-id", String(m.id));
      card.setAttribute("data-account", String(m.accountId || ""));

      var main = document.createElement("button");
      main.type = "button";
      main.className = "sa-mail-bento__card-main";
      main.setAttribute(
        "aria-label",
        "Maili aç: " + (m.subject || "").slice(0, 80)
      );
      main.innerHTML =
        '<span class="sa-mail-bento__from">' +
        esc(m.from) +
        "</span>" +
        '<span class="sa-mail-bento__subject">' +
        esc(m.subject) +
        "</span>" +
        '<span class="sa-mail-bento__date">' +
        esc(m.date) +
        "</span>";

      main.addEventListener("click", function () {
        openMailModal(m.id, m.accountId || "", m.subject, m.from, m.date);
      });

      var replyBtn = document.createElement("button");
      replyBtn.type = "button";
      replyBtn.className = "sa-mail-bento__reply";
      replyBtn.setAttribute("aria-label", "Bu iletiyi cevapla");
      replyBtn.innerHTML =
        '<i class="fa-solid fa-reply" aria-hidden="true"></i> Cevapla';
      replyBtn.addEventListener("click", function (ev) {
        ev.stopPropagation();
        ensureComposeShell();
        openCompose({
          to: extractEmailAddress(m.from),
          subject: replySubject(m.subject),
          accountId: String(m.accountId || ""),
        });
      });

      card.appendChild(main);
      card.appendChild(replyBtn);
      grid.appendChild(card);
    });

    listEl.innerHTML = "";
    listEl.appendChild(grid);
  } catch (e) {
    console.error("[loadEmails]", e);
    if (loader) loader.hidden = true;
    if (errEl) {
      errEl.textContent =
        e && e.message
          ? String(e.message)
          : "/api/get-zoho-emails erişilemiyor (yerelde Vercel fonksiyonu yok olabilir).";
      errEl.hidden = false;
    }
    if (listEl) listEl.innerHTML = "";
  }
}

function openMailModal(messageId, accountId, subject, from, date) {
  var modal = document.getElementById(inboxIds.modal);
  var subEl = document.getElementById(inboxIds.modalSubject);
  var metaEl = document.getElementById(inboxIds.modalMeta);
  var bodyEl = document.getElementById(inboxIds.modalBody);
  if (!modal || !bodyEl) return;

  if (subEl) subEl.textContent = subject || "(Konu yok)";
  if (metaEl) {
    metaEl.textContent = (from || "") + " · " + (date || "");
  }
  bodyEl.innerHTML =
    '<p class="sa-mail-modal__loading">İçerik yükleniyor…</p>';
  modal.hidden = false;
  document.body.style.overflow = "hidden";

  var url =
    "/api/get-zoho-emails?messageId=" +
    encodeURIComponent(messageId) +
    "&accountId=" +
    encodeURIComponent(accountId);

  fetch(url, { credentials: "same-origin", headers: { Accept: "application/json" } })
    .then(function (r) {
      return r.json();
    })
    .then(function (data) {
      if (!data || !data.ok || !data.detail) {
        bodyEl.innerHTML =
          '<p class="sa-mail-modal__err">' +
          esc((data && data.error) || "İçerik alınamadı.") +
          "</p>";
        return;
      }
      var b = data.detail.body || "";
      if (b.indexOf("<") >= 0 && b.indexOf(">") >= 0) {
        bodyEl.innerHTML =
          '<div class="sa-mail-modal__html">' + b + "</div>";
      } else {
        bodyEl.innerHTML =
          '<pre class="sa-mail-modal__pre">' + esc(b) + "</pre>";
      }
    })
    .catch(function (err) {
      bodyEl.innerHTML =
        '<p class="sa-mail-modal__err">' + esc(err && err.message) + "</p>";
    });
}

function closeMailModal() {
  var modal = document.getElementById(inboxIds.modal);
  if (modal) modal.hidden = true;
  document.body.style.overflow = "";
}

var composeState = { accountId: "" };
var composeDomWired = false;

function ensureComposeShell() {
  if (document.getElementById("zohoComposePanel")) return;

  var backdrop = document.createElement("div");
  backdrop.id = "zohoComposeBackdrop";
  backdrop.className = "zoho-compose-backdrop";
  backdrop.setAttribute("aria-hidden", "true");

  var panel = document.createElement("div");
  panel.id = "zohoComposePanel";
  panel.className = "zoho-compose-panel";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-modal", "true");
  panel.setAttribute("aria-labelledby", "zohoComposeTitle");
  panel.innerHTML =
    '<div class="zoho-compose__header">' +
    '<span class="zoho-compose__title" id="zohoComposeTitle">Yeni Mesaj</span>' +
    '<button type="button" class="zoho-compose__close" id="zohoComposeClose" aria-label="Kapat">×</button>' +
    "</div>" +
    '<div class="zoho-compose__body">' +
    '<label class="zoho-compose__lbl" for="zohoComposeTo">Kime</label>' +
    '<input type="email" class="zoho-compose__input" id="zohoComposeTo" autocomplete="email" />' +
    '<label class="zoho-compose__lbl" for="zohoComposeSubject">Konu</label>' +
    '<input type="text" class="zoho-compose__input" id="zohoComposeSubject" />' +
    '<label class="zoho-compose__lbl" for="zohoComposeEditor">Mesaj</label>' +
    '<div class="zoho-compose__toolbar" role="toolbar" aria-label="Biçimlendirme">' +
    '<button type="button" data-zoho-exec="bold" title="Kalın"><b>B</b></button>' +
    '<button type="button" data-zoho-exec="italic" title="İtalik"><i>I</i></button>' +
    '<button type="button" data-zoho-exec="underline" title="Altı çizili"><u>U</u></button>' +
    '<button type="button" data-zoho-exec="insertUnorderedList" title="Liste">• Liste</button>' +
    '<button type="button" data-zoho-exec="insertOrderedList" title="Numaralı liste">1.</button>' +
    "</div>" +
    '<div class="zoho-compose__editor" id="zohoComposeEditor" contenteditable="true" tabindex="0"></div>' +
    "</div>" +
    '<div class="zoho-compose__footer">' +
    '<button type="button" class="zoho-compose__send" id="zohoComposeSend">' +
    '<span class="zoho-compose__send-inner--idle">Gönder</span>' +
    '<span class="zoho-compose__send-inner--busy"><span class="zoho-compose__spinner" aria-hidden="true"></span> Gönderiliyor…</span>' +
    "</button>" +
    "</div>";

  var toast = document.createElement("div");
  toast.id = "zohoMailToast";
  toast.className = "zoho-mail-toast";
  toast.setAttribute("role", "status");
  toast.setAttribute("aria-live", "polite");

  document.body.appendChild(backdrop);
  document.body.appendChild(panel);
  document.body.appendChild(toast);

  wireComposeDom();
}

function wireComposeDom() {
  if (composeDomWired) return;
  composeDomWired = true;

  var panel = document.getElementById("zohoComposePanel");
  var backdrop = document.getElementById("zohoComposeBackdrop");
  var closeBtn = document.getElementById("zohoComposeClose");
  var sendBtn = document.getElementById("zohoComposeSend");
  var editor = document.getElementById("zohoComposeEditor");

  if (closeBtn) {
    closeBtn.addEventListener("click", closeCompose);
  }
  if (backdrop) {
    backdrop.addEventListener("click", closeCompose);
  }
  if (panel) {
    panel.addEventListener("click", function (e) {
      e.stopPropagation();
    });
  }

  if (editor) {
    editor.addEventListener("paste", function (e) {
      e.preventDefault();
      var t = "";
      try {
        t = (e.clipboardData || window.clipboardData).getData("text/plain") || "";
      } catch (_x) {
        t = "";
      }
      document.execCommand("insertText", false, t);
    });
  }

  document.querySelectorAll(".zoho-compose__toolbar [data-zoho-exec]").forEach(function (b) {
    b.addEventListener("click", function () {
      var cmd = b.getAttribute("data-zoho-exec");
      if (!cmd) return;
      var ed = document.getElementById("zohoComposeEditor");
      if (ed) {
        ed.focus();
        document.execCommand(cmd, false, null);
      }
    });
  });

  if (sendBtn) {
    sendBtn.addEventListener("click", sendCompose);
  }
}

function openCompose(opts) {
  ensureComposeShell();
  var panel = document.getElementById("zohoComposePanel");
  var backdrop = document.getElementById("zohoComposeBackdrop");
  var toEl = document.getElementById("zohoComposeTo");
  var subEl = document.getElementById("zohoComposeSubject");
  var ed = document.getElementById("zohoComposeEditor");

  composeState.accountId = (opts && opts.accountId) || "";

  if (toEl) toEl.value = (opts && opts.to) || "";
  if (subEl) subEl.value = (opts && opts.subject) || "Re: ";
  if (ed) {
    ed.innerHTML = "";
    ed.innerHTML = "<p><br></p>";
  }

  if (backdrop) {
    backdrop.classList.add("is-open");
    backdrop.setAttribute("aria-hidden", "false");
  }
  if (panel) {
    panel.classList.add("is-open");
    panel.dataset.accountId = composeState.accountId;
    requestAnimationFrame(function () {
      if (ed) ed.focus();
    });
  }
}

function closeCompose() {
  var panel = document.getElementById("zohoComposePanel");
  var backdrop = document.getElementById("zohoComposeBackdrop");
  if (backdrop) {
    backdrop.classList.remove("is-open");
    backdrop.setAttribute("aria-hidden", "true");
  }
  if (panel) {
    panel.classList.remove("is-open");
    panel.classList.remove("is-sending");
  }
}

function isComposeOpen() {
  var panel = document.getElementById("zohoComposePanel");
  return !!(panel && panel.classList.contains("is-open"));
}

function showToast(message, ok) {
  ensureComposeShell();
  var toast = document.getElementById("zohoMailToast");
  if (!toast) return;
  toast.textContent = message;
  toast.className =
    "zoho-mail-toast zoho-mail-toast--" + (ok ? "ok" : "err");
  toast.hidden = false;
  requestAnimationFrame(function () {
    toast.classList.add("is-visible");
  });
  window.clearTimeout(showToast._tm);
  showToast._tm = window.setTimeout(function () {
    toast.classList.remove("is-visible");
    window.setTimeout(function () {
      toast.hidden = true;
    }, 350);
  }, 4200);
}

async function sendCompose() {
  var panel = document.getElementById("zohoComposePanel");
  var toEl = document.getElementById("zohoComposeTo");
  var subEl = document.getElementById("zohoComposeSubject");
  var ed = document.getElementById("zohoComposeEditor");
  var sendBtn = document.getElementById("zohoComposeSend");
  if (!toEl || !subEl || !ed || !panel) return;

  var toAddress = (toEl.value || "").trim();
  var subject = (subEl.value || "").trim();
  var html = sanitizeHtml(ed.innerHTML);

  if (!toAddress) {
    showToast("Lütfen alıcı e-posta adresini girin.", false);
    toEl.focus();
    return;
  }
  if (!subject) {
    showToast("Lütfen konu satırını doldurun.", false);
    subEl.focus();
    return;
  }

  var plain = (ed.textContent || "").trim();
  if (!plain) {
    showToast("Mesaj gövdesi boş olamaz.", false);
    ed.focus();
    return;
  }

  var accountId =
    (panel.dataset && panel.dataset.accountId) || composeState.accountId || "";

  panel.classList.add("is-sending");
  if (sendBtn) sendBtn.disabled = true;

  try {
    var res = await fetch("/api/send-zoho-email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        toAddress: toAddress,
        subject: subject,
        content: html,
        mailFormat: "html",
        accountId: accountId || undefined,
      }),
    });
    var data = await res.json();

    if (data && data.ok) {
      showToast("Mesaj başarıyla iletildi!", true);
      closeCompose();
    } else {
      var err =
        (data && data.error) ||
        "Gönderilemedi. Lütfen Scope yetkilerini kontrol edin (ZohoMail.messages.CREATE) ve yeniden yetkilendirin.";
      showToast(err, false);
    }
  } catch (e) {
    console.error("[sendCompose]", e);
    showToast(
      (e && e.message
        ? String(e.message)
        : "Ağ hatası.") +
        " Lütfen Scope yetkilerini ve Vercel ortam değişkenlerini kontrol edin.",
      false
    );
  } finally {
    if (panel) panel.classList.remove("is-sending");
    if (sendBtn) sendBtn.disabled = false;
  }
}

var zohoInboxWired = false;

export function wireZohoInbox() {
  if (zohoInboxWired) return;
  zohoInboxWired = true;
  var btn = document.getElementById(inboxIds.refreshBtn);
  if (btn) {
    btn.addEventListener("click", function () {
      loadEmails();
    });
  }
  var modal = document.getElementById(inboxIds.modal);
  if (modal) {
    var closeSel = "[" + inboxIds.closeAttr + "]";
    modal.querySelectorAll(closeSel).forEach(function (el) {
      el.addEventListener("click", closeMailModal);
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeMailModal();
    });
  }
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape") return;
    if (isComposeOpen()) {
      closeCompose();
      return;
    }
    var m = document.getElementById(inboxIds.modal);
    if (m && !m.hidden) closeMailModal();
  });
}

/** Geriye uyumluluk */
export var fetchZohoEmails = loadEmails;
