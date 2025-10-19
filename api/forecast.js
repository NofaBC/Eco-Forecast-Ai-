// api/forecast.js
const PLAN_DEPTH = {
  business: { maxTokens: 700, sections: ['summary', 'drivers'] },
  pro:      { maxTokens: 1400, sections: ['summary', 'drivers', 'assumptions', 'risks', 'local_signals', 'time_path', 'actions', 'data_anchors'] },
  enterprise:{maxTokens: 2200, sections: ['summary', 'drivers', 'assumptions', 'risks', 'local_signals', 'time_path', 'actions', 'data_anchors'] }
};

function horizonToMonths(h) {
  if (h === 'short') return 3;
  if (h === 'long') return 24;
  return 12; // medium default
}

function mockRich(plan, geo, naics, horizon) {
  const months = horizonToMonths(horizon);
  return {
    demand_pct: -2.0,
    cost_pct: 1.0,
    margin_bps: -120,
    drivers: [
      { text: 'Discretionary demand softens as households delay purchases.', tone: 'warn' },
      { text: 'Input costs edge up due to logistics/policy frictions.', tone: 'bad' },
      { text: 'Operators optimize staffing and localized pricing.', tone: 'good' }
    ],
    confidence: 0.82,
    narrative: {
      summary: `Over the next ${months} months in ${geo}, NAICS ${naics} faces mild demand softness and modest cost pressure. Operators should safeguard margins via mix, staffing, and tactical pricing.`,
      full: `• Demand softens short-term; tourist/commuter-exposed venues feel more.\n• Costs rise modestly from freight, insurance, energy.\n• Margin defense via menu mix, day-part scheduling, and negotiated inputs.\n• Watch fuel prices, FX, and port dwell times for early turns.`,
      assumptions: [
        'Supply chains remain functional; no full port closures',
        'Energy prices elevated but not spiking >15% MoM',
        'No additional local mandates that limit operating hours'
      ],
      risks: [
        'Escalation extends delivery lead times to 4–6 weeks',
        'Insurance/risk premia accelerate beyond baseline',
        'Consumer confidence dips below prior troughs'
      ],
      local_signals: [
        'Foot traffic trend vs. 2019 baseline (SafeGraph/PlaceIQ)',
        'Restaurant reservations and table turn (OpenTable-like)',
        'Card spend trend for Grocery vs. Dining (Affinities/Facteus)'
      ],
      time_path: [
        '0–3m: demand softness greatest; input costs elevated',
        '4–9m: demand stabilizes; costs start easing as lanes normalize',
        '10–12m: gradual re-acceleration; margin repair'
      ],
      actions: [
        'Pre-buy key inputs (non-perishables) to cap price risk',
        'Menu engineering: emphasize higher-margin items; review portions',
        'Renegotiate delivery fuel-surcharge clauses; consolidate drops'
      ],
      data_anchors: [
        'WTI/Brent weekly, Baltic Dry, DHS/CBP dwell times',
        'CPI: food-away-from-home, PPI: food inputs & packaging',
        'BLS local payrolls; OpenTable seated diners; card-spend indices'
      ]
    },
    meta: { plan, geo_canonical: geo, naics_canonical: String(naics), horizon_months: months, source: 'mock' }
  };
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const {
      event, geo, naics,
      horizon = 'medium',
      scenario = 'Base',
      plan = 'business',
      extra_factors = ''
    } = req.body || {};

    if (!event || !geo || !naics) {
      return res.status(400).json({ error: 'Missing required fields: event, geo, naics' });
    }

    const depth = PLAN_DEPTH[plan] || PLAN_DEPTH.business;
    const months = horizonToMonths(horizon);
    const hasKey = !!process.env.OPENROUTER_API_KEY;
    const model = process.env.OPENROUTER_MODEL || 'openai/gpt-4o'; // upgrade model for richer outputs

    // If no key, return a rich mock so the UI still works
    if (!hasKey) return res.status(200).json(mockRich(plan, geo, naics, horizon));

    // Build a strict JSON schema prompt
    const sectionsRequested = depth.sections.join(', ');
    const schema = `
Return ONLY a JSON object with exactly these keys:
{
  "demand_pct": number,            // e.g., -3.2 (percent)
  "cost_pct": number,              // e.g., 1.4  (percent)
  "margin_bps": integer,           // e.g., -120 (basis points)
  "drivers": [{"text": string, "tone": "good"|"bad"|"warn"}],
  "confidence": number,            // 0..1
  "narrative": {
    "summary": string,
    "full": string,
    "assumptions": string[] | null,
    "risks": string[] | null,
    "local_signals": string[] | null,
    "time_path": string[] | null,
    "actions": string[] | null,
    "data_anchors": string[] | null
  }
}
Do not include code fences or commentary. Ensure valid JSON.
For plan="${plan}", include sections: ${sectionsRequested}. Omit missing sections by returning null.
Target length: Business ~400–700 tokens, Pro ~900–1400, Enterprise ~1600–2200.
Numbers should be plausible for ${geo}, NAICS ${naics}, horizon ${months} months, scenario ${scenario}.
`;

    const userContext = `
Event: ${event}
Geo: ${geo}
Industry/NAICS: ${naics}
Horizon: ${horizon} (${months} months)
Scenario: ${scenario}
Extra factors: ${extra_factors || 'none'}
Audience: operator/executive; concise, decision-oriented.
`;

    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENROUTER_API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://eco-forecast-ai.vercel.app',
        'X-Title': 'EcoForecast AI'
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        top_p: 1,
        frequency_penalty: 0.1,
        max_tokens: depth.maxTokens,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: 'You are EcoForecast AI, an economic impact forecaster. Output strictly valid JSON per the provided schema.' },
          { role: 'user', content: schema },
          { role: 'user', content: userContext }
        ]
      })
    });

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('OpenRouter HTTP error:', resp.status, errText);
      const fb = mockRich(plan, geo, naics, horizon);
      fb.meta = { ...fb.meta, error: `openrouter_${resp.status}`, detail: errText.slice(0, 300), source: 'openrouter_fallback' };
      return res.status(200).json(fb);
    }

    const data = await resp.json().catch(() => null);
    const raw = data?.choices?.[0]?.message?.content?.trim() || '';

    let parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) {
      console.error('JSON parse error. content:', raw.slice(0, 400));
      const fb = mockRich(plan, geo, naics, horizon);
      fb.meta = { ...fb.meta, error: 'bad_json', detail: raw.slice(0, 300), source: 'openrouter_fallback' };
      return res.status(200).json(fb);
    }

    // Basic shape checks & meta enrich
    parsed.demand_pct = Number(parsed.demand_pct);
    parsed.cost_pct = Number(parsed.cost_pct);
    parsed.margin_bps = Number(parsed.margin_bps);
    if (!Array.isArray(parsed.drivers)) parsed.drivers = [];
    if (!parsed.narrative) parsed.narrative = { summary: '', full: '' };

    parsed.meta = {
      ...(parsed.meta || {}),
      plan,
      geo_canonical: geo,
      naics_canonical: String(naics),
      horizon_months: months,
      source: 'openrouter'
    };

    return res.status(200).json(parsed);
  } catch (err) {
    console.error('forecast fatal:', err);
    const fb = mockRich('business', 'Unknown', '0000', 'medium');
    fb.meta = { ...fb.meta, error: 'handler_exception', detail: String(err).slice(0, 300), source: 'fallback_error' };
    return res.status(200).json(fb);
  }
}
