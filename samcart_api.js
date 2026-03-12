/**
 * SamCart API Integration
 * REST API — Base URL: https://app.samcart.com/api
 *
 * Docs: https://developer.samcart.com
 *
 * Required env vars:
 *   SAMCART_API_KEY  - Found in SamCart > Settings > Integrations > API
 */

const SAMCART_BASE_URL = 'https://app.samcart.com/api';

/**
 * Helper: authenticated SamCart fetch
 */
async function samcartFetch(path, apiKey, params = {}) {
  const url = new URL(`${SAMCART_BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, v));

  const res = await fetch(url.toString(), {
    headers: {
      'SC-Api-Key': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`SamCart API error ${res.status}: ${body}`);
  }

  return res.json();
}

/**
 * Fetch paid orders within a date range.
 *
 * @param {Object} options
 * @param {string} options.apiKey          - SamCart API key
 * @param {string} options.createdAfter    - ISO date string  e.g. '2025-06-01'
 * @param {string} options.createdBefore   - ISO date string  e.g. '2025-06-30'
 * @param {number} options.perPage         - Results per page (max 100)
 * @returns {Promise<Array>}
 */
export async function fetchSamCartOrders({
  apiKey,
  createdAfter,
  createdBefore,
  perPage = 100,
}) {
  const data = await samcartFetch('/orders', apiKey, {
    status: 'paid',
    created_after: createdAfter,
    created_before: createdBefore,
    per_page: perPage,
  });

  return (data.data ?? data).map(transformOrder);
}

/**
 * Fetch product list with revenue aggregation.
 */
export async function fetchSamCartProducts({ apiKey }) {
  const data = await samcartFetch('/products', apiKey);
  return (data.data ?? data).map(p => ({
    id: p.id,
    name: p.name,
    price: parseFloat(p.price ?? 0),
    type: p.type, // 'one_time' | 'subscription' | 'payment_plan'
  }));
}

/**
 * Fetch subscriptions (MRR tracking).
 */
export async function fetchSamCartSubscriptions({ apiKey, status = 'active' }) {
  const data = await samcartFetch('/subscriptions', apiKey, { status });
  return (data.data ?? data).map(s => ({
    id: s.id,
    productId: s.product_id,
    customerId: s.customer_id,
    amount: parseFloat(s.amount ?? 0),
    status: s.status,
    nextBillingDate: s.next_billing_date,
    createdAt: s.created_at,
  }));
}

/**
 * Aggregate orders into per-product revenue summary.
 *
 * @param {Array} orders - from fetchSamCartOrders()
 * @returns {Array} sorted by revenue desc
 */
export function aggregateByProduct(orders) {
  const map = {};
  for (const order of orders) {
    const key = order.productName;
    if (!map[key]) {
      map[key] = { name: key, units: 0, revenue: 0, refunds: 0 };
    }
    if (order.status === 'paid') {
      map[key].units++;
      map[key].revenue += order.amount;
    }
    if (order.status === 'refunded') {
      map[key].refunds += order.amount;
    }
  }
  return Object.values(map).sort((a, b) => b.revenue - a.revenue);
}

/**
 * Calculate total GMV and MRR from orders + subscriptions.
 */
export function calcSamCartKPIs(orders, subscriptions = []) {
  const paid = orders.filter(o => o.status === 'paid');
  const gmv = paid.reduce((s, o) => s + o.amount, 0);
  const refunds = orders.filter(o => o.status === 'refunded').reduce((s, o) => s + o.amount, 0);
  const mrr = subscriptions.filter(s => s.status === 'active').reduce((s, sub) => s + sub.amount, 0);
  const aov = paid.length > 0 ? gmv / paid.length : 0;

  return { gmv, refunds, netRevenue: gmv - refunds, mrr, aov, orderCount: paid.length };
}

// ── Helpers ───────────────────────────────────────────────────────────────

function transformOrder(raw) {
  return {
    id: raw.id,
    orderId: raw.order_id ?? raw.id,
    productName: raw.product?.name ?? raw.product_name ?? 'Unknown',
    productId: raw.product_id,
    customerId: raw.customer_id,
    customerEmail: raw.customer?.email ?? '',
    amount: parseFloat(raw.total ?? raw.amount ?? 0),
    status: raw.status,
    type: raw.order_type ?? 'initial',  // 'initial' | 'upsell' | 'downsell' | 'rebill'
    utmSource: raw.utm_source ?? null,
    utmMedium: raw.utm_medium ?? null,
    utmCampaign: raw.utm_campaign ?? null,
    createdAt: raw.created_at,
  };
}
