// api/plan.js
const admin = require('./_firebaseAdmin');

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on('data', c => data.push(c));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(data).toString() || '{}')); }
      catch { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function verifyUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try { return await admin.auth().verifyIdToken(token); }
  catch { return null; }
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action');
  const db = admin.firestore();

  try {
    if (action === 'get' && req.method === 'GET') {
      const user = await verifyUser(req);
      if (!user) return res.status(401).json({ error: 'auth required' });
      const uid = user.uid;

      const doc = await db.collection('users').doc(uid).collection('billing').doc('current').get();
      if (!doc.exists) {
        return res.status(200).json({
          plan: process.env.PLAN_DEFAULT || 'business',
          features: { pro: false, enterprise: false },
          cap: 10
        });
      }
      return res.status(200).json(doc.data());
    }

    if (action === 'set' && req.method === 'POST') {
      const adminUid = process.env.ADMIN_UID;
      const adminHeader = req.headers['x-admin-uid'];
      if (!adminUid || adminHeader !== adminUid) {
        return res.status(403).json({ error: 'admin required' });
      }
      const { uid, plan } = await jsonBody(req);
      if (!uid || !plan) return res.status(400).json({ error: 'missing uid/plan' });

      const features = {
        pro: plan === 'pro' || plan === 'enterprise',
        enterprise: plan === 'enterprise',
      };
      const cap = plan === 'business' ? 10 : (plan === 'pro' ? 999999 : 999999);

      await db.collection('users').doc(uid).collection('billing').doc('current').set({
        plan,
        features,
        cap,
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      return res.status(200).json({ ok: true });
    }

    return res.status(404).json({ error: 'unknown action' });
  } catch (e) {
    console.error('plan error', e);
    return res.status(500).json({ error: 'server error' });
  }
};
