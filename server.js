import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;

// Free, keyless ADS-B aggregators (community-run tar1090/readsb forks).
// OpenSky's anonymous REST API has become increasingly unreliable
// (aggressive rate limits, pushing users toward registered OAuth clients),
// so we use these instead — adsb.lol as a fallback if airplanes.live errors.
const PROVIDERS = [
  { name: 'airplanes.live', urlFor: (lat, lon, radiusNm) => `https://api.airplanes.live/v2/point/${lat}/${lon}/${radiusNm}` },
  { name: 'adsb.lol', urlFor: (lat, lon, radiusNm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}` },
];

const EARTH_RADIUS_KM = 6371;
const KM_PER_NM = 1.852;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Simple in-memory cache so nearby/rapid requests don't hammer the upstream API.
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

function rowToState(ac, lat, lon) {
  if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return null;
  const onGround = ac.alt_baro === 'ground';
  const altitudeFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
  return {
    icao24: ac.hex,
    callsign: (ac.flight || '').trim() || null,
    aircraftType: ac.t || null,
    registration: ac.r || null,
    latitude: ac.lat,
    longitude: ac.lon,
    altitudeFt,
    onGround,
    speedKmh: typeof ac.gs === 'number' ? ac.gs * KM_PER_NM : null,
    heading: typeof ac.track === 'number' ? ac.track : null,
    verticalRateFtMin: typeof ac.baro_rate === 'number' ? ac.baro_rate : null,
    squawk: ac.squawk || null,
    distanceKm: haversineKm(lat, lon, ac.lat, ac.lon),
  };
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

async function fetchFromProvider(provider, lat, lon, radiusNm) {
  const url = provider.urlFor(lat.toFixed(4), lon.toFixed(4), radiusNm);
  const res = await fetch(url, {
    signal: AbortSignal.timeout(10000),
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`${provider.name} returned ${res.status}`);
  }
  const json = await res.json();
  return Array.isArray(json.ac) ? json.ac : [];
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

  const radiusNm = Math.min(Math.round(radiusKm / KM_PER_NM), 250);

  let aircraft = null;
  let usedProvider = null;
  let lastError = null;

  for (const provider of PROVIDERS) {
    try {
      aircraft = await fetchFromProvider(provider, lat, lon, radiusNm);
      usedProvider = provider.name;
      break;
    } catch (err) {
      lastError = err;
    }
  }

  if (aircraft === null) {
    return sendJson(res, 502, {
      error: 'Could not reach any flight data provider.',
      detail: String(lastError),
    });
  }

  const states = aircraft
    .map((ac) => rowToState(ac, lat, lon))
    .filter((s) => s && !s.onGround);

  states.sort((a, b) => a.distanceKm - b.distanceKm);

  const payload = {
    queried: { lat, lon, radiusKm },
    provider: usedProvider,
    count: states.length,
    nearest: states[0] || null,
    nearby: states.slice(0, 5),
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
