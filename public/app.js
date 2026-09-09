let ALL_MEMBERS = [];
let META = {};

const grid = document.getElementById('member-grid');
const emptyState = document.getElementById('empty-state');
const resultCount = document.getElementById('result-count');
const searchInput = document.getElementById('search-input');
const sortSelect = document.getElementById('sort-select');
const chamberTabs = document.querySelectorAll('.chamber-tab');
const dataMeta = document.getElementById('data-meta');
const overlay = document.getElementById('detail-overlay');
const detailBody = document.getElementById('detail-body');
const detailClose = document.getElementById('detail-close');

let state = { chamber: 'All', query: '', sort: 'name' };

function twitterHandle(url) {
  if (!url) return null;
  const match = url.match(/(?:twitter|x)\.com\/@?([A-Za-z0-9_]+)/i);
  return match ? match[1] : null;
}

function socialChips(member) {
  const chips = [];
  if (member.twitter) chips.push('X / Twitter');
  if (member.facebook) chips.push('Facebook');
  if (member.instagram) chips.push('Instagram');
  if (member.youtube) chips.push('YouTube');
  return chips;
}

function renderGrid() {
  const q = state.query.trim().toLowerCase();

  let filtered = ALL_MEMBERS.filter((m) => {
    if (state.chamber !== 'All' && m.chamber !== state.chamber) return false;
    if (!q) return true;
    return (
      m.name.toLowerCase().includes(q) ||
      String(m.district).includes(q)
    );
  });

  filtered.sort((a, b) => {
    if (state.sort === 'district') return (a.district || 0) - (b.district || 0);
    return a.name.localeCompare(b.name);
  });

  grid.innerHTML = '';
  emptyState.hidden = filtered.length !== 0;
  resultCount.textContent = filtered.length
    ? `Showing ${filtered.length} of ${ALL_MEMBERS.length} members`
    : '';

  for (const member of filtered) {
    const card = document.createElement('button');
    card.className = 'member-card';
    card.type = 'button';
    card.setAttribute('aria-haspopup', 'dialog');

    const chips = socialChips(member);

    card.innerHTML = `
      <div class="member-card-top">
        <span class="member-name">${escapeHtml(member.name)}</span>
        <span class="chamber-badge">${escapeHtml(member.chamber)}</span>
      </div>
      <div class="member-district">District ${escapeHtml(String(member.district ?? '—'))}</div>
      <div class="member-socials">
        ${chips.length ? chips.map((c) => `<span class="social-chip">${c}</span>`).join('') : '<span class="social-chip">No social links found</span>'}
      </div>
    `;

    card.addEventListener('click', () => openDetail(member));
    grid.appendChild(card);
  }
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function financeSearchLink(member) {
  const url = META.campaignFinanceSearchUrl || 'https://mertsplus.michigan.gov/';
  return url;
}

function openDetail(member) {
  const links = [];
  if (member.officialUrl) links.push({ label: 'Official Legislative Page', url: member.officialUrl });
  if (member.caucusUrl) links.push({ label: 'Caucus Profile', url: member.caucusUrl });
  if (member.twitter) links.push({ label: 'X / Twitter', url: member.twitter });
  if (member.facebook) links.push({ label: 'Facebook', url: member.facebook });
  if (member.instagram) links.push({ label: 'Instagram', url: member.instagram });
  if (member.youtube) links.push({ label: 'YouTube', url: member.youtube });

  const financeUrl = financeSearchLink(member);

  let embedsHtml = '';
  const handle = twitterHandle(member.twitter);
  if (handle) {
    embedsHtml += `
      <div class="embed-block">
        <a class="twitter-timeline" data-height="420" href="https://twitter.com/${handle}?ref_src=twsrc%5Etfw">Tweets by @${handle}</a>
      </div>
    `;
  }
  if (member.facebook) {
    embedsHtml += `
      <div class="embed-block">
        <div class="fb-page"
          data-href="${escapeHtml(member.facebook)}"
          data-tabs="timeline"
          data-width="500"
          data-height="420"
          data-small-header="true"
          data-adapt-container-width="true"
          data-hide-cover="false"
          data-show-facepile="false">
        </div>
      </div>
    `;
  }
  if (!embedsHtml) {
    embedsHtml = '<p class="no-embeds">No embeddable live feed found for this member yet — use the links above to visit their accounts directly.</p>';
  }

  detailBody.innerHTML = `
    <div class="detail-header">
      <h2 id="detail-name">${escapeHtml(member.name)}</h2>
      <p class="detail-sub">${escapeHtml(member.chamber)} · District ${escapeHtml(String(member.district ?? '—'))}</p>
    </div>
    <div class="detail-links">
      ${links.map((l) => `<a class="link-btn" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${l.label}</a>`).join('')}
      <a class="link-btn primary" href="${escapeHtml(financeUrl)}" target="_blank" rel="noopener">Campaign Finance Reports</a>
    </div>
    <div class="embed-section">
      <h3>Social feed</h3>
      ${embedsHtml}
    </div>
  `;

  overlay.hidden = false;
  document.body.style.overflow = 'hidden';

  // Ask the widget libraries to re-scan the DOM for the embeds we just inserted.
  if (window.twttr && window.twttr.widgets) {
    window.twttr.widgets.load(detailBody);
  }
  if (window.FB) {
    window.FB.XFBML.parse(detailBody);
  }
}

function closeDetail() {
  overlay.hidden = true;
  document.body.style.overflow = '';
  detailBody.innerHTML = '';
}

detailClose.addEventListener('click', closeDetail);
overlay.addEventListener('click', (e) => {
  if (e.target === overlay) closeDetail();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !overlay.hidden) closeDetail();
});

chamberTabs.forEach((tab) => {
  tab.addEventListener('click', () => {
    chamberTabs.forEach((t) => {
      t.classList.remove('is-active');
      t.setAttribute('aria-selected', 'false');
    });
    tab.classList.add('is-active');
    tab.setAttribute('aria-selected', 'true');
    state.chamber = tab.dataset.chamber;
    renderGrid();
  });
});

searchInput.addEventListener('input', (e) => {
  state.query = e.target.value;
  renderGrid();
});

sortSelect.addEventListener('change', (e) => {
  state.sort = e.target.value;
  renderGrid();
});

function loadWidgetScripts() {
  const tw = document.createElement('script');
  tw.src = 'https://platform.twitter.com/widgets.js';
  tw.async = true;
  document.body.appendChild(tw);

  const fb = document.createElement('script');
  fb.src = 'https://connect.facebook.net/en_US/sdk.js#xfbml=1&version=v19.0';
  fb.async = true;
  fb.defer = true;
  fb.crossOrigin = 'anonymous';
  document.body.appendChild(fb);
}

async function init() {
  try {
    const res = await fetch('/data/legislators.json');
    const data = await res.json();
    META = data;
    ALL_MEMBERS = data.members || [];
  } catch (err) {
    resultCount.textContent = 'Could not load legislator data.';
    console.error(err);
    return;
  }

  if (META.generatedAt) {
    dataMeta.textContent = `Data compiled ${new Date(META.generatedAt).toLocaleDateString()} from official Michigan legislature, caucus, and campaign finance sources.`;
  } else {
    dataMeta.textContent = 'Data not yet loaded.';
  }

  renderGrid();
  loadWidgetScripts();
}

init();
