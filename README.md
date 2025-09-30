# EcoForecast AI™ — Frontend (index.html)

This document explains the structure and customization points of the **EcoForecast AI™ landing page**. It is meant to help you (or collaborators) quickly understand and edit the `index.html` file.

---

## 📂 File Purpose
The `index.html` file is the **standalone frontend** for EcoForecast AI™. It provides:
- A **forecast form** where users can enter events, locations, and industries to run economic impact forecasts.
- **Preset chips** for common scenarios (war escalation, tariffs, hurricanes, regime changes, US party shifts).
- A **results panel** that displays demand/cost/margin shifts, top drivers, and confidence.
- A **pricing section** with monthly/annual toggle, setup fees, and plan details.

---

## 🧩 Structure Overview
- **Header**: Logo/name + navigation (Forecast, Pricing).
- **Hero Section**: Split layout
  - **Forecast Form** (left): Event textarea, presets, city/industry inputs, horizon & scenario selectors, extra factors, Run/Reset buttons.
  - **Results Panel** (right): Displays forecast KPIs, drivers, and confidence.
- **Pricing Section**: Three plans (Business Insight, Analyst Pro, Enterprise/Investor) with setup fees.
- **Footer**: Disclaimer and copyright.

---

## 🔌 JavaScript Features
- **Preset Chips**: Auto-fill the event field with scenario templates.
- **NAICS Helper**: Suggests NAICS codes from keywords (restaurants, construction, aerospace, physicians, etc.).
- **Run Forecast**: Sends POST request to `/api/forecast` and updates results.
- **Reset Button**: Clears all inputs and results.
- **Pricing Toggle**: Switch between monthly and annual pricing.

---

## 🎨 Styling
- All styles are defined inline inside `<style>` for easy deployment on Vercel.
- Responsive grid: Adjusts to 1-column layout on small screens (<980px).
- Accessible color palette: Dark background, high contrast text, and clear state indicators.

---

## ⚙️ Customization Points
1. **API Integration**
   - Update `/api/forecast` endpoint to point to your backend.
2. **Checkout/Demo Links**
   - Replace `href="#..."` in the pricing buttons with actual Stripe, Paddle, or Calendly links.
   - Example: `<a href="https://calendly.com/farhad-nofa/demo">Book a Demo</a>`
3. **NAICS Codes**
   - Extend `naicsMap` in `<script>` for broader keyword coverage.
4. **Preset Scenarios**
   - Add or edit entries in `presetsMap` (e.g., pandemic, Fed rate hike, cyberattack).
5. **Styling**
   - Edit colors in `:root` variables.

---

## 🚀 Deployment
- Hosted on **Vercel** for instant deployment.
- Works with the backend stubs (`/api/forecast`, `/api/scenario`, `/api/parse_policy`, `/api/health`).
- Run locally with `vercel dev` or any static server.

---

## 📌 Notes
- This file is **standalone** — it does **not** include GovFlow AI™ code.
- All text and pricing can be modified directly inside the HTML.
- Designed to be fast, mobile-friendly, and demo-ready.

---

## 📄 License & Disclaimer
© EcoForecast AI™ • Part of the GovFlow AI™ family. For demo use only — not investment advice.
