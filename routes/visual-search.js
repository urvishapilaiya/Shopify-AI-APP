const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { VERSION, getSignature, similarity } = require('../lib/signature');

const router = express.Router();

// ---------- index ----------
const INDEX_PATH = path.join(__dirname, '..', 'search-index.json');   // (was routes/search-index.json = wrong folder)
let items = [];
let indexProblem = null;

function loadIndex() {
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    if (!data || data.version !== VERSION || !Array.isArray(data.items)) {
      indexProblem = 'search-index.json is from the old version. Run: node build-index.js';
      items = [];
    } else {
      items = data.items;
      indexProblem = null;
    }
  } catch (e) {
    indexProblem = 'search-index.json missing/unreadable. Run: node build-index.js';
    items = [];
  }
  console.log(indexProblem ? `[visual-search] ${indexProblem}` : `[visual-search] Loaded ${items.length} products`);
}
loadIndex();

// ---------- CORS (the storefront is on a different origin than this backend) ----------
function allowedOrigins() {
  const list = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!list.length && process.env.SHOPIFY_STORE) {
    list.push('https://' + process.env.SHOPIFY_STORE.replace(/^https?:\/\//, '').replace(/\/$/, ''));
  }
  return list;
}
router.use((req, res, next) => {
  const origin = req.headers.origin;
  const allow = allowedOrigins();
  if (origin && (allow.includes('*') || allow.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// ---------- tiny rate limit (public endpoint that runs image processing) ----------
const hits = new Map();
function rateLimit(req, res, next) {
  const now = Date.now();
  const key = req.ip;
  const recent = (hits.get(key) || []).filter((t) => now - t < 60000);
  if (recent.length >= 20) return res.status(429).json({ error: 'Too many searches, try again in a minute.' });
  recent.push(now);
  hits.set(key, recent);
  next();
}
setInterval(() => hits.clear(), 10 * 60 * 1000).unref();

// ---------- upload ----------
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype))
});

const MIN_SCORE = parseFloat(process.env.MIN_SCORE || '0.35');

router.post('/api/visual-search', rateLimit, upload.single('image'), async (req, res) => {
  if (indexProblem) return res.status(503).json({ error: indexProblem });
  if (!req.file) return res.status(400).json({ error: 'No image uploaded (JPG/PNG/WebP).' });

  let querySig;
  try {
    querySig = await getSignature(req.file.buffer);
  } catch (err) {
    console.error('[visual-search] decode failed:', err.message);
    return res.status(400).json({ error: 'Could not read that image. Try a JPG or PNG.' });
  }

  const results = items
    .map(({ sig, ...item }) => ({ ...item, score: similarity(querySig, sig) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .filter((r) => r.score >= MIN_SCORE);

  res.json({ results });
});

router.get('/api/index-status', (_req, res) => {
  res.json({ indexed: items.length, problem: indexProblem });
});

// multer errors (file too large etc.) -> clean JSON instead of an HTML 500
router.use((err, _req, res, _next) => {
  if (err instanceof multer.MulterError) {
    return res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'Image is too large (max 6 MB).' : err.message
    });
  }
  console.error('[visual-search]', err);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = router;
