// api/scenario.js
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

  const user = await verifyUser(req);
  if (!user) return res.status(401).json({ error: 'auth required' });
  const uid = user.uid;

  // Pro plan gate
  const planDoc = await db.collection('users').doc(uid).collection('billing').doc('current').get();
  const planData = planDoc.exists ? planDoc.data() : { features: {} };
  if (!planData.features?.pro) return res.status(403).json({ error: 'pro required' });

  try {
    if (action === 'save' && req.method === 'POST') {
      const { name, inputs } = await jsonBody(req);
      if (!name || !inputs) return res.status(400).json({ error: 'missing name/inputs' });
      const ref = db.collection('users').doc(uid).collection('scenarios').doc();
      await ref.set({
        name, inputs,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      return res.status(200).json({ id: ref.id });
    }

    if (action === 'list' && req.method === 'GET') {
      const snap = await db.collection('users').doc(uid).collection('scenarios')
        .orderBy('createdAt', 'desc').limit(50).get();
      const scenarios = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      return res.status(200).json({ scenarios });
    }

    if (action === 'get' && req.method === 'GET') {
      const id = url.searchParams.get('id');
      if (!id) return res.status(400).json({ error: 'missing id' });
      const doc = await db.collection('users').doc(uid).collection('scenarios').doc(id).get();
      if (!doc.exists) return res.status(404).json({ error: 'not found' });
      return res.status(200).json({ id: doc.id, ...doc.data() });
    }

    return res.status(404).json({ error: 'unknown action' });
  } catch (e) {
    console.error('scenario error', e);
    return res.status(500).json({ error: 'server error' });
  }
};
