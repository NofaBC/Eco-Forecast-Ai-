// api/history/list.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auth, db } from "../_fbAdmin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

    const idToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!idToken) return res.status(401).json({ error: "Missing ID token" });

    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const snap = await db
      .collection("users").doc(uid)
      .collection("forecasts")
      .orderBy("ts", "desc")
      .limit(50)
      .get();

    const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    return res.status(200).json({ items });
  } catch (err: any) {
    console.error("history/list error:", err);
    return res.status(500).json({ error: "Failed to list forecasts" });
  }
}
