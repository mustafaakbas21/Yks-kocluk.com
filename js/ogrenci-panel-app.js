/**
 * Öğrenci paneli — Firebase oturum + Firestore haftalık plan (gerçek zamanlı)
 */
import { db, auth } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

let planUnsub = null;

window.OspPortal = window.OspPortal || {};
window.OspPortal.studentDocId = null;

window.OspPortal.updateTaskDone = async function (taskId, done) {
  var sid = window.OspPortal.studentDocId;
  if (!sid || !taskId) return;
  try {
    var patch = {};
    patch["taskDoneMap." + taskId] = !!done;
    await updateDoc(doc(db, "studentPortalPlans", sid), patch);
  } catch (err) {
    console.warn("[Öğrenci plan] görev güncellenemedi", err);
  }
};

function setHeaderMeta(text) {
  var el = document.getElementById("ospHeaderMeta");
  if (el) el.textContent = text || "";
}

function docExists(snap) {
  if (typeof snap.exists === "function") return snap.exists();
  return !!snap.exists;
}

onAuthStateChanged(auth, async function (user) {
  if (planUnsub) {
    try {
      planUnsub();
    } catch (e) {}
    planUnsub = null;
  }
  window.OspPortal.studentDocId = null;

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

    var studentDocId = null;

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
            studentDocId = d.id;
          }
        });
        if (!match) {
          stSnap.forEach(function (d) {
            var data = d.data();
            if (!match && fn && data.name && String(data.name).trim() === fn) {
              match = data;
              studentDocId = d.id;
            }
          });
        }
        if (match && window.OSP && typeof window.OSP.applyHedef === "function") {
          window.OSP.applyHedef(match);
        }

        window.OspPortal.studentDocId = studentDocId;

        if (studentDocId) {
          planUnsub = onSnapshot(doc(db, "studentPortalPlans", studentDocId), function (planSnap) {
            if (!docExists(planSnap)) return;
            var data = planSnap.data();
            if (window.OSP && typeof window.OSP.applyPlanFromFirestore === "function") {
              window.OSP.applyPlanFromFirestore(data);
            }
          });
        }
      } catch (err) {
        console.warn("[Öğrenci hedef / plan]", err);
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
