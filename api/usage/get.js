// api/usage/get.js
const admin = require('../_firebaseAdmin');

function ymKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

// Default cap for the current (Business Insight) tier
const DEFAULT_CAP = 10;

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') {
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

    const snap = await ref.get();
    const data = snap.exists ? snap.data() : {};
    const count = Number(data.count || 0);
    const cap = Number(data.cap || DEFAULT_CAP);

    return res.status(200).json({ count, cap });
  } catch (err) {
    console.error('usage/get error:', err);
    return res.status(500).json({ error: 'Internal error' });
  }
};
