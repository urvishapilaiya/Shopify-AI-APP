const express = require('express');
const router = express.Router();

const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

// ---- CORS (storefront origin only) ----
function allowedOrigins() {
  const list = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length && process.env.SHOPIFY_STORE) {
    list.push('https://' + process.env.SHOPIFY_STORE.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  }
  return list;
}
router.use('/api/track-order', (req, res, next) => {
  const origin = req.headers.origin;
  const allow = allowedOrigins();
  if (origin && (allow.includes('*') || allow.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- tiny in-memory rate limit: 10 requests / minute / IP (stops order-number guessing) ----
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  arr.push(now);
  hits.set(req.ip, arr);
  if (arr.length > 10) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
  next();
}

const QUERY = `
query($q: String!) {
  orders(first: 1, query: $q) {
    nodes {
      name email createdAt cancelledAt
      displayFulfillmentStatus
      lineItems(first: 20) { nodes { title quantity image { url(transform: {maxWidth: 96}) } } }
      fulfillments { displayStatus deliveredAt estimatedDeliveryAt
        trackingInfo { company number url } }
    }
  }
}`;

router.post('/api/track-order', express.json({ limit: '2kb' }), rateLimit, async (req, res) => {
  const generic = 'We could not find an order matching those details.';
  try {
    const num = String((req.body && req.body.order) || '').replace(/[^0-9A-Za-z-]/g, '');
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    if (!num || !email) return res.status(400).json({ error: 'Order number and email are required.' });

    const store = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
    const r = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': process.env.SHOPIFY_ADMIN_ACCESS_TOKEN },
      body: JSON.stringify({ query: QUERY, variables: { q: `name:#${num}` } })
    });
    const json = await r.json();
    if (json.errors) { console.error('[order-tracking]', JSON.stringify(json.errors)); return res.status(502).json({ error: 'Order lookup is temporarily unavailable.' }); }

    const o = json.data.orders.nodes[0];
    // Same message for "no order" and "wrong email" so emails can't be probed.
    if (!o || !o.email || o.email.toLowerCase() !== email) return res.status(404).json({ error: generic });

    const fulfs = o.fulfillments || [];
    const delivered = fulfs.length && fulfs.every((f) => f.displayStatus === 'DELIVERED');
    const shipped = fulfs.length > 0;
    const stage = delivered ? 3 : shipped ? 2 : o.displayFulfillmentStatus === 'IN_PROGRESS' || o.displayFulfillmentStatus === 'ON_HOLD' ? 1 : 0;
    const labels = ['Order placed', 'Being prepared', 'Shipped', 'Delivered'];

    res.json({
      name: o.name,
      createdAt: o.createdAt,
      cancelled: !!o.cancelledAt,
      stage,
      statusLabel: labels[stage],
      items: o.lineItems.nodes.map((i) => ({ title: i.title, quantity: i.quantity, image: i.image && i.image.url })),
      shipments: fulfs.flatMap((f) => (f.trackingInfo.length ? f.trackingInfo : [{}]).map((t) => ({
        company: t.company, number: t.number, url: t.url, estimatedDelivery: f.estimatedDeliveryAt
      })))
    });
  } catch (e) {
    console.error('[order-tracking]', e);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

module.exports = router;
