// /api/forecast.ts
// Node.js 20 runtime compatible, no external imports

type VercelRequest = any;
type VercelResponse = any;
type Horizon = 'short' | 'medium' | 'long';

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || '';
const USE_LLM = !!OPENROUTER_KEY; // auto-enable if key is present
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const OPENROUTER_MODEL = 'openai/gpt-4o-mini'; // pick any model you’re enabled for

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const started = Date.now();
  try {
    const {
      event, geo, naics,
      horizon = 'medium',
      scenario = 'Base',
      extra_factors = ''
    } = (req.body || {}) as {
      event?: string; geo?: string; naics?: string; horizon?: Horizon; scenario?: string; extra_factors?: string;
    };

    if (!event || !geo || !naics) {
      return res.status(400).json({ error: 'Missing required fields: event, geo, naics' });
    }

    // If LLM path is configured, try it with a timeout + safe fallback
    if (USE_LLM) {
      try {
        const llm = await callOpenRouter({
          event, geo, naics, horizon, scenario, extra_factors
        });

        if (llm) {
          // Validate minimal shape, then return
          const demand_pct = num(llm.demand_pct, 0);
          const cost_pct   = num(llm.cost_pct, 0);
          const margin_bps = Math.round(num(llm.margin_bps, 0));
          const drivers    = Array.isArray(llm.drivers) ? llm.drivers.slice(0,6) : [];
          const confidence = clamp01(num(llm.confidence, 0.6));

          return res.status(200).json({
            demand_pct,
            cost_pct,
            margin_bps,
            drivers,
            confidence,
            meta: {
              geo_canonical: canonicalizeGeo(geo),
              naics_canonical: canonicalizeNaics(naics),
              horizon_months: ({ short:3, medium:12, long:24 } as Record<Horizon, number>)[horizon ?? 'medium'],
              latency_ms: Date.now() - started,
              source: 'openrouter'
            }
          });
        }
      } catch (err) {
        console.warn('[EcoForecast] OpenRouter failure, falling back to demo:', err);
        // fall through to demo
      }
    }

    // --- DEMO FORECAST (deterministic; always works) ---
    const seed = djb2(`${event}|${geo}|${naics}|${horizon}|${scenario}|${extra_factors}`);
    const rand = mulberry32(seed);
    const months = ({ short: 3, medium: 12, long: 24 } as Record<Horizon, number>)[horizon ?? 'medium'];
    const scen = (scenario || 'Base').toLowerCase();
    const scenMult = scen.includes('severe') ? 1.8 : scen.includes('best') ? 0.6 : 1.0;

    const demand_pct = round1(((rand() - 0.55) * 8) * scenMult);
    const cost_pct   = round1(((rand() - 0.45) * 5) * scenMult);
    const margin_bps = Math.round((-(demand_pct * 8) + (cost_pct * 12)) * (0.6 + rand() * 0.5));

    const drivers = synthDrivers(`${event} ${extra_factors}`, rand);
    const confidence = clamp01(0.55 + (rand() - 0.5) * 0.25);

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
        latency_ms: Date.now() - started,
        source: USE_LLM ? 'fallback-demo' : 'demo'
      }
    });
  } catch (err) {
    console.error('[EcoForecast] forecast error:', err);
    return res.status(500).json({ error: 'Internal Server Error' });
  }
}

/* ---------------- OpenRouter call ---------------- */
async function callOpenRouter(input: {
  event: string; geo: string; naics: string; horizon: Horizon; scenario: string; extra_factors?: string;
}) {
  // Hard timeout to avoid hanging the UI
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 8000); // 8s

  const system = `You are an economic impact forecaster. Return ONLY valid JSON with:
{
  "demand_pct": number,            // percent change (- to +)
  "cost_pct": number,              // percent change
  "margin_bps": number,            // basis points
  "drivers": [{"text": string, "tone": "good"|"bad"|"warn"}],
  "confidence": number             // 0..1
}
No extra commentary.`;

  const user = `Event: ${input.event}
Geo: ${input.geo}
Industry/NAICS: ${input.naics}
Horizon: ${input.horizon}
Scenario: ${input.scenario}
Extra factors: ${input.extra_factors || 'none'}`;

  const resp = await fetch(OPENROUTER_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${OPENROUTER_KEY}`,
      'Content-Type': 'application/json',
      // Optional but recommended per OpenRouter docs:
      'HTTP-Referer': 'https://eco-forecast-ai.vercel.app',
      'X-Title': 'EcoForecast AI'
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      response_format: { type: 'json_object' },
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user }
      ]
    }),
    signal: ac.signal
  });

  clearTimeout(t);

  if (!resp.ok) {
    const txt = await safeText(resp);
    throw new Error(`OpenRouter ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  // OpenRouter returns { choices: [{ message: { content: '...json...' } }] }
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') return null;

  try {
    const parsed = JSON.parse(content);
    return parsed;
  } catch (e) {
    // Some models might wrap JSON in code fences; try to extract
    const extracted = content.match(/\{[\s\S]*\}/);
    if (extracted) {
      return JSON.parse(extracted[0]);
    }
    throw new Error('Model did not return valid JSON');
  }
}

/* ---------------- helpers ---------------- */
function safeText(r: Response) { return r.text().catch(() => ''); }
function round1(n: number) { return Math.round(n * 10) / 10; }
function clamp01(x: number) { return Math.max(0, Math.min(1, x)); }
function canonicalizeGeo(g: string) { return (g || '').trim().replace(/\s+/g, ' '); }
function canonicalizeNaics(n: string) { return (n || '').trim().toUpperCase(); }
function num(n: any, d = 0) { const v = Number(n); return Number.isFinite(v) ? v : d; }

function synthDrivers(text: string, r: () => number) {
  const t = (text || '').toLowerCase();
  const drivers: { text: string; tone: 'good' | 'bad' | 'warn' }[] = [];
  const push = (msg: string, tone: 'good' | 'bad' | 'warn') => drivers.push({ text: msg, tone });

  if (/\bwar|conflict|invasion|mobilization|sanction|blockade/.test(t)) push('Geopolitical risk elevating supply chain fragility', 'bad');
  if (/\btariff|quota|export ban|embargo/.test(t)) push('Trade barriers raising input costs', 'bad');
  if (/\bsubsidy|credit|rebate|stimulus|grant/.test(t)) push('Fiscal support boosting demand in targeted sectors', 'good');
  if (/\bhurricane|flood|wildfire|heat wave|el niño|la niña/.test(t)) push('Weather disruption affecting logistics and insurance premiums', 'warn');
  if (/\bparty|majority|house|senate|white house|regime change|coup/.test(t)) push('Political control shift altering policy trajectory', 'warn');
  if (/\bfed|rate hike|rate cut|yields|quantitative/.test(t)) push('Interest-rate path impacting capital costs and demand', 'warn');

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

// Deterministic PRNGs (stable demo outputs)
function djb2(str: string) { let h = 5381; for (let i=0;i<str.length;i++) h = ((h<<5)+h) + str.charCodeAt(i); return h >>> 0; }
function mulberry32(a: number) {
  return function () {
    let t = a += 0x6D2B79F5;
    t = Math.imul(t ^ (t>>>15), t | 1);
    t ^= t + Math.imul(t ^ (t>>>7), t | 61);
    return ((t ^ (t>>>14)) >>> 0) / 4294967295;
  }
}
