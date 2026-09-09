const body = document.getElementById('body');
const footerText = document.getElementById('footerText');
const refreshBtn = document.getElementById('refreshBtn');

const POLL_INTERVAL_MS = 15000;
let pollTimer = null;
let currentCoords = null;

function render(html) {
  body.innerHTML = html;
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

function routeHtml(route) {
  if (!route || (!route.origin && !route.destination)) return '';
  const codes = `${airportCode(route.origin)} → ${airportCode(route.destination)}`;
  const places = [airportPlace(route.origin), airportPlace(route.destination)].filter(Boolean);
  const sub = places.length === 2 ? places.join(' → ') : places[0] || '';
  return `
    <div class="stat--wide">
      <div class="stat__label">Route</div>
      <div class="stat__value">${escapeHtml(codes)}</div>
      ${sub ? `<div class="stat__sub">${escapeHtml(sub)}</div>` : ''}
    </div>`;
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
  const route = routeHtml(plane.route);

  render(`
    <div class="plane">
      <div class="plane__callsign">${escapeHtml(callsign)}</div>
      <div class="plane__country">${escapeHtml(subtitle)}</div>

      <div class="plane__compass">
        <span class="plane__arrow" style="transform: rotate(${heading}deg)">↑</span>
      </div>

      <div class="plane__stats">
        ${route}
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
      </div>
    </div>
  `);
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

start();
