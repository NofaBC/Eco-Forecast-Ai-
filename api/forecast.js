// api/forecast.js — v3.1 (safe defaults + richer narrative)
// Works on Vercel Serverless (Node 18/20). No other deps required.

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

// Utility: clamp & coerce
const toNum = (x, d = 0) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : d;
};

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const t0 = Date.now();
  try {
    // ---- Parse & sanitize input ----
    const body = (req.body && typeof req.body === "object") ? req.body : {};
    const event = (body.event || "").toString().trim();
    const geo = (body.geo || "").toString().trim();
    const naicsRaw = (body.naics || "").toString().trim();
    const horizon = (body.horizon || "medium").toString().trim();
    const scenario = (body.scenario || "Base").toString().trim();
    const extra = (body.extra_factors || "").toString().trim();
    const plan = (body.plan || process.env.PLAN_DEFAULT || "business").toString().trim().toLowerCase();

    if (!event || !geo || !naicsRaw) {
      return res.status(400).json({ error: "Missing required fields: event, geo, naics" });
    }

    // Normalize NAICS (extract leading 4 digits if labeled like "3313 — Aluminum")
    const naics = (naicsRaw.match(/^\d{4}/)?.[0] || naicsRaw).trim();
    const geoCanonical = geo || "Unknown";
    const naicsCanonical = naics || "0000";

    // ---- Plan-depth controls (how verbose the model should be) ----
    // Business: brief; Pro: detailed; Enterprise: very detailed
    const depth = plan === "enterprise" ? "very_detailed"
                : plan === "pro"        ? "detailed"
                : "brief";

    // ---- Model defaults (SAFE) ----
    // Note: the OpenRouter API expects snake_case "max_tokens"
    const modelName = process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini-2024-07-18";
    const temperature = toNum(process.env.OPENROUTER_TEMPERATURE, 0.3);
    const max_tokens = toNum(process.env.OPENROUTER_MAX_TOKENS, depth === "very_detailed" ? 1800 : depth === "detailed" ? 1200 : 700);
    const timeoutMs = toNum(process.env.OPENROUTER_TIMEOUT_MS, 20000);

    // ---- Prompt (asks the model for structured JSON) ----
    const sys = [
      "You are EcoForecast AI, an economic impact analyst.",
      "Return rigorous, business-ready analysis in JSON only.",
      "Be realistic and hedge claims with uncertainty where appropriate.",
      "Use the inputs to localize to the city/industry context."
    ].join(" ");

    const user = `
Return ONLY valid JSON with this shape:

{
  "demand_pct": number,             // e.g. -3.2  (percentage points)
  "cost_pct": number,               // e.g. +2.1  (percentage points)
  "margin_bps": number,             // e.g. -180  (basis points)
  "drivers": [{"text": string, "tone": "good"|"bad"|"warn"}],
  "confidence": number,             // 0..1
  "narrative": {
    "summary": string,
    "full": string
  }
}

Context:
- Event/Policy: ${event}
- City/Region: ${geoCanonical}
- Industry/NAICS: ${naicsCanonical}
- Horizon: ${horizon}
- Scenario: ${scenario}
- Extra factors: ${extra || "none"}
- Plan depth: ${depth} (business=brief, pro=detailed, enterprise=very_detailed)

Requirements by plan:
- business: 1 short paragraph in "summary"; "full" 1–2 short paragraphs.
- pro: "summary" 1 paragraph; "full" 4–6 paragraphs covering demand channels, cost channels, EBITDA mechanics, local sensitivities, recovery timeline.
- enterprise: "summary" 1 paragraph; "full" 6–9 paragraphs including assumptions, analog events, local labor/housing/logistics context, scenario deltas, risk watchlist.

Numbers must be consistent: margin_bps should roughly reflect demand & cost shifts qualitatively.
    `.trim();

    // ---- Try model (if key present) ----
    let modelJSON = null;
    let modelError = null;

    if (process.env.OPENROUTER_API_KEY) {
      try {
        const ctrl = new AbortController();
        const to = setTimeout(() => ctrl.abort(), timeoutMs);

        const resp = await fetch(OPENROUTER_URL, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
            "Content-Type": "application/json",
            // Optional routing headers for OpenRouter analytics
            "HTTP-Referer": process.env.OPENROUTER_REFERRER || "https://eco-forecast-ai.vercel.app",
            "X-Title": "EcoForecast AI"
          },
          body: JSON.stringify({
            model: modelName,
            temperature,
            max_tokens,
            response_format: { type: "json_object" },
            messages: [
              { role: "system", content: sys },
              { role: "user", content: user }
            ]
          }),
          signal: ctrl.signal
        });
        clearTimeout(to);

        if (!resp.ok) {
          modelError = `OpenRouter HTTP ${resp.status}: ${await resp.text().catch(() => "")}`;
        } else {
          const data = await resp.json();
          const content = data?.choices?.[0]?.message?.content;
          if (!content) {
            modelError = "Empty model response";
          } else {
            try {
              modelJSON = JSON.parse(content);
            } catch (e) {
              modelError = "Model returned non-JSON content";
            }
          }
        }
      } catch (e) {
        modelError = e?.message || "Model request failed";
      }
    } else {
      modelError = "Missing OPENROUTER_API_KEY";
    }

    // ---- Validate & coerce model output ----
    let out = null;
    if (modelJSON && typeof modelJSON === "object") {
      out = {
        demand_pct: toNum(modelJSON.demand_pct, 0),
        cost_pct: toNum(modelJSON.cost_pct, 0),
        margin_bps: Math.round(toNum(modelJSON.margin_bps, 0)),
        drivers: Array.isArray(modelJSON.drivers) ? modelJSON.drivers.map(d => ({
          text: (d?.text || "").toString().slice(0, 350),
          tone: ["good","bad","warn"].includes((d?.tone||"").toString()) ? d.tone : "warn"
        })).slice(0, 20) : [],
        confidence: Math.max(0, Math.min(1, toNum(modelJSON.confidence, 0.7))),
        narrative: {
          summary: (modelJSON?.narrative?.summary || "").toString(),
          full: (modelJSON?.narrative?.full || "").toString()
        }
      };
    }

    // ---- Fallback if model failed ----
    if (!out) {
      out = {
        demand_pct: -3.2,
        cost_pct: 2.1,
        margin_bps: -180,
        drivers: [
          { text: "Lower consumer confidence reduces discretionary spending.", tone: "warn" },
          { text: "Energy costs and logistics disruptions raise input prices.", tone: "bad" },
          { text: "Operational optimization and digital tools offset part of the loss.", tone: "good" }
        ],
        confidence: 0.84,
        narrative: {
          summary: `Short-term headwinds expected for ${naicsCanonical} in ${geoCanonical}, as demand dips and costs rise modestly.`,
          full:
`Demand is expected to decline by ~3% as sentiment weakens and customers delay purchases. Input costs rise from fuel and insurance volatility, trimming margins by ~180 bps.

Local substitution and inventory draw-downs partially cushion months 2–4, while logistics uncertainty raises safety-stock needs.

Recovery typically begins in two quarters as suppliers re-route and prices reset. Tactical pricing and promo cadence can protect contribution margin without destroying volume.`
        }
      };
    }

    // ---- Response ----
    const latency = Date.now() - t0;
    return res.status(200).json({
      ...out,
      meta: {
        source: modelJSON ? "openrouter" : "fallback",
        model: modelJSON ? modelName : null,
        latency_ms: latency,
        // only include modelError as a note; do NOT throw front-end off
        note: modelError || null,
        geo_canonical: geoCanonical,
        naics_canonical: naicsCanonical,
        horizon_months: horizon === "short" ? 3 : horizon === "long" ? 24 : 12
      }
    });
  } catch (e) {
    return res.status(500).json({ error: e?.message || "Internal error" });
  }
}
