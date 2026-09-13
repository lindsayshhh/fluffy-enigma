import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_FILE = path.join(__dirname, 'data', 'lies.json');

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

// The dataset is hand-maintained, so re-read it whenever the file changes
// instead of at boot only — adding an entry shouldn't need a restart.
let cached = { mtimeMs: -1, data: null };

function loadDataset() {
  const { mtimeMs } = fs.statSync(DATA_FILE);
  if (cached.mtimeMs === mtimeMs) return cached.data;

  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const entries = (parsed.entries || []).map(validateEntry);

  // Newest first, so "the last lie" is entries[0] regardless of file order.
  // Same-day entries keep their file order, which is the order the source
  // fact-check lists them in.
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const data = { ...parsed, entries };
  cached = { mtimeMs, data };
  return data;
}

// A missing source link is the one defect that would turn this site into an
// unsourced accusation, so treat it as fatal rather than rendering a blank.
function validateEntry(entry, i) {
  for (const field of ['date', 'claim', 'reality']) {
    if (!entry?.[field]) throw new Error(`entries[${i}] is missing "${field}"`);
  }
  if (!entry.source?.url || !entry.source?.name) {
    throw new Error(`entries[${i}] is missing a source name and url`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error(`entries[${i}] has date "${entry.date}", expected YYYY-MM-DD`);
  }
  return entry;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

function meta(data) {
  return {
    subject: data.subject,
    updated: data.updated,
    note: data.note,
    total: data.entries.length,
  };
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

  if (url.pathname === '/api/latest') {
    const data = loadDataset();
    return sendJson(res, 200, { ...meta(data), latest: data.entries[0] || null });
  }

  if (url.pathname === '/api/lies') {
    const data = loadDataset();
    return sendJson(res, 200, { ...meta(data), entries: data.entries });
  }

  serveStatic(req, res, url.pathname);
});

// Fail loudly at boot on a malformed dataset rather than serving a broken page.
loadDataset();

server.listen(PORT, () => {
  console.log(`The Last Lie running at http://localhost:${PORT}`);
});
