// Flowering plants round the island, in two layers:
// - detailed hibiscus, ixora and frangipani (Sketchfab, CC BY 4.0:
//   PlantCatalog; see assets/CREDITS.md) along the paths and in beds round the
//   bar, the bungalows, the pool and the other places people go. They are
//   10-20k triangles each, so they're grouped into 20 m cells and only drawn
//   within ~40 m of the camera;
// - flowering ground cover (painted here, 4 triangles each) in borders along
//   the paths, carpets in the beds and wildflower drifts all over the island,
//   drawn much further out so the colour carries.
import * as THREE from 'three';
import { height, pathDistance } from './terrain.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const CELL = 20;

// Per kind: target height (m), which shadows to cast, and an optional tint for
// the petals (colour values above 1 brighten the texture).
const KINDS = {
  hibiscus: { model: 'hibiscus', size: 1.5, shadow: true, petals: /petal|bud|sepal|genitals/i, tint: new THREE.Color(1.9, 1.15, 1.15) },
  hibiscusPink: { model: 'hibiscus', size: 1.35, shadow: true, petals: /petal|bud|sepal|genitals/i, tint: new THREE.Color(2.3, 1.45, 1.9) },
  ixora: { model: 'ixora', size: 0.95, shadow: false },
  frangipani: { model: 'frangipani', size: 3.3, shadow: true },
};

// Flowering ground cover: cheap crossed cards, painted here, in four colours.
const PATCH_COLORS = [
  { petals: ['#ff4f9a', '#ff7eb6', '#e0287a'], centre: '#ffe066' }, // hot pink
  { petals: ['#ffd23f', '#ffe270', '#f5b700'], centre: '#e07a1f' }, // sunny yellow
  { petals: ['#ff8c42', '#ff6b35', '#ffa260'], centre: '#ffe066' }, // orange
  { petals: ['#a663cc', '#c08ad8', '#8a4fb5'], centre: '#fff3b0' }, // purple
];

function patchTexture({ petals, centre }, seed) {
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d');
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  // Leaves: a low mound of overlapping blades and ovals.
  for (let i = 0; i < 70; i++) {
    const x = N * (0.12 + r() * 0.76);
    const y = N * (0.45 + r() * 0.55);
    const v = 0.65 + r() * 0.4;
    g.fillStyle = `rgb(${(46 * v) | 0},${(110 * v) | 0},${(44 * v) | 0})`;
    g.beginPath();
    g.ellipse(x, y, 7 + r() * 12, 3 + r() * 6, (r() - 0.5) * 2.4, 0, Math.PI * 2);
    g.fill();
  }
  // Blossoms: five-petal flowers, mostly on top.
  for (let i = 0; i < 26; i++) {
    const x = N * (0.14 + r() * 0.72);
    const y = N * (0.32 + r() * 0.45);
    const rad = 7 + r() * 7;
    g.fillStyle = petals[Math.floor(r() * petals.length)];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + r();
      g.beginPath();
      g.ellipse(x + Math.cos(a) * rad * 0.55, y + Math.sin(a) * rad * 0.55, rad * 0.55, rad * 0.35, a, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = centre;
    g.beginPath();
    g.arc(x, y, rad * 0.22, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Two crossed cards, 0.7 m wide, 0.5 m tall, with upward normals so they
// light like a soft mound rather than flat paper.
function patchGeometry() {
  const a = new THREE.PlaneGeometry(0.7, 0.5);
  a.translate(0, 0.25, 0);
  const b = a.clone();
  b.rotateY(Math.PI / 2);
  const g = mergeGeometries([a, b]);
  const n = g.attributes.normal;
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

const rnd = (() => {
  let s = 424242;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
})();

// Bake a loaded model into { geometry, material } parts: base at y = 0,
// centred, `size` metres tall. Alpha-blended leaves become alpha-tested so
// they sort properly and can cast shadows.
function prepare(scene, size, tintRe, tint) {
  scene.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  const k = size / (box.max.y - box.min.y);
  const parts = [];
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    g.translate(-c.x, -box.min.y, -c.z);
    g.scale(k, k, k);
    let m = o.material.clone();
    if (m.transparent || m.alphaMode === 'BLEND') {
      m.transparent = false;
      m.alphaTest = 0.5;
      m.depthWrite = true;
    }
    m.side = THREE.DoubleSide;
    if (m.roughness !== undefined && m.roughness < 0.4) m.roughness = 0.6;
    if (m.isMeshBasicMaterial) m = new THREE.MeshStandardMaterial({ map: m.map, roughness: 0.7, side: THREE.DoubleSide });
    if (tintRe && tint && tintRe.test(m.name || o.material.name || '')) m.color.copy(tint);
    parts.push({ geometry: g, material: m });
  });
  return parts;
}

export class Flowers {
  constructor(scene, assets, world, L, { lite = false } = {}) {
    this.scene = scene;
    this.lite = lite;
    this.range = lite ? 24 : 36; // detailed shrubs
    this.patchRange = lite ? 70 : 130; // ground cover
    const S = assets.scenes;
    this.kinds = {};
    for (const [key, K] of Object.entries(KINDS)) {
      if (!S[K.model]) continue;
      this.kinds[key] = { ...K, parts: prepare(S[K.model], 1, K.petals, K.tint) };
    }
    const spots = this.place(world, L);
    // Group by cell, then by kind.
    const cells = new Map();
    for (const s of spots) {
      if (!this.kinds[s.kind]) continue;
      const id = `${Math.floor(s.x / CELL)},${Math.floor(s.z / CELL)}`;
      if (!cells.has(id)) cells.set(id, { x: (Math.floor(s.x / CELL) + 0.5) * CELL, z: (Math.floor(s.z / CELL) + 0.5) * CELL, list: [] });
      cells.get(id).list.push(s);
    }
    this.cells = [];
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const cell of cells.values()) {
      const grp = new THREE.Group();
      const byKind = {};
      for (const s of cell.list) (byKind[s.kind] = byKind[s.kind] || []).push(s);
      for (const [kind, list] of Object.entries(byKind)) {
        const K = this.kinds[kind];
        for (const p of K.parts) {
          const im = new THREE.InstancedMesh(p.geometry, p.material, list.length);
          list.forEach((s, i) => {
            q.setFromAxisAngle(up, s.rot);
            const sc = K.size * s.scale;
            m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(sc, sc, sc));
            im.setMatrixAt(i, m4);
          });
          im.castShadow = K.shadow && !lite;
          im.receiveShadow = true;
          im.computeBoundingSphere();
          grp.add(im);
        }
      }
      grp.visible = false;
      scene.add(grp);
      this.cells.push({ x: cell.x, z: cell.z, grp });
    }
    // Ground cover, in its own (cheap) cells.
    const patchGeo = patchGeometry();
    const patchMats = PATCH_COLORS.map((pc, i) => new THREE.MeshStandardMaterial({ map: patchTexture(pc, 1000 + i * 77), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85 }));
    const pcells = new Map();
    for (const s of this.patches) {
      const id = `${Math.floor(s.x / 40)},${Math.floor(s.z / 40)}`;
      if (!pcells.has(id)) pcells.set(id, { x: (Math.floor(s.x / 40) + 0.5) * 40, z: (Math.floor(s.z / 40) + 0.5) * 40, list: [] });
      pcells.get(id).list.push(s);
    }
    this.patchCells = [];
    for (const cell of pcells.values()) {
      const grp = new THREE.Group();
      patchMats.forEach((mat, ci) => {
        const list = cell.list.filter((s) => s.color === ci);
        if (!list.length) return;
        const im = new THREE.InstancedMesh(patchGeo, mat, list.length);
        list.forEach((s, i) => {
          q.setFromAxisAngle(up, s.rot);
          m4.compose(new THREE.Vector3(s.x, s.y, s.z), q, new THREE.Vector3(s.scale, s.scale * (0.85 + (i % 3) * 0.12), s.scale));
          im.setMatrixAt(i, m4);
        });
        im.receiveShadow = true;
        im.computeBoundingSphere();
        grp.add(im);
      });
      grp.visible = false;
      scene.add(grp);
      this.patchCells.push({ x: cell.x, z: cell.z, grp });
    }
    this.count = spots.length;
    this.patchCount = this.patches.length;
    this.next = 0;
  }

  // Where the flowers go.
  place(world, L) {
    const out = [];
    const taken = [];
    const free = (x, z, r) => taken.every((t) => (t.x - x) ** 2 + (t.z - z) ** 2 > (t.r + r) ** 2);
    const onPool = (x, z) => L.pool && Math.abs(x - L.pool.x) < 19 && Math.abs(z - L.pool.z) < 14;
    const ok = (x, z, r = 0.6) => {
      const h = height(x, z);
      if (h < 1.25 || h > 22) return false; // not on the beach sand
      if (onPool(x, z)) return false;
      if (world.excluded(x, z, -1)) return false;
      if (pathDistance(x, z, L.paths) < 1.3) return false;
      return free(x, z, r);
    };
    this.patches = [];
    const patch = (x, z, color) => {
      const h = height(x, z);
      if (h < 1.25 || h > 20 || onPool(x, z) || world.excluded(x, z, -1.5) || pathDistance(x, z, L.paths) < 0.9) return;
      if (!free(x, z, 0.15)) return;
      this.patches.push({ x, y: h - 0.03, z, rot: rnd() * Math.PI, scale: 1.0 + rnd() * 0.6, color });
    };
    const put = (kind, x, z, scale = 0.85 + rnd() * 0.3) => {
      const r = { frangipani: 1.6, hibiscus: 0.8, hibiscusPink: 0.8, ixora: 0.55 }[kind];
      if (!ok(x, z, r)) return false;
      taken.push({ x, z, r });
      out.push({ kind, x, y: height(x, z) - 0.04, z, rot: rnd() * Math.PI * 2, scale });
      return true;
    };
    // A bed: a shrub or tree at the back, ixora either side, flowers in front.
    const bed = (x, z, facing, big = 'hibiscus') => {
      put(big, x, z);
      const fx = Math.sin(facing);
      const fz = Math.cos(facing);
      const sx = fz;
      const sz = -fx;
      put('ixora', x + fx * 1.0 + sx * 0.9, z + fz * 1.0 + sz * 0.9);
      // A carpet of ground-cover flowers in front.
      const col = Math.floor(rnd() * PATCH_COLORS.length);
      for (let i = -3; i <= 3; i++) for (const row of [1.6, 2.2, 2.8]) patch(x + fx * row + sx * i * 0.6, z + fz * row + sz * i * 0.6, (col + (i & 1)) % PATCH_COLORS.length);
    };
    const skip = this.lite ? 2 : 1;

    // 1. Along every path, alternating sides.
    let n = 0;
    for (const path of L.paths) {
      for (let i = 0; i < path.length - 1; i++) {
        const a = path[i];
        const b = path[i + 1];
        const len = Math.hypot(b.x - a.x, b.z - a.z);
        const nx = -(b.z - a.z) / len;
        const nz = (b.x - a.x) / len;
        for (let d = 5; d < len - 2; d += 11) {
          n++;
          if (n % skip) continue;
          const side = n % 2 ? 1 : -1;
          const off = 2.0 + rnd() * 0.8;
          const x = a.x + ((b.x - a.x) * d) / len + nx * side * off;
          const z = a.z + ((b.z - a.z) * d) / len + nz * side * off;
          const kind = ['hibiscus', 'hibiscusPink', 'ixora', 'hibiscus', 'hibiscusPink', 'hibiscus'][n % 6];
          put(kind, x, z);
        }
        // Flower borders along both sides, in drifts of one colour.
        for (let d = 1; d < len - 1; d += skip > 1 ? 1.6 : 0.8) {
          const drift = Math.floor((d + i * 13) / 9) % PATCH_COLORS.length;
          for (const side of [-1, 1]) {
            const off = 1.3 + rnd() * 1.6;
            patch(a.x + ((b.x - a.x) * d) / len + nx * side * off, a.z + ((b.z - a.z) * d) / len + nz * side * off, (drift + (side > 0 ? 1 : 0)) % PATCH_COLORS.length);
          }
        }
      }
    }
    // 2. Beds round the places people go.
    const beds = [];
    const B = L.bar;
    for (const a of [0.5, 1.3, 2.2, 3.6, 4.4, 5.3]) beds.push([B.x + Math.cos(a) * 10.5, B.z - Math.abs(Math.sin(a)) * 10.5, a, a % 2 > 1 ? 'hibiscusPink' : 'hibiscus']);
    for (const b of L.bungalows) {
      beds.push([b.x - 3.6, b.walk0 - 4, Math.PI * 0.75, 'hibiscus']);
      beds.push([b.x + 3.6, b.walk0 - 4, -Math.PI * 0.75, 'hibiscusPink']);
    }
    beds.push([L.hammock.x - 3, L.hammock.z - 3.5, 0.6, 'frangipani'], [L.hammock.x + 4, L.hammock.z - 3, -0.6, 'hibiscusPink']);
    beds.push([L.yoga.x + 6, L.yoga.z - 5, 1.2, 'frangipani'], [L.welcome.x - 4, L.welcome.z - 2, 0.3, 'hibiscus'], [L.welcome.x + 4, L.welcome.z - 2, -0.3, 'hibiscusPink']);
    beds.push([L.lighthouse.x - 6, L.lighthouse.z + 6, 0.8, 'hibiscus'], [L.bench.x + 2.5, L.bench.z + 2, 0, 'ixora']);
    if (L.pool) {
      // Either side of the bottom of the pool stairs, and along the beach side.
      beds.push([L.pool.x - 4.2, L.pool.z + 21.5, 0, 'hibiscusPink'], [L.pool.x + 4.2, L.pool.z + 21.5, 0, 'hibiscus']);
      for (const dx of [-14, -9, 9, 14]) beds.push([L.pool.x + dx, L.pool.z + 15, 0, dx < 0 ? 'hibiscus' : 'hibiscusPink']);
    }
    beds.forEach((b, i) => {
      if (this.lite && i % 2) return;
      bed(b[0], b[1], b[2], b[3]);
    });
    // 3. Frangipani trees dotted round the resort, and wild clusters inland.
    for (let i = 0; i < (this.lite ? 7 : 14); i++) {
      for (let tries = 0; tries < 30; tries++) {
        const a = rnd() * Math.PI * 2;
        const r = 18 + rnd() * 40;
        if (put('frangipani', B.x + 30 + Math.cos(a) * r * 1.6, B.z - 12 + Math.sin(a) * r * 0.7, 0.8 + rnd() * 0.5)) break;
      }
    }
    for (let i = 0; i < (this.lite ? 10 : 22); i++) {
      for (let tries = 0; tries < 30; tries++) {
        const x = (rnd() - 0.5) * 260;
        const z = (rnd() - 0.5) * 190;
        if (height(x, z) < 2.5) continue;
        if (put(rnd() < 0.7 ? 'hibiscus' : 'ixora', x, z)) break;
      }
    }
    // Wildflower drifts in the grass all over the island.
    for (let i = 0; i < (this.lite ? 60 : 150); i++) {
      const cx = (rnd() - 0.5) * 270;
      const cz = (rnd() - 0.5) * 200;
      if (height(cx, cz) < 1.5) continue;
      const col = Math.floor(rnd() * PATCH_COLORS.length);
      const n2 = this.lite ? 10 : 22;
      for (let k = 0; k < n2; k++) {
        const a = rnd() * Math.PI * 2;
        const r = Math.sqrt(rnd()) * 4;
        patch(cx + Math.cos(a) * r, cz + Math.sin(a) * r, rnd() < 0.8 ? col : (col + 1) % PATCH_COLORS.length);
      }
    }
    // A ring of colour at the foot of every shrub and tree.
    for (const s of out) {
      for (let k = 0; k < (s.kind === 'frangipani' ? 8 : 5); k++) {
        const a = rnd() * Math.PI * 2;
        const r = (s.kind === 'frangipani' ? 1.4 : 0.9) + rnd() * 0.5;
        patch(s.x + Math.cos(a) * r, s.z + Math.sin(a) * r, Math.floor(rnd() * PATCH_COLORS.length));
      }
    }
    return out;
  }

  // Show only the cells near the camera (checked a few times a second).
  update(t, camera) {
    if (t < this.next) return;
    this.next = t + 0.35;
    const p = camera.position;
    for (const c of this.cells) c.grp.visible = Math.hypot(c.x - p.x, c.z - p.z) < this.range + CELL * 0.7;
    for (const c of this.patchCells) c.grp.visible = Math.hypot(c.x - p.x, c.z - p.z) < this.patchRange + 28;
  }
}
