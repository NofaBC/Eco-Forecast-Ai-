// api/history/list.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import admin from 'firebase-admin';

// --- Lazy Firebase Admin init (works on Vercel cold starts) ---
function initAdmin() {
  if (admin.apps.length) return admin.app();
  const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY } = process.env;
  if (!FIREBASE_PROJECT_ID || !FIREBASE_CLIENT_EMAIL || !FIREBASE_PRIVATE_KEY) {
    throw new Error('Missing Firebase admin env vars.');
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
  const hdr = String(req.headers.authorization || '');
  const m = hdr.match(/^Bearer (.+)$/i);
  if (!m) throw new Error('Missing Authorization Bearer token');
  const app = initAdmin();
  return app.auth().verifyIdToken(m[1]);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    const decoded = await verifyAuth(req);
    const uid = decoded.uid;

    const app = initAdmin();
    const db = app.firestore();

    // Pagination: ?limit=25&cursor=<docId>
    const limit = Math.max(1, Math.min(100, Number(req.query.limit || 25)));
    const cursorId = typeof req.query.cursor === 'string' ? req.query.cursor : undefined;

    let query = db
      .collection('users').doc(uid)
      .collection('forecasts')
      .orderBy('ts', 'desc')
      .limit(limit);

    if (cursorId) {
      const cursorDoc = await db
        .collection('users').doc(uid)
        .collection('forecasts').doc(cursorId)
        .get();
      if (cursorDoc.exists) query = query.startAfter(cursorDoc);
    }

    const snap = await query.get();

    const items = snap.docs.map(d => {
      const x = d.data() || {};
      const ts =
        x.ts && typeof (x.ts as any).toDate === 'function'
          ? (x.ts as admin.firestore.Timestamp).toDate().toISOString()
          : null;

      return {
        id: d.id,
        ts,
        payload: x.payload || {},
        result: x.result || {},
      };
    });

    const nextCursor = items.length === limit ? items[items.length - 1].id : null;

    return res.status(200).json({ ok: true, items, nextCursor });
  } catch (err: any) {
    console.error('history/list error:', err);
    return res.status(500).json({ error: err.message || String(err) });
  }
}
