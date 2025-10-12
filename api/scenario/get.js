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

  const { id } = req.query;
  if (!id) return res.status(400).json({ error: 'Missing scenario id' });

  try {
    const doc = await db.doc(`users/${uid}/scenarios/${id}`).get();
    if (!doc.exists) return res.status(404).json({ error: 'Not found' });
    res.json({ id: doc.id, ...doc.data() });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Get failed' });
  }
}
