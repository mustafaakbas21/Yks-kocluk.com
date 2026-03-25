/**
 * Öğrenci paneli — müfredat accordion (TYT/AYT → ders → konu checkbox)
 */
import { mufredatData } from "./mufredat-data.js";

var STORAGE_KEY = "osp_mufredat_topic_done_v1";

function loadDone() {
  try {
    var r = localStorage.getItem(STORAGE_KEY);
    var o = r ? JSON.parse(r) : {};
    return typeof o === "object" && o ? o : {};
  } catch (_e) {
    return {};
  }
}

function saveDone(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch (_e) {}
}

function makeKey(sinav, ders, konu) {
  return sinav + "::" + ders + "::" + konu;
}

export function mountOspMufredatAccordion(containerId) {
  var root = document.getElementById(containerId);
  if (!root) return;
  var done = loadDone();
  root.innerHTML = "";
  root.classList.add("osp-mufredat-root");

  ["TYT", "AYT"].forEach(function (sinav) {
    var subjects = mufredatData[sinav];
    if (!subjects) return;
    var detSinav = document.createElement("details");
    detSinav.className = "osp-muf-sinav";
    detSinav.open = sinav === "TYT";
    var sum1 = document.createElement("summary");
    sum1.textContent = sinav + " — Temel/Yerleştirme sınavı";
    detSinav.appendChild(sum1);

    Object.keys(subjects).forEach(function (ders) {
      var detDers = document.createElement("details");
      detDers.className = "osp-muf-ders";
      var sum2 = document.createElement("summary");
      sum2.textContent = ders;
      detDers.appendChild(sum2);
      subjects[ders].forEach(function (konu) {
        var k = makeKey(sinav, ders, konu);
        var lab = document.createElement("label");
        lab.className = "osp-muf-konu";
        var cb = document.createElement("input");
        cb.type = "checkbox";
        cb.checked = !!done[k];
        cb.addEventListener("change", function () {
          done[k] = cb.checked;
          saveDone(done);
        });
        lab.appendChild(cb);
        lab.appendChild(document.createTextNode(" " + konu));
        detDers.appendChild(lab);
      });
      detSinav.appendChild(detDers);
    });
    root.appendChild(detSinav);
  });
}
