export default function handler(_req, res) {
  res.status(200).json({
    ok: true,
    service: "EcoForecast AI Backend",
    version: "1.0.2",
    ts: new Date().toISOString(),
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY)
  });
}
