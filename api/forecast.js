// api/forecast.js
// Enhanced Business Insight detail sections for Full view

const MODEL = process.env.OPENROUTER_MODEL || "openrouter/auto";

async function callLLM(prompt) {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new Error("Missing OPENROUTER_API_KEY");

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${key}`,
      "HTTP-Referer": process.env.SITE_URL || "https://eco-forecast-ai.vercel.app",
      "X-Title": "EcoForecast AI"
    },
    body: JSON.stringify({
      model: MODEL,
      response_format: { type: "json_object" },
      messages: [{ role: "user", content: prompt }],
      temperature: 0.4,
    }),
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`OpenRouter error: ${res.status} ${t}`);
  }
  const json = await res.json();
  const content = json.choices?.[0]?.message?.content || "{}";
  return content;
}

// Safe JSON parse with fallback
function safeParse(s) {
  try { return JSON.parse(s); } catch { return {}; }
}
function num(n, d = 0) {
  const v = Number(n);
  return Number.isFinite(v) ? v : d;
}
function clipPct(v) {
  // keep % within sensible demo bounds to avoid wild swings
  return Math.max(-40, Math.min(40, num(v, 0)));
}
function clipBps(v) { return Math.max(-2000, Math.min(2000, num(v, 0))); }

function baseShape() {
  return {
    demand_pct: 0,
    cost_pct: 0,
    margin_bps: 0,
    drivers: [],
    explanations_summary: "",
    explanations_full: "",
    detail_blocks: {
      assumptions: [],
      risks: [],
      local_signals: [],
      time_path: [],
      suggested_actions: []
    },
    sources_note: "",
    caveats: "",
    confidence: 0.7
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { event, geo, naics, horizon = "medium", scenario = "Base", extra_factors = "", detail = "summary" } = req.body || {};

    if (!event || !geo || !naics) {
      return res.status(400).json({ error: "Missing required fields: event, geo, naics" });
    }

    const horizonMonths = horizon === "short" ? 3 : horizon === "long" ? 24 : 12;
    const plan = "business"; // keep simple; later tie to billing/current

    const schema = `
Return ONLY a JSON object with these fields:
{
  "demand_pct": number,           // -40..40 (%)
  "cost_pct": number,             // -40..40 (%)
  "margin_bps": number,           // -2000..2000 (basis points)
  "drivers": [ { "text": string, "tone": "good"|"bad"|"warn" } ],
  "explanations_summary": string, // 2-5 sentences, non-hype, plain English
  "explanations_full": string,    // 150-250 words executive brief
  "detail_blocks": {
    "assumptions": string[],      // ≤5 bullets, short phrases
    "risks": string[],            // ≤5 bullets
    "local_signals": string[],    // ≤5 bullets
    "time_path": string[],        // ≤5 bullets (0–3m, 3–12m, 12–24m)
    "suggested_actions": string[] // ≤5 bullets, practical
  },
  "sources_note": string,         // 1-2 sentences, e.g., data families referenced (no live links)
  "caveats": string,              // 1-2 sentences of uncertainty/limits
  "confidence": number            // 0..1
}
    `.trim();

    const prompt = `
You are EcoForecast AI. Analyze the following event's economic impact for a city and industry, suitable for a Business Insight brief.

Event: ${event}
City/Region: ${geo}
Industry (NAICS or keyword): ${naics}
Horizon (months): ${horizonMonths}
Scenario: ${scenario}
Extra factors to consider (optional): ${extra_factors}

Constraints:
- Be local and industry-specific. No political opinions or financial advice.
- Keep numbers realistic for ${horizonMonths} months.
- Drivers in neutral language; tones = good/bad/warn.
- ${plan === "business" ? "Keep explanations clear and compact." : ""}

${schema}
`.trim();

    // Call model (or skip and return a deterministic mock if no key)
    let out = baseShape();

    if (process.env.OPENROUTER_API_KEY) {
      const content = await callLLM(prompt);
      const parsed = safeParse(content);

      out.demand_pct = clipPct(parsed.demand_pct);
      out.cost_pct = clipPct(parsed.cost_pct);
      out.margin_bps = clipBps(parsed.margin_bps);
      out.drivers = Array.isArray(parsed.drivers) ? parsed.drivers.slice(0, 8) : [];

      out.explanations_summary = String(parsed.explanations_summary || "").slice(0, 1200);
      out.explanations_full = String(parsed.explanations_full || "").slice(0, 2400);

      const db = parsed.detail_blocks || {};
      out.detail_blocks = {
        assumptions: (db.assumptions || []).slice(0, 5),
        risks: (db.risks || []).slice(0, 5),
        local_signals: (db.local_signals || []).slice(0, 5),
        time_path: (db.time_path || []).slice(0, 5),
        suggested_actions: (db.suggested_actions || []).slice(0, 5),
      };

      out.sources_note = String(parsed.sources_note || "");
      out.caveats = String(parsed.caveats || "");
      out.confidence = Math.max(0, Math.min(1, num(parsed.confidence, 0.75)));
    } else {
      // Fallback mock if key missing (keeps demo alive)
      out = {
        ...out,
        demand_pct: -5,
        cost_pct: 10,
        margin_bps: -50,
        drivers: [
          { text: "Reduced discretionary demand from households.", tone: "bad" },
          { text: "Input costs rise due to supply friction.", tone: "warn" },
          { text: "Temporary substitution to local providers offsets losses.", tone: "good" }
        ],
        explanations_summary: "Near-term demand softens while costs rise, compressing margins. Local substitution and operational adjustments partially mitigate.",
        explanations_full: "In the base case, demand dips as households and firms defer spending, while input costs rise due to logistics tightness and policy uncertainty. Providers that reprice selectively and rebalance mix toward resilient segments limit the margin impact. Exposure varies by sub-industry and import intensity; firms with flexible contracts, diversified suppliers, and local alternatives fare best.",
        detail_blocks: {
          assumptions: ["Shock begins within 1–2 months", "Policy stance stays unchanged", "FX volatility contained"],
          risks: ["Longer disruption to logistics", "Tighter credit conditions", "Stronger-than-expected price sensitivity"],
          local_signals: ["Foot traffic trends", "Job postings / hours worked", "Supplier lead-time quotes"],
          time_path: ["0–3m: demand pullback, cost up", "3–12m: partial normalization", "12–24m: margins stabilize"],
          suggested_actions: ["Reprice selectively", "Secure secondary suppliers", "Prioritize resilient customer segments"]
        },
        sources_note: "Patterns inferred from historical local demand, input cost pass-through, and procurement cycle sensitivity.",
        caveats: "City-level impacts vary with industry mix and baseline capacity; results are directional, not investment advice.",
        confidence: 0.78
      };
    }

    // If client asked only summary, we can trim payload a bit (still return all fields for simplicity)
    const t0 = Date.now();
    return res.status(200).json({
      ...out,
      meta: {
        geo_canonical: geo,
        naics_canonical: String(naics),
        horizon_months: horizonMonths,
        scenario,
        latency_ms: Date.now() - t0,
        source: process.env.OPENROUTER_API_KEY ? "openrouter" : "mock"
      }
    });

  } catch (err) {
    console.error("forecast error:", err);
    return res.status(500).json({ error: "Failed to generate forecast" });
  }
};
