# Pheydrus Analytics Dashboard

A live analytics dashboard that pulls real data from **Stripe** and **Amazon** and displays it in a single unified interface. Built as part of the Pheydrus internship application technical exercise.

---

## What It Does

The dashboard gives a real-time view of two data sources side by side:

- **Stripe** — gross revenue, MRR, active subscriptions, AOV, daily revenue chart, top products by revenue, and a recent charges table
- **Amazon** — product reviews pulled by ASIN, star rating breakdown, sentiment bars, and individual review cards

Everything loads on page open and can be refreshed with the Sync button at any time.

---

## Approach

### API Integration

**Stripe** is queried directly from the browser using the `fetch` API against `api.stripe.com`. The dashboard hits two endpoints in parallel — `/v1/charges` and `/v1/subscriptions` — then aggregates the results client-side: summing revenue by day, grouping by product description, and computing MRR from active subscription prices.

**Amazon** is accessed via the [Real-Time Amazon Data API on RapidAPI](https://rapidapi.com/letscrape-6bRBa3QguO5/api/real-time-amazon-data). The ASIN is configurable via an input bar at the top of the dashboard — changing it and hitting "Look up" fetches reviews for any Amazon product instantly.

### Data Transformation

Raw API responses are normalized into a consistent shape before rendering:

- Stripe charges are bucketed by calendar day to build the 30-day revenue chart
- Charges are also grouped by `description` field to power the "Revenue by Product" bar chart
- Amazon reviews are counted by star rating to produce the sentiment distribution bars and pie-style chart

### No Backend

Everything runs in a single `index.html` file with no server, no build step, and no dependencies beyond Chart.js (loaded from CDN). API keys are hardcoded for the prototype — in production these would live in environment variables on a backend proxy.

### Sandbox Seeder

Because the Stripe account starts empty, a companion script (`seed_stripe.js`) populates the sandbox with realistic test data: 15 customers, 30 one-time charges across four products, and 8 active monthly subscriptions. It uses Stripe's official test tokens (`tok_visa`, `tok_mastercard`, etc.) directly as charge sources — the correct pattern for test mode without requiring raw card API access.

---

## Project Structure

```
index.html        # Dashboard — open in any browser, no build needed
seed_stripe.js    # One-time script to populate the Stripe sandbox with test data
README.md         # This file
```

---

## Running Locally

**1. Seed Stripe (run once):**
```bash
node seed_stripe.js   # Node 18+ required
```

**2. Open the dashboard:**
```bash
open index.html
# or just double-click it — no server required
```

---

## Tools Used

- **Stripe API** — payment data
- **RapidAPI / Real-Time Amazon Data** — product reviews
- **Chart.js** — all charts
- **Claude (Anthropic)** — used heavily for prototyping, debugging the Stripe token/customer flow, and iterating on the dashboard layout
