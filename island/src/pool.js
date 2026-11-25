// The Palmera Cay pool: a stone terrace inland of the beach with a pool set
// into it, a twisting water slide, a diving board, a lifeguard chair,
// loungers (mostly reserved) and inflatables. Swimming works as in the sea:
// the player asks world.poolSurface() for the water level.
import * as THREE from 'three';
import { height } from './terrain.js';
import { texMaterial } from './assets.js';
import { placeLounger, makePlant } from './props.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { canvasWeave } from './textures.js';
import { EYE } from './player.js';

// Terrace and pool rectangles, relative to the pool centre (L.pool).
const DECK = { x0: -17, x1: 17, z0: -12, z1: 12 };
const POOL = { x0: -12, x1: 10, z0: -7, z1: 5 };
const DEEP_X = 1; // pool x (relative) where the deep end starts
const STAIRS_X = 0; // stairs down to the beach path, on the south side

function canvasTex(w, h, draw, repeat = [1, 1]) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.anisotropy = 8;
  return t;
}

// Deterministic random numbers, so textures look the same every visit.
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

// A tangent-space normal map from a height field (Float32Array, size x size).
function heightToNormal(H, size, strength = 2) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const img = g.createImageData(size, size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / l * 0.5 + 0.5) * 255;
      img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255;
      img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

// Glass mosaic: n x n small tiles per texture (about 5 cm at the 1.6 m repeat
// used for boxes), with grout, slight colour variation and a matching normal
// map so the grout lines catch the light.
function mosaic(colors, { n = 32, grout = '#d9e6e8', seed = 1 } = {}) {
  const size = 512;
  const s = size / n;
  const r = seeded(seed);
  const H = new Float32Array(size * size);
  const map = canvasTex(size, size, (g) => {
    g.fillStyle = grout;
    g.fillRect(0, 0, size, size);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const col = new THREE.Color(colors[Math.floor(r() * colors.length)]);
        col.multiplyScalar(0.92 + r() * 0.14);
        const x0 = i * s + 1.5;
        const y0 = j * s + 1.5;
        const grad = g.createLinearGradient(x0, y0, x0 + s, y0 + s);
        grad.addColorStop(0, `#${col.clone().multiplyScalar(1.08).getHexString()}`);
        grad.addColorStop(1, `#${col.getHexString()}`);
        g.fillStyle = grad;
        g.fillRect(x0, y0, s - 3, s - 3);
      }
    }
  });
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x % s) / s;
      const fy = (y % s) / s;
      const e = Math.min(fx, fy, 1 - fx, 1 - fy) * s; // distance to the tile edge in pixels
      H[y * size + x] = Math.min(1, Math.max(0, (e - 1) / 2));
    }
  }
  return { map, normal: heightToNormal(H, size, 0.6) };
}

// Travertine pavers: 60 cm stones in a running bond with soft veining,
// little pits and recessed joints (two stones per 1.2 m texture repeat).
function travertine(seed = 3) {
  const size = 512;
  const half = size / 2;
  const r = seeded(seed);
  const H = new Float32Array(size * size).fill(1);
  const map = canvasTex(size, size, (g) => {
    g.fillStyle = '#b9a98c';
    g.fillRect(0, 0, size, size);
    for (let row = 0; row < 2; row++) {
      for (let k = -1; k < 2; k++) {
        const x0 = k * half + (row ? half / 2 : 0);
        const y0 = row * half;
        const v = 0.93 + r() * 0.1;
        g.fillStyle = `rgb(${(232 * v) | 0},${(219 * v) | 0},${(193 * v) | 0})`;
        g.fillRect(x0 + 2, y0 + 2, half - 4, half - 4);
        // Veins: soft wavy bands running along the stone.
        g.save();
        g.beginPath();
        g.rect(x0 + 2, y0 + 2, half - 4, half - 4);
        g.clip();
        for (let i = 0; i < 9; i++) {
          const y = y0 + r() * half;
          g.strokeStyle = r() < 0.5 ? `rgba(170,145,105,${0.08 + r() * 0.12})` : `rgba(255,250,238,${0.1 + r() * 0.15})`;
          g.lineWidth = 1 + r() * 4;
          g.beginPath();
          g.moveTo(x0, y);
          for (let x = 0; x <= half; x += 16) g.lineTo(x0 + x, y + Math.sin(x * 0.03 + i) * 5 + (r() - 0.5) * 3);
          g.stroke();
        }
        for (let i = 0; i < 60; i++) {
          g.fillStyle = `rgba(120,100,70,${0.15 + r() * 0.25})`;
          g.beginPath();
          g.ellipse(x0 + r() * half, y0 + r() * half, 0.6 + r() * 2.2, 0.4 + r() * 1.2, 0, 0, Math.PI * 2);
          g.fill();
        }
        g.restore();
      }
    }
  });
  for (let y = 0; y < size; y++) {
    const row = y < half ? 0 : 1;
    const fy = y % half;
    for (let x = 0; x < size; x++) {
      const fx = (x - (row ? half / 2 : 0) + size) % half;
      const e = Math.min(fx, fy, half - fx, half - fy);
      H[y * size + x] = Math.min(1, Math.max(0, (e - 1.5) / 2.5));
    }
  }
  return { map, normal: heightToNormal(H, size, 1.0) };
}

// Dressed limestone blocks for the terrace walls: 80 x 40 cm stones in
// staggered courses, each a slightly different warm cream, with recessed
// mortar joints (the texture covers 1.6 m, the repeat used for boxes).
function ashlar(seed = 11) {
  const size = 512;
  const cols = 2;
  const rows = 4;
  const bw = size / cols;
  const bh = size / rows;
  const r = seeded(seed);
  const H = new Float32Array(size * size);
  const map = canvasTex(size, size, (g) => {
    g.fillStyle = '#cbbd9f';
    g.fillRect(0, 0, size, size);
    for (let j = 0; j < rows; j++) {
      const off = j % 2 ? bw / 2 : 0;
      for (let i = -1; i < cols; i++) {
        const x0 = i * bw + off;
        const y0 = j * bh;
        const v = 0.9 + r() * 0.14;
        const warm = r() * 10;
        g.fillStyle = `rgb(${(236 * v) | 0},${((224 - warm) * v) | 0},${((198 - warm * 1.5) * v) | 0})`;
        g.fillRect(x0 + 3, y0 + 3, bw - 6, bh - 6);
        g.save();
        g.beginPath();
        g.rect(x0 + 3, y0 + 3, bw - 6, bh - 6);
        g.clip();
        // Fossil flecks and gentle weathering, darker toward the bottom.
        for (let k = 0; k < 90; k++) {
          g.fillStyle = `rgba(${r() < 0.6 ? '140,118,84' : '255,252,240'},${0.08 + r() * 0.18})`;
          g.beginPath();
          g.ellipse(x0 + r() * bw, y0 + r() * bh, 0.6 + r() * 2.4, 0.5 + r() * 1.4, r() * 3, 0, Math.PI * 2);
          g.fill();
        }
        const grad = g.createLinearGradient(0, y0, 0, y0 + bh);
        grad.addColorStop(0, 'rgba(255,255,255,0.06)');
        grad.addColorStop(1, 'rgba(110,90,60,0.12)');
        g.fillStyle = grad;
        g.fillRect(x0, y0, bw, bh);
        g.restore();
      }
    }
  });
  for (let y = 0; y < size; y++) {
    const j = Math.floor(y / bh);
    const off = j % 2 ? bw / 2 : 0;
    const fy = y % bh;
    for (let x = 0; x < size; x++) {
      const fx = (x - off + size) % bw;
      const e = Math.min(fx, fy, bw - fx, bh - fy);
      // Slightly pillowed faces: highest in the middle of each stone.
      H[y * size + x] = Math.min(1, Math.max(0, (e - 2) / 3)) * (0.85 + 0.15 * Math.min(1, e / 30));
    }
  }
  return { map, normal: heightToNormal(H, size, 1.4) };
}

// Pool caustics: bright, thin cell borders (a tileable Voronoi F2 - F1).
function causticTexture() {
  const N = 256;
  const r = seeded(7);
  const pts = Array.from({ length: 18 }, () => [r() * N, r() * N]);
  return canvasTex(N, N, (g) => {
    const img = g.createImageData(N, N);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let f1 = 1e9;
        let f2 = 1e9;
        for (const [px, py] of pts) {
          for (let ox = -N; ox <= N; ox += N) {
            for (let oy = -N; oy <= N; oy += N) {
              const d = Math.hypot(x - px - ox, y - py - oy);
              if (d < f1) {
                f2 = f1;
                f1 = d;
              } else if (d < f2) f2 = d;
            }
          }
        }
        const v = Math.pow(Math.max(0, 1 - (f2 - f1) / 9), 2.2) * 255;
        const i = (y * N + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
        img.data[i + 3] = 255;
      }
    }
    g.putImageData(img, 0, 0);
  });
}

// Gentle ripples for the water surface.
function rippleNormal() {
  const N = 128;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  const img = g.createImageData(N, N);
  const wav = [];
  for (let i = 0; i < 6; i++) wav.push({ kx: Math.round((Math.random() - 0.5) * 8), ky: Math.round((Math.random() - 0.5) * 8) || 1, ph: Math.random() * 6.28, a: 0.25 + Math.random() * 0.3 });
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      let dx = 0;
      let dy = 0;
      for (const w of wav) {
        const p = ((w.kx * x + w.ky * y) / N) * Math.PI * 2 + w.ph;
        dx += Math.cos(p) * w.kx * w.a * 0.05;
        dy += Math.cos(p) * w.ky * w.a * 0.05;
      }
      const i = (y * N + x) * 4;
      img.data[i] = (0.5 - dx * 0.5) * 255;
      img.data[i + 1] = (0.5 - dy * 0.5) * 255;
      img.data[i + 2] = 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(4, 2.5);
  return t;
}

function stripeBall(colors) {
  return canvasTex(256, 128, (g, w, h) => {
    colors.forEach((c, i) => {
      g.fillStyle = c;
      g.fillRect((i * w) / colors.length, 0, w / colors.length + 1, h);
    });
  });
}

// An open half-pipe swept along a curve (the water slide).
function halfPipe(curve, radius, segs = 160, around = 14) {
  const pos = [];
  const uv = [];
  const idx = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i <= segs; i++) {
    const u = i / segs;
    const p = curve.getPointAt(u);
    const tng = curve.getTangentAt(u);
    const side = new THREE.Vector3().crossVectors(tng, up).normalize();
    const down = new THREE.Vector3().crossVectors(side, tng).normalize().negate();
    for (let j = 0; j <= around; j++) {
      const a = Math.PI * (j / around); // 0..pi: from one rim, under, to the other
      const v = new THREE.Vector3().copy(p).addScaledVector(side, Math.cos(a) * radius).addScaledVector(down, Math.sin(a) * radius);
      pos.push(v.x, v.y, v.z);
      uv.push(j / around, u * curve.getLength() * 0.5);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < around; j++) {
      const a = i * (around + 1) + j;
      const b = a + around + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function flamingo() {
  const pink = new THREE.MeshStandardMaterial({ color: 0xff7fb0, roughness: 0.25, metalness: 0.05 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.4 });
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.26, 14, 28), pink);
  body.rotation.x = Math.PI / 2;
  body.scale.set(1, 1.25, 1);
  g.add(body);
  const neckCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.15, 0.7), new THREE.Vector3(0, 0.8, 0.95), new THREE.Vector3(0, 1.3, 0.75), new THREE.Vector3(0, 1.4, 0.95)]);
  g.add(new THREE.Mesh(new THREE.TubeGeometry(neckCurve, 24, 0.1, 10), pink));
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 14, 10), pink);
  head.position.set(0, 1.42, 1.0);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 10), dark);
  beak.position.set(0, 1.36, 1.2);
  beak.rotation.x = Math.PI / 2 + 0.5;
  g.add(beak);
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.4, 10), pink);
  tail.position.set(0, 0.3, -0.85);
  tail.rotation.x = -Math.PI / 2 - 0.4;
  g.add(tail);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

export class Pool {
  constructor(scene, world, L) {
    this.scene = scene;
    this.world = world;
    const c = L.pool;
    this.c = c;
    const X = (v) => c.x + v;
    const Z = (v) => c.z + v;

    // Levels: the deep floor sits just above the highest ground under the
    // terrace; everything else stacks up from there.
    let gmax = -Infinity;
    let gmin = Infinity;
    for (let i = 0; i <= 12; i++) {
      for (let j = 0; j <= 10; j++) {
        const h = height(X(DECK.x0 + ((DECK.x1 - DECK.x0) * i) / 12), Z(DECK.z0 + ((DECK.z1 - DECK.z0) * j) / 10));
        gmax = Math.max(gmax, h);
        gmin = Math.min(gmin, h);
      }
    }
    const floorDeep = gmax + 0.15;
    this.surface = floorDeep + 1.9;
    this.deck = this.surface + 0.15;
    const floorShallow = this.surface - 1.05;
    this.floorShallow = floorShallow;
    this.floorDeep = floorDeep;
    this.rect = { x0: X(POOL.x0), x1: X(POOL.x1), z0: Z(POOL.z0), z1: Z(POOL.z1) };
    this.deckRect = { x0: X(DECK.x0), x1: X(DECK.x1), z0: Z(DECK.z0), z1: Z(DECK.z1) };
    world.poolSurface = (x, z) => (this.inPool(x, z) ? this.surface : null);
    this.surfaceY = this.surface;

    const grp = new THREE.Group();
    scene.add(grp);
    this.grp = grp;
    const box = (w, h, d, mat, x, y, z) => world.box(w, h, d, mat, x, y, z, grp);

    // ---------------------------------------------------- materials
    const trav = travertine();
    const deckMat = new THREE.MeshStandardMaterial({ map: trav.map, normalMap: trav.normal, color: 0xe8e2d8, roughness: 0.72 });
    deckMat.normalScale.set(0.8, 0.8);
    const ash = ashlar();
    const stone = new THREE.MeshStandardMaterial({ map: ash.map, normalMap: ash.normal, roughness: 0.85 });
    // Pale aqua glass mosaic for the basin, with moving caustic light on it
    // below the waterline (in world space, so it runs across floor and walls).
    this.caustics = causticTexture();
    this.cu = {
      uCaus: { value: this.caustics },
      uOff1: { value: new THREE.Vector2() },
      uOff2: { value: new THREE.Vector2() },
      uSurf: { value: 0 },
      uCStr: { value: 1 },
      uGlow: { value: 0 },
    };
    const tiles = mosaic(['#e9f6f7', '#d3eef2', '#bfe6ee', '#a9dce8', '#f4fbfb'], { seed: 2 });
    const tileMat = new THREE.MeshStandardMaterial({ map: tiles.map, normalMap: tiles.normal, roughness: 0.12 });
    tileMat.normalScale.set(0.5, 0.5);
    tileMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.cu);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCW;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvCW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vCW;\nuniform sampler2D uCaus;\nuniform vec2 uOff1, uOff2;\nuniform float uSurf, uCStr, uGlow;')
        .replace(
          '#include <emissivemap_fragment>',
          `#include <emissivemap_fragment>
          float under = 1.0 - smoothstep(uSurf - 0.05, uSurf + 0.02, vCW.y);
          vec2 cuv = vCW.xz * 0.42 + vec2(vCW.y * 0.15);
          float c1 = texture2D(uCaus, cuv + uOff1).r;
          float c2 = texture2D(uCaus, cuv * 1.37 + uOff2).r;
          totalEmissiveRadiance += diffuseColor.rgb * (vec3(0.85, 1.0, 1.0) * min(c1, c2) * 2.6 * uCStr + vec3(0.25, 0.8, 1.0) * uGlow) * under;`
        );
    };
    tileMat.customProgramCacheKey = () => 'pooltiles';
    this.tileMat = tileMat;
    const bandTiles = mosaic(['#0b3d6b', '#12528a', '#1d6fa5', '#0e4778', '#2a83b8'], { seed: 5, grout: '#c9d6dc' });
    const bandMat = new THREE.MeshStandardMaterial({ map: bandTiles.map, normalMap: bandTiles.normal, roughness: 0.1 });
    const navy = new THREE.MeshStandardMaterial({ color: 0x123f6b, roughness: 0.3 });
    const coping = new THREE.MeshStandardMaterial({ map: trav.map, normalMap: trav.normal, color: 0xfff6e6, roughness: 0.6 });
    const white = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.45 });
    const steel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.2, metalness: 0.9 });
    const red = new THREE.MeshStandardMaterial({ color: 0xd62828, roughness: 0.5 });

    // ---------------------------------------------------- terrace
    // Deck strips around the pool (walkable), on a stone base down to the ground.
    const base = gmin - 0.6;
    const strips = [
      [DECK.x0, DECK.x1, DECK.z0, POOL.z0],
      [DECK.x0, DECK.x1, POOL.z1, DECK.z1],
      [DECK.x0, POOL.x0, POOL.z0, POOL.z1],
      [POOL.x1, DECK.x1, POOL.z0, POOL.z1],
    ];
    for (const [x0, x1, z0, z1] of strips) {
      const w = x1 - x0;
      const d = z1 - z0;
      // Paved top, with UVs every 1.2 m.
      const top = box(w, 0.2, d, deckMat, X((x0 + x1) / 2), this.deck - 0.1, Z((z0 + z1) / 2));
      const uv = top.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * 1.6) / 1.2, (uv.getY(i) * 1.6) / 1.2);
      world.platforms.push({ x0: X(x0), x1: X(x1), z0: Z(z0), z1: Z(z1), y: this.deck });
    }
    // Outer retaining walls (stone), with a gap on the south side for stairs.
    const wallH = this.deck - 0.2 - base;
    const wy = base + wallH / 2;
    const T = 0.5;
    box(DECK.x1 - DECK.x0, wallH, T, stone, X(0), wy, Z(DECK.z0 + T / 2));
    box(T, wallH, DECK.z1 - DECK.z0, stone, X(DECK.x0 + T / 2), wy, Z(0));
    box(T, wallH, DECK.z1 - DECK.z0, stone, X(DECK.x1 - T / 2), wy, Z(0));
    const gap = 1.8;
    box(STAIRS_X - gap - DECK.x0, wallH, T, stone, X((DECK.x0 + STAIRS_X - gap) / 2), wy, Z(DECK.z1 - T / 2));
    box(DECK.x1 - STAIRS_X - gap, wallH, T, stone, X((DECK.x1 + STAIRS_X + gap) / 2), wy, Z(DECK.z1 - T / 2));
    // A pale stone cap along the top of the walls, overhanging a little.
    const capY = this.deck - 0.11;
    const capMat = new THREE.MeshStandardMaterial({ map: trav.map, normalMap: trav.normal, color: 0xf6efe2, roughness: 0.6 });
    box(DECK.x1 - DECK.x0 + 0.24, 0.22, 0.12, capMat, X(0), capY, Z(DECK.z0 - 0.04));
    box(0.12, 0.22, DECK.z1 - DECK.z0 + 0.24, capMat, X(DECK.x0 - 0.04), capY, Z(0));
    box(0.12, 0.22, DECK.z1 - DECK.z0 + 0.24, capMat, X(DECK.x1 + 0.04), capY, Z(0));
    box(STAIRS_X - gap - DECK.x0 + 0.12, 0.22, 0.12, capMat, X((DECK.x0 - 0.12 + STAIRS_X - gap) / 2), capY, Z(DECK.z1 + 0.04));
    box(DECK.x1 - STAIRS_X - gap + 0.12, 0.22, 0.12, capMat, X((DECK.x1 + 0.12 + STAIRS_X + gap) / 2), capY, Z(DECK.z1 + 0.04));
    // Tropical planting along the foot of the walls, to soften them.
    this.footPlants = [];
    const footKinds = ['Monstera', 'Fern', 'Banana', 'Fern', 'Monstera', 'Palm'];
    const footSize = { Monstera: 1.4, Fern: 0.9, Banana: 2.8, Palm: 2.4 };
    let fk = 0;
    const footRun = (ax, az, bx, bz, ox, oz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(len / 3.2);
      for (let i = 0; i <= n; i++) {
        const u = n ? i / n : 0.5;
        const kind = footKinds[fk % footKinds.length];
        // Far enough out that the leaves don't reach into the wall.
        const out = { Fern: 1.0, Monstera: 1.4, Banana: 1.7, Palm: 2.1 }[kind] + (fk % 3) * 0.15;
        const x = X(ax + (bx - ax) * u) + ox * out;
        const z = Z(az + (bz - az) * u) + oz * out;
        if (Math.abs(x - X(STAIRS_X)) < 3.4 && z > Z(DECK.z1)) {
          fk++;
          continue; // keep the stairs clear
        }
        const p = makePlant(kind, 1, fk);
        fk++;
        if (!p) continue;
        p.scale.setScalar(footSize[kind] / p.userData.height);
        p.position.set(x, height(x, z) - 0.05, z);
        p.rotation.y = fk * 2.1;
        grp.add(p);
      }
    };
    footRun(DECK.x0 + 2.5, DECK.z1, DECK.x1 - 2.5, DECK.z1, 0, 1);
    footRun(DECK.x1, DECK.z0 + 2.5, DECK.x1, DECK.z1 - 2.5, 1, 0);
    footRun(DECK.x0, DECK.z0 + 2.5, DECK.x0, DECK.z1 - 2.5, -1, 0);
    footRun(DECK.x0 + 2.5, DECK.z0, DECK.x1 - 2.5, DECK.z0, 0, -1);
    // Keep people from walking into the walls from outside.
    const wallTop = this.deck - 0.4;
    const ring = (x0, x1, z0, z1) => world.colliders.push({ x0: X(x0), x1: X(x1), z0: Z(z0), z1: Z(z1), y: wallTop });
    ring(DECK.x0 - 0.2, DECK.x1 + 0.2, DECK.z0 - 0.2, DECK.z0 + T);
    ring(DECK.x0 - 0.2, DECK.x0 + T, DECK.z0, DECK.z1);
    ring(DECK.x1 - T, DECK.x1 + 0.2, DECK.z0, DECK.z1);
    ring(DECK.x0 - 0.2, STAIRS_X - gap, DECK.z1 - T, DECK.z1 + 0.2);
    ring(STAIRS_X + gap, DECK.x1 + 0.2, DECK.z1 - T, DECK.z1 + 0.2);
    // Under-deck block: anything below the deck that isn't in the pool is solid.
    for (const [x0, x1, z0, z1] of strips) world.colliders.push({ x0: X(x0), x1: X(x1), z0: Z(z0), z1: Z(z1), y: this.deck - 0.4, yMin: base - 5 });
    // Stairs down to the path.
    const sx = X(STAIRS_X);
    const sz0 = Z(DECK.z1);
    const groundAtFoot = height(sx, sz0 + 7);
    const run = Math.max(4, (this.deck - groundAtFoot) * 2.2);
    const steps = Math.ceil((this.deck - groundAtFoot) / 0.18);
    for (let i = 0; i < steps; i++) {
      const y = this.deck - (i + 1) * ((this.deck - groundAtFoot) / steps);
      const z = sz0 + (i + 0.5) * (run / steps);
      box(gap * 2, Math.max(0.2, y - base + 0.2), run / steps + 0.02, deckMat, sx, (y + base) / 2, z);
    }
    world.platforms.push({ x0: sx - gap, x1: sx + gap, z0: sz0, z1: sz0 + run, y0: this.deck, y: groundAtFoot });
    for (const side of [-1, 1]) {
      // Handrails.
      const a = new THREE.Vector3(sx + side * (gap - 0.1), this.deck + 0.9, sz0);
      const b = new THREE.Vector3(sx + side * (gap - 0.1), groundAtFoot + 0.9, sz0 + run);
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, a.distanceTo(b), 8), steel);
      rail.position.copy(a).add(b).multiplyScalar(0.5);
      rail.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      grp.add(rail);
    }
    this.stairsFoot = { x: sx, z: sz0 + run + 0.5 };

    // ---------------------------------------------------- pool basin
    const pw = POOL.x1 - POOL.x0;
    const pd = POOL.z1 - POOL.z0;
    // Floors: shallow end, two steps down, deep end.
    const floors = [
      [POOL.x0, DEEP_X - 2, floorShallow],
      [DEEP_X - 2, DEEP_X - 1, floorShallow - 0.3],
      [DEEP_X - 1, DEEP_X, floorShallow - 0.6],
      [DEEP_X, POOL.x1, floorDeep],
    ];
    for (const [x0, x1, y] of floors) {
      box(x1 - x0, 0.2, pd, tileMat, X((x0 + x1) / 2), y - 0.1, Z((POOL.z0 + POOL.z1) / 2));
      world.platforms.push({ x0: X(x0), x1: X(x1), z0: Z(POOL.z0), z1: Z(POOL.z1), y });
    }
    // Entry steps at the shallow end (each under 0.6 m, so you can walk out).
    const stepW = 6;
    const sz = (POOL.z0 + POOL.z1) / 2;
    const rise = (this.deck - floorShallow) / 3;
    for (let i = 1; i <= 2; i++) {
      const y = floorShallow + rise * i;
      const x0 = POOL.x0;
      const x1 = POOL.x0 + (3 - i) * 0.8;
      box(x1 - x0, y - floorShallow + 0.2, stepW, tileMat, X((x0 + x1) / 2), (y + floorShallow - 0.2) / 2, Z(sz));
      // Dark tiles along each step's edge, so you can see it underwater.
      box(0.12, 0.04, stepW + 0.01, navy, X(x1 - 0.06), y + 0.003, Z(sz));
      box(0.02, 0.12, stepW + 0.01, navy, X(x1 + 0.005), y - 0.06, Z(sz));
      world.platforms.push({ x0: X(x0), x1: X(x1), z0: Z(sz - stepW / 2), z1: Z(sz + stepW / 2), y });
    }
    // Walls: tiled inside, from the deep floor up to the coping.
    const wallTopY = this.deck - 0.2;
    const pwH = wallTopY - floorDeep + 0.2;
    const pwy = floorDeep - 0.2 + pwH / 2;
    box(pw, pwH, 0.2, tileMat, X((POOL.x0 + POOL.x1) / 2), pwy, Z(POOL.z0 - 0.1));
    box(pw, pwH, 0.2, tileMat, X((POOL.x0 + POOL.x1) / 2), pwy, Z(POOL.z1 + 0.1));
    box(0.2, pwH, pd + 0.4, tileMat, X(POOL.x0 - 0.1), pwy, Z(sz));
    box(0.2, pwH, pd + 0.4, tileMat, X(POOL.x1 + 0.1), pwy, Z(sz));
    // Coping: pale stone round the rim, with a rounded (bullnose) edge that
    // overhangs the water a little.
    const cx = X((POOL.x0 + POOL.x1) / 2);
    const nose = (len, x, z, alongX) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, len, 12, 1), coping);
      m.rotation.set(alongX ? 0 : Math.PI / 2, 0, alongX ? Math.PI / 2 : 0);
      m.position.set(x, this.deck + 0.005, z);
      m.castShadow = m.receiveShadow = true;
      grp.add(m);
    };
    box(pw + 0.9, 0.09, 0.45, coping, cx, this.deck + 0.005, Z(POOL.z0 - 0.225));
    box(pw + 0.9, 0.09, 0.45, coping, cx, this.deck + 0.005, Z(POOL.z1 + 0.225));
    box(0.45, 0.09, pd, coping, X(POOL.x0 - 0.225), this.deck + 0.005, Z(sz));
    box(0.45, 0.09, pd, coping, X(POOL.x1 + 0.225), this.deck + 0.005, Z(sz));
    nose(pw, cx, Z(POOL.z0) + 0.01, true);
    nose(pw, cx, Z(POOL.z1) - 0.01, true);
    nose(pd, X(POOL.x0) + 0.01, Z(sz), false);
    nose(pd, X(POOL.x1) - 0.01, Z(sz), false);
    // Waterline band of dark-blue mosaic, just in front of the walls.
    const bandH = 0.34;
    const by = this.deck - 0.04 - bandH / 2;
    box(pw, bandH, 0.02, bandMat, cx, by, Z(POOL.z0) + 0.012);
    box(pw, bandH, 0.02, bandMat, cx, by, Z(POOL.z1) - 0.012);
    box(0.02, bandH, pd, bandMat, X(POOL.x0) + 0.012, by, Z(sz));
    box(0.02, bandH, pd, bandMat, X(POOL.x1) - 0.012, by, Z(sz));
    // Lane lines on the floor, with T-ends.
    for (const lz of [-2.6, 0.6, 3.6].map((v) => v * (pd / 12))) {
      const zc = Z(sz + lz);
      box(DEEP_X - 2 - POOL.x0 - 2.4, 0.01, 0.22, navy, X((POOL.x0 + 1.2 + DEEP_X - 2 - 1.2) / 2), floorShallow + 0.006, zc);
      box(POOL.x1 - DEEP_X - 2.0, 0.01, 0.22, navy, X((DEEP_X + 1.0 + POOL.x1 - 1.0) / 2), floorDeep + 0.006, zc);
      box(0.22, 0.01, 0.9, navy, X(POOL.x1 - 1.0), floorDeep + 0.006, zc);
    }
    // Underwater lights in the long walls.
    const lampMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdff8ff, emissiveIntensity: 0.6, roughness: 0.2 });
    this.lampMat = lampMat;
    for (const lx of [-8, -2, 5]) {
      for (const [lz, ry] of [[POOL.z0 + 0.03, 0], [POOL.z1 - 0.03, Math.PI]]) {
        const fy = lx < DEEP_X ? floorShallow : floorDeep;
        const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), lampMat);
        lamp.position.set(X(lx), Math.min(this.surface - 0.45, fy + 0.5), Z(lz));
        lamp.rotation.y = ry;
        grp.add(lamp);
      }
    }
    // Swimmers can't pass through the pool walls.
    const pr = (x0, x1, z0, z1) => world.colliders.push({ x0: X(x0), x1: X(x1), z0: Z(z0), z1: Z(z1), y: this.surface - 0.25 });
    pr(POOL.x0 - 0.6, POOL.x1 + 0.6, POOL.z0 - 0.6, POOL.z0);
    pr(POOL.x0 - 0.6, POOL.x1 + 0.6, POOL.z1, POOL.z1 + 0.6);
    pr(POOL.x0 - 0.6, POOL.x0, POOL.z0, POOL.z1);
    pr(POOL.x1, POOL.x1 + 0.6, POOL.z0, POOL.z1);
    // Depth markings.
    const mark = (txt, x, z, rot) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.3), new THREE.MeshStandardMaterial({ map: this.text(txt), transparent: true, roughness: 0.6 }));
      m.rotation.set(-Math.PI / 2, 0, rot);
      m.position.set(X(x), this.deck + 0.075, Z(z));
      grp.add(m);
    };
    mark('1.0 m', POOL.x0 + 2, POOL.z1 + 0.2, 0);
    mark('1.9 m', POOL.x1 - 2, POOL.z1 + 0.2, 0);
    mark('NO DIVING', POOL.x0 + 2, POOL.z0 - 0.2, Math.PI);
    // Ladder at the deep end.
    for (const dz of [-0.3, 0.3]) {
      const lx = X(POOL.x1 - 0.25);
      const lz = Z(POOL.z1 - 1.8 + dz); // south side, clear of the slide and the board
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 16, Math.PI), steel);
      r.position.set(lx + 0.25, this.deck + 0.05, lz);
      r.rotation.y = Math.PI / 2;
      grp.add(r);
      world.cyl(0.03, 0.03, this.deck - floorDeep, steel, lx - 0.1, (this.deck + floorDeep) / 2, lz, grp, 8);
    }

    // ---------------------------------------------------- water
    this.ripples = rippleNormal();
    // Water: reflects the sky at a glance and turns clear when you look
    // straight down (Fresnel), deeper blue over the deep end, with two layers
    // of ripples drifting in different directions.
    this.wu = {
      uW1: { value: new THREE.Vector2() },
      uW2: { value: new THREE.Vector2() },
      uShallow: { value: new THREE.Color(0x21aacb) },
      uDeep: { value: new THREE.Color(0x0a6aa3) },
      uX0: { value: X(DEEP_X - 2.5) },
      uX1: { value: X(DEEP_X + 3) },
    };
    const waterMat = new THREE.MeshStandardMaterial({ color: 0x5fd3e3, transparent: true, roughness: 0.03, metalness: 0, normalMap: this.ripples, normalScale: new THREE.Vector2(0.3, 0.3), depthWrite: false, envMapIntensity: 1.25 });
    waterMat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, this.wu);
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWP;\nuniform vec2 uW1, uW2;\nuniform vec3 uShallow, uDeep;\nuniform float uX0, uX1;')
        .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb = mix(uShallow, uDeep, smoothstep(uX0, uX1, vWP.x));')
        .replace(
          'vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;',
          'vec3 mapN = normalize(vec3((texture2D(normalMap, vNormalMapUv + uW1).xy * 2.0 - 1.0) + (texture2D(normalMap, vNormalMapUv * 2.6 + uW2).xy * 2.0 - 1.0) * 0.7, 1.0));'
        )
        .replace(
          '#include <opaque_fragment>',
          `float fres = pow(1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))), 3.0);
          diffuseColor.a = mix(0.58, 0.97, fres);
          #include <opaque_fragment>`
        );
    };
    waterMat.customProgramCacheKey = () => 'poolwater';
    const water = new THREE.Mesh(new THREE.PlaneGeometry(pw, pd), waterMat);
    water.rotation.x = -Math.PI / 2;
    water.position.set(X((POOL.x0 + POOL.x1) / 2), this.surface, Z(sz));
    water.renderOrder = 2;
    grp.add(water);
    this.water = water;
    // The same surface seen from underneath.
    const under = new THREE.Mesh(water.geometry, new THREE.MeshBasicMaterial({ color: 0x9fe8f4, transparent: true, opacity: 0.45, side: THREE.BackSide, depthWrite: false }));
    this.under = under;
    under.rotation.x = -Math.PI / 2;
    under.position.copy(water.position);
    grp.add(under);

    // ---------------------------------------------------- water slide
    const d = this.deck;
    const sxp = (v) => X(v);
    const top = new THREE.Vector3(sxp(14.5), d + 4.4, Z(9));
    const pts = [
      top,
      new THREE.Vector3(sxp(15.6), d + 4.0, Z(6.5)),
      new THREE.Vector3(sxp(15.4), d + 3.5, Z(3)),
      new THREE.Vector3(sxp(14.2), d + 3.0, Z(0)),
      new THREE.Vector3(sxp(15.6), d + 2.5, Z(-3)),
      new THREE.Vector3(sxp(14.8), d + 2.0, Z(-5.4)),
      new THREE.Vector3(sxp(12.4), d + 1.5, Z(-5.6)),
      new THREE.Vector3(sxp(10.8), d + 1.15, Z(-4.9)),
      // Stay high until clear of the pool edge, then drop to the water.
      new THREE.Vector3(sxp(9.2), d + 0.7, Z(-4.4)),
      new THREE.Vector3(sxp(7.6), this.surface + 0.25, Z(-4.1)),
    ];
    this.slide = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    const slideMat = new THREE.MeshPhysicalMaterial({ color: 0x1a9fdb, roughness: 0.25, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
    const slideMesh = new THREE.Mesh(halfPipe(this.slide, 0.55), slideMat);
    slideMesh.castShadow = true;
    slideMesh.receiveShadow = true;
    grp.add(slideMesh);
    // A trickle of water down the slide.
    const trickle = new THREE.Mesh(halfPipe(this.slide, 0.5, 160, 8), new THREE.MeshStandardMaterial({ color: 0xbff3ff, transparent: true, opacity: 0.35, roughness: 0.05, normalMap: this.ripples, depthWrite: false }));
    trickle.position.y = -0.02;
    grp.add(trickle);
    // Supports: posts from the deck up to the slide.
    const yellow = new THREE.MeshStandardMaterial({ color: 0xffc93c, roughness: 0.5 });
    for (const u of [0.18, 0.36, 0.52, 0.68, 0.82]) {
      const p = this.slide.getPointAt(u);
      if (!this.onDeck(p.x, p.z)) continue;
      const h = p.y - 0.55 - d;
      world.cyl(0.08, 0.08, h, yellow, p.x, d + h / 2, p.z, grp, 8);
    }
    // Tower: four posts, a platform and a ladder.
    const tw = 1.6;
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) world.cyl(0.08, 0.08, 4.6, yellow, top.x + ox * tw * 0.5, d + 2.3, top.z + oz * tw * 0.5 + 0.6, grp, 8);
    box(tw + 0.2, 0.15, tw + 0.2, deckMat, top.x, d + 4.3, top.z + 0.6);
    for (let i = 0; i < 12; i++) box(0.8, 0.05, 0.08, steel, top.x, d + 0.3 + i * 0.35, top.z + 0.6 + tw / 2 + 0.25);
    for (const ox of [-0.4, 0.4]) world.cyl(0.035, 0.035, 4.4, steel, top.x + ox, d + 2.2, top.z + 0.6 + tw / 2 + 0.25, grp, 6);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.5, 0.9, 4, 1, true), new THREE.MeshStandardMaterial({ color: 0xff6b35, roughness: 0.6, side: THREE.DoubleSide }));
    roof.position.set(top.x, d + 6.0, top.z + 0.6);
    roof.rotation.y = Math.PI / 4;
    grp.add(roof);
    world.colliders.push({ x: top.x, z: top.z + 0.6, r: 1.0, y: d + 4 });
    this.slideBase = { x: top.x - 1.4, z: top.z + 1.8 };

    // ---------------------------------------------------- diving board
    const bz = Z(-1);
    const bx0 = X(POOL.x1 + 4.5);
    const bx1 = X(POOL.x1 - 1.3);
    const board = box(bx0 - bx1, 0.08, 0.55, white, (bx0 + bx1) / 2, d + 0.55, bz);
    board.material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
    box(0.5, 0.55, 0.7, yellow, bx0 - 0.4, d + 0.27, bz);
    box(0.25, 0.3, 0.5, steel, X(POOL.x1 + 1.2), d + 0.35, bz);
    this.board = { x0: bx0, x1: bx1, z: bz, y: d + 0.6 };
    world.colliders.push({ x0: bx1 + 1.4, x1: bx0, z0: bz - 0.35, z1: bz + 0.35, y: d + 0.3 });

    // ---------------------------------------------------- lifeguard chair
    const lg = { x: X(-1), z: Z(POOL.z1 + 2.6) };
    for (const [ox, oz] of [[-0.45, -0.35], [0.45, -0.35], [-0.45, 0.35], [0.45, 0.35]]) world.cyl(0.05, 0.06, 2.1, white, lg.x + ox, d + 1.05, lg.z + oz, grp, 8);
    box(1.05, 0.08, 0.8, white, lg.x, d + 2.05, lg.z);
    box(1.05, 0.7, 0.08, white, lg.x, d + 2.4, lg.z + 0.4);
    for (let i = 0; i < 4; i++) box(0.9, 0.05, 0.06, white, lg.x, d + 0.4 + i * 0.45, lg.z - 0.36);
    // Red cross on the back of the chair.
    box(0.4, 0.12, 0.02, red, lg.x, d + 2.45, lg.z + 0.45);
    box(0.12, 0.4, 0.02, red, lg.x, d + 2.45, lg.z + 0.45);
    // A rescue ring hanging on it.
    const rescue = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.08, 10, 24), new THREE.MeshStandardMaterial({ map: stripeBall(['#e63946', '#ffffff', '#e63946', '#ffffff', '#e63946', '#ffffff', '#e63946', '#ffffff']), roughness: 0.5 }));
    rescue.position.set(lg.x + 0.62, d + 1.3, lg.z);
    rescue.rotation.y = Math.PI / 2;
    grp.add(rescue);
    world.colliders.push({ x: lg.x, z: lg.z, r: 0.7, y: d + 2 });
    this.lifeguard = lg;

    // ---------------------------------------------------- loungers and shade
    // Doris's four reserved loungers on the north deck, then a few free ones.
    this.loungers = [];
    const towelColors = [['#ff6b6b', '#ffffff'], ['#4d96ff', '#ffffff'], ['#ffd93d', '#ff6b6b'], ['#6bcb77', '#ffffff']];
    [-14.5, -12.2, -9.9, -7.6, -1.5, 0.8, 3.1].forEach((lx, i) => {
      const lgp = new THREE.Group();
      lgp.position.set(X(lx), d, Z(DECK.z0 + 2.7));
      lgp.rotation.y = Math.PI;
      grp.add(lgp);
      const reserved = i < 4;
      if (placeLounger(lgp, 0, 0, 0, reserved ? '#f1ebdd' : '#2f8f93', 1.95)) {
        if (reserved) {
          const towel = world.box(0.62, 0.025, 1.5, new THREE.MeshStandardMaterial({ map: stripeBall(towelColors[i]), roughness: 1 }), 0, 0.43, -0.2, lgp);
          towel.castShadow = false;
        }
      }
      world.colliders.push({ x: X(lx), z: Z(DECK.z0 + 2.7), r: 0.55, y: d + 0.5 });
      this.loungers.push({ x: X(lx), z: Z(DECK.z0 + 2.7), reserved });
    });
    // Market umbrellas: cream canvas on a teak pole, with ribs and a valance.
    const weave = canvasWeave();
    const canvasMat = new THREE.MeshStandardMaterial({ map: weave.map, normalMap: weave.normal, color: 0xf3ead6, roughness: 0.95, side: THREE.DoubleSide });
    const teak = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.7 });
    for (const ux of [-11, -0.4]) {
      const ug = new THREE.Group();
      ug.position.set(X(ux), d, Z(DECK.z0 + 1.6));
      grp.add(ug);
      this.world.cyl(0.035, 0.04, 2.75, teak, 0, 1.37, 0, ug, 10);
      this.world.cyl(0.28, 0.32, 0.1, new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.5 }), 0, 0.05, 0, ug, 16);
      const can = new THREE.Mesh(new THREE.ConeGeometry(2.25, 0.62, 8, 1, true), canvasMat);
      can.position.y = 2.55;
      can.rotation.y = Math.PI / 8;
      can.castShadow = true;
      ug.add(can);
      const val = new THREE.Mesh(new THREE.CylinderGeometry(2.25, 2.25, 0.16, 8, 1, true), canvasMat);
      val.position.y = 2.17;
      val.rotation.y = Math.PI / 8;
      ug.add(val);
      const finial = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), teak);
      finial.position.y = 2.9;
      ug.add(finial);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 2.3, 5), teak);
        rib.position.set(Math.cos(a) * 1.1, 2.5, Math.sin(a) * 1.1);
        rib.rotation.set(0, -a, Math.PI / 2 - 0.27);
        ug.add(rib);
      }
      world.shade.push({ x: X(ux), z: Z(DECK.z0 + 2.3), r: 2.4 });
    }

    // Planting: a long stone planter behind the loungers, big planters with
    // palms at two corners, and pots by the stairs.
    const soil = new THREE.MeshStandardMaterial({ color: 0x3b2a1c, roughness: 1 });
    const planter = (x0, x1, z0, z1, h = 0.5) => {
      box(x1 - x0, h, z1 - z0, stone, X((x0 + x1) / 2), d + h / 2, Z((z0 + z1) / 2));
      box(x1 - x0 - 0.16, 0.04, z1 - z0 - 0.16, soil, X((x0 + x1) / 2), d + h - 0.03, Z((z0 + z1) / 2));
      world.colliders.push({ x0: X(x0), x1: X(x1), z0: Z(z0), z1: Z(z1), y: d + h + 0.1 });
    };
    const plant = (kind, x, z, size, rot = 0, pick = 0, y = d + 0.48) => {
      const p = makePlant(kind, 1, pick);
      if (!p) return null;
      const s = size / p.userData.height;
      p.scale.setScalar(s);
      p.position.set(X(x), y, Z(z));
      p.rotation.y = rot;
      grp.add(p);
      return p;
    };
    planter(DECK.x0 + 2.4, DECK.x1 - 2.6, DECK.z0 + 0.35, DECK.z0 + 1.25);
    const kinds = ['Monstera', 'Fern', 'Palm', 'Monstera', 'Banana', 'Fern'];
    let pk = 0;
    for (let x = DECK.x0 + 3.2; x < DECK.x1 - 3.2; x += 1.55) {
      const kind = kinds[pk % kinds.length];
      plant(kind, x, DECK.z0 + 0.8, { Monstera: 1.2, Fern: 0.8, Palm: 2.2, Banana: 2.6 }[kind], pk * 1.7, pk);
      pk++;
    }
    for (const [px, pz, rot] of [[DECK.x0 + 1.25, DECK.z0 + 1.25, -2.4], [DECK.x0 + 1.25, DECK.z1 - 1.25, 2.4]]) {
      planter(px - 0.95, px + 0.95, pz - 0.95, pz + 0.95, 0.6);
      plant('tree', px, pz, 6.5, rot, px > 0 ? 1 : 3, d + 0.55);
      plant('Fern', px + 0.4, pz + 0.3, 0.7, 0.4, 1, d + 0.58);
      world.shade.push({ x: X(px), z: Z(pz), r: 3 });
    }
    planter(DECK.x1 - 2.2, DECK.x1 - 0.4, DECK.z0 + 0.4, DECK.z0 + 2.2, 0.6);
    plant('Banana', DECK.x1 - 1.3, DECK.z0 + 1.3, 3.0, 0.8, 2, d + 0.58);
    const pot = new THREE.MeshStandardMaterial({ color: 0xc9b79a, roughness: 0.85 });
    for (const px of [STAIRS_X - 2.6, STAIRS_X + 2.6]) {
      world.cyl(0.42, 0.32, 0.75, pot, X(px), d + 0.375, Z(DECK.z1 - 0.9), grp, 18);
      plant('Monstera', px, DECK.z1 - 0.9, 1.1, px, 3, d + 0.72);
      world.colliders.push({ x: X(px), z: Z(DECK.z1 - 0.9), r: 0.5, y: d + 0.7 });
    }

    // Glass balustrade round the terrace edge (with a gap for the stairs).
    const glassGeos = [];
    const postGeos = [];
    const railGeos = [];
    const H = 1.0;
    const railRun = (ax, az, bx, bz) => {
      const len = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.round(len / 1.8));
      const ang = Math.atan2(bz - az, bx - ax);
      for (let i = 0; i < n; i++) {
        const u0 = i / n;
        const u1 = (i + 1) / n;
        const mx = X(ax + (bx - ax) * (u0 + u1) / 2);
        const mz = Z(az + (bz - az) * (u0 + u1) / 2);
        const gg = new THREE.BoxGeometry((len / n) - 0.08, H - 0.12, 0.02);
        gg.rotateY(-ang);
        gg.translate(mx, d + (H - 0.12) / 2 + 0.04, mz);
        glassGeos.push(gg);
      }
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const pg = new THREE.BoxGeometry(0.05, H, 0.05);
        pg.translate(X(ax + (bx - ax) * u), d + H / 2, Z(az + (bz - az) * u));
        postGeos.push(pg);
      }
      const rg = new THREE.CylinderGeometry(0.03, 0.03, len, 8);
      rg.rotateZ(Math.PI / 2);
      rg.rotateY(-ang);
      rg.translate(X((ax + bx) / 2), d + H, Z((az + bz) / 2));
      railGeos.push(rg);
      // Keep people on the terrace.
      world.colliders.push({ x0: X(Math.min(ax, bx)) - 0.12, x1: X(Math.max(ax, bx)) + 0.12, z0: Z(Math.min(az, bz)) - 0.12, z1: Z(Math.max(az, bz)) + 0.12, y: d + 0.9, yMin: d - 0.5 });
    };
    const e = 0.15;
    railRun(DECK.x0 + e, DECK.z0 + e, DECK.x1 - e, DECK.z0 + e);
    railRun(DECK.x0 + e, DECK.z0 + e, DECK.x0 + e, DECK.z1 - e);
    railRun(DECK.x1 - e, DECK.z0 + e, DECK.x1 - e, DECK.z1 - e);
    railRun(DECK.x0 + e, DECK.z1 - e, STAIRS_X - gap, DECK.z1 - e);
    railRun(STAIRS_X + gap, DECK.z1 - e, DECK.x1 - e, DECK.z1 - e);
    const glass = new THREE.Mesh(mergeGeometries(glassGeos), new THREE.MeshStandardMaterial({ color: 0xcfeef2, transparent: true, opacity: 0.16, roughness: 0.04, metalness: 0.1, depthWrite: false }));
    glass.renderOrder = 1;
    grp.add(glass);
    const posts = new THREE.Mesh(mergeGeometries([...postGeos, ...railGeos.map((g) => g.toNonIndexed())].map((g) => (g.index ? g.toNonIndexed() : g))), steel);
    posts.castShadow = true;
    grp.add(posts);
    this.glass = glass;

    // Towel stand by the top of the stairs: rolled towels on a teak rack.
    const rack = new THREE.Group();
    rack.position.set(X(STAIRS_X - 4.6), d, Z(DECK.z1 - 0.75));
    grp.add(rack);
    for (const sx of [-0.55, 0.55]) this.world.box(0.05, 1.0, 0.45, teak, sx, 0.5, 0, rack);
    for (const sy of [0.25, 0.6, 0.95]) this.world.box(1.15, 0.03, 0.45, teak, 0, sy, 0, rack);
    const towelCols = ['#f1ebdd', '#2f8f93', '#f1ebdd', '#e3825f', '#f1ebdd'];
    for (const sy of [0.25, 0.6]) {
      for (let i = 0; i < 5; i++) {
        const t = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.42, 14), new THREE.MeshStandardMaterial({ map: weave.map, color: towelCols[i], roughness: 1 }));
        t.rotation.x = Math.PI / 2;
        t.position.set(-0.42 + i * 0.21, sy + 0.1, 0);
        t.castShadow = true;
        rack.add(t);
      }
    }
    world.colliders.push({ x0: X(STAIRS_X - 5.2), x1: X(STAIRS_X - 4.0), z0: Z(DECK.z1 - 1.0), z1: Z(DECK.z1 - 0.5), y: d + 1 });

    // Chad's sign.
    const sign = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, 1.0),
      new THREE.MeshStandardMaterial({ map: this.text(['POOL RULES', 'No running. No splashing.', 'No fun without a permit.', '- Management (Chad)'], 512, 320, '#1d3557', '#f1faee'), roughness: 0.6 })
    );
    sign.position.set(X(STAIRS_X + 3), d + 1.6, Z(DECK.z1 - 0.6));
    sign.rotation.y = Math.PI;
    grp.add(sign);
    world.cyl(0.04, 0.04, 1.2, steel, X(STAIRS_X + 3), d + 0.6, Z(DECK.z1 - 0.58), grp, 6);

    // ---------------------------------------------------- inflatables
    this.floaties = [];
    const fl = flamingo();
    fl.scale.setScalar(0.9);
    grp.add(fl);
    this.floaties.push({ o: fl, x: X(-3), z: Z(0), ph: 0, r: 0.9 });
    const ringMat = new THREE.MeshStandardMaterial({ map: stripeBall(['#ffd166', '#06d6a0', '#ffd166', '#06d6a0', '#ffd166', '#06d6a0']), roughness: 0.3 });
    const tube = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.17, 12, 24), ringMat);
    tube.rotation.x = Math.PI / 2;
    const tg = new THREE.Group();
    tg.add(tube);
    grp.add(tg);
    this.floaties.push({ o: tg, x: X(5), z: Z(2.5), ph: 2, r: 0.6 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 20, 14), new THREE.MeshStandardMaterial({ map: stripeBall(['#ef476f', '#ffffff', '#118ab2', '#ffffff', '#ffd166', '#ffffff']), roughness: 0.35 }));
    const bg = new THREE.Group();
    bg.add(ball);
    grp.add(bg);
    this.floaties.push({ o: bg, x: X(-8), z: Z(-3), ph: 4, r: 0.3, ball });
    for (const f of this.floaties) f.o.traverse((o) => (o.castShadow = true));

    // Splash particles.
    const n = 120;
    const sp = new THREE.BufferGeometry();
    sp.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3));
    this.splashPts = new THREE.Points(sp, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12, transparent: true, opacity: 0.9, depthWrite: false }));
    this.splashPts.visible = false;
    this.splashPts.frustumCulled = false;
    grp.add(this.splashPts);
    this.splashVel = new Float32Array(n * 3);
    this.splashT = 0;

    // Key spots for characters and interactions.
    this.spots = {
      chad: { x: lg.x - 1.4, z: lg.z - 0.2, face: Math.PI },
      doris: { x: X(-11), z: Z(DECK.z0 + 4.1), face: 0.2 },
      walt: { x: X(-9), z: Z(DECK.z0 + 3.9), face: -0.3 },
      gordon: { x: X(POOL.x0 + 3.2), z: Z(-1.5), face: Math.PI / 2 },
      reserved: { x: X(-11), z: Z(DECK.z0 + 2.7) },
    };
    // Party night: where people stand (on the south deck, by the music).
    this.partySpots = {
      doris: { x: X(-5.5), z: Z(7.6), face: 0.4 },
      walt: { x: X(-4.2), z: Z(8.1), face: -0.5 },
      partygirl: { x: X(-7.2), z: Z(8.6), face: 0.9 },
      skye: { x: X(4.5), z: Z(7.8), face: -1.4 },
      chad: this.spots.chad,
      gordon: this.spots.gordon,
    };
    this.ride = null;
    this.party = null;
    this.partyOn = false;
  }

  // Party decorations, built the first time the party starts: strings of
  // coloured bulbs round the deck, a glowing pool, and Gordon's speakers.
  buildParty() {
    const grp = new THREE.Group();
    this.grp.add(grp);
    const c = this.c;
    const d = this.deck;
    const X = (v) => c.x + v;
    const Z = (v) => c.z + v;
    const pole = new THREE.MeshStandardMaterial({ color: 0x5b4636, roughness: 0.8 });
    const corners = [[DECK.x0 + 0.6, DECK.z0 + 0.6], [DECK.x1 - 0.6, DECK.z0 + 0.6], [DECK.x1 - 0.6, DECK.z1 - 0.6], [DECK.x0 + 0.6, DECK.z1 - 0.6]];
    const H = 3.4;
    for (const [px, pz] of corners) this.world.cyl(0.06, 0.07, H, pole, X(px), d + H / 2, Z(pz), grp, 8);
    // Bulbs hanging in loose curves between the poles, and across the middle.
    const runs = [...corners.map((p, i) => [p, corners[(i + 1) % 4]]), [corners[0], corners[2]], [corners[1], corners[3]]];
    const bulbPos = [];
    const wire = [];
    for (const [a, b] of runs) {
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const n = Math.round(len / 1.1);
      for (let i = 0; i <= n; i++) {
        const u = i / n;
        const x = X(a[0] + (b[0] - a[0]) * u);
        const z = Z(a[1] + (b[1] - a[1]) * u);
        const y = d + H - 0.1 - Math.sin(u * Math.PI) * (len > 30 ? 1.3 : 0.8);
        bulbPos.push([x, y - 0.12, z]);
        wire.push(x, y, z);
        if (i > 0 && i < n) wire.push(x, y, z);
      }
    }
    const wires = new THREE.BufferGeometry();
    wires.setAttribute('position', new THREE.Float32BufferAttribute(wire, 3));
    grp.add(new THREE.LineSegments(wires, new THREE.LineBasicMaterial({ color: 0x222222 })));
    const bulbs = new THREE.InstancedMesh(new THREE.SphereGeometry(0.075, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffffff }), bulbPos.length);
    const palette = [0xffd166, 0xff5d8f, 0x4cc9f0, 0x80ed99, 0xff9f1c].map((h) => new THREE.Color(h).multiplyScalar(2.2));
    const m4 = new THREE.Matrix4();
    bulbPos.forEach((p, i) => {
      m4.makeTranslation(p[0], p[1], p[2]);
      bulbs.setMatrixAt(i, m4);
      bulbs.setColorAt(i, palette[i % palette.length]);
    });
    bulbs.frustumCulled = false;
    grp.add(bulbs);
    // Gordon's sound system: two speakers on the deck by the shallow end.
    const dark = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.6 });
    const cone = new THREE.MeshStandardMaterial({ color: 0x333333, emissive: 0x4cc9f0, emissiveIntensity: 0.6 });
    this.speakers = [];
    for (const dz of [-3.2, 1.8]) {
      const sp = this.world.box(0.55, 0.9, 0.5, dark, X(POOL.x0 - 1.2), d + 0.45, Z(dz), grp);
      const ring = new THREE.Mesh(new THREE.CircleGeometry(0.17, 18), cone);
      ring.position.set(0.28, 0.12, 0);
      ring.rotation.y = Math.PI / 2;
      sp.add(ring);
      this.speakers.push(ring);
    }
    this.party = { grp, bulbs };
  }

  setParty(on) {
    if (on === this.partyOn) return;
    if (on && !this.party) this.buildParty();
    this.partyOn = on;
    if (this.party) this.party.grp.visible = on;
    // The pool glows from its underwater lights.
    const m = this.water.material;
    m.emissive.set(on ? 0x18b4e8 : 0x000000);
    m.emissiveIntensity = on ? 0.5 : 0;
    this.cu.uGlow.value = on ? 1.4 : 0;
    this.lampMat.emissiveIntensity = on ? 3 : 0.6;
  }

  text(lines, w = 256, h = 96, bg = null, fg = '#1d3557') {
    lines = [].concat(lines);
    return canvasTex(w, h, (g) => {
      if (bg) {
        g.fillStyle = bg;
        g.fillRect(0, 0, w, h);
        g.strokeStyle = fg;
        g.lineWidth = 8;
        g.strokeRect(6, 6, w - 12, h - 12);
      }
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      lines.forEach((l, i) => {
        g.font = `${i === 0 && lines.length > 1 ? 'bold ' : ''}${Math.round(h / (lines.length + 1.2))}px Georgia, serif`;
        g.fillText(l, w / 2, (h / (lines.length + 0.4)) * (i + 0.7));
      });
    });
  }

  inPool(x, z) {
    const r = this.rect;
    return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  }

  onDeck(x, z) {
    const r = this.deckRect;
    return x > r.x0 && x < r.x1 && z > r.z0 && z < r.z1;
  }

  // ------------------------------------------------------------- rides
  // Down the water slide, then splash.
  startSlide(player, onDone) {
    this.ride = { kind: 'slide', t: 0, dur: 5.5, player, onDone };
  }

  // Bounce off the end of the board in a big arc.
  startCannonball(player, onDone) {
    const b = this.board;
    this.ride = {
      kind: 'cannonball',
      t: 0,
      dur: 2.6,
      player,
      onDone,
      from: new THREE.Vector3(b.x0 - 0.5, b.y, b.z),
      edge: new THREE.Vector3(b.x1 + 0.2, b.y, b.z),
      land: new THREE.Vector3(b.x1 - 2.4, this.surface - 0.4, b.z + 0.3),
    };
  }

  splash(x, z, big = true) {
    const p = this.splashPts.geometry.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (big ? 2.5 : 1.2) * (0.3 + Math.random());
      p.setXYZ(i, x + Math.cos(a) * 0.2, this.surface + 0.05, z + Math.sin(a) * 0.2);
      this.splashVel[i * 3] = Math.cos(a) * s;
      this.splashVel[i * 3 + 1] = (big ? 5 : 3) * (0.5 + Math.random());
      this.splashVel[i * 3 + 2] = Math.sin(a) * s;
    }
    p.needsUpdate = true;
    this.splashT = 1.4;
    this.splashPts.visible = true;
  }

  update(dt, t, player, sun = 1) {
    // The island keeps its sky reflections subtle; the pool water gets the
    // full-strength sky so it mirrors it like real water.
    const env = this.scene.environment;
    const wm = this.water.material;
    if (env && wm.envMap !== env) {
      const first = !wm.envMap;
      wm.envMap = env;
      wm.envMapIntensity = 1.1;
      if (first) wm.needsUpdate = true;
    }
    // Water ripples drift two ways; caustics wobble across the floor.
    this.wu.uW1.value.set(t * 0.018, t * 0.011);
    this.wu.uW2.value.set(-t * 0.013, t * 0.021);
    this.cu.uOff1.value.set(t * 0.021, t * 0.013);
    this.cu.uOff2.value.set(-t * 0.016, t * 0.019);
    this.cu.uSurf.value = this.surface;
    this.cu.uCStr.value = Math.min(1.2, sun / 2.5);
    // Inflatables drift and bob, and get nudged by swimmers.
    for (const f of this.floaties) {
      const pp = player.pos;
      const dx = f.x - pp.x;
      const dz = f.z - pp.z;
      const d = Math.hypot(dx, dz);
      if (d < f.r + 0.6 && player.swimming) {
        f.x += (dx / (d || 1)) * dt * 1.5;
        f.z += (dz / (d || 1)) * dt * 1.5;
      }
      f.x += Math.sin(t * 0.07 + f.ph) * dt * 0.08;
      f.z += Math.cos(t * 0.05 + f.ph) * dt * 0.08;
      const r = this.rect;
      f.x = THREE.MathUtils.clamp(f.x, r.x0 + f.r + 0.2, r.x1 - f.r - 0.2);
      f.z = THREE.MathUtils.clamp(f.z, r.z0 + f.r + 0.2, r.z1 - f.r - 0.2);
      f.o.position.set(f.x, this.surface + (f.ball ? 0.18 : 0.06) + Math.sin(t * 1.6 + f.ph) * 0.03, f.z);
      f.o.rotation.y = t * 0.05 + f.ph;
      f.o.rotation.z = Math.sin(t * 1.1 + f.ph) * 0.05;
    }
    // Splash particles.
    if (this.splashT > 0) {
      this.splashT -= dt;
      const p = this.splashPts.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) {
        this.splashVel[i * 3 + 1] -= 9.8 * dt;
        p.setXYZ(i, p.getX(i) + this.splashVel[i * 3] * dt, Math.max(this.surface, p.getY(i) + this.splashVel[i * 3 + 1] * dt), p.getZ(i) + this.splashVel[i * 3 + 2] * dt);
      }
      p.needsUpdate = true;
      this.splashPts.material.opacity = Math.min(0.9, this.splashT);
      if (this.splashT <= 0) this.splashPts.visible = false;
    }
    if (this.ride) this.updateRide(dt, player);
    if (this.partyOn && this.speakers) {
      // Speakers thump in time with the music.
      const beat = Math.pow(Math.max(0, Math.sin(t * Math.PI * 2.4)), 6);
      for (const sp of this.speakers) sp.scale.setScalar(1 + beat * 0.25);
    }
  }

  updateRide(dt, player) {
    const R = this.ride;
    R.t += dt;
    const u = Math.min(1, R.t / R.dur);
    const p = player.pos;
    if (R.kind === 'slide') {
      // Speed up as you go.
      const s = u * u * 0.55 + u * 0.45;
      const pt = this.slide.getPointAt(Math.min(1, s));
      const tg = this.slide.getTangentAt(Math.min(1, s));
      // Sitting in the channel: eyes about 0.8 m above its floor.
      p.set(pt.x, pt.y - 0.55 + 0.8 - EYE, pt.z);
      player.yaw = Math.atan2(-tg.x, -tg.z);
      player.pitch = THREE.MathUtils.damp(player.pitch, -0.35, 4, dt);
    } else {
      // Run along the board, bounce, tuck, splash.
      if (u < 0.3) {
        p.lerpVectors(R.from, R.edge, u / 0.3);
        p.y = R.from.y + Math.abs(Math.sin((u / 0.3) * Math.PI * 3)) * 0.12;
      } else {
        const k = (u - 0.3) / 0.7;
        p.lerpVectors(R.edge, R.land, k);
        p.y = THREE.MathUtils.lerp(R.edge.y, R.land.y, k) + Math.sin(k * Math.PI) * 2.2;
      }
      player.yaw = Math.PI / 2;
      player.pitch = THREE.MathUtils.damp(player.pitch, u < 0.6 ? -0.15 : -0.9, 3, dt);
    }
    player.vel.set(0, 0, 0);
    player.syncCamera(0);
    if (u >= 1) {
      this.splash(p.x, p.z, true);
      p.y = this.surface - 1.5;
      const done = R.onDone;
      this.ride = null;
      if (done) done();
    }
  }
}
