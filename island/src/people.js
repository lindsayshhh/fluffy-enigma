import * as THREE from 'three';
import { floralTexture } from './textures.js';

const std = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.75, ...extra });

function capsule(r, len, mat) {
  const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 6, 12), mat);
  m.castShadow = true;
  return m;
}
function sphere(r, mat, ws = 16, hs = 12) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, ws, hs), mat);
  m.castShadow = true;
  return m;
}
function cyl(rt, rb, h, mat, seg = 12) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.castShadow = true;
  return m;
}
function box(w, h, d, mat) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.castShadow = true;
  return m;
}

export class Person {
  constructor(spec) {
    this.spec = spec;
    const s = spec.scale || 1;
    const build = spec.build || 1;
    const skin = std(spec.skin, { roughness: 0.6 });
    const shirt = spec.shirtMat || std(spec.shirt);
    const bottoms = std(spec.shorts);
    this.skinMat = skin;

    const g = new THREE.Group();
    const body = new THREE.Group();
    body.scale.setScalar(s);
    g.add(body);
    this.group = g;
    this.body = body;

    // Legs
    this.legs = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.1 * build, 0.93, 0);
      const longPants = spec.longPants;
      const thigh = capsule(0.075, 0.34, longPants ? bottoms : skin);
      thigh.position.y = -0.22;
      const shin = capsule(0.062, 0.36, longPants ? bottoms : skin);
      shin.position.y = -0.62;
      const shoe = box(0.11, 0.07, 0.25, std(spec.shoes || '#3b2a1f'));
      shoe.position.set(0, -0.88, 0.05);
      pivot.add(thigh, shin, shoe);
      if (spec.socks) {
        const sock = cyl(0.066, 0.066, 0.14, std('#ffffff'));
        sock.position.y = -0.79;
        pivot.add(sock);
      }
      if (!longPants) {
        const leg = cyl(0.095, 0.09, spec.shortsLen || 0.26, bottoms);
        leg.position.y = -0.1 - (spec.shortsLen || 0.26) / 2 + 0.1;
        pivot.add(leg);
      }
      body.add(pivot);
      this.legs.push(pivot);
    }
    const hips = cyl(0.17 * build, 0.19 * build, 0.24, bottoms, 16);
    hips.scale.z = 0.8;
    hips.position.y = 0.96;
    body.add(hips);

    // Torso
    this.torso = new THREE.Group();
    this.torso.position.y = 1.05;
    body.add(this.torso);
    const chest = capsule(0.16, 0.3, shirt);
    chest.scale.set(1.15 * build, 1, 0.72 * (spec.belly || 1));
    chest.position.y = 0.22;
    this.torso.add(chest);
    if (spec.belly) {
      const belly = sphere(0.19, shirt);
      belly.scale.set(1.05 * build, 0.95, 0.9);
      belly.position.set(0, 0.1, 0.06);
      this.torso.add(belly);
    }
    const neck = cyl(0.05, 0.055, 0.1, skin);
    neck.position.y = 0.48;
    this.torso.add(neck);

    // Head
    this.head = new THREE.Group();
    this.head.position.y = 0.52;
    this.torso.add(this.head);
    const skull = sphere(0.115, skin, 20, 16);
    skull.scale.set(0.9, 1.06, 0.97);
    skull.position.y = 0.11;
    this.head.add(skull);
    const eyeMat = std('#151515', { roughness: 0.2 });
    const whiteMat = std('#f5f5f0', { roughness: 0.3 });
    for (const sx of [-1, 1]) {
      const white = sphere(0.019, whiteMat, 8, 6);
      white.position.set(sx * 0.038, 0.13, 0.095);
      const eye = sphere(0.011, eyeMat, 8, 6);
      eye.position.set(sx * 0.038, 0.13, 0.11);
      const ear = sphere(0.025, skin, 8, 6);
      ear.scale.set(0.5, 1, 0.8);
      ear.position.set(sx * 0.103, 0.11, 0);
      const brow = box(0.035, 0.008, 0.01, std(spec.hairColor || '#2b1d14'));
      brow.position.set(sx * 0.038, 0.16, 0.105);
      this.head.add(white, eye, ear, brow);
    }
    const nose = sphere(0.018, spec.noseMat || skin, 8, 6);
    nose.scale.set(0.9, 1, 1.2);
    nose.position.set(0, 0.1, 0.115);
    this.head.add(nose);
    this.mouth = box(0.045, 0.01, 0.01, std('#6b2b2b'));
    this.mouth.position.set(0, 0.063, 0.103);
    this.head.add(this.mouth);

    // Arms
    this.arms = [];
    for (const sx of [-1, 1]) {
      const pivot = new THREE.Group();
      pivot.position.set(sx * 0.215 * build, 0.42, 0);
      const upper = capsule(0.05, 0.26, skin);
      upper.position.y = -0.17;
      const fore = capsule(0.043, 0.24, skin);
      fore.position.y = -0.45;
      const hand = sphere(0.045, skin, 8, 6);
      hand.position.y = -0.62;
      const sleeve = cyl(0.07, 0.065, spec.longSleeves ? 0.55 : 0.16, shirt);
      sleeve.position.y = spec.longSleeves ? -0.28 : -0.06;
      pivot.add(upper, fore, hand, sleeve);
      pivot.rotation.z = sx * 0.08;
      this.torso.add(pivot);
      this.arms.push(pivot);
      pivot.userData.hand = hand;
    }

    if (spec.decorate) spec.decorate(this, { std, sphere, cyl, box, capsule });

    this.phase = Math.random() * 10;
    this.walk = 0;
    this.talk = 0;
    this.pose = spec.pose || null;
    this.yaw = 0;
    this.headYaw = 0;
  }

  addHair(color, style) {
    const m = std(color, { roughness: 0.9 });
    const top = sphere(0.124, m, 18, 12);
    top.scale.set(0.95, 0.9, 1);
    top.position.set(0, 0.15, -0.012);
    // Keep the face clear: only the top/back half of the sphere.
    top.geometry = new THREE.SphereGeometry(0.124, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.55);
    top.rotation.x = -0.35;
    this.head.add(top);
    if (style === 'long') {
      const back = capsule(0.1, 0.28, m);
      back.scale.z = 0.5;
      back.position.set(0, -0.06, -0.08);
      this.head.add(back);
    } else if (style === 'bob') {
      const bob = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.14, 18, 1, true, Math.PI * 0.75, Math.PI * 1.5), m);
      bob.position.set(0, 0.07, -0.01);
      this.head.add(bob);
    } else if (style === 'bun') {
      const bun = sphere(0.06, m);
      bun.position.set(0, 0.21, -0.08);
      this.head.add(bun);
    } else if (style === 'twists') {
      for (let i = 0; i < 26; i++) {
        const a = (i / 26) * Math.PI * 2;
        const ring = i % 2;
        const t = sphere(0.032, m, 6, 5);
        t.position.set(Math.cos(a) * (0.1 - ring * 0.03), 0.18 + ring * 0.04, Math.sin(a) * (0.1 - ring * 0.03) - 0.01);
        if (t.position.z > 0.06 && t.position.y < 0.2) continue;
        this.head.add(t);
      }
    }
    return m;
  }

  update(dt, t, { moving = false, speed = 1, talking = false, look = null } = {}) {
    this.walk = THREE.MathUtils.damp(this.walk, moving ? 1 : 0, 6, dt);
    this.talk = THREE.MathUtils.damp(this.talk, talking ? 1 : 0, 5, dt);
    this.phase += dt * (moving ? 6.5 * speed : 1);
    const w = this.walk;
    const sw = Math.sin(this.phase);
    this.legs[0].rotation.x = sw * 0.55 * w;
    this.legs[1].rotation.x = -sw * 0.55 * w;
    this.body.position.y = Math.abs(Math.cos(this.phase)) * 0.035 * w;
    const breathe = Math.sin(t * 1.6 + this.phase * 0.1) * 0.012;
    this.torso.scale.set(1 + breathe, 1 + breathe * 0.5, 1 + breathe);
    this.torso.rotation.z = Math.sin(t * 0.7 + this.phase) * 0.02 * (1 - w);

    if (this.pose === 'laptop') {
      for (const [i, a] of this.arms.entries()) {
        a.rotation.x = -2.9 + Math.sin(t * 2 + i) * 0.08;
        a.rotation.z = (i ? 1 : -1) * -0.25;
      }
    } else if (this.pose === 'meditate') {
      for (const [i, a] of this.arms.entries()) {
        a.rotation.x = -0.25;
        a.rotation.z = (i ? 1 : -1) * (0.55 + Math.sin(t) * 0.02);
      }
    } else {
      const gest = this.talk * (Math.sin(t * 3.1 + this.phase) * 0.35 + 0.25);
      this.arms[0].rotation.x = -sw * 0.45 * w - gest * 0.6;
      this.arms[1].rotation.x = sw * 0.45 * w - this.talk * Math.max(0, Math.sin(t * 2.3)) * 0.7;
      this.arms[0].rotation.z = -0.08 - this.talk * 0.15;
      this.arms[1].rotation.z = 0.08 + this.talk * 0.1;
    }

    this.mouth.scale.y = 1 + this.talk * Math.max(0, Math.sin(t * 17) * Math.sin(t * 5.3)) * 4;

    let target = 0;
    if (look) {
      const lx = look.x - this.group.position.x;
      const lz = look.z - this.group.position.z;
      let rel = Math.atan2(lx, lz) - this.group.rotation.y;
      rel = Math.atan2(Math.sin(rel), Math.cos(rel));
      target = THREE.MathUtils.clamp(rel, -1.1, 1.1);
    } else {
      target = Math.sin(t * 0.3 + this.phase) * 0.4;
    }
    this.headYaw = THREE.MathUtils.damp(this.headYaw, target, 4, dt);
    this.head.rotation.y = this.headYaw;
  }
}

export function makeCast() {
  const cast = {};

  cast.dez = new Person({
    skin: '#5b3a26',
    shirtMat: new THREE.MeshStandardMaterial({ map: floralTexture('#0d7377', '#ff7b54'), roughness: 0.8 }),
    shorts: '#c9b48a',
    hairColor: '#111',
    build: 1.08,
    decorate(p, h) {
      p.addHair('#121212', 'twists');
      const beard = h.sphere(0.1, h.std('#151515', { roughness: 1 }));
      beard.geometry = new THREE.SphereGeometry(0.1, 14, 10, 0, Math.PI * 2, Math.PI * 0.55, Math.PI * 0.45);
      beard.position.set(0, 0.11, 0.02);
      p.head.add(beard);
      const towel = h.box(0.12, 0.02, 0.45, h.std('#f6f2ea'));
      towel.position.set(0.17, 0.42, 0);
      towel.rotation.x = 0.1;
      p.torso.add(towel);
    },
  });

  cast.brenda = new Person({
    skin: '#f0c4a0',
    shirt: '#ff8fab',
    shorts: '#f8f8f4',
    shortsLen: 0.5,
    shoes: '#ffffff',
    hairColor: '#c9a15a',
    build: 0.95,
    decorate(p, h) {
      p.addHair('#d8b46a', 'bob');
      const visor = h.cyl(0.125, 0.125, 0.04, h.std('#ffffff'), 18);
      visor.position.set(0, 0.2, 0);
      const brim = h.box(0.2, 0.012, 0.12, h.std('#2ec27e'));
      brim.position.set(0, 0.19, 0.13);
      p.head.add(visor, brim);
      const pack = h.box(0.26, 0.1, 0.08, h.std('#a3ff3c', { roughness: 0.4 }));
      pack.position.set(0, -0.04, 0.17);
      p.torso.add(pack);
      const card = h.box(0.09, 0.12, 0.006, h.std('#fdfdfd', { roughness: 0.15 }));
      card.position.set(0, 0.2, 0.135);
      p.torso.add(card);
      const lanyard = h.box(0.01, 0.2, 0.004, h.std('#2457c5'));
      lanyard.position.set(0, 0.33, 0.13);
      p.torso.add(lanyard);
    },
  });

  cast.captain = new Person({
    skin: '#d8a07a',
    shirt: '#f4f4f0',
    shorts: '#1c2b4a',
    belly: 1.35,
    build: 1.15,
    hairColor: '#cfcfcf',
    decorate(p, h) {
      const hat = h.cyl(0.13, 0.12, 0.08, h.std('#ffffff'), 18);
      hat.position.y = 0.21;
      hat.scale.set(1.15, 1, 1.15);
      const band = h.cyl(0.123, 0.123, 0.03, h.std('#111111'), 18);
      band.position.y = 0.19;
      const brim = h.box(0.18, 0.012, 0.1, h.std('#111111', { roughness: 0.2 }));
      brim.position.set(0, 0.175, 0.12);
      const badge = h.sphere(0.018, h.std('#d4af37', { metalness: 0.9, roughness: 0.3 }));
      badge.position.set(0, 0.21, 0.13);
      p.head.add(hat, band, brim, badge);
      const beard = h.sphere(0.11, h.std('#d6d6d6', { roughness: 1 }));
      beard.geometry = new THREE.SphereGeometry(0.11, 14, 10, 0, Math.PI * 2, Math.PI * 0.5, Math.PI * 0.5);
      beard.position.set(0, 0.1, 0.02);
      beard.scale.y = 1.4;
      p.head.add(beard);
    },
  });

  cast.gary = new Person({
    skin: '#f4d3c2',
    noseMat: std('#e8705a'),
    shirt: '#a9c8ec',
    longSleeves: true,
    shorts: '#b7a77f',
    longPants: true,
    socks: true,
    shoes: '#6b4a2e',
    hairColor: '#7a5a3a',
    pose: 'laptop',
    decorate(p, h) {
      p.addHair('#7a5a3a', 'short');
      const frame = h.std('#222222', { roughness: 0.3 });
      for (const sx of [-1, 1]) {
        const lens = new THREE.Mesh(new THREE.TorusGeometry(0.024, 0.005, 6, 14), frame);
        lens.position.set(sx * 0.038, 0.13, 0.118);
        p.head.add(lens);
      }
      const laptop = new THREE.Group();
      const base = h.box(0.34, 0.02, 0.24, h.std('#b8bcc2', { metalness: 0.7, roughness: 0.3 }));
      const lid = h.box(0.34, 0.24, 0.015, h.std('#b8bcc2', { metalness: 0.7, roughness: 0.3 }));
      lid.position.set(0, 0.12, -0.12);
      const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.3, 0.2), new THREE.MeshBasicMaterial({ color: 0x9fd3ff }));
      screen.position.set(0, 0.12, -0.111);
      laptop.add(base, lid, screen);
      laptop.position.set(0, 1.05, 0.05);
      p.torso.add(laptop);
      p.laptop = laptop;
    },
  });

  cast.marisol = new Person({
    skin: '#c48a5e',
    shirt: '#f7f3ea',
    shorts: '#6a4c93',
    longPants: true,
    shoes: '#c48a5e',
    hairColor: '#1f140e',
    build: 0.92,
    decorate(p, h) {
      p.addHair('#24170f', 'long');
      const flower = h.sphere(0.035, h.std('#ff4f79'));
      flower.position.set(0.1, 0.17, 0.03);
      p.head.add(flower);
      for (let i = 0; i < 3; i++) {
        const bead = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.006, 6, 12), h.std(['#2ec4b6', '#ff9f1c', '#e71d36'][i]));
        bead.rotation.x = Math.PI / 2;
        bead.position.y = -0.62;
        p.arms[0].add(bead);
        bead.position.y -= i * 0.02;
      }
    },
  });

  cast.pearl = new Person({
    skin: '#e8c1a4',
    shirt: '#00a5a5',
    shorts: '#262a3b',
    shoes: '#ffffff',
    socks: true,
    scale: 0.9,
    hairColor: '#eeeeee',
    decorate(p, h) {
      p.addHair('#f0f0f0', 'bun');
      const visor = h.cyl(0.125, 0.125, 0.035, h.std('#b5179e'), 18);
      visor.position.set(0, 0.19, 0);
      const brim = h.box(0.2, 0.012, 0.12, h.std('#b5179e'));
      brim.position.set(0, 0.18, 0.13);
      const shades = h.box(0.13, 0.035, 0.02, h.std('#0b0b0b', { roughness: 0.05, metalness: 0.5 }));
      shades.position.set(0, 0.13, 0.115);
      p.head.add(visor, brim, shades);
      for (const a of p.arms) {
        const band = h.cyl(0.05, 0.05, 0.05, h.std('#ff006e'));
        band.position.y = -0.56;
        a.add(band);
      }
    },
  });

  return cast;
}

export function makeSeagull() {
  const g = new THREE.Group();
  const white = std('#f5f5f2', { roughness: 0.8 });
  const grey = std('#9aa3ab', { roughness: 0.8 });
  const body = sphere(0.16, white);
  body.scale.set(0.8, 0.75, 1.6);
  g.add(body);
  const head = sphere(0.09, white);
  head.position.set(0, 0.1, 0.24);
  g.add(head);
  const beak = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.11, 8), std('#f2b134'));
  beak.rotation.x = Math.PI / 2;
  beak.position.set(0, 0.09, 0.36);
  g.add(beak);
  for (const sx of [-1, 1]) {
    const eye = sphere(0.012, std('#111'));
    eye.position.set(sx * 0.05, 0.13, 0.3);
    g.add(eye);
  }
  const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.2, 4), grey);
  tail.rotation.x = -Math.PI / 2;
  tail.scale.y = 0.3;
  tail.position.set(0, 0.02, -0.3);
  g.add(tail);
  const wings = [];
  for (const sx of [-1, 1]) {
    const pivot = new THREE.Group();
    pivot.position.set(sx * 0.1, 0.06, 0);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.015, 0.2), grey);
    wing.position.x = sx * 0.28;
    const tip = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.016, 0.12), std('#222'));
    tip.position.x = sx * 0.6;
    pivot.add(wing, tip);
    g.add(pivot);
    wings.push(pivot);
  }
  g.traverse((o) => (o.castShadow = true));
  g.userData.wings = wings;
  return g;
}
