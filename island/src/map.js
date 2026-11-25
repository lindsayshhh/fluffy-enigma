// The island map in the journal: terrain drawn from the height function once,
// then places, people and the player on top each time it opens.
import { height } from './terrain.js';

// World area shown: x left to right, z top to bottom (the sea and the resort
// beaches are at the bottom, south).
const X0 = -185;
const X1 = 185;
const Z0 = -150;
const Z1 = 175;

let base = null;

function terrainImage(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const H = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) H[j * w + i] = height(X0 + ((i + 0.5) / w) * (X1 - X0), Z0 + ((j + 0.5) / h) * (Z1 - Z0));
  }
  const mix = (a, b, t) => a + (b - a) * Math.max(0, Math.min(1, t));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const v = H[j * w + i];
      let r, gg, b;
      if (v < 0) {
        // Shallows turquoise, deep water navy.
        const t = Math.min(1, -v / 9);
        r = mix(120, 22, t);
        gg = mix(214, 96, t);
        b = mix(212, 150, t);
      } else if (v < 1.1) {
        r = 238; gg = 222; b = 178; // sand
      } else if (v < 12) {
        const t = (v - 1.1) / 11;
        r = mix(128, 92, t);
        gg = mix(170, 132, t);
        b = mix(92, 78, t);
      } else {
        const t = Math.min(1, (v - 12) / 10);
        r = mix(128, 160, t);
        gg = mix(120, 150, t);
        b = mix(96, 132, t);
      }
      // Hillshade from the north-west.
      if (v >= 0) {
        const dx = H[j * w + Math.min(w - 1, i + 1)] - H[j * w + Math.max(0, i - 1)];
        const dz = H[Math.min(h - 1, j + 1) * w + i] - H[Math.max(0, j - 1) * w + i];
        const shade = 1 + (-dx - dz) * 0.09;
        r *= shade;
        gg *= shade;
        b *= shade;
      }
      // A thin surf line at the shore.
      if (v > -0.5 && v < 0.05) {
        r = mix(r, 255, 0.6);
        gg = mix(gg, 255, 0.6);
        b = mix(b, 255, 0.6);
      }
      const k = (j * w + i) * 4;
      img.data[k] = r;
      img.data[k + 1] = gg;
      img.data[k + 2] = b;
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Draw the map into `canvas` (any size).
export function drawMap(canvas, { L, game, player, extras = [], dolphin, names = {} }) {
  const W = canvas.width;
  const Hh = canvas.height;
  const g = canvas.getContext('2d');
  if (!base) base = terrainImage(300, Math.round((300 * (Z1 - Z0)) / (X1 - X0)));
  g.imageSmoothingEnabled = true;
  g.drawImage(base, 0, 0, W, Hh);
  const sx = (x) => ((x - X0) / (X1 - X0)) * W;
  const sz = (z) => ((z - Z0) / (Z1 - Z0)) * Hh;
  const k = W / 600; // UI scale

  // Paths.
  g.strokeStyle = 'rgba(214, 190, 140, 0.95)';
  g.lineWidth = 2.2 * k;
  g.setLineDash([5 * k, 4 * k]);
  for (const p of L.paths) {
    g.beginPath();
    p.forEach((pt, i) => (i ? g.lineTo(sx(pt.x), sz(pt.z)) : g.moveTo(sx(pt.x), sz(pt.z))));
    g.stroke();
  }
  g.setLineDash([]);
  // The dock and the bungalow boardwalks.
  g.strokeStyle = '#8a6a48';
  g.lineWidth = 3 * k;
  g.beginPath();
  g.moveTo(sx(L.dock.x), sz(L.dock.z0));
  g.lineTo(sx(L.dock.x), sz(L.dock.z1));
  for (const b of L.bungalows) {
    g.moveTo(sx(b.x), sz(b.walk0));
    g.lineTo(sx(b.x), sz(b.z));
  }
  g.stroke();
  g.fillStyle = '#6b4b2e';
  for (const b of L.bungalows) g.fillRect(sx(b.x) - 5 * k, sz(b.z) - 4 * k, 10 * k, 8 * k);
  // Pool.
  if (L.pool) {
    g.fillStyle = '#e6dcc4';
    g.fillRect(sx(L.pool.x - 17), sz(L.pool.z - 12), (34 / (X1 - X0)) * W, (24 / (Z1 - Z0)) * Hh);
    g.fillStyle = '#35c4e6';
    g.fillRect(sx(L.pool.x - 12), sz(L.pool.z - 7), (22 / (X1 - X0)) * W, (12 / (Z1 - Z0)) * Hh);
  }
  // Reef outline.
  g.strokeStyle = 'rgba(255, 140, 160, 0.7)';
  g.setLineDash([3 * k, 3 * k]);
  g.strokeRect(sx(L.reef.x0), sz(L.reef.z0), sx(L.reef.x1) - sx(L.reef.x0), sz(L.reef.z1) - sz(L.reef.z0));
  g.setLineDash([]);

  // Labels avoid each other: try above the dot, then below, else leave just the dot.
  const taken = [];
  const label = (text, x, y, color, align = 'center') => {
    const w = g.measureText(text).width + 4 * k;
    const h = 12 * k;
    const tries = align === 'center' ? [[x - w / 2, y - 7 * k - h], [x - w / 2, y + 7 * k]] : [[x + 5 * k, y - h / 2], [x - 5 * k - w, y - h / 2]];
    for (const [lx, ly] of tries) {
      if (taken.some((r) => lx < r[0] + r[2] && lx + w > r[0] && ly < r[1] + r[3] && ly + h > r[1])) continue;
      taken.push([lx, ly, w, h]);
      g.textAlign = 'left';
      g.lineWidth = 3 * k;
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.strokeText(text, lx + 2 * k, ly + h - 2.5 * k);
      g.fillStyle = color;
      g.fillText(text, lx + 2 * k, ly + h - 2.5 * k);
      return;
    }
  };

  // Places.
  const s = game.s;
  const places = [
    [L.bar, 'The Salty Coconut'],
    [{ x: L.bungalows[1].x, z: L.bungalows[1].z + 6 }, 'Your bungalow (7)'],
    [{ x: L.dock.x + 2, z: L.dock.z1 }, 'Dock'],
    [L.pool, 'Pool'],
    [L.volleyball, 'Volleyball'],
    [L.hammock, 'Hammock'],
    [L.yoga, 'Sunset yoga'],
    [L.lighthouse, 'Lighthouse'],
    [L.grove, 'Coconut grove'],
    [L.kayak, 'Kayaks'],
    [{ x: (L.reef.x0 + L.reef.x1) / 2, z: L.reef.z1 + 4 }, 'Reef'],
  ];
  if (s.flags.bonfireAnnounced) places.push([L.bonfire, 'Bonfire']);
  places.push([L.cove, s.flags.sawCove ? 'Hidden cove' : '?']);
  g.font = `600 ${Math.round(11 * k)}px system-ui, sans-serif`;
  g.textAlign = 'center';
  for (const [p, name] of places) {
    const label = name;
    if (!p) continue;
    const x = sx(p.x);
    const y = sz(p.z);
    g.fillStyle = '#fff';
    g.strokeStyle = '#1d3557';
    g.lineWidth = 1.5 * k;
    g.beginPath();
    g.arc(x, y, 3.2 * k, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    places.labels = places.labels || [];
    places.labels.push([label, x, y]);
  }

  // People you've met (and the ones you haven't, as plain dots).
  const people = [];
  for (const [key, n] of Object.entries(game.npcs)) {
    if (n.person.group.visible) people.push({ key, x: n.pos.x, z: n.pos.z });
  }
  for (const e of extras) {
    const key = e.h.role.key;
    if (key && names[key] && e.h.group.visible) people.push({ key, x: e.h.group.position.x, z: e.h.group.position.z });
  }
  if (dolphin && s.flags.metReg) people.push({ key: 'reg', x: dolphin.pos.x, z: dolphin.pos.z });
  g.font = `700 ${Math.round(10 * k)}px system-ui, sans-serif`;
  for (const p of people) {
    const met = s.flags[`met${p.key[0].toUpperCase()}${p.key.slice(1)}`] || (p.key === 'walt' && s.flags.metDoris);
    const x = sx(p.x);
    const y = sz(p.z);
    g.fillStyle = met ? '#e76f51' : 'rgba(231,111,81,0.55)';
    g.strokeStyle = '#fff';
    g.lineWidth = 1.5 * k;
    g.beginPath();
    g.arc(x, y, 4.2 * k, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    if (met) p.label = [(names[p.key] || p.key).split(' ')[0], x, y];
  }
  // Labels last, so they sit on top of every dot: places first, then people.
  g.font = `600 ${Math.round(11 * k)}px system-ui, sans-serif`;
  for (const [text, x, y] of places.labels || []) label(text, x, y, '#1d3557');
  g.font = `700 ${Math.round(10 * k)}px system-ui, sans-serif`;
  for (const p of people) if (p.label) label(p.label[0], p.label[1], p.label[2], '#9c3b22', 'side');

  // You: an arrow pointing the way you're facing.
  const px = sx(player.pos.x);
  const pz = sz(player.pos.z);
  const yaw = player.yaw;
  // Camera forward in world xz is (-sin yaw, -cos yaw); on the map z points down.
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  g.save();
  g.translate(px, pz);
  g.rotate(Math.atan2(fz, fx) + Math.PI / 2);
  g.fillStyle = '#ffd166';
  g.strokeStyle = '#1d3557';
  g.lineWidth = 2 * k;
  g.beginPath();
  g.moveTo(0, -9 * k);
  g.lineTo(6.5 * k, 7 * k);
  g.lineTo(0, 3.5 * k);
  g.lineTo(-6.5 * k, 7 * k);
  g.closePath();
  g.fill();
  g.stroke();
  g.restore();

  // Compass.
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = `700 ${Math.round(12 * k)}px Georgia, serif`;
  g.textAlign = 'center';
  g.fillText('N', W - 18 * k, 20 * k);
  g.beginPath();
  g.moveTo(W - 18 * k, 24 * k);
  g.lineTo(W - 22 * k, 36 * k);
  g.lineTo(W - 14 * k, 36 * k);
  g.closePath();
  g.fill();
}
