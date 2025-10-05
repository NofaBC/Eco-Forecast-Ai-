// api/forecast.ts
// Rich forecast endpoint with JSON-mode LLM + safe fallbacks.
//
// ENV required on Vercel (Project → Settings → Environment Variables)
//   OPENROUTER_API_KEY = sk-or-... (from openrouter.ai)
// Optional (nice to have for OpenRouter TOS):
//   OR_SITE_URL  = https://eco-forecast-ai.vercel.app
//   OR_APP_NAME  = EcoForecast AI

import type { VercelRequest, VercelResponse } from "@vercel/node";

// ---- Tunables --------------------------------------------------------------
const MODEL = "openai/gpt-4o-mini"; // good JSON-mode support & cost-effective
const TIMEOUT_MS = 25_000;

// ---- Helpers ---------------------------------------------------------------
const sleep = (ms: number) => new Promise(res => setTimeout(res, ms));

function badRequest(res: VercelResponse, msg: string, code = 400) {
  return res.status(code).json({ error: msg });
}

function pick<T>(v: any, def: T): T {
  return v === undefined || v === null ? def : v;
}

function toNumber(x: any, def = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : def;
}

function safeJSON<T = any>(text: string): T | null {
  try {
    // Sometimes models wrap JSON in ```json ... ```
    const cleaned = text.trim().replace(/^```json/i, "```").replace(/^```/, "").replace(/```$/, "");
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

function demoResponse(payload: any) {
  // Lightweight deterministic demo for resilience
  const base = (seed: number) => {
    // pseudo variability by seed
    const s = Math.abs(seed % 7);
    const demand = [-3.2, -1.8, 0.4, 1.2, 2.5, -0.9, 3.1][s];
    const cost   = [ 1.0,  0.6, 0.2, -0.4, -1.1, 0.8, -0.2][s];
    const m_bps  = [ -50,  -20,  10,   30,   60, -15,   25][s];
    return { demand_pct: demand, cost_pct: cost, margin_bps: m_bps };
  };

  const seed = (payload?.event || "x").length + (payload?.geo || "y").length + (payload?.naics || "z").length;
  const kp = base(seed);

  return {
    summary: `Indicative impacts for ${payload?.naics || "the industry"} in ${payload?.geo || "the region"} given the described event.`,
    ...kp,
    drivers: [
      { text: "Input costs shift due to supply & logistics changes.", tone: kp.cost_pct > 0 ? "bad" : "good" },
      { text: "Local demand reacts to pricing, income, and policy.",    tone: kp.demand_pct >= 0 ? "good" : "warn" },
      { text: "Margin sensitivity to pass-through and mix.",           tone: kp.margin_bps >= 0 ? "good" : "warn" }
    ],
    assumptions: [
      "No additional shocks beyond those described.",
      "Local capacity & labor constraints remain near recent levels."
    ],
    risks: [
      "Broader market volatility changes financing and capex.",
      "Policy implementation timing differs from expectations."
    ],
    local_signals: [
      "Port/rail bottlenecks, regional fuel prices, and freight rates.",
      "Local hiring postings / overtime trends."
    ],
    time_path: [
      { t: "0–3m",   note: "Immediate pricing/lead-time effects; customers reassess orders." },
      { t: "3–12m",  note: "Volumes adjust to new prices; supply routes normalize." },
      { t: "12–24m", note: "Mix/productivity changes settle; margins stabilize." }
    ],
    actions: [
      "Scenario out pass-through and elasticity by segment.",
      "Secure alternates for top-3 input risks; pre-negotiate terms."
    ],
    confidence: 0.6,
    meta: { source: "fallback-demo" as const }
  };
}

// ---- Prompt ----------------------------------------------------------------
const SCHEMA_HINT = `
Return STRICT JSON with exactly:
{
  "summary": string,
  "demand_pct": number,
  "cost_pct": number,
  "margin_bps": number,
  "drivers": [ { "text": string, "tone": "good"|"bad"|"warn" } ],
  "assumptions": [string],
  "risks": [string],
  "local_signals": [string],
  "time_path": [ { "t": "0–3m"|"3–12m"|"12–24m", "note": string } ],
  "actions": [string],
  "confidence": number,
  "meta": { "source": "openrouter" }
}
Numbers must be realistic magnitudes (avoid extremes unless justified).
Do not include any commentary outside the JSON object.
`;

// ---- Handler ---------------------------------------------------------------
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const t0 = Date.now();

  try {
    if (req.method !== "POST") {
      return badRequest(res, "Method not allowed", 405);
    }

    const contentType = String(req.headers["content-type"] || "");
    if (!contentType.includes("application/json")) {
      return badRequest(res, "Content-Type must be application/json");
    }

    const { event, geo, naics, horizon, scenario, extra_factors } = (req.body || {}) as {
      event?: string; geo?: string; naics?: string; horizon?: string; scenario?: string; extra_factors?: string;
    };

    if (!event || !geo || !naics) {
      return badRequest(res, "Missing required fields: event, geo, naics");
    }

    const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
    if (!OPENROUTER_API_KEY) {
      const demo = demoResponse(req.body);
      demo.meta = { ...(demo.meta || {}), latency_ms: Date.now() - t0 };
      return res.status(200).json(demo);
    }

    const site = process.env.OR_SITE_URL || "https://eco-forecast-ai.vercel.app";
    const app  = process.env.OR_APP_NAME || "EcoForecast AI";

    const userPrompt =
`Event: ${event}
City/Region: ${geo}
Industry (NAICS or keyword): ${naics}
Horizon: ${horizon || "medium (3–12m)"}
Scenario: ${scenario || "Base"}
Extra factors: ${extra_factors || "none"}

Generate an economic impact forecast tailored to the city & industry.
Focus on demand, costs, and EBITDA margin; explain key DRIVERS.
Provide a compact but informative result.
${SCHEMA_HINT}`;

    // OpenRouter (OpenAI-compatible) chat completions with JSON mode
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

    const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "HTTP-Referer": site,
        "X-Title": app
      },
      body: JSON.stringify({
        model: MODEL,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You are an economic impact forecaster. Be precise, grounded, and concise. Return ONLY valid JSON according to the schema."
          },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 900
      })
    }).catch(err => {
      // fetch can throw on abort/timeout
      throw new Error(`OpenRouter request failed: ${err?.message || String(err)}`);
    }).finally(() => clearTimeout(timer));

    if (!resp.ok) {
      const txt = await resp.text().catch(() => "");
      throw new Error(`OpenRouter HTTP ${resp.status}: ${txt}`);
    }

    const data = await resp.json() as any;
    const raw = data?.choices?.[0]?.message?.content ?? "";
    const parsed = safeJSON<any>(raw);

    if (!parsed) {
      // If model returned non-JSON, fall back gracefully
      const demo = demoResponse(req.body);
      demo.meta = { ...(demo.meta || {}), source: "fallback-demo", latency_ms: Date.now() - t0 };
      return res.status(200).json(demo);
    }

    // Normalize/guard required fields so the UI never breaks
    const out = {
      summary: pick(parsed.summary, ""),
      demand_pct: toNumber(parsed.demand_pct, 0),
      cost_pct: toNumber(parsed.cost_pct, 0),
      margin_bps: Math.round(toNumber(parsed.margin_bps, 0)),
      drivers: Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 8) : [],
      assumptions: Array.isArray(parsed.assumptions) ? parsed.assumptions.slice(0, 10) : [],
      risks: Array.isArray(parsed.risks) ? parsed.risks.slice(0, 10) : [],
      local_signals: Array.isArray(parsed.local_signals) ? parsed.local_signals.slice(0, 10) : [],
      time_path: Array.isArray(parsed.time_path) ? parsed.time_path.slice(0, 6) : [],
      actions: Array.isArray(parsed.actions) ? parsed.actions.slice(0, 10) : [],
      confidence: Math.max(0, Math.min(1, toNumber(parsed.confidence, 0.7))),
      meta: { ...(parsed.meta || {}), source: "openrouter", latency_ms: Date.now() - t0 }
    };

    return res.status(200).json(out);
  } catch (err: any) {
    console.error("forecast error:", err?.message || err);
    // Resilient fallback so UX still shows something
    const demo = demoResponse((req as any)?.body || {});
    demo.meta = { ...(demo.meta || {}), error: String(err?.message || err), latency_ms: Date.now() - t0 };
    return res.status(200).json(demo);
  }
}
