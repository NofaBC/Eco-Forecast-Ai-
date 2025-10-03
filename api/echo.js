export default async function handler(req, res) {
  res.status(200).json({
    method: req.method,
    body: req.body ?? null,
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY),
    contentType: req.headers?.["content-type"] || null
  });
}
