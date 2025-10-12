import { getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "../../lib/firebaseAdmin";

export default async function handler(req, res) {
  await initAdmin();
  const db = getFirestore();
  const { uid } = req.query;

  if (!uid) return res.status(400).json({ error: "Missing UID" });

  try {
    const docRef = db.doc(`users/${uid}/billing/current`);
    const doc = await docRef.get();

    if (!doc.exists) {
      return res.json({ plan: process.env.PLAN_DEFAULT });
    }

    res.json(doc.data());
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch plan" });
  }
}
