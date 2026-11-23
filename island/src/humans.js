// Realistic characters from the Microsoft Rocketbox avatar library (MIT
// licence), driven by its motion-captured animations. A Human exposes the
// same interface as the procedural Person in people.js, so the game logic
// doesn't care which one it gets.
import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

const BASE = 'assets/people/';

// Which avatar plays whom, and how they move.
export const CASTING = {
  dez: { avatar: 'Male_Adult_12', sex: 'm', idle: 'm_idle' },
  brenda: { avatar: 'Female_Adult_01', sex: 'f', idle: 'f_nervous', walk: 'f_walkfast' },
  captain: { avatar: 'Male_Adult_14', sex: 'm', idle: 'm_look', hat: true },
  gary: { avatar: 'Male_Adult_08', sex: 'm', idle: 'm_breathe', laptop: true },
  marisol: { avatar: 'Female_Adult_03', sex: 'f', idle: 'f_calm' },
  pearl: { avatar: 'Female_Adult_14', sex: 'f', idle: 'f_stretch', scale: 0.95 },
};
export const EXTRAS = [
  { avatar: 'Sports_Female_01', sex: 'f', idle: 'f_idle' },
  { avatar: 'Sports_Male_01', sex: 'm', idle: 'm_stretch' },
  { avatar: 'Female_Party_01', sex: 'f', idle: 'f_calm', evening: 'f_dance' },
];

// Binary data ships as base64 inside JSON so any static host will serve it.
function decodeBase64(s) {
  const raw = atob(s);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out.buffer;
}

async function loadClips() {
  const packed = await fetch(BASE + 'animations.json').then((r) => r.json());
  const bin = decodeBase64(packed.base64);
  const clips = {};
  for (const c of packed.clips) {
    const tracks = c.tracks.map((t) => {
      const size = t.type === 'q' ? 4 : 3;
      const times = new Uint16Array(bin, t.offset, t.keys);
      const raw = new Int16Array(bin, t.offset + t.keys * 2, t.keys * size);
      const T = Float32Array.from(times, (v) => v / 1000);
      const V = Float32Array.from(raw, (v) => v / t.scale);
      return t.type === 'q' ? new THREE.QuaternionKeyframeTrack(t.name, T, V) : new THREE.VectorKeyframeTrack(t.name, T, V);
    });
    clips[c.name] = new THREE.AnimationClip(c.name, c.duration, tracks);
  }
  return clips;
}

async function loadAvatar(name, texLoader, fbxLoader) {
  const dir = `${BASE}${name}/`;
  const tex = (file, srgb) =>
    texLoader.loadAsync(dir + file).then(
      (t) => {
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.anisotropy = 4;
        return t;
      },
      () => null
    );
  const packed = await fetch(dir + 'model.json').then((r) => r.json());
  const model = fbxLoader.parse(decodeBase64(packed.base64), dir);
  let hasOpacity = false;
  model.traverse((o) => {
    if (o.isMesh) for (const m of [].concat(o.material)) if ((m.name || '').toLowerCase().includes('opacity')) hasOpacity = true;
  });
  const [bodyC, bodyN, headC, headN, opacity] = await Promise.all([
    tex('body_color.jpg', true),
    tex('body_normal.jpg'),
    tex('head_color.jpg', true),
    tex('head_normal.jpg'),
    hasOpacity ? tex('opacity.png', true) : null,
  ]);
  model.traverse((o) => {
    if (!o.isMesh) return;
    o.castShadow = true;
    o.receiveShadow = true;
    o.frustumCulled = false;
    const swap = (m) => {
      const n = (m.name || '').toLowerCase();
      if (n.includes('opacity')) {
        return new THREE.MeshStandardMaterial({ map: opacity, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 0.8 });
      }
      const head = n.includes('head');
      return new THREE.MeshStandardMaterial({
        map: head ? headC : bodyC,
        normalMap: head ? headN : bodyN,
        roughness: head ? 0.55 : 0.8,
        metalness: 0,
      });
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  return model;
}

export async function loadHumans(onProgress) {
  const manager = new THREE.LoadingManager();
  // The FBX files point at the original TGA textures; we supply our own.
  manager.addHandler(/\.(tga|png|jpg)$/i, { setPath() { return this; }, load: () => new THREE.Texture() });
  const fbxLoader = new FBXLoader(manager);
  const texLoader = new THREE.TextureLoader();
  const names = [...Object.values(CASTING), ...EXTRAS].map((c) => c.avatar);
  let done = 0;
  const clips = await loadClips();
  const models = {};
  await Promise.all(
    names.map((n) =>
      loadAvatar(n, texLoader, fbxLoader).then((m) => {
        models[n] = m;
        if (onProgress) onProgress(++done / names.length);
      })
    )
  );
  return { clips, models };
}

const _q = new THREE.Quaternion();
const _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

// Rotate a bone about the world up axis, on top of its animated pose.
function addWorldYaw(bone, angle) {
  if (!bone || !angle) return;
  bone.parent.getWorldQuaternion(_q);
  _q2.setFromAxisAngle(UP, angle);
  // local' = parent^-1 * yaw * parent * local
  bone.quaternion.premultiply(_q.clone().invert().multiply(_q2).multiply(_q));
}

function makeHat() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf6f6f2, roughness: 0.6 });
  const black = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.3 });
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.12, 0.085, 24), white);
  crown.scale.z = 1.12;
  crown.position.y = 0.04;
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.122, 0.122, 0.03, 24), black);
  band.scale.z = 1.12;
  band.position.y = 0.01;
  const brim = new THREE.Mesh(new THREE.BoxGeometry(0.19, 0.01, 0.09), black);
  brim.position.set(0, 0.0, 0.13);
  brim.rotation.x = 0.25;
  const badge = new THREE.Mesh(new THREE.SphereGeometry(0.018, 10, 8), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.9, roughness: 0.3 }));
  badge.position.set(0, 0.05, 0.145);
  g.add(crown, band, brim, badge);
  g.traverse((o) => (o.castShadow = true));
  return g;
}

function makeLaptop() {
  const laptop = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.7, roughness: 0.3 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.24), metal);
  const lid = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.24, 0.015), metal);
  lid.position.set(0, 0.12, -0.12);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ color: 0x9fd3ff }));
  screen.position.set(0, 0.12, -0.111);
  laptop.add(base, lid, screen);
  laptop.traverse((o) => (o.castShadow = true));
  laptop.userData.open = [lid, screen];
  return laptop;
}

export class Human {
  constructor(model, clips, role) {
    this.role = role;
    this.group = new THREE.Group();
    const s = 0.01 * (role.scale || 1); // centimetres -> metres
    model.scale.setScalar(s);
    this.group.add(model);
    this.model = model;
    this.mixer = new THREE.AnimationMixer(model);
    this.bones = {};
    model.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
    });
    const sx = role.sex;
    this.clipNames = {
      idle: role.idle,
      talk: `${sx}_talk`,
      walk: role.walk || `${sx}_walk`,
      photo: 'm_photo',
      calm: sx === 'f' ? 'f_calm' : 'm_breathe',
      dance: 'f_dance',
    };
    this.actions = {};
    for (const [k, n] of Object.entries(this.clipNames)) {
      if (clips[n]) this.actions[k] = this.mixer.clipAction(clips[n]);
    }
    this.current = null;
    this.play('idle', 0);
    this.mixer.update(Math.random() * 5);

    this.pose = null;
    this.headYaw = 0;
    this.phase = Math.random() * 10;

    // Face rig: animations don't touch these bones, so we drive them here,
    // relative to the rest pose.
    const face = ['Bip01_MJaw', 'Bip01_MUpperLip', 'Bip01_LMouthCorner', 'Bip01_RMouthCorner', 'Bip01_LEyeBlinkTop', 'Bip01_REyeBlinkTop', 'Bip01_LEyeBlinkBottom', 'Bip01_REyeBlinkBottom', 'Bip01_LInnerEyebrow', 'Bip01_RInnerEyebrow', 'Bip01_MMiddleEyebrow'];
    this.rest = {};
    for (const n of face) if (this.bones[n]) this.rest[n] = { p: this.bones[n].position.clone(), q: this.bones[n].quaternion.clone() };
    this.mouth = 0;
    this.blink = 0;
    this.nextBlink = 1 + Math.random() * 3;
    this.brow = 0;

    if (role.hat) {
      this.hat = makeHat();
      this.group.add(this.hat);
    }
    if (role.laptop) {
      this.laptop = makeLaptop();
      this.group.add(this.laptop);
    }
  }

  play(state, fade = 0.35) {
    const a = this.actions[state] || this.actions.idle;
    if (!a || this.current === a) return;
    a.reset().setEffectiveWeight(1).fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
    this.state = state;
  }

  // Lip movement from a syllable-like rhythm, plus natural blinking.
  updateFace(dt, t, speaking) {
    const B = this.bones;
    for (const [n, r] of Object.entries(this.rest)) {
      B[n].position.copy(r.p);
      B[n].quaternion.copy(r.q);
    }
    let target = 0;
    if (speaking) {
      const syl = Math.max(0, Math.sin(t * 13.0 + this.phase)) * (0.55 + 0.45 * Math.sin(t * 4.3 + this.phase * 2));
      const pause = Math.sin(t * 1.7 + this.phase) > -0.75 ? 1 : 0.15;
      target = syl * pause;
    }
    this.mouth = THREE.MathUtils.damp(this.mouth, target, 22, dt);
    if (B.Bip01_MJaw) B.Bip01_MJaw.rotateZ(this.mouth * 0.14);
    if (B.Bip01_MUpperLip) B.Bip01_MUpperLip.position.x += this.mouth * 0.12;
    for (const n of ['Bip01_LMouthCorner', 'Bip01_RMouthCorner']) if (B[n]) B[n].position.x += this.mouth * -0.1 + 0.06;

    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blinkT = 0;
      this.nextBlink = 2 + Math.random() * 4 + (Math.random() < 0.2 ? -1.8 : 0);
    }
    if (this.blinkT !== undefined) {
      this.blinkT += dt;
      this.blink = Math.max(0, 1 - Math.abs(this.blinkT - 0.07) / 0.07);
      if (this.blinkT > 0.16) this.blinkT = undefined;
    } else this.blink = 0;
    for (const side of ['L', 'R']) {
      const top = B[`Bip01_${side}EyeBlinkTop`];
      const bot = B[`Bip01_${side}EyeBlinkBottom`];
      if (top) top.position.x -= this.blink * 1.15;
      if (bot) bot.position.x += this.blink * 0.2;
    }
    // Eyebrows lift now and then while talking.
    this.brow = THREE.MathUtils.damp(this.brow, speaking && Math.sin(t * 0.9 + this.phase) > 0.6 ? 1 : 0, 6, dt);
    for (const n of ['Bip01_LInnerEyebrow', 'Bip01_RInnerEyebrow', 'Bip01_MMiddleEyebrow']) if (B[n]) B[n].position.x += this.brow * 0.25;
  }

  update(dt, t, { moving = false, speed = 1, talking = false, speaking = false, look = null } = {}) {
    let state = 'idle';
    if (moving) state = 'walk';
    else if (talking) state = 'talk';
    else if (this.pose === 'laptop') state = 'photo';
    else if (this.pose === 'meditate') state = 'calm';
    else if (this.pose === 'dance') state = 'dance';
    this.play(state);
    if (this.actions.walk) this.actions.walk.timeScale = moving ? Math.max(0.6, speed) : 1;
    this.mixer.update(dt);

    // Turn the head (and a little of the chest) toward whoever is nearby.
    let target = 0;
    if (look && !moving) {
      const lx = look.x - this.group.position.x;
      const lz = look.z - this.group.position.z;
      let rel = Math.atan2(lx, lz) - this.group.rotation.y;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      target = THREE.MathUtils.clamp(rel, -1.0, 1.0);
    }
    this.headYaw = THREE.MathUtils.damp(this.headYaw, target, 4, dt);
    addWorldYaw(this.bones.Bip01_Spine2, this.headYaw * 0.25);
    addWorldYaw(this.bones.Bip01_Neck, this.headYaw * 0.35);
    addWorldYaw(this.bones.Bip01_Head, this.headYaw * 0.4);
    this.updateFace(dt, t, speaking);
    this.model.updateMatrixWorld(true);

    const head = this.bones.Bip01_Head;
    if (this.hat && head) {
      head.getWorldPosition(_v);
      this.group.worldToLocal(_v);
      this.hat.position.copy(_v).add(new THREE.Vector3(0, 0.13, 0.0));
      this.hat.rotation.set(-0.08, this.headYaw * 0.9, 0);
    }
    if (this.laptop && this.laptop.visible) {
      const l = this.bones.Bip01_L_Hand;
      const r = this.bones.Bip01_R_Hand;
      if (l && r) {
        const a = this.group.worldToLocal(l.getWorldPosition(new THREE.Vector3()));
        const b = this.group.worldToLocal(r.getWorldPosition(new THREE.Vector3()));
        const raised = state === 'photo' && Math.min(a.y, b.y) > 1.15 && a.distanceTo(b) < 0.5;
        for (const part of this.laptop.userData.open) part.visible = raised;
        if (raised) {
          // Held up open with both hands, hunting for signal.
          this.laptop.position.addVectors(a, b).multiplyScalar(0.5).add(new THREE.Vector3(0, 0.0, 0.08));
          this.laptop.rotation.set(-0.2, Math.PI, 0);
        } else {
          // Closed, carried at his side like a very important folder.
          const side = b.clone().setY(0).normalize();
          this.laptop.position.copy(b).addScaledVector(side, 0.05).add(new THREE.Vector3(0, 0.12, 0));
          this.laptop.rotation.set(0, 0, Math.PI / 2);
        }
      }
    }
  }
}

export function makeHumanCast(data) {
  const cast = {};
  for (const [key, role] of Object.entries(CASTING)) {
    const m = data.models[role.avatar];
    if (m) cast[key] = new Human(m, data.clips, role);
  }
  const extras = EXTRAS.filter((r) => data.models[r.avatar]).map((r) => new Human(data.models[r.avatar], data.clips, r));
  return { cast, extras };
}
