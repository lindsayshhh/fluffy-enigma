const CATEGORIES = [
  ['All', ''],
  ['Jewelry', 'jewelry'],
  ['Home decor', 'home decor'],
  ['Wall art', 'wall art'],
  ['Personalized gifts', 'personalized gift'],
  ['Clothing', 'clothing'],
  ['Wedding', 'wedding'],
  ['Stickers', 'stickers'],
  ['Candles', 'candle'],
  ['Crochet', 'crochet'],
  ['Vintage', 'vintage'],
];

const els = {
  chips: document.getElementById('chips'),
  form: document.getElementById('search'),
  q: document.getElementById('q'),
  grid: document.getElementById('grid'),
  summary: document.getElementById('summary'),
  notice: document.getElementById('notice'),
  tagsSection: document.getElementById('tags-section'),
  tags: document.getElementById('tags'),
  sortButtons: document.querySelectorAll('[data-sort]'),
  toolbar: document.getElementById('toolbar'),
};

let state = { query: '', sort: 'hot', data: null };
let requestId = 0;

function renderChips() {
  els.chips.replaceChildren(
    ...CATEGORIES.map(([label, q]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = label;
      b.className = 'chip' + (q === state.query ? ' active' : '');
      b.addEventListener('click', () => load(q));
      return b;
    }),
  );
}

function ageLabel(days) {
  if (days === null) return '';
  if (days < 1) return 'listed today';
  if (days < 30) return `listed ${Math.round(days)}d ago`;
  if (days < 365) return `listed ${Math.round(days / 30)}mo ago`;
  return `listed ${(days / 365).toFixed(1)}y ago`;
}

function perDay(n) {
  return n >= 10 ? Math.round(n).toLocaleString() : n.toFixed(1);
}

function sorted(items) {
  const copy = [...items];
  if (state.sort === 'loved') copy.sort((a, b) => b.favorites - a.favorites);
  else if (state.sort === 'new') copy.sort((a, b) => (a.ageDays ?? Infinity) - (b.ageDays ?? Infinity));
  else copy.sort((a, b) => b.favoritesPerDay - a.favoritesPerDay);
  return copy;
}

function card(item, rank) {
  const li = document.createElement('li');
  li.className = 'card';
  const a = document.createElement('a');
  a.href = item.url;
  a.target = '_blank';
  a.rel = 'noopener';

  const media = document.createElement('div');
  media.className = 'media';
  if (item.image) {
    const img = document.createElement('img');
    img.src = item.image;
    img.alt = '';
    img.loading = 'lazy';
    media.append(img);
  }
  const badge = document.createElement('span');
  badge.className = 'rank';
  badge.textContent = `#${rank}`;
  media.append(badge);

  const body = document.createElement('div');
  body.className = 'body';
  const title = document.createElement('h3');
  title.textContent = item.title;
  const meta = document.createElement('p');
  meta.className = 'meta';
  meta.textContent = [item.price, item.shop].filter(Boolean).join(' · ');
  const stats = document.createElement('p');
  stats.className = 'stats';
  const heat = document.createElement('span');
  heat.className = 'heat';
  heat.textContent = `♥ ${perDay(item.favoritesPerDay)}/day`;
  const rest = document.createElement('span');
  rest.textContent = `${item.favorites.toLocaleString()} total · ${ageLabel(item.ageDays)}`;
  stats.append(heat, rest);

  body.append(title, meta, stats);
  a.append(media, body);
  li.append(a);
  return li;
}

function render() {
  const { data } = state;
  if (!data) return;
  els.grid.replaceChildren(...sorted(data.items).map((item, i) => card(item, i + 1)));
  const scope = data.query ? `“${data.query}”` : 'all of Etsy';
  const time = new Date(data.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  els.summary.textContent = `Top ${data.items.length} of ${data.poolSize} leading listings for ${scope} · updated ${time}`;

  els.tagsSection.hidden = data.tags.length === 0;
  els.tags.replaceChildren(
    ...data.tags.map((tag) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tag';
      b.textContent = tag;
      b.addEventListener('click', () => load(tag));
      return b;
    }),
  );
}

function showNotice(html) {
  els.toolbar.hidden = true;
  els.notice.innerHTML = html;
  els.notice.hidden = false;
}

function skeleton() {
  els.grid.replaceChildren(
    ...Array.from({ length: 12 }, () => {
      const li = document.createElement('li');
      li.className = 'card skeleton';
      li.innerHTML = '<div class="media"></div><div class="body"><h3>&nbsp;</h3><p class="meta">&nbsp;</p></div>';
      return li;
    }),
  );
}

async function load(query) {
  state.query = query;
  els.q.value = query;
  renderChips();
  els.notice.hidden = true;
  els.toolbar.hidden = false;
  els.summary.textContent = 'Loading…';
  skeleton();

  const id = ++requestId;
  try {
    const res = await fetch(`/api/trending?q=${encodeURIComponent(query)}`);
    const body = await res.json();
    if (id !== requestId) return;
    if (!res.ok) {
      els.grid.replaceChildren();
      els.summary.textContent = '';
      els.tagsSection.hidden = true;
      if (body.error === 'missing_key') {
        showNotice(
          '<strong>Almost there.</strong> This site needs an Etsy API key. Create an app at ' +
            '<a href="https://www.etsy.com/developers/your-apps" target="_blank" rel="noopener">etsy.com/developers</a>, ' +
            'then start the server with <code>ETSY_API_KEY</code> and <code>ETSY_SHARED_SECRET</code> set.',
        );
      } else {
        showNotice(`<strong>Couldn't load Etsy listings.</strong> ${escapeHtml(body.message || 'Unknown error.')}`);
      }
      return;
    }
    state.data = body;
    if (body.items.length === 0) {
      els.grid.replaceChildren();
      showNotice('No active listings matched that search.');
    }
    render();
  } catch (err) {
    if (id !== requestId) return;
    els.grid.replaceChildren();
    els.summary.textContent = '';
    showNotice(`<strong>Couldn't reach the server.</strong> ${escapeHtml(String(err))}`);
  }
}

function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  load(els.q.value.trim());
});

els.sortButtons.forEach((b) =>
  b.addEventListener('click', () => {
    state.sort = b.dataset.sort;
    els.sortButtons.forEach((o) => o.classList.toggle('active', o === b));
    render();
  }),
);

load('');
