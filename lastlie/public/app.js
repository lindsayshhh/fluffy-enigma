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
  fill(node, 'reality', entry.reality);

  const time = fill(node, 'date', `${longDate(entry.date)} — ${relative(entry.date)}`);
  time.dateTime = entry.date;

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

function renderError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  stage.replaceChildren(p);
}

async function load() {
  let data;
  try {
    const res = await fetch('api/lies');
    if (!res.ok) throw new Error(`server returned ${res.status}`);
    data = await res.json();
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
    `${data.note} Records ${data.total} claim${data.total === 1 ? '' : 's'}; ` +
    `list last updated ${longDate(data.updated)}. It is maintained by hand, so it lags ` +
    `the fact-checkers it cites — see PolitiFact or FactCheck.org for their live listings.`;

  document.title = `The Last Lie — ${longDate(entries[0].date)}`;
}

load();
