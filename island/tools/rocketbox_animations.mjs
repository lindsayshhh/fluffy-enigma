// Convert Microsoft Rocketbox animation FBX files into one compact JSON file
// of three.js AnimationClips.
// Usage: node tools/rocketbox_animations.mjs <path to Microsoft-Rocketbox checkout>
// (run from island/ with three resolvable, e.g. a node_modules/three copy of vendor/three.module.js)
import * as THREE from 'three';
import fs from 'node:fs';
import path from 'node:path';
import { FBXLoader } from '../vendor/addons/loaders/FBXLoader.js';

const ROOT = path.join(process.argv[2], 'Assets', 'Animations');
const CLIPS = {
  m_idle: 'static/m_idle_neutral_01',
  m_look: 'static/m_idle_look_around_01',
  m_breathe: 'static/m_idle_breathe_01',
  m_photo: 'static/m_take_picture',
  m_talk: 'static/m_gestic_talk_neutral_01',
  m_stretch: 'static/m_idle_stretch_arms_01',
  m_walk: 'xy/m_walk_neutral_01',
  f_nervous: 'static/f_idle_nervous_01',
  f_idle: 'static/f_idle_breathe_01',
  f_calm: 'static/f_idle_breathe_03',
  f_stretch: 'static/f_idle_stretch_arms_01',
  f_talk: 'static/f_gestic_talk_neutral_01',
  f_walk: 'xy/f_walk_neutral_01',
  f_walkfast: 'xy/f_walk_fast_01',
  f_dance: 'static/f_dancing_neutral',
};

const manager = new THREE.LoadingManager();
manager.addHandler(/.*/, { setPath() { return this; }, load: () => new THREE.Texture() });
const loader = new FBXLoader(manager);
const round = (arr) => Array.from(arr, (v) => Math.round(v * 1e3) / 1e3);
const FACE = /Jaw|Lip|Mouth|Tongue|Eye|Brow|Cheek|Lid|Nose|Ear/;
const MAX_SECONDS = 14;

const out = [];
for (const [name, rel] of Object.entries(CLIPS)) {
  const [folder, file] = rel.split('/');
  const buf = fs.readFileSync(path.join(ROOT, `all_animations_max_motextr_${folder}`, `${file}.max.fbx`));
  const obj = loader.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const src = obj.animations[0];
  const tracks = [];
  for (const t of src.tracks) {
    const [bone, prop] = t.name.split('.');
    if (!bone.startsWith('Bip01') || prop === 'scale' || bone.includes('Footsteps') || FACE.test(bone)) continue;
    if (prop === 'position' && bone !== 'Bip01' && bone !== 'Bip01_Pelvis') continue;
    // Idles at 15 fps (walks keep 30) and capped in length.
    const step = folder === 'xy' ? 1 : 2;
    const size = t.getValueSize();
    const keep = [];
    for (let i = 0; i < t.times.length; i += step) if (t.times[i] <= MAX_SECONDS) keep.push(i);
    const times = keep.map((i) => t.times[i]);
    const values = new Float32Array(keep.length * size);
    keep.forEach((i, k) => values.set(t.values.subarray(i * size, i * size + size), k * size));
    if (bone === 'Bip01' && prop === 'position' && folder === 'xy') {
      // Walk in place: the game moves the character, not the animation.
      for (let i = 0; i < values.length; i += 3) {
        values[i] = values[0];
        values[i + 2] = values[2];
      }
    }
    tracks.push(new t.constructor(t.name, round(times), round(values)));
  }
  const clip = new THREE.AnimationClip(name, Math.min(src.duration, MAX_SECONDS), tracks).optimize();
  out.push(clip);
  console.log(name, clip.duration.toFixed(2) + 's', clip.tracks.length, 'tracks');
}

// Binary pack: times as uint16 milliseconds, values as int16 with a per-track
// scale. Index in animations.json, data in animations.bin.
const chunks = [];
let offset = 0;
const index = out.map((clip) => ({
  name: clip.name,
  duration: clip.duration,
  tracks: clip.tracks.map((t) => {
    const isQuat = t.name.endsWith('.quaternion');
    const maxAbs = t.values.reduce((m, v) => Math.max(m, Math.abs(v)), 1e-6);
    const scale = isQuat ? 32767 : Math.floor(32767 / maxAbs);
    const times = Uint16Array.from(t.times, (v) => Math.round(v * 1000));
    const values = Int16Array.from(t.values, (v) => Math.round(v * scale));
    const entry = { name: t.name, type: isQuat ? 'q' : 'v', keys: times.length, offset, scale };
    for (const arr of [times, values]) {
      chunks.push(Buffer.from(arr.buffer));
      offset += arr.byteLength;
    }
    return entry;
  }),
}));
const dir = new URL('../assets/people/', import.meta.url);
// Shipped as base64 inside JSON so any static host will serve it.
fs.writeFileSync(new URL('animations.json', dir), JSON.stringify({ clips: index, base64: Buffer.concat(chunks).toString('base64') }));
console.log('wrote', (offset / 1024).toFixed(0), 'KB of animation data');
