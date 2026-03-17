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

### Örnek alanlar

- **appointments:** `studentName`, `scheduledAt` (Timestamp) veya `date` + `time`, isteğe bağlı `title`
- **exams:** `studentName`, `examType` veya `tur` (`TYT`/`AYT`), `net`, `examDate` veya `date`, `status`
- **students:** `name`, isteğe bağlı `track`, `avatarSeed`

Panel listeleri **Firestore**’dan gelir; giriş bilgisi `localStorage` ile tutulur.
