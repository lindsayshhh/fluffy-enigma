const stage = document.getElementById('stage');

const DAY_MS = 86_400_000;

// Compare calendar days, not elapsed milliseconds: a claim made yesterday
// evening should read "Yesterday", not "today", a few hours later.
function daysAgo(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  const then = Date.UTC(y, m - 1, d);
  const now = new Date();
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today - then) / DAY_MS);
}

function relative(isoDate) {
  const days = daysAgo(isoDate);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ago`;
  const years = Math.round(days / 365);
  return `${years} year${years === 1 ? '' : 's'} ago`;
}

// Broadcast-style stamp for the on-screen clock: 09·10·26
function shortDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${m}\u00b7${d}\u00b7${y.slice(2)}`;
}

function longDate(isoDate) {
  const [y, m, d] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC',
  });
}

function fill(root, slot, text) {
  const el = root.querySelector(`[data-slot="${slot}"]`);
  if (el) el.textContent = text;
  return el;
}

function renderLatest(entry, subject) {
  const node = document.getElementById('tpl-latest').content.cloneNode(true);

  fill(node, 'eyebrow', `${subject}'s most recent fact-checked false claim`);
  fill(node, 'claim', entry.claim);
  fill(node, 'venue', entry.venue || 'Public remarks');
  fill(node, 'clock', shortDate(entry.date));

  const time = fill(node, 'date', `${longDate(entry.date)} — ${relative(entry.date)}`);
  time.dateTime = entry.date;

  // Live entries carry the publisher's own rating but no correction prose —
  // ClaimReview has no field for one — so the panel leads with the rating and
  // shows written detail only where a hand-checked entry supplies it.
  fill(node, 'rating', entry.rating || 'False');
  fill(node, 'verdict-by', `${entry.source.name}'s rating`);
  fill(node, 'verdict-label', entry.reality ? "What's actually true" : 'The verdict');

  const realityEl = node.querySelector('[data-slot="reality"]');
  if (entry.reality) realityEl.textContent = entry.reality;
  else realityEl.hidden = true;

  const source = fill(node, 'source', entry.source.name);
  source.href = entry.source.url;
  source.title = entry.source.title || entry.source.name;

  stage.replaceChildren(node);
}

function renderArchive(entries) {
  const list = document.getElementById('archive-list');
  if (!entries.length) {
    document.getElementById('archive').hidden = true;
    return;
  }

  list.replaceChildren(...entries.map((entry) => {
    const li = document.createElement('li');

    const claim = document.createElement('div');
    claim.className = 'a-claim';
    claim.textContent = entry.claim;

    const link = document.createElement('a');
    link.href = entry.source.url;
    link.rel = 'noopener noreferrer';
    link.target = '_blank';
    link.textContent = `${longDate(entry.date)} · ${entry.source.name}`;

    li.append(claim, link);
    return li;
  }));
}

// Says out loud which list the reader is looking at, so a stale hand-kept
// list is never passed off as a live feed.
function provenance(data) {
  if (data.mode === 'live') {
    return `${data.liveCount} pulled live from Google's Fact Check Tools API and ` +
      `${data.curatedCount} written by hand; the live ones refresh on their own.`;
  }
  return `Maintained by hand${data.liveReason ? ` — the live feed is off (${data.liveReason})` : ''}, ` +
    `so it lags the fact-checkers it cites. Last updated ${longDate(data.updated)}; ` +
    `see PolitiFact or FactCheck.org for their live listings.`;
}

function renderError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  stage.replaceChildren(p);
}

// Served by the Node app, the dataset comes from its API. The standalone
// build has no server, so there it ships inlined in the page instead.
async function readDataset() {
  const inline = document.getElementById('dataset');
  if (inline) return JSON.parse(inline.textContent);

  const res = await fetch('api/lies');
  if (!res.ok) throw new Error(`server returned ${res.status}`);
  return res.json();
}

async function load() {
  let data;
  try {
    data = await readDataset();
  } catch (err) {
    renderError(`Couldn't load the fact-check data (${err.message}).`);
    return;
  }

  const entries = data.entries || [];
  if (!entries.length) {
    renderError('No fact-checked claims are recorded yet.');
    return;
  }

  renderLatest(entries[0], data.subject);
  renderArchive(entries.slice(1));

  document.getElementById('disclaimer').textContent =
    `${data.note} ${provenance(data)} Records ${data.total} claim${data.total === 1 ? '' : 's'}.`;

  document.title = `The Last Lie — ${longDate(entries[0].date)}`;
}

load();
