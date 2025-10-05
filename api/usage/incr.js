// api/usage/incr.js
const admin = require('../_firebaseAdmin');

function ymKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

const DEFAULT_CAP = 10;

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') {
      return res.status(405).json({ error: 'Method not allowed' });
    }

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) return res.status(401).json({ error: 'Missing bearer token' });

    const decoded = await admin.auth().verifyIdToken(token);
    const uid = decoded.uid;

    const ym = ymKey();
    const ref = admin.firestore()
      .collection('users').doc(uid)
      .collection('usage').doc(ym);

    let out = { count: 0, cap: DEFAULT_CAP };

    await admin.firestore().runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const prev = snap.exists ? snap.data() : {};
      const cap = Number(prev.cap || DEFAULT_CAP);
      const next = Number(prev.count || 0) + 1;

      if (next > cap) {
        // 402 signals “Payment Required” — nice for quota messages
        throw Object.assign(new Error('Quota exceeded'), { code: 402, cap, count: prev.count || 0 });
      }

      tx.set(ref, {
        count: next,
        cap,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      out = { count: next, cap };
    });

    return res.status(200).json(out);
  } catch (err) {
    // Handle quota exceed path with a friendly code
    if (err && err.code === 402) {
      return res.status(402).json({ error: 'Monthly forecast quota exceeded', count: err.count, cap: err.cap });
    }
    console.error('usage/incr error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
