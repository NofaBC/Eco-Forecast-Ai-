// /api/health.ts
// Node.js 20 runtime compatible, no external imports

type VercelRequest = any;
type VercelResponse = any;

export default function handler(_req: VercelRequest, res: VercelResponse) {
  res.status(200).json({
    ok: true,
    service: 'EcoForecast AI Backend',
    version: '1.0.0',
    ts: new Date().toISOString()
  });
}
