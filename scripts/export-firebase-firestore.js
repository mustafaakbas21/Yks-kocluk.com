import fs from "node:fs";

const FIREBASE_PROJECT_ID = "yks-kocluk-8f7c6";
const FIREBASE_API_KEY = "AIzaSyD3RUiCIlcysC6S7TFMbChD8h0cfHeroP8";
const OUT_FILE = "firebase-export.json";

const COLLECTIONS = [
  "users",
  "students",
  "exams",
  "appointments",
  "tests",
  "payments",
  "coach_tasks",
  "kaynaklar",
  "studentPortalPlans",
  "settings",
  "quoteRequests",
  "coachLoginLog",
  "soru_havuzu",
];

function decodeFirestoreValue(v) {
  if (!v || typeof v !== "object") return null;
  if (Object.prototype.hasOwnProperty.call(v, "nullValue")) return null;
  if (Object.prototype.hasOwnProperty.call(v, "stringValue")) return v.stringValue;
  if (Object.prototype.hasOwnProperty.call(v, "booleanValue")) return !!v.booleanValue;
  if (Object.prototype.hasOwnProperty.call(v, "integerValue")) return Number(v.integerValue);
  if (Object.prototype.hasOwnProperty.call(v, "doubleValue")) return Number(v.doubleValue);
  if (Object.prototype.hasOwnProperty.call(v, "timestampValue")) return v.timestampValue;
  if (Object.prototype.hasOwnProperty.call(v, "mapValue")) {
    const out = {};
    const fields = (v.mapValue && v.mapValue.fields) || {};
    Object.keys(fields).forEach((k) => {
      out[k] = decodeFirestoreValue(fields[k]);
    });
    return out;
  }
  if (Object.prototype.hasOwnProperty.call(v, "arrayValue")) {
    const arr = (v.arrayValue && v.arrayValue.values) || [];
    return arr.map(decodeFirestoreValue);
  }
  return null;
}

function decodeFirestoreFields(fields) {
  const out = {};
  Object.keys(fields || {}).forEach((k) => {
    out[k] = decodeFirestoreValue(fields[k]);
  });
  return out;
}

async function fetchCollection(collectionId) {
  let pageToken = "";
  const docs = [];
  for (;;) {
    const url = new URL(
      `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents/${collectionId}`
    );
    url.searchParams.set("key", FIREBASE_API_KEY);
    url.searchParams.set("pageSize", "300");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const res = await fetch(url.toString());
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`${collectionId}: ${res.status} ${text}`);
    }
    const json = await res.json();
    (json.documents || []).forEach((d) => {
      const parts = String(d.name || "").split("/");
      const id = parts[parts.length - 1];
      docs.push({
        id,
        data: decodeFirestoreFields(d.fields || {}),
      });
    });
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  return docs;
}

async function main() {
  const out = {
    exportedAt: new Date().toISOString(),
    projectId: FIREBASE_PROJECT_ID,
    collections: {},
  };
  for (const col of COLLECTIONS) {
    const rows = await fetchCollection(col);
    out.collections[col] = rows;
    console.log(`${col}: ${rows.length}`);
  }
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2), "utf8");
  console.log(`Export yazıldı: ${OUT_FILE}`);
}

main().catch((e) => {
  console.error("Export hatası:", e.message || e);
  process.exit(1);
});
