/**
 * Stripe API Integration
 * REST API — Base URL: https://api.stripe.com/v1
 *
 * Docs: https://stripe.com/docs/api
 *
 * Auth: HTTP Basic with secret key as username, empty password
 *   Authorization: Basic base64(sk_live_xxx:)
 *
 * Required env vars:
 *   STRIPE_SECRET_KEY  - sk_test_... (test) or sk_live_... (production)
 *
 * NOTE: The Stripe API can be called directly from the browser using
 * a PUBLISHABLE key for read-only Stripe.js operations, but for
 * server-side data (charges, customers, subscriptions) you MUST use
 * the secret key from a backend. The dashboard index.html calls the
 * Stripe API directly for demo purposes only — in production, proxy
 * through your backend.
 */

const STRIPE_BASE = 'https://api.stripe.com/v1';

/**
 * Paginated fetch helper — handles Stripe's cursor-based pagination.
 *
 * @param {string} path     - API path e.g. '/charges'
 * @param {string} apiKey   - Stripe secret key
 * @param {Object} params   - Query params
 * @param {number} maxItems - Max total items to retrieve (default 200)
 */
export async function stripeList(path, apiKey, params = {}, maxItems = 200) {
  const results = [];
  let startingAfter = null;

  while (results.length < maxItems) {
    const query = { limit: 100, ...params };
    if (startingAfter) query.starting_after = startingAfter;

    const page = await stripeGet(path, apiKey, query);
    results.push(...page.data);

    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }

  return results;
}

/**
 * Fetch charges for a date range.
 *
 * @param {string} apiKey
 * @param {number} since   - Unix timestamp
 * @param {number} until   - Unix timestamp
 */
export async function fetchStripeCharges(apiKey, since, until) {
  const charges = await stripeList('/charges', apiKey, {
    'created[gte]': since,
    'created[lte]': until,
  });

  return charges
    .filter(c => c.paid && !c.refunded)
    .map(c => ({
      id: c.id,
      amount: c.amount / 100,
      currency: c.currency.toUpperCase(),
      customer: c.billing_details?.name || c.receipt_email || c.customer || 'Unknown',
      description: c.description || c.metadata?.product || 'Charge',
      type: c.metadata?.type || inferType(c),
      utmSource: c.metadata?.utm_source || null,
      utmCampaign: c.metadata?.utm_campaign || null,
      createdAt: c.created,
      date: new Date(c.created * 1000).toLocaleDateString('en-US', { month:'short', day:'numeric' }),
    }));
}

/**
 * Fetch active subscriptions with MRR calculation.
 */
export async function fetchStripeSubscriptions(apiKey) {
  const subs = await stripeList('/subscriptions', apiKey, { status: 'active', expand: ['data.items.data.price'] });

  return subs.map(sub => {
    const item = sub.items?.data?.[0];
    const price = item?.price;
    const amount = price?.unit_amount / 100 || 0;
    const interval = price?.recurring?.interval;

    // Normalize to monthly
    const monthlyAmount = interval === 'year' ? amount / 12
      : interval === 'week' ? amount * 4.33
      : amount;

    return {
      id: sub.id,
      customerId: sub.customer,
      status: sub.status,
      productName: price?.nickname || price?.product || 'Subscription',
      amount,
      interval,
      monthlyAmount,
      currentPeriodEnd: sub.current_period_end,
      createdAt: sub.created,
    };
  });
}

/**
 * Fetch customer list with LTV calculation.
 */
export async function fetchStripeCustomerLTV(apiKey, since) {
  const charges = await fetchStripeCharges(apiKey, since, Math.floor(Date.now() / 1000));

  const ltvMap = {};
  for (const charge of charges) {
    const cid = charge.customer;
    if (!ltvMap[cid]) ltvMap[cid] = { customer: charge.customer, orders: 0, ltv: 0 };
    ltvMap[cid].orders++;
    ltvMap[cid].ltv += charge.amount;
  }

  return Object.values(ltvMap).sort((a, b) => b.ltv - a.ltv);
}

/**
 * Calculate key Stripe KPIs from charges + subscriptions.
 *
 * @param {Array} charges
 * @param {Array} subscriptions
 */
export function calcStripeKPIs(charges, subscriptions) {
  const gmv = charges.reduce((s, c) => s + c.amount, 0);
  const mrr = subscriptions.reduce((s, sub) => s + sub.monthlyAmount, 0);
  const aov = charges.length > 0 ? gmv / charges.length : 0;

  // Daily revenue map
  const dailyMap = {};
  for (const c of charges) {
    const d = new Date(c.createdAt * 1000).toISOString().slice(0, 10);
    dailyMap[d] = (dailyMap[d] || 0) + c.amount;
  }

  // Product breakdown
  const productMap = {};
  for (const c of charges) {
    const name = c.description;
    productMap[name] = (productMap[name] || 0) + c.amount;
  }

  return {
    gmv,
    mrr,
    aov,
    orderCount: charges.length,
    activeSubscriptions: subscriptions.length,
    dailyRevenue: dailyMap,
    topProducts: Object.entries(productMap)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, revenue]) => ({ name, revenue })),
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────

async function stripeGet(path, apiKey, params = {}) {
  const url = new URL(STRIPE_BASE + path);
  Object.entries(params).forEach(([k, v]) => v != null && url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString(), {
    headers: {
      Authorization: 'Basic ' + btoa(apiKey + ':'),
    },
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error?.message || `Stripe API HTTP ${res.status}`);
  }

  return res.json();
}

function inferType(charge) {
  if (charge.invoice) return 'Subscription';
  if (charge.metadata?.upsell) return 'Upsell';
  return 'One-time';
}
