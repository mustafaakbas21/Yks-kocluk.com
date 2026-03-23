/**
 * Merkezi Firebase yapılandırması (Modular Web SDK, CDN).
 * npm `import from "firebase/app"` yerine gstatic CDN kullanılıyor (bundler yok).
 */
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-storage.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-analytics.js";

export const firebaseConfig = {
  apiKey: "AIzaSyD3RUiCIlcysC6S7TFMbChD8h0cfHeroP8",
  authDomain: "yks-kocluk-8f7c6.firebaseapp.com",
  projectId: "yks-kocluk-8f7c6",
  storageBucket: "yks-kocluk-8f7c6.firebasestorage.app",
  messagingSenderId: "928738467961",
  appId: "1:928738467961:web:7e023f5b8f0ae3637874a8",
  measurementId: "G-GGYN4VBFPR",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);

/** Google Analytics (web); localhost / file:// ortamlarında hata verebilir — sessizce yoksayılır */
let analyticsInstance = null;
try {
  if (typeof window !== "undefined") {
    analyticsInstance = getAnalytics(app);
  }
} catch (e) {
  console.warn("[firebase] Analytics başlatılamadı (normal olabilir: localhost, engelleyici vb.)", e);
}
export const analytics = analyticsInstance;

/** Kurucu paneli: koç hesabı oluştururken mevcut admin oturumunu düşürmemek için */
export const coachCreatorApp = initializeApp(firebaseConfig, "CoachCreator");
export const coachCreatorAuth = getAuth(coachCreatorApp);

/** Kurucu paneli: öğrenci hesabı oluştururken */
export const studentCreatorApp = initializeApp(firebaseConfig, "StudentCreator");
export const studentCreatorAuth = getAuth(studentCreatorApp);

/** Koç paneli: öğrenci hesabı oluştururken (StudentCreator ile çakışmaması için ayrı instance) */
export const studentCreatorKocApp = initializeApp(firebaseConfig, "StudentCreatorKocPanel");
export const studentCreatorAuthKoc = getAuth(studentCreatorKocApp);
