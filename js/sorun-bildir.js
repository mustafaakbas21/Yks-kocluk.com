/**
 * Global Sorun Bildir — FAB, modal, Appwrite Storage + DB, toast
 * Koleksiyon: APPWRITE_COLLECTION_HATA_BILDIRIMLERI — Appwrite’da şema ile eşleşmeli.
 */
import { ID } from "./appwrite-browser.js";
import {
  databases,
  storage,
  APPWRITE_DATABASE_ID,
  APPWRITE_COLLECTION_HATA_BILDIRIMLERI,
  APPWRITE_BUCKET_DESTEK,
} from "./appwrite-config.js";
import { auth, verifyAppwriteAccount, doc, getDoc, db, logAppwriteError } from "./appwrite-compat.js";

var TOAST_MS = 4200;

function esc(s) {
  var d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function showToast(ok, message) {
  var host = document.querySelector(".dp-sb-toast-host");
  if (!host) {
    host = document.createElement("div");
    host.className = "dp-sb-toast-host";
    host.setAttribute("aria-live", "polite");
    document.body.appendChild(host);
  }
  var t = document.createElement("div");
  t.className = "dp-sb-toast " + (ok ? "dp-sb-toast--ok" : "dp-sb-toast--err");
  t.textContent = message;
  host.appendChild(t);
  setTimeout(function () {
    try {
      t.remove();
    } catch (e) {}
  }, TOAST_MS);
}

async function prefillUserFields(root) {
  var inAd = root.querySelector("#dpSbAdSoyad");
  var inUser = root.querySelector("#dpSbKullaniciEposta");
  if (!inAd || !inUser) return;

  var ad = "";
  var userLine = "";

  try {
    ad = (localStorage.getItem("yksStudentName") || "").trim();
    userLine = (localStorage.getItem("currentUser") || "").trim();
  } catch (e) {}

  try {
    await verifyAppwriteAccount(4000);
    if (auth.currentUser) {
      var em = (auth.currentUser.email || "").trim();
      if (em) userLine = userLine || em;
      if (auth.currentUser.uid) {
        var snap = await getDoc(doc(db, "users", auth.currentUser.uid));
        if (snap && snap.exists && typeof snap.data === "function") {
          var x = snap.data();
          if (x && (x.fullName || x.name)) ad = String(x.fullName || x.name || "").trim() || ad;
          if (x && x.username) userLine = String(x.username || "").trim() || userLine;
        }
      }
    }
  } catch (e) {
    console.warn("[sorun-bildir] profil:", e);
  }

  if (inAd && !inAd.value) inAd.value = ad;
  if (inUser && !inUser.value) inUser.value = userLine;
}

function openModal(root) {
  root.hidden = false;
  document.body.style.overflow = "hidden";
  var pathEl = root.querySelector("#dpSbSayfaYolu");
  if (pathEl) {
    pathEl.value = window.location.pathname || "/";
  }
  var tam = root.querySelector("#dpSbTamUrl");
  if (tam) {
    tam.value = String(window.location.href || "").slice(0, 2000);
  }
  prefillUserFields(root).catch(function () {});
  var first = root.querySelector("input:not([readonly]), textarea, select");
  if (first) setTimeout(function () { try { first.focus(); } catch (e) {} }, 80);
}

function closeModal(root) {
  root.hidden = true;
  document.body.style.overflow = "";
}

function buildUi() {
  if (document.getElementById("dpSorunFab")) return;

  var fab = document.createElement("button");
  fab.type = "button";
  fab.id = "dpSorunFab";
  fab.className = "dp-sb-fab";
  fab.setAttribute("aria-label", "Hata veya öneri bildir");
  fab.setAttribute("title", "Canlı destek — Hata / öneri bildir");
  fab.innerHTML =
    '<span class="dp-sb-fab__hint">Hata / öneri bildir</span>' +
    '<i class="fa-solid fa-headset" aria-hidden="true"></i>';

  var modal = document.createElement("div");
  modal.id = "dpSorunModal";
  modal.className = "dp-sb-modal";
  modal.hidden = true;
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "dpSbTitle");
  modal.innerHTML =
    '<div class="dp-sb-modal__backdrop" data-dp-sb-close></div>' +
    '<div class="dp-sb-modal__panel" role="dialog">' +
    '<div class="dp-sb-modal__head">' +
    '<div><h2 id="dpSbTitle">Sorun bildir</h2>' +
    '<p class="dp-sb-modal__sub">Teknik sorun, görsel hata veya özellik önerinizi ekibimize iletin. İsteğe bağlı ekran görüntüsü ekleyebilirsiniz.</p></div>' +
    '<button type="button" class="dp-sb-modal__x" data-dp-sb-close aria-label="Kapat">&times;</button>' +
    "</div>" +
    '<form id="dpSbForm" class="dp-sb-form" novalidate>' +
    '<div class="dp-sb-field"><label for="dpSbAdSoyad">Ad Soyad</label>' +
    '<input id="dpSbAdSoyad" name="ad_soyad" type="text" maxlength="200" autocomplete="name" placeholder="Adınız soyadınız" /></div>' +
    '<div class="dp-sb-field"><label for="dpSbKullaniciEposta">Kullanıcı adı / E-posta</label>' +
    '<input id="dpSbKullaniciEposta" name="kullanici_eposta" type="text" maxlength="320" autocomplete="username" placeholder="ör. kullanici_adi veya e-posta" /></div>' +
    '<div class="dp-sb-row2">' +
    '<div class="dp-sb-field"><label for="dpSbKategori">Hata kategorisi</label>' +
    '<select id="dpSbKategori" name="kategori">' +
    '<option value="sistem_bug">Sistem Hatası (Bug)</option>' +
    '<option value="tasarim">Tasarım / Görsel Hata</option>' +
    '<option value="ozellik">Yeni Özellik Önerisi</option>' +
    '<option value="diger">Diğer</option>' +
    "</select></div>" +
    '<div class="dp-sb-field"><label for="dpSbOncelik">Öncelik</label>' +
    '<select id="dpSbOncelik" name="oncelik">' +
    '<option value="dusuk">Düşük</option>' +
    '<option value="normal" selected>Normal</option>' +
    '<option value="acil">Acil</option>' +
    "</select></div></div>" +
    '<div class="dp-sb-field"><label for="dpSbSayfaYolu">Sorun yaşanan sayfa</label>' +
    '<input id="dpSbSayfaYolu" name="sayfa_yolu" type="text" readonly /></div>' +
    '<input type="hidden" id="dpSbTamUrl" name="tam_url" />' +
    '<div class="dp-sb-field"><label for="dpSbDetay">Detaylı açıklama</label>' +
    '<textarea id="dpSbDetay" name="detay" required minlength="8" maxlength="8000" placeholder="Ne oldu, beklediğiniz davranış neydi?"></textarea></div>' +
    '<div class="dp-sb-field"><label for="dpSbDosya">Ekran görüntüsü (isteğe bağlı)</label>' +
    '<input id="dpSbDosya" name="dosya" type="file" accept="image/*" /></div>' +
    '<div id="dpSbFormMsg" class="dp-sb-msg" role="alert"></div>' +
    '<div class="dp-sb-actions">' +
    '<button type="button" class="dp-sb-btn" data-dp-sb-close>İptal</button>' +
    '<button type="submit" class="dp-sb-btn dp-sb-btn--primary" id="dpSbSubmit">Gönder</button>' +
    "</div></form></div>";

  document.body.appendChild(fab);
  document.body.appendChild(modal);

  fab.addEventListener("click", function () {
    openModal(modal);
  });

  modal.querySelectorAll("[data-dp-sb-close]").forEach(function (el) {
    el.addEventListener("click", function () {
      closeModal(modal);
    });
  });

  document.addEventListener("keydown", function (ev) {
    if (ev.key === "Escape" && !modal.hidden) {
      closeModal(modal);
    }
  });

  var form = modal.querySelector("#dpSbForm");
  form.addEventListener("submit", function (ev) {
    ev.preventDefault();
    submitForm(modal, form);
  });
}

async function submitForm(modal, form) {
  var msgEl = form.querySelector("#dpSbFormMsg");
  var btn = form.querySelector("#dpSbSubmit");
  function formErr(t) {
    if (msgEl) {
      msgEl.className = "dp-sb-msg is-err";
      msgEl.textContent = t;
    }
    showToast(false, t);
  }

  var fd = new FormData(form);
  var detay = String(fd.get("detay") || "").trim();
  if (detay.length < 8) {
    formErr("Lütfen en az 8 karakterlik bir açıklama yazın.");
    return;
  }

  var fileInput = form.querySelector("#dpSbDosya");
  var file = fileInput && fileInput.files && fileInput.files[0] ? fileInput.files[0] : null;
  if (file && file.size > 6 * 1024 * 1024) {
    formErr("Görsel 6 MB’dan küçük olmalıdır.");
    return;
  }

  if (btn) {
    btn.disabled = true;
  }
  if (msgEl) {
    msgEl.className = "dp-sb-msg";
    msgEl.textContent = "";
    msgEl.style.display = "none";
  }

  var fileId = "";
  try {
    if (file) {
      fileId = ID.unique();
      var safeName = (file.name || "ekran.png").replace(/[^\w.\-]+/g, "_").slice(0, 120);
      var uploadFile = file instanceof File ? file : new File([file], safeName, { type: file.type || "image/png" });
      await storage.createFile(APPWRITE_BUCKET_DESTEK, fileId, uploadFile);
    }

    await verifyAppwriteAccount(2000);
    var uid = auth.currentUser && auth.currentUser.uid ? String(auth.currentUser.uid) : "";

    var payload = {
      ad_soyad: String(fd.get("ad_soyad") || "").trim().slice(0, 200),
      kullanici_eposta: String(fd.get("kullanici_eposta") || "").trim().slice(0, 320),
      kategori: String(fd.get("kategori") || "diger"),
      oncelik: String(fd.get("oncelik") || "normal"),
      sayfa_yolu: String(fd.get("sayfa_yolu") || window.location.pathname || "/").slice(0, 512),
      tam_url: String(fd.get("tam_url") || window.location.href || "").slice(0, 2048),
      detay: detay,
    };
    if (fileId) {
      payload.ekran_goruntu_file_id = fileId;
    }
    if (uid) {
      payload.gonderen_uid = uid;
    }

    await databases.createDocument(
      APPWRITE_DATABASE_ID,
      APPWRITE_COLLECTION_HATA_BILDIRIMLERI,
      ID.unique(),
      payload
    );

    showToast(true, "Teşekkürler — talebiniz kaydedildi.");
    form.reset();
    var pathEl = form.querySelector("#dpSbSayfaYolu");
    if (pathEl) pathEl.value = window.location.pathname || "/";
    var tam = form.querySelector("#dpSbTamUrl");
    if (tam) tam.value = String(window.location.href || "").slice(0, 2000);
    if (fileInput) fileInput.value = "";
    closeModal(modal);
  } catch (err) {
    logAppwriteError("sorun-bildir.js/submitForm", err);
    var raw = err && err.message != null ? String(err.message) : "";
    var m =
      /network|fetch|failed to fetch|timeout/i.test(raw)
        ? "Bağlantı hatası oluştu. İnternetinizi kontrol edip tekrar deneyin."
        : /collection.*not.*found|could not be found|hata_bildirimleri/i.test(raw)
          ? "Şu anda sorun bildirim sistemi geçici olarak devre dışı. Lütfen daha sonra tekrar deneyin veya doğrudan kurum koçunuzla iletişime geçin."
        : /Unknown attribute|Invalid document structure|schema/i.test(raw)
          ? "Kayıt şemasıyla uyumsuzluk. Yöneticiye bildirin veya daha sonra deneyin."
          : raw || "Gönderim başarısız. Lütfen tekrar deneyin.";
    formErr(m);
  } finally {
    if (btn) btn.disabled = false;
  }
}

function init() {
  if (window.__dpSorunBildirInit) return;
  window.__dpSorunBildirInit = true;
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildUi);
  } else {
    buildUi();
  }
}

init();
