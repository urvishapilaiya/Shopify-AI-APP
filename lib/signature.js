// Shared by build-index.js (catalog images) and routes/visual-search.js (uploaded photo).
// Both MUST use the same code, otherwise scores are meaningless.
const sharp = require('sharp');

const VERSION = 2;
const BINS = 4;   // 4 x 4 x 4 colour histogram  -> 64 numbers
const GRID = 6;   // 6 x 6 layout grid (RGB)      -> 108 numbers

// Decode ANY image (JPG, PNG with alpha, WebP, grayscale, phone photo with EXIF
// rotation) into exactly 3 channels (RGB). The old code assumed 3 channels, so
// PNG/RGBA images produced NaN scores and "No similar products found".
async function rgb(buffer, w, h) {
  const { data, info } = await sharp(buffer, { failOn: 'none' })
    .rotate()                              // respect EXIF orientation
    .flatten({ background: '#ffffff' })    // transparent -> white
    .resize(w, h, { fit: 'fill' })
    .toColourspace('srgb')
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (info.channels !== 3) throw new Error('Unexpected channel count: ' + info.channels);
  return data;
}

async function getSignature(buffer) {
  // 1) Colour histogram of the product itself (near-white background ignored)
  const small = await rgb(buffer, 32, 32);
  const hist = new Array(BINS * BINS * BINS).fill(0);
  let fg = 0;
  for (let i = 0; i < small.length; i += 3) {
    const r = small[i], g = small[i + 1], b = small[i + 2];
    if (r > 235 && g > 235 && b > 235) continue;       // background
    const bin = (Math.floor(r / 64) * BINS + Math.floor(g / 64)) * BINS + Math.floor(b / 64);
    hist[bin]++; fg++;
  }
  if (fg < 20) {                                       // image is (almost) all white: use everything
    hist.fill(0); fg = 0;
    for (let i = 0; i < small.length; i += 3) {
      const bin = (Math.floor(small[i] / 64) * BINS + Math.floor(small[i + 1] / 64)) * BINS + Math.floor(small[i + 2] / 64);
      hist[bin]++; fg++;
    }
  }
  const histN = hist.map((v) => Math.sqrt(v / fg));    // Hellinger: dot product = similarity (0..1)

  // 2) Coarse layout (where the colours sit in the picture)
  const g = await rgb(buffer, GRID, GRID);
  const grid = Array.from(g, (v) => v / 255);
  const mean = grid.reduce((a, b) => a + b, 0) / grid.length;
  const centred = grid.map((v) => v - mean);
  const norm = Math.sqrt(centred.reduce((a, b) => a + b * b, 0)) || 1;
  const gridN = centred.map((v) => +(v / norm).toFixed(4));

  // 3) Shape: 64-bit difference hash on grayscale 9x8
  const gray = await sharp(buffer, { failOn: 'none' })
    .rotate().flatten({ background: '#ffffff' })
    .resize(9, 8, { fit: 'fill' }).greyscale().raw().toBuffer();
  let bits = '';
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += gray[y * 9 + x] > gray[y * 9 + x + 1] ? '1' : '0';

  return { v: VERSION, hist: histN.map((v) => +v.toFixed(4)), grid: gridN, hash: bits };
}

function similarity(a, b) {
  let color = 0;
  for (let i = 0; i < a.hist.length; i++) color += a.hist[i] * b.hist[i];
  let layout = 0;
  for (let i = 0; i < a.grid.length; i++) layout += a.grid[i] * b.grid[i];
  layout = Math.max(0, layout);
  let diff = 0;
  for (let i = 0; i < 64; i++) if (a.hash[i] !== b.hash[i]) diff++;
  const shape = Math.max(0, (1 - diff / 64 - 0.5) * 2);
  return 0.55 * color + 0.25 * layout + 0.2 * shape;
}

module.exports = { VERSION, getSignature, similarity };
