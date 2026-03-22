import 'dotenv/config'
import cors from 'cors'
import express from 'express'
import admin from 'firebase-admin'

let db = null
try {
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      })
    }
    db = admin.firestore()
  }
} catch (e) {
  console.warn('[yks-api] Firebase Admin atlanıyor:', e.message)
}

const app = express()
const port = Number(process.env.PORT) || 8787

app.use(cors({ origin: process.env.CORS_ORIGIN?.split(',') ?? true }))
app.use(express.json())

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'yks-kocluk-api',
    firestore: Boolean(db),
  })
})

app.post('/api/trial-results/bulk', async (req, res) => {
  const payload = req.body
  if (!payload?.examId || !Array.isArray(payload.rows)) {
    return res.status(400).json({ error: 'examId ve rows gerekli' })
  }
  if (!db) {
    return res.status(202).json({
      accepted: true,
      persisted: false,
      message: 'Firestore yapılandırılmadı; istemci tarafı SDK ile kayıt kullanın.',
    })
  }
  const ref = db.collection('trial_results').doc()
  await ref.set({
    examId: payload.examId,
    rows: payload.rows,
    createdAt: new Date().toISOString(),
  })
  return res.json({ accepted: true, persisted: true, id: ref.id })
})

app.listen(port, () => {
  console.log(`YKS Koçluk API http://localhost:${port}`)
})
