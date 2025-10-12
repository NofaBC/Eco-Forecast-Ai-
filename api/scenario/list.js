import { getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "../../lib/firebaseAdmin";

export default async function handler(req, res) {
  await initAdmin();
  const db = getFirestore();
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ error: 'Missing auth token' });
  const decoded = await admin.auth().verifyIdToken(token);
  const uid = decoded.uid;

  try {
    const snap = await db.collection(`users/${uid}/scenarios`)
      .orderBy('createdAt', 'desc')
      .limit(20)
      .get();
    const list = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ scenarios: list });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'List failed' });
  }
}
