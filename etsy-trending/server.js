import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;

// Etsy Open API v3. Get a keystring and shared secret by registering an app
// at https://www.etsy.com/developers/your-apps. Etsy expects the x-api-key
// header as "keystring:shared_secret"; older apps accept the bare keystring,
// so the secret is optional here.
const ETSY_API_KEY = process.env.ETSY_API_KEY || '';
const ETSY_SHARED_SECRET = process.env.ETSY_SHARED_SECRET || '';
const ETSY_API_BASE = process.env.ETSY_API_BASE || 'https://openapi.etsy.com/v3/application';
const X_API_KEY = ETSY_SHARED_SECRET ? `${ETSY_API_KEY}:${ETSY_SHARED_SECRET}` : ETSY_API_KEY;

// Etsy has no "trending" endpoint, so trending is derived: take the listings
// Etsy itself ranks highest for a search, then rank those by how fast they
// collect favorites (favorites per day since first listed). Two pages keeps
// the pool meaningful while staying well inside Etsy's rate limits.
const POOL_PAGES = 2;
const PAGE_SIZE = 100;
const MS_PER_DAY = 86_400_000;

// Trending moves slowly and Etsy caps calls per day, so cache per search.
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function etsyGet(pathAndQuery) {
  const res = await fetch(`${ETSY_API_BASE}${pathAndQuery}`, {
    signal: AbortSignal.timeout(15000),
    headers: { accept: 'application/json', 'x-api-key': X_API_KEY },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    const err = new Error(`Etsy returned ${res.status}: ${body.slice(0, 200)}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

async function fetchPool(keywords) {
  const pages = await Promise.all(
    Array.from({ length: POOL_PAGES }, (_, i) => {
      const q = new URLSearchParams({
        limit: String(PAGE_SIZE),
        offset: String(i * PAGE_SIZE),
        sort_on: 'score',
      });
      if (keywords) q.set('keywords', keywords);
      return etsyGet(`/listings/active?${q}`);
    }),
  );
  const seen = new Set();
  const listings = [];
  for (const page of pages) {
    for (const l of page.results || []) {
      if (!seen.has(l.listing_id)) {
        seen.add(l.listing_id);
        listings.push(l);
      }
    }
  }
  return listings;
}

// The search endpoint omits images and shop names; the batch endpoint takes
// up to 100 ids at a time and can include both.
async function fetchDetails(ids) {
  const details = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const q = new URLSearchParams({ listing_ids: ids.slice(i, i + 100).join(','), includes: 'Images,Shop' });
    const page = await etsyGet(`/listings/batch?${q}`);
    for (const l of page.results || []) details.set(l.listing_id, l);
  }
  return details;
}

function formatPrice(price) {
  if (!price || typeof price.amount !== 'number' || !price.divisor) return null;
  const value = price.amount / price.divisor;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: price.currency_code || 'USD' }).format(value);
  } catch {
    return `${value.toFixed(2)} ${price.currency_code || ''}`.trim();
  }
}

function toItem(listing, detail, now) {
  const listedSec = listing.original_creation_timestamp || listing.creation_timestamp;
  const ageDays = listedSec ? Math.max((now - listedSec * 1000) / MS_PER_DAY, 0) : null;
  const favorites = listing.num_favorers || 0;
  // +2 days of smoothing stops a listing that is an hour old with one
  // favorite from outranking everything.
  const favoritesPerDay = ageDays === null ? 0 : favorites / (ageDays + 2);
  const image = detail?.images?.[0];
  return {
    id: listing.listing_id,
    title: listing.title,
    url: listing.url,
    image: image?.url_570xN || image?.url_fullxfull || null,
    shop: detail?.shop?.shop_name || null,
    price: formatPrice(listing.price),
    favorites,
    ageDays,
    favoritesPerDay,
    tags: listing.tags || [],
  };
}

// Tags from the hottest listings, weighted by each listing's heat, surface
// what shoppers are gravitating to beyond any single item.
function trendingTags(items, limit = 15) {
  const weights = new Map();
  for (const item of items.slice(0, 60)) {
    for (const raw of item.tags) {
      const tag = raw.toLowerCase().trim();
      if (tag) weights.set(tag, (weights.get(tag) || 0) + item.favoritesPerDay);
    }
  }
  return [...weights.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([tag]) => tag);
}

async function handleTrending(res, query) {
  if (!ETSY_API_KEY) {
    return sendJson(res, 503, {
      error: 'missing_key',
      message: 'Set ETSY_API_KEY (and ETSY_SHARED_SECRET) on the server to load Etsy listings.',
    });
  }

  const keywords = (query.get('q') || '').trim().slice(0, 100);
  const cacheKey = keywords.toLowerCase();
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return sendJson(res, 200, cached.data);

  const pool = await fetchPool(keywords);
  const now = Date.now();
  const ranked = pool
    .map((l) => toItem(l, null, now))
    .sort((a, b) => b.favoritesPerDay - a.favoritesPerDay)
    .slice(0, 48);

  const details = await fetchDetails(ranked.map((i) => i.id));
  const byId = new Map(pool.map((l) => [l.listing_id, l]));
  const items = ranked.map((i) => toItem(byId.get(i.id), details.get(i.id), now));

  const data = {
    query: keywords,
    poolSize: pool.length,
    tags: trendingTags(items),
    items,
    fetchedAt: new Date(now).toISOString(),
  };
  cache.set(cacheKey, { expires: now + CACHE_TTL_MS, data });
  sendJson(res, 200, data);
}

function serveStatic(res, pathname) {
  const filePath = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.normalize(path.join(PUBLIC_DIR, filePath));

  if (!resolved.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end('Forbidden');
  }

  fs.readFile(resolved, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      return res.end('Not found');
    }
    const ext = path.extname(resolved);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname === '/api/trending') {
    handleTrending(res, url.searchParams).catch((err) => {
      const status = err.status === 401 || err.status === 403 ? 502 : 500;
      sendJson(res, status, { error: 'etsy_failed', message: err.message || String(err) });
    });
    return;
  }

  serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Etsy Trending running at http://localhost:${PORT}`);
  if (!ETSY_API_KEY) console.log('ETSY_API_KEY is not set; the page will show setup instructions.');
});
