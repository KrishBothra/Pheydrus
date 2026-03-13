# Pheydrus Analytics Dashboard — GA4 + Stripe

Analytics dashboard prototype pulling data from **Google Analytics 4** and **Stripe**. Runs in the browser with zero build tooling — open `index.html` and optionally enter a Stripe test key to pull live data instantly.

---

## Quick Start

```bash
git clone https://github.com/your-org/pheydrus-dashboard
cd pheydrus-dashboard

# Option A: just open the file
open index.html

# Option B: local dev server (avoids any file:// quirks)
npx serve .
```

Then paste a **Stripe test key** (`sk_test_...`) into the config panel at the top. The dashboard will immediately pull your real charges, subscriptions, and MRR.

GA4 uses mock data by default (browser CORS restriction — see below).

---

## Architecture

```
index.html              → Self-contained dashboard, works offline with mock data
src/lib/
  stripe_api.js         → Stripe REST API wrapper (paginated, full type coverage)
  ga4_api.js            → GA4 Data API module (server-side, Node.js)
.env.example            → Required env vars
```

### Data Flow

```
Browser                              Backend (optional)
──────────────────                   ──────────────────────────────
Stripe REST API ◄──── direct ────── sk_test_... / sk_live_...
  /v1/charges                        (works from browser in demo mode)
  /v1/subscriptions

GA4 Data API ◄──── proxy ─────────  GET /api/ga4
  (CORS blocked in browser)          └─ ga4_api.js
                                        └─ @google-analytics/data SDK
```

---

## API Details

### Stripe

- **Base URL**: `https://api.stripe.com/v1`
- **Auth**: HTTP Basic — secret key as username, empty password
- **Key endpoints used**:
  - `GET /v1/charges` — transaction history
  - `GET /v1/subscriptions` — active subscriptions for MRR
- **Pagination**: cursor-based via `starting_after` / `has_more`
- **Getting a key**: [dashboard.stripe.com → Developers → API keys](https://dashboard.stripe.com/test/apikeys)
- **Test key prefix**: `sk_test_` — safe to use, reads test mode data only

```js
// Direct browser call (demo only — use backend in production)
const res = await fetch('https://api.stripe.com/v1/charges?limit=100', {
  headers: { Authorization: 'Basic ' + btoa(stripeKey + ':') }
});
```

### Google Analytics 4

GA4's Data API requires OAuth2 / Service Account auth and blocks CORS — it **must** run server-side.

**Setup steps:**
1. [Create a Google Cloud project](https://console.cloud.google.com)
2. Enable **Google Analytics Data API**
3. Create a **Service Account** → download JSON key
4. In GA4: Admin → Property Access Management → add service account email as **Viewer**
5. Set env vars (see `.env.example`)

**Backend route example** (Express):
```js
import { fetchGA4Overview, fetchGA4Channels, fetchGA4Funnel } from './src/lib/ga4_api.js';

app.get('/api/ga4', async (req, res) => {
  const [overview, channels, funnel] = await Promise.all([
    fetchGA4Overview(30),
    fetchGA4Channels(30),
    fetchGA4Funnel(30),
  ]);
  res.json({ overview, channels, funnel });
});
```

Then in `index.html`, update `fetchGA4Data()` to call your backend:
```js
async function fetchGA4Data() {
  const res = await fetch('/api/ga4');
  return res.json();
}
```

---

## Metrics

| Metric | Source | Formula |
|---|---|---|
| Gross Revenue | Stripe | Sum of paid charges (30d) |
| MRR | Stripe | Sum of active subscription monthly amounts |
| AOV | Stripe | GMV / paid order count |
| Sessions | GA4 | `sessions` metric |
| Conversion Rate | GA4 | `sessionConversionRate` metric |
| Channel Split | GA4 | `sessionDefaultChannelGroup` dimension |

---

## UTM Attribution (Stripe ↔ GA4)

To connect Stripe revenue back to GA4 traffic sources:

1. Tag all links with UTMs: `?utm_source=google&utm_campaign=brand`
2. On checkout, capture UTMs from URL params and write to Stripe charge metadata:
   ```js
   await stripe.charges.create({
     amount: 9900,
     metadata: { utm_source: 'google', utm_campaign: 'brand' }
   });
   ```
3. `stripe_api.js` exposes `utmSource` / `utmCampaign` on each charge object
4. Join on `utm_campaign` for channel-level ROAS

---

## Extending

| Add this | How |
|---|---|
| **Google Ads** | Google Ads Query Language API — same backend pattern as GA4 |
| **Email (Klaviyo)** | `GET https://a.klaviyo.com/api/campaigns` — add `src/lib/klaviyo_api.js` |
| **Scheduled sync** | Wrap `runSync()` in a cron job or Cloud Scheduler → push to Supabase |
| **Alerts** | Compare current ROAS vs 7d average → send Slack webhook if below threshold |
| **Historical DB** | Write daily snapshots to Postgres for trend analysis beyond API windows |

---

## Stack

- **Vanilla JS + HTML/CSS** — zero dependencies, no build step
- **Chart.js 4** — line, bar, doughnut charts
- **Stripe REST API** — direct browser calls (test key only)
- **GA4 Data API** — server-side via `@google-analytics/data` Node SDK
- **No framework** — easy to drop into any existing stack

---

## Time Spent

~2.5 hours:
- 20 min: Stripe API exploration + test key setup
- 20 min: GA4 API research (CORS limitation, service account setup)  
- 45 min: API modules (`stripe_api.js`, `ga4_api.js`)
- 60 min: Dashboard UI + charts + config panel
- 25 min: README + cleanup
