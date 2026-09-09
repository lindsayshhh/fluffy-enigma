import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');

const PORT = process.env.PORT || 3000;

// Free, keyless ADS-B aggregators (community-run tar1090/readsb forks),
// ordered by what actually answers. adsb.fi serves anonymous requests;
// adsb.lol serves them only with a User-Agent naming the project and a way
// to reach its author, which USER_AGENT below supplies.
//
// airplanes.live is deliberately absent: it 403s unregistered callers with
// a note asking you to email contact@airplanes.live describing the project.
// Querying it on every request just buys a guaranteed failure and a wasted
// round trip. Once they grant access, add it back here.
const PROVIDERS = [
  { name: 'adsb.fi', urlFor: (lat, lon, radiusNm) => `https://opendata.adsb.fi/api/v2/lat/${lat}/lon/${lon}/dist/${radiusNm}` },
  { name: 'adsb.lol', urlFor: (lat, lon, radiusNm) => `https://api.adsb.lol/v2/point/${lat}/${lon}/${radiusNm}` },
];

// adsb.lol rejects a generic User-Agent outright. Point CONTACT_URL at
// something that reaches whoever runs this deployment.
const CONTACT_URL = process.env.CONTACT_URL || 'https://github.com/lindsayshhh/fluffy-enigma';
const USER_AGENT = `Overhead/1.0 (+${CONTACT_URL})`;

// ACARS has no keyless equivalent to the ADS-B feeds above. airframes.io
// pools volunteer VHF/VDL2/HFDL/SATCOM receivers and is the only community
// aggregator worth pointing at; it needs an account, so the section stays
// switched off until AIRFRAMES_API_KEY is set. Coverage is inherently
// patchy — an aircraft is only heard where someone is listening — so "no
// recent messages" is a normal result, not a failure.
const ACARS_API_URL = process.env.AIRFRAMES_API_URL || 'https://api.airframes.io/messages';
const ACARS_API_KEY = process.env.AIRFRAMES_API_KEY || '';
const ACARS_CACHE_TTL_MS = 20000;
const ACARS_MAX_MESSAGES = 8;

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

// Bearing from the observer to the aircraft — which way to actually look.
// Computed here rather than read from a provider's own `dir` field, since
// not every feed supplies one.
function bearingDeg(lat1, lon1, lat2, lon2) {
  const dLon = toRad(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function rowToState(ac, lat, lon) {
  if (typeof ac.lat !== 'number' || typeof ac.lon !== 'number') return null;
  const onGround = ac.alt_baro === 'ground';
  const altitudeFt = typeof ac.alt_baro === 'number' ? ac.alt_baro : null;
  const emergency = ac.emergency && ac.emergency !== 'none' ? ac.emergency : null;
  return {
    icao24: ac.hex,
    callsign: (ac.flight || '').trim() || null,
    aircraftType: ac.t || null,
    description: ac.desc || null,
    operator: ac.ownOp || null,
    year: ac.year || null,
    registration: ac.r || null,
    latitude: ac.lat,
    longitude: ac.lon,
    altitudeFt,
    onGround,
    speedKmh: typeof ac.gs === 'number' ? ac.gs * KM_PER_NM : null,
    heading: typeof ac.track === 'number' ? ac.track : null,
    verticalRateFtMin: typeof ac.baro_rate === 'number' ? ac.baro_rate : null,
    squawk: ac.squawk || null,
    emergency,
    distanceKm: haversineKm(lat, lon, ac.lat, ac.lon),
    bearingDeg: bearingDeg(lat, lon, ac.lat, ac.lon),
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
    headers: { accept: 'application/json', 'user-agent': USER_AGENT },
  });
  if (!res.ok) {
    throw new Error(`${provider.name} returned ${res.status}`);
  }
  const json = await res.json();
  const list = extractAircraftArray(json);
  if (list === null) {
    throw new Error(`${provider.name} returned an unrecognized shape (keys: ${Object.keys(json).join(',') || 'none'})`);
  }
  return list;
}

// These feeds are independent forks and don't agree on the wrapper key, so
// treat "no recognized array" as a failure worth reporting rather than
// letting a missing key quietly read as zero aircraft.
function extractAircraftArray(json) {
  if (Array.isArray(json)) return json;
  for (const key of ['ac', 'aircraft', 'states', 'data', 'results']) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  return null;
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
  const debug = query.get('debug') === '1';

  if (!debug && cache.key === cacheKey && cache.expires > now) {
    return sendJson(res, 200, cache.data);
  }

  const radiusNm = Math.min(Math.round(radiusKm / KM_PER_NM), 250);

  // Probes every provider and reports what each actually sent back, so a
  // shape mismatch can be read off directly instead of inferred from a
  // zero count.
  if (debug) {
    const probes = [];
    for (const provider of PROVIDERS) {
      const url = provider.urlFor(lat.toFixed(4), lon.toFixed(4), radiusNm);
      try {
        const probeRes = await fetch(url, {
          signal: AbortSignal.timeout(10000),
          headers: { accept: 'application/json', 'user-agent': USER_AGENT },
        });
        const body = await probeRes.text();
        let topLevelKeys = null;
        let arrayKey = null;
        let sample = null;
        try {
          const parsed = JSON.parse(body);
          topLevelKeys = Array.isArray(parsed) ? '(bare array)' : Object.keys(parsed);
          const list = extractAircraftArray(parsed);
          arrayKey = list === null ? null : 'recognized';
          if (list && list.length) sample = list[0];
        } catch {
          topLevelKeys = '(not JSON)';
        }
        probes.push({
          provider: provider.name,
          url,
          status: probeRes.status,
          topLevelKeys,
          recognizedArray: arrayKey !== null,
          firstAircraft: sample,
          bodyPreview: body.slice(0, 400),
        });
      } catch (err) {
        probes.push({ provider: provider.name, url, error: String(err) });
      }
    }
    return sendJson(res, 200, { debug: true, queried: { lat, lon, radiusKm, radiusNm }, probes });
  }

  let aircraft = null;
  let usedProvider = null;
  const failures = [];

  for (const provider of PROVIDERS) {
    try {
      aircraft = await fetchFromProvider(provider, lat, lon, radiusNm);
      usedProvider = provider.name;
      break;
    } catch (err) {
      failures.push({ provider: provider.name, reason: err.message || String(err) });
    }
  }

  if (aircraft === null) {
    return sendJson(res, 502, {
      error: 'Could not reach any flight data provider.',
      failures,
    });
  }

  const states = aircraft
    .map((ac) => rowToState(ac, lat, lon))
    .filter((s) => s && !s.onGround);

  states.sort((a, b) => a.distanceKm - b.distanceKm);

  const payload = {
    queried: { lat, lon, radiusKm },
    provider: usedProvider,
    providerFailures: failures,
    count: states.length,
    nearest: states[0] || null,
    nearby: states.slice(0, 5),
    fetchedAt: new Date().toISOString(),
  };

  cache = { key: cacheKey, expires: now + CACHE_TTL_MS, data: payload };
  sendJson(res, 200, payload);
}

let acarsCache = { key: null, expires: 0, data: null };

function pick(obj, keys) {
  for (const key of keys) {
    const value = obj[key];
    if (value !== undefined && value !== null && value !== '') return value;
  }
  return null;
}

// The upstream field names aren't pinned down here, so read each field from
// the first key that's actually present rather than assuming one spelling.
function normalizeAcarsMessage(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const text = pick(raw, ['text', 'message_text', 'msg_text', 'message', 'data']);
  const timestamp = pick(raw, ['timestamp', 'time', 'created_at', 'received_at', 't']);
  return {
    timestamp: typeof timestamp === 'number' && timestamp < 1e12 ? timestamp * 1000 : timestamp,
    label: pick(raw, ['label', 'msg_label']),
    text: typeof text === 'string' ? text : text == null ? null : JSON.stringify(text),
    flight: pick(raw, ['flight', 'callsign', 'flight_number']),
    registration: pick(raw, ['tail', 'registration', 'reg']),
    station: pick(raw, ['station_id', 'station', 'ground_station', 'source']),
    link: pick(raw, ['link_type', 'type', 'app_name', 'channel']),
  };
}

function extractMessageArray(json) {
  if (Array.isArray(json)) return json;
  for (const key of ['messages', 'data', 'results', 'items']) {
    if (Array.isArray(json?.[key])) return json[key];
  }
  return null;
}

async function handleAcars(req, res, query) {
  const flight = (query.get('flight') || '').trim();
  const reg = (query.get('reg') || '').trim();
  const debug = query.get('debug') === '1';

  if (!flight && !reg) {
    return sendJson(res, 400, { error: 'A flight callsign or registration is required.' });
  }

  if (!ACARS_API_KEY) {
    return sendJson(res, 200, {
      configured: false,
      messages: [],
      note: 'Set AIRFRAMES_API_KEY to enable ACARS lookups.',
    });
  }

  const cacheKey = `${flight}|${reg}`;
  const now = Date.now();
  if (!debug && acarsCache.key === cacheKey && acarsCache.expires > now) {
    return sendJson(res, 200, acarsCache.data);
  }

  const url = new URL(ACARS_API_URL);
  if (flight) url.searchParams.set('flight', flight);
  if (reg) url.searchParams.set('registration', reg);
  url.searchParams.set('limit', String(ACARS_MAX_MESSAGES));

  let upstream;
  try {
    upstream = await fetch(url, {
      signal: AbortSignal.timeout(10000),
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, authorization: `Bearer ${ACARS_API_KEY}` },
    });
  } catch (err) {
    return sendJson(res, 502, { configured: true, error: 'Could not reach the ACARS provider.', detail: String(err) });
  }

  if (!upstream.ok) {
    return sendJson(res, 502, { configured: true, error: `ACARS provider returned ${upstream.status}.` });
  }

  const json = await upstream.json();
  const rawMessages = extractMessageArray(json);

  // Returns the untouched upstream body so an unfamiliar response shape can be
  // inspected directly instead of silently normalizing to an empty list.
  if (debug) {
    return sendJson(res, 200, { configured: true, recognizedShape: rawMessages !== null, raw: json });
  }

  if (rawMessages === null) {
    return sendJson(res, 502, {
      configured: true,
      error: 'Unrecognized response shape from the ACARS provider.',
      hint: 'Re-request with &debug=1 to see the raw upstream payload.',
    });
  }

  const messages = rawMessages
    .map(normalizeAcarsMessage)
    .filter((m) => m && m.text)
    .slice(0, ACARS_MAX_MESSAGES);

  const payload = {
    configured: true,
    queried: { flight: flight || null, registration: reg || null },
    count: messages.length,
    messages,
    fetchedAt: new Date().toISOString(),
  };

  acarsCache = { key: cacheKey, expires: now + ACARS_CACHE_TTL_MS, data: payload };
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

  if (url.pathname === '/api/acars') {
    handleAcars(req, res, url.searchParams).catch((err) => {
      sendJson(res, 500, { error: 'Unexpected server error.', detail: String(err) });
    });
    return;
  }

  serveStatic(req, res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`Overhead widget running at http://localhost:${PORT}`);
});
