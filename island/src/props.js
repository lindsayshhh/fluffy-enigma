import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { height, slope, shared, findShore, pathDistance } from './terrain.js';
import { fbm, rng, smoothstep, valueNoise } from './noise.js';
import * as T from './textures.js';
import { assets, texMaterial } from './assets.js';

const TILE = 1.6; // metres per texture tile on boxes and cylinders

// Give box/cylinder UVs in metres so photo textures keep a constant scale.
function metreUVsBox(geo, w, h, d) {
  const uv = geo.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  const per = uv.count / 6;
  for (let f = 0; f < 6; f++) {
    for (let k = 0; k < per; k++) {
      const i = f * per + k;
      uv.setXY(i, (uv.getX(i) * dims[f][0]) / TILE, (uv.getY(i) * dims[f][1]) / TILE);
    }
  }
}
// A Poly Haven model recentred on its base and scaled to `size` metres across.
function unitModel(name, size = 2, sink = 0.15) {
  const m = assets.models[name];
  if (!m) return null;
  const g = m.geometry.clone();
  g.computeBoundingBox();
  const b = g.boundingBox;
  const dim = b.getSize(new THREE.Vector3());
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y - dim.y * sink, -(b.min.z + b.max.z) / 2);
  const k = size / Math.max(dim.x, dim.z);
  g.scale(k, k, k);
  return { geometry: g, material: m.material };
}

function metreUVsCyl(geo, r, h) {
  const uv = geo.attributes.uv;
  const c = Math.max(0.3, 2 * Math.PI * r);
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * c) / TILE, (uv.getY(i) * h) / TILE);
}

// ---------------------------------------------------------------------------
// Materials

function swayMaterial(params, amp) {
  return addSway(new THREE.MeshStandardMaterial(params), amp);
}

// Wind sway in the vertex shader, weighted per vertex by an aSway attribute.
function addSway(m, amp) {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = shared.uTime;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aSway;\nuniform float uTime;')
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
#ifdef USE_INSTANCING
  vec2 ip = instanceMatrix[3].xz;
#else
  vec2 ip = vec2(0.0);
#endif
float ph = ip.x * 0.37 + ip.y * 0.21;
float gust = 0.65 + 0.35 * sin(uTime * 0.31 + ip.x * 0.015 + ip.y * 0.01);
transformed += vec3(sin(uTime * 1.5 + ph + transformed.y * 0.3),
                    sin(uTime * 2.2 + ph * 1.7) * 0.45,
                    cos(uTime * 1.2 + ph)) * aSway * ${amp.toFixed(3)} * gust;`
      );
  };
  return m;
}

// ---------------------------------------------------------------------------
// Scanned vegetation (Sketchfab, CC BY)

// Meshes of a loaded scene, grouped by key (null key = skip), with their
// scene transforms baked into the geometry.
function groupMeshes(scene, keyFn) {
  const groups = new Map();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    const key = keyFn(o.name);
    if (!key) return;
    const geometry = o.geometry.clone().applyMatrix4(o.matrixWorld);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ geometry, material: o.material, name: o.name });
  });
  return groups;
}

const swayCache = new Map();
function swayClone(material, amp) {
  const key = material.uuid + amp;
  if (!swayCache.has(key)) {
    const m = material.clone();
    m.side = THREE.DoubleSide;
    if (m.alphaTest === 0 && m.transparent) {
      m.transparent = false;
      m.alphaTest = 0.5;
    }
    swayCache.set(key, addSway(m, amp));
  }
  return swayCache.get(key);
}

// Normalise a scanned tree or plant: base at the origin, `height` metres tall,
// and (unless keepLean) its crown leaning toward +x so placement can aim it.
// Leaf parts get an aSway weight: by distance from the trunk ('crown') or by
// height ('height').
function prepareVegetation(parts, { isLeaf, height, keepLean = false, swayBy = 'crown', amp = 0.2 }) {
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox);
  }
  const minY = box.min.y;
  const tall = Math.max(1e-3, box.max.y - minY);
  const base = new THREE.Vector3();
  let n = 0;
  for (const p of parts) {
    if (isLeaf(p)) continue;
    const pos = p.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) < minY + tall * 0.04) {
        base.x += pos.getX(i);
        base.z += pos.getZ(i);
        n++;
      }
    }
  }
  if (n) base.multiplyScalar(1 / n);
  else box.getCenter(base);
  const leafBox = new THREE.Box3();
  for (const p of parts) if (isLeaf(p)) leafBox.union(p.geometry.boundingBox);
  if (leafBox.isEmpty()) leafBox.copy(box);
  const crown = leafBox.getCenter(new THREE.Vector3());
  const ang = keepLean ? 0 : Math.atan2(crown.z - base.z, crown.x - base.x);
  const k = height / tall;
  const crownLocal = new THREE.Vector3(crown.x - base.x, crown.y - minY, crown.z - base.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), ang).multiplyScalar(k);
  const leafRadius = Math.max(0.3, Math.max(leafBox.max.x - leafBox.min.x, leafBox.max.z - leafBox.min.z) * 0.5 * k);
  for (const p of parts) {
    const g = p.geometry;
    g.translate(-base.x, -minY, -base.z);
    g.rotateY(ang);
    g.scale(k, k, k);
    g.computeBoundingSphere();
    if (isLeaf(p)) {
      const pos = g.attributes.position;
      const w = new Float32Array(pos.count);
      for (let i = 0; i < pos.count; i++) {
        const t = swayBy === 'height' ? pos.getY(i) / height : Math.hypot(pos.getX(i) - crownLocal.x, pos.getZ(i) - crownLocal.z) / leafRadius;
        w[i] = Math.min(1, Math.max(0, t)) ** 1.4;
      }
      g.setAttribute('aSway', new THREE.BufferAttribute(w, 1));
      p.mat = swayClone(p.material, amp);
    } else {
      p.mat = p.material;
    }
  }
  return { parts, crown: crownLocal, height, leanRatio: Math.hypot(crownLocal.x, crownLocal.z) / height };
}

function scannedPalms() {
  const scene = assets.scenes.palms;
  if (!scene) return null;
  const groups = groupMeshes(scene, (name) => {
    const m = /Palm_P2_(\d+)_(Trunk|Leaf|Break)/.exec(name);
    return m ? m[1] : null;
  });
  const isLeaf = (p) => /Leaf/.test(p.name);
  const natural = [];
  for (const parts of groups.values()) {
    const b = new THREE.Box3();
    parts.forEach((p) => b.union(new THREE.Box3().setFromBufferAttribute(p.geometry.attributes.position)));
    natural.push(b.max.y - b.min.y);
  }
  const sorted = [...natural].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return [...groups.values()].map((parts, i) =>
    prepareVegetation(parts, { isLeaf, height: THREE.MathUtils.clamp((natural[i] * 9.5) / median, 7, 12.5), amp: 0.22 })
  );
}

function scannedCoconutPalm() {
  const scene = assets.scenes.coconut_palm;
  if (!scene) return null;
  const parts = groupMeshes(scene, () => 'tree').get('tree');
  if (!parts) return null;
  return prepareVegetation(parts, { isLeaf: (p) => p.material.alphaTest > 0 || p.material.transparent, height: 7.5, keepLean: true, amp: 0.18 });
}

function scannedPlants() {
  const scene = assets.scenes.tropical_plants;
  if (!scene) return null;
  const groups = groupMeshes(scene, (name) => {
    const m = /SM_MZRa_(Banana|Monstera|Palm|Fern)_(B\d+)/.exec(name);
    if (!m) return null;
    // The big fern variants are 3-10k triangles each; keep the light ones.
    if (m[1] === 'Fern' && m[2].length < 5) return null;
    return `${m[1]}_${m[2]}`;
  });
  const heights = { Banana: 3.0, Monstera: 1.5, Palm: 2.6, Fern: 0.8 };
  const weights = { Banana: 3, Monstera: 4, Palm: 2, Fern: 2 };
  const out = [];
  for (const [key, parts] of groups) {
    const kind = key.split('_')[0];
    const v = prepareVegetation(parts, { isLeaf: () => true, height: heights[kind], keepLean: true, swayBy: 'height', amp: kind === 'Fern' ? 0.05 : 0.12 });
    v.kind = kind;
    v.weight = weights[kind];
    out.push(v);
  }
  return out.length ? out : null;
}

const MAT = {};
function initMaterials() {
  MAT.wood = new THREE.MeshStandardMaterial({ map: T.woodTexture([156, 112, 70], 6, 1, [1, 1]), roughness: 0.85 });
  MAT.deck = new THREE.MeshStandardMaterial({ map: T.woodTexture([165, 125, 85], 8, 2, [3, 3]), roughness: 0.8 });
  MAT.woodDark = new THREE.MeshStandardMaterial({ map: T.woodTexture([95, 66, 42], 4, 3), roughness: 0.9 });
  MAT.woodWhite = new THREE.MeshStandardMaterial({ map: T.woodTexture([228, 222, 210], 5, 4), roughness: 0.7 });
  MAT.thatch = new THREE.MeshStandardMaterial({ map: T.thatchTexture(3, [5, 2]), roughness: 1, side: THREE.DoubleSide });
  MAT.trunk = new THREE.MeshStandardMaterial({ map: T.trunkTexture(), roughness: 0.95 });
  MAT.frond = swayMaterial({ vertexColors: true, roughness: 0.7, side: THREE.DoubleSide }, 0.22);
  MAT.grass = swayMaterial({ vertexColors: true, roughness: 0.9, side: THREE.DoubleSide }, 0.08);
  MAT.seagrass = swayMaterial({ color: 0x3f6a2c, roughness: 0.9, side: THREE.DoubleSide }, 0.18);
  MAT.rock = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, flatShading: false });
  MAT.coral = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  MAT.coconut = new THREE.MeshStandardMaterial({ color: 0x6b4a22, roughness: 0.7 });
  MAT.white = new THREE.MeshStandardMaterial({ color: 0xf2efe8, roughness: 0.6 });
  MAT.rope = new THREE.MeshStandardMaterial({ color: 0xc8b48a, roughness: 1 });
  MAT.metal = new THREE.MeshStandardMaterial({ color: 0x8a8f94, roughness: 0.35, metalness: 0.8 });
  MAT.red = new THREE.MeshStandardMaterial({ color: 0xb3261e, roughness: 0.6 });
  MAT.black = new THREE.MeshStandardMaterial({ color: 0x1b1b1b, roughness: 0.7 });
  MAT.bush = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  MAT.flower = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  MAT.fish = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.2 });
  MAT.flame = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
  MAT.glass = new THREE.MeshStandardMaterial({ color: 0xffe7a0, emissive: 0xffd27a, emissiveIntensity: 0, roughness: 0.1, transparent: true, opacity: 0.6 });
  // Photoscanned replacements where available (Poly Haven, CC0).
  MAT.wood = texMaterial('weathered_planks', { color: 0xd9c4a8, fallback: MAT.wood });
  MAT.woodDark = texMaterial('weathered_planks', { color: 0x9a8270, fallback: MAT.woodDark });
  MAT.deck = texMaterial('wooden_planks', { color: new THREE.Color(1.25, 1.2, 1.12), fallback: MAT.deck });
  MAT.thatch = texMaterial('thatch_roof_angled', { repeat: [14, 3], color: new THREE.Color(1.5, 1.22, 0.82), side: THREE.DoubleSide, fallback: MAT.thatch });
  MAT.trunk = texMaterial('palm_tree_bark', { color: 0xd6c7b0, normalScale: 1.5, fallback: MAT.trunk });
  MAT.rock = texMaterial('seaside_rock', { repeat: [1.5, 1.5], color: new THREE.Color(2.1, 1.95, 1.75), fallback: MAT.rock });
  MAT.bottle = ['#2f7d43', '#8a4a1c', '#c9d6dd', '#a82a33', '#d9a21e'].map(
    (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.15, transparent: true, opacity: 0.85 })
  );
}

// ---------------------------------------------------------------------------
// Geometry builders

function palmGeometry(H, lean, seed, droopy) {
  const r = rng(seed);
  const P0 = new THREE.Vector3(0, -0.6, 0);
  const P1 = new THREE.Vector3(lean * 0.12, H * 0.55, 0);
  const P2 = new THREE.Vector3(lean, H, 0);
  const bez = (t) =>
    new THREE.Vector3()
      .addScaledVector(P0, (1 - t) * (1 - t))
      .addScaledVector(P1, 2 * (1 - t) * t)
      .addScaledVector(P2, t * t);

  // Trunk
  const segs = 22;
  const radial = 10;
  const pos = [];
  const uv = [];
  const idx = [];
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const p = bez(t);
    const tan = bez(Math.min(1, t + 0.01)).sub(bez(Math.max(0, t - 0.01))).normalize();
    const B = new THREE.Vector3(tan.y, -tan.x, 0).normalize();
    const Z = new THREE.Vector3(0, 0, 1);
    const rad = 0.27 * (1 - 0.42 * t) + 0.16 * Math.exp(-t * 16) + 0.012 * Math.sin(t * H * 5.5);
    for (let j = 0; j <= radial; j++) {
      const a = (j / radial) * Math.PI * 2;
      const v = p.clone().addScaledVector(B, Math.cos(a) * rad).addScaledVector(Z, Math.sin(a) * rad);
      pos.push(v.x, v.y, v.z);
      uv.push(j / radial, (t * H) / 1.1);
    }
  }
  for (let i = 0; i < segs; i++) {
    for (let j = 0; j < radial; j++) {
      const a = i * (radial + 1) + j;
      const b = a + radial + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
  }
  const trunk = new THREE.BufferGeometry();
  trunk.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  trunk.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  trunk.setIndex(idx);
  trunk.computeVertexNormals();

  // Fronds
  const fp = [];
  const fc = [];
  const fs = [];
  const up = new THREE.Vector3(0, 1, 0);
  const crown = P2.clone().add(new THREE.Vector3(0, 0.15, 0));
  const nFronds = 13 + Math.floor(r() * 4);
  const green = new THREE.Color();
  for (let f = 0; f < nFronds; f++) {
    const ang = (f / nFronds) * Math.PI * 2 + r() * 0.4;
    const dir = new THREE.Vector3(Math.cos(ang), 0, Math.sin(ang));
    const dead = r() < 0.12;
    const L = (dead ? 3.2 : 3.6) + r() * 1.4;
    const lift = dead ? -0.6 : 0.5 + r() * 0.9 - (droopy ? 0.5 : 0);
    const droop = dead ? 3.5 : 2.2 + r() * 1.2;
    const side = new THREE.Vector3().crossVectors(dir, up).normalize();
    const N = 16;
    const spine = [];
    for (let i = 0; i <= N; i++) {
      const s = i / N;
      spine.push(
        crown
          .clone()
          .addScaledVector(dir, s * L)
          .addScaledVector(up, lift * Math.sin(s * Math.PI * 0.7) - droop * s * s)
      );
    }
    if (dead) green.setRGB(0.42, 0.3, 0.12);
    else green.setHSL(0.24 + r() * 0.05, 0.55 + r() * 0.15, 0.17 + r() * 0.07);
    for (let i = 1; i < N; i++) {
      const s = i / N;
      const a = spine[i];
      const b = spine[i + 1];
      const along = b.clone().sub(a);
      const leaf = (0.25 + 1.05 * Math.sin(Math.PI * Math.min(1, s * 1.15))) * (dead ? 0.6 : 1);
      for (const sgn of [-1, 1]) {
        const tip = a
          .clone()
          .addScaledVector(side, sgn * leaf * 0.85)
          .addScaledVector(up, -leaf * (0.45 + s * 0.3))
          .addScaledVector(along.clone().normalize(), leaf * 0.35);
        const base1 = a.clone();
        const base2 = a.clone().addScaledVector(along, 0.9);
        fp.push(base1.x, base1.y, base1.z, base2.x, base2.y, base2.z, tip.x, tip.y, tip.z);
        const dark = green.clone().multiplyScalar(0.7);
        const light = green.clone().multiplyScalar(1.25);
        fc.push(dark.r, dark.g, dark.b, dark.r, dark.g, dark.b, light.r, light.g, light.b);
        const sw = s * s;
        fs.push(sw * 0.8, sw * 0.8, sw);
      }
    }
  }
  const fronds = new THREE.BufferGeometry();
  fronds.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
  fronds.setAttribute('color', new THREE.Float32BufferAttribute(fc, 3));
  fronds.setAttribute('aSway', new THREE.Float32BufferAttribute(fs, 1));
  fronds.computeVertexNormals();

  // Coconuts
  const nuts = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.SphereGeometry(0.14, 10, 8);
    g.scale(1, 1.15, 1);
    g.translate(P2.x + (r() - 0.5) * 0.5, P2.y - 0.15 - r() * 0.25, (r() - 0.5) * 0.5);
    nuts.push(g);
  }
  const nutGeo = mergeGeometries(nuts);
  return { trunk, fronds, nuts: nutGeo, crown: P2.clone() };
}

function grassTuft(seed) {
  const r = rng(seed);
  const pos = [];
  const col = [];
  const sw = [];
  const base = new THREE.Color();
  for (let i = 0; i < 16; i++) {
    const a = r() * Math.PI * 2;
    const h = 0.16 + r() * 0.3;
    const w = 0.014 + r() * 0.012;
    const ox = (r() - 0.5) * 0.3;
    const oz = (r() - 0.5) * 0.3;
    const cx = Math.cos(a);
    const cz = Math.sin(a);
    const bend = 0.12 + r() * 0.15;
    pos.push(ox - cz * w, 0, oz + cx * w, ox + cz * w, 0, oz - cx * w, ox + cx * bend, h, oz + cz * bend);
    base.setHSL(0.2 + r() * 0.06, 0.5, 0.22 + r() * 0.08);
    const tip = base.clone().lerp(new THREE.Color(0.75, 0.72, 0.4), 0.35);
    col.push(base.r * 0.6, base.g * 0.6, base.b * 0.6, base.r * 0.6, base.g * 0.6, base.b * 0.6, tip.r, tip.g, tip.b);
    sw.push(0, 0, 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aSway', new THREE.Float32BufferAttribute(sw, 1));
  g.computeVertexNormals();
  return g;
}

function rockGeometry(seed, detail = 2) {
  const g = new THREE.IcosahedronGeometry(1, detail);
  const p = g.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = fbm(v.x * 1.3 + seed, v.y * 1.3 + v.z * 0.7, 3);
    v.multiplyScalar(0.7 + n * 0.6);
    v.y *= 0.65;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return g;
}

function bushGeometry(seed) {
  const r = rng(seed);
  const parts = [];
  for (let i = 0; i < 6; i++) {
    const g = rockGeometry(seed + i * 7, 1);
    const s = 0.5 + r() * 0.45;
    g.scale(s, s * 1.2, s);
    g.translate((r() - 0.5) * 1.1, 0.35 + r() * 0.5, (r() - 0.5) * 1.1);
    parts.push(g);
  }
  const m = mergeGeometries(parts);
  const c = [];
  const col = new THREE.Color();
  const p = m.attributes.position;
  for (let i = 0; i < p.count; i++) {
    col.setHSL(0.27 + r() * 0.05, 0.5, 0.12 + (p.getY(i) / 1.6) * 0.12 + r() * 0.03);
    c.push(col.r, col.g, col.b);
  }
  m.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  return m;
}

function fishGeometry() {
  const body = new THREE.SphereGeometry(0.5, 10, 6);
  body.scale(0.5, 0.36, 0.13);
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([-0.22, 0, 0, -0.42, 0.12, 0, -0.42, -0.12, 0], 3));
  tail.computeVertexNormals();
  const b2 = body.toNonIndexed();
  b2.deleteAttribute('uv');
  const g = mergeGeometries([b2, tail]);
  g.scale(0.55, 0.55, 0.55);
  return g;
}

// ---------------------------------------------------------------------------

export class World {
  constructor(scene, L) {
    initMaterials();
    this.scene = scene;
    this.L = L;
    this.colliders = []; // {x,z,r} circles or {x0,x1,z0,z1} boxes
    this.platforms = []; // {x0,x1,z0,z1,y} or {x,z,r,y}
    this.shade = []; // {x,z,r}
    this.roofs = []; // shade that also blocks rain, used for snacks/Kevin
    this.anim = [];
    this.lights = [];
    this.torches = [];
    this.coconutPalms = [];
    this.shells = [];
    this.exclude = [
      { x: L.bar.x, z: L.bar.z, r: 14 },
      { x: L.volleyball.x, z: L.volleyball.z, r: 12 },
      { x: L.yoga.x, z: L.yoga.z, r: 8 },
      { x: L.lighthouse.x, z: L.lighthouse.z, r: 9 },
      { x: L.hammock.x, z: L.hammock.z, r: 4 },
      { x: L.welcome.x, z: L.welcome.z, r: 3 },
      ...L.loungers.map((l) => ({ x: l.x, z: l.z, r: 3 })),
      ...L.bungalows.map((b) => ({ x: b.x, z: (b.walk0 + b.z) / 2, r: 4, line: true })),
      { x: L.dock.x, z: L.dock.z0, r: 4 },
    ];

    this.buildPalms();
    this.buildGrassAndBushes();
    this.buildRocks();
    this.buildReef();
    this.buildBar();
    this.buildBungalows();
    this.buildDock();
    this.buildBeachFurniture();
    this.buildHammock();
    this.buildVolleyball();
    this.buildLighthouse();
    this.buildYoga();
    this.buildSigns();
    this.buildShells();
  }

  add(obj, cast = true, receive = true) {
    obj.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = cast;
        o.receiveShadow = receive;
      }
    });
    this.scene.add(obj);
    return obj;
  }

  box(w, h, d, mat, x, y, z, parent, ry = 0) {
    const geo = new THREE.BoxGeometry(w, h, d);
    metreUVsBox(geo, w, h, d);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.y = ry;
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || this.scene).add(m);
    return m;
  }

  cyl(rt, rb, h, mat, x, y, z, parent, seg = 10) {
    const geo = new THREE.CylinderGeometry(rt, rb, h, seg);
    metreUVsCyl(geo, Math.max(rt, rb), h);
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    m.receiveShadow = true;
    (parent || this.scene).add(m);
    return m;
  }

  // Sloped walkway along +z from height yA at z0 to yB at z1.
  ramp(x, z0, z1, w, yA, yB) {
    const len = z1 - z0;
    const dy = yB - yA;
    const m = this.box(w, 0.18, Math.hypot(len, dy), MAT.deck, x, (yA + yB) / 2 - 0.09, (z0 + z1) / 2);
    m.rotation.x = -Math.atan2(dy, len);
    this.platforms.push({ x0: x - w / 2, x1: x + w / 2, z0, z1, y: yB, y0: yA });
  }

  excluded(x, z, pad = 0) {
    for (const e of this.exclude) {
      if (e.line) {
        if (Math.abs(x - e.x) < 3 + pad && z > e.z - 20 && z < e.z + 20) return true;
      } else if (Math.hypot(x - e.x, z - e.z) < e.r + pad) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------- palms
  buildPalms() {
    const r = rng(1234);
    let variants = [
      { H: 7.5, lean: 1.4 },
      { H: 9, lean: 2.6 },
      { H: 10.5, lean: 3.6 },
      { H: 8.2, lean: 0.6 },
      { H: 6.2, lean: 2.2, droopy: true },
    ].map((v, i) => ({ ...v, geo: palmGeometry(v.H, v.lean, 77 + i * 13, v.droopy), list: [] }));
    // Indices: which variants suit the beach (leaning), and the grove (coconuts).
    let beachVariants = [2, 2, 2, 1, 1];
    let groveVariants = [3, 4];
    let anyVariants = [0, 1, 2, 3, 4];

    const scanned = scannedPalms();
    if (scanned) {
      variants = scanned.map((v) => ({ ...v, list: [] }));
      const byLean = variants.map((v, i) => i).sort((a, b) => variants[b].leanRatio - variants[a].leanRatio);
      beachVariants = byLean.slice(0, Math.ceil(byLean.length * 0.6));
      anyVariants = byLean;
      groveVariants = byLean.slice(-4);
      const coco = scannedCoconutPalm();
      if (coco) {
        variants.push({ ...coco, list: [] });
        groveVariants = [variants.length - 1];
      }
    }
    const pick = (arr) => arr[Math.floor(r() * arr.length)];

    const placed = [];
    const tryPlace = (x, z, opts = {}) => {
      const h = height(x, z);
      if (h < 0.8 || h > 14) return false;
      if (slope(x, z) > 0.55) return false;
      if (this.excluded(x, z)) return false;
      for (const p of placed) if (Math.hypot(p.x - x, p.z - z) < (opts.spacing || 5)) return false;
      const len = Math.hypot(x, z) || 1;
      const beachy = smoothstep(4, 1.2, h);
      let lx = x / len;
      let lz = z / len;
      const wob = (r() - 0.5) * 1.6;
      const c = Math.cos(wob);
      const s = Math.sin(wob);
      [lx, lz] = [lx * c - lz * s, lx * s + lz * c];
      const vi = opts.grove ? pick(groveVariants) : beachy > 0.5 ? pick(beachVariants) : pick(anyVariants);
      const scale = 0.85 + r() * 0.3;
      placed.push({ x, z });
      variants[vi].list.push({ x, z, y: h, dir: Math.atan2(-lz, lx), scale, coconuts: !!opts.coconuts || r() < 0.3, grove: !!opts.coconuts });
      return true;
    };

    // Grove (coconut palms, shorter, reachable).
    for (let i = 0, n = 0; i < 400 && n < 16; i++) {
      const a = r() * Math.PI * 2;
      const d = Math.sqrt(r()) * this.L.grove.r;
      if (tryPlace(this.L.grove.x + Math.cos(a) * d, this.L.grove.z + Math.sin(a) * d, { coconuts: true, grove: true, spacing: 4.5 })) n++;
    }
    // Beach fringe: a ring of leaning palms just above the sand.
    for (let i = 0, n = 0; i < 700 && n < 95; i++) {
      const a = r() * Math.PI * 2;
      const s = findShore(0, 0, Math.cos(a), Math.sin(a));
      const back = 5 + r() * 18;
      if (tryPlace(s.x - Math.cos(a) * back, s.z - Math.sin(a) * back, { spacing: 6.5 })) n++;
    }
    // Scattered inland.
    for (let i = 0, n = 0; i < 900 && n < 40; i++) {
      if (tryPlace((r() - 0.5) * 300, (r() - 0.5) * 220, { spacing: 11 })) n++;
    }

    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (const v of variants) {
      const n = v.list.length;
      if (!n) continue;
      if (v.parts) {
        // Scanned palm: one instanced mesh per part (trunk, fronds, ...).
        const meshes = v.parts.map((p) => new THREE.InstancedMesh(p.geometry, p.mat, n));
        v.list.forEach((p, i) => {
          q.setFromAxisAngle(yAxis, p.dir);
          m4.compose(new THREE.Vector3(p.x, p.y - 0.1, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
          meshes.forEach((m) => m.setMatrixAt(i, m4));
          const crown = v.crown.clone().multiplyScalar(p.scale).applyQuaternion(q);
          this.shade.push({ x: p.x + crown.x, z: p.z + crown.z, r: 3.4 * p.scale });
          this.colliders.push({ x: p.x, z: p.z, r: 0.38 });
          if (p.grove) this.coconutPalms.push({ x: p.x, z: p.z, y: p.y, top: p.y + crown.y, cx: p.x + crown.x, cz: p.z + crown.z, nuts: 3 });
        });
        for (const m of meshes) {
          m.castShadow = true;
          m.receiveShadow = true;
          m.frustumCulled = false;
          this.scene.add(m);
        }
        continue;
      }
      const trunk = new THREE.InstancedMesh(v.geo.trunk, MAT.trunk, n);
      const fronds = new THREE.InstancedMesh(v.geo.fronds, MAT.frond, n);
      const nutsList = v.list.filter((p) => p.coconuts);
      const nuts = nutsList.length ? new THREE.InstancedMesh(v.geo.nuts, MAT.coconut, nutsList.length) : null;
      let ni = 0;
      v.list.forEach((p, i) => {
        q.setFromAxisAngle(yAxis, p.dir);
        m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.scale, p.scale, p.scale));
        trunk.setMatrixAt(i, m4);
        fronds.setMatrixAt(i, m4);
        if (p.coconuts && nuts) nuts.setMatrixAt(ni++, m4);
        const crown = v.geo.crown.clone().multiplyScalar(p.scale).applyQuaternion(q);
        this.shade.push({ x: p.x + crown.x, z: p.z + crown.z, r: 3.4 * p.scale });
        this.colliders.push({ x: p.x, z: p.z, r: 0.38 });
        if (p.grove) this.coconutPalms.push({ x: p.x, z: p.z, y: p.y, top: p.y + crown.y, cx: p.x + crown.x, cz: p.z + crown.z, nuts: 3 });
      });
      for (const m of [trunk, fronds, nuts]) {
        if (!m) continue;
        m.castShadow = true;
        m.receiveShadow = true;
        m.frustumCulled = false;
        this.scene.add(m);
      }
    }
    this.palmCount = placed.length;
  }

  // ---------------------------------------------------------- vegetation
  buildGrassAndBushes() {
    const r = rng(99);
    const tufts = [grassTuft(1), grassTuft(2), grassTuft(3)];
    const lists = [[], [], []];
    for (let i = 0; i < 40000; i++) {
      const x = (r() - 0.5) * 320;
      const z = (r() - 0.5) * 240;
      const h = height(x, z);
      if (h < 2.7 || h > 20) continue;
      if (slope(x, z) > 0.6) continue;
      if (fbm(x * 0.04, z * 0.04, 2) < 0.38) continue;
      if (this.excluded(x, z, -2)) continue;
      if (pathDistance(x, z, this.L.paths) < 1.8) continue;
      lists[i % 3].push({ x, z, y: h - 0.03, s: 0.6 + r() * 0.6, a: r() * 6.28 });
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yA = new THREE.Vector3(0, 1, 0);
    lists.forEach((list, k) => {
      const im = new THREE.InstancedMesh(tufts[k], MAT.grass, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(yA, p.a);
        m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        im.setMatrixAt(i, m4);
      });
      im.receiveShadow = true;
      im.frustumCulled = false;
      this.scene.add(im);
    });

    // Hibiscus bushes with flowers.
    const bushGeo = bushGeometry(5);
    const flowerGeo = new THREE.SphereGeometry(0.09, 6, 4);
    const bushes = [];
    for (let i = 0; i < 1500 && bushes.length < 90; i++) {
      const x = (r() - 0.5) * 300;
      const z = (r() - 0.5) * 220;
      const h = height(x, z);
      if (h < 2.8 || h > 16 || slope(x, z) > 0.5) continue;
      if (this.excluded(x, z, 1)) continue;
      if (pathDistance(x, z, this.L.paths) < 2.5) continue;
      bushes.push({ x, z, y: h - 0.1, s: 0.8 + r() * 0.8, a: r() * 6.28 });
    }

    // Scanned tropical plants (banana, monstera, small palms, ferns) take the
    // bushes' places when available, with a few extra around the island.
    const plants = scannedPlants();
    if (plants) {
      for (let i = 0; i < 2000 && bushes.length < 150; i++) {
        const x = (r() - 0.5) * 300;
        const z = (r() - 0.5) * 220;
        const h = height(x, z);
        if (h < 2.6 || h > 16 || slope(x, z) > 0.5) continue;
        if (this.excluded(x, z, 1)) continue;
        if (pathDistance(x, z, this.L.paths) < 2.2) continue;
        bushes.push({ x, z, y: h - 0.1, s: 0.8 + r() * 0.8, a: r() * 6.28 });
      }
      const total = plants.reduce((t, v) => t + v.weight, 0);
      const lists = plants.map(() => []);
      for (const b of bushes) {
        let w = r() * total;
        let vi = 0;
        while (w > plants[vi].weight && vi < plants.length - 1) w -= plants[vi++].weight;
        lists[vi].push({ ...b, s: 0.75 + r() * 0.5 });
      }
      plants.forEach((v, vi) => {
        const list = lists[vi];
        if (!list.length) return;
        const meshes = v.parts.map((p) => new THREE.InstancedMesh(p.geometry, p.mat, list.length));
        list.forEach((b, i) => {
          q.setFromAxisAngle(yA, b.a);
          m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.s, b.s, b.s));
          meshes.forEach((m) => m.setMatrixAt(i, m4));
          if (v.kind !== 'Fern') this.colliders.push({ x: b.x, z: b.z, r: (v.kind === 'Monstera' ? 0.6 : 0.35) * b.s });
        });
        for (const m of meshes) {
          m.castShadow = v.kind !== 'Fern';
          m.receiveShadow = true;
          m.frustumCulled = false;
          this.scene.add(m);
        }
      });
      return;
    }

    const bm = new THREE.InstancedMesh(bushGeo, MAT.bush, bushes.length);
    const flowers = [];
    bushes.forEach((b, i) => {
      q.setFromAxisAngle(yA, b.a);
      m4.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.s, b.s, b.s));
      bm.setMatrixAt(i, m4);
      this.colliders.push({ x: b.x, z: b.z, r: 0.8 * b.s });
      const hue = r();
      for (let f = 0; f < 9; f++) {
        const a = r() * 6.28;
        const d = (0.5 + r() * 0.5) * b.s;
        flowers.push({ x: b.x + Math.cos(a) * d, y: b.y + (0.5 + r() * 0.9) * b.s, z: b.z + Math.sin(a) * d, hue });
      }
    });
    bm.castShadow = bm.receiveShadow = true;
    this.scene.add(bm);
    const fm = new THREE.InstancedMesh(flowerGeo, MAT.flower, flowers.length);
    const fc = new THREE.Color();
    flowers.forEach((f, i) => {
      m4.makeTranslation(f.x, f.y, f.z);
      fm.setMatrixAt(i, m4);
      fc.set(f.hue < 0.5 ? '#e3263b' : f.hue < 0.8 ? '#ff6fa5' : '#ffb02e');
      fm.setColorAt(i, fc);
    });
    this.scene.add(fm);
  }

  buildRocks() {
    const r = rng(555);
    const scan07 = unitModel('rock_07');
    const scan09 = unitModel('rock_09');
    const geos = [scan07 ? scan07.geometry : rockGeometry(1), scan09 ? scan09.geometry : rockGeometry(2), rockGeometry(3)];
    const mats = [scan07 ? scan07.material : MAT.rock, scan09 ? scan09.material : MAT.rock, MAT.rock];
    const scanned = [!!scan07, !!scan09, false];
    // The scans are lit for a studio; lift them to sit in tropical daylight.
    for (const sc of [scan07, scan09]) if (sc) sc.material.color.setRGB(1.9, 1.8, 1.65);
    const lists = [[], [], []];
    for (let i = 0; i < 4000; i++) {
      const x = (r() - 0.5) * 360;
      const z = (r() - 0.5) * 280;
      const h = height(x, z);
      const sl = slope(x, z);
      const east = x > 90;
      const rocky = sl > 0.45 || (east && h > -1.5 && h < 6) || (h > -1.2 && h < 0.3 && r() < 0.04);
      if (!rocky || h < -3) continue;
      if (this.excluded(x, z, 3)) continue;
      if (r() > (east ? 0.5 : 0.12)) continue;
      const s = east ? 0.6 + r() * 2.2 : 0.3 + r() * 1.0;
      // Detailed scans only for the big boulders; small rocks stay simple.
      lists[s > 2.1 ? i % 2 : 2].push({ x, z, y: h - s * 0.2, s, a: r() * 6.28, t: r() });
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const c = new THREE.Color();
    lists.forEach((list, k) => {
      const im = new THREE.InstancedMesh(geos[k], mats[k], list.length);
      list.forEach((p, i) => {
        q.setFromEuler(new THREE.Euler(scanned[k] ? 0 : p.t * 0.4, p.a, 0));
        m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
        im.setMatrixAt(i, m4);
        if (scanned[k]) c.setHSL(0.08, 0.06, 0.85 + p.t * 0.15);
        else c.setHSL(0.08, 0.06 + p.t * 0.05, (MAT.rock.map ? 0.55 : 0.3) + p.t * 0.15);
        im.setColorAt(i, c);
        if (p.s > 0.7) this.colliders.push({ x: p.x, z: p.z, r: p.s * 0.85 });
      });
      im.castShadow = im.receiveShadow = true;
      this.scene.add(im);
    });
  }

  // ---------------------------------------------------------------- reef
  buildReef() {
    const r = rng(808);
    const R = this.L.reef;
    const brain = rockGeometry(9, 2);
    const branch = mergeGeometries(
      Array.from({ length: 7 }, (_, i) => {
        const g = new THREE.ConeGeometry(0.07, 0.9 + (i % 3) * 0.3, 5);
        g.translate(0, 0.45, 0);
        g.rotateZ((r() - 0.5) * 1.1);
        g.rotateX((r() - 0.5) * 1.1);
        return g;
      })
    );
    const fan = new THREE.CircleGeometry(0.7, 12, 0, Math.PI);
    fan.translate(0, 0.05, 0);
    const types = [brain, branch, fan];
    const palette = ['#e56b6f', '#f4a261', '#e9c46a', '#b5838d', '#9b5de5', '#f15bb5', '#00bbf9', '#c9a227'];
    const lists = [[], [], []];
    for (let i = 0; i < 2200; i++) {
      const x = R.x0 - 30 + r() * (R.x1 - R.x0 + 50);
      const z = R.z0 - 10 + r() * (R.z1 - R.z0 + 20);
      const h = height(x, z);
      if (h > -1.8 || h < -12) continue;
      const clump = fbm(x * 0.06, z * 0.06, 2);
      if (clump < 0.4) continue;
      const k = r() < 0.45 ? 0 : r() < 0.6 ? 1 : 2;
      lists[k].push({ x, z, y: h, s: 0.6 + r() * 1.3, a: r() * 6.28, c: palette[Math.floor(r() * palette.length)] });
    }
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const yA = new THREE.Vector3(0, 1, 0);
    const col = new THREE.Color();
    lists.forEach((list, k) => {
      const mat = k === 2 ? MAT.coral.clone() : MAT.coral;
      if (k === 2) mat.side = THREE.DoubleSide;
      const im = new THREE.InstancedMesh(types[k], mat, list.length);
      list.forEach((p, i) => {
        q.setFromAxisAngle(yA, p.a);
        m4.compose(new THREE.Vector3(p.x, p.y - (k === 0 ? 0.15 : 0), p.z), q, new THREE.Vector3(p.s, p.s * (k === 0 ? 0.8 : 1), p.s));
        im.setMatrixAt(i, m4);
        col.set(p.c);
        im.setColorAt(i, col);
      });
      this.scene.add(im);
    });

    // Sea grass meadows in the shallows.
    const blade = new THREE.PlaneGeometry(0.035, 0.6, 1, 3);
    blade.translate(0, 0.3, 0);
    const sw = [];
    const bp = blade.attributes.position;
    for (let i = 0; i < bp.count; i++) sw.push(bp.getY(i) / 0.6);
    blade.setAttribute('aSway', new THREE.Float32BufferAttribute(sw, 1));
    const grass = [];
    for (let i = 0; i < 30000 && grass.length < 6000; i++) {
      const x = (r() - 0.5) * 340;
      const z = 40 + r() * 120;
      const h = height(x, z);
      if (h > -0.9 || h < -4) continue;
      if (fbm(x * 0.03 + 9, z * 0.03, 2) < 0.55) continue;
      grass.push({ x, z, y: h, a: r() * 6.28, s: 0.6 + r() * 0.9 });
    }
    const gm = new THREE.InstancedMesh(blade, MAT.seagrass, grass.length);
    grass.forEach((p, i) => {
      q.setFromAxisAngle(yA, p.a);
      m4.compose(new THREE.Vector3(p.x, p.y, p.z), q, new THREE.Vector3(p.s, p.s, p.s));
      gm.setMatrixAt(i, m4);
    });
    gm.frustumCulled = false;
    this.scene.add(gm);

    // Fish schools.
    const schools = [];
    for (let s = 0; s < 6; s++) {
      const cx = R.x0 + r() * (R.x1 - R.x0);
      const cz = R.z0 + r() * (R.z1 - R.z0);
      const depth = height(cx, cz);
      schools.push({ cx, cz, y: Math.min(-0.8, depth * 0.5), rad: 4 + r() * 5, speed: 0.15 + r() * 0.2, color: ['#ffd23f', '#3bceac', '#ee4266', '#5e9cff', '#ffffff', '#ff9f1c'][s] });
    }
    this.fishData = [];
    schools.forEach((sc, si) => {
      for (let i = 0; i < 16; i++) this.fishData.push({ sc, off: r() * 6.28, rr: 0.6 + r() * 0.8, dy: (r() - 0.5) * 1.2, ph: r() * 6, flee: new THREE.Vector3() });
    });
    this.fish = new THREE.InstancedMesh(fishGeometry(), MAT.fish, this.fishData.length);
    this.fishData.forEach((f, i) => this.fish.setColorAt(i, col.set(f.sc.color)));
    this.fish.frustumCulled = false;
    this.scene.add(this.fish);

    // A sea turtle that patrols the reef.
    const turtle = new THREE.Group();
    const shell = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), new THREE.MeshStandardMaterial({ color: 0x5a4a2a, roughness: 0.6 }));
    shell.scale.set(1, 0.35, 1.2);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshStandardMaterial({ color: 0x7d8a5a }));
    head.position.set(0, 0, 0.68);
    turtle.add(shell, head);
    this.flippers = [];
    for (const sx of [-1, 1]) {
      const fl = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.04, 0.2), head.material);
      fl.position.set(sx * 0.55, 0, 0.3);
      turtle.add(fl);
      this.flippers.push(fl);
    }
    this.turtle = turtle;
    this.scene.add(turtle);
  }

  updateFish(t, player) {
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const p = new THREE.Vector3();
    const s = new THREE.Vector3(1, 1, 1);
    this.fishData.forEach((f, i) => {
      const a = t * f.sc.speed + f.off;
      p.set(f.sc.cx + Math.cos(a) * f.sc.rad * f.rr, f.sc.y + f.dy + Math.sin(t * 0.7 + f.ph) * 0.2, f.sc.cz + Math.sin(a) * f.sc.rad * f.rr);
      if (player) {
        const d = p.distanceTo(player);
        if (d < 3) f.flee.addScaledVector(p.clone().sub(player).normalize(), 0.08);
      }
      f.flee.multiplyScalar(0.97);
      p.add(f.flee);
      p.y = Math.min(p.y, -0.35);
      e.set(0, -a - Math.PI, Math.sin(t * 8 + f.ph) * 0.15);
      q.setFromEuler(e);
      m4.compose(p, q, s);
      this.fish.setMatrixAt(i, m4);
    });
    this.fish.instanceMatrix.needsUpdate = true;

    const R = this.L.reef;
    const ta = t * 0.03;
    const tx = (R.x0 + R.x1) / 2 + Math.cos(ta) * 22;
    const tz = (R.z0 + R.z1) / 2 + Math.sin(ta * 1.3) * 12;
    const ty = Math.min(-1, height(tx, tz) + 0.9);
    this.turtle.position.set(tx, ty, tz);
    const nx = (R.x0 + R.x1) / 2 + Math.cos(ta + 0.01) * 22;
    const nz = (R.z0 + R.z1) / 2 + Math.sin((ta + 0.01) * 1.3) * 12;
    this.turtle.rotation.y = Math.atan2(nx - tx, nz - tz);
    this.flippers.forEach((fl, i) => (fl.rotation.z = Math.sin(t * 1.6) * 0.5 * (i ? 1 : -1)));
  }

  // ---------------------------------------------------------- structures
  torch(x, z, h = 2.2, light = false) {
    const g = height(x, z);
    const pole = this.cyl(0.05, 0.07, h, MAT.woodDark, x, g + h / 2, z);
    const cup = this.cyl(0.14, 0.08, 0.3, MAT.woodDark, x, g + h + 0.1, z);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.5, 8), MAT.flame.clone());
    flame.position.set(x, g + h + 0.45, z);
    this.scene.add(flame);
    let pl = null;
    if (light) {
      pl = new THREE.PointLight(0xff9a40, 0, 18, 1.6);
      pl.position.set(x, g + h + 0.6, z);
      this.scene.add(pl);
    }
    this.torches.push({ flame, light: pl, ph: Math.random() * 10 });
    this.colliders.push({ x, z, r: 0.2 });
    return { pole, cup };
  }

  buildBar() {
    const { x, z } = this.L.bar;
    const g = height(x, z);
    const top = g + 0.4;
    this.barFloor = top;
    const grp = new THREE.Group();
    grp.position.set(x, 0, z);
    this.scene.add(grp);
    const deck = this.cyl(7.6, 7.8, 1.6, MAT.deck, 0, top - 0.8, 0, grp, 10);
    deck.rotation.y = Math.PI / 10;
    this.platforms.push({ x, z, r: 7.6, y: top });

    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      this.cyl(0.16, 0.2, 4.2, MAT.woodDark, Math.cos(a) * 7.1, top + 1.6, Math.sin(a) * 7.1, grp, 8);
      this.colliders.push({ x: x + Math.cos(a) * 7.1, z: z + Math.sin(a) * 7.1, r: 0.25 });
    }
    const roof = new THREE.Mesh(new THREE.ConeGeometry(9.6, 4.4, 10, 3, true), MAT.thatch);
    roof.position.set(0, top + 3.7 + 2.2, 0);
    grp.add(roof);
    const roofFringe = new THREE.Mesh(new THREE.CylinderGeometry(9.6, 9.9, 0.6, 10, 1, true), MAT.thatch);
    roofFringe.position.set(0, top + 3.55, 0);
    grp.add(roofFringe);
    this.shade.push({ x, z, r: 9.2 });
    this.roofs.push({ x, z, r: 8.5 });

    // Ring counter with a gap for Dez to get in.
    const segs = 9;
    for (let i = 0; i < segs; i++) {
      const a = ((i + 0.5) / (segs + 1)) * Math.PI * 2 - Math.PI / 2 + Math.PI / (segs + 1);
      const cx = Math.cos(a) * 3.2;
      const cz = Math.sin(a) * 3.2;
      const b = this.box(2.1, 1.1, 0.5, MAT.wood, cx, top + 0.55, cz, grp, -a + Math.PI / 2);
      const slab = this.box(2.3, 0.08, 0.85, MAT.deck, cx, top + 1.14, cz, grp, -a + Math.PI / 2);
      this.colliders.push({ x: x + cx, z: z + cz, r: 0.75 });
      // bottles on the counter
      if (i % 2 === 0) {
        const bottle = this.cyl(0.04, 0.05, 0.3, MAT.bottle[i % 5], cx, top + 1.33, cz, grp, 8);
        bottle.castShadow = false;
      }
      // stools
      const sx = Math.cos(a) * 4.5;
      const sz = Math.sin(a) * 4.5;
      const stool = unitModel('bar_chair_round_01', 0.5, 0);
      if (stool) {
        const sm = new THREE.Mesh(stool.geometry, stool.material);
        sm.position.set(sx, top, sz);
        sm.rotation.y = -a - Math.PI / 2;
        sm.castShadow = sm.receiveShadow = true;
        grp.add(sm);
      } else {
        this.cyl(0.25, 0.25, 0.08, MAT.woodDark, sx, top + 0.78, sz, grp, 12);
        this.cyl(0.05, 0.08, 0.76, MAT.metal, sx, top + 0.38, sz, grp, 6);
      }
      void b;
      void slab;
    }
    // Back bar: central post with shelves of bottles.
    this.cyl(0.25, 0.25, 4.2, MAT.woodDark, 0, top + 2.1, -0.6, grp, 10);
    for (let s = 0; s < 2; s++) {
      this.cyl(1.0, 1.0, 0.06, MAT.wood, 0, top + 1.5 + s * 0.6, -0.6, grp, 16);
      for (let b = 0; b < 10; b++) {
        const a = (b / 10) * Math.PI * 2;
        const bm = this.cyl(0.045, 0.055, 0.32, MAT.bottle[(b + s) % 5], Math.cos(a) * 0.8, top + 1.7 + s * 0.6, -0.6 + Math.sin(a) * 0.8, grp, 8);
        bm.castShadow = false;
      }
    }
    this.colliders.push({ x, z: z - 0.6, r: 1.1 });

    // Signs front & back
    const signTex = T.textTexture(['THE SALTY COCONUT', { text: 'cocktails · snacks · unsolicited wisdom', font: 'italic 48px Georgia, serif' }]);
    for (const dir of [1, -1]) {
      const sign = new THREE.Mesh(new THREE.PlaneGeometry(5.2, 1.3), new THREE.MeshStandardMaterial({ map: signTex, roughness: 0.8 }));
      sign.position.set(0, top + 3.15, dir * 7.25);
      if (dir < 0) sign.rotation.y = Math.PI;
      grp.add(sign);
    }
    // Torches
    for (const [dx, dz, l] of [[9.6, 6, true], [-9.6, 6, true], [9.6, -6, false], [-9.6, -6, false]]) this.torch(x + dx, z + dz, 2.2, l);

    // String lights between posts.
    this.bulbs = [];
    const bulbMat = new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffc96b, emissiveIntensity: 0 });
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2;
      const a1 = ((i + 1) / 10) * Math.PI * 2;
      for (let k = 1; k < 6; k++) {
        const t = k / 6;
        const ax = Math.cos(a0) * 7.15 * (1 - t) + Math.cos(a1) * 7.15 * t;
        const az = Math.sin(a0) * 7.15 * (1 - t) + Math.sin(a1) * 7.15 * t;
        const sag = Math.sin(t * Math.PI) * 0.35;
        const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 4), bulbMat);
        b.position.set(ax, top + 3.35 - sag, az);
        grp.add(b);
      }
    }
    this.bulbMat = bulbMat;

    this.dezSpot = { x, z: z + 0.8, y: top };
    this.barSeats = { x, z, top };
  }

  hut(b) {
    const deckY = 1.75;
    const grp = new THREE.Group();
    grp.position.set(b.x, 0, b.z);
    this.scene.add(grp);
    // Deck
    this.box(10, 0.25, 9.5, MAT.deck, 0, deckY - 0.12, 0, grp);
    this.platforms.push({ x0: b.x - 5, x1: b.x + 5, z0: b.z - 4.75, z1: b.z + 4.75, y: deckY });
    for (const sx of [-4.7, 0, 4.7]) {
      for (const sz of [-4.5, 0, 4.5]) {
        const bed = height(b.x + sx, b.z + sz);
        const len = deckY - bed + 0.5;
        this.cyl(0.14, 0.16, len, MAT.woodDark, sx, bed + len / 2 - 0.5, sz, grp, 8);
      }
    }
    // Railing on the seaward sides.
    for (const [w, d, px, pz] of [[10, 0.08, 0, 4.7], [0.08, 9.5, 4.95, 0], [0.08, 9.5, -4.95, 0]]) {
      this.box(w, 0.08, d, MAT.woodWhite, px, deckY + 0.95, pz, grp);
    }
    for (let i = -4.5; i <= 4.5; i += 1.5) {
      this.cyl(0.04, 0.04, 0.95, MAT.woodWhite, i, deckY + 0.47, 4.7, grp, 5);
      this.cyl(0.04, 0.04, 0.95, MAT.woodWhite, 4.95, deckY + 0.47, i, grp, 5);
      this.cyl(0.04, 0.04, 0.95, MAT.woodWhite, -4.95, deckY + 0.47, i, grp, 5);
    }
    this.colliders.push({ x0: b.x - 5.2, x1: b.x + 5.2, z0: b.z + 4.55, z1: b.z + 4.9, y: deckY + 1, yMin: deckY - 0.6 });
    this.colliders.push({ x0: b.x + 4.8, x1: b.x + 5.2, z0: b.z - 4.8, z1: b.z + 4.9, y: deckY + 1, yMin: deckY - 0.6 });
    this.colliders.push({ x0: b.x - 5.2, x1: b.x - 4.8, z0: b.z - 4.8, z1: b.z + 4.9, y: deckY + 1, yMin: deckY - 0.6 });

    // Walls (hut occupies the seaward half of the deck).
    const wy = deckY + 1.35;
    const h = 2.7;
    const hz0 = -1.0;
    const hz1 = 4.2;
    const wall = (w, d, px, pz) => {
      this.box(w, h, d, MAT.wood, px, wy, pz, grp);
      this.colliders.push({ x0: b.x + px - w / 2, x1: b.x + px + w / 2, z0: b.z + pz - d / 2, z1: b.z + pz + d / 2, y: deckY + h, yMin: deckY - 0.6 });
    };
    wall(7, 0.15, 0, hz1); // back
    wall(0.15, hz1 - hz0, -3.5, (hz0 + hz1) / 2);
    wall(0.15, hz1 - hz0, 3.5, (hz0 + hz1) / 2);
    wall(2.6, 0.15, -2.2, hz0); // front left
    wall(2.6, 0.15, 2.2, hz0); // front right
    this.box(1.8, 0.5, 0.15, MAT.wood, 0, deckY + h - 0.25 + 0.1, hz0, grp); // lintel
    const roof = new THREE.Mesh(new THREE.ConeGeometry(5.9, 3.1, 4, 2, true), MAT.thatch);
    roof.rotation.y = Math.PI / 4;
    roof.position.set(0, deckY + h + 1.5, (hz0 + hz1) / 2);
    roof.scale.set(1, 1, 0.95);
    grp.add(roof);
    this.shade.push({ x: b.x, z: b.z + (hz0 + hz1) / 2, r: 4.2 });
    this.roofs.push({ x: b.x, z: b.z + (hz0 + hz1) / 2, r: 3.2 });

    // Bed
    this.box(2.2, 0.4, 2.4, MAT.woodDark, -1.6, deckY + 0.2, 2.8, grp);
    this.box(2.1, 0.22, 2.3, MAT.white, -1.6, deckY + 0.5, 2.8, grp);
    this.box(0.9, 0.16, 0.45, MAT.white, -2.1, deckY + 0.68, 3.65, grp);
    this.box(0.9, 0.16, 0.45, MAT.white, -1.1, deckY + 0.68, 3.65, grp);
    const throwMat = new THREE.MeshStandardMaterial({ map: T.fabricTexture(['#0f6e73', '#f3e9d2', '#e07a5f', '#f3e9d2']), roughness: 0.9 });
    this.box(2.12, 0.04, 0.9, throwMat, -1.6, deckY + 0.62, 2.0, grp);
    this.colliders.push({ x0: b.x - 2.75, x1: b.x - 0.45, z0: b.z + 1.55, z1: b.z + 4.05, y: deckY + 0.6, yMin: deckY - 0.6 });

    // Front deck: two loungers and a little table.
    for (const sx of [-2.8, 2.8]) {
      this.box(0.8, 0.12, 2, MAT.woodWhite, sx, deckY + 0.35, -3.2, grp);
      const back = this.box(0.8, 0.9, 0.08, MAT.woodWhite, sx, deckY + 0.7, -2.2, grp);
      back.rotation.x = -0.5;
    }
    this.cyl(0.4, 0.4, 0.05, MAT.woodWhite, 0, deckY + 0.6, -3.4, grp, 14);
    this.cyl(0.05, 0.05, 0.6, MAT.woodWhite, 0, deckY + 0.3, -3.4, grp, 6);
    if (b.mine) {
      const bottle = this.cyl(0.05, 0.06, 0.2, new THREE.MeshStandardMaterial({ color: 0xff8c3a, roughness: 0.4 }), 0.1, deckY + 0.73, -3.4, grp, 10);
      bottle.castShadow = false;
      this.sunscreenBottle = bottle;
    }
    // Number plaque
    const plaque = new THREE.Mesh(
      new THREE.PlaneGeometry(0.7, 0.45),
      new THREE.MeshStandardMaterial({ map: T.textTexture([String(b.number)], { w: 256, h: 160, font: 'bold 110px Georgia, serif' }) })
    );
    plaque.position.set(1.4, deckY + 2.1, hz0 - 0.09);
    plaque.rotation.y = Math.PI;
    grp.add(plaque);

    // Ladder into the water off the east side.
    for (let k = 0; k < 5; k++) this.box(0.6, 0.05, 0.08, MAT.metal, 5.15, deckY - 0.35 * k, 1.5, grp);
    for (const lz of [1.2, 1.8]) this.cyl(0.03, 0.03, 2.2, MAT.metal, 5.15, deckY - 0.6, lz, grp, 6);

    // Boardwalk to the beach.
    const rampStart = b.walk0 - 4;
    const z0 = b.walk0 + 2;
    const z1 = b.z - 4.75;
    const walkY = 1.6;
    this.ramp(b.x, rampStart, z0, 2.4, height(b.x, rampStart) + 0.08, walkY);
    const len = z1 - z0;
    const walk = this.box(2.4, 0.18, len, MAT.deck, b.x, walkY - 0.09, (z0 + z1) / 2);
    walk.material = MAT.deck;
    this.platforms.push({ x0: b.x - 1.2, x1: b.x + 1.2, z0, z1: z1 + 0.1, y: walkY });
    for (let zz = z0 + 1; zz < z1; zz += 3) {
      for (const sx of [-1.1, 1.1]) {
        const bed = height(b.x + sx, zz);
        const l = walkY - bed + 0.6;
        this.cyl(0.08, 0.09, l, MAT.woodDark, b.x + sx, bed + l / 2 - 0.6, zz, null, 6);
        this.cyl(0.035, 0.035, 0.9, MAT.woodDark, b.x + sx, walkY + 0.45, zz, null, 5);
      }
    }
    for (const sx of [-1.15, 1.15]) {
      this.box(0.06, 0.06, len, MAT.rope, b.x + sx, walkY + 0.85, (z0 + z1) / 2);
      if (height(b.x, z0 + 6) < 0.5) {
        this.colliders.push({ x0: b.x + sx - 0.1, x1: b.x + sx + 0.1, z0: z0 + 6, z1, y: walkY + 1, yMin: walkY - 0.6 });
      }
    }
    return { deckY, bed: { x: b.x - 1.6, z: b.z + 2.8 }, table: { x: b.x, z: b.z - 3.4 }, ladder: { x: b.x + 5.4, z: b.z + 1.5 } };
  }

  buildBungalows() {
    this.huts = this.L.bungalows.map((b) => ({ ...b, ...this.hut(b) }));
    this.myHut = this.huts.find((h) => h.mine);
  }

  buildDock() {
    const D = this.L.dock;
    const y = 1.35;
    const rz = D.z0 + 6;
    this.ramp(D.x, D.z0 - 2, rz, 3.2, height(D.x, D.z0 - 2) + 0.08, y);
    this.box(3.2, 0.2, D.z1 - rz, MAT.deck, D.x, y - 0.1, (rz + D.z1) / 2);
    this.platforms.push({ x0: D.x - 1.6, x1: D.x + 1.6, z0: rz, z1: D.z1, y });
    this.box(12, 0.2, 5, MAT.deck, D.x, y - 0.1, D.z1 - 2.5);
    this.platforms.push({ x0: D.x - 6, x1: D.x + 6, z0: D.z1 - 5, z1: D.z1, y });
    for (let zz = D.z0 + 1; zz < D.z1; zz += 4) {
      for (const sx of [-1.5, 1.5]) {
        const bed = height(D.x + sx, zz);
        const l = y - bed + 0.8;
        this.cyl(0.12, 0.13, l, MAT.woodDark, D.x + sx, bed + l / 2 - 0.7, zz, null, 8);
      }
    }
    for (const sx of [-5.8, -2, 2, 5.8]) {
      const bed = height(D.x + sx, D.z1 - 0.3);
      const l = y - bed + 1.4;
      this.cyl(0.13, 0.14, l, MAT.woodDark, D.x + sx, bed + l / 2 - 0.7, D.z1 - 0.3, null, 8);
      this.colliders.push({ x: D.x + sx, z: D.z1 - 0.3, r: 0.25 });
    }
    // Boat
    const boat = new THREE.Group();
    const hull = new THREE.BoxGeometry(2.6, 1.2, 7.5, 4, 2, 8);
    const hp = hull.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const zz = hp.getZ(i);
      const yy = hp.getY(i);
      let xx = hp.getX(i);
      const bow = smoothstep(1.2, 3.75, zz);
      xx *= 1 - bow * 0.9;
      xx *= yy < 0 ? 0.65 : 1;
      hp.setXYZ(i, xx, yy + bow * bow * 0.35, zz);
    }
    hull.computeVertexNormals();
    const hullMat = new THREE.MeshStandardMaterial({ color: 0xf4f1ea, roughness: 0.45 });
    boat.add(new THREE.Mesh(hull, hullMat));
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.62, 0.14, 6.5), new THREE.MeshStandardMaterial({ color: 0x1f5fa8 }));
    stripe.position.set(0, 0.25, -0.4);
    stripe.scale.x = 1.002;
    boat.add(stripe);
    const name = T.textTexture(['The Unsinkable II'], { w: 1024, h: 160, bg: null, border: false, fg: '#1f3b6b', font: 'italic bold 96px Georgia, serif' });
    for (const s of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.PlaneGeometry(3, 0.45), new THREE.MeshBasicMaterial({ map: name, transparent: true }));
      plate.position.set(s * 1.33, 0.05, -1);
      plate.rotation.y = s * Math.PI / 2;
      boat.add(plate);
    }
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 1.8), hullMat);
    cabin.position.set(0, 1.1, -1.2);
    boat.add(cabin);
    const canopy = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.08, 3.2), new THREE.MeshStandardMaterial({ color: 0x1f5fa8 }));
    canopy.position.set(0, 1.75, -1.6);
    boat.add(canopy);
    boat.position.set(D.x + 4.2, 0.35, D.z1 - 11);
    boat.traverse((o) => (o.castShadow = o.receiveShadow = true));
    this.scene.add(boat);
    this.boat = boat;
    this.colliders.push({ x0: D.x + 2.9, x1: D.x + 5.5, z0: D.z1 - 15, z1: D.z1 - 7.2, y: 2 });

    this.captainSpot = { x: D.x - 0.6, z: D.z1 - 4, y };
  }

  buildBeachFurniture() {
    const cushionColors = ['#f4f1de', '#e07a5f', '#3d9a9b', '#f2cc8f'];
    this.L.loungers.forEach((l, i) => {
      const g = Math.max(height(l.x, l.z), 0.3);
      const grp = new THREE.Group();
      grp.position.set(l.x, g, l.z);
      grp.rotation.y = Math.PI; // face the sea (+z)
      this.scene.add(grp);
      const cmat = new THREE.MeshStandardMaterial({ color: cushionColors[i % 4], roughness: 0.95 });
      this.box(0.75, 0.08, 1.4, MAT.woodWhite, 0, 0.35, -0.3, grp);
      this.box(0.7, 0.08, 1.35, cmat, 0, 0.43, -0.3, grp);
      const back = this.box(0.7, 0.08, 0.9, cmat, 0, 0.75, 0.62, grp);
      back.rotation.x = 0.85;
      for (const [sx, sz] of [[-0.33, -0.9], [0.33, -0.9], [-0.33, 0.3], [0.33, 0.3]]) this.cyl(0.03, 0.03, 0.35, MAT.woodWhite, sx, 0.17, sz, grp, 5);
      this.colliders.push({ x: l.x, z: l.z, r: 0.6 });
      // towel
      if (i % 3 === 1) {
        const towel = this.box(0.6, 0.02, 0.9, new THREE.MeshStandardMaterial({ map: T.fabricTexture(['#f9c74f', '#277da1', '#f9c74f']) }), 0, 0.48, -0.4, grp);
        towel.castShadow = false;
      }
    });
    const umb = new THREE.MeshStandardMaterial({ map: T.stripeTexture(['#e63946', '#f1faee'], 12), roughness: 0.9, side: THREE.DoubleSide });
    this.L.umbrellas.forEach((u) => {
      const g = height(u.x, u.z);
      this.cyl(0.04, 0.04, 2.7, MAT.woodWhite, u.x, g + 1.2, u.z, null, 6);
      const canopy = new THREE.Mesh(new THREE.ConeGeometry(2.4, 0.8, 12, 1, true), umb);
      canopy.position.set(u.x, g + 2.65, u.z);
      canopy.castShadow = true;
      this.scene.add(canopy);
      this.shade.push({ x: u.x, z: u.z + 1.2, r: 2.6 });
      this.colliders.push({ x: u.x, z: u.z, r: 0.1 });
    });
  }

  buildHammock() {
    const H = this.L.hammock;
    const g = height(H.x, H.z);
    for (const p of [H.a, H.b]) {
      this.cyl(0.13, 0.16, 2.6, MAT.woodDark, p.x, height(p.x, p.z) + 1.1, p.z, null, 9);
      this.colliders.push({ x: p.x, z: p.z, r: 0.25 });
    }
    const Lh = 3.2;
    const segU = 24;
    const segV = 8;
    const pos = [];
    const uv = [];
    const idx = [];
    for (let i = 0; i <= segU; i++) {
      const u = i / segU;
      const xx = (u - 0.5) * Lh;
      const k = 1 - (2 * xx / Lh) ** 2;
      const half = 0.55 * Math.sqrt(Math.max(k, 0)) + 0.04;
      for (let j = 0; j <= segV; j++) {
        const v = j / segV;
        const zz = (v - 0.5) * 2 * half;
        const yy = -0.62 * k - 0.14 * (1 - ((v - 0.5) * 2) ** 2) * k;
        pos.push(xx, yy, zz);
        uv.push(u, v);
      }
    }
    for (let i = 0; i < segU; i++) for (let j = 0; j < segV; j++) {
      const a = i * (segV + 1) + j;
      const b = a + segV + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const fabric = new THREE.MeshStandardMaterial({ map: T.fabricTexture(['#d62828', '#f77f00', '#fcbf49', '#eae2b7', '#003049']), side: THREE.DoubleSide, roughness: 0.95 });
    const swing = new THREE.Group();
    swing.position.set(H.x, g + 1.55, H.z);
    const mesh = new THREE.Mesh(geo, fabric);
    mesh.castShadow = mesh.receiveShadow = true;
    swing.add(mesh);
    for (const s of [-1, 1]) {
      const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.6, 4), MAT.rope);
      rope.rotation.z = Math.PI / 2;
      rope.position.set(s * (Lh / 2 + 0.3), 0.03, 0);
      swing.add(rope);
    }
    this.scene.add(swing);
    this.hammockSwing = swing;
    this.hammockSeat = { x: H.x, z: H.z, y: g + 1.0 };
  }

  buildVolleyball() {
    const V = this.L.volleyball;
    const g = height(V.x, V.z);
    for (const s of [-1, 1]) {
      this.cyl(0.06, 0.06, 2.8, MAT.metal, V.x + s * 4.8, height(V.x + s * 4.8, V.z) + 1.3, V.z, null, 8);
      this.colliders.push({ x: V.x + s * 4.8, z: V.z, r: 0.15 });
    }
    const netTex = T.netTexture();
    netTex.repeat.set(24, 2.5);
    const net = new THREE.Mesh(new THREE.PlaneGeometry(9.6, 0.9), new THREE.MeshStandardMaterial({ map: netTex, transparent: true, alphaTest: 0.4, side: THREE.DoubleSide }));
    net.position.set(V.x, g + 2.05, V.z);
    this.scene.add(net);
    this.box(9.6, 0.06, 0.03, MAT.white, V.x, g + 2.5, V.z);
    // Court boundary ropes
    const ropeMat = new THREE.MeshStandardMaterial({ color: 0x1d4e89 });
    for (const [w, d, dx, dz] of [[9, 0.05, 0, 9], [9, 0.05, 0, -9], [0.05, 18, 4.5, 0], [0.05, 18, -4.5, 0]]) {
      const m = this.box(w, 0.03, d, ropeMat, V.x + dx, 0, V.z + dz);
      m.position.y = height(V.x + dx, V.z + dz) + 0.02;
      m.castShadow = false;
    }
    const ballMat = new THREE.MeshStandardMaterial({ map: T.stripeTexture(['#ffd23f', '#ffffff', '#1d4e89'], 6), roughness: 0.6 });
    const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), ballMat);
    ball.position.set(V.x + 5.4, height(V.x + 5.4, V.z + 1) + 0.11, V.z + 1);
    ball.castShadow = true;
    this.scene.add(ball);
    this.ball = ball;
    this.pearlSpot = { x: V.x - 1, z: V.z - 4 };
    this.playerCourt = { x: V.x, z: V.z + 4 };
  }

  buildLighthouse() {
    const P = this.L.lighthouse;
    const g = height(P.x, P.z) - 0.5;
    const body = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 2.6, 15, 28), new THREE.MeshStandardMaterial({ map: T.bandTexture(['#f3efe6', '#b3261e'], 6), roughness: 0.7 }));
    body.position.set(P.x, g + 7.5, P.z);
    this.add(body);
    this.colliders.push({ x: P.x, z: P.z, r: 2.8 });
    this.cyl(2.5, 2.5, 0.25, MAT.black, P.x, g + 15.1, P.z, null, 24);
    const rail = new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.04, 6, 32), MAT.black);
    rail.rotation.x = Math.PI / 2;
    rail.position.set(P.x, g + 16, P.z);
    this.scene.add(rail);
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      this.cyl(0.025, 0.025, 0.9, MAT.black, P.x + Math.cos(a) * 2.4, g + 15.6, P.z + Math.sin(a) * 2.4, null, 4);
    }
    const lantern = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.25, 1.9, 16), MAT.glass);
    lantern.position.set(P.x, g + 16.2, P.z);
    this.scene.add(lantern);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.4, 16), MAT.red);
    cap.position.set(P.x, g + 17.85, P.z);
    this.add(cap);
    this.box(1.1, 2, 0.2, MAT.woodDark, P.x - 0.3, g + 1.5, P.z + 2.45).rotation.y = -0.1;

    const beamMat = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform float opacity; varying vec2 vUv; void main(){ float a = pow(vUv.y, 4.0) * opacity; gl_FragColor = vec4(vec3(1.0, 0.95, 0.75) * a, a); }',
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const beamGeo = new THREE.ConeGeometry(5, 120, 24, 1, true);
    beamGeo.translate(0, -60, 0);
    beamGeo.rotateZ(Math.PI / 2);
    const beam = new THREE.Group();
    beam.position.set(P.x, g + 16.2, P.z);
    for (const s of [0, Math.PI]) {
      const m = new THREE.Mesh(beamGeo, beamMat);
      m.rotation.y = s;
      beam.add(m);
    }
    this.scene.add(beam);
    this.beam = beam;
    this.beamMat = beamMat;

    // Bench with a view.
    const B = this.L.bench;
    const bg = height(B.x, B.z);
    const bench = new THREE.Group();
    bench.position.set(B.x, bg, B.z);
    bench.rotation.y = -0.7;
    this.scene.add(bench);
    this.box(1.8, 0.07, 0.45, MAT.wood, 0, 0.48, 0, bench);
    this.box(1.8, 0.4, 0.06, MAT.wood, 0, 0.75, -0.22, bench);
    for (const sx of [-0.8, 0.8]) this.box(0.08, 0.48, 0.45, MAT.woodDark, sx, 0.24, 0, bench);
    this.colliders.push({ x: B.x, z: B.z, r: 0.7 });
  }

  buildYoga() {
    const Y = this.L.yoga;
    const g = height(Y.x, Y.z) + 0.35;
    this.cyl(5.6, 5.8, 1.2, MAT.deck, Y.x, g - 0.6, Y.z, null, 18);
    this.platforms.push({ x: Y.x, z: Y.z, r: 5.6, y: g });
    const mats = ['#7b2cbf', '#2a9d8f', '#e76f51', '#f4a261', '#219ebc'];
    mats.forEach((c, i) => {
      const a = (i / mats.length) * Math.PI * 1.4 - Math.PI * 0.2;
      const m = this.box(0.65, 0.02, 1.8, new THREE.MeshStandardMaterial({ color: c, roughness: 0.95 }), Y.x + Math.cos(a) * 2.6, g + 0.01, Y.z + Math.sin(a) * 2.6, null, -a + Math.PI / 2);
      m.castShadow = false;
    });
    // Gong
    const gx = Y.x + 4.6;
    const gz = Y.z;
    for (const s of [-0.7, 0.7]) this.cyl(0.05, 0.05, 2, MAT.woodDark, gx, g + 1, gz + s, null, 6);
    this.box(0.08, 0.08, 1.6, MAT.woodDark, gx, g + 2, gz);
    const gong = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.04, 24), new THREE.MeshStandardMaterial({ color: 0xc99a3b, metalness: 0.9, roughness: 0.3 }));
    gong.rotation.z = Math.PI / 2;
    gong.position.set(gx, g + 1.3, gz);
    this.add(gong);
    this.colliders.push({ x: gx, z: gz, r: 0.7 });
    this.gong = { x: gx, z: gz };
    this.torch(Y.x - 1, Y.z - 6.5, 2.2, false);
    this.torch(Y.x - 1, Y.z + 6.5, 2.2, false);
  }

  buildSigns() {
    const W = this.L.welcome;
    const g = height(W.x, W.z);
    for (const s of [-1.3, 1.3]) this.cyl(0.08, 0.09, 2.6, MAT.woodDark, W.x + s, g + 1.3, W.z, null, 6);
    const tex = T.textTexture(['Welcome to PALMERA CAY', { text: 'Pop. 7  ·  Wi-Fi: no  ·  Worries: also no', font: 'italic 46px Georgia, serif' }]);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(3, 0.8, 0.08), [MAT.woodDark, MAT.woodDark, MAT.woodDark, MAT.woodDark, new THREE.MeshStandardMaterial({ map: tex }), new THREE.MeshStandardMaterial({ map: tex })]);
    sign.position.set(W.x, g + 2.1, W.z);
    this.add(sign);
    this.colliders.push({ x: W.x, z: W.z, r: 1.5 });

    const D = this.L.dock;
    const cap = T.textTexture(['SNORKEL TOURS', { text: 'Capt. L. Bellamy · 40 yrs experience*', font: 'italic 44px Georgia, serif' }, { text: '*not consecutive', font: 'italic 34px Georgia, serif' }], { h: 320 });
    const s2 = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 0.06), [MAT.woodDark, MAT.woodDark, MAT.woodDark, MAT.woodDark, new THREE.MeshStandardMaterial({ map: cap }), new THREE.MeshStandardMaterial({ map: cap })]);
    s2.position.set(D.x - 1.9, 2.4, D.z0 + 6);
    s2.rotation.y = Math.PI / 2;
    this.add(s2);
    this.cyl(0.06, 0.06, 2.2, MAT.woodDark, D.x - 1.9, 1.2, D.z0 + 6, null, 6);
  }

  buildShells() {
    const r = rng(321);
    const geo = new THREE.ConeGeometry(0.07, 0.16, 7);
    geo.rotateZ(Math.PI / 2);
    const colors = ['#f7d6c4', '#f2e8cf', '#e8a598', '#ffd6a5', '#cdb4db'];
    const glintTex = (() => {
      const c = document.createElement('canvas');
      c.width = c.height = 64;
      const gx = c.getContext('2d');
      const grd = gx.createRadialGradient(32, 32, 0, 32, 32, 32);
      grd.addColorStop(0, 'rgba(255,255,255,1)');
      grd.addColorStop(0.2, 'rgba(255,255,240,0.6)');
      grd.addColorStop(1, 'rgba(255,255,255,0)');
      gx.fillStyle = grd;
      gx.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    let tries = 0;
    while (this.shells.length < 12 && tries++ < 500) {
      const a = (this.shells.length / 12) * Math.PI * 2 + (r() - 0.5) * 0.4;
      const s = findShore(0, 0, Math.cos(a), Math.sin(a));
      const back = 2 + r() * 4;
      const x = s.x - Math.cos(a) * back;
      const z = s.z - Math.sin(a) * back;
      const h = height(x, z);
      if (h < 0.15 || h > 2) continue;
      if (this.excluded(x, z)) continue;
      const conch = unitModel('lambis_shell', 0.2, 0);
      const m = conch ? new THREE.Mesh(conch.geometry, conch.material) : new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: colors[this.shells.length % 5], roughness: 0.4 }));
      m.position.set(x, h + (conch ? -0.01 : 0.04), z);
      m.rotation.y = r() * 6;
      m.castShadow = true;
      this.scene.add(m);
      const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: glintTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
      glint.scale.setScalar(0.5);
      glint.position.set(x, h + 0.2, z);
      this.scene.add(glint);
      this.shells.push({ x, z, mesh: m, glint, taken: false, ph: r() * 10 });
    }
  }

  // ---------------------------------------------------------------- queries
  inShade(x, z) {
    for (const s of this.shade) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return true;
    return false;
  }

  underRoof(x, z) {
    for (const s of this.roofs) if ((x - s.x) ** 2 + (z - s.z) ** 2 < s.r * s.r) return true;
    return false;
  }

  // Ground height under (x,z) for a body whose feet are currently at y.
  groundAt(x, z, y = Infinity) {
    let g = height(x, z);
    for (const p of this.platforms) {
      const inside = p.r !== undefined ? (x - p.x) ** 2 + (z - p.z) ** 2 < p.r * p.r : x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1;
      if (!inside) continue;
      const py = p.y0 !== undefined ? p.y0 + (p.y - p.y0) * THREE.MathUtils.clamp((z - p.z0) / (p.z1 - p.z0), 0, 1) : p.y;
      if (py > g && py <= y + 0.6) g = py;
    }
    return g;
  }

  platformNear(x, z, pad) {
    for (const p of this.platforms) {
      const inside = p.r !== undefined ? (x - p.x) ** 2 + (z - p.z) ** 2 < (p.r + pad) ** 2 : x > p.x0 - pad && x < p.x1 + pad && z > p.z0 - pad && z < p.z1 + pad;
      if (inside) return p;
    }
    return null;
  }

  collide(pos, radius, feetY) {
    for (const c of this.colliders) {
      if (c.y !== undefined && feetY > c.y) continue;
      if (c.yMin !== undefined && feetY < c.yMin) continue;
      if (c.r !== undefined) {
        const dx = pos.x - c.x;
        const dz = pos.z - c.z;
        const d2 = dx * dx + dz * dz;
        const rr = c.r + radius;
        if (d2 < rr * rr && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          pos.x = c.x + (dx / d) * rr;
          pos.z = c.z + (dz / d) * rr;
        }
      } else {
        const x0 = c.x0 - radius;
        const x1 = c.x1 + radius;
        const z0 = c.z0 - radius;
        const z1 = c.z1 + radius;
        if (pos.x > x0 && pos.x < x1 && pos.z > z0 && pos.z < z1) {
          const pen = [pos.x - x0, x1 - pos.x, pos.z - z0, z1 - pos.z];
          const m = Math.min(...pen);
          if (m === pen[0]) pos.x = x0;
          else if (m === pen[1]) pos.x = x1;
          else if (m === pen[2]) pos.z = z0;
          else pos.z = z1;
        }
      }
    }
  }

  update(t, dt, night, player) {
    for (const tr of this.torches) {
      const f = 0.8 + Math.sin(t * 13 + tr.ph) * 0.1 + Math.sin(t * 29 + tr.ph * 2) * 0.08;
      tr.flame.scale.set(1, f * (0.4 + night * 0.8), 1);
      tr.flame.material.opacity = 0.25 + night * 0.7;
      if (tr.light) tr.light.intensity = night * 14 * f;
    }
    this.bulbMat.emissiveIntensity = night * 2.5;
    MAT.glass.emissiveIntensity = night * 3;
    this.beamMat.uniforms.opacity.value = night * 0.35;
    this.beam.rotation.y = t * 0.6;
    if (this.boat) {
      this.boat.rotation.z = Math.sin(t * 0.9) * 0.03;
      this.boat.rotation.x = Math.sin(t * 0.7 + 1) * 0.02;
      this.boat.position.y = 0.35 + Math.sin(t * 1.1) * 0.08;
    }
    for (const s of this.shells) {
      if (s.taken) continue;
      const tw = Math.max(0, Math.sin(t * 2.2 + s.ph)) ** 8;
      s.glint.material.opacity = tw * (1 - night);
    }
    this.updateFish(t, player);
  }
}
