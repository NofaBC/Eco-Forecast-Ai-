// api/history/save.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import admin from 'firebase-admin';

interface ForecastPayload {
  event: string;
  geo: string;
  naics: string;
  horizon: string;
  scenario: string;
  extra_factors: string;
}

interface ForecastResult {
  summary: string;
  demand_pct: number;
  cost_pct: number;
  margin_bps: number;
  drivers: string[];
  assumptions: string[];
  risks: string[];
  local_signals: string[];
  time_path: string[];
  actions: string[];
  confidence: number;
  meta?: Record<string, any>;
}

interface SaveRequestBody {
  payload: ForecastPayload;
  result: ForecastResult;
}

// --- Initialize Firebase Admin lazily ---
function initAdmin() {
  if (admin.apps.length > 0) return admin.app();
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error('Missing Firebase admin env vars');
  }
  return admin.initializeApp({
    credential: admin.credential.cert({
      projectId: FIREBASE_PROJECT_ID,
      clientEmail: FIREBASE_CLIENT_EMAIL,
      privateKey: FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    }),
  });
}

async function verifyAuth(req: NextApiRequest) {
  const hdr = req.headers.authorization || '';
  const match = hdr.match(/^Bearer (.+)$/i);
  if (!match) throw new Error('Missing Authorization Bearer token');
  const app = initAdmin();
  return app.auth().verifyIdToken(match[1]);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    if (!req.headers['content-type']?.includes('application/json'))
      return res.status(400).json({ error: 'Content-Type must be application/json' });

    const decoded = await verifyAuth(req);
    const uid = decoded.uid;
    const { payload, result }: SaveRequestBody = req.body;

    if (!payload || !result)
      return res.status(400).json({ error: 'Missing payload or result' });

    const app = initAdmin();
    const db = app.firestore();

    const doc = {
      payload,
      result,
      ts: admin.firestore.FieldValue.serverTimestamp(),
    };

    const ref = await db.collection('users').doc(uid).collection('forecasts').add(doc);
    return res.status(200).json({ ok: true, id: ref.id });
  } catch (err: any) {
    console.error('history/save error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
