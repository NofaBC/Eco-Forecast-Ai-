// /api/scenario.ts
// Node.js 20 runtime compatible, no external imports

type VercelRequest = any;
type VercelResponse = any;

const PRESETS = {
  war_escalation: {
    label: 'War Escalation',
    template:
      'A regional conflict escalates with partial blockade of a key shipping lane; insurance premia rise; export controls expand.'
  },
  tariff_steel: {
    label: '10% Steel Tariff (US)',
    template:
      'U.S. imposes a 10% tariff on steel imports effective in 60 days; exemptions uncertain; domestic mills signal capacity strain.'
  },
  hurricane_landfall: {
    label: 'Major Hurricane Landfall',
    template:
      'Category-4 hurricane landfall near major Gulf port; refinery throughput reduced; logistics reroutes extend lead times by 2-4 weeks.'
  },
  regime_change: {
    label: 'Regime Change',
    template:
      'Sudden regime change triggers capital controls and export permit reviews; FX volatility spikes; counterparties reassess risk.'
  },
  party_shift_us: {
    label: 'US Party Control Shift',
    template:
      'One party gains unified control of White House and Congress; agenda prioritizes tax, energy, and labor policy changes within 12 months.'
  }
} as const;

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }
  res.status(200).json({ presets: PRESETS });
}
