// Shared Shopify Admin API helpers (used by order tracking and WhatsApp updates).
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-07';

function storeDomain() {
  return (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
}

// Preferred: SHOPIFY_CLIENT_ID + SHOPIFY_CLIENT_SECRET (Dev Dashboard app) -> token requested
// automatically and cached. Fallback: fixed SHOPIFY_ADMIN_ACCESS_TOKEN.
let cached = { token: null, expires: 0 };
async function getToken(store = storeDomain()) {
  const id = process.env.SHOPIFY_CLIENT_ID, secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!id || !secret) return process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
  if (cached.token && Date.now() < cached.expires) return cached.token;
  const r = await fetch(`https://${store}/admin/oauth/access_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'client_credentials', client_id: id, client_secret: secret })
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error('Token request failed: ' + r.status + ' ' + JSON.stringify(j).slice(0, 200));
  console.log('[shopify] token scopes:', j.scope);
  cached = { token: j.access_token, expires: Date.now() + Math.max(60, (j.expires_in || 86400) - 300) * 1000 };
  return cached.token;
}

async function adminGraphql(query, variables) {
  const store = storeDomain();
  const r = await fetch(`https://${store}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': await getToken(store) },
    body: JSON.stringify({ query, variables })
  });
  const json = await r.json();
  if (!r.ok || json.errors || !json.data) throw new Error('Admin API error: ' + JSON.stringify(json.errors || json).slice(0, 300));
  return json.data;
}

module.exports = { API_VERSION, storeDomain, getToken, adminGraphql };

// Verify a Shopify webhook signature (raw body Buffer + X-Shopify-Hmac-Sha256 header).
const crypto = require('crypto');
function verifyWebhook(raw, header) {
  const secret = process.env.SHOPIFY_CLIENT_SECRET;
  if (!secret || !header) return false;
  const digest = crypto.createHmac('sha256', secret).update(raw).digest('base64');
  const a = Buffer.from(digest), b = Buffer.from(header);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
module.exports.verifyWebhook = verifyWebhook;
