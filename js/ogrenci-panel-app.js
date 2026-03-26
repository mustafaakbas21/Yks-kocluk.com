/**
 * Öğrenci paneli — Appwrite oturum + veritabanı haftalık plan (gerçek zamanlı/polling)
 */
import {
  db,
  auth,
  onAuthStateChanged,
  signOut,
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  updateDoc,
  verifyAppwriteAccount,
  getAppSettings,
} from "./appwrite-compat.js";

let planUnsub = null;
var ospAuthResolved = false;

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

async function loadOspForUser(user) {
  try {
    var snap = await getDoc(doc(db, "users", user.uid));
    var profile = snap.data();
    if (!profile || profile.role !== "student") {
      await signOut(auth);
      window.location.replace("/login");
      return;
    }
    try {
      var appSettings = await getAppSettings();
      if (appSettings.maintenance) {
        await signOut(auth);
        try {
          localStorage.setItem("loginFlashError", "Bakımdayız. Şu an yalnızca kurucu girişi açıktır.");
        } catch (e) {}
        window.location.replace("/login");
        return;
      }
    } catch (se) {
      console.warn("[öğrenci] settings:", se);
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
    if (ospAuthResolved) {
      window.location.replace("/login");
    }
    return;
  }
  ospAuthResolved = true;
  try {
    await loadOspForUser(user);
    requestAnimationFrame(function () {
      var dash = document.getElementById("ospViewDashboard");
      if (
        dash &&
        !dash.hidden &&
        window.OSP &&
        typeof window.OSP.initDashboard2Charts === "function"
      ) {
        window.OSP.initDashboard2Charts();
      }
    });
  } catch (err) {
    console.error("[öğrenci] loadOspForUser", err);
    try {
      alert("Bir sorun oluştu.");
    } catch (e2) {}
  }
});

setTimeout(function () {
  if (ospAuthResolved) return;
  verifyAppwriteAccount(5000)
    .then(function (vr) {
      if (ospAuthResolved) return;
      if (vr.ok && vr.user) {
        ospAuthResolved = true;
        return loadOspForUser({
          uid: vr.user.$id,
          email: vr.user.email || "",
          getIdToken: function () {
            return Promise.resolve("appwrite-session");
          },
        });
      }
      window.location.replace("/login");
    })
    .catch(function (err) {
      console.error("[öğrenci] verifyAppwriteAccount / loadOspForUser", err);
      try {
        alert("Bir sorun oluştu.");
      } catch (e2) {}
      if (!ospAuthResolved) window.location.replace("/login");
    });
}, 0);

document.getElementById("ospBtnLogout") &&
  document.getElementById("ospBtnLogout").addEventListener("click", async function () {
    if (!confirm("Çıkış yapılsın mı?")) return;
    try {
      localStorage.removeItem("currentUser");
      localStorage.removeItem("yksRole");
    } catch (e) {}
    await signOut(auth);
    window.location.replace("/login");
  });
