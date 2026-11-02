// Back-in-stock alerts: storefront sign-up -> stored -> Shopify inventory webhook -> email.
const express = require('express');
const crypto = require('crypto');
const { adminGraphql, verifyWebhook } = require('../lib/shopify');
const db = require('../lib/store');
const { sendMail } = require('../lib/mailer');

const router = express.Router();
const FILE = 'back-in-stock';
const MAX_SUBS = 5000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = () => (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const storeUrl = () => (process.env.STORE_URL || 'https://' + store()).replace(/\/$/, '');
const secret = () => process.env.BIS_SECRET || process.env.SHOPIFY_CLIENT_SECRET || 'change-me';
const sign = (email, variant) => crypto.createHmac('sha256', secret()).update(email + '|' + variant).digest('hex').slice(0, 32);

// ---- CORS (storefront only) ----
function allowedOrigins() {
  const list = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length && store()) list.push('https://' + store());
  return list;
}
router.use('/api/back-in-stock', (req, res, next) => {
  const origin = req.headers.origin, allow = allowedOrigins();
  if (origin && (allow.includes('*') || allow.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---- 5 sign-ups / minute / IP ----
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const arr = (hits.get(req.ip) || []).filter((t) => now - t < 60000);
  arr.push(now); hits.set(req.ip, arr);
  if (arr.length > 5) return res.status(429).json({ error: 'Too many attempts. Please wait a minute.' });
  next();
}

const VARIANT_Q = `query($id: ID!) { productVariant(id: $id) { id title availableForSale product { title handle } } }`;
const ITEM_Q = `query($id: ID!) { inventoryItem(id: $id) { variant { id title availableForSale product { title handle } } } }`;
const numId = (gid) => String(gid).split('/').pop();

// ---------- sign up ----------
router.post('/api/back-in-stock', express.json({ limit: '2kb' }), rateLimit, async (req, res) => {
  try {
    const email = String((req.body && req.body.email) || '').trim().toLowerCase();
    const variantId = String((req.body && req.body.variantId) || '').replace(/\D/g, '');
    if (!EMAIL_RE.test(email) || email.length > 254) return res.status(400).json({ error: 'Please enter a valid email.' });
    if (!variantId) return res.status(400).json({ error: 'Please choose an option.' });

    const data = await adminGraphql(VARIANT_Q, { id: `gid://shopify/ProductVariant/${variantId}` });
    const v = data.productVariant;
    if (!v) return res.status(404).json({ error: 'That product option was not found.' });
    if (v.availableForSale) return res.json({ ok: true, inStock: true });

    const subs = db.read(FILE, []);
    if (!subs.some((s) => s.email === email && s.variantId === variantId)) {
      if (subs.length >= MAX_SUBS) return res.status(503).json({ error: 'Sign-ups are temporarily full.' });
      subs.push({ email, variantId, createdAt: new Date().toISOString() });
      db.write(FILE, subs);
    }
    res.json({ ok: true });
  } catch (e) {
    console.error('[back-in-stock]', e.message);
    res.status(500).json({ error: 'Something went wrong. Please try again.' });
  }
});

// ---------- unsubscribe link in emails ----------
router.get('/api/back-in-stock/unsubscribe', (req, res) => {
  const email = String(req.query.e || ''), variant = String(req.query.v || ''), t = String(req.query.t || '');
  const ok = t.length === 32 && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(sign(email, variant)));
  if (ok) db.write(FILE, db.read(FILE, []).filter((s) => !(s.email === email && s.variantId === variant)));
  res.type('html').send(ok ? '<p>You will no longer get this alert.</p>' : '<p>This link is not valid.</p>');
});

// ---------- restock webhook ----------
const seen = new Map();
function firstTime(id) {
  const now = Date.now();
  for (const [k, t] of seen) if (now - t > 24 * 3600 * 1000) seen.delete(k);
  if (!id || seen.has(id)) return false;
  seen.set(id, now);
  return true;
}

async function processRestock(inventoryItemId) {
  const data = await adminGraphql(ITEM_Q, { id: `gid://shopify/InventoryItem/${inventoryItemId}` });
  const v = data.inventoryItem && data.inventoryItem.variant;
  if (!v || !v.availableForSale) return;
  const vid = numId(v.id);
  const waiting = db.read(FILE, []).filter((s) => s.variantId === vid);
  if (!waiting.length) return;

  const base = (process.env.BACKEND_PUBLIC_URL || '').replace(/\/$/, '');
  const link = `${storeUrl()}/products/${encodeURIComponent(v.product.handle)}`;
  const name = v.title && v.title !== 'Default Title' ? `${v.product.title} (${v.title})` : v.product.title;
  const sent = [];

  for (const s of waiting) {
    const unsub = base ? `${base}/api/back-in-stock/unsubscribe?e=${encodeURIComponent(s.email)}&v=${vid}&t=${sign(s.email, vid)}` : '';
    try {
      await sendMail({
        to: s.email,
        subject: `Back in stock: ${v.product.title}`,
        text: `Good news! ${name} is back in stock.\n\nBuy it here: ${link}\n` + (unsub ? `\nStop these alerts: ${unsub}\n` : ''),
        html: `<p>Good news! <strong>${esc(name)}</strong> is back in stock.</p><p><a href="${esc(link)}">Buy it now</a></p>` +
              (unsub ? `<p style="font-size:12px;color:#777"><a href="${esc(unsub)}">Stop these alerts</a></p>` : '')
      });
      sent.push(s);
    } catch (e) {
      console.error('[back-in-stock] mail failed for a subscriber:', e.message); // stays subscribed, retried on next restock
    }
  }
  if (sent.length) {
    db.write(FILE, db.read(FILE, []).filter((s) => !sent.some((x) => x.email === s.email && x.variantId === s.variantId)));
    console.log(`[back-in-stock] notified ${sent.length} for ${v.product.title}`);
  }
}

router.post('/webhooks/inventory', express.raw({ type: '*/*', limit: '1mb' }), (req, res) => {
  if (!verifyWebhook(req.body, req.get('x-shopify-hmac-sha256'))) return res.sendStatus(401);
  res.sendStatus(200);
  if (!firstTime(req.get('x-shopify-webhook-id'))) return;
  let p;
  try { p = JSON.parse(req.body.toString('utf8')); } catch (e) { return; }
  if (!p.inventory_item_id || !(Number(p.available) > 0)) return;
  processRestock(p.inventory_item_id).catch((e) => console.error('[back-in-stock]', e.message));
});

module.exports = router;
