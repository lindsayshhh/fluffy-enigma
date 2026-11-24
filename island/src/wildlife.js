// Island wildlife. All models are Sketchfab CC BY 4.0 (see assets/CREDITS.md):
// fiddler crab (Bohdan Lvov), hermit crab and spotted eagle ray (kenchoo),
// loggerhead turtle (Ra_in_coat), seagulls (vicente betoret ferrero),
// monarch butterfly (LasquetiSpice), scarlet macaw (Mateus Schwaab).
//
// Each species has its own small behaviour, and the player gets a toast the
// first time they spot each one (tracked in the journal).
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { height, findShore } from './terrain.js';
import { waveHeight } from './water.js';

export const SPECIES = {
  fiddler: { label: 'fiddler crab', spot: "Spotted: a fiddler crab, waving one giant claw like it's hailing a cab." },
  hermit: { label: 'hermit crab', spot: 'Spotted: a hermit crab in a borrowed shell. Nice place. Bit roomy.' },
  turtle: { label: 'loggerhead turtle', spot: 'Spotted: a loggerhead turtle cruising the reef. It does not care about your deadlines.' },
  ray: { label: 'eagle ray', spot: 'Spotted: a spotted eagle ray, flying slowly underwater.' },
  gulls: { label: 'seagulls', spot: 'Spotted: seagulls riding the breeze. None of them are Kevin. Probably.' },
  butterfly: { label: 'monarch butterfly', spot: 'Spotted: a monarch butterfly, wildly overqualified for this flower.' },
  macaw: { label: 'scarlet macaw', spot: 'Spotted: a scarlet macaw, much louder than it has any right to be.' },
};

const rnd = (() => {
  let s = 1234567;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
})();

// Wrap a model so it is centred, `size` metres across (largest horizontal
// side), resting on y = 0 (or centred on it, for fliers and swimmers), and
// facing +z.
function normalise(model, { size, forward = 'z', base = true }) {
  model.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(model);
  const dim = box.getSize(new THREE.Vector3());
  const c = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(model);
  model.position.set(-c.x, base ? -box.min.y : -c.y, -c.z);
  const turn = new THREE.Group();
  turn.add(inner);
  turn.rotation.y = { z: 0, '-z': Math.PI, x: -Math.PI / 2, '-x': Math.PI / 2 }[forward];
  turn.scale.setScalar(size / Math.max(dim.x, dim.z));
  const outer = new THREE.Group();
  outer.add(turn);
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      o.frustumCulled = false;
      // Unlit materials would ignore the sun and the time of day.
      const lit = (m) => (m.isMeshBasicMaterial ? new THREE.MeshStandardMaterial({ map: m.map, side: m.side, alphaTest: m.alphaTest, roughness: 0.8 }) : m);
      o.material = Array.isArray(o.material) ? o.material.map(lit) : lit(o.material);
      for (const m of [].concat(o.material)) {
        if (m.roughness !== undefined && m.roughness < 0.35) m.roughness = 0.45; // converted spec-gloss materials come out mirror-shiny
        if (m.transparent && m.map) {
          m.transparent = false;
          m.alphaTest = 0.5;
        }
      }
    }
  });
  return outer;
}

class Creature {
  constructor(src, clips, opts, clipName) {
    const model = opts.clone === false ? src : cloneSkinned(src);
    this.obj = normalise(model, opts);
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const c of clips || []) this.actions[c.name] = this.mixer.clipAction(c);
    const first = clipName ? this.actions[clipName] : Object.values(this.actions)[0];
    if (first) {
      first.play();
      this.current = first;
    }
    this.mixer.update(rnd() * 5);
    this.speed = 1;
  }

  play(name, fade = 0.3) {
    const a = this.actions[name];
    if (!a || a === this.current) return;
    a.reset().fadeIn(fade).play();
    if (this.current) this.current.fadeOut(fade);
    this.current = a;
  }

  tick(dt) {
    this.mixer.update(dt * this.speed);
  }
}

// Sand just above the waterline at a given x on the south beaches.
function wetSand(x) {
  const s = findShore(x, 0, 0, 1);
  let z = s.z;
  for (let i = 0; i < 40 && height(x, z) < 0.08; i++) z -= 0.25;
  return { x, z };
}

export class Wildlife {
  constructor(scene, assets, world, L) {
    this.scene = scene;
    this.world = world;
    this.L = L;
    this.list = []; // { key, c: Creature, ... }
    const S = assets.scenes;
    const C = assets.clips;
    this.onSpot = null;
    this.spotted = {};

    // Fiddler crabs on the wet sand of the main beach.
    if (S.fiddler) {
      for (const x of [-68, -57, -44, -31, -12, 3, 16, 29, 62, 71]) {
        const p = wetSand(x + (rnd() - 0.5) * 4);
        const c = new Creature(S.fiddler, C.fiddler, { size: 0.2 });
        this.add({ key: 'fiddler', c, home: new THREE.Vector3(p.x, 0, p.z - rnd() * 1.4), heading: rnd() * 6.28, mode: 'dance', t: 0 });
      }
    }
    // Hermit crabs wandering the dry sand higher up.
    if (S.hermit) {
      for (const x of [-63, -38, -20, 8, 24, 55]) {
        const p = wetSand(x);
        const z = p.z - 5 - rnd() * 6;
        if (height(x, z) < 0.2 || height(x, z) > 3) continue;
        const c = new Creature(S.hermit, C.hermit, { size: 0.16 });
        this.add({ key: 'hermit', c, home: new THREE.Vector3(x, 0, z), target: null, heading: rnd() * 6.28, mode: 'idle', t: rnd() * 5 });
      }
    }
    // The reef turtle: the realistic model rides the existing patrol in props.js.
    if (S.turtle && world.turtle) {
      const c = new Creature(S.turtle, C.turtle, { size: 1.1, base: false, clone: false });
      for (const ch of world.turtle.children) ch.visible = false;
      world.turtle.add(c.obj);
      this.list.push({ key: 'turtle', c, get pos() { return world.turtle.position; }, fixed: true });
      c.speed = 0.7;
    }
    // Eagle rays gliding over the sandy shallows.
    if (S.ray) {
      for (const x of [-48, 8]) {
        let z = findShore(x, 0, 0, 1).z + 6;
        for (let i = 0; i < 60 && height(x, z) > -2.6; i++) z += 1;
        const c = new Creature(S.ray, C.ray, { size: 1.9, forward: 'x', base: false });
        c.speed = 0.55;
        this.add({ key: 'ray', c, centre: { x, z }, ph: rnd() * 6.28, heading: 0 });
      }
    }
    // A loose flock of gulls circling above the beach.
    if (S.gulls) {
      const c = new Creature(S.gulls, C.gulls, { size: 8, forward: '-z', base: false, clone: false });
      const s = findShore(-20, 0, 0, 1);
      this.add({ key: 'gulls', c, centre: { x: -20, z: s.z + 6 }, ph: 0, heading: 0, nextCry: 8 });
    }
    // Butterflies around flowering bushes.
    if (S.butterfly && world.bushSpots && world.bushSpots.length) {
      const spots = [...world.bushSpots].sort((a, b) => Math.hypot(a.x - L.bar.x, a.z - L.bar.z) - Math.hypot(b.x - L.bar.x, b.z - L.bar.z));
      const pick = [];
      for (const b of spots) {
        if (pick.every((p) => Math.hypot(p.x - b.x, p.z - b.z) > 14)) pick.push(b);
        if (pick.length >= 7) break;
      }
      for (const b of pick) {
        const c = new Creature(S.butterfly, C.butterfly, { size: 0.15, base: false });
        c.speed = 1.3;
        this.add({ key: 'butterfly', c, anchor: { x: b.x, y: b.y + 0.6, z: b.z }, ph: rnd() * 100, heading: 0, prev: new THREE.Vector3() });
      }
    }
    // Macaws hopping between palm crowns.
    if (S.macaw && world.palmCrowns && world.palmCrowns.length > 3) {
      const crowns = world.palmCrowns.filter((p) => Math.hypot(p.x - L.bar.x, p.z - L.bar.z) < 120);
      this.crowns = crowns.length > 3 ? crowns : world.palmCrowns;
      for (let i = 0; i < 2; i++) {
        const c = new Creature(S.macaw, C.macaw, { size: 0.95, base: false }, 'Armature|Iddle01');
        const perch = this.crowns[Math.floor(rnd() * this.crowns.length)];
        this.add({ key: 'macaw', c, mode: 'perch', perch, spot: this.perchSpot(perch), t: 4 + rnd() * 10, heading: rnd() * 6.28, from: null, to: null });
      }
    }
  }

  // Out on a frond, where you can see it, facing back toward the trunk.
  perchSpot(c) {
    const ang = rnd() * Math.PI * 2;
    return { x: c.x + Math.cos(ang) * 0.8, y: c.y + 0.95, z: c.z + Math.sin(ang) * 0.8, face: Math.atan2(-Math.cos(ang), -Math.sin(ang)) + (rnd() - 0.5) };
  }

  add(a) {
    this.list.push(a);
    if (!a.fixed) this.scene.add(a.c.obj);
    a.pos = a.pos || a.c.obj.position;
    if (a.home) a.c.obj.position.copy(a.home);
  }

  update(dt, t, { player, hour, rain, camera }) {
    const pp = player.pos;
    const day = hour > 6.3 && hour < 19.2;
    const fine = rain < 0.3;
    for (const a of this.list) {
      const o = a.c.obj;
      switch (a.key) {
        case 'fiddler':
          this.fiddler(a, dt, pp);
          break;
        case 'hermit':
          this.hermit(a, dt, pp);
          break;
        case 'ray':
          this.ray(a, dt, t, pp);
          break;
        case 'gulls':
          o.visible = day && fine;
          if (o.visible) this.gulls(a, dt, t, pp);
          break;
        case 'butterfly':
          o.visible = day && fine;
          if (o.visible) this.butterfly(a, dt, t);
          break;
        case 'macaw':
          o.visible = hour > 6 && hour < 19.5;
          if (o.visible) this.macaw(a, dt, t, pp, fine);
          break;
      }
      if (a.key === 'turtle' || o.visible) a.c.tick(dt);
    }
    this.checkSpotted(pp, camera, player);
  }

  // Dance on the wet sand; scuttle sideways away from people; sometimes
  // vanish into a burrow for a while.
  fiddler(a, dt, pp) {
    const o = a.c.obj;
    a.t -= dt;
    if (a.mode === 'burrow') {
      o.visible = false;
      if (a.t <= 0) {
        a.mode = 'dance';
        o.visible = true;
      }
      return;
    }
    o.visible = true;
    const dx = o.position.x - pp.x;
    const dz = o.position.z - pp.z;
    const d = Math.hypot(dx, dz);
    if (a.mode === 'dance' && d < 3.2) {
      a.mode = 'run';
      a.t = 0.9 + rnd() * 0.6;
      a.dir = Math.atan2(dx, dz);
      a.heading = a.dir + Math.PI / 2; // crabs run sideways
    }
    if (a.mode === 'run') {
      a.c.speed = 3;
      const nx = o.position.x + Math.sin(a.dir) * 2.4 * dt;
      const nz = o.position.z + Math.cos(a.dir) * 2.4 * dt;
      const h = height(nx, nz);
      if (h > -0.05 && h < 1.8) {
        o.position.x = nx;
        o.position.z = nz;
      } else a.dir += Math.PI / 2;
      if (a.t <= 0) {
        if (rnd() < 0.4) {
          a.mode = 'burrow';
          a.t = 8 + rnd() * 8;
        } else a.mode = 'dance';
      }
    } else a.c.speed = 1;
    o.position.y = Math.max(height(o.position.x, o.position.z), -0.02);
    o.rotation.y = a.heading;
  }

  // Potter about slowly; freeze and play shell when someone comes close.
  hermit(a, dt, pp) {
    const o = a.c.obj;
    a.t -= dt;
    const d = Math.hypot(o.position.x - pp.x, o.position.z - pp.z);
    if (d < 1.8) {
      a.mode = 'hide';
      a.t = 4 + rnd() * 3;
    }
    if (a.mode === 'hide') {
      a.c.speed = 0;
      if (a.t <= 0) a.mode = 'idle';
    } else if (a.mode === 'idle') {
      a.c.speed = 0;
      if (a.t <= 0) {
        const ang = rnd() * 6.28;
        const r = rnd() * 3;
        a.target = { x: a.home.x + Math.cos(ang) * r, z: a.home.z + Math.sin(ang) * r };
        a.mode = 'walk';
        a.t = 12;
      }
    } else {
      a.c.speed = 1;
      const tx = a.target.x - o.position.x;
      const tz = a.target.z - o.position.z;
      const dist = Math.hypot(tx, tz);
      const want = Math.atan2(tx, tz);
      let dh = want - a.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      a.heading += dh * Math.min(1, dt * 1.5);
      o.position.x += Math.sin(a.heading) * 0.13 * dt;
      o.position.z += Math.cos(a.heading) * 0.13 * dt;
      if (dist < 0.1 || a.t <= 0) {
        a.mode = 'idle';
        a.t = 3 + rnd() * 6;
      }
    }
    o.position.y = height(o.position.x, o.position.z);
    o.rotation.y = a.heading;
  }

  // Slow figure-eights over the sand, a little above the bottom.
  ray(a, dt, t, pp) {
    const o = a.c.obj;
    const near = Math.hypot(o.position.x - pp.x, o.position.z - pp.z) < 3.5;
    a.ph += dt * (near ? 0.22 : 0.08);
    const x = a.centre.x + Math.sin(a.ph) * 9;
    const z = a.centre.z + Math.sin(a.ph * 2) * 4;
    const nx = a.centre.x + Math.sin(a.ph + 0.01) * 9;
    const nz = a.centre.z + Math.sin((a.ph + 0.01) * 2) * 4;
    a.heading = Math.atan2(nx - x, nz - z);
    const ground = height(x, z);
    const surf = waveHeight(x, z, t);
    o.position.set(x, Math.min(surf - 0.6, ground + 0.7), z);
    o.rotation.set(0, a.heading, Math.sin(a.ph * 2) * -0.25, 'YXZ');
    a.c.speed = near ? 1.1 : 0.55;
  }

  // Wide lazy circles on the sea breeze, with the odd cry.
  gulls(a, dt, t, pp) {
    const o = a.c.obj;
    a.ph += dt * 0.07;
    const r = 34 + Math.sin(t * 0.05) * 6;
    const x = a.centre.x + Math.cos(a.ph) * r;
    const z = a.centre.z + Math.sin(a.ph) * r * 0.6;
    o.position.set(x, 24 + Math.sin(t * 0.21) * 3, z);
    a.heading = Math.atan2(-Math.sin(a.ph) * r, Math.cos(a.ph) * r * 0.6);
    o.rotation.set(0, a.heading, 0.25, 'YXZ');
    a.nextCry -= dt;
    if (a.nextCry <= 0) {
      a.nextCry = 18 + rnd() * 30;
      if (this.onCry && Math.hypot(x - pp.x, z - pp.z) < 60) this.onCry('gull');
    }
  }

  // Erratic, bobbing flight around a bush.
  butterfly(a, dt, t) {
    const o = a.c.obj;
    const p = a.ph + t;
    const A = a.anchor;
    const x = A.x + Math.sin(p * 0.37) * 1.6 + Math.sin(p * 1.3) * 0.4;
    const z = A.z + Math.cos(p * 0.29) * 1.6 + Math.cos(p * 1.7) * 0.4;
    const y = A.y + 0.5 + Math.sin(p * 0.8) * 0.5 + Math.abs(Math.sin(p * 4.1)) * 0.15;
    a.prev.copy(o.position);
    o.position.set(x, y, z);
    const vx = x - a.prev.x;
    const vz = z - a.prev.z;
    if (vx * vx + vz * vz > 1e-8) a.heading = Math.atan2(vx, vz);
    o.rotation.y = a.heading;
  }

  // Sit in a palm crown, then flap off to another one.
  macaw(a, dt, t, pp, fine) {
    const o = a.c.obj;
    a.t -= dt;
    if (a.mode === 'perch') {
      a.c.play('Armature|Iddle01');
      a.c.speed = 1;
      o.position.set(a.spot.x, a.spot.y, a.spot.z);
      o.rotation.set(0, a.spot.face, 0);
      const startled = Math.hypot(o.position.x - pp.x, o.position.z - pp.z) < 4;
      if ((a.t <= 0 && fine) || startled) {
        const options = this.crowns.filter((c) => {
          const d = Math.hypot(c.x - a.perch.x, c.z - a.perch.z);
          return d > 12 && d < 45;
        });
        const to = options.length ? options[Math.floor(rnd() * options.length)] : this.crowns[Math.floor(rnd() * this.crowns.length)];
        a.from = o.position.clone();
        a.spot = this.perchSpot(to);
        a.to = new THREE.Vector3(a.spot.x, a.spot.y, a.spot.z);
        a.dur = a.from.distanceTo(a.to) / 7;
        a.u = 0;
        a.mode = 'fly';
        a.perch = to;
        a.heading = Math.atan2(a.to.x - a.from.x, a.to.z - a.from.z);
        if (this.onCry && Math.hypot(o.position.x - pp.x, o.position.z - pp.z) < 35) this.onCry('macaw');
      }
    } else {
      a.c.play('Armature|Fly01', 0.15);
      a.c.speed = 1;
      a.u += dt / a.dur;
      const u = Math.min(1, a.u);
      o.position.lerpVectors(a.from, a.to, u);
      o.position.y += Math.sin(u * Math.PI) * Math.min(6, a.dur * 1.5);
      o.rotation.set(Math.cos(u * Math.PI) * -0.15, a.heading, 0, 'YXZ');
      if (u >= 1) {
        a.mode = 'perch';
        a.t = 10 + rnd() * 20;
      }
    }
  }

  // The first time each species is close enough and on screen, say so.
  checkSpotted(pp, camera, player) {
    if (!this.onSpot) return;
    const spotted = this.getSpotted ? this.getSpotted() : this.spotted;
    const fwd = camera.getWorldDirection(_f);
    for (const a of this.list) {
      if (spotted[a.key]) continue;
      const o = a.key === 'turtle' ? this.world.turtle : a.c.obj;
      if (!o.visible && a.key !== 'turtle') continue;
      const p = o.getWorldPosition(_p);
      const d = p.distanceTo(camera.position);
      const range = { fiddler: 7, hermit: 5, turtle: 12, ray: 11, gulls: 55, butterfly: 6, macaw: 30 }[a.key];
      if (d > range) continue;
      if (a.key === 'turtle' && !player.swimming && !player.kayak) continue;
      const dir = _d.subVectors(p, camera.position).normalize();
      if (dir.dot(fwd) < 0.75) continue;
      spotted[a.key] = true;
      this.onSpot(a.key);
    }
  }
}

const _f = new THREE.Vector3();
const _p = new THREE.Vector3();
const _d = new THREE.Vector3();
