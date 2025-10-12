// api/history.js
const admin = require('./_firebaseAdmin'); // adjust path if needed

function jsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = [];
    req.on('data', chunk => data.push(chunk));
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(data).toString() || '{}')); }
      catch (e) { resolve({}); }
    });
    req.on('error', reject);
  });
}

async function verifyUser(req) {
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return null;
  try {
    return await admin.auth().verifyIdToken(token);
  } catch {
    return null;
  }
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://x');
  const action = url.searchParams.get('action'); // 'save' or 'list'
  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'auth required' });
  const uid = user.uid;
  const db = admin.firestore();

  try {
    if (action === 'save' && req.method === 'POST') {
      const body = await jsonBody(req);
      const { input = {}, result = {}, meta = {} } = body;
      const ref = db.collection('history').doc();
      await ref.set({
        uid,
        input,
        result,
        meta,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      return res.status(200).json({ id: ref.id });
    }

    if (action === 'list' && req.method === 'GET') {
      const snap = await db.collection('history')
        .where('uid', '==', uid)
        .orderBy('createdAt', 'desc')
        .limit(25)
        .get();
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ items });
    }

    return res.status(404).json({ error: 'unknown action' });
  } catch (e) {
    console.error('history error', e);
    return res.status(500).json({ error: 'server error' });
  }
};
