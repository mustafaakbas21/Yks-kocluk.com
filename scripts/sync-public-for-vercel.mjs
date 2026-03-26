/**
 * If Vercel "Root Directory" must be `public`, run before deploy:
 *   node scripts/sync-public-for-vercel.mjs
 * Then deploy with Root Directory = public (Build Command can run this script).
 * Prefer instead: Vercel Root Directory = empty (repo root) so this mirror is unnecessary.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const pub = path.join(root, "public");

function copyHtmlFromRoot() {
  for (const name of fs.readdirSync(root)) {
    if (name.endsWith(".html")) {
      fs.copyFileSync(path.join(root, name), path.join(pub, name));
    }
  }
}

function copyDir(name) {
  const src = path.join(root, name);
  const dest = path.join(pub, name);
  if (!fs.existsSync(src)) return;
  if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true, force: true });
  fs.cpSync(src, dest, { recursive: true });
}

fs.mkdirSync(pub, { recursive: true });
copyHtmlFromRoot();
copyDir("css");
copyDir("js");
copyDir("api");
console.log("Synced *.html, css/, js/, api/ → public/");
