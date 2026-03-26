/**
 * Firebase Firestore export (firebase-export.json) → Appwrite Databases
 *
 * Önemli: Appwrite’da aynı koleksiyonda attribute’lar sırayla oluşturulmalı;
 * her oluşturma sonrası status === "available" olana kadar beklenir.
 */
import fs from "node:fs";
import { Client, Storage, ID, InputFile } from "appwrite";

const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "69c12f05001b051b2f14";
const DATABASE_ID = "derece_panel";
const BUCKET_ID = "soru_havuzu";
const INPUT = "firebase-export.json";
const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";

const client = new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID);
if (APPWRITE_API_KEY) {
  client.headers["X-Appwrite-Key"] = APPWRITE_API_KEY;
}
const storage = new Storage(client);

const COLLECTIONS_ORDER = [
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

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function adminCall(method, path, body) {
  const url = `${APPWRITE_ENDPOINT}${path}`;
  const headers = {
    "X-Appwrite-Project": APPWRITE_PROJECT_ID,
    "X-Appwrite-Key": APPWRITE_API_KEY,
    "Content-Type": "application/json",
  };
  const res = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch (_e) {
    json = { message: text };
  }
  if (!res.ok) {
    const err = new Error(json.message || `${res.status}`);
    err.code = json.code != null ? json.code : res.status;
    err.response = json;
    throw err;
  }
  return json;
}

function inferType(value) {
  if (value === null || typeof value === "undefined") return null;
  if (Array.isArray(value)) {
    if (!value.length) return { type: "string", array: true, size: 4096 };
    const inner = inferType(value[0]) || { type: "string", array: false, size: 4096 };
    return Object.assign({}, inner, { array: true });
  }
  if (typeof value === "boolean") return { type: "boolean", array: false };
  if (typeof value === "number") {
    if (Number.isInteger(value)) return { type: "integer", array: false, min: -2147483648, max: 2147483647 };
    return { type: "float", array: false, min: -1e15, max: 1e15 };
  }
  if (typeof value === "string") {
    const dt = Date.parse(value);
    if (!Number.isNaN(dt) && /\d{4}-\d{2}-\d{2}T/.test(value)) return { type: "datetime", array: false };
    return { type: "string", array: false, size: Math.max(128, Math.min(65535, value.length + 128)) };
  }
  if (typeof value === "object") return { type: "string", array: false, size: 65535, isJson: true };
  return { type: "string", array: false, size: 1024 };
}

function mergeType(a, b) {
  if (!a) return b;
  if (!b) return a;
  if (a.type === b.type && !!a.array === !!b.array) {
    if (a.type === "string") return Object.assign({}, a, { size: Math.min(65535, Math.max(a.size || 256, b.size || 256)) });
    return a;
  }
  return { type: "string", array: a.array || b.array, size: 65535 };
}

/** Export boş olsa bile bu koleksiyonlarda minimum sütunlar oluşturulsun */
const STATIC_SCHEMA_FALLBACK = {
  soru_havuzu: {
    coach_id: { type: "string", size: 256, array: false },
    image_url: { type: "string", size: 65535, array: false },
    ders: { type: "string", size: 512, array: false },
    konu: { type: "string", size: 512, array: false },
    zorluk: { type: "string", size: 128, array: false },
    sinav: { type: "string", size: 128, array: false },
    source: { type: "string", size: 64, array: false },
    cozuldu: { type: "boolean", array: false },
    storage_file_id: { type: "string", size: 512, array: false },
    soru_resim_id: { type: "string", size: 512, array: false },
    dogru_cevap: { type: "string", size: 8, array: false },
  },
};

function mergeSchemas(a, b) {
  const out = Object.assign({}, a || {});
  Object.keys(b || {}).forEach((k) => {
    out[k] = mergeType(out[k], b[k]);
  });
  return out;
}

function collectSchema(rows) {
  const schema = {};
  (rows || []).forEach((row) => {
    const data = row.data || {};
    Object.keys(data).forEach((k) => {
      if (k.startsWith("$")) return;
      const detected = inferType(data[k]);
      if (detected) schema[k] = mergeType(schema[k], detected);
    });
  });
  return schema;
}

function sanitizeForAppwrite(value) {
  if (value === null || typeof value === "undefined") return value;
  if (Array.isArray(value)) {
    return value.map((x) => {
      if (x && typeof x === "object") return JSON.stringify(x);
      return sanitizeForAppwrite(x);
    });
  }
  if (typeof value === "object") {
    return JSON.stringify(value);
  }
  return value;
}

function sanitizePayloadForAppwrite(payload) {
  const out = {};
  Object.keys(payload || {}).forEach((k) => {
    out[k] = sanitizeForAppwrite(payload[k]);
  });
  return out;
}

/**
 * Tek bir attribute’un "available" olmasını bekle (polling).
 */
async function waitForAttributeAvailable(collectionId, key, maxAttempts = 180) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const info = await adminCall("GET", `/databases/${DATABASE_ID}/collections/${collectionId}`);
    const attr = (info.attributes || []).find((a) => a.key === key);
    if (!attr) {
      log(`  [bekleme] "${key}" listede yok (deneme ${attempt}/${maxAttempts})`);
      await sleep(1500);
      continue;
    }
    if (attr.status === "available") {
      log(`  ✓ "${key}" → available`);
      return;
    }
    if (attr.status === "failed") {
      throw new Error(`Attribute "${key}" başarısız: ${JSON.stringify(attr.error || attr)}`);
    }
    log(`  … "${key}" status=${attr.status} (${attempt}/${maxAttempts})`);
    await sleep(1500);
  }
  throw new Error(`Timeout: "${key}" attribute available olmadı`);
}

async function createOneAttribute(collectionId, key, meta) {
  const pathBase = `/databases/${DATABASE_ID}/collections/${collectionId}/attributes`;
  const array = !!meta.array;

  const tryPost = async (subpath, body) => {
    try {
      await adminCall("POST", `${pathBase}/${subpath}`, body);
      log(`  + POST .../attributes/${subpath} key="${key}" gönderildi`);
    } catch (e) {
      const c = Number(e.code);
      if (c === 409) {
        log(`  = "${key}" zaten mevcut (409), availability bekleniyor`);
      } else {
        console.error("VERI CEKME HATASI:", e);
        throw e;
      }
    }
  };

  if (meta.type === "boolean") {
    await tryPost("boolean", { key, required: false, array, default: false });
  } else if (meta.type === "integer") {
    await tryPost("integer", {
      key,
      required: false,
      array,
      min: meta.min != null ? meta.min : -2147483648,
      max: meta.max != null ? meta.max : 2147483647,
    });
  } else if (meta.type === "float") {
    await tryPost("float", {
      key,
      required: false,
      array,
      min: meta.min != null ? meta.min : -1e15,
      max: meta.max != null ? meta.max : 1e15,
    });
  } else if (meta.type === "datetime") {
    await tryPost("datetime", { key, required: false, array });
  } else {
    const size = Math.min(65535, Math.max(1, meta.size || 1024));
    await tryPost("string", { key, size, required: false, array });
  }

  await waitForAttributeAvailable(collectionId, key);
}

/**
 * Şema anahtarlarını deterministik sırayla oluştur (sıralı attribute kuralı).
 */
async function ensureAttributesForCollection(collectionId, schema) {
  const keys = Object.keys(schema).filter((k) => !k.startsWith("$")).sort();
  if (keys.length === 0) {
    log(`[${collectionId}] Şemada alan yok (boş koleksiyon veya veri yok); attribute oluşturulmadı.`);
    return;
  }
  log(`[${collectionId}] ${keys.length} attribute oluşturulacak/beklenecek…`);
  for (const key of keys) {
    const meta = schema[key];
    if (!meta) continue;
    log(`[${collectionId}] → attribute "${key}" (${meta.type}${meta.array ? "[]" : ""})`);
    await createOneAttribute(collectionId, key, meta);
  }
  log(`[${collectionId}] Tüm attribute'lar hazır.`);
}

async function ensureDatabaseAndEmptyCollections(cols) {
  if (!APPWRITE_API_KEY) {
    throw new Error("APPWRITE_API_KEY eksik. Ortam değişkeni olarak ayarlayın.");
  }
  log("Adım 1: Veritabanı kontrolü…");
  try {
    await adminCall("GET", `/databases/${DATABASE_ID}`);
    log(`  Veritabanı "${DATABASE_ID}" mevcut.`);
  } catch (e) {
    if (Number(e.code) === 404) {
      await adminCall("POST", `/databases`, {
        databaseId: DATABASE_ID,
        name: "Derece Panel",
        enabled: true,
      });
      log(`  Veritabanı "${DATABASE_ID}" oluşturuldu.`);
    } else {
      console.error("VERI CEKME HATASI:", e);
      throw e;
    }
  }

  log("Adım 2: Koleksiyonlar (yoksa oluştur)…");
  for (const collectionId of COLLECTIONS_ORDER) {
    try {
      await adminCall("GET", `/databases/${DATABASE_ID}/collections/${collectionId}`);
      log(`  Koleksiyon "${collectionId}" mevcut.`);
    } catch (e) {
      if (Number(e.code) === 404) {
        await adminCall("POST", `/databases/${DATABASE_ID}/collections`, {
          collectionId,
          name: collectionId,
          permissions: [],
          documentSecurity: false,
          enabled: true,
        });
        log(`  Koleksiyon "${collectionId}" oluşturuldu.`);
      } else {
        console.error("VERI CEKME HATASI:", e);
        throw e;
      }
    }
  }
}

async function createOrUpdateDocument(collectionId, id, data) {
  try {
    await adminCall("POST", `/databases/${DATABASE_ID}/collections/${collectionId}/documents`, {
      documentId: id,
      data: data,
      permissions: ['read("any")', 'write("any")'],
    });
    return "created";
  } catch (e) {
    if (Number(e && e.code) === 409) {
      await adminCall("PATCH", `/databases/${DATABASE_ID}/collections/${collectionId}/documents/${id}`, {
        data: data,
      });
      return "updated";
    }
    throw e;
  }
}

async function migrateSoruHavuzuRecord(row) {
  const data = Object.assign({}, row.data || {});
  const out = {
    coach_id: data.coach_id || "",
    image_url: data.image_url || data.imageUrl || "",
    ders: data.ders || "",
    konu: data.konu || "",
    zorluk: data.zorluk || "",
    sinav: data.sinav || data.sinavTipi || "",
    source: data.source || "manual",
    cozuldu: !!data.cozuldu,
    storage_file_id: data.storage_file_id || "",
  };

  if (!out.storage_file_id && out.image_url) {
    try {
      const res = await fetch(out.image_url);
      if (res.ok) {
        const blob = await res.blob();
        const ext = (blob.type || "").includes("jpeg") ? "jpg" : "png";
        const fileId = ID.unique();
        const arrayBuffer = await blob.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const f = InputFile.fromBuffer(buffer, `soru_${fileId}.${ext}`);
        await storage.createFile(BUCKET_ID, fileId, f);
        out.storage_file_id = fileId;
        out.image_url = storage.getFileView(BUCKET_ID, fileId);
      }
    } catch (err) {
      console.error("VERI CEKME HATASI (soru_havuzu görsel):", err);
    }
  }
  return out;
}

async function main() {
  if (!fs.existsSync(INPUT)) {
    throw new Error(`Eksik dosya: ${INPUT}`);
  }
  log(`Dosya okunuyor: ${INPUT}`);
  const raw = fs.readFileSync(INPUT, "utf8");
  const json = JSON.parse(raw);
  const cols = json.collections || {};

  await ensureDatabaseAndEmptyCollections(cols);

  log("Adım 3: Her koleksiyon için şema → attribute oluşturma + available bekleme…");
  for (const collectionId of COLLECTIONS_ORDER) {
    const rows = cols[collectionId] || [];
    let schema = collectSchema(rows);
    const fallback = STATIC_SCHEMA_FALLBACK[collectionId];
    if (fallback) {
      schema = mergeSchemas(fallback, schema);
      log(`[${collectionId}] Veri + sabit şema birleştirildi (${Object.keys(schema).length} alan).`);
    }
    try {
      await ensureAttributesForCollection(collectionId, schema);
    } catch (e) {
      console.error("VERI CEKME HATASI:", e);
      throw e;
    }
  }

  log("Adım 4: Belgeleri aktarma (createDocument)…");
  const entries = COLLECTIONS_ORDER.map((id) => [id, cols[id] || []]).filter(([, rows]) => (rows || []).length > 0);

  if (!entries.length) {
    log("Aktarılacak satır yok.");
    return;
  }

  let total = 0;
  for (const [collectionId, rows] of entries) {
    let created = 0;
    let updated = 0;
    let failed = 0;
    log(`--- ${collectionId}: ${rows.length} satır ---`);
    for (const row of rows || []) {
      const docId = String(row.id || ID.unique());
      let payload = row.data || {};
      if (collectionId === "soru_havuzu") {
        payload = await migrateSoruHavuzuRecord(row);
      }
      if (payload && typeof payload === "object") {
        payload = sanitizePayloadForAppwrite(payload);
      }
      try {
        const mode = await createOrUpdateDocument(collectionId, docId, payload);
        if (mode === "created") created++;
        else updated++;
      } catch (e) {
        failed++;
        console.error("VERI CEKME HATASI:", e);
        log(`  [HATA] ${collectionId}/${docId}:`, e.message || e);
      }
      total++;
      if (total % 25 === 0) await sleep(200);
    }
    log(`${collectionId}: created=${created} updated=${updated} failed=${failed}`);
  }

  log("Tamamlandı. Toplam işlenen satır:", total);
}

main().catch((e) => {
  console.error("Import hatası:", e.code || "", e.message || e);
  if (!APPWRITE_API_KEY) {
    console.error("İpucu: APPWRITE_API_KEY tanımlı değil.");
  }
  process.exit(1);
});
