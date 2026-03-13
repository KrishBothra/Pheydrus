/**
 * Google Analytics 4 — Data API Integration
 * Server-side module (Node.js / Cloud Function / Express route)
 *
 * GA4 Data API cannot be called directly from a browser (CORS restriction).
 * This module runs on your backend and proxies results to the dashboard.
 *
 * Docs: https://developers.google.com/analytics/devguides/reporting/data/v1
 *
 * Setup:
 *  1. Create a Google Cloud project
 *  2. Enable the "Google Analytics Data API"
 *  3. Create a Service Account → download JSON key
 *  4. In GA4: Admin → Property Access Management → add service account email as Viewer
 *
 * Required env vars:
 *   GA4_PROPERTY_ID          - e.g. "123456789" (without "properties/" prefix)
 *   GOOGLE_APPLICATION_CREDENTIALS - path to service account JSON file
 *      OR set GA4_SERVICE_ACCOUNT_JSON with the JSON contents directly
 */

import { BetaAnalyticsDataClient } from '@google-analytics/data';

const propertyId = process.env.GA4_PROPERTY_ID;

// Client auto-reads GOOGLE_APPLICATION_CREDENTIALS from env
const analyticsClient = new BetaAnalyticsDataClient();

/**
 * Fetch session + conversion metrics for the last N days.
 *
 * @param {number} days  - lookback window (default 30)
 * @returns {Promise<Object>}
 */
export async function fetchGA4Overview(days = 30) {
  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [
      { startDate: `${days}daysAgo`, endDate: 'today' },
      { startDate: `${days * 2}daysAgo`, endDate: `${days + 1}daysAgo` }, // prev period for delta
    ],
    metrics: [
      { name: 'sessions' },
      { name: 'activeUsers' },
      { name: 'engagementRate' },
      { name: 'conversions' },
      { name: 'sessionConversionRate' },
    ],
  });

  const cur = response.rows?.[0]?.metricValues ?? [];
  const prev = response.rows?.[1]?.metricValues ?? [];

  return {
    sessions: parseInt(cur[0]?.value ?? 0),
    users: parseInt(cur[1]?.value ?? 0),
    engagementRate: parseFloat(cur[2]?.value ?? 0) * 100,
    conversions: parseInt(cur[3]?.value ?? 0),
    conversionRate: parseFloat(cur[4]?.value ?? 0) * 100,
    sessionsDelta: pctDelta(cur[0]?.value, prev[0]?.value),
  };
}

/**
 * Fetch daily session + conversion breakdown for trend chart.
 */
export async function fetchGA4DailyBreakdown(days = 30) {
  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'date' }],
    metrics: [
      { name: 'sessions' },
      { name: 'conversions' },
    ],
    orderBys: [{ dimension: { dimensionName: 'date' } }],
  });

  return (response.rows ?? []).map(row => ({
    date: row.dimensionValues[0].value,  // YYYYMMDD
    sessions: parseInt(row.metricValues[0].value),
    conversions: parseInt(row.metricValues[1].value),
  }));
}

/**
 * Fetch sessions by channel grouping (organic, paid, direct, email, etc.)
 */
export async function fetchGA4Channels(days = 30) {
  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }, { name: 'conversions' }],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 8,
  });

  return (response.rows ?? []).map(row => ({
    name: row.dimensionValues[0].value,
    sessions: parseInt(row.metricValues[0].value),
    conversions: parseInt(row.metricValues[1].value),
  }));
}

/**
 * Fetch top pages by sessions with engagement + conversion data.
 */
export async function fetchGA4TopPages(days = 30) {
  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'pagePath' }],
    metrics: [
      { name: 'sessions' },
      { name: 'engagementRate' },
      { name: 'sessionConversionRate' },
    ],
    orderBys: [{ metric: { metricName: 'sessions' }, desc: true }],
    limit: 10,
  });

  return (response.rows ?? []).map(row => ({
    path: row.dimensionValues[0].value,
    sessions: parseInt(row.metricValues[0].value),
    engRate: (parseFloat(row.metricValues[1].value) * 100).toFixed(1),
    conv: (parseFloat(row.metricValues[2].value) * 100).toFixed(1),
  }));
}

/**
 * Fetch conversion funnel data.
 * Requires you to have set up funnel events in GA4:
 *   page_view → view_item → add_to_cart → begin_checkout → purchase
 */
export async function fetchGA4Funnel(days = 30) {
  const events = ['page_view', 'view_item', 'add_to_cart', 'begin_checkout', 'purchase'];
  const labels = ['Sessions', 'Product Views', 'Add to Cart', 'Checkout', 'Purchase'];

  const [response] = await analyticsClient.runReport({
    property: `properties/${propertyId}`,
    dateRanges: [{ startDate: `${days}daysAgo`, endDate: 'today' }],
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: {
      filter: {
        fieldName: 'eventName',
        inListFilter: { values: events },
      },
    },
  });

  const eventMap = {};
  for (const row of response.rows ?? []) {
    eventMap[row.dimensionValues[0].value] = parseInt(row.metricValues[0].value);
  }

  return events.map((e, i) => ({
    stage: labels[i],
    value: eventMap[e] ?? 0,
  }));
}

// ── Express route example ─────────────────────────────────────────────────
//
// import express from 'express';
// const router = express.Router();
//
// router.get('/api/ga4', async (req, res) => {
//   try {
//     const [overview, channels, pages, funnel, daily] = await Promise.all([
//       fetchGA4Overview(),
//       fetchGA4Channels(),
//       fetchGA4TopPages(),
//       fetchGA4Funnel(),
//       fetchGA4DailyBreakdown(),
//     ]);
//     res.json({ overview, channels, pages, funnel, daily });
//   } catch (err) {
//     res.status(500).json({ error: err.message });
//   }
// });
//
// export default router;

// ── Helpers ───────────────────────────────────────────────────────────────

function pctDelta(current, previous) {
  const c = parseFloat(current ?? 0);
  const p = parseFloat(previous ?? 0);
  if (p === 0) return null;
  return ((c - p) / p * 100).toFixed(1) + '%';
}
