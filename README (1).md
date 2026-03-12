# Pheydrus Analytics Dashboard

A lightweight analytics prototype that pulls data from **Meta Ads (Facebook)** and **SamCart**, combines it via UTM attribution, and displays actionable metrics in a single-page dashboard.

---

## What It Does

| Layer | Detail |
|---|---|
| **Meta Ads** | Campaign-level spend, impressions, clicks, conversions, pixel-attributed revenue |
| **SamCart** | Orders, products, revenue, refunds, MRR, UTM metadata |
| **Attribution** | UTM stitching links SamCart orders back to Meta campaigns |
| **Dashboard** | KPI cards, revenue trend, ROAS by campaign, conversion funnel, order table |

---

## Architecture

```
src/
├── lib/
│   ├── meta_api.js      → Meta Marketing API v20.0 wrapper
│   ├── samcart_api.js   → SamCart REST API wrapper  
│   └── transform.js     → Combines both datasets, builds KPIs + funnel
index.html               → Self-contained dashboard (Chart.js)
.env.example             → Required environment variables
```

### Data Flow

```
Meta Ads API (v20.0)          SamCart API
  /insights?level=campaign       /orders?status=paid
        │                              │
        ▼                              ▼
  fetchMetaCampaignInsights()    fetchSamCartOrders()
        │                              │
        └────────────┬─────────────────┘
                     ▼
           attributeSamCartToMeta()
           [UTM: utm_campaign → campaign_name]
                     │
                     ▼
            buildKPISummary() + buildFunnel()
                     │
                     ▼
              Dashboard Render
```

---

## Setup

### 1. Clone & install

```bash
git clone https://github.com/your-org/pheydrus-dashboard
cd pheydrus-dashboard
# No build step required — open index.html directly in a browser
# OR serve with any static file server:
npx serve .
```

### 2. Set environment variables

Copy `.env.example` to `.env` and fill in your credentials:

```bash
cp .env.example .env
```

```env
META_ACCESS_TOKEN=your_long_lived_access_token
META_AD_ACCOUNT_ID=act_123456789

SAMCART_API_KEY=your_samcart_api_key
```

### 3. Swap mock data for real API calls

In `index.html`, the `fetchMetaData()` and `fetchSamCartData()` functions return mock data. To connect real APIs, replace them:

```js
// Before (mock):
async function fetchMetaData() {
  await delay(600);
  return { campaigns: [...] };
}

// After (real):
import { fetchMetaCampaignInsights, fetchMetaDailyBreakdown } from './src/lib/meta_api.js';

async function fetchMetaData() {
  return fetchMetaCampaignInsights({
    accessToken: import.meta.env.META_ACCESS_TOKEN,
    adAccountId: import.meta.env.META_AD_ACCOUNT_ID,
    datePreset: 'last_30d',
  });
}
```

---

## API Details

### Meta Ads — Marketing API v20.0

- **Endpoint**: `GET /v20.0/{ad_account_id}/insights`
- **Auth**: Bearer token (long-lived User token or System User token)
- **Key fields**: `spend`, `impressions`, `clicks`, `actions` (purchase count), `action_values` (revenue)
- **Docs**: https://developers.facebook.com/docs/marketing-api/insights

**Getting a token:**
1. Create a Meta App at developers.facebook.com
2. Add the Marketing API product
3. Request `ads_read` permission
4. Generate a System User token for production use (non-expiring)

### SamCart API

- **Base URL**: `https://app.samcart.com/api`
- **Auth**: `SC-Api-Key` header
- **Key endpoints**: `/orders`, `/products`, `/subscriptions`
- **Docs**: https://developer.samcart.com

**Getting an API key:**
SamCart > Settings > Integrations > API Keys

---

## UTM Attribution Strategy

SamCart captures UTM parameters at checkout. To link Meta ad spend to SamCart revenue:

1. All Meta ad URLs include `utm_source=facebook&utm_campaign={campaign_name}`
2. SamCart stores these on each order object (`utm_source`, `utm_campaign`)
3. `attributeSamCartToMeta()` in `transform.js` joins on `utm_campaign → campaign_name`

This gives you **actual SamCart revenue per Meta campaign** rather than relying on Meta's pixel-reported action values (which suffer from iOS 14+ signal loss).

---

## Metrics Explained

| Metric | Formula |
|---|---|
| **ROAS** | SamCart Revenue (UTM-attributed) / Meta Spend |
| **CPA** | Meta Spend / SamCart Order Count |
| **Blended ROAS** | Total SamCart Net Revenue / Total Meta Spend |
| **AOV** | SamCart GMV / Paid Order Count |
| **MRR** | Sum of active subscription amounts |

---

## Extending This

- **Add Google Ads**: Same pattern — `src/lib/google_ads_api.js` with the Google Ads Query Language (GAQL) API
- **Add Klaviyo**: Pull email-attributed revenue via `https://a.klaviyo.com/api/campaigns`
- **Add Stripe**: Cross-reference SamCart orders with Stripe charges for refund accuracy
- **Scheduled sync**: Wrap `runSync()` in a cron (Node) or Cloud Function to auto-refresh nightly
- **Database layer**: Persist fetched data to Postgres/Supabase to enable historical trend analysis

---

## Tech Stack

- **Vanilla JS + HTML/CSS** — zero build tooling, runs anywhere
- **Chart.js 4** — revenue trend, ROAS bar chart, product donut
- **Meta Marketing API v20.0**
- **SamCart REST API**

---

## Time Spent

~2.5 hours total:
- 30 min: API research (Meta docs, SamCart docs)
- 45 min: API integration modules (`meta_api.js`, `samcart_api.js`, `transform.js`)
- 60 min: Dashboard UI + charts
- 15 min: README + cleanup
