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
2. **Firestore:** `students`, `exams`, `appointments`. Kurallar `request.auth` istiyorsa, panelde Firebase Auth olmadığı için okuma/yazma reddedilebilir; test için kuralları geçici olarak genişletmeniz veya anonim erişim tanımlamanız gerekebilir.

### Örnek alanlar

- **appointments:** `studentName`, `scheduledAt` (Timestamp) veya `date` + `time`, isteğe bağlı `title`
- **exams:** `studentName`, `examType` veya `tur` (`TYT`/`AYT`), `net`, `examDate` veya `date`, `status`
- **students:** `name`, isteğe bağlı `track`, `avatarSeed`

Veri **yalnızca Firestore**’dan okunur; localStorage kullanılmaz.
