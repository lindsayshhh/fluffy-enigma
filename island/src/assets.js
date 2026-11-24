// Photoscanned textures and models from Poly Haven (polyhaven.com, CC0).
// Everything here is optional: if a file fails to load the game falls back
// to its procedural look.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const TEXTURES = [
  'sand_01',
  'damp_beach_sand',
  'sparse_grass',
  'rock_ground',
  'seaside_rock',
  'palm_tree_bark',
  'thatch_roof_angled',
  'wooden_planks',
  'weathered_planks',
];
const MODELS = ['lambis_shell', 'bar_chair_round_01', 'rock_07', 'rock_09'];
// Whole scenes from Sketchfab (CC BY; see assets/CREDITS.md), kept intact so
// props.js can split them into individual trees and plants.
const SCENES = ['palms', 'coconut_palm', 'tropical_plants', 'lounger', 'dolphin'];

// `failed` lists anything that couldn't load, so the game can say so.
export const assets = { tex: {}, models: {}, scenes: {}, clips: {}, failed: [] };

// Load one of our glTF JSON files whose geometry is embedded as a base64
// data: URI. Strict hosts (claude.ai artifacts) block fetching data: URIs,
// which is what GLTFLoader would do, so decode the buffer here and hand the
// loader an in-memory GLB instead. Textures still load from their files.
async function loadEmbeddedGltf(loader, url) {
  const doc = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
    return r.json();
  });
  const base = url.slice(0, url.lastIndexOf('/') + 1);
  const buf = doc.buffers && doc.buffers[0];
  if (!buf || !buf.uri || !buf.uri.startsWith('data:')) return loader.parseAsync(JSON.stringify(doc), base);
  const raw = atob(buf.uri.slice(buf.uri.indexOf(',') + 1));
  const bin = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bin[i] = raw.charCodeAt(i);
  delete buf.uri;
  // GLB container: 12-byte header, JSON chunk, BIN chunk (each 4-byte aligned).
  let json = new TextEncoder().encode(JSON.stringify(doc));
  const jsonPad = (4 - (json.length % 4)) % 4;
  const binPad = (4 - (bin.length % 4)) % 4;
  const total = 12 + 8 + json.length + jsonPad + 8 + bin.length + binPad;
  const glb = new ArrayBuffer(total);
  const dv = new DataView(glb);
  const u8 = new Uint8Array(glb);
  dv.setUint32(0, 0x46546c67, true); // 'glTF'
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, json.length + jsonPad, true);
  dv.setUint32(16, 0x4e4f534a, true); // 'JSON'
  u8.set(json, 20);
  u8.fill(0x20, 20 + json.length, 20 + json.length + jsonPad);
  let off = 20 + json.length + jsonPad;
  dv.setUint32(off, bin.length + binPad, true);
  dv.setUint32(off + 4, 0x004e4942, true); // 'BIN\0'
  u8.set(bin, off + 8);
  return loader.parseAsync(glb, base);
}

export async function loadAssets(renderer, onProgress) {
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const total = TEXTURES.length * 3 + MODELS.length + SCENES.length;
  let done = 0;
  const tick = () => onProgress && onProgress(++done / total);

  const loadTex = (url, srgb) =>
    texLoader
      .loadAsync(url)
      .then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = aniso;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        tick();
        return t;
      })
      .catch((e) => {
        console.warn('Texture failed, using procedural fallback:', url, e);
        assets.failed.push(url.split('/').pop());
        tick();
        return null;
      });

  const texJobs = TEXTURES.map(async (name) => {
    const base = `assets/textures/${name}`;
    const [map, normal, arm] = await Promise.all([loadTex(`${base}_diff.jpg`, true), loadTex(`${base}_nor.jpg`), loadTex(`${base}_arm.jpg`)]);
    if (map) assets.tex[name] = { map, normal, arm };
  });

  const modelJobs = MODELS.map((name) =>
    loadEmbeddedGltf(gltfLoader, `assets/models/${name}/${name}.json`)
      .then((g) => {
        let mesh = null;
        g.scene.traverse((o) => {
          if (o.isMesh && !mesh) mesh = o;
        });
        if (mesh) {
          mesh.updateWorldMatrix(true, false);
          const geometry = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
          assets.models[name] = { geometry, material: mesh.material };
        }
        tick();
      })
      .catch((e) => {
        console.warn('Model failed, using procedural fallback:', name, e);
        assets.failed.push(name);
        tick();
      })
  );

  const sceneJobs = SCENES.map((name) =>
    loadEmbeddedGltf(gltfLoader, `assets/sketchfab/${name}/${name}.json`)
      .then((g) => {
        g.scene.updateMatrixWorld(true);
        assets.scenes[name] = g.scene;
        assets.clips[name] = g.animations;
        tick();
      })
      .catch((e) => {
        console.warn('Scene failed, using procedural fallback:', name, e);
        assets.failed.push(name);
        tick();
      })
  );

  await Promise.all([...texJobs, ...modelJobs, ...sceneJobs]);
  return assets;
}

// A material built from one of the textures, tiled every `tile` metres
// (when the geometry's UVs are in metres) or `repeat` times.
export function texMaterial(name, { repeat = [1, 1], color = 0xffffff, roughness = 1, normalScale = 1, side, fallback } = {}) {
  const t = assets.tex[name];
  if (!t) return fallback;
  const clone = (tex) => {
    if (!tex) return null;
    const c = tex.clone();
    c.repeat.set(repeat[0], repeat[1]);
    c.needsUpdate = true;
    return c;
  };
  const m = new THREE.MeshStandardMaterial({
    map: clone(t.map),
    normalMap: clone(t.normal),
    roughnessMap: clone(t.arm),
    aoMap: clone(t.arm),
    color,
    roughness,
    metalness: 0,
  });
  m.normalScale.set(normalScale, normalScale);
  if (side !== undefined) m.side = side;
  return m;
}
