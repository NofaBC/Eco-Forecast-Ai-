// api/forecast.js  — EcoForecast AI™ v3.0
// Author: NOFA Business Consulting | Farhad Nasserghodsi
// Purpose: Deep reasoning economic forecasts with tiered narrative depth + PDF-ready summaries

const MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-4o";
const API_KEY = process.env.OPENROUTER_API_KEY;

const PLAN_DEPTH = {
  business: { maxTokens: 1000, narrativeLength: 500 },
  pro: { maxTokens: 2500, narrativeLength: 1500 },
  enterprise: { maxTokens: 4000, narrativeLength: 2500 }
};

function horizonMonths(h) {
  if (h === "short") return 3;
  if (h === "long") return 24;
  return 12;
}

function mockReport(plan, geo, naics) {
  return {
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
      summary: `Short-term headwinds expected for ${naics} in ${geo}, as demand dips and costs rise modestly.`,
      full: `Demand is expected to decline by roughly 3%, primarily due to weaker consumer sentiment and uncertainty around the event. Costs rise modestly from fuel and insurance volatility, trimming margins by approximately 180 basis points. Business recovery will depend on supply normalization and consumer rebound.`
    }
  };
}

function buildPrompt(event, geo, naics, scenario, horizon, extra, plan) {
  const planSpec = PLAN_DEPTH[plan] || PLAN_DEPTH.business;
  return `
Generate a professional economic impact forecast for the following:

Event: ${event}
City/Region: ${geo}
Industry (NAICS): ${naics}
Scenario: ${scenario}
Time Horizon: ${horizon}
Extra Factors: ${extra || "none"}

Instructions:
- Write a professional 5–8 paragraph analysis (approx. ${planSpec.narrativeLength} words for ${plan} plan).
- Include cause–effect reasoning, historical parallels, and business implications.
- Address the following sections in order:
  1. Executive Summary
  2. Key Assumptions
  3. Demand Outlook
  4. Cost Pressures
  5. Profit Margin Impacts
  6. Risks & Opportunities
  7. Strategic Recommendations
- Write in the tone of a Goldman Sachs / McKinsey analyst brief.
- End with 3 bullet takeaways.
- Output valid JSON only in this format:
{
 "demand_pct": number,
 "cost_pct": number,
 "margin_bps": number,
 "drivers": [{"text": string, "tone": "good"|"bad"|"warn"}],
 "confidence": number,
 "narrative": {"summary": string, "full": string}
}
Do NOT include code fences or markdown formatting.
`;
}

async function callModel(prompt, plan) {
  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "https://eco-forecast-ai.vercel.app",
      "X-Title": "EcoForecast AI"
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0.25,
      max_tokens: PLAN_DEPTH[plan].maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "You are EcoForecast AI, an economic intelligence system. Output valid JSON only." },
        { role: "user", content: prompt }
      ]
    })
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content?.trim() || "";
  try {
    return JSON.parse(content);
  } catch (e) {
    console.error("Bad JSON:", content.slice(0, 400));
    throw new Error("Invalid JSON from model");
  }
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const { event, geo, naics, scenario, horizon, plan, extra_factors } = req.body || {};
    if (!event || !geo || !naics) return res.status(400).json({ error: "Missing required fields" });
    if (!API_KEY) return res.status(200).json(mockReport(plan, geo, naics));

    const prompt = buildPrompt(event, geo, naics, scenario, horizon, extra_factors, plan);
    const result = await callModel(prompt, plan);

    return res.status(200).json({
      ...result,
      meta: { plan, model: MODEL, source: "EcoForecast-v3.0" }
    });
  } catch (err) {
    console.error("Forecast Error:", err);
    const fb = mockReport("business", "Unknown", "0000");
    fb.meta = { error: err.message, source: "fallback" };
    return res.status(200).json(fb);
  }
}
