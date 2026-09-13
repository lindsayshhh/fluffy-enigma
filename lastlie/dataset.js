import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const DATA_FILE = path.join(__dirname, 'data', 'lies.json');

// The dataset is hand-maintained, so re-read it whenever the file changes
// instead of at boot only — adding an entry shouldn't need a restart.
let cached = { mtimeMs: -1, data: null };

export function loadDataset() {
  const { mtimeMs } = fs.statSync(DATA_FILE);
  if (cached.mtimeMs === mtimeMs) return cached.data;

  const parsed = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  const entries = (parsed.entries || []).map(validateEntry);

  // Newest first, so "the last lie" is entries[0] regardless of file order.
  // Same-day entries keep their file order, which is the order the source
  // fact-check lists them in.
  entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  const data = { ...parsed, entries };
  cached = { mtimeMs, data };
  return data;
}

// A missing source link is the one defect that would turn this site into an
// unsourced accusation, so treat it as fatal rather than rendering a blank.
function validateEntry(entry, i) {
  for (const field of ['date', 'claim', 'reality']) {
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

export function meta(data) {
  return {
    subject: data.subject,
    updated: data.updated,
    note: data.note,
    total: data.entries.length,
  };
}
