/**
 * Vitrin — teklif talebi formu (Firestore quoteRequests)
 */
import { addDoc, collection, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { db } from "./firebase-config.js";

var modal = null;
var form = null;
var pkgInput = null;
var pkgLabelEl = null;
var msgEl = null;
var submitBtn = null;

function closeModal() {
  if (!modal) return;
  modal.hidden = true;
  document.body.style.overflow = "";
}

function openModal(packageName) {
  if (!modal || !pkgInput || !form || !pkgLabelEl) return;
  pkgInput.value = packageName;
  pkgLabelEl.textContent = packageName;
  if (msgEl) {
    msgEl.textContent = "";
    msgEl.hidden = true;
    msgEl.className = "quote-modal__msg";
  }
  modal.hidden = false;
  document.body.style.overflow = "hidden";
  var first = form.querySelector("input:not([type='hidden'])");
  if (first) first.focus();
}

function bind() {
  modal = document.getElementById("quoteModal");
  form = document.getElementById("quoteForm");
  pkgInput = document.getElementById("quotePackage");
  pkgLabelEl = document.getElementById("quotePackageLabel");
  msgEl = document.getElementById("quoteFormMsg");
  submitBtn = document.getElementById("quoteSubmit");

  document.querySelectorAll("[data-open-quote]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var pkg = btn.getAttribute("data-package") || "Standart";
      openModal(pkg);
    });
  });

  if (modal) {
    modal.querySelectorAll("[data-quote-close]").forEach(function (el) {
      el.addEventListener("click", closeModal);
    });
    modal.addEventListener("click", function (e) {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal && !modal.hidden) closeModal();
  });

  if (form) {
    form.addEventListener("submit", async function (e) {
      e.preventDefault();
      if (!submitBtn || !pkgInput) return;
      var institution = (document.getElementById("quoteInstitution") && document.getElementById("quoteInstitution").value) || "";
      var contact = (document.getElementById("quoteContact") && document.getElementById("quoteContact").value) || "";
      var email = (document.getElementById("quoteEmail") && document.getElementById("quoteEmail").value) || "";
      var phone = (document.getElementById("quotePhone") && document.getElementById("quotePhone").value) || "";
      var message = (document.getElementById("quoteMessage") && document.getElementById("quoteMessage").value) || "";
      var pkg = pkgInput.value || "Standart";

      if (msgEl) {
        msgEl.textContent = "";
        msgEl.hidden = true;
      }

      if (contact.trim().length < 2) {
        if (msgEl) {
          msgEl.textContent = "Lütfen ad soyad veya yetkili adını girin.";
          msgEl.hidden = false;
        }
        return;
      }
      if (!email.includes("@") || email.trim().length < 5) {
        if (msgEl) {
          msgEl.textContent = "Geçerli bir e-posta girin.";
          msgEl.hidden = false;
        }
        return;
      }
      if (phone.replace(/\D/g, "").length < 10) {
        if (msgEl) {
          msgEl.textContent = "Lütfen geçerli bir telefon numarası girin.";
          msgEl.hidden = false;
        }
        return;
      }

      submitBtn.disabled = true;
      try {
        await addDoc(collection(db, "quoteRequests"), {
          packageName: pkg,
          institutionName: institution.trim().slice(0, 200),
          contactName: contact.trim().slice(0, 120),
          email: email.trim().slice(0, 200).toLowerCase(),
          phone: phone.trim().slice(0, 40),
          message: message.trim().slice(0, 4000),
          status: "new",
          createdAt: serverTimestamp(),
        });
        if (msgEl) {
          msgEl.textContent = "Talebiniz alındı. En kısa sürede size dönüş yapacağız.";
          msgEl.hidden = false;
          msgEl.className = "quote-modal__msg quote-modal__msg--ok";
        }
        form.reset();
        pkgInput.value = pkg;
        setTimeout(function () {
          closeModal();
          if (msgEl) msgEl.className = "quote-modal__msg";
        }, 2200);
      } catch (err) {
        console.error(err);
        if (msgEl) {
          msgEl.textContent =
            "Gönderilemedi. Bağlantınızı kontrol edin veya daha sonra tekrar deneyin.";
          msgEl.hidden = false;
          msgEl.className = "quote-modal__msg quote-modal__msg--err";
        }
      } finally {
        submitBtn.disabled = false;
      }
    });
  }
}

bind();
