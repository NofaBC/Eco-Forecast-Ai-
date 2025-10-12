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
  const { name, inputs } = req.body;
  if (!name || !inputs) return res.status(400).json({ error: 'Missing name or inputs' });

  // Check plan
  const planDoc = await db.doc(`users/${uid}/billing/current`).get();
  const planData = planDoc.exists ? planDoc.data() : {};
  if (!planData.features?.pro) {
    return res.status(403).json({ error: 'Pro plan required' });
  }

  try {
    const ref = db.collection(`users/${uid}/scenarios`).doc();
    await ref.set({
      name,
      inputs,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    res.json({ id: ref.id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Save failed' });
  }
}
