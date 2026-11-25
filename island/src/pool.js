// The Palmera Cay pool: a stone terrace inland of the beach with a pool set
// into it, a twisting water slide, a diving board, a lifeguard chair,
// loungers (mostly reserved) and inflatables. Swimming works as in the sea:
// the player asks world.poolSurface() for the water level.
import * as THREE from 'three';
import { height } from './terrain.js';
import { texMaterial } from './assets.js';
import { placeLounger } from './props.js';
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

// Small glossy pool tiles, with a dark lane stripe option.
function tileTexture() {
  return canvasTex(256, 256, (g, w) => {
    const n = 8;
    const s = w / n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const v = 0.9 + Math.random() * 0.1;
        g.fillStyle = `rgb(${(120 * v) | 0},${(200 * v) | 0},${(225 * v) | 0})`;
        g.fillRect(i * s, j * s, s, s);
      }
    }
    g.strokeStyle = 'rgba(255,255,255,0.75)';
    g.lineWidth = 2;
    for (let i = 0; i <= n; i++) {
      g.beginPath();
      g.moveTo(i * s, 0);
      g.lineTo(i * s, w);
      g.moveTo(0, i * s);
      g.lineTo(w, i * s);
      g.stroke();
    }
  });
}

// Warm limestone pavers for the deck.
function paverTexture() {
  return canvasTex(512, 512, (g, w) => {
    g.fillStyle = '#d8c8a8';
    g.fillRect(0, 0, w, w);
    const rows = 4;
    const s = w / rows;
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < rows; i++) {
        const v = 0.9 + Math.random() * 0.14;
        g.fillStyle = `rgb(${(226 * v) | 0},${(212 * v) | 0},${(184 * v) | 0})`;
        g.fillRect(i * s + 3, j * s + 3, s - 6, s - 6);
        for (let k = 0; k < 120; k++) {
          g.fillStyle = `rgba(${Math.random() < 0.5 ? '120,100,70' : '255,250,235'},${Math.random() * 0.12})`;
          g.fillRect(i * s + Math.random() * s, j * s + Math.random() * s, 2 + Math.random() * 4, 1 + Math.random() * 3);
        }
      }
    }
  });
}

// Moving light ripples on the pool floor (emissive, scrolled each frame).
function causticTexture() {
  return canvasTex(256, 256, (g, w) => {
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, w);
    g.strokeStyle = 'rgba(255,255,255,0.55)';
    g.lineCap = 'round';
    for (let i = 0; i < 70; i++) {
      g.lineWidth = 1 + Math.random() * 2.2;
      g.beginPath();
      let x = Math.random() * w;
      let y = Math.random() * w;
      g.moveTo(x, y);
      for (let k = 0; k < 4; k++) {
        x += (Math.random() - 0.5) * 50;
        y += (Math.random() - 0.5) * 50;
        g.quadraticCurveTo(x + (Math.random() - 0.5) * 30, y + (Math.random() - 0.5) * 30, x, y);
      }
      g.stroke();
    }
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

    const grp = new THREE.Group();
    scene.add(grp);
    this.grp = grp;
    const box = (w, h, d, mat, x, y, z) => world.box(w, h, d, mat, x, y, z, grp);

    // ---------------------------------------------------- materials
    const pavers = paverTexture();
    const deckMat = new THREE.MeshStandardMaterial({ map: pavers, roughness: 0.75 });
    const stone =
      texMaterial('rock_ground', { color: new THREE.Color(1.35, 1.25, 1.1), roughness: 1 }) ||
      new THREE.MeshStandardMaterial({ color: 0xbfae8f, roughness: 0.95 });
    const tiles = tileTexture();
    this.caustics = causticTexture();
    this.caustics.repeat.set(0.35, 0.35);
    const tileMat = new THREE.MeshStandardMaterial({ map: tiles, roughness: 0.25, emissive: 0xffffff, emissiveMap: this.caustics, emissiveIntensity: 0.28 });
    this.tileMat = tileMat;
    const coping = new THREE.MeshStandardMaterial({ color: 0xf4efe4, roughness: 0.5 });
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
      box(x1 - x0, y - floorShallow + 0.2, stepW, coping, X((x0 + x1) / 2), (y + floorShallow - 0.2) / 2, Z(sz));
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
    // Coping stones round the rim.
    box(pw + 0.8, 0.12, 0.4, coping, X((POOL.x0 + POOL.x1) / 2), this.deck + 0.01, Z(POOL.z0 - 0.2));
    box(pw + 0.8, 0.12, 0.4, coping, X((POOL.x0 + POOL.x1) / 2), this.deck + 0.01, Z(POOL.z1 + 0.2));
    box(0.4, 0.12, pd, coping, X(POOL.x0 - 0.2), this.deck + 0.01, Z(sz));
    box(0.4, 0.12, pd, coping, X(POOL.x1 + 0.2), this.deck + 0.01, Z(sz));
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
      const lz = Z(POOL.z0 + 2 + dz);
      const r = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.03, 8, 16, Math.PI), steel);
      r.position.set(lx + 0.25, this.deck + 0.05, lz);
      r.rotation.y = Math.PI / 2;
      grp.add(r);
      world.cyl(0.03, 0.03, this.deck - floorDeep, steel, lx - 0.1, (this.deck + floorDeep) / 2, lz, grp, 8);
    }

    // ---------------------------------------------------- water
    this.ripples = rippleNormal();
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(pw, pd),
      new THREE.MeshStandardMaterial({ color: 0x2fb8d8, transparent: true, opacity: 0.72, roughness: 0.05, metalness: 0.15, normalMap: this.ripples, normalScale: new THREE.Vector2(0.45, 0.45), depthWrite: false })
    );
    water.rotation.x = -Math.PI / 2;
    water.position.set(X((POOL.x0 + POOL.x1) / 2), this.surface, Z(sz));
    water.renderOrder = 2;
    grp.add(water);
    this.water = water;
    // The same surface seen from underneath.
    const under = new THREE.Mesh(water.geometry, new THREE.MeshBasicMaterial({ color: 0x7fe3f2, transparent: true, opacity: 0.35, side: THREE.BackSide, depthWrite: false }));
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
      new THREE.Vector3(sxp(15.6), d + 2.4, Z(-3)),
      new THREE.Vector3(sxp(14.8), d + 1.8, Z(-5.4)),
      new THREE.Vector3(sxp(12.2), d + 1.0, Z(-5.6)),
      new THREE.Vector3(sxp(10.3), d + 0.55, Z(-4.6)),
      new THREE.Vector3(sxp(8.6), this.surface + 0.25, Z(-4.2)),
    ];
    this.slide = new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.4);
    const slideMat = new THREE.MeshStandardMaterial({ color: 0x1fb5e5, roughness: 0.18, metalness: 0.05, side: THREE.DoubleSide });
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
    const umb = new THREE.MeshStandardMaterial({ map: stripeBall(['#ff8fab', '#ffffff', '#ff8fab', '#ffffff', '#ff8fab', '#ffffff']), roughness: 0.9, side: THREE.DoubleSide });
    for (const ux of [-11, -0.4]) {
      world.cyl(0.04, 0.04, 2.6, white, X(ux), d + 1.3, Z(DECK.z0 + 1.6), grp, 6);
      const can = new THREE.Mesh(new THREE.ConeGeometry(2.2, 0.7, 12, 1, true), umb);
      can.position.set(X(ux), d + 2.6, Z(DECK.z0 + 1.6));
      can.castShadow = true;
      grp.add(can);
      world.shade.push({ x: X(ux), z: Z(DECK.z0 + 2.3), r: 2.4 });
    }
    // Potted palms at the corners.
    const pot = new THREE.MeshStandardMaterial({ color: 0xb5651d, roughness: 0.8 });
    for (const [px, pz] of [[DECK.x0 + 1.2, DECK.z0 + 1.2], [DECK.x0 + 1.2, DECK.z1 - 1.2], [DECK.x1 - 1.2, DECK.z0 + 1.2]]) {
      world.cyl(0.45, 0.35, 0.7, pot, X(px), d + 0.35, Z(pz), grp, 12);
      world.colliders.push({ x: X(px), z: Z(pz), r: 0.5, y: d + 0.6 });
    }
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
    m.emissiveIntensity = on ? 0.9 : 0;
    this.tileMat.emissiveIntensity = on ? 0.9 : 0.28;
    this.tileMat.emissive.set(on ? 0x7fe6ff : 0xffffff);
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

  update(dt, t, player) {
    // Water and light ripples.
    this.ripples.offset.set(t * 0.02, t * 0.013);
    this.caustics.offset.set(Math.sin(t * 0.15) * 0.3, t * 0.025);
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
