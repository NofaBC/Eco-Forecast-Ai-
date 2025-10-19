export default async function handler(req, res) {
  const ct = req.headers['content-type'] || '';
  let body = null;
  if (req.method !== 'GET' && ct.includes('application/json')) {
    body = req.body ?? null;
  }
  res.status(200).json({
    method: req.method,
    contentType: ct,
    body,
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY
  });
}
