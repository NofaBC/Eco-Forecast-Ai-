// /api/health.ts
type Req = any; type Res = any;
export default function handler(_req: Req, res: Res) {
  res.status(200).json({
    ok: true,
    service: 'EcoForecast AI Backend',
    version: '1.0.1',
    ts: new Date().toISOString(),
    // tells you if the var is present WITHOUT exposing it
    hasOpenRouterKey: Boolean(process.env.OPENROUTER_API_KEY)
  });
}
