// Bundles the site into a single self-contained page: CSS and JS inlined,
// and the dataset embedded so it needs no server. Writes two flavours —
// `index.html`, a complete document for any static host, and `fragment.html`,
// the same page without the document scaffolding, which is the shape
// claude.ai Artifacts expect.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadDataset, meta } from './dataset.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const OUT_DIR = path.join(__dirname, 'dist');

const read = (f) => fs.readFileSync(path.join(PUBLIC_DIR, f), 'utf8');

const data = loadDataset();
const payload = { ...meta(data), entries: data.entries };

// Escaping "<" keeps a "</script>" inside any string from closing the block early.
const json = JSON.stringify(payload).replace(/</g, '\\u003c');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + '<body>'.length, html.indexOf('</body>'));

const inner = body
  .replace('<script src="app.js" type="module"></script>', '')
  .trim();

const parts = [
  '<title>The Last Lie</title>',
  `<style>\n${read('style.css').trim()}\n</style>`,
  inner,
  `<script type="application/json" id="dataset">${json}</script>`,
  `<script type="module">\n${read('app.js').trim()}\n</script>`,
].join('\n\n');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'fragment.html'), parts + '\n');
fs.writeFileSync(
  path.join(OUT_DIR, 'index.html'),
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n` +
    `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `</head>\n<body>\n${parts}\n</body>\n</html>\n`,
);

console.log(`built ${payload.total} entries -> dist/index.html, dist/fragment.html`);
