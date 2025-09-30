// api/forecast.js - Vercel Serverless Function for EcoForecast AI

export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  // Handle preflight OPTIONS request
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({ 
      error: 'Method not allowed',
      message: `Expected POST, got ${req.method}`
    });
  }

  try {
    console.log('Received request body:', JSON.stringify(req.body));

    // Extract request data
    const {
      event,
      city,
      state,
      country = 'USA',
      industry,
      naics,
      horizon = '3mo',
      scenario = 'base',
      extraFactors = ''
    } = req.body || {};

    console.log('Parsed params:', { event, city, industry, naics, horizon, scenario });

    // Validate required fields
    if (!event || !city || !industry) {
      console.log('Validation failed - missing required fields');
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['event', 'city', 'industry'],
        received: { event: !!event, city: !!city, industry: !!industry }
      });
    }

    console.log('Generating forecast...');

    // Generate the forecast
    const forecast = generateForecast({
      event,
      city,
      state,
      country,
      industry,
      naics,
      horizon,
      scenario,
      extraFactors
    });

    console.log('Forecast generated successfully');

    // Return the forecast
    return res.status(200).json(forecast);

  } catch (error) {
    console.error('Forecast error:', error);
    console.error('Error stack:', error.stack);
    return res.status(500).json({
      error: 'Internal server error',
      message: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
}

// Main forecast generation function (synchronous - no await needed)
function generateForecast(params) {
  const {
    event,
    city,
    state,
    country,
    industry,
    naics,
    horizon,
    scenario,
    extraFactors
  } = params;

  console.log('Analyzing event...');
  
  // Analyze the event to determine impact direction
  const eventAnalysis = analyzeEvent(event, industry);

  // Calculate impacts based on scenario
  const scenarioMultiplier = {
    'best': 0.5,
    'base': 1.0,
    'severe': 1.8
  }[scenario] || 1.0;

  // Generate demand impact
  const demandShift = calculateDemandShift(eventAnalysis, scenarioMultiplier);
  
  // Generate cost impact
  const costShift = calculateCostShift(eventAnalysis, scenarioMultiplier);
  
  // Calculate margin impact (inverse relationship)
  const marginShift = calculateMarginShift(demandShift, costShift);

  // Generate top drivers
  const drivers = generateDrivers(event, industry, eventAnalysis);

  // Calculate confidence based on data quality
  const confidence = calculateConfidence(city, industry, naics, horizon);

  const result = {
    success: true,
    location: `${city}${state ? ', ' + state : ''}, ${country}`,
    industry: industry,
    naics: naics || 'N/A',
    horizon: horizon,
    scenario: scenario,
    forecast: {
      demand: {
        shift: demandShift,
        direction: demandShift > 0 ? 'increase' : 'decrease',
        magnitude: Math.abs(demandShift)
      },
      cost: {
        shift: costShift,
        direction: costShift > 0 ? 'increase' : 'decrease',
        magnitude: Math.abs(costShift)
      },
      margin: {
        shift: marginShift,
        direction: marginShift > 0 ? 'increase' : 'decrease',
        magnitude: Math.abs(marginShift)
      }
    },
    drivers: drivers,
    confidence: confidence,
    timestamp: new Date().toISOString(),
    notes: extraFactors || 'No additional factors provided'
  };

  console.log('Forecast result:', JSON.stringify(result));
  return result;
}

// Analyze event sentiment and impact
function analyzeEvent(event, industry) {
  const eventLower = event.toLowerCase();
  
  // Negative keywords
  const negativeKeywords = [
    'war', 'conflict', 'escalation', 'tariff', 'sanction', 'embargo',
    'hurricane', 'disaster', 'pandemic', 'recession', 'crisis', 'crash',
    'ban', 'restriction', 'shutdown', 'strike', 'riot', 'attack'
  ];
  
  // Positive keywords
  const positiveKeywords = [
    'growth', 'expansion', 'subsidy', 'incentive', 'boom', 'recovery',
    'innovation', 'breakthrough', 'deal', 'agreement', 'peace', 'stability'
  ];

  // Supply chain keywords
  const supplyChainKeywords = [
    'supply', 'shortage', 'disruption', 'logistics', 'transport', 'shipping'
  ];

  let sentiment = 0;
  let supplyImpact = false;
  let demandImpact = false;

  negativeKeywords.forEach(keyword => {
    if (eventLower.includes(keyword)) sentiment -= 1;
  });

  positiveKeywords.forEach(keyword => {
    if (eventLower.includes(keyword)) sentiment += 1;
  });

  supplyChainKeywords.forEach(keyword => {
    if (eventLower.includes(keyword)) supplyImpact = true;
  });

  // Check for demand-related terms
  if (eventLower.includes('demand') || eventLower.includes('consumer') || 
      eventLower.includes('spending')) {
    demandImpact = true;
  }

  return {
    sentiment,
    supplyImpact,
    demandImpact,
    isNegative: sentiment < 0,
    isPositive: sentiment > 0
  };
}

// Calculate demand shift percentage
function calculateDemandShift(analysis, multiplier) {
  let baseShift = 0;

  if (analysis.isNegative) {
    // Negative events typically reduce demand
    baseShift = -8 - (Math.random() * 7); // -8% to -15%
  } else if (analysis.isPositive) {
    // Positive events increase demand
    baseShift = 5 + (Math.random() * 8); // +5% to +13%
  } else {
    // Neutral or mixed
    baseShift = -2 + (Math.random() * 6); // -2% to +4%
  }

  // Apply demand impact modifier
  if (analysis.demandImpact) {
    baseShift *= 1.3;
  }

  return Math.round((baseShift * multiplier) * 10) / 10;
}

// Calculate cost shift percentage
function calculateCostShift(analysis, multiplier) {
  let baseShift = 0;

  if (analysis.supplyImpact) {
    // Supply chain issues increase costs
    baseShift = 8 + (Math.random() * 12); // +8% to +20%
  } else if (analysis.isNegative) {
    // Negative events often increase costs
    baseShift = 4 + (Math.random() * 8); // +4% to +12%
  } else if (analysis.isPositive) {
    // Positive events might reduce costs
    baseShift = -3 + (Math.random() * 5); // -3% to +2%
  } else {
    baseShift = 1 + (Math.random() * 4); // +1% to +5%
  }

  return Math.round((baseShift * multiplier) * 10) / 10;
}

// Calculate margin shift (compound effect)
function calculateMarginShift(demandShift, costShift) {
  // Margin is squeezed when costs rise and demand falls
  // Margin expands when demand rises and costs fall
  const marginImpact = (demandShift * 0.6) - (costShift * 0.8);
  return Math.round(marginImpact * 10) / 10;
}

// Generate top drivers for the forecast
function generateDrivers(event, industry, analysis) {
  const drivers = [];
  
  // Driver 1: Direct event impact
  drivers.push({
    factor: 'Event Impact',
    description: `${event} directly affects ${industry} sector`,
    weight: 35,
    direction: analysis.isNegative ? 'negative' : 'positive'
  });

  // Driver 2: Supply chain
  if (analysis.supplyImpact) {
    drivers.push({
      factor: 'Supply Chain',
      description: 'Disruptions to supply chain and logistics',
      weight: 25,
      direction: 'negative'
    });
  } else {
    drivers.push({
      factor: 'Market Conditions',
      description: 'Current market dynamics and competition',
      weight: 25,
      direction: 'neutral'
    });
  }

  // Driver 3: Consumer behavior
  drivers.push({
    factor: 'Consumer Behavior',
    description: analysis.demandImpact ? 
      'Changing consumer spending patterns' : 
      'Stable consumer preferences',
    weight: 20,
    direction: analysis.demandImpact ? 'negative' : 'neutral'
  });

  // Driver 4: Regional factors
  drivers.push({
    factor: 'Local Economic Conditions',
    description: 'Regional employment and income levels',
    weight: 12,
    direction: 'neutral'
  });

  // Driver 5: Policy environment
  drivers.push({
    factor: 'Policy Environment',
    description: 'Regulatory and government support',
    weight: 8,
    direction: analysis.isPositive ? 'positive' : 'neutral'
  });

  return drivers;
}

// Calculate confidence score
function calculateConfidence(city, industry, naics, horizon) {
  let confidence = 75; // Base confidence

  // NAICS code adds confidence (more specific data)
  if (naics && naics !== 'N/A') {
    confidence += 8;
  }

  // Shorter horizons are more confident
  if (horizon === '1mo') {
    confidence += 7;
  } else if (horizon === '3mo') {
    confidence += 3;
  } else if (horizon === '12mo') {
    confidence -= 5;
  }

  // Major cities have more data
  const majorCities = ['new york', 'los angeles', 'chicago', 'houston', 'phoenix', 
                       'philadelphia', 'san antonio', 'san diego', 'dallas', 'san jose'];
  if (majorCities.some(mc => city.toLowerCase().includes(mc))) {
    confidence += 5;
  }

  // Cap confidence between 60-95
  confidence = Math.max(60, Math.min(95, confidence));

  return `${confidence}%`;
}
