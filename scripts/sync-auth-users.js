const APPWRITE_ENDPOINT = "https://fra.cloud.appwrite.io/v1";
const APPWRITE_PROJECT_ID = "69c12f05001b051b2f14";
const APPWRITE_DATABASE_ID = "derece_panel";
const USERS_COLLECTION_ID = "users";
const EMAIL_DOMAIN = "@sistem.com";

const ADMIN_USERNAME = "admin21";
const ADMIN_EMAIL = `${ADMIN_USERNAME}${EMAIL_DOMAIN}`;
const ADMIN_PASSWORD = "admin123";

const DEFAULT_USER_PASSWORD = "TempPass123!";

const APPWRITE_API_KEY = process.env.APPWRITE_API_KEY || "";

if (!APPWRITE_API_KEY) {
  console.error("APPWRITE_API_KEY ortam değişkeni bulunamadı.");
  process.exit(1);
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
    err.code = Number(json.code || res.status);
    err.response = json;
    throw err;
  }
  return json;
}

function sanitizeUsername(v) {
  return String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "");
}

function usernameToEmail(username, fallbackEmail) {
  const fb = String(fallbackEmail || "").trim().toLowerCase();
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fb)) return fb;
  const u = sanitizeUsername(username);
  if (!u) return "";
  return `${u}${EMAIL_DOMAIN}`;
}

async function listAllDatabaseUsers() {
  const out = [];
  let offset = 0;
  while (true) {
    const res = await adminCall(
      "GET",
      `/databases/${APPWRITE_DATABASE_ID}/collections/${USERS_COLLECTION_ID}/documents?limit=100&offset=${offset}`
    );
    const docs = res.documents || [];
    out.push(...docs);
    if (docs.length < 100) break;
    offset += docs.length;
  }
  return out;
}

async function listAllAuthUsers() {
  const out = [];
  let offset = 0;
  while (true) {
    const res = await adminCall("GET", `/users?limit=100&offset=${offset}`);
    const items = res.users || [];
    out.push(...items);
    if (items.length < 100) break;
    offset += items.length;
  }
  return out;
}

async function ensureAuthUserByDbDoc(doc, authByEmail, authById) {
  const dbId = String(doc.$id || "");
  const dbUsername = sanitizeUsername(doc.username || "");
  const dbEmail = usernameToEmail(dbUsername, doc.email || "");
  if (!dbEmail) return { created: false, skipped: true, reason: "email/yusername yok" };

  const byEmail = authByEmail.get(dbEmail);
  if (byEmail) {
    authById.set(byEmail.$id, byEmail);
    return { created: false, skipped: false, userId: byEmail.$id };
  }

  const preferredUserId = dbId || `u_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  try {
    const created = await adminCall("POST", "/users", {
      userId: preferredUserId,
      email: dbEmail,
      password: DEFAULT_USER_PASSWORD,
      name: dbUsername || undefined,
    });
    authByEmail.set(dbEmail, created);
    authById.set(created.$id, created);
    return { created: true, skipped: false, userId: created.$id };
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (/already exists|user_already_exists|email already/i.test(msg)) {
      const refreshedAll = await listAllAuthUsers();
      for (const u of refreshedAll) {
        const em = String(u.email || "").trim().toLowerCase();
        if (em) authByEmail.set(em, u);
        authById.set(u.$id, u);
      }
      const existing = authByEmail.get(dbEmail);
      if (existing) return { created: false, skipped: false, userId: existing.$id };
    }
    throw e;
  }
}

async function ensureAdmin21(authByEmail, authById) {
  let admin = authByEmail.get(ADMIN_EMAIL);
  if (!admin) {
    admin = await adminCall("POST", "/users", {
      userId: `admin21_${Date.now()}`,
      email: ADMIN_EMAIL,
      password: ADMIN_PASSWORD,
      name: ADMIN_USERNAME,
    });
  } else {
    await adminCall("PATCH", `/users/${admin.$id}/password`, { password: ADMIN_PASSWORD });
    try {
      await adminCall("PATCH", `/users/${admin.$id}/name`, { name: ADMIN_USERNAME });
    } catch (_e) {}
  }
  authByEmail.set(ADMIN_EMAIL, admin);
  authById.set(admin.$id, admin);
  return admin;
}

async function ensureAdminDbDoc(adminAuthUser, dbUsers) {
  const has = dbUsers.some((d) => String(d.role || "") === "admin" && sanitizeUsername(d.username || "") === ADMIN_USERNAME);
  if (has) return;
  const payload = {
    username: ADMIN_USERNAME,
    role: "admin",
    coach_id: null,
    fullName: null,
    createdAt: new Date().toISOString(),
  };
  try {
    await adminCall("POST", `/databases/${APPWRITE_DATABASE_ID}/collections/${USERS_COLLECTION_ID}/documents`, {
      documentId: adminAuthUser.$id,
      data: payload,
      permissions: ['read("any")', 'write("any")'],
    });
  } catch (e) {
    const msg = String((e && e.message) || "");
    if (/already exists|document_already_exists/i.test(msg)) return;
    throw e;
  }
}

async function deleteOtherAdminAuthUsers(dbUsers, authByEmail) {
  const adminUsernamesInDb = new Set(
    dbUsers
      .filter((d) => String(d.role || "") === "admin")
      .map((d) => sanitizeUsername(d.username || ""))
      .filter(Boolean)
  );
  const keepEmails = new Set([ADMIN_EMAIL]);
  adminUsernamesInDb.forEach((u) => {
    if (u === ADMIN_USERNAME) keepEmails.add(`${u}${EMAIL_DOMAIN}`);
  });

  let removed = 0;
  const allAuthUsers = Array.from(authByEmail.values());
  for (const u of allAuthUsers) {
    const email = String(u.email || "").trim().toLowerCase();
    const local = email.split("@")[0] || "";
    const shouldConsiderAsAdmin = adminUsernamesInDb.has(local) || email === ADMIN_EMAIL;
    if (!shouldConsiderAsAdmin) continue;
    if (keepEmails.has(email)) continue;
    await adminCall("DELETE", `/users/${u.$id}`);
    removed++;
  }
  return removed;
}

async function main() {
  console.log("DB users okunuyor...");
  const dbUsers = await listAllDatabaseUsers();
  console.log(`DB users: ${dbUsers.length}`);

  console.log("Auth users okunuyor...");
  const authUsers = await listAllAuthUsers();
  const authByEmail = new Map();
  const authById = new Map();
  authUsers.forEach((u) => {
    const em = String(u.email || "").trim().toLowerCase();
    if (em) authByEmail.set(em, u);
    authById.set(u.$id, u);
  });
  console.log(`Auth users: ${authUsers.length}`);

  let createdCount = 0;
  let skippedCount = 0;
  for (const doc of dbUsers) {
    const res = await ensureAuthUserByDbDoc(doc, authByEmail, authById);
    if (res.created) createdCount++;
    if (res.skipped) skippedCount++;
  }

  const adminUser = await ensureAdmin21(authByEmail, authById);
  await ensureAdminDbDoc(adminUser, dbUsers);
  const deletedAdminCount = await deleteOtherAdminAuthUsers(dbUsers, authByEmail);

  console.log("---- Özet ----");
  console.log(`DB->Auth oluşturulan hesap: ${createdCount}`);
  console.log(`DB'de yetersiz veri nedeniyle atlanan: ${skippedCount}`);
  console.log(`Korunan admin hesabı: ${ADMIN_EMAIL}`);
  console.log(`Silinen diğer admin auth hesabı: ${deletedAdminCount}`);
  console.log("Tamamlandı.");
}

main().catch((e) => {
  console.error("sync-auth-users hatası:", e && e.message ? e.message : e);
  process.exit(1);
});

