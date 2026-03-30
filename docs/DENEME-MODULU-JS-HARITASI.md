# Deneme / Deneme Analizi — JavaScript dosya haritası

Özet: Koç panelinde deneme verisi **Appwrite** `exams` (ve istenen yerlerde `ExamResults`) koleksiyonundan `koc-panel.js` → `cachedExams` akışıyla gelir. Ayrı modüller bu önbelleği veya doğrudan sorguyu kullanır.

## Ana yükleme

| Dosya | HTML bağlantısı | Görev |
|--------|-----------------|--------|
| `js/koc-panel.js` | `koc-panel.html` (ana script) | Öğrenci/deneme CRUD, dashboard tablosu (`denemeTableBody`), karne (`renderKarneReport`), öğrenci detayında deneme listesi ve trend grafiği (`studentDetailExamsBody`, `studentDetailTrendChart`), `cachedExams`, `onExamsSnap` ile canlı senkron. |
| `js/deneme-analizi.js` | `koc-panel.html` → `<script type="module" src="js/deneme-analizi.js">` | **Premium karne** (`#denemeAnaliziPremiumRoot`), Chart.js radar/bar; **Denemeler** planlama tablosu (`dnm*`, `coach_exam_plan` kayıtları); navigasyon hook ile `deneme-analiz-denemeler` / `deneme-analiz-takvim` açılınca liste yenileme. |
| `js/gorusme-odasi-cockpit.js` | `koc-panel.js` içinden `initGorusmeOdasiCockpit()` | Görüşme Odası: `goTrendCanvas` son 5 deneme net trendi; zayıf branş listesi; hedef çubukları — veri `YKSPanel.getCachedExams()`. |
| `js/mr-cockpit.js` | `koc-panel.js` import (`initMrCockpit`, `refreshMrIfActive`) | **Deneme MR** (`#mrAccordionDeneme`): `exams` içindeki `yksBranchDetail` ile branş D/Y toplamlarını konu satırlarına böler. |
| `js/net-sihirbazi-ui.js` | Koç panelinde Net Sihirbazı görünümü | Güncel net çözümü; deneme `yksBranchDetail` ile bağlanır (statik deneme listesi yok). |
| `js/net-sihirbazi-branch-nets.js` | `net-sihirbazi-ui.js` motoru | Branş neti hesaplama (`exams` tabanlı). |
| `js/yks-mufredat.js` | Birçok modül | TYT/AYT branş tanımları, net kuralları; deneme analizi ve MR ile paylaşılır. |
| `js/appwrite-compat.js` | Tüm Appwrite okuma/yazma | `collection`, `onSnapshot`, `query`, `where` vb. |
| `js/appwrite-config.js` | Koleksiyon ID’leri | `APPWRITE_COLLECTION_EXAM_RESULTS` vb. |

## Öğrenci paneli (referans)

| Dosya | HTML | Görev |
|--------|------|--------|
| `ogrenci-panel.html` + ilgili JS modülleri | Öğrenci arayüzü | Koçun senkronize ettiği deneme özetleri; bu raporda odak koç paneli. |

## Kaldırılmış / yedek (kullanım dışı)

| Dosya | Not |
|--------|-----|
| `_YEDEKLER_VE_COPLER/_eski_kodlar_arsivi/js/denemeler-app.js` | Eski takvim / deneme kodu; aktif `koc-panel` akışına bağlı değil. |
| `_YEDEKLER_VE_COPLER/.../denemeler-app.js` | Aynı. |

## Veri akışı (kısa)

1. Koç girişi → `subscribeFirestore()` → `exams` snapshot → `cachedExams`.
2. Dashboard **Son Deneme Analizleri** → `renderDashboardExams()` → `denemeTableBody`.
3. **Deneme Analizi → Karnesi** → `deneme-analizi.js` öğrenci seçimine göre `exams` + `ExamResults` birleştirir.
4. **Denemeler** sayfası → yalnız `recordType: coach_exam_plan` (veya eşdeğer işaret) kayıtlarını listeler.
5. **Deneme MR** → `mr-cockpit.js` seçili öğrencinin `cachedExams` kayıtlarından `yksBranchDetail` okur.

---
*Otomatik üretim: proje taraması (Mart 2026).*
