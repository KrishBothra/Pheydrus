#!/usr/bin/env node
/**
 * Pheydrus Analytics — Stripe Sandbox Seeder
 * Run: node seed_stripe.js   (Node 18+)
 */

const STRIPE_KEY = 'sk_test_51TAHtqCW4XbrUQOdm88Z5EQjv0kbFXWi2Cy42jLxFRpQqdjDXbZ8qC28bREDDMSunGSXYOF7grkFTz8qAwOXEveL00Ugcz46nk';

async function post(path, body = {}) {
  const params = new URLSearchParams();
  const flatten = (obj, prefix = '') => {
    for (const [k, v] of Object.entries(obj)) {
      const key = prefix ? `${prefix}[${k}]` : k;
      if (v !== null && v !== undefined && typeof v === 'object') flatten(v, key);
      else if (v !== null && v !== undefined) params.set(key, String(v));
    }
  };
  flatten(body);
  const r = await fetch('https://api.stripe.com' + path, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + STRIPE_KEY, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error?.message || 'HTTP ' + r.status);
  return json;
}

async function get(path, params = {}) {
  const url = new URL('https://api.stripe.com' + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const r = await fetch(url.toString(), { headers: { Authorization: 'Bearer ' + STRIPE_KEY } });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error?.message || 'HTTP ' + r.status);
  return json;
}

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms)  { return new Promise(r => setTimeout(r, ms)); }

// ── Test tokens (Stripe always accepts these in test mode) ────────────────────
// Key insight: tok_visa etc. work as `source` on /v1/charges directly.
// They do NOT work as a source on a customer. That's a different flow.
const TOKENS = ['tok_visa', 'tok_mastercard', 'tok_amex', 'tok_discover'];

const CUSTOMERS = [
  'Marcus Thompson', 'Priya Sharma',   'Jordan Kim',     'Sofia Rodriguez',
  'Daniel Williams', 'Aisha Mohammed', 'Chris Lee',      'Emma Johnson',
  'Liam Brown',      'Nina Patel',     'Tyler Davis',    'Zoe Martinez',
  'Ryan Chen',       'Fatima Hassan',  'Alex Turner',
];

const PRODUCTS = [
  { name: 'Core Program',   amount: 99700  },
  { name: 'VIP Mastermind', amount: 299700 },
  { name: 'Masterclass',    amount: 49700  },
  { name: 'Starter Kit',    amount: 29700  },
];

async function seed() {
  console.log('\n🚀  Pheydrus Stripe Sandbox Seeder\n' + '─'.repeat(42));

  // ── 1. Create customers (no card needed) ──────────────────────────────────
  console.log('\n[1/3] Creating customers…');
  const customers = [];
  for (const name of CUSTOMERS) {
    try {
      const c = await post('/v1/customers', {
        name,
        email: name.toLowerCase().replace(' ', '.') + '@example.com',
      });
      customers.push({ id: c.id, name });
      console.log('  ✓', name);
      await sleep(100);
    } catch (e) { console.error('  ✗', name + ':', e.message); }
  }
  console.log(`\n→ ${customers.length} customers`);
  if (!customers.length) { console.error('❌ No customers — check your STRIPE_KEY.'); process.exit(1); }

  // ── 2. Create 30 charges using tok_* directly as source ───────────────────
  // This is the correct pattern: charge the token, attach customer id for record-keeping.
  // DO NOT try to save the token to the customer object — that requires raw card APIs.
  console.log('\n[2/3] Creating 30 charges…');
  let chargeCount = 0;
  for (let i = 0; i < 30; i++) {
    const product  = pick(PRODUCTS);
    const customer = pick(customers);
    const token    = pick(TOKENS);
    try {
      await post('/v1/charges', {
        amount:      product.amount,
        currency:    'usd',
        source:      token,           // token used directly — correct pattern
        customer:    customer.id,     // links charge to customer for reporting
        description: product.name,
        metadata:    { product: product.name, type: 'One-time' },
      });
      chargeCount++;
      console.log(`  ✓ $${(product.amount / 100).toLocaleString()} · ${product.name} — ${customer.name}`);
    } catch (e) { console.error('  ✗', e.message); }
    await sleep(150);
  }
  console.log(`\n→ ${chargeCount} charges`);

  // ── 3. Subscriptions: use tok_visa to create a card source on the customer,
  //       then subscribe. Note: /v1/customers/{id}/sources accepts tokens fine.
  console.log('\n[3/3] Setting up Monthly Plan + subscriptions…');
  let priceId = null;
  try {
    const prod  = await post('/v1/products', { name: 'Monthly Plan' });
    const price = await post('/v1/prices', {
      product:    prod.id,
      unit_amount: 9700,
      currency:   'usd',
      recurring:  { interval: 'month' },
    });
    priceId = price.id;
    console.log('  ✓ Price:', priceId);
  } catch (e) { console.error('  ✗ Price setup:', e.message); }

  if (priceId) {
    let subCount = 0;
    for (const cust of customers.slice(0, 8)) {
      try {
        // Add a card source to the customer using a token (this IS supported)
        await post(`/v1/customers/${cust.id}/sources`, { source: 'tok_visa' });
        // Now subscribe — Stripe will bill the default source
        await post('/v1/subscriptions', {
          customer:        cust.id,
          'items[0][price]': priceId,
        });
        subCount++;
        console.log('  ✓ subscribed:', cust.name);
      } catch (e) { console.error('  ✗', cust.name + ':', e.message); }
      await sleep(200);
    }
    console.log(`\n→ ${subCount} subscriptions`);
  }

  console.log('\n' + '─'.repeat(42));
  console.log('✅  Done! Refresh your dashboard — no more demo data.\n');
}

seed().catch(err => { console.error('\n❌ Fatal:', err.message); process.exit(1); });