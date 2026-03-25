/**
 * YÖK Atlas tarzı örnek veri — üniversite × bölüm şablonu kataloğu (yok-atlas-catalog.js).
 * Taban puanları (baseScore2025) gerçek ÖSYM yerleştirmesi değildir; 2025 tarzı aralıkta
 * prestij + şablon zorluğu + deterministik yayılım ile üretilir (sunum / eğitim simülasyonu).
 *
 * Çoğu program `üniversiteId__şablonId` ile anlık `buildProgramFromUniTemplate` ile üretilir;
 * aşağıdaki sabit id’ler geriye dönük uyum içindir.
 */
import {
  TR_UNIVERSITIES_UNIQUE,
  PROGRAM_TEMPLATES,
  PROGRAM_TEMPLATES_UI,
  buildProgramFromUniTemplate,
  sampleProgramsForHedefSimulator,
  rowsFromTyAyt as rowsFromTyAytCatalog,
} from "./yok-atlas-catalog.js";

export {
  TR_UNIVERSITIES_UNIQUE,
  PROGRAM_TEMPLATES,
  PROGRAM_TEMPLATES_UI,
  buildProgramFromUniTemplate,
  rowsFromTyAytCatalog as rowsFromTyAyt,
};

/** @deprecated Net Sihirbazı için TR_UNIVERSITIES_UNIQUE kullanın */
export const YOK_ATLAS_UNIVERSITIES = [];

/** EA ekleri (sabit id ile geriye dönük uyum) */
const YOK_ATLAS_PROGRAMS_EA_EXTRA = [
  {
    id: "itu-isletme-ea",
    university: "İTÜ",
    department: "İşletme Mühendisliği",
    baseScore2025: 412.3,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 36 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 17 },
      { section: "TYT", name: "Temel Matematik", targetNet: 35 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 32 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 32 },
      { section: "AYT", name: "Tarih-1", targetNet: 22 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 20 },
    ],
  },
  {
    id: "bogazici-iktisat-ea",
    university: "Boğaziçi Üniversitesi",
    department: "İktisat",
    baseScore2025: 489.5,
    rows: [
      { section: "TYT", name: "Türkçe", targetNet: 37 },
      { section: "TYT", name: "Sosyal Bilimler", targetNet: 18 },
      { section: "TYT", name: "Temel Matematik", targetNet: 36 },
      { section: "TYT", name: "Fen Bilimleri", targetNet: 26 },
      { section: "AYT", name: "Matematik", targetNet: 34 },
      { section: "AYT", name: "Türk Dili ve Edebiyatı", targetNet: 33 },
      { section: "AYT", name: "Tarih-1", targetNet: 23 },
      { section: "AYT", name: "Coğrafya-1", targetNet: 21 },
    ],
  },
];

/**
 * `findAtlasProgramById` önce bu dizide arar; yoksa `uniId__şablonId` ile katalogdan üretir.
 * Büyük önbellek yerine EA örnekleri; tam liste dinamiktir.
 */
export const YOK_ATLAS_PROGRAMS = YOK_ATLAS_PROGRAMS_EA_EXTRA.slice();

export function findAtlasProgramById(id) {
  var sid = String(id || "");
  var hit = YOK_ATLAS_PROGRAMS.find(function (p) {
    return p.id === sid;
  });
  if (hit) return hit;
  var idx = sid.indexOf("__");
  if (idx === -1) return null;
  var uniId = sid.slice(0, idx);
  var tmplId = sid.slice(idx + 2);
  return buildProgramFromUniTemplate(uniId, tmplId);
}

export function findProgramByUniAndDept(uniId, deptId) {
  return buildProgramFromUniTemplate(String(uniId || ""), String(deptId || ""));
}

export function programFromUniversityDepartment(uni, dept) {
  return buildProgramFromUniTemplate(uni.id, dept.id);
}

export function flattenUniversitiesToPrograms() {
  return sampleProgramsForHedefSimulator(2000);
}
