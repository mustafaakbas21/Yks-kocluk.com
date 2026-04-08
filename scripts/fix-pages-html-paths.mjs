/**
 * One-shot: pages/*.html içinde css/js göreli yollarını ../ ile düzeltir ve eski kök URL'leri günceller.
 * Çalıştır: node scripts/fix-pages-html-paths.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const pagesDir = path.join(root, "pages");

const files = fs.readdirSync(pagesDir).filter((f) => f.endsWith(".html"));

function fixContent(name, s) {
  var out = s;
  out = out.split('href="css/').join('href="../css/');
  out = out.split("href='css/").join("href='../css/");
  out = out.split('src="js/').join('src="../js/');
  out = out.split("src='js/").join("src='../js/");
  out = out.split('href="js/').join('href="../js/');

  out = out.split('window.location.replace("/super-admin.html")').join('window.location.replace("/pages/super-admin.html")');
  out = out.replace(/content="0;url=koc-panel\.html"/g, 'content="0;url=/pages/koc-panel.html"');
  out = out.split('href="koc-panel.html"').join('href="/pages/koc-panel.html"');
  out = out.split("href='koc-panel.html'").join("href='/pages/koc-panel.html'");
  out = out.split('location.replace("koc-panel.html")').join('location.replace("/pages/koc-panel.html")');
  out = out.split('window.location.replace("/koc-panel?tmOpen=testmaker")').join('window.location.replace("/pages/koc-panel.html?tmOpen=testmaker")');
  out = out.split('href="/koc-panel?tmOpen=testmaker"').join('href="/pages/koc-panel.html?tmOpen=testmaker"');
  out = out.split('href="/koc-panel"').join('href="/pages/koc-panel.html"');
  out = out.split('href="/login"').join('href="/pages/login.html"');
  out = out.split('href="/soru-ekle"').join('href="/pages/soru-ekle.html"');
  out = out.split('href="/soru-pdf-hazirla"').join('href="/pages/soru-pdf-hazirla.html"');

  if (name === "super-admin.html") {
    out = out.split("<strong>/login</strong>").join("<strong>/pages/login.html</strong>");
  }

  return out;
}

for (const f of files) {
  const fp = path.join(pagesDir, f);
  const raw = fs.readFileSync(fp, "utf8");
  const next = fixContent(f, raw);
  if (next !== raw) fs.writeFileSync(fp, next, "utf8");
  console.log("OK", f);
}
