// /api/forecast.ts
import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * POST /api/forecast
 * Body:
 *  {
 *    event: string,        // bill/EO summary or event description
 *    geo: string,          // e.g., "Phoenix, AZ"
 *    naics: string,        // e.g., "7225" or "Restaurants"
 *    horizon: "short" | "medium" | "long",
 *    scenario: "Base" | "Best Case" | "Severe",
 *    extra_factors?: string
 *  }
 *
 * Returns (demo):
 *  {
 *    demand_pct: number,
 *    cost_pct: number,
 *    margin_bps: number,
 *    drivers: { text: string; tone: "good"|"bad"|"warn" }[],
 *    confidence: number,
 *    meta: { geo_canonical: string; naics_canonical: string; horizon_months: number; latency_ms: number }
 *  }
 */

// Toggle when you wire a real model (and read keys with process.env)
const NEEDS_MODEL = false;
// const MODEL_API_KEY = process.env.MY_MODEL_KEY || "";

type Horizon = 'short' | 'medium' | 'long';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const started = Date.now();

  try {
    const { event, geo, naics, horizon = 'medium', scenario = 'Base', extra_factors = '' } = (req.body || {}) as {
      event?: string; geo?: string; naics?: string; horizon?: Horizon; scenario?: string; extra_factors?: string;
    };

    if (!event || !geo || !naics) {
      return res.status(400).json({ error: 'Missing required fields: event, geo, naics' });
    }

    // If you later add a real model call, guard for missing key:
    // if (NEEDS_MODEL && !MODEL_API_KEY) {
    //   console.warn('[EcoForecast] Missing MODEL API key – serving demo response.');
    // }

    // --- DEMO FORECAST (deterministic, based on input) ---
    const seed = djb2(`${event}|${geo}|${naics}|${horizon}|${scenario}|${extra_factors}`);
    const rand = mulberry32(seed);

    const months = ({ short: 3, medium: 12, long: 24 } as Record<Horizon, number>)[(horizon as Horizon) ?? 'medium'];
    const scen = (scenario || 'Base').toLowerCase();
    const scenMult = scen.includes('severe') ? 1.8 : scen.includes('best') ? 0.6 : 1.0;

    // Plausible-looking signals (you’ll replace with real models later)
    const demand_pct = round1(((rand() - 0.55) * 8) * scenMult); // −? to +? %
    const cost_pct   = round1(((rand() - 0.45) * 5) * scenMult);
    const margin_bps = Math.round((-(demand_pct * 8) + (cost_pct * 12)) * (0.6 + rand() * 0.5));

    const drivers = synthDrivers(`${event} ${extra_factors}`, rand);
    const confidence = clamp01(0.55 + (rand() - 0.5) * 0.25);

    // --- Example of where a real model call would go ---
    // if (NEEDS_MODEL) {
    //   const features = await parseWithLLM(event); // your /api/parse_policy or direct LLM call
    //   const forecast = await callYourModel({ features, geo, naics, months, scenario });
    //   return res.status(200).json(forecast);
    // }

    return res.status(200).json({
      demand_pct,
      cost_pct,
      margin_bps,
      drivers,
      confidence,
      meta: {
        geo_canonical: canonicalizeGeo(geo),
        naics_canonical: canonicalizeNaics(naics),
        horizon_months: months,
        latency_ms: Date.now() - started
      }
    });
  } catch (err) {
    console.error('[EcoForecast] forecast error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/* ---------------- helpers ---------------- */
function round1(n: number) { return Math.round(n * 10) / 10; }
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function canonicalizeGeo(g: string) { return (g || '').trim().replace(/\s+/g, ' '); }
function canonicalizeNaics(n: string) { return (n || '').trim().toUpperCase(); }

function synthDrivers(text: string, r: () => number) {
  const t = (text || '').toLowerCase();
  const drivers: { text: string; tone: 'good' | 'bad' | 'warn' }[] = [];
  const push = (msg: string, tone: 'good' | 'bad' | 'warn') => drivers.push({ text: msg, tone });

  if (/\bwar|conflict|invasion|mobilization|sanction|blockade/.test(t)) {
    push('Geopolitical risk elevating supply chain fragility', 'bad');
  }
  if (/\btariff|quota|export ban|embargo/.test(t)) {
    push('Trade barriers raising input costs', 'bad');
  }
  if (/\bsubsidy|credit|rebate|stimulus|grant/.test(t)) {
    push('Fiscal support boosting demand in targeted sectors', 'good');
  }
  if (/\bhurricane|flood|wildfire|heat wave|el niño|la niña/.test(t)) {
    push('Weather disruption affecting logistics and insurance premiums', 'warn');
  }
  if (/\bparty|majority|house|senate|white house|regime change|coup/.test(t)) {
    push('Political control shift altering policy trajectory', 'warn');
  }
  if (/\bfed|rate hike|rate cut|yields|quantitative/.test(t)) {
    push('Interest-rate path impacting capital costs and demand', 'warn');
  }
  // Fill to at least ~3 drivers
  const pool = [
    'Energy futures volatility spilling into transport costs',
    'Labor market tightness pressuring wages',
    'FX moves altering import prices',
    'Commodity basis widening for key inputs',
    'Port congestion risk elevating lead times'
  ];
  while (drivers.length < 3) {
    const item = pool[Math.floor(r() * pool.length)];
    const tones: ('good' | 'bad' | 'warn')[] = ['good', 'bad', 'warn'];
    push(item, tones[Math.floor(r() * tones.length)]);
  }
  return drivers.slice(0, 6);
}

// Deterministic PRNGs (stable demo outputs for same input)
function djb2(str: string) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i); return h >>> 0; }
function mulberry32(a: number) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967295;
  }
}
