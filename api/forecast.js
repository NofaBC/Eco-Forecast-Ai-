// api/forecast.js
//
// Deep-report forecaster with 2-stage generation and strict JSON.
// Stage 1: numbers + outline; Stage 2: long-form narrative (word targets by plan).
//
// ENV (Vercel):
//   OPENROUTER_API_KEY      = sk-or-... (required for live model)
//   OPENROUTER_MODEL        = openai/gpt-4o  (recommended)
//   REPORT_WORDS_BUSINESS   = 600   (optional override)
//   REPORT_WORDS_PRO        = 1400  (optional override)
//   REPORT_WORDS_ENTERPRISE = 2200  (optional override)

const DEFAULT_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o";

const PLAN = {
  business: {
    words: Number(process.env.REPORT_WORDS_BUSINESS || 700),
    maxTokens: 1600
  },
  pro: {
    words: Number(process.env.REPORT_WORDS_PRO || 1600),
    maxTokens: 3000
  },
  enterprise: {
    words: Number(process.env.REPORT_WORDS_ENTERPRISE || 2300),
    maxTokens: 4000
  }
};

function horizonMonths(h) {
  if (h === "short") return 3;
  if (h === "long") return 24;
  return 12;
}

function mockRich(plan, geo, naics, horizon) {
  const months = horizonMonths(horizon);
  return {
    demand_pct: -2.1,
    cost_pct: 1.3,
    margin_bps: -140,
    drivers: [
      { text: "Households defer discretionary purchases in the near term.", tone: "warn" },
      { text: "Freight, insurance, and energy lift input costs.", tone: "bad" },
      { text: "Operators defend margins via mix, staffing, and pricing.", tone: "good" }
    ],
    confidence: 0.83,
    narrative: {
      summary:
        `Over the next ${months} months in ${geo}, NAICS ${naics} faces mild-to-moderate demand softness and modest cost pressure. Margin repair hinges on mix, schedule discipline, and input negotiations.`,
      full:
        `Assumptions: supply lanes remain open; no full port closures; fuel elevated but not spiking >15% MoM.\n\n` +
        `Risks: conflict escalation extending lead times; higher insurance premia; confidence shock.\n\n` +
        `Local signals to watch: foot-traffic vs. 2019 baseline, dining reservations/turn, card-spend mix Grocery vs. Dining.\n\n` +
        `Time path: 0–3m softness; 4–9m stabilization; 10–12m gradual re-acceleration.\n\n` +
        `Actions: pre-buy non-perishables; renegotiate fuel-surcharge clauses; menu engineering; day-part staffing; targeted local marketing; monitor WTI/Brent, port dwell times, CPI FAFH.`,
      assumptions: [
        "No complete shutdown of key logistics nodes",
        "Energy prices elevated but do not spike >15% MoM",
        "No restrictive local mandate on operating hours"
      ],
      risks: [
        "Lead times extend to 4–6 weeks",
        "Insurance and risk premia outpace budgets",
        "Confidence shock reduces visit frequency"
      ],
      local_signals: [
        "Foot traffic trend vs. 2019 (PlaceIQ/SafeGraph-style)",
        "Reservations & table turn (OpenTable-like)",
        "Card-spend mix: Grocery vs. Dining"
      ],
      time_path: [
        "0–3m: demand dip; costs elevated; margin defense required",
        "4–9m: demand stabilizes; selective easing on logistics",
        "10–12m: gradual margin repair as inputs normalize"
      ],
      actions: [
        "Hedge/forward-buy shelf-stable inputs",
        "Menu engineering for higher contribution margin",
        "Consolidate deliveries; renegotiate fuel surcharges"
      ],
      data_anchors: [
        "WTI/Brent weekly, Baltic Dry Index",
        "CPI (FAFH), PPI (food inputs & packaging)",
        "Local payrolls, seated diners index, card-spend trends"
      ]
    },
    meta: {
      plan,
      geo_canonical: geo,
      naics_canonical: String(naics),
      horizon_months: months,
      source: "mock"
    }
  };
}

async function callOpenRouter(payload) {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://eco-forecast-ai.vercel.app",
      "X-Title": "EcoForecast AI"
    },
    body: JSON.stringify(payload)
  });
  return resp;
}

function buildStage1Prompt(context) {
  // Numbers + outline only (concise)
  return `
Return ONLY a JSON object with this shape:

{
  "demand_pct": number,       // e.g., -3.2 (percent)
  "cost_pct": number,         // e.g., 1.4  (percent)
  "margin_bps": integer,      // e.g., -120 (basis points)
  "drivers": [{"text": string, "tone": "good"|"bad"|"warn"}],
  "confidence": number,       // 0..1
  "outline": {
    "assumptions": string[],
    "risks": string[],
    "local_signals": string[],
    "time_path": string[],
    "actions": string[],
    "data_anchors": string[]
  }
}

No code fences. Valid JSON only.

Context:
${context}
`.trim();
}

function buildStage2Prompt(context, outline, wordTarget) {
  const safeOutline = JSON.stringify(outline ?? {}, null, 2);
  return `
Using the *outline* below, write a detailed, decision-grade forecast narrative.

Requirements:
- Target length: ~${wordTarget} words (do not go under ${Math.floor(wordTarget * 0.8)} words).
- Executive summary first (1–3 paragraphs).
- Then labeled sections: Assumptions, Risks, Local Signals, Time Path, Suggested Actions, Data Anchors.
- Localize to the city/region and NAICS where relevant.
- Keep numeric claims plausible; no sensationalism.
- Do not produce markdown code fences.

Return ONLY a JSON object:
{
  "narrative": {
    "summary": string,
    "full": string,
    "assumptions": string[],
    "risks": string[],
    "local_signals": string[],
    "time_path": string[],
    "actions": string[],
    "data_anchors": string[]
  }
}

Context:
${context}

Outline:
${safeOutline}
`.trim();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const {
      event,
      geo,
      naics,
      horizon = "medium",
      scenario = "Base",
      plan = "business",
      extra_factors = ""
    } = req.body || {};

    if (!event || !geo || !naics) {
      return res.status(400).json({ error: "Missing required fields: event, geo, naics" });
    }

    const months = horizonMonths(horizon);
    const cfg = PLAN[plan] || PLAN.business;

    const context =
      `Event: ${event}\n` +
      `Geo: ${geo}\n` +
      `Industry/NAICS: ${naics}\n` +
      `Horizon: ${horizon} (${months} months)\n` +
      `Scenario: ${scenario}\n` +
      `Extra factors: ${extra_factors || "none"}\n` +
      `Audience: operator/executive; business decisions.\n` +
      `Plan: ${plan} (long narrative expected).`;

    const hasKey = !!process.env.OPENROUTER_API_KEY;
    if (!hasKey) {
      return res.status(200).json(mockRich(plan, geo, naics, horizon));
    }

    // ---------- Stage 1: numbers + outline ----------
    let stage1Json;
    {
      const stage1 = buildStage1Prompt(context);
      const r1 = await callOpenRouter({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        max_tokens: Math.max(700, Math.floor(cfg.maxTokens * 0.35)),
        messages: [
          { role: "system", content: "You are EcoForecast AI. Output strictly valid JSON." },
          { role: "user", content: stage1 }
        ]
      });

      if (!r1.ok) {
        const txt = await r1.text().catch(() => "");
        console.error("Stage1 HTTP error:", r1.status, txt);
        const fb = mockRich(plan, geo, naics, horizon);
        fb.meta = { ...fb.meta, error: `openrouter_stage1_${r1.status}`, detail: txt.slice(0, 300) };
        return res.status(200).json(fb);
      }
      const j1 = await r1.json().catch(() => null);
      const raw1 = j1?.choices?.[0]?.message?.content?.trim() || "{}";
      try { stage1Json = JSON.parse(raw1); } catch { stage1Json = null; }
      if (!stage1Json) {
        const fb = mockRich(plan, geo, naics, horizon);
        fb.meta = { ...fb.meta, error: "stage1_bad_json", detail: raw1.slice(0, 300) };
        return res.status(200).json(fb);
      }
    }

    // ---------- Stage 2: long narrative ----------
    const targetWords = cfg.words;
    let stage2Json;
    let attempt = 0;
    while (attempt < 2) {
      attempt += 1;
      const stage2 = buildStage2Prompt(context, stage1Json.outline, targetWords);
      const r2 = await callOpenRouter({
        model: DEFAULT_MODEL,
        temperature: 0.25,
        response_format: { type: "json_object" },
        max_tokens: cfg.maxTokens,
        messages: [
          { role: "system", content: "You are EcoForecast AI. Output strictly valid JSON." },
          { role: "user", content: stage2 }
        ]
      });

      if (!r2.ok) {
        const txt = await r2.text().catch(() => "");
        console.error("Stage2 HTTP error:", r2.status, txt);
        break; // will fallback after loop
      }

      const j2 = await r2.json().catch(() => null);
      const raw2 = j2?.choices?.[0]?.message?.content?.trim() || "{}";
      try { stage2Json = JSON.parse(raw2); } catch { stage2Json = null; }

      // If too short, retry once with a stronger nudge
      const words = (stage2Json?.narrative?.full || "").split(/\s+/).filter(Boolean).length;
      if (stage2Json && words >= Math.floor(targetWords * 0.8)) break;

      // adjust target if needed and try again
      if (attempt < 2) {
        console.warn(`Stage2 too short (${words} < ${Math.floor(targetWords*0.8)}). Retrying…`);
      }
    }

    // If stage 2 failed, fallback to mock narrative but keep stage1 numbers
    if (!stage2Json) {
      const fb = mockRich(plan, geo, naics, horizon);
      // merge stage1 numbers
      if (stage1Json) {
        fb.demand_pct = Number(stage1Json.demand_pct ?? fb.demand_pct);
        fb.cost_pct = Number(stage1Json.cost_pct ?? fb.cost_pct);
        fb.margin_bps = Number(stage1Json.margin_bps ?? fb.margin_bps);
        fb.drivers = Array.isArray(stage1Json.drivers) ? stage1Json.drivers : fb.drivers;
        fb.confidence = Number(stage1Json.confidence ?? fb.confidence);
      }
      fb.meta = { ...fb.meta, error: "stage2_failed", source: "openrouter_fallback" };
      return res.status(200).json(fb);
    }

    // Merge results
    const out = {
      demand_pct: Number(stage1Json.demand_pct),
      cost_pct: Number(stage1Json.cost_pct),
      margin_bps: Number(stage1Json.margin_bps),
      drivers: Array.isArray(stage1Json.drivers) ? stage1Json.drivers : [],
      confidence: Number(stage1Json.confidence),
      narrative: {
        summary: stage2Json.narrative?.summary || "",
        full: stage2Json.narrative?.full || "",
        assumptions: stage2Json.narrative?.assumptions || stage1Json.outline?.assumptions || [],
        risks: stage2Json.narrative?.risks || stage1Json.outline?.risks || [],
        local_signals: stage2Json.narrative?.local_signals || stage1Json.outline?.local_signals || [],
        time_path: stage2Json.narrative?.time_path || stage1Json.outline?.time_path || [],
        actions: stage2Json.narrative?.actions || stage1Json.outline?.actions || [],
        data_anchors: stage2Json.narrative?.data_anchors || stage1Json.outline?.data_anchors || []
      },
      meta: {
        plan,
        geo_canonical: geo,
        naics_canonical: String(naics),
        horizon_months: months,
        source: "openrouter_2stage"
      }
    };

    return res.status(200).json(out);
  } catch (err) {
    console.error("forecast fatal:", err);
    const fb = mockRich("business", "Unknown", "0000", "medium");
    fb.meta = { ...fb.meta, error: "handler_exception", detail: String(err).slice(0, 300) };
    return res.status(200).json(fb);
  }
}
