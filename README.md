# YKS Koçluk — Koç Paneli (Firebase)

## Klasör yapısı

```
yks-kocluk/
├── index.html        # Giriş sayfası
├── koc-panel.html    # Koç paneli (giriş zorunlu)
├── css/
│   └── koc-panel.css
├── js/
│   └── koc-panel.js  # Firebase Auth + Firestore (CDN modül)
└── README.md
```

## Çalıştırma

**Önemli:** `koc-panel.html` ve `index.html` dosyalarını **HTTP üzerinden** açın (Live Server, `npx serve` vb.). `file://` ile ES modülleri ve Firebase sorun çıkarabilir.

1. **Giriş (test):** `index.html` — kullanıcı adı `admin`, şifre `admin123`. Oturum `localStorage` ile tutulur.
2. **Firebase Authentication → Sign-in method:** **Anonymous** (Anonim) girişi **etkin** yapın. Panel, `index.html` ile girdikten sonra Firestore’a erişmek için arka planda anonim oturum açar; kurallarınız `request.auth != null` ise veriler yüklenir.
3. **Firestore:** Koleksiyonlar `students`, `exams`, `appointments`. Sayfayı **HTTP** ile açın (`file://` ile modüller çalışmaz → sürekli “Yükleniyor” kalır).

### Koleksiyonlar

- **students** — Paneldeki detaylı öğrenci formu: kimlik, iletişim, okul/YKS hedefi, program, veli, sağlık, koç notları vb.
- **appointments** — Randevu formu: `scheduledAt`, `studentId`, `studentName`, süre, tip, konu…
- **exams** — Deneme kayıt formu + tablo
- **tests** — TestMaker taslağı (`tests`)
- **payments** — Tahsilat formu (`payments`)

Firestore Rules bu koleksiyonlara yazmayı da açmalıdır.

- **Kurucu paneli** (`super-admin.html`): Koç tablosu, KPI, Chart.js. Koç her girişte `users/{uid}.lastLogin` ve `coachLoginLog` kaydı oluşur (grafik için). `firestore.rules.example` içinde `coachLoginLog` ve admin’in `users` güncellemesi (dondurma) tanımlıdır.
- **Şifre sıfırlama:** Başka kullanıcının şifresi yalnızca **Firebase Admin SDK** veya Cloud Function ile değiştirilebilir; paneldeki buton yönerge gösterir.

Panel listeleri **Firestore**’dan gelir; giriş bilgisi `localStorage` ile tutulur.
