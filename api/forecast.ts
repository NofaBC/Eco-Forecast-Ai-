const NEEDS_KEY = false; // flip to true if you wire a real model
const apiKey = process.env.MY_MODEL_KEY || '';
if (NEEDS_KEY && !apiKey) {
  console.warn('EcoForecast: missing MY_MODEL_KEY');
}
