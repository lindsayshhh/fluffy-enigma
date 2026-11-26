// Reg, a bottlenose dolphin on sabbatical. Model and swim animation:
// "Game-Ready dolphin (Swimming)" by Allie2k on Sketchfab (CC BY 4.0).
//
// He circles the bay west of the dock, porpoising, and comes over when you're
// swimming, paddling or standing at the end of the dock. He can leap, spin,
// and tow you around the bay by his dorsal fin.
import * as THREE from 'three';
import { height } from './terrain.js';
import { waveHeight } from './water.js';

const LENGTH = 2.5; // metres, nose to tail
const _v = new THREE.Vector3();

export class Dolphin {
  constructor(scene, model, clips, L) {
    this.L = L;
    this.group = new THREE.Group(); // position and heading (yaw)
    this.pivot = new THREE.Group(); // pitch and roll for surfacing, leaps and nods
    this.group.add(this.pivot);
    scene.add(this.group);

    // Normalise the model: nose along +z, centred, LENGTH long.
    model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const centre = box.getCenter(new THREE.Vector3());
    let face = null;
    model.traverse((o) => {
      if (o.isBone && /face/i.test(o.name)) face = o;
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        o.frustumCulled = false;
        for (const m of [].concat(o.material)) m.roughness = Math.min(m.roughness ?? 0.5, 0.45); // wet skin
      }
    });
    const nose = face ? face.getWorldPosition(new THREE.Vector3()).sub(centre) : new THREE.Vector3(0, 0, 1);
    const alongX = size.x >= size.z;
    const k = LENGTH / Math.max(size.x, size.z);
    const holder = new THREE.Group();
    holder.add(model);
    model.position.sub(centre);
    // Turn the long axis onto +z with the nose forward.
    const yaw = alongX ? (nose.x > 0 ? Math.PI / 2 : -Math.PI / 2) : nose.z > 0 ? 0 : Math.PI;
    const turn = new THREE.Group();
    turn.rotation.y = -yaw + (alongX ? Math.PI : 0);
    turn.add(holder);
    turn.scale.setScalar(k);
    this.pivot.add(turn);
    // Sanity check the nose ended up at +z; flip if not.
    this.group.updateMatrixWorld(true);
    if (face && this.group.worldToLocal(face.getWorldPosition(new THREE.Vector3())).z < 0) turn.rotation.y += Math.PI;

    this.mixer = new THREE.AnimationMixer(model);
    const clip = clips && clips[0];
    this.swim = clip ? this.mixer.clipAction(clip) : null;
    if (this.swim) this.swim.play();

    // The patch of bay he patrols: deep water west of the dock end.
    this.home = this.findHome();
    this.angle = 0;
    this.radius = 13;
    this.state = 'patrol';
    this.heading = 0;
    this.speed = 3.2;
    this.pitch = 0;
    this.roll = 0;
    this.y = -0.6;
    this.trick = null;
    this.tow = null;
    this.engaged = false;
    this.nod = 0;
    this.lastSplash = 0;
    this.onSplash = null; // (big) => void, for sound
    const p = this.patrolPoint(0);
    this.group.position.set(p.x, -0.6, p.z);
  }

  get pos() {
    return this.group.position;
  }

  deep(x, z, min = 2.2) {
    return height(x, z) < -min;
  }

  findHome() {
    const D = this.L.dockEnd;
    // Try spots west of and beyond the dock end until a 13 m circle is all deep water.
    for (const [dx, dz] of [[-16, 6], [-18, 12], [-12, 16], [-22, 18], [0, 24], [-26, 26]]) {
      const c = { x: D.x + dx, z: D.z + dz };
      let ok = true;
      for (let i = 0; i < 16 && ok; i++) {
        const a = (i / 16) * Math.PI * 2;
        ok = this.deep(c.x + Math.cos(a) * 13, c.z + Math.sin(a) * 13);
      }
      if (ok) return c;
    }
    return { x: D.x - 10, z: D.z + 30 };
  }

  patrolPoint(a) {
    return { x: this.home.x + Math.cos(a) * this.radius, z: this.home.z + Math.sin(a) * this.radius };
  }

  // Where to wait near the player: 2.3 m away, in deep enough water, as close
  // to where he already is as possible.
  meetPoint(pp) {
    let best = null;
    let bestD = Infinity;
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const x = pp.x + Math.sin(a) * 2.3;
      const z = pp.z + Math.cos(a) * 2.3;
      if (!this.deep(x, z, 1.6)) continue;
      const d = Math.hypot(x - this.pos.x, z - this.pos.z);
      if (d < bestD) {
        bestD = d;
        best = { x, z };
      }
    }
    return best;
  }

  // Can he reach the player right now? (In the water, in a kayak, or at the dock end.)
  wantsToMeet(player, hour) {
    if (hour < 7 || hour > 20) return false;
    const pp = player.pos;
    const d = Math.hypot(pp.x - this.pos.x, pp.z - this.pos.z);
    if (d > 26) return false;
    const D = this.L.dockEnd;
    const atDockEnd = Math.hypot(pp.x - D.x, pp.z - D.z) < 7;
    return player.swimming || player.kayak || atDockEnd;
  }

  // The last night: perform in front of the bonfire (null to stop).
  setStage(spot) {
    if (!spot) {
      if (this.stage) {
        this.home = this.stage.home;
        this.radius = 13;
        this.stage = null;
      }
      return;
    }
    if (this.stage) return;
    let z = spot.z + 8;
    for (let i = 0; i < 80 && height(spot.x, z) > -2.8; i++) z += 1;
    this.stage = { home: this.home, next: 0 };
    this.home = { x: spot.x, z: z + 6 };
    this.radius = 6;
  }

  // ------------------------------------------------------------- tricks
  leap(kind = 'leap') {
    this.trick = { kind, t: 0, dur: kind === 'spin' ? 2.4 : 2.0, from: this.pos.clone(), dir: this.heading };
  }

  // Tow the player once round a loop out in the bay.
  startTow(player) {
    const p = this.pos;
    // Loop centre: further out to sea, where the whole loop is deep.
    let c = null;
    for (const out of [10, 14, 18, 24]) {
      const cand = { x: p.x, z: p.z + out };
      let ok = true;
      for (let i = 0; i < 12 && ok; i++) {
        const a = (i / 12) * Math.PI * 2;
        ok = this.deep(cand.x + Math.cos(a) * 9, cand.z + Math.sin(a) * 9, 1.8);
      }
      if (ok) {
        c = cand;
        break;
      }
    }
    if (!c) c = { x: this.home.x, z: this.home.z };
    const a0 = Math.atan2(p.z - c.z, p.x - c.x);
    this.tow = { t: 0, dur: 15, c, a0, r: 9, player };
    this.state = 'tow';
  }

  // ------------------------------------------------------------- update
  update(dt, t, { player, hour, talking, speaking }) {
    const pp = player.pos;
    this.mixer.update(dt * (this.state === 'wait' ? 0.45 : this.state === 'tow' ? 1.6 : 1));

    let target = null;
    let speed = 3.2;
    let surfaceY = -0.55;

    // Racing alongside the Captain's boat on the sunset cruise.
    if (this.escort && !this.trick && !this.tow) {
      const b = this.escort;
      const yaw = b.rotation.y;
      const side = 4.5 + Math.sin(t * 0.6) * 1.2;
      const x = b.position.x + Math.cos(yaw) * side + Math.sin(yaw) * 1.5;
      const z = b.position.z - Math.sin(yaw) * side + Math.cos(yaw) * 1.5;
      this.pos.x = THREE.MathUtils.damp(this.pos.x, x, 3, dt);
      this.pos.z = THREE.MathUtils.damp(this.pos.z, z, 3, dt);
      let dh = yaw - this.heading;
      dh = Math.atan2(Math.sin(dh), Math.cos(dh));
      this.heading += dh * Math.min(1, dt * 3);
      const ph = (t * 0.7) % 1;
      const breath = ph < 0.4 ? Math.sin((ph / 0.4) * Math.PI) : 0;
      this.y = THREE.MathUtils.damp(this.y, waveHeight(this.pos.x, this.pos.z, t) - 0.7 + 0.8 * breath, 5, dt);
      this.pitch = THREE.MathUtils.damp(this.pitch, ph < 0.4 ? -Math.cos((ph / 0.4) * Math.PI) * 0.4 : 0, 6, dt);
      this.escortNext = this.escortNext || t + 4;
      if (t > this.escortNext) {
        this.escortNext = t + 6 + Math.random() * 5;
        this.leap(Math.random() < 0.5 ? 'spin' : 'leap');
      }
      this.state = 'patrol';
      this.mixer.update(dt * 0.6);
      this.applyPose(dt, t, false);
      return;
    }

    if (this.tow) {
      // Round the loop, then let go.
      const T = this.tow;
      T.t += dt;
      const u = Math.min(1, T.t / T.dur);
      const ease = u < 0.1 ? u / 0.1 : u > 0.9 ? (1 - u) / 0.1 : 1;
      const a = T.a0 + u * Math.PI * 2 * 1.05;
      const x = T.c.x + Math.cos(a) * T.r;
      const z = T.c.z + Math.sin(a) * T.r;
      const tx = -Math.sin(a);
      const tz = Math.cos(a);
      this.heading = Math.atan2(tx, tz);
      this.pos.x = THREE.MathUtils.damp(this.pos.x, x, 6, dt);
      this.pos.z = THREE.MathUtils.damp(this.pos.z, z, 6, dt);
      surfaceY = -0.05;
      // The player hangs on beside the dorsal fin.
      const side = 0.75;
      const px = this.pos.x + Math.cos(this.heading) * side - Math.sin(this.heading) * 0.2;
      const pz = this.pos.z - Math.sin(this.heading) * side - Math.cos(this.heading) * 0.2;
      pp.x = THREE.MathUtils.damp(pp.x, px, 8 * ease + 2, dt);
      pp.z = THREE.MathUtils.damp(pp.z, pz, 8 * ease + 2, dt);
      player.vel.set(0, 0, 0);
      if (T.t > T.dur) {
        this.tow = null;
        this.state = 'wait';
        if (this.onTowDone) this.onTowDone();
      }
    } else if (this.trick) {
      // Out of the water in an arc along his heading.
      const T = this.trick;
      T.t += dt;
      const u = Math.min(1, T.t / T.dur);
      const dist = 7 * u;
      this.pos.x = T.from.x + Math.sin(T.dir) * dist;
      this.pos.z = T.from.z + Math.cos(T.dir) * dist;
      const h = T.kind === 'spin' ? 3.0 : 2.4;
      const arc = Math.sin(Math.PI * u);
      this.y = -0.6 + (h + 0.6) * arc;
      this.pitch = -Math.cos(Math.PI * u) * 0.95; // nose up, then down
      this.roll = T.kind === 'spin' ? u * Math.PI * 4 : 0;
      if (u > 0.04 && u < 0.1 && t - this.lastSplash > 1) {
        this.lastSplash = t;
        if (this.onSplash) this.onSplash(false);
      }
      if (u >= 1) {
        this.trick = null;
        this.roll = 0;
        this.lastSplash = t;
        if (this.onSplash) this.onSplash(true);
        // Turn round to come back.
        this.heading += Math.PI;
      }
      this.applyPose(dt, t, true);
      return;
    } else {
      this.engaged = talking || this.wantsToMeet(player, hour);
      const meet = this.engaged ? this.meetPoint(pp) : null;
      if (meet) {
        const d = Math.hypot(meet.x - this.pos.x, meet.z - this.pos.z);
        if (d > 0.6) {
          this.state = 'approach';
          target = meet;
          speed = Math.min(4.5, 1 + d * 0.6);
        } else this.state = 'wait';
      } else {
        this.state = 'patrol';
        this.angle += (3.2 / this.radius) * dt;
        target = this.patrolPoint(this.angle + 0.5);
        // Showtime at the bonfire: a leap every so often.
        if (this.stage && t > this.stage.next && Math.hypot(this.pos.x - this.home.x, this.pos.z - this.home.z) < this.radius + 3) {
          this.stage.next = t + 9 + Math.random() * 8;
          this.leap(Math.random() < 0.5 ? 'spin' : 'leap');
        }
      }

      if (target) {
        const want = Math.atan2(target.x - this.pos.x, target.z - this.pos.z);
        let dh = want - this.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.heading += dh * Math.min(1, dt * 2.2);
        this.speed = THREE.MathUtils.damp(this.speed, speed, 2, dt);
        const step = this.speed * dt * Math.max(0.2, Math.cos(dh));
        const nx = this.pos.x + Math.sin(this.heading) * step;
        const nz = this.pos.z + Math.cos(this.heading) * step;
        if (this.deep(nx, nz, 1.4)) {
          this.pos.x = nx;
          this.pos.z = nz;
        } else this.heading += dt * 1.5; // nosing into the shallows: turn away
      } else {
        // Waiting: face the player, head up out of the water.
        const want = Math.atan2(pp.x - this.pos.x, pp.z - this.pos.z);
        let dh = want - this.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        this.heading += dh * Math.min(1, dt * 3);
      }
    }

    // Height and attitude in the water.
    if (this.state === 'patrol') {
      // Porpoising: a breath at the surface every few seconds.
      const ph = (t * 0.55) % 1;
      const breath = ph < 0.35 ? Math.sin((ph / 0.35) * Math.PI) : 0;
      surfaceY = -0.9 + 0.75 * breath;
      this.pitch = THREE.MathUtils.damp(this.pitch, ph < 0.35 ? -Math.cos((ph / 0.35) * Math.PI) * 0.35 : 0, 6, dt);
    } else if (this.state === 'wait') {
      // Head and beak up out of the water, the way dolphins look at people.
      surfaceY = -0.05;
      this.nod = THREE.MathUtils.damp(this.nod, speaking ? 1 : 0, 8, dt);
      const talk = this.nod * Math.sin(t * 9) * 0.09;
      this.pitch = THREE.MathUtils.damp(this.pitch, -0.62 + talk + Math.sin(t * 1.3) * 0.04, 5, dt);
    } else if (this.state === 'approach') {
      surfaceY = -0.45;
      this.pitch = THREE.MathUtils.damp(this.pitch, -0.08, 4, dt);
    } else if (this.state === 'tow') {
      this.pitch = THREE.MathUtils.damp(this.pitch, -0.05 + Math.sin(t * 3) * 0.04, 4, dt);
    }
    const surface = waveHeight(this.pos.x, this.pos.z, t);
    this.y = THREE.MathUtils.damp(this.y, surface + surfaceY, 4, dt);
    this.applyPose(dt, t, false);
  }

  applyPose(dt, t, airborne) {
    this.group.position.y = this.y;
    this.group.rotation.y = this.heading;
    this.pivot.rotation.set(this.pitch, 0, this.roll + (airborne ? 0 : Math.sin(t * 0.8) * 0.05), 'YXZ');
  }

  // Head position, for depth of field and the look-at in conversation.
  head(out = _v) {
    return out.set(this.pos.x + Math.sin(this.heading) * 0.9, this.y + 0.6, this.pos.z + Math.cos(this.heading) * 0.9);
  }
}
