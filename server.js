import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const EARTH_RADIUS_KM = 6371;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Simple in-memory cache so nearby/rapid requests don't hammer OpenSky's
// generously-but-not-infinitely rate-limited anonymous API.
const CACHE_TTL_MS = 8000;
let cache = { key: null, expires: 0, data: null };

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

function boundingBox(lat, lon, radiusKm) {
  const latDelta = radiusKm / 111;
  const lonDelta = radiusKm / (111 * Math.cos(toRad(lat)) || 1);
  return {
    lamin: lat - latDelta,
    lamax: lat + latDelta,
    lomin: lon - lonDelta,
    lomax: lon + lonDelta,
  };
}

const STATE_FIELDS = [
  'icao24', 'callsign', 'originCountry', 'timePosition', 'lastContact',
  'longitude', 'latitude', 'baroAltitude', 'onGround', 'velocity',
  'trueTrack', 'verticalRate', 'sensors', 'geoAltitude', 'squawk',
  'spi', 'positionSource', 'category',
];

function rowToState(row) {
  const state = {};
  STATE_FIELDS.forEach((field, i) => {
    state[field] = row[i];
  });
  return state;
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function handleOverhead(req, res, query) {
  const latParam = query.get('lat');
  const lonParam = query.get('lon');
  const lat = latParam === null || latParam === '' ? NaN : Number(latParam);
  const lon = lonParam === null || lonParam === '' ? NaN : Number(lonParam);
  const radiusKm = Math.min(Math.max(Number(query.get('radius')) || 60, 5), 250);

  if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    return sendJson(res, 400, { error: 'Valid lat and lon query parameters are required.' });
  }

  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)},${radiusKm}`;
  const now = Date.now();

  if (cache.key === cacheKey && cache.expires > now) {
    return sendJson(res, 200, cache.data);
  }

  const bbox = boundingBox(lat, lon, radiusKm);
  const upstreamUrl = new URL(OPENSKY_URL);
  upstreamUrl.searchParams.set('lamin', bbox.lamin.toFixed(4));
  upstreamUrl.searchParams.set('lamax', bbox.lamax.toFixed(4));
  upstreamUrl.searchParams.set('lomin', bbox.lomin.toFixed(4));
  upstreamUrl.searchParams.set('lomax', bbox.lomax.toFixed(4));

  let upstream;
  try {
    upstream = await fetch(upstreamUrl, { signal: AbortSignal.timeout(10000) });
  } catch (err) {
    return sendJson(res, 502, { error: 'Could not reach OpenSky Network.', detail: String(err) });
  }

  if (upstream.status === 429) {
    return sendJson(res, 429, { error: 'OpenSky rate limit reached. Try again shortly.' });
  }
  if (!upstream.ok) {
    return sendJson(res, 502, { error: `OpenSky returned ${upstream.status}.` });
  }

  const json = await upstream.json();
  const rows = json.states || [];
  const states = rows.map(rowToState).filter((s) => s.latitude != null && s.longitude != null && !s.onGround);

  const withDistance = states.map((s) => ({
    ...s,
    distanceKm: haversineKm(lat, lon, s.latitude, s.longitude),
  }));

  withDistance.sort((a, b) => a.distanceKm - b.distanceKm);

  const payload = {
    queried: { lat, lon, radiusKm },
    count: withDistance.length,
    nearest: withDistance[0] || null,
    nearby: withDistance.slice(0, 5),
    fetchedAt: new Date().toISOString(),
  };

  cache = { key: cacheKey, expires: now + CACHE_TTL_MS, data: payload };
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

  if (url.pathname === '/api/overhead') {
    handleOverhead(req, res, url.searchParams).catch((err) => {
      sendJson(res, 500, { error: 'Unexpected server error.', detail: String(err) });
    });
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Overhead widget running at http://localhost:${PORT}`);
});
