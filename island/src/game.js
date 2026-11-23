import * as THREE from 'three';
import { CHARACTERS } from './dialogue.js';
import { height, findShore } from './terrain.js';
import { smoothstep } from './noise.js';

export const HOUR_SECONDS = 45; // real seconds per in-game hour
export const VACATION_DAYS = 3;

const freshToday = () => ({ drinks: 0, tours: 0, yoga: 0, volley: 0, brendaJoin: 0, naps: 0, uses: {}, bliss: 0, memories: 0 });

export function newState() {
  return {
    day: 1,
    hour: 8.5,
    fun: 40,
    relax: 25,
    energy: 85,
    sunburn: 0,
    credits: 200,
    sunscreen: 0,
    shells: 0,
    flags: {},
    items: { phone: true },
    memories: [],
    bliss: 0,
    today: freshToday(),
    counters: {},
    nextBuzz: 9.4,
    phoneIgnores: 0,
  };
}

const SAVE_KEY = 'palmera-cay-save-v1';
export function loadSave() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
export function clearSave() {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* private mode */
  }
}

export class Game {
  constructor({ world, cast, gull, ui, audio, player, L, sky, state }) {
    Object.assign(this, { world, cast, gull, ui, audio, player, L, sky });
    this.s = state || newState();
    this.busy = false; // dialogue / narration / minigame
    this.talking = null;
    this.sprinting = false;
    this.kevin = { mode: 'circle', t: 0, snackTimer: 0, pos: new THREE.Vector3(L.bar.x, 14, L.bar.z), vel: new THREE.Vector3() };
    this.setupNPCs();
    this.setupInteractables();
    this.lastFocus = null;
  }

  // ------------------------------------------------------------ helpers
  counter(key) {
    const v = this.s.counters[key] || 0;
    this.s.counters[key] = v + 1;
    return v;
  }
  setFlag(k, v = true) {
    this.s.flags[k] = v;
  }
  give(item) {
    this.s.items[item] = true;
    const names = { snack: 'Churro (to go)', coconut: 'Coconut with history', voucher: 'Snorkel voucher', spf100: 'SPF 100' };
    if (names[item]) this.ui.toast(`+ ${names[item]}`, 'item');
  }
  take(item) {
    delete this.s.items[item];
  }
  mult(key) {
    const n = this.s.today.uses[key] || 0;
    this.s.today.uses[key] = n + 1;
    return Math.pow(0.62, n);
  }
  absHour() {
    return this.s.day * 24 + this.s.hour;
  }

  fx(o, silent = false) {
    const s = this.s;
    const labels = { fun: 'Fun', relax: 'Relaxation', energy: 'Energy', sunburn: 'Sunburn', credits: '$' };
    for (const [k, v0] of Object.entries(o)) {
      const v = Math.round(v0);
      if (!v) continue;
      if (k === 'credits') s.credits = Math.max(0, s.credits + v);
      else s[k] = THREE.MathUtils.clamp(s[k] + v, 0, 100);
      if (!silent) {
        const good = k === 'sunburn' ? v < 0 : v > 0;
        const text = k === 'credits' ? `${v > 0 ? '+' : '−'}$${Math.abs(v)}` : `${v > 0 ? '+' : '−'}${Math.abs(v)} ${labels[k]}`;
        this.ui.toast(text, good ? 'good' : 'bad');
      }
    }
    if (!silent && (o.fun > 0 || o.relax > 0)) this.audio.blip('good');
  }

  memory(id, text) {
    if (this.s.memories.find((m) => m.id === id)) return;
    this.s.memories.push({ id, text, day: this.s.day });
    this.s.today.memories++;
    this.ui.memory(text);
    this.audio.blip('memory');
  }

  applySunscreen(hours) {
    this.s.sunscreen = Math.max(this.s.sunscreen, hours);
    this.ui.toast(`Sunscreen on (${hours}h)`, 'item');
  }

  passTime(h) {
    const s = this.s;
    s.hour += h;
    const b = (s.fun / 100) * (s.relax / 100) * 10 * h;
    s.bliss += b;
    s.today.bliss += b;
    s.sunscreen = Math.max(0, s.sunscreen - h);
  }

  onSand() {
    const p = this.player.pos;
    const h = height(p.x, p.z);
    return !this.player.swimming && h > 0 && h < 2.6;
  }

  garyAtWifi() {
    const g = this.npcs.gary;
    return Math.hypot(g.pos.x - this.L.wifi.x, g.pos.z - this.L.wifi.z) < 3;
  }

  // ------------------------------------------------------------ NPCs
  setupNPCs() {
    const W = this.world;
    const L = this.L;
    const shore = (x, back) => {
      const s = findShore(x, 0, 0, 1);
      return { x, z: s.z - back };
    };
    const brendaStops = [
      { x: L.dock.x - 3, z: L.dock.z0 - 3 },
      { x: L.volleyball.x + 7, z: L.volleyball.z + 3 },
      { x: L.bar.x - 9, z: L.bar.z - 4 },
      { x: L.grove.x + 4, z: L.grove.z + 6 },
      { x: L.yoga.x + 7, z: L.yoga.z + 3 },
      { x: L.bench.x - 2, z: L.bench.z + 2 },
      { x: L.welcome.x - 2, z: L.welcome.z - 2 },
      { x: L.loungers[2].x + 2, z: L.loungers[2].z - 2 },
    ];
    const garyStops = [shore(-20, 6), { x: L.dock.x - 2.5, z: L.dock.z0 + 1 }, shore(0, 4), { x: L.bar.x + 9, z: L.bar.z + 2 }, shore(-65, 5), { x: L.welcome.x + 3, z: L.welcome.z }, shore(30, 3)];
    const lounger = (i) => ({ x: L.loungers[i].x + 1, z: L.loungers[i].z, face: Math.PI * 0 });

    const defs = {
      dez: { speed: 1.2, target: (s) => (s.hour >= 9 && s.hour < 24.5 ? { ...W.dezSpot, face: 0 } : null) },
      captain: {
        speed: 1.1,
        target: (s) => {
          if (s.hour >= 8.5 && s.hour < 17) return { ...W.captainSpot, face: Math.PI };
          if (s.hour >= 17 && s.hour < 21.5) return { x: L.bar.x + 4.6, z: L.bar.z + 1.5, face: -Math.PI / 2 };
          return null;
        },
      },
      pearl: {
        speed: 1.3,
        target: (s) => {
          if (s.hour >= 8 && s.hour < 17.5) return { ...W.pearlSpot, face: 0 };
          if (s.hour >= 17.5 && s.hour < 21) return lounger(5);
          return null;
        },
      },
      marisol: {
        speed: 1.1,
        target: (s) => {
          if (s.hour >= 16.25 && s.hour < 20) return { x: L.yoga.x - 1.5, z: L.yoga.z, face: -Math.PI / 2 };
          if (s.hour >= 7 && s.hour < 16.25) return { x: L.yoga.x + 1.2, z: L.yoga.z + 1.5, face: -Math.PI / 2, pose: 'meditate' };
          if (s.hour >= 20 && s.hour < 22.5) return { x: L.bar.x - 4.4, z: L.bar.z + 2, face: Math.PI / 2 };
          return null;
        },
      },
      brenda: {
        speed: 2.1,
        target: (s) => {
          if (s.hour < 7 || s.hour >= 22.4) return null;
          if (s.flags.brendaRelaxed) {
            if (s.hour < 18) return lounger(1);
            return { x: L.bar.x - 3.6, z: L.bar.z - 3, face: 0.6 };
          }
          return brendaStops[Math.floor(s.hour) % brendaStops.length];
        },
      },
      gary: {
        speed: 1.25,
        target: (s) => {
          if (s.hour < 7.5 || s.hour >= 23) return null;
          if (s.flags.garyDone) {
            if (s.flags.garyBuried || s.hour < 12 || s.hour > 15) return { ...shore(4, -1.5), face: 0 };
            return { x: L.wifi.x + 1, z: L.wifi.z - 1, face: Math.PI * 0.75 };
          }
          if (s.flags.garyToLighthouse) return { x: L.wifi.x + 0.8, z: L.wifi.z - 0.6, face: Math.PI * 0.8 };
          return garyStops[Math.floor(s.hour * 2.5) % garyStops.length];
        },
      },
    };

    this.npcs = {};
    for (const [key, def] of Object.entries(defs)) {
      const person = this.cast[key];
      const t = def.target(this.s) || W.dezSpot;
      person.group.position.set(t.x, W.groundAt(t.x, t.z), t.z);
      this.world.scene.add(person.group);
      this.npcs[key] = { key, person, def, pos: person.group.position, moving: false };
    }
  }

  updateNPCs(dt, t) {
    const pp = this.player.pos;
    for (const n of Object.values(this.npcs)) {
      const target = n.def.target(this.s);
      const P = n.person;
      if (n.key === 'gary') P.pose = this.s.flags.garyDone ? null : 'laptop';
      if (n.key === 'gary' && P.laptop) P.laptop.visible = !this.s.flags.garyBuried && (!this.s.flags.garyDone || this.s.flags.garyToLighthouse);
      const talking = this.talking === n.key;
      if (!target) {
        if (P.group.visible && n.pos.distanceTo(pp) > 25) P.group.visible = false;
        continue;
      }
      if (!P.group.visible) {
        // Come back on duty out of the player's sight if possible, but never
        // keep someone away for long just because the player is standing there.
        const cam = this.player.camera;
        const fwd = cam.getWorldDirection(new THREE.Vector3());
        const to = new THREE.Vector3(target.x - cam.position.x, 0, target.z - cam.position.z);
        const dist = to.length();
        const inView = dist < 60 && fwd.x * to.x + fwd.z * to.z > 0.35 * dist * Math.hypot(fwd.x, fwd.z);
        n.hiddenFor = (n.hiddenFor || 0) + dt;
        if (!inView || dist > 40 || n.hiddenFor > 10) {
          n.pos.set(target.x, this.world.groundAt(target.x, target.z), target.z);
          P.group.visible = true;
          n.hiddenFor = 0;
        }
        continue;
      }
      const dx = target.x - n.pos.x;
      const dz = target.z - n.pos.z;
      const d = Math.hypot(dx, dz);
      n.moving = d > 0.3 && !talking;
      let desiredYaw = target.face ?? P.group.rotation.y;
      if (n.moving) {
        // Big trips happen off-screen in a blink.
        if (d > 70 && n.pos.distanceTo(pp) > 30 && Math.hypot(target.x - pp.x, target.z - pp.z) > 30) {
          n.pos.set(target.x, this.world.groundAt(target.x, target.z), target.z);
        } else {
          const step = Math.min(d, n.def.speed * dt);
          n.pos.x += (dx / d) * step;
          n.pos.z += (dz / d) * step;
          desiredYaw = Math.atan2(dx, dz);
        }
      }
      const distP = Math.hypot(pp.x - n.pos.x, pp.z - n.pos.z);
      if (talking || (!n.moving && distP < 5 && !target.pose)) desiredYaw = Math.atan2(pp.x - n.pos.x, pp.z - n.pos.z);
      let dy = desiredYaw - P.group.rotation.y;
      dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      P.group.rotation.y += dy * Math.min(1, dt * (talking ? 5 : 3));
      n.pos.y = THREE.MathUtils.damp(n.pos.y, this.world.groundAt(n.pos.x, n.pos.z, n.pos.y), 12, dt);
      if (n.key !== 'gary') P.pose = !n.moving && target.pose ? target.pose : null;
      P.update(dt, t, { moving: n.moving, speed: n.def.speed / 1.2, talking, speaking: talking && this.ui.typing, look: distP < 7 ? pp : null });
    }
  }

  // Characters are solid: keep the player (and the camera) from walking
  // into them, which would put the camera inside their head.
  keepPlayerOut(extraPeople = []) {
    const pp = this.player.pos;
    const bodies = Object.values(this.npcs).map((n) => n.person.group).concat(extraPeople);
    for (const g of bodies) {
      if (!g.visible) continue;
      const dx = pp.x - g.position.x;
      const dz = pp.z - g.position.z;
      const d = Math.hypot(dx, dz);
      const min = 0.75;
      if (d < min && Math.abs(pp.y - g.position.y) < 1.5) {
        const k = d > 1e-4 ? min / d : 0;
        pp.x = g.position.x + (k ? dx * k : min);
        pp.z = g.position.z + (k ? dz * k : 0);
      }
    }
  }

  // ------------------------------------------------------------ Kevin
  updateKevin(dt, t) {
    const K = this.kevin;
    const g = this.gull;
    const cam = this.player.camera.position;
    const pp = this.player.pos;
    const center = new THREE.Vector3(this.L.bar.x + 10, 15, this.L.bar.z + 14);
    let target;
    const exposed = this.s.items.snack && !this.world.underRoof(pp.x, pp.z) && !this.busy;

    if (K.mode === 'circle') {
      const a = t * 0.25;
      target = center.clone().add(new THREE.Vector3(Math.cos(a) * 22, Math.sin(t * 0.4) * 3, Math.sin(a) * 22));
      if (exposed) {
        K.snackTimer += dt;
        if (K.snackTimer > 16 && pp.distanceTo(center) < 90) {
          K.mode = 'swoop';
          K.t = 0;
          this.audio.gull();
          this.ui.toast('A seagull is staring at your churro.', 'bad');
        }
      }
    } else if (K.mode === 'swoop') {
      K.t += dt;
      target = cam.clone().add(new THREE.Vector3(0, -0.25, 0));
      if (!exposed) {
        K.mode = 'circle';
        K.snackTimer = 6;
        this.ui.toast('The seagull pretends it was never interested.', 'good');
      } else if (K.pos.distanceTo(target) < 1.2) {
        this.take('snack');
        K.mode = 'escape';
        K.t = 0;
        K.snackTimer = 0;
        this.audio.gull();
        this.ui.toast('KEVIN HAS TAKEN YOUR CHURRO. Kevin feels no remorse.', 'bad');
        this.fx({ fun: 4, relax: -5 });
        this.memory('kevin', 'Lost a churro to Kevin the seagull. He looked you dead in the eye.');
      }
    } else {
      K.t += dt;
      target = center.clone().add(new THREE.Vector3(30, 20, -10));
      if (K.t > 6) K.mode = 'circle';
    }
    const speed = K.mode === 'swoop' ? 14 : K.mode === 'escape' ? 12 : 8;
    const desired = target.clone().sub(K.pos);
    const dist = desired.length();
    desired.normalize().multiplyScalar(Math.min(speed, dist * 3));
    K.vel.lerp(desired, Math.min(1, dt * 2.5));
    K.pos.addScaledVector(K.vel, dt);
    g.position.copy(K.pos);
    if (K.vel.lengthSq() > 0.01) g.rotation.y = Math.atan2(K.vel.x, K.vel.z);
    g.rotation.z = THREE.MathUtils.clamp(-K.vel.x * 0.02, -0.5, 0.5);
    const flap = K.mode === 'circle' ? Math.sin(t * 3) * 0.25 + 0.1 : Math.sin(t * 14) * 0.7;
    g.userData.wings[0].rotation.z = flap;
    g.userData.wings[1].rotation.z = -flap;
  }

  // ------------------------------------------------------------ interactions
  setupInteractables() {
    const W = this.world;
    const L = this.L;
    const s = this.s;
    const I = [];
    for (const [key, n] of Object.entries(this.npcs)) {
      I.push({ kind: 'npc', key, r: key === 'dez' ? 4.8 : 2.8, get pos() { return n.pos; }, visible: () => n.person.group.visible, label: () => `Talk to ${CHARACTERS[key].name}`, act: () => this.openDialogue(key) });
    }
    I.push({
      pos: W.hammockSeat, r: 2.6,
      label: () => 'Lie in the hammock',
      act: () => {
        const m = this.mult('hammock');
        const line = ["You sway. A breeze negotiates quietly with the palms. You forget what a 'deliverable' is.", 'You doze off and dream you are a hammock. It is very relaxing.', 'A gecko lands on your knee, looks around, and leaves. Best meeting you have had all year.'][this.counter('hammock') % 3];
        this.setFlag('usedHammock');
        this.narrate([line], () => this.fx({ relax: 20 * m, energy: 10, fun: 2 * m }), 1);
      },
    });
    L.loungers.forEach((l, i) => {
      I.push({
        pos: l, r: 1.8,
        label: () => (s.items.snack ? 'Eat your churro on the lounger' : 'Lounge on the sun bed'),
        act: () => {
          const m = this.mult('lounge');
          const shaded = W.inShade(l.x, l.z);
          const strong = this.sky.elevation > 25;
          const cards = [];
          const fx = { relax: 13 * m, fun: 2 * m };
          if (s.items.snack) {
            this.take('snack');
            cards.push('You eat the churro in the sun, cinnamon on your fingers, waves doing their thing. Somewhere above, a seagull screams in frustration.');
            fx.fun += 9;
            fx.relax += 8;
            fx.energy = 12;
            this.memory('churro', 'Ate a beach churro in peace. Kevin watched from afar, seething.');
          } else {
            cards.push(['You stretch out. The sea hisses up the sand and back, over and over, like it has all the time in the world. It does.', 'You lie there long enough to get one of those sun-warm naps where you can still hear everything.', 'A kid somewhere shrieks with joy. A wave answers. You do absolutely nothing about either.'][this.counter('lounge') % 3]);
          }
          if (strong && !shaded && s.sunscreen <= 0) {
            cards.push('...You did not wear sunscreen. You can feel your shins becoming bacon.');
            fx.sunburn = 14;
          }
          this.narrate(cards, () => this.fx(fx), 0.75);
        },
      });
    });
    const hut = W.myHut;
    I.push({
      pos: hut.bed, y: hut.deckY, r: 2.4,
      label: () => (s.hour >= 20 || s.hour < 6 ? 'Sleep until morning' : s.today.naps < 2 ? 'Take a nap (2 hours)' : null),
      act: () => {
        if (s.hour >= 20 || s.hour < 6) return this.endDay('bed');
        s.today.naps++;
        const e = s.flags.powerNap ? 45 : 30;
        this.narrate(['You flop onto the bed. The ceiling fan turns. The sea breathes under the floorboards.', 'You wake up two hours later with a pillow crease on your face and no idea what year it is.'], () => this.fx({ energy: e, relax: 8 }), 2);
      },
    });
    I.push({
      pos: hut.table, y: hut.deckY, r: 1.8,
      label: () => (s.items.spf100 ? 'Apply SPF 100 (6h)' : 'Apply sunscreen (3h)'),
      act: () => {
        this.applySunscreen(s.items.spf100 ? 6 : 3);
        if (!s.flags.firstSunscreen) {
          this.setFlag('firstSunscreen');
          this.narrate(['You apply it everywhere except one spot in the middle of your back that you cannot reach. That spot will remember this.'], null, 0);
        }
        this.audio.blip('good');
      },
    });
    for (const palm of W.coconutPalms) {
      I.push({
        pos: palm, r: 1.9,
        label: () => (!s.items.coconut && palm.nuts > 0 ? 'Shake the palm tree' : null),
        act: () => {
          if (Math.random() < 0.55) {
            palm.nuts--;
            this.give('coconut');
            this.fx({ fun: 4 });
            this.ui.toast(s.flags.coconutQuest ? 'A coconut drops, narrowly missing your foot. Dez will love it.' : 'A coconut drops, narrowly missing your foot.', 'good');
          } else {
            this.ui.toast('Nothing falls. The palm seems smug about it.', 'neutral');
          }
          this.audio.blip('rustle');
        },
      });
    }
    for (const shell of W.shells) {
      I.push({
        pos: shell, r: 1.6,
        label: () => (shell.taken ? null : 'Pick up a pretty shell'),
        act: () => {
          shell.taken = true;
          shell.mesh.visible = false;
          shell.glint.visible = false;
          s.shells++;
          this.fx({ fun: 3, relax: 1 });
          this.ui.toast(`Shell ${s.shells} / ${W.shells.length}`, 'item');
          if (s.shells === W.shells.length) this.memory('shells', `Found all ${W.shells.length} pretty shells. Brenda is impressed and slightly threatened.`);
        },
      });
    }
    I.push({
      pos: L.bench, r: 2,
      label: () => 'Sit and take in the view',
      act: () => {
        const m = this.mult('bench');
        this.narrate(['You can see the whole island from up here: the bar, the dock, a tiny Brenda power-walking somewhere. The sea goes on forever, minding its own business.'], () => this.fx({ relax: 16 * m, fun: 4 * m }), 0.5);
        this.memory('view', 'Saw the whole island from the lighthouse hill. It looked like a postcard someone forgot to send.');
      },
    });
    I.push({
      pos: L.wifi, r: 2.2,
      label: () => (s.items.phone ? 'Check your phone (one whole bar!)' : null),
      act: () => {
        this.narrate(["Your phone finds one bar. Forty-seven emails arrive at once, like pigeons. One is titled 'URGENT (not urgent).' Another says 'per my last email.' You feel your shoulders climb back up to your ears."], () => this.fx({ relax: -18, fun: -4 }), 0.25);
      },
    });
    I.push({
      pos: W.gong, r: 2,
      label: () => 'Ring the gong',
      act: () => {
        const m = this.mult('gong');
        this.audio.gong();
        this.fx({ fun: 4 * m, relax: 2 * m });
        this.ui.toast('BWONNNG. Somewhere, Marisol nods approvingly.', 'neutral');
      },
    });
    this.interactables = I;
  }

  focus() {
    if (this.busy) return null;
    const p = this.player.pos;
    const fwd = new THREE.Vector3();
    this.player.camera.getWorldDirection(fwd);
    let best = null;
    let bestScore = Infinity;
    for (const it of this.interactables) {
      if (it.visible && !it.visible()) continue;
      const pos = it.pos;
      const dx = pos.x - p.x;
      const dz = pos.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > it.r) continue;
      if (it.y !== undefined && Math.abs(p.y - it.y) > 1.2) continue;
      const label = it.label();
      if (!label) continue;
      const facing = d < 0.9 ? 1 : (fwd.x * dx + fwd.z * dz) / (d * Math.hypot(fwd.x, fwd.z) || 1);
      if (facing < 0.25) continue;
      const score = d * (2 - facing);
      if (score < bestScore) {
        bestScore = score;
        best = { it, label };
      }
    }
    return best;
  }

  interact() {
    const f = this.focus();
    if (f) f.it.act();
  }

  // ------------------------------------------------------------ dialogue
  openDialogue(key) {
    const ch = CHARACTERS[key];
    this.busy = true;
    this.talking = key;
    this.dialogueChar = ch;
    this.player.unlock();
    this.audio.blip('talk');
    this.showNode(ch.start(this.s, this));
  }

  showNode(id) {
    const ch = this.dialogueChar;
    const node = ch.nodes[id];
    const text = typeof node.text === 'function' ? node.text(this.s, this) : node.text;
    const choices = node.choices.filter((c) => !c.if || c.if(this.s, this));
    this.ui.dialogue(ch, text, choices.map((c) => (typeof c.text === 'function' ? c.text(this.s) : c.text)), (i) => this.choose(choices[i]));
  }

  choose(c) {
    if (c.set) {
      if (Array.isArray(c.set)) c.set.forEach((f) => this.setFlag(f));
      else Object.entries(c.set).forEach(([k, v]) => this.setFlag(k, v));
    }
    if (c.fx) this.fx(c.fx);
    if (c.close) {
      this.closeDialogue(true);
      if (c.act) c.act(this);
      if (!this.busy) this.player.lock();
      return;
    }
    if (c.act) c.act(this);
    if (c.go) this.showNode(c.go);
    else this.closeDialogue();
  }

  closeDialogue(keepUnlocked = false) {
    this.ui.closeDialogue();
    this.talking = null;
    this.busy = false;
    if (!keepUnlocked) this.player.lock();
  }

  orderDrink(d) {
    this.s.today.drinks++;
    this.lastDrink = d;
    this.fx({ credits: -12, ...d[2] });
    this.audio.blip('pour');
    if (this.s.today.drinks === 1 && this.s.day === 1) this.memory('firstdrink', `Ordered your first diagnosis from Dez: "${d[0]}."`);
  }

  narrate(cards, done, hours = 0) {
    this.busy = true;
    this.player.unlock();
    this.ui.narrate(cards, () => {
      if (hours) this.passTime(hours);
      if (done) done();
      this.busy = false;
      this.player.lock();
    }, hours > 0);
  }

  tour(voucher) {
    const s = this.s;
    s.today.tours++;
    if (voucher) this.take('voucher');
    const cards = [
      "The Unsinkable II putters out past the reef. The Captain narrates everything. 'To starboard, a rare blue tang!' It's a plastic bag. He salutes it anyway.",
      'You slip into water so clear it feels like a rumor. Parrotfish crunch coral like popcorn. A school of silver fish swerves around you as one thought.',
      "A sea turtle glides up, regards you with the patience of a retired librarian, and leaves. The Captain claims he trained her. 'That's Doris. She owes me money.'",
      "On the way back he lets you steer. You go in a perfect circle. He calls it 'textbook.'",
    ];
    this.narrate(cards, () => {
      this.fx({ fun: 28, relax: 14, energy: -14, sunburn: s.sunscreen > 0 ? 3 : 14, credits: voucher ? 0 : -60 });
      this.memory('turtle', "Went snorkeling with Captain Lorenzo and met Doris the sea turtle. He claims he trained her.");
    }, 2);
  }

  yoga() {
    this.busy = true;
    this.player.unlock();
    this.s.today.yoga++;
    this.ui.yoga((score) => {
      const pct = Math.round(score * 100);
      const lines = [
        `Marisol bows. "Your aura went from beige to... apricot! I'm so proud of you." (Balance: ${pct}%)`,
      ];
      if (score < 0.4) lines.unshift('You fall out of Reluctant Pelican twice and Tax Season Release once. Marisol says falling is just "dancing with gravity."');
      else lines.unshift('As the sun sinks, you hold Downward Dez and Reluctant Pelican like a person who has never answered an email.');
      this.ui.narrate(lines, () => {
        this.passTime(0.75);
        this.fx({ relax: 12 + 22 * score, fun: 8, energy: -6 });
        if (score > 0.65) this.memory('yoga', 'Held Reluctant Pelican through a whole sunset. Your aura is now apricot.');
        this.busy = false;
        this.player.lock();
      }, true);
    });
  }

  volleyball() {
    this.busy = true;
    this.player.unlock();
    this.s.today.volley++;
    this.ui.volleyball((you, her) => {
      const won = you > her;
      const cards = won
        ? [`${you}–${her}. Pearl stares at the sand for a long moment. "The wind," she says. "It was the wind." There is no wind. She shakes your hand with a grip that could crack walnuts.`, '"Fine. Here is my secret: power naps. Twenty minutes, flat on your back, arms out like a starfish. You\'ll wake up feeling sixty-five."']
        : [`${you}–${her}. Pearl spikes the last ball so hard it reaches a different time zone. "Good effort, rookie. You owe me a piña colada."`];
      this.ui.narrate(cards, () => {
        this.passTime(0.75);
        if (won) {
          this.setFlag('beatPearl');
          this.setFlag('powerNap');
          this.fx({ fun: 22, relax: 5, energy: -15 });
          this.memory('pearl_win', 'Beat Nana Pearl at beach volleyball. She blames the wind.');
        } else {
          this.fx({ fun: 14, energy: -15, relax: -2, credits: this.s.credits >= 12 ? -12 : 0 });
          this.memory('pearl_loss', 'Got absolutely destroyed at volleyball by an 84-year-old named Pearl.');
        }
        this.busy = false;
        this.player.lock();
      }, true);
    });
  }

  // ------------------------------------------------------------ day cycle
  endDay(reason) {
    const s = this.s;
    this.busy = true;
    this.player.unlock();
    const summary = {
      day: s.day,
      reason,
      bliss: s.today.bliss,
      memories: s.memories.filter((m) => m.day === s.day),
      fun: s.fun,
      relax: s.relax,
    };
    this.audio.blip('memory');
    const last = s.day >= VACATION_DAYS;
    this.ui.postcard(summary, last, () => {
      if (last) {
        clearSave();
        this.ui.finale(this.finalReport());
        return;
      }
      s.day++;
      s.hour = 8;
      const inBed = reason === 'bed';
      s.energy = inBed ? 92 : 55;
      s.sunburn = Math.max(0, s.sunburn - 40);
      s.relax = THREE.MathUtils.clamp(s.relax + (inBed ? 6 : -12), 15, 100);
      s.fun = Math.max(s.fun - 10, 25);
      s.sunscreen = 0;
      s.today = freshToday();
      s.nextBuzz = 9 + Math.random();
      if (inBed) this.player.teleport(this.L.spawn.x, this.L.spawn.z, this.world.myHut.deckY, Math.PI);
      for (const p of this.world.coconutPalms) p.nuts = 3;
      try {
        localStorage.setItem(SAVE_KEY, JSON.stringify(s));
      } catch {
        /* storage unavailable */
      }
      if (!inBed) this.ui.toast(reason === 'tired' ? 'You collapsed from exhaustion and slept where you fell.' : 'You fell asleep under the stars. You wake with sand in places sand should never be.', 'bad');
      this.ui.toast(`Day ${s.day} of ${VACATION_DAYS}`, 'item');
      this.busy = false;
      this.player.lock();
    });
  }

  finalReport() {
    const s = this.s;
    const score = Math.round(s.bliss + s.memories.length * 12);
    const titles = [
      [0, 'Needs a Vacation From This Vacation'],
      [90, 'Respectable Beach Person'],
      [170, 'Certified Sun Lizard'],
      [250, 'Professional Hammock Occupant'],
      [330, 'Legend of Palmera Cay'],
    ];
    let title = titles[0][1];
    for (const [min, t] of titles) if (score >= min) title = t;
    return { score, title, memories: s.memories, bliss: Math.round(s.bliss), shells: s.shells, credits: s.credits, phone: !!s.items.phone };
  }

  // ------------------------------------------------------------ per-frame
  update(dt, t) {
    const s = this.s;
    this.updateNPCs(dt, t);
    this.updateKevin(dt, t);

    if (this.busy) return;

    const dh = dt / HOUR_SECONDS;
    s.hour += dh;
    const p = this.player;
    const pos = p.pos;

    p.tired = s.energy < 10;

    // Drift
    s.fun -= 3.4 * dh;
    s.relax -= (s.sunburn > 50 ? 4.5 : 2) * dh;
    s.energy -= (p.running ? 14 : p.swimming ? 6 : 2.6) * dh;

    // Sun
    const strength = smoothstep(8, 55, this.sky.elevation);
    const shaded = this.world.inShade(pos.x, pos.z) || p.underwater;
    if (!shaded && strength > 0) {
      s.sunburn += (s.sunscreen > 0 ? 0.8 : 9) * strength * dh;
    } else {
      s.sunburn -= 1.5 * dh;
    }
    s.sunscreen = Math.max(0, s.sunscreen - dh * (p.swimming ? 2 : 1));

    // The sea
    if (p.swimming) {
      s.today.swim = (s.today.swim || 0) + dh;
      const m = Math.exp(-s.today.swim / 1.6);
      s.fun += 5 * m * dh;
      s.relax += 3.5 * m * dh;
      if (p.underwater) {
        const R = this.L.reef;
        if (pos.x > R.x0 - 25 && pos.x < R.x1 + 15 && pos.z > R.z0 - 10 && pos.z < R.z1 + 10) {
          s.fun += 7 * dh;
          if (!s.flags.sawReef) {
            this.setFlag('sawReef');
            this.fx({ fun: 10, relax: 4 });
            this.memory('reef', 'Floated over the reef while a parrotfish crunched coral like popcorn.');
          }
        }
        if (this.world.turtle.position.distanceTo(p.camera.position) < 6) this.memory('turtle_swim', 'Swam alongside a sea turtle. She did not acknowledge you. Iconic.');
      }
      if (!s.flags.firstSwim) {
        this.setFlag('firstSwim');
        this.memory('swim', 'Walked into the sea until your feet left the sand. Warm as bathwater.');
      }
    }

    // Golden-hour and night-sky moments.
    const fwd = new THREE.Vector3();
    p.camera.getWorldDirection(fwd);
    if (s.hour > 17.7 && s.hour < 18.6 && !p.underwater) {
      const sd = this.sky.dir;
      const h = Math.hypot(fwd.x, fwd.z) * Math.hypot(sd.x, sd.z);
      if (h > 0 && (fwd.x * sd.x + fwd.z * sd.z) / h > 0.9) {
        this.sunsetGaze = (this.sunsetGaze || 0) + dt;
        if (this.sunsetGaze > 6 && !s.memories.find((m) => m.id === 'sunset')) {
          this.fx({ relax: 10, fun: 4 });
          this.memory('sunset', 'Watched the sun melt into the sea without taking a single photo.');
        }
      }
    }
    if ((s.hour > 21 || s.hour < 4) && fwd.y > 0.75 && !p.swimming) {
      this.starGaze = (this.starGaze || 0) + dt;
      if (this.starGaze > 5 && !s.memories.find((m) => m.id === 'stars')) {
        this.fx({ relax: 8 });
        this.memory('stars', 'Looked up and counted stars until you lost count, which was at nine.');
      }
    }

    // Bliss accrues continuously: it rewards being happy AND calm at once.
    const b = (Math.max(0, s.fun) / 100) * (Math.max(0, s.relax) / 100) * 10 * dh;
    s.bliss += b;
    s.today.bliss += b;

    for (const k of ['fun', 'relax', 'energy', 'sunburn']) s[k] = THREE.MathUtils.clamp(s[k], 0, 100);

    // Warnings
    if (s.sunburn > 60 && !this.warnedBurn) {
      this.warnedBurn = true;
      this.ui.toast('Your skin is sizzling. Find shade or sunscreen (your bungalow has some).', 'bad');
    }
    if (s.sunburn < 40) this.warnedBurn = false;
    if (s.energy < 15 && !this.warnedTired) {
      this.warnedTired = true;
      this.ui.toast("You're running on fumes. A nap, a hammock, or a snack would help.", 'bad');
    }
    if (s.energy > 25) this.warnedTired = false;

    // Phone
    if (s.items.phone && s.hour >= s.nextBuzz && s.hour < 21) {
      s.nextBuzz = s.hour + 1.4 + Math.random() * 1.6;
      this.audio.buzz();
      this.openDialogue('phone');
      return;
    }

    // Day end conditions
    if (s.energy <= 0) return this.endDay('tired');
    if (s.hour >= 26) return this.endDay('late');
    if (s.hour >= 23 && !this.warnedLate) {
      this.warnedLate = true;
      this.ui.toast('It is getting late. Your bed is in bungalow 7.', 'neutral');
    }
    if (s.hour < 23) this.warnedLate = false;
  }

  journal() {
    const s = this.s;
    const f = s.flags;
    const out = [];
    const add = (done, text) => out.push({ done, text });
    if (f.coconutQuest) add(!!f.existential, 'Dez wants a coconut "with history" from the old inland grove for The Existential Coconut.');
    if (f.metGary) add(!!f.garyDone, f.knowsWifi ? "Gary needs one bar of signal. Rumor says it's up on the lighthouse hill." : 'Gary needs one bar of signal to send "Sounds good!" Someone on the island must know where.');
    if (f.metBrenda) add(!!f.brendaRelaxed, 'Brenda has never lain down for no reason. Maybe someone could show her how (and the hammock).');
    if (f.metPearl) add(!!f.beatPearl, 'Nana Pearl plays volleyball on the south beach during the day. Beat her. If you can.');
    if (f.metMarisol) add(s.memories.some((m) => m.id === 'yoga'), 'Marisol leads sunset yoga on the west deck, around 5 to 7:30 pm.');
    if (f.metCaptain) add(s.memories.some((m) => m.id === 'turtle'), 'Captain Lorenzo runs snorkel tours from the dock, 9 am to 4 pm ($60).');
    if (s.items.phone) add(false, 'Your phone keeps buzzing. You could hand it to Dez, or find a more permanent solution.');
    add(s.shells >= this.world.shells.length, `Pretty shells found: ${s.shells} / ${this.world.shells.length}. They glint on the beaches.`);
    return out;
  }
}
