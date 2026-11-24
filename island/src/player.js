import * as THREE from 'three';
import { waveHeight } from './water.js';
import { height } from './terrain.js';

export const EYE = 1.65;
const RADIUS = 0.32;
const BOUNDS = 300;

export class Player {
  constructor(camera, world, dom) {
    this.camera = camera;
    this.world = world;
    this.dom = dom;
    this.pos = new THREE.Vector3();
    this.vel = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.keys = new Set();
    this.onGround = true;
    this.swimming = false;
    this.underwater = false;
    this.running = false;
    this.bob = 0;
    this.dive = 0;
    this.enabled = false;
    this.wantLock = false;
    this.locked = false;
    this.lookTouch = null;
    this.onBounds = null;

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.keys.add(e.code);
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    document.addEventListener('mousemove', (e) => {
      // Without pointer lock (some browsers, embedded views) drag to look.
      if (!this.locked && !(this.enabled && e.buttons === 1 && e.target === this.dom)) return;
      this.yaw -= e.movementX * 0.0022;
      this.pitch = THREE.MathUtils.clamp(this.pitch - e.movementY * 0.0022, -1.45, 1.45);
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      if (!this.locked && this.wantLock && this.onUnlock) this.onUnlock();
    });
  }

  lock() {
    this.wantLock = true;
    this.enabled = true;
    if (this.touchMode) return; // touch screens look by dragging instead
    if (!this.locked && this.dom.requestPointerLock) {
      try {
        const r = this.dom.requestPointerLock();
        if (r && r.catch) r.catch(() => {});
      } catch {
        /* needs a user gesture; the click-to-resume prompt handles it */
      }
    }
  }

  unlock() {
    this.wantLock = false;
    this.enabled = false;
    this.keys.clear();
    if (document.pointerLockElement) document.exitPointerLock();
  }

  // Water level here: the pool's if we're in it, otherwise the sea's.
  surfaceAt(x, z, t) {
    const pool = this.world.poolSurface && this.world.poolSurface(x, z);
    return pool ?? waveHeight(x, z, t);
  }

  teleport(x, z, y, yaw = 0) {
    this.pos.set(x, y ?? this.world.groundAt(x, z), z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = 0;
  }

  // ------------------------------------------------------------ kayaking
  // Launch from a beach spot: find open water heading out to sea.
  startKayak(mesh, from) {
    let x = from.x;
    let z = from.z;
    const len = Math.hypot(x, z) || 1;
    for (let i = 0; i < 200 && height(x, z) > -0.45; i++) {
      x += (x / len) * 0.25;
      z += (z / len) * 0.25;
    }
    this.kayak = mesh;
    this.boatYaw = Math.atan2(-x / len, -z / len);
    this.boatSpeed = 0;
    this.yaw = this.boatYaw;
    this.pitch = -0.05;
    this.pos.set(x, 0, z);
    this.vel.set(0, 0, 0);
    this.swimming = false;
  }

  // Step out onto the nearest dry sand. Returns false if there's none close.
  stopKayak() {
    for (let r = 0.5; r <= 7; r += 0.25) {
      for (let a = 0; a < Math.PI * 2; a += Math.PI / 16) {
        const x = this.pos.x + Math.cos(a) * r;
        const z = this.pos.z + Math.sin(a) * r;
        if (height(x, z) > 0.12) {
          const mesh = this.kayak;
          this.kayak = null;
          this.teleport(x, z, undefined, this.yaw);
          return mesh;
        }
      }
    }
    return false;
  }

  nearShore() {
    for (let r = 0.5; r <= 7; r += 0.5) for (let a = 0; a < 6.28; a += 0.4) if (height(this.pos.x + Math.cos(a) * r, this.pos.z + Math.sin(a) * r) > 0.12) return true;
    return false;
  }

  updateKayak(dt, t) {
    const k = this.keys;
    const active = this.enabled;
    const tm = active && this.touchMove ? this.touchMove : { x: 0, y: 0 };
    const f = active ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) || Math.round(-tm.y * 10) / 10 : 0;
    const turn = active ? (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) - (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) || -tm.x : 0;
    this.boatSpeed = THREE.MathUtils.damp(this.boatSpeed, f > 0 ? 4.2 : f < 0 ? -1.6 : 0, f ? 1.4 : 0.6, dt);
    const dYaw = turn * dt * (0.5 + Math.min(1, Math.abs(this.boatSpeed) / 3) * 0.8);
    this.boatYaw += dYaw;
    this.yaw += dYaw; // the view turns with the boat
    const nx = this.pos.x - Math.sin(this.boatYaw) * this.boatSpeed * dt;
    const nz = this.pos.z - Math.cos(this.boatYaw) * this.boatSpeed * dt;
    // Run aground in the shallows rather than driving up the beach.
    if (height(nx, nz) < waveHeight(nx, nz, t) - 0.12 && Math.hypot(nx, nz) < BOUNDS) {
      this.pos.x = nx;
      this.pos.z = nz;
    } else {
      this.boatSpeed *= 0.2;
      if (Math.hypot(nx, nz) >= BOUNDS && this.onBounds) this.onBounds();
    }
    this.world.collide(this.pos, 0.5, -1);
    const surface = this.surfaceAt(this.pos.x, this.pos.z, t);
    this.pos.y = surface;
    const m = this.kayak;
    m.position.set(this.pos.x, surface + 0.02, this.pos.z);
    m.rotation.set(Math.sin(t * 1.1) * 0.03, this.boatYaw, Math.sin(t * 0.9 + 1) * 0.05);
    this.running = false;
    this.swimming = false;
    this.onGround = false;
    this.bob += dt * Math.abs(this.boatSpeed);
    this.camera.position.set(this.pos.x, surface + 0.85 + Math.sin(t * 1.1) * 0.03, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, Math.sin(t * 0.9 + 1) * 0.03, 'YXZ');
    this.underwater = false;
    this.groundHeight = height(this.pos.x, this.pos.z);
  }

  update(dt, t) {
    if (this.kayak) return this.updateKayak(dt, t);
    const k = this.keys;
    const active = this.enabled;
    if (active) {
      if (k.has('ArrowLeft')) this.yaw += dt * 1.8;
      if (k.has('ArrowRight')) this.yaw -= dt * 1.8;
    }
    let f = active ? (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) : 0;
    let s = active ? (k.has('KeyD') ? 1 : 0) - (k.has('KeyA') ? 1 : 0) : 0;
    // Touch joystick: pushing it all the way runs.
    const tm = this.touchMove;
    const touchRun = active && tm && Math.hypot(tm.x, tm.y) > 0.93;
    if (active && tm && !f && !s && Math.hypot(tm.x, tm.y) > 0.08) {
      f = -tm.y;
      s = tm.x;
    }
    const move = new THREE.Vector3(Math.sin(this.yaw) * -f + Math.cos(this.yaw) * s, 0, Math.cos(this.yaw) * -f - Math.sin(this.yaw) * s);
    if (move.lengthSq() > 1) move.normalize();

    const ground = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    const surface = this.surfaceAt(this.pos.x, this.pos.z, t);
    const depth = surface - ground;
    this.swimming = depth > 1.35;
    const wading = !this.swimming && ground < surface - 0.25;

    this.running = active && (k.has('ShiftLeft') || k.has('ShiftRight') || touchRun) && !this.swimming && move.lengthSq() > 0 && this.tired !== true;
    let speed = this.swimming ? 1.7 : wading ? 2.1 : this.running ? 6.2 : 3.3;
    if (this.tired) speed *= 0.7;

    this.vel.x = THREE.MathUtils.damp(this.vel.x, move.x * speed, this.swimming ? 2.5 : 10, dt);
    this.vel.z = THREE.MathUtils.damp(this.vel.z, move.z * speed, this.swimming ? 2.5 : 10, dt);

    if (this.swimming) {
      const wantDive = active && (k.has('KeyC') || k.has('ControlLeft') || this.touchDive);
      const maxDive = Math.max(0, surface - ground - 1.9);
      this.dive = THREE.MathUtils.damp(this.dive, wantDive ? Math.min(maxDive, 3.5) : 0, 2.2, dt);
      const targetY = surface - EYE + 0.18 - this.dive;
      this.pos.y = THREE.MathUtils.damp(this.pos.y, targetY, 6, dt);
      this.vel.y = 0;
      this.onGround = false;
      // Climb out onto a dock or deck.
      if (active && (k.has('Space') || this.touchJump)) {
        const p = this.world.platformNear(this.pos.x, this.pos.z, 0.9);
        // Low docks from the sea, or any deck just above the water (the pool).
        if (p && (p.y < 2.3 || Math.abs(p.y - surface) < 0.6)) {
          const cx = p.r !== undefined ? p.x : THREE.MathUtils.clamp(this.pos.x, p.x0 + 0.5, p.x1 - 0.5);
          const cz = p.r !== undefined ? p.z : THREE.MathUtils.clamp(this.pos.z, p.z0 + 0.5, p.z1 - 0.5);
          const dir = new THREE.Vector2(cx - this.pos.x, cz - this.pos.z);
          if (dir.length() > 0.01) dir.normalize();
          this.pos.x += dir.x * 1.0;
          this.pos.z += dir.y * 1.0;
          this.pos.y = this.world.groundAt(this.pos.x, this.pos.z, p.y + 0.1);
          this.dive = 0;
        }
      }
    } else {
      this.dive = 0;
      if (this.onGround && active && (k.has('Space') || this.touchJump)) {
        this.vel.y = 5.2;
        this.onGround = false;
      }
      this.vel.y -= 18 * dt;
      this.pos.y += this.vel.y * dt;
      if (this.pos.y <= ground) {
        // Step up small ledges, land on everything else.
        this.pos.y = ground;
        this.vel.y = 0;
        this.onGround = true;
      } else if (this.onGround && this.pos.y - ground < 0.35 && this.vel.y <= 0) {
        this.pos.y = ground;
        this.vel.y = 0;
      } else {
        this.onGround = false;
      }
    }

    const prev = this.pos.clone();
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.z * dt;
    // Don't walk up walls: a step higher than 0.6 m is a wall.
    const ng = this.world.groundAt(this.pos.x, this.pos.z, this.pos.y);
    if (!this.swimming && ng - this.pos.y > 0.6) {
      this.pos.x = prev.x;
      this.pos.z = prev.z;
    }
    this.world.collide(this.pos, RADIUS, this.pos.y);

    const r = Math.hypot(this.pos.x, this.pos.z);
    if (r > BOUNDS) {
      this.pos.x *= BOUNDS / r;
      this.pos.z *= BOUNDS / r;
      if (this.onBounds) this.onBounds();
    }

    this.bob += dt * Math.hypot(this.vel.x, this.vel.z) * (this.swimming ? 1.2 : 2.3);
    this.syncCamera(t);
    this.groundHeight = height(this.pos.x, this.pos.z);
  }

  // Place the camera at the player's eyes (called again after anything
  // nudges the player, so the view never lags a frame behind).
  syncCamera(t) {
    if (this.kayak) return;
    const moving = Math.hypot(this.vel.x, this.vel.z);
    const bobY = this.swimming ? Math.sin(t * 1.3) * 0.03 : Math.sin(this.bob * 2) * 0.035 * Math.min(1, moving / 3);
    this.camera.position.set(this.pos.x, this.pos.y + EYE + bobY, this.pos.z);
    const roll = this.swimming ? Math.sin(t * 0.9) * 0.02 : 0;
    this.camera.rotation.set(this.pitch, this.yaw, roll, 'YXZ');

    this.underwater = this.camera.position.y < this.surfaceAt(this.camera.position.x, this.camera.position.z, t) - 0.05;
  }
}
