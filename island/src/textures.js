import * as THREE from 'three';
import { rng } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function finish(c, repeat = [1, 1]) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

export function woodTexture(base = [150, 110, 72], planks = 6, seed = 1, repeat) {
  const r = rng(seed);
  const [c, g] = canvas(512, 512);
  const pw = 512 / planks;
  for (let p = 0; p < planks; p++) {
    const v = 0.82 + r() * 0.3;
    g.fillStyle = `rgb(${base[0] * v | 0},${base[1] * v | 0},${base[2] * v | 0})`;
    g.fillRect(p * pw, 0, pw, 512);
    for (let i = 0; i < 40; i++) {
      const x = p * pw + r() * pw;
      const d = 0.6 + r() * 0.35;
      g.strokeStyle = `rgba(${base[0] * d * 0.7 | 0},${base[1] * d * 0.7 | 0},${base[2] * d * 0.7 | 0},${0.15 + r() * 0.3})`;
      g.lineWidth = 0.6 + r() * 1.6;
      g.beginPath();
      g.moveTo(x, 0);
      for (let y = 0; y <= 512; y += 32) g.lineTo(x + Math.sin(y * 0.02 + i) * 2.5, y);
      g.stroke();
    }
    // knots
    if (r() > 0.4) {
      const kx = p * pw + pw * (0.3 + r() * 0.4);
      const ky = r() * 512;
      g.fillStyle = 'rgba(60,35,20,0.45)';
      g.beginPath();
      g.ellipse(kx, ky, 3 + r() * 3, 7 + r() * 6, 0, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = 'rgba(25,15,8,0.8)';
    g.fillRect(p * pw, 0, 2, 512);
  }
  return finish(c, repeat);
}

export function thatchTexture(seed = 3, repeat = [4, 2]) {
  const r = rng(seed);
  const [c, g] = canvas(512, 512);
  g.fillStyle = '#6b5530';
  g.fillRect(0, 0, 512, 512);
  for (let row = 0; row < 8; row++) {
    for (let i = 0; i < 520; i++) {
      const x = r() * 512;
      const y0 = row * 64 - 6;
      const len = 58 + r() * 26;
      const v = 0.75 + r() * 0.45;
      g.strokeStyle = `rgba(${200 * v | 0},${165 * v | 0},${100 * v | 0},0.9)`;
      g.lineWidth = 1 + r() * 2;
      g.beginPath();
      g.moveTo(x, y0);
      g.lineTo(x + (r() - 0.5) * 8, y0 + len);
      g.stroke();
    }
    g.fillStyle = 'rgba(40,28,12,0.35)';
    g.fillRect(0, row * 64 + 58, 512, 6);
  }
  return finish(c, repeat);
}

export function stripeTexture(colors, n = 8) {
  const [c, g] = canvas(512, 64);
  const w = 512 / n;
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(i * w, 0, w + 1, 64);
  }
  return finish(c);
}

export function bandTexture(colors, n = 6) {
  const [c, g] = canvas(64, 512);
  const h = 512 / n;
  const r = rng(11);
  for (let i = 0; i < n; i++) {
    g.fillStyle = colors[i % colors.length];
    g.fillRect(0, i * h, 64, h + 1);
  }
  // Weathering streaks
  for (let i = 0; i < 300; i++) {
    g.fillStyle = `rgba(70,60,50,${r() * 0.07})`;
    g.fillRect(r() * 64, r() * 512, 1 + r() * 2, 10 + r() * 60);
  }
  return finish(c);
}

export function trunkTexture(seed = 5) {
  const r = rng(seed);
  const [c, g] = canvas(128, 256);
  g.fillStyle = '#7a6650';
  g.fillRect(0, 0, 128, 256);
  for (let i = 0; i < 1400; i++) {
    const v = 0.6 + r() * 0.6;
    g.fillStyle = `rgba(${120 * v | 0},${100 * v | 0},${78 * v | 0},0.5)`;
    g.fillRect(r() * 128, r() * 256, 1 + r() * 3, 1 + r() * 2);
  }
  for (let y = 0; y < 256; y += 32) {
    g.fillStyle = 'rgba(45,35,25,0.65)';
    g.fillRect(0, y + r() * 3, 128, 3 + r() * 3);
    g.fillStyle = 'rgba(170,150,120,0.35)';
    g.fillRect(0, y + 7, 128, 2);
  }
  return finish(c);
}

export function textTexture(lines, { w = 1024, h = 256, bg = '#6d4a2b', fg = '#f6e7c8', font = 'bold 92px Georgia, serif', border = true } = {}) {
  const [c, g] = canvas(w, h);
  if (bg) {
    const wood = woodTexture([140, 95, 55], 1, 9).image;
    g.drawImage(wood, 0, 0, w, h);
    g.fillStyle = bg;
    g.globalAlpha = 0.55;
    g.fillRect(0, 0, w, h);
    g.globalAlpha = 1;
  }
  if (border) {
    g.strokeStyle = 'rgba(30,18,8,0.8)';
    g.lineWidth = 12;
    g.strokeRect(6, 6, w - 12, h - 12);
  }
  g.fillStyle = fg;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  const lh = h / (lines.length + 0.3);
  lines.forEach((line, i) => {
    g.font = typeof line === 'object' ? line.font : font;
    const text = typeof line === 'object' ? line.text : line;
    g.shadowColor = 'rgba(0,0,0,0.5)';
    g.shadowBlur = 6;
    g.fillText(text, w / 2, lh * (i + 0.65));
  });
  const t = finish(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

export function netTexture() {
  const [c, g] = canvas(256, 256);
  g.clearRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(240,240,235,1)';
  g.lineWidth = 3;
  for (let i = 0; i <= 256; i += 32) {
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 256);
    g.moveTo(0, i);
    g.lineTo(256, i);
    g.stroke();
  }
  return finish(c);
}

export function fabricTexture(colors) {
  const [c, g] = canvas(256, 256);
  const w = 256 / colors.length;
  colors.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(i * w, 0, w + 1, 256);
  });
  g.globalAlpha = 0.12;
  for (let y = 0; y < 256; y += 3) {
    g.fillStyle = y % 6 ? '#000' : '#fff';
    g.fillRect(0, y, 256, 1);
  }
  return finish(c);
}

// Woven outdoor canvas: a white base (tinted by the material colour) with a
// fine basket weave, plus a matching normal map so the weave catches light.
export function canvasWeave() {
  const N = 128;
  const [c, g] = canvas(N, N);
  const [cn, gn] = canvas(N, N);
  const img = g.createImageData(N, N);
  const nrm = gn.createImageData(N, N);
  const r = rng(11);
  const cell = 8;
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const cx = Math.floor(x / cell), cy = Math.floor(y / cell);
      const warp = (cx + cy) % 2 === 0; // which thread is on top
      const u = (x % cell) / cell, v = (y % cell) / cell;
      const across = warp ? u : v;
      const bump = Math.sin(across * Math.PI); // rounded thread
      const shade = 0.86 + 0.1 * bump + (r() - 0.5) * 0.05;
      const i = (y * N + x) * 4;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = Math.min(255, shade * 255);
      img.data[i + 3] = 255;
      const slope = Math.cos(across * Math.PI) * 0.45;
      const nx = warp ? -slope : 0, ny = warp ? 0 : -slope;
      nrm.data[i] = (nx * 0.5 + 0.5) * 255;
      nrm.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      nrm.data[i + 2] = 255;
      nrm.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  gn.putImageData(nrm, 0, 0);
  const map = finish(c);
  const normal = finish(cn);
  normal.colorSpace = THREE.NoColorSpace;
  return { map, normal };
}

export function floralTexture(bg, flower) {
  const r = rng(21);
  const [c, g] = canvas(256, 256);
  g.fillStyle = bg;
  g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 26; i++) {
    const x = r() * 256;
    const y = r() * 256;
    const s = 8 + r() * 10;
    g.fillStyle = '#2e6b3a';
    g.beginPath();
    g.ellipse(x + s, y + s * 0.4, s * 1.2, s * 0.45, r() * 3, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = flower;
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      g.beginPath();
      g.ellipse(x + Math.cos(a) * s * 0.6, y + Math.sin(a) * s * 0.6, s * 0.55, s * 0.32, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = '#ffe27a';
    g.beginPath();
    g.arc(x, y, s * 0.22, 0, Math.PI * 2);
    g.fill();
  }
  return finish(c, [2, 2]);
}
