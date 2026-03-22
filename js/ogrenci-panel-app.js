/**
 * Öğrenci paneli — Firebase oturum + koç bilgisi (salt okunur)
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

function setHeaderMeta(text) {
  var el = document.getElementById("ospHeaderMeta");
  if (el) el.textContent = text || "";
}

onAuthStateChanged(auth, async function (user) {
  if (!user) {
    window.location.replace("login.html");
    return;
  }
  try {
    var snap = await getDoc(doc(db, "users", user.uid));
    var profile = snap.data();
    if (!profile || profile.role !== "student") {
      await signOut(auth);
      window.location.replace("login.html");
      return;
    }
    var name = (profile.fullName || profile.username || "Öğrenci").trim();
    try {
      localStorage.setItem("yksStudentName", name);
      localStorage.setItem("yksCoachId", profile.coach_id || "");
    } catch (e) {}
    if (window.OSP && typeof window.OSP.applyProfile === "function") {
      window.OSP.applyProfile({ displayName: name, coachId: profile.coach_id || "" });
    }
    var coachHint = profile.coach_id ? "Koç: " + profile.coach_id : "Koç paneli ile bağlantılı hesap";
    setHeaderMeta(coachHint);

    if (profile.coach_id) {
      try {
        var qs = query(collection(db, "students"), where("coach_id", "==", profile.coach_id));
        var stSnap = await getDocs(qs);
        var match = null;
        var uname = (profile.username || "").trim().toLowerCase();
        var fn = (profile.fullName || "").trim();
        stSnap.forEach(function (d) {
          var data = d.data();
          if (uname && data.portalUsername && String(data.portalUsername).trim().toLowerCase() === uname) {
            match = data;
          }
        });
        if (!match) {
          stSnap.forEach(function (d) {
            var data = d.data();
            if (!match && fn && data.name && String(data.name).trim() === fn) {
              match = data;
            }
          });
        }
        if (match && window.OSP && typeof window.OSP.applyHedef === "function") {
          window.OSP.applyHedef(match);
        }
      } catch (err) {
        console.warn("[Öğrenci hedef]", err);
      }
    }
  } catch (e) {
    console.error(e);
    setHeaderMeta("Profil yüklenemedi");
  }
});

document.getElementById("ospBtnLogout") &&
  document.getElementById("ospBtnLogout").addEventListener("click", async function () {
    if (!confirm("Çıkış yapılsın mı?")) return;
    try {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("yksRole");
    } catch (e) {}
    await signOut(auth);
    window.location.replace("login.html");
  });
