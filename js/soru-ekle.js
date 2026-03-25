/**
 * Soru havuzu — görsel yükleme + Appwrite döküman (storage fileId → soru_resim_id köprüsü)
 */
import { saveSoruHavuzuEntry, getPoolCoachKey } from "./soru-havuzu-core.js";
import { yksMufredatDatasi } from "./mufredat-data.js";
import "./appwrite-config.js";

var curriculum = yksMufredatDatasi || {};

function $(id) {
  return document.getElementById(id);
}

function fillDersFromSinav() {
  var sinEl = $("seSinav");
  var dersEl = $("seDers");
  var konuEl = $("seKonu");
  if (!sinEl || !dersEl || !konuEl) return;
  var ex = sinEl.value || "TYT";
  var bag = curriculum[ex] || {};
  var dersler = Object.keys(bag).sort(function (a, b) {
    return a.localeCompare(b, "tr");
  });
  dersEl.innerHTML = "";
  dersler.forEach(function (d) {
    var o = document.createElement("option");
    o.value = d;
    o.textContent = d;
    dersEl.appendChild(o);
  });
  fillKonu();
}

function fillKonu() {
  var sinEl = $("seSinav");
  var dersEl = $("seDers");
  var konuEl = $("seKonu");
  if (!sinEl || !dersEl || !konuEl) return;
  var ex = sinEl.value || "TYT";
  var d = dersEl.value;
  var bag = curriculum[ex] || {};
  var list = (bag[d] || []).slice();
  konuEl.innerHTML = "";
  if (!list.length) {
    var ox = document.createElement("option");
    ox.value = "Genel";
    ox.textContent = "Genel";
    konuEl.appendChild(ox);
    return;
  }
  list.forEach(function (t) {
    var o = document.createElement("option");
    o.value = t;
    o.textContent = t;
    konuEl.appendChild(o);
  });
}

function setStatus(msg, kind) {
  var el = $("seStatus");
  if (!el) return;
  el.textContent = msg || "";
  el.className = "st-status" + (kind ? " st-status--" + kind : "");
}

function init() {
  var form = $("formSoruEkle");
  var sinEl = $("seSinav");
  var dersEl = $("seDers");
  if (sinEl) sinEl.addEventListener("change", fillDersFromSinav);
  if (dersEl) dersEl.addEventListener("change", fillKonu);
  fillDersFromSinav();

  if (!form || form.dataset.bound === "1") return;
  form.dataset.bound = "1";

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    var coachKey = getPoolCoachKey();
    if (!coachKey) {
      setStatus("Oturum yok. Önce koç panelinden giriş yapın (currentUser).", "err");
      return;
    }
    var fin = $("seFile");
    if (!fin || !fin.files || !fin.files[0]) {
      setStatus("Görsel dosyası seçin.", "err");
      return;
    }
    var file = fin.files[0];
    var t = (file.type || "").toLowerCase();
    if (t.indexOf("image/") !== 0 && !/\.(png|jpe?g|webp)$/i.test(file.name || "")) {
      setStatus("Yalnızca PNG, JPG veya WebP yükleyin.", "err");
      return;
    }
    var btn = $("seSubmit");
    if (btn) btn.disabled = true;
    setStatus("Yükleniyor ve döküman oluşturuluyor…", "");

    var ders = (dersEl && dersEl.value) || "";
    var konu = (($("seKonu") || {}).value || "").trim();
    var zorluk = (($("seZorluk") || {}).value || "").trim();
    var sinav = (($("seSinav") || {}).value || "").trim();
    var dc = (($("seDogruCevap") || {}).value || "").trim().toUpperCase();

    saveSoruHavuzuEntry({
      coachKey: coachKey,
      imageBlob: file,
      fileName: file.name || "",
      ders: ders,
      konu: konu,
      zorluk: zorluk,
      sinavTipi: sinav,
      source: "manual_soru_ekle",
      dogruCevap: /^[ABCDE]$/.test(dc) ? dc : "",
    })
      .then(function (docId) {
        setStatus("Kayıt oluşturuldu. Storage fileId ile soru_resim_id bağlandı.", "ok");
        var code = $("seDocId");
        if (code) code.textContent = "Belge ID: " + docId;
        try {
          fin.value = "";
        } catch (err) {}
      })
      .catch(function (err) {
        console.error("[soru-ekle]", err);
        setStatus((err && err.message) || String(err), "err");
      })
      .finally(function () {
        if (btn) btn.disabled = false;
      });
  });
}

init();
