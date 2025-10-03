// Node runtime (default on Vercel). Uses OpenRouter if key exists, else safe demo.
// No imports required.

const OPENROUTER_KEY = process.env.OPENROUTER_API_KEY || "";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL = "openai/gpt-4o-mini"; // change if needed

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const started = Date.now();
  try {
    const {
      event, geo, naics,
      horizon = "medium",
      scenario = "Base",
      extra_factors = ""
    } = req.body || {};

    if (!event || !geo || !naics) {
      return res.status(400).json({ error: "Missing required fields: event, geo, naics" });
    }

    // Try LLM if key exists; otherwise fall back to deterministic demo
    if (OPENROUTER_KEY) {
      try {
        const out = await callOpenRouter({ event, geo, naics, horizon, scenario, extra_factors });
        if (out) {
          return res.status(200).json({
            demand_pct: num(out.demand_pct, 0),
            cost_pct:   num(out.cost_pct, 0),
            margin_bps: Math.round(num(out.margin_bps, 0)),
            drivers:    Array.isArray(out.drivers) ? out.drivers.slice(0, 6) : [],
            confidence: clamp01(num(out.confidence, 0.6)),
            meta: {
              geo_canonical: canonicalize(geo),
              naics_canonical: canonicalize(naics),
              horizon_months: horizonMonths(horizon),
              latency_ms: Date.now() - started,
              source: "openrouter"
            }
          });
        }
      } catch (e) {
        console.warn("[EcoForecast] OpenRouter error, using demo:", e?.message || e);
      }
    }

    // DEMO fallback (deterministic so you always see output)
    const seed = djb2(`${event}|${geo}|${naics}|${horizon}|${scenario}|${extra_factors}`);
    const rand = mulberry32(seed);
    const scen = String(scenario || "Base").toLowerCase();
    const scenMult = scen.includes("severe") ? 1.8 : scen.includes("best") ? 0.6 : 1.0;

    const demand_pct = round1(((rand() - 0.55) * 8) * scenMult);
    const cost_pct   = round1(((rand() - 0.45) * 5) * scenMult);
    const margin_bps = Math.round((-(demand_pct * 8) + (cost_pct * 12)) * (0.6 + rand() * 0.5));
    const drivers    = synthDrivers(`${event} ${extra_factors}`, rand);
    const confidence = clamp01(0.55 + (rand() - 0.5) * 0.25);

    return res.status(200).json({
      demand_pct,
      cost_pct,
      margin_bps,
      drivers,
      confidence,
      meta: {
        geo_canonical: canonicalize(geo),
        naics_canonical: canonicalize(naics),
        horizon_months: horizonMonths(horizon),
        latency_ms: Date.now() - started,
        source: OPENROUTER_KEY ? "fallback-demo" : "demo"
      }
    });
  } catch (err) {
    console.error("[EcoForecast] forecast error:", err);
    return res.status(500).json({ error: "Internal Server Error" });
  }
}

/* ---------- OpenRouter ---------- */
async function callOpenRouter(input) {
  // 8s timeout so UI doesn’t hang
  const ac = new AbortController();
  const to = setTimeout(() => ac.abort(), 8000);

  const system = `You are an economic impact forecaster. Return ONLY valid JSON:
{
  "demand_pct": number,
  "cost_pct": number,
  "margin_bps": number,
  "drivers": [{"text": string, "tone": "good"|"bad"|"warn"}],
  "confidence": number
}`;

  const user = `Event: ${input.event}
Geo: ${input.geo}
Industry/NAICS: ${input.naics}
Horizon: ${input.horizon}
Scenario: ${input.scenario}
Extra factors: ${input.extra_factors || "none"}`;

  const resp = await fetch(OPENROUTER_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENROUTER_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://eco-forecast-ai.vercel.app",
      "X-Title": "EcoForecast AI"
    },
    body: JSON.stringify({
      model: OPENROUTER_MODEL,
      response_format: { type: "json_object" },
      temperature: 0.2,
      max_tokens: 400,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user }
      ]
    }),
    signal: ac.signal
  });

  clearTimeout(to);

  if (!resp.ok) {
    const txt = await resp.text().catch(() => "");
    throw new Error(`OpenRouter ${resp.status}: ${txt}`);
  }

  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") return null;

  try {
    return JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

/* ---------- helpers ---------- */
function horizonMonths(h) { return ({ short: 3, medium: 12, long: 24 })[h] || 12; }
function round1(n) { return Math.round(n * 10) / 10; }
function clamp01(x) { return Math.max(0, Math.min(1, x)); }
function canonicalize(s) { return String(s || "").trim().replace(/\s+/g, " "); }
function num(n, d = 0) { const v = Number(n); return Number.isFinite(v) ? v : d; }

function synthDrivers(text, r) {
  const t = String(text || "").toLowerCase();
  const out = [];
  const add = (msg, tone) => out.push({ text: msg, tone });
  if (/\bwar|conflict|invasion|mobilization|sanction|blockade/.test(t)) add("Geopolitical risk elevating supply chain fragility", "bad");
  if (/\btariff|quota|export ban|embargo/.test(t)) add("Trade barriers raising input costs", "bad");
  if (/\bsubsidy|credit|rebate|stimulus|grant/.test(t)) add("Fiscal support boosting demand in targeted sectors", "good");
  if (/\bhurricane|flood|wildfire|heat wave|el niño|la niña/.test(t)) add("Weather disruption affecting logistics and insurance premiums", "warn");
  if (/\bparty|majority|house|senate|white house|regime change|coup/.test(t)) add("Political control shift altering policy trajectory", "warn");
  if (/\bfed|rate hike|rate cut|yields|quantitative/.test(t)) add("Interest-rate path impacting capital costs and demand", "warn");
  const pool = [
    "Energy futures volatility spilling into transport costs",
    "Labor market tightness pressuring wages",
    "FX moves altering import prices",
    "Commodity basis widening for key inputs",
    "Port congestion risk elevating lead times"
  ];
  while (out.length < 3) {
    const item = pool[Math.floor(r() * pool.length)];
    const tones = ["good", "bad", "warn"];
    add(item, tones[Math.floor(r() * tones.length)]);
  }
  return out.slice(0, 6);
}

function djb2(str) { let h = 5381; for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i); return h >>> 0; }
function mulberry32(a) { return function(){ let t=a+=0x6D2B79F5; t=Math.imul(t^(t>>>15), t|1); t^=t+Math.imul(t^(t>>>7), t|61); return ((t^(t>>>14))>>>0)/4294967295; }; }
