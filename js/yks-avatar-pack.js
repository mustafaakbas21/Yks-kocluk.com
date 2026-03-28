/**
 * HD Avatar Paketi — Appwrite Storage `avatarlar` kovasındaki sabit dosya kimlikleri.
 * Yükleme: proje kökünde `npm run upload:avatars` (scripts/upload-avatar-pack.cjs).
 */
import {
  APPWRITE_ENDPOINT,
  APPWRITE_PROJECT_ID,
  APPWRITE_BUCKET_AVATARLAR,
} from "./appwrite-config.js";

/** Appwrite dosya görüntüleme URL’si (kovada herkese okuma açık). */
export function buildYksAvatarStorageViewUrl(fileId) {
  var ep = String(APPWRITE_ENDPOINT || "").replace(/\/$/, "");
  return (
    ep +
    "/storage/buckets/" +
    encodeURIComponent(APPWRITE_BUCKET_AVATARLAR) +
    "/files/" +
    encodeURIComponent(fileId) +
    "/view?project=" +
    encodeURIComponent(APPWRITE_PROJECT_ID)
  );
}

/** Yükleme script’i ile aynı Dicebear tohumları (yedek önizleme / geliştirme). */
var YKS_HD_BG = ["b6e3f4", "c0aede", "ffd5dc", "d1d4f9", "ffdfbf", "bae6fd", "bbf7d0", "fde68a"];

function dicebearFallbackMale(index1) {
  return (
    "https://api.dicebear.com/7.x/avataaars/png?seed=" +
    encodeURIComponent("yks_hd_m_" + String(index1).padStart(2, "0")) +
    "&size=512&backgroundColor=" +
    YKS_HD_BG[(index1 - 1) % YKS_HD_BG.length]
  );
}

function dicebearFallbackFemale(index1) {
  return (
    "https://api.dicebear.com/7.x/avataaars/png?seed=" +
    encodeURIComponent("yks_hd_f_" + String(index1).padStart(2, "0")) +
    "&size=512&backgroundColor=" +
    YKS_HD_BG[(index1 + 3) % YKS_HD_BG.length]
  );
}

function pad2(n) {
  return String(n).padStart(2, "0");
}

/** 20 adet — Storage’da `male_01` … `male_20` */
export var YKS_AVATAR_MALE_URLS = [];
/** 20 adet — Storage’da `female_01` … `female_20` */
export var YKS_AVATAR_FEMALE_URLS = [];

for (var mi = 1; mi <= 20; mi++) {
  var mid = "male_" + pad2(mi);
  YKS_AVATAR_MALE_URLS.push(buildYksAvatarStorageViewUrl(mid));
}
for (var fi = 1; fi <= 20; fi++) {
  var fid = "female_" + pad2(fi);
  YKS_AVATAR_FEMALE_URLS.push(buildYksAvatarStorageViewUrl(fid));
}

/** Tüm 40 (satır sırası: önce 20 erkek, sonra 20 kadın). */
export var YKS_AVATAR_ALL_40_URLS = YKS_AVATAR_MALE_URLS.concat(YKS_AVATAR_FEMALE_URLS);

export function getDicebearFallbackForFileId(fileId) {
  var m = /^male_(\d+)$/.exec(fileId);
  if (m) return dicebearFallbackMale(parseInt(m[1], 10));
  var f = /^female_(\d+)$/.exec(fileId);
  if (f) return dicebearFallbackFemale(parseInt(f[1], 10));
  return "";
}
