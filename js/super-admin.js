/**
 * Kurucu paneli — koç oluşturma (ikincil Auth uygulaması ile)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged,
  signOut,
  createUserWithEmailAndPassword,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  collection,
  query,
  where,
  onSnapshot,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyD3RUiCIlcysC6S7TFMbChD8h0cfHeroP8",
  authDomain: "yks-kocluk-8f7c6.firebaseapp.com",
  projectId: "yks-kocluk-8f7c6",
  storageBucket: "yks-kocluk-8f7c6.firebasestorage.app",
  messagingSenderId: "928738467961",
  appId: "1:928738467961:web:7e023f5b8f0ae3637874a8",
  measurementId: "G-GGYN4VBFPR",
};

const EMAIL_DOMAIN = "@sistem.com";

const primaryApp = initializeApp(firebaseConfig);
const secondaryApp = initializeApp(firebaseConfig, "CoachCreator");
const auth = getAuth(primaryApp);
const secondaryAuth = getAuth(secondaryApp);
const db = getFirestore(primaryApp);

function sanitizeUsername(s) {
  return String(s || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function showFormMsg(ok, text) {
  var el = document.getElementById("formCoachMsg");
  if (!el) return;
  el.textContent = text;
  el.className = ok ? "is-ok" : "is-err";
}

var coachesUnsub = null;

function renderCoachesTable(docs) {
  var tb = document.getElementById("coachesTableBody");
  if (!tb) return;
  if (docs.length === 0) {
    tb.innerHTML = '<tr><td colspan="5" class="mono" style="padding:1.5rem">Henüz koç yok.</td></tr>';
    return;
  }
  tb.innerHTML = docs
    .map(function (d) {
      var x = d.data();
      var pkg = x.packageType || "—";
      var badge = pkg === "Pro" ? "badge--pro" : "badge--bas";
      return (
        "<tr><td><strong>" +
        escapeHtml(x.username || "—") +
        '</strong></td><td>' +
        escapeHtml(x.institutionName || "—") +
        "</td><td>" +
        escapeHtml(x.phone || "—") +
        '</td><td><span class="badge ' +
        badge +
        '">' +
        escapeHtml(pkg) +
        '</span></td><td class="mono">' +
        escapeHtml(d.id.slice(0, 12) + "…") +
        "</td></tr>"
      );
    })
    .join("");
}

function escapeHtml(s) {
  var d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function subscribeCoachesList() {
  if (coachesUnsub) coachesUnsub();
  var q = query(collection(db, "users"), where("role", "==", "coach"));
  coachesUnsub = onSnapshot(
    q,
    function (snap) {
      renderCoachesTable(snap.docs);
    },
    function (err) {
      console.error(err);
      var tb = document.getElementById("coachesTableBody");
      if (tb) tb.innerHTML = "<tr><td colspan='5'>" + escapeHtml(err.message || "Hata") + "</td></tr>";
    }
  );
}

document.getElementById("formCreateCoach").addEventListener("submit", async function (e) {
  e.preventDefault();
  var u = sanitizeUsername(document.getElementById("coachUsername").value);
  var pass = document.getElementById("coachPassword").value;
  var inst = (document.getElementById("coachInstitution").value || "").trim();
  var phone = (document.getElementById("coachPhone").value || "").trim();
  var pkg = document.getElementById("coachPackage").value;
  var btn = document.getElementById("btnCreateCoach");
  showFormMsg(true, "");
  document.getElementById("formCoachMsg").className = "";
  document.getElementById("formCoachMsg").style.display = "none";
  if (!u) {
    showFormMsg(false, "Kullanıcı adı sadece a-z, 0-9 ve _ içerebilir.");
    return;
  }
  if (pass.length < 6) {
    showFormMsg(false, "Şifre en az 6 karakter olmalı.");
    return;
  }
  if (!inst) {
    showFormMsg(false, "Kurum adı zorunlu.");
    return;
  }
  btn.disabled = true;
  try {
    var email = u + EMAIL_DOMAIN;
    var cred = await createUserWithEmailAndPassword(secondaryAuth, email, pass);
    await setDoc(doc(db, "users", cred.user.uid), {
      username: u,
      role: "coach",
      institutionName: inst,
      phone: phone || null,
      packageType: pkg,
      createdAt: serverTimestamp(),
    });
    await signOut(secondaryAuth);
    showFormMsg(true, "Koç hesabı oluşturuldu: " + u + " — giriş: kullanıcı adı + şifre.");
    document.getElementById("formCoachMsg").style.display = "block";
    e.target.reset();
  } catch (err) {
    console.error(err);
    var msg = err.message || String(err);
    if (err.code === "auth/email-already-in-use") msg = "Bu kullanıcı adı zaten kayıtlı.";
    showFormMsg(false, msg);
    document.getElementById("formCoachMsg").style.display = "block";
    try {
      await signOut(secondaryAuth);
    } catch (_) {}
  } finally {
    btn.disabled = false;
  }
});

document.getElementById("btnLogout").addEventListener("click", async function () {
  if (!confirm("Çıkış yapılsın mı?")) return;
  localStorage.removeItem("currentUser");
  await signOut(auth);
  window.location.replace("login.html");
});

onAuthStateChanged(auth, async function (user) {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  var snap = await getDoc(doc(db, "users", user.uid));
  var profile = snap.data();
  if (!profile || profile.role !== "admin") {
    await signOut(auth);
    window.location.replace("login.html");
    return;
  }
  localStorage.setItem("currentUser", profile.username || "admin1");
  subscribeCoachesList();
});
