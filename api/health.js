export default async function handler(req, res) {
  res.status(200).json({
    ok: true,
    service: "EcoForecast AI Backend",
    version: "1.0.3",
    ts: new Date().toISOString(),
    hasOpenRouterKey: !!process.env.OPENROUTER_API_KEY
  });
}
