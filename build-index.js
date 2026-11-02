require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { VERSION, getSignature } = require('./lib/signature');

const STORE = (process.env.SHOPIFY_STORE || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
const TOKEN = process.env.SHOPIFY_ADMIN_ACCESS_TOKEN;
const API_VERSION = process.env.SHOPIFY_API_VERSION || '2026-10';

// featuredMedia replaces the deprecated Product.images / featuredImage
const QUERY = `
query Products($cursor: String) {
  products(first: 100, after: $cursor, query: "status:active") {
    nodes {
      handle
      title
      isGiftCard
      onlineStoreUrl
      priceRangeV2 { minVariantPrice { amount currencyCode } }
      featuredMedia { preview { image { url } } }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

async function gql(variables) {
  const res = await fetch(`https://${STORE}/admin/api/${API_VERSION}/graphql.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Shopify-Access-Token': TOKEN },
    body: JSON.stringify({ query: QUERY, variables })
  });
  if (!res.ok) throw new Error(`Shopify returned HTTP ${res.status} (check SHOPIFY_STORE, token and read_products scope)`);
  const json = await res.json();
  if (json.errors) throw new Error(JSON.stringify(json.errors));
  return json.data.products;
}

function sized(url, width) {
  const u = new URL(url);
  u.searchParams.set('width', String(width));
  return u.toString();
}

async function main() {
  if (!STORE || !TOKEN) throw new Error('Set SHOPIFY_STORE and SHOPIFY_ADMIN_ACCESS_TOKEN in .env');

  const products = [];
  let cursor = null;
  do {
    const page = await gql({ cursor });
    products.push(...page.nodes);
    cursor = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (cursor);

  const items = [];
  for (const p of products) {
    const img = p.featuredMedia && p.featuredMedia.preview && p.featuredMedia.preview.image;
    if (p.isGiftCard || !p.onlineStoreUrl || !img) { console.log('Skipped:', p.handle); continue; }   // gift cards / not on Online Store / no image
    try {
      const r = await fetch(sized(img.url, 256));
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const sig = await getSignature(await r.buffer());
      const price = p.priceRangeV2.minVariantPrice;
      items.push({
        handle: p.handle,
        title: p.title,
        image: sized(img.url, 400),
        price: price.amount,
        currency: price.currencyCode,
        sig
      });
      console.log('Indexed:', p.handle);
    } catch (e) {
      console.log('Failed :', p.handle, e.message);
    }
  }

  fs.writeFileSync(path.join(__dirname, 'search-index.json'),
    JSON.stringify({ version: VERSION, builtAt: new Date().toISOString(), items }));
  console.log(`\nDone. Indexed ${items.length} of ${products.length} products.`);
}

main().catch((err) => { console.error(err.message || err); process.exit(1); });
