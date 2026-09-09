const body = document.getElementById('body');
const statsEl = document.getElementById('stats');
const skyEl = document.getElementById('sky');
const footerText = document.getElementById('footerText');
const refreshBtn = document.getElementById('refreshBtn');

const POLL_INTERVAL_MS = 15000;
let pollTimer = null;
let currentCoords = null;

function render(html) {
  body.innerHTML = html;
  statsEl.innerHTML = '';
}

// The sky you're looking out at tracks the viewer's own clock.
function applySkyPhase() {
  const hour = new Date().getHours();
  const phase = hour < 5 || hour >= 20 ? 'night'
    : hour < 8 ? 'dawn'
    : hour < 17 ? 'day'
    : 'dusk';
  skyEl.className = `sky sky--${phase}`;
}

function setFooter(text) {
  footerText.textContent = text;
}

function fmt(value, unit, digits = 0) {
  if (value == null || Number.isNaN(value)) return '—';
  return `${value.toFixed(digits)} ${unit}`;
}

function renderLoading(message) {
  render(`<div class="state state--loading"><p>${message}</p></div>`);
}

function renderError(message, { showManual = false } = {}) {
  render(`
    <div class="state state--error">
      <p>${message}</p>
      ${showManual ? manualFormHtml() : `<button class="state__action" id="retryBtn">Try again</button>`}
    </div>
  `);
  const retryBtn = document.getElementById('retryBtn');
  if (retryBtn) retryBtn.addEventListener('click', start);
  wireManualForm();
}

function manualFormHtml() {
  return `
    <form class="manual-form" id="manualForm">
      <input type="text" inputmode="decimal" placeholder="lat" id="manualLat" required />
      <input type="text" inputmode="decimal" placeholder="lon" id="manualLon" required />
      <button type="submit">Use</button>
    </form>
  `;
}

function wireManualForm() {
  const form = document.getElementById('manualForm');
  if (!form) return;
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const lat = Number(document.getElementById('manualLat').value);
    const lon = Number(document.getElementById('manualLon').value);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      setLocation(lat, lon);
    }
  });
}

function renderEmpty() {
  render(`
    <div class="state">
      <p>No aircraft detected nearby right now.</p>
    </div>
  `);
}

const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

function compassPoint(deg) {
  if (deg == null) return null;
  return COMPASS[Math.round(deg / 22.5) % 16];
}

function airportCode(airport) {
  return airport ? airport.iata || airport.icao || '?' : '?';
}

function airportPlace(airport) {
  return airport ? airport.municipality || airport.name || '' : '';
}

// A blank space can't say whether a route doesn't exist or was withheld, so
// each outcome gets its own words.
const ROUTE_NOTES = {
  unknown: 'No route on file — charter and private flights usually have none',
  suspect: 'Route on file doesn’t match this position',
  unavailable: 'Route lookup unavailable',
  unparsed: 'Route data couldn’t be read — this one’s a bug, not a missing route',
};

function routeHtml(route, status) {
  const stops = route ? [route.origin, route.midpoint, route.destination].filter(Boolean) : [];

  if (status === 'ok' && stops.length) {
    const codes = stops.map(airportCode).join(' → ');
    const places = stops.map(airportPlace);
    const sub = places.every(Boolean) ? places.join(' → ') : '';
    return `
      <div class="spotted__route">${escapeHtml(codes)}</div>
      ${sub ? `<div class="spotted__route-sub">${escapeHtml(sub)}</div>` : ''}`;
  }

  const note = ROUTE_NOTES[status];
  return note ? `<div class="spotted__route-note">${escapeHtml(note)}</div>` : '';
}

function renderPlane(plane) {
  const callsign = (plane.callsign || '').trim() || (plane.icao24 || '').toUpperCase() || 'Unknown';
  const subtitle = plane.description
    || [plane.aircraftType, plane.registration].filter(Boolean).join(' · ')
    || 'Type unknown';
  const heading = plane.heading ?? 0;
  const verticalRate = plane.verticalRateFtMin;
  let trend = 'level';
  if (verticalRate != null) {
    if (verticalRate > 150) trend = 'climbing';
    else if (verticalRate < -150) trend = 'descending';
  }

  const look = compassPoint(plane.bearingDeg);
  const identity = [plane.registration, plane.aircraftType, plane.year].filter(Boolean).join(' · ');
  const route = routeHtml(plane.route, plane.routeStatus);

  // Out of the window: the aircraft itself, turned to its real heading.
  body.innerHTML = `
    <div class="spotted">
      <div class="spotted__mark" style="transform: rotate(${heading}deg)">✈</div>
      <div class="spotted__label">
        <div class="spotted__callsign">${escapeHtml(callsign)}</div>
        <div class="spotted__desc">${escapeHtml(subtitle)}</div>
        ${route}
      </div>
    </div>
  `;

  // On the cabin wall: the numbers.
  statsEl.innerHTML = `
    <div>
      <div class="stat__label">Distance</div>
      <div class="stat__value">${fmt(plane.distanceMiles, 'mi', 1)}</div>
    </div>
    <div>
      <div class="stat__label">Altitude</div>
      <div class="stat__value">${plane.altitudeFt != null ? Math.round(plane.altitudeFt).toLocaleString() + ' ft' : '—'}</div>
    </div>
    <div>
      <div class="stat__label">Speed</div>
      <div class="stat__value">${fmt(plane.speedMph, 'mph')}</div>
    </div>
    <div>
      <div class="stat__label">Trend</div>
      <div class="stat__value">${trend}</div>
    </div>
    <div>
      <div class="stat__label">Look</div>
      <div class="stat__value">${look || '—'}</div>
    </div>
    <div>
      <div class="stat__label">Squawk</div>
      <div class="stat__value">${escapeHtml(plane.squawk || '—')}</div>
    </div>
    ${plane.emergency ? `
    <div class="stat--wide stat--alert">
      <div class="stat__label">Emergency</div>
      <div class="stat__value">${escapeHtml(plane.emergency)}</div>
    </div>` : ''}
    ${plane.operator ? `
    <div class="stat--wide">
      <div class="stat__label">Operator</div>
      <div class="stat__value">${escapeHtml(plane.operator)}</div>
    </div>` : ''}
    ${identity ? `
    <div class="stat--wide">
      <div class="stat__label">Aircraft</div>
      <div class="stat__value">${escapeHtml(identity)}</div>
    </div>` : ''}
  `;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}


async function fetchOverhead(lat, lon) {
  const url = `/api/overhead?lat=${lat}&lon=${lon}`;
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const detail = (data.failures || []).map((f) => `${f.provider}: ${f.reason}`).join('; ');
    throw new Error(detail ? `${data.error} (${detail})` : data.error || `Request failed (${res.status})`);
  }
  return data;
}

async function poll() {
  if (!currentCoords) return;
  refreshBtn.classList.add('spinning');
  try {
    const data = await fetchOverhead(currentCoords.lat, currentCoords.lon);
    if (data.nearest) {
      renderPlane(data.nearest);
      setFooter(`${data.count} aircraft nearby · updated ${new Date(data.fetchedAt).toLocaleTimeString()}`);
    } else {
      renderEmpty();
      setFooter(`Checked at ${new Date(data.fetchedAt).toLocaleTimeString()}`);
    }
  } catch (err) {
    renderError(err.message || 'Something went wrong.');
    setFooter('Error fetching flight data');
  } finally {
    setTimeout(() => refreshBtn.classList.remove('spinning'), 400);
  }
}

function setLocation(lat, lon) {
  currentCoords = { lat, lon };
  setFooter(`Location: ${lat.toFixed(3)}, ${lon.toFixed(3)}`);
  renderLoading('Looking up nearby air traffic…');
  poll();
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(poll, POLL_INTERVAL_MS);
}

function start() {
  renderLoading('Finding your location…');
  if (!navigator.geolocation) {
    renderError('Geolocation is not supported by this browser. Enter coordinates manually:', { showManual: true });
    return;
  }
  navigator.geolocation.getCurrentPosition(
    (pos) => setLocation(pos.coords.latitude, pos.coords.longitude),
    () => {
      renderError('Location access was denied. Enter coordinates manually:', { showManual: true });
    },
    { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
  );
}

refreshBtn.addEventListener('click', poll);

applySkyPhase();
setInterval(applySkyPhase, 5 * 60 * 1000);

start();
