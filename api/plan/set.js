import { getFirestore } from "firebase-admin/firestore";
import { initAdmin } from "../../lib/firebaseAdmin";

export default async function handler(req, res) {
  await initAdmin();
  const db = getFirestore();

  const { uid, plan } = req.body;
  const adminUid = process.env.ADMIN_UID;

  if (!uid || !plan)
    return res.status(400).json({ error: "Missing uid or plan" });

  // Verify admin
  if (req.headers["x-admin-uid"] !== adminUid)
    return res.status(403).json({ error: "Unauthorized" });

  try {
    const ref = db.doc(`users/${uid}/billing/current`);
    await ref.set({
      plan,
      updated: Date.now(),
      features: {
        pro: plan === "pro" || plan === "enterprise",
        enterprise: plan === "enterprise"
      }
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to set plan" });
  }
}
