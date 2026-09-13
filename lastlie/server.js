import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset, loadCurated, loadLive, meta } from './dataset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3100;

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
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
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
    res.writeHead(200, { 'Content-Type': MIME_TYPES[path.extname(resolved)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (url.pathname.startsWith('/api/')) {
    handleApi(url).then(
      ({ status, body }) => sendJson(res, status, body),
      (err) => sendJson(res, 500, { error: 'Unexpected server error.', detail: String(err) }),
    );
    return;
  }

  serveStatic(req, res, url.pathname);
});

async function handleApi(url) {
  // Skipping the live lookup keeps the curated list servable when the API is
  // slow, blocked, or unkeyed.
  const live = url.searchParams.get('live') !== '0';

  if (url.pathname === '/api/latest') {
    const data = await loadDataset({ live });
    return { status: 200, body: { ...meta(data), latest: data.entries[0] || null } };
  }

  if (url.pathname === '/api/lies') {
    const data = await loadDataset({ live });
    return { status: 200, body: { ...meta(data), entries: data.entries } };
  }

  // Reports what the upstream actually returned and why claims were dropped —
  // the fastest way to tell a bad key from an over-narrow rating allowlist.
  if (url.pathname === '/api/debug') {
    const result = await loadLive({ force: true });
    return {
      status: 200,
      body: {
        keyPresent: Boolean(process.env.FACTCHECK_API_KEY),
        query: process.env.FACTCHECK_QUERY || 'Donald Trump',
        claimant: process.env.FACTCHECK_CLAIMANT || 'Trump',
        ok: result.ok,
        reason: result.reason,
        claimsReceived: result.received ?? null,
        entriesKept: (result.entries || []).length,
        skipped: result.skipped,
        sample: (result.entries || []).slice(0, 3),
        curatedCount: loadCurated().entries.length,
      },
    };
  }

  return { status: 404, body: { error: 'Not found.' } };
}

// Fail loudly at boot on a malformed curated file rather than serving a broken
// page. The live lookup is deliberately not awaited here: the site must start
// even when the API is unreachable.
loadCurated();

server.listen(PORT, () => {
  console.log(`The Last Lie running at http://localhost:${PORT}`);
});
