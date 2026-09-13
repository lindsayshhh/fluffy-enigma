import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fetchLiveEntries } from './providers/factcheck.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_FILE = path.join(__dirname, 'data', 'lies.json');

const LIVE_TTL_MS = Number(process.env.FACTCHECK_TTL_MS || 15 * 60 * 1000);

// The curated file is hand-maintained, so re-read it whenever it changes
// instead of at boot only — adding an entry shouldn't need a restart.
let curatedCache = { mtimeMs: -1, data: null };
let liveCache = { expires: 0, result: null };

export function loadCurated() {
  const { mtimeMs } = fs.statSync(DATA_FILE);
  if (curatedCache.mtimeMs === mtimeMs) return curatedCache.data;

  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const entries = (parsed.entries || []).map((entry, i) =>
    validateEntry({ kind: 'curated', ...entry }, i),
  );

  const data = { ...parsed, entries };
  curatedCache = { mtimeMs, data };
  return data;
}

// A missing citation is the one defect that would turn this site into an
// unsourced accusation, so treat it as fatal rather than rendering a blank.
// Curated entries additionally owe a written correction; live ones can't have
// one, because ClaimReview carries only a rating and a link.
export function validateEntry(entry, i) {
  const required = entry.kind === 'live' ? ['date', 'claim', 'rating'] : ['date', 'claim', 'reality'];

  for (const field of required) {
    if (!entry?.[field]) throw new Error(`entries[${i}] is missing "${field}"`);
  }
  if (!entry.source?.url || !entry.source?.name) {
    throw new Error(`entries[${i}] is missing a source name and url`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(entry.date)) {
    throw new Error(`entries[${i}] has date "${entry.date}", expected YYYY-MM-DD`);
  }
  return entry;
}

// Newest first, so "the last lie" is entries[0] regardless of input order.
// Same-day entries keep their relative order, which for the curated file is
// the order its source fact-check lists them in.
export function sortEntries(entries) {
  return [...entries].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

const urlKey = (entry) => String(entry.source?.url || '').replace(/[?#].*$/, '').replace(/\/$/, '');

// Curated wins an overlap: same fact-check, but the curated copy carries a
// written correction and a venue that the API can't supply.
export function mergeEntries(curated, live) {
  const seen = new Set(curated.map(urlKey));
  return sortEntries([...curated, ...live.filter((e) => !seen.has(urlKey(e)))]);
}

export async function loadDataset({ live = true } = {}) {
  const curated = loadCurated();
  const liveResult = live ? await loadLive() : { ok: false, reason: 'live lookup disabled', entries: [] };

  const entries = mergeEntries(curated.entries, liveResult.entries || []);

  return {
    ...curated,
    entries,
    live: {
      ok: liveResult.ok,
      reason: liveResult.reason,
      count: (liveResult.entries || []).length,
      received: liveResult.received ?? null,
      skipped: liveResult.skipped ?? null,
    },
  };
}

export async function loadLive({ force = false } = {}) {
  const now = Date.now();
  if (!force && liveCache.result && liveCache.expires > now) return liveCache.result;

  const result = await fetchLiveEntries({
    key: process.env.FACTCHECK_API_KEY,
    query: process.env.FACTCHECK_QUERY || 'Donald Trump',
    claimant: process.env.FACTCHECK_CLAIMANT || 'Trump',
  });

  liveCache = { expires: now + LIVE_TTL_MS, result };
  return result;
}

export function meta(data) {
  const live = data.live || { ok: false };
  return {
    subject: data.subject,
    updated: data.updated,
    note: data.note,
    total: data.entries.length,
    // The page says out loud which of these it is, so a stale hand-kept list
    // is never presented as a live feed.
    mode: live.ok ? 'live' : 'curated',
    liveCount: live.count || 0,
    curatedCount: data.entries.length - (live.count || 0),
    liveReason: live.ok ? null : live.reason,
  };
}
