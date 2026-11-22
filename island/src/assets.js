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

export const assets = { tex: {}, models: {} };

export async function loadAssets(renderer, onProgress) {
  const texLoader = new THREE.TextureLoader();
  const gltfLoader = new GLTFLoader();
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const total = TEXTURES.length * 3 + MODELS.length;
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
        tick();
        return null;
      });

  const texJobs = TEXTURES.map(async (name) => {
    const base = `assets/textures/${name}`;
    const [map, normal, arm] = await Promise.all([loadTex(`${base}_diff.jpg`, true), loadTex(`${base}_nor.jpg`), loadTex(`${base}_arm.jpg`)]);
    if (map) assets.tex[name] = { map, normal, arm };
  });

  const modelJobs = MODELS.map((name) =>
    gltfLoader
      .loadAsync(`assets/models/${name}/${name}.gltf`)
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
        tick();
      })
  );

  await Promise.all([...texJobs, ...modelJobs]);
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
