// api/history/save.ts
import type { VercelRequest, VercelResponse } from "@vercel/node";
import { auth, db, Timestamp } from "../_fbAdmin";

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const idToken = req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!idToken) return res.status(401).json({ error: "Missing ID token" });

    const decoded = await auth.verifyIdToken(idToken);
    const uid = decoded.uid;

    const { payload, result } = req.body || {};
    if (!payload || !result) return res.status(400).json({ error: "Missing payload/result" });

    // --- Basic quota: 10 runs per calendar month (for Business Insight demo) ---
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthStartTs = Timestamp.fromDate(monthStart);

    const usedThisMonth = await db
      .collection("users").doc(uid)
      .collection("forecasts")
      .where("ts", ">=", monthStartTs)
      .get();

    if (usedThisMonth.size >= 10) {
      return res.status(402).json({ error: "Quota exceeded (10 forecasts/month on Business Insight demo)" });
    }

    const doc = {
      payload,                  // { event, geo, naics, horizon, scenario, extra_factors }
      result,                   // response from /api/forecast
      ts: Timestamp.now(),
      city: payload?.geo || null,
      naics: payload?.naics || null,
      scenario: payload?.scenario || "Base",
      source: result?.meta?.source || "unknown",
    };

    const ref = await db.collection("users").doc(uid).collection("forecasts").add(doc);
    return res.status(200).json({ ok: true, id: ref.id });
  } catch (err: any) {
    console.error("history/save error:", err);
    return res.status(500).json({ error: "Failed to save forecast" });
  }
}
