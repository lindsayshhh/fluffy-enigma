const body = document.getElementById('body');
const footerText = document.getElementById('footerText');
const refreshBtn = document.getElementById('refreshBtn');
const acarsSection = document.getElementById('acars');
const acarsBody = document.getElementById('acarsBody');
const acarsMeta = document.getElementById('acarsMeta');

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

function renderPlane(plane) {
  const callsign = (plane.callsign || '').trim() || (plane.icao24 || '').toUpperCase() || 'Unknown';
  const subtitle = [plane.aircraftType, plane.registration].filter(Boolean).join(' · ') || 'Type unknown';
  const heading = plane.heading ?? 0;
  const verticalRate = plane.verticalRateFtMin;
  let trend = 'level';
  if (verticalRate != null) {
    if (verticalRate > 150) trend = 'climbing';
    else if (verticalRate < -150) trend = 'descending';
  }

  render(`
    <div class="plane">
      <div class="plane__callsign">${escapeHtml(callsign)}</div>
      <div class="plane__country">${escapeHtml(subtitle)}</div>

      <div class="plane__compass">
        <span class="plane__arrow" style="transform: rotate(${heading}deg)">↑</span>
      </div>

      <div class="plane__stats">
        <div>
          <div class="stat__label">Distance</div>
          <div class="stat__value">${fmt(plane.distanceKm, 'km', 1)}</div>
        </div>
        <div>
          <div class="stat__label">Altitude</div>
          <div class="stat__value">${plane.altitudeFt != null ? Math.round(plane.altitudeFt).toLocaleString() + ' ft' : '—'}</div>
        </div>
        <div>
          <div class="stat__label">Speed</div>
          <div class="stat__value">${fmt(plane.speedKmh, 'km/h')}</div>
        </div>
        <div>
          <div class="stat__label">Trend</div>
          <div class="stat__value">${trend}</div>
        </div>
        <div class="stat--wide">
          <div class="stat__label">ICAO24</div>
          <div class="stat__value">${plane.icao24 || '—'}</div>
        </div>
      </div>
    </div>
  `);
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

let acarsIdentity = null;
let acarsFetchedAt = 0;

function hideAcars() {
  acarsSection.hidden = true;
  acarsIdentity = null;
}

function renderAcarsNotice(text, meta = '') {
  acarsMeta.textContent = meta;
  acarsBody.innerHTML = `<p class="acars__empty">${escapeHtml(text)}</p>`;
}

function formatAcarsTime(value) {
  if (value == null) return '';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleTimeString();
}

function renderAcarsMessages(data) {
  acarsMeta.textContent = `${data.count} message${data.count === 1 ? '' : 's'}`;
  acarsBody.innerHTML = `
    <div class="acars__list">
      ${data.messages.map((msg) => `
        <div class="acars__msg">
          <div class="acars__msg-head">
            <span>${escapeHtml(formatAcarsTime(msg.timestamp))}</span>
            ${msg.label ? `<span class="acars__label">${escapeHtml(msg.label)}</span>` : ''}
            ${msg.link ? `<span>${escapeHtml(msg.link)}</span>` : ''}
            ${msg.station ? `<span>via ${escapeHtml(msg.station)}</span>` : ''}
          </div>
          <pre class="acars__text">${escapeHtml(msg.text)}</pre>
        </div>
      `).join('')}
    </div>
  `;
}

async function loadAcars(plane) {
  const flight = (plane.callsign || '').trim();
  const reg = (plane.registration || '').trim();

  if (!flight && !reg) {
    hideAcars();
    return;
  }

  const identity = `${flight}|${reg}`;
  const now = Date.now();
  if (identity === acarsIdentity && now - acarsFetchedAt < 60000) return;

  acarsIdentity = identity;
  acarsFetchedAt = now;
  acarsSection.hidden = false;
  renderAcarsNotice('Checking for recent messages…');

  const params = new URLSearchParams();
  if (flight) params.set('flight', flight);
  if (reg) params.set('reg', reg);

  try {
    const res = await fetch(`/api/acars?${params}`);
    const data = await res.json();

    if (!res.ok) {
      renderAcarsNotice(data.error || `Request failed (${res.status})`);
      return;
    }
    if (data.configured === false) {
      renderAcarsNotice(
        'ACARS lookups are switched off. Set AIRFRAMES_API_KEY on the server to enable them.'
      );
      return;
    }
    if (!data.messages || data.count === 0) {
      renderAcarsNotice(
        'No recent messages heard for this aircraft. ACARS is only picked up where a volunteer receiver is listening, so most flights show nothing.',
        '0 messages'
      );
      return;
    }
    renderAcarsMessages(data);
  } catch (err) {
    renderAcarsNotice(err.message || 'Could not load ACARS messages.');
  }
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
      loadAcars(data.nearest);
    } else {
      renderEmpty();
      hideAcars();
      setFooter(`Checked at ${new Date(data.fetchedAt).toLocaleTimeString()}`);
    }
  } catch (err) {
    renderError(err.message || 'Something went wrong.');
    hideAcars();
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
