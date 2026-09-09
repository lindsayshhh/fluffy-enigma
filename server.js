import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;

// Overridable so the feed can be pointed at a mirror or a local fixture.
const NEWS_FEED_BASE = process.env.NEWS_FEED_BASE || 'https://news.google.com/rss/search';
const NEWS_CACHE_TTL_MS = 15 * 60 * 1000;
const NEWS_MAX_ITEMS = 8;

const newsCache = new Map();

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

function decodeEntities(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

function tagText(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  const raw = match[1].replace(/^<!\[CDATA\[([\s\S]*?)\]\]>$/, '$1');
  return decodeEntities(raw.replace(/<[^>]+>/g, '')).trim();
}

// Google News puts the outlet in a <source> tag and also suffixes it onto the
// headline as " - Outlet"; strip it so the two aren't shown twice.
function splitHeadline(title, source) {
  if (source && title.endsWith(` - ${source}`)) {
    return title.slice(0, -(source.length + 3)).trim();
  }
  const idx = title.lastIndexOf(' - ');
  if (!source && idx > 20) {
    return title.slice(0, idx).trim();
  }
  return title;
}

function parseFeed(xml) {
  const items = [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
  for (const block of blocks) {
    const source = tagText(block, 'source');
    const title = tagText(block, 'title');
    if (!title) continue;
    items.push({
      title: splitHeadline(title, source),
      url: tagText(block, 'link'),
      source: source || null,
      publishedAt: tagText(block, 'pubDate') || null,
    });
    if (items.length >= NEWS_MAX_ITEMS) break;
  }
  return items;
}

function newsQuery(name, chamber) {
  const role = chamber === 'Senate' ? 'senator' : 'representative';
  return `"${name}" Michigan (${role} OR legislature OR Lansing)`;
}

async function handleNews(req, res, params) {
  const name = (params.get('name') || '').trim();
  const chamber = params.get('chamber') === 'Senate' ? 'Senate' : 'House';

  if (!name || name.length > 80 || !/^[A-Za-z .'\-]+$/.test(name)) {
    return sendJson(res, 400, { error: 'A valid legislator name is required.' });
  }

  const key = `${chamber}:${name}`;
  const cached = newsCache.get(key);
  if (cached && cached.expires > Date.now()) {
    return sendJson(res, 200, cached.data);
  }

  const url = new URL(NEWS_FEED_BASE);
  url.searchParams.set('q', newsQuery(name, chamber));
  url.searchParams.set('hl', 'en-US');
  url.searchParams.set('gl', 'US');
  url.searchParams.set('ceid', 'US:en');

  let upstream;
  try {
    upstream = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { 'User-Agent': 'mi-gop-dashboard/1.0' },
    });
  } catch (err) {
    return sendJson(res, 502, { error: 'Could not reach the news feed.', detail: String(err) });
  }

  if (!upstream.ok) {
    return sendJson(res, 502, { error: `News feed returned ${upstream.status}.` });
  }

  const payload = {
    name,
    items: parseFeed(await upstream.text()),
    fetchedAt: new Date().toISOString(),
  };

  newsCache.set(key, { expires: Date.now() + NEWS_CACHE_TTL_MS, data: payload });
  sendJson(res, 200, payload);
}

function serveStatic(req, res, pathname) {
  let filePath = pathname === '/' ? '/index.html' : pathname;
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

  if (url.pathname === '/api/news') {
    handleNews(req, res, url.searchParams).catch((err) => {
      sendJson(res, 500, { error: 'Unexpected server error.', detail: String(err) });
    });
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`MI GOP Dashboard running at http://localhost:${PORT}`);
});
