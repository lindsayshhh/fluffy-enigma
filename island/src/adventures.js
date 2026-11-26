// Bigger outings: snorkelling (a mask from the dock rack, the wreck of The
// Unsinkable I and two other treasures on the seabed), the Captain's sunset
// cruise with Reg alongside, and rainy-day karaoke at The Salty Coconut.
import * as THREE from 'three';
import { height, findShore } from './terrain.js';
import { texMaterial } from './assets.js';
import { EYE } from './player.js';
import * as T from './textures.js';

const _v = new THREE.Vector3();

export class Adventures {
  constructor({ scene, world, L, game, player, ui, audio, getDolphin, getExtras }) {
    Object.assign(this, { scene, world, L, game, player, ui, audio, getDolphin, getExtras });
    this.cruise = null;
    this.buildRack();
    this.buildWreck();
    this.buildTreasures();
    this.addInteractions();
    game.adventures = this;
  }

  // ------------------------------------------------------------ snorkel gear
  buildRack() {
    const D = this.L.dock;
    const x = D.x - 2.8;
    const z = D.z0 - 1.5;
    const g = new THREE.Group();
    g.position.set(x, height(x, z), z);
    g.rotation.y = 0.3;
    const wood = new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.8 });
    const post = (px) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.08, 1.5, 0.08), wood);
      m.position.set(px, 0.75, 0);
      g.add(m);
    };
    post(-0.7);
    post(0.7);
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.06, 0.06), wood);
    bar.position.y = 1.35;
    g.add(bar);
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.36), new THREE.MeshStandardMaterial({ map: T.textTexture(['SNORKEL GEAR - FREE'], { w: 768, h: 230, font: 'bold 84px Georgia, serif' }) }));
    sign.position.set(0, 1.62, 0.04);
    g.add(sign);
    // Masks hanging on the bar, fins leaning below.
    const glass = new THREE.MeshStandardMaterial({ color: 0x9fe3ff, roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.6 });
    const strap = new THREE.MeshStandardMaterial({ color: 0xffc93c, roughness: 0.6 });
    const fin = new THREE.MeshStandardMaterial({ color: 0x1fb5e5, roughness: 0.5 });
    for (let i = 0; i < 4; i++) {
      const mx = -0.5 + i * 0.33;
      const frame = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.018, 8, 16), strap);
      frame.scale.set(1.3, 1, 1);
      frame.position.set(mx, 1.18, 0.05);
      g.add(frame);
      const lens = new THREE.Mesh(new THREE.CircleGeometry(0.085, 16), glass);
      lens.scale.set(1.3, 1, 1);
      lens.position.set(mx, 1.18, 0.06);
      g.add(lens);
      const f = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.55, 0.02), fin);
      f.position.set(mx, 0.3, 0.12);
      f.rotation.x = -0.25;
      g.add(f);
    }
    g.traverse((o) => (o.castShadow = true));
    this.scene.add(g);
    this.world.colliders.push({ x, z, r: 0.8 });
    this.rack = { x, z };
  }

  // ------------------------------------------------------------ the wreck
  // Somewhere deep just past the west edge of the reef.
  findSeabed(cx, cz, lo, hi, radius = 30) {
    let best = null;
    let bestD = Infinity;
    for (let dx = -radius; dx <= radius; dx += 2) {
      for (let dz = -radius; dz <= radius; dz += 2) {
        const x = cx + dx;
        const z = cz + dz;
        const h = height(x, z);
        if (h > hi || h < lo) continue;
        const flat = Math.abs(height(x + 2, z) - height(x - 2, z)) + Math.abs(height(x, z + 2) - height(x, z - 2));
        const d = Math.hypot(dx, dz) + flat * 6;
        if (d < bestD) {
          bestD = d;
          best = { x, z, y: h };
        }
      }
    }
    return best || { x: cx, z: cz, y: height(cx, cz) };
  }

  buildWreck() {
    const R = this.L.reef;
    const spot = this.findSeabed(R.x0 - 8, (R.z0 + R.z1) / 2, -8, -4.8);
    this.wreckSpot = spot;
    const g = new THREE.Group();
    g.position.set(spot.x, spot.y - 0.5, spot.z);
    g.rotation.set(0.05, 2.2, 0.32); // settled on her side, half in the sand
    const wood =
      texMaterial('weathered_planks', { color: new THREE.Color(0.45, 0.5, 0.42), roughness: 1 }) ||
      new THREE.MeshStandardMaterial({ color: 0x5a5c48, roughness: 1 });
    // Hull: the same shape as The Unsinkable II, with a hole in it.
    const hull = new THREE.BoxGeometry(2.6, 1.2, 7.5, 4, 2, 8);
    const hp = hull.attributes.position;
    for (let i = 0; i < hp.count; i++) {
      const zz = hp.getZ(i);
      const yy = hp.getY(i);
      let xx = hp.getX(i);
      const bow = THREE.MathUtils.smoothstep(zz, 1.2, 3.75);
      xx *= 1 - bow * 0.9;
      xx *= yy < 0 ? 0.65 : 1;
      hp.setXYZ(i, xx, yy + bow * bow * 0.35, zz);
    }
    hull.computeVertexNormals();
    const h = new THREE.Mesh(hull, wood);
    g.add(h);
    const hole = new THREE.Mesh(new THREE.CircleGeometry(0.55, 10), new THREE.MeshBasicMaterial({ color: 0x05121a }));
    hole.position.set(1.31, -0.1, 0.8);
    hole.rotation.y = Math.PI / 2;
    g.add(hole);
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.8, 1.6), wood);
    cabin.position.set(0.1, 0.95, -1.4);
    cabin.rotation.z = 0.2;
    g.add(cabin);
    // Mast, snapped and lying across the deck.
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 4.2, 8), wood);
    mast.position.set(-1.2, 0.7, 0.4);
    mast.rotation.set(0.3, 0, 1.35);
    g.add(mast);
    // Name board.
    const name = new THREE.Mesh(
      new THREE.PlaneGeometry(2.4, 0.38),
      new THREE.MeshStandardMaterial({ map: T.textTexture(['The Unsinkable I'], { w: 1024, h: 160, bg: null, border: false, fg: '#2d3b2a', font: 'italic bold 92px Georgia, serif' }), transparent: true, roughness: 1 })
    );
    name.position.set(1.32, 0.15, -1);
    name.rotation.y = Math.PI / 2;
    g.add(name);
    // Barnacles and weed.
    const barn = new THREE.MeshStandardMaterial({ color: 0xcfc4ad, roughness: 1 });
    const weed = new THREE.MeshStandardMaterial({ color: 0x2f6b3a, roughness: 0.9, side: THREE.DoubleSide });
    for (let i = 0; i < 40; i++) {
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.04 + Math.random() * 0.05, 6, 4), barn);
      b.position.set((Math.random() - 0.5) * 2.6, -0.4 + Math.random() * 0.9, (Math.random() - 0.5) * 6.5);
      g.add(b);
    }
    this.weeds = [];
    for (let i = 0; i < 9; i++) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(0.25, 1.1 + Math.random()), weed);
      w.position.set(-1.6 + Math.random() * 3.2, 0.6, -3 + Math.random() * 6);
      g.add(w);
      this.weeds.push(w);
    }
    // The bell, still hanging from its little frame on the foredeck.
    const bronze = new THREE.MeshStandardMaterial({ color: 0x8c7a3a, metalness: 0.7, roughness: 0.45, emissive: 0x2a2208, emissiveIntensity: 0.6 });
    const prof = [];
    for (let i = 0; i <= 10; i++) {
      const u = i / 10;
      prof.push(new THREE.Vector2(0.06 + 0.12 * u * u + (u > 0.85 ? (u - 0.85) * 0.5 : 0), 0.3 - u * 0.3));
    }
    const bell = new THREE.Mesh(new THREE.LatheGeometry(prof, 18), bronze);
    bell.position.set(0.2, 1.0, 2.2);
    g.add(bell);
    const frame = new THREE.Mesh(new THREE.TorusGeometry(0.25, 0.025, 6, 12, Math.PI), wood);
    frame.position.set(0.2, 1.25, 2.2);
    g.add(frame);
    this.bell = bell;
    g.traverse((o) => {
      if (o.isMesh) o.castShadow = o.receiveShadow = true;
    });
    this.scene.add(g);
    this.wreck = g;
    g.updateMatrixWorld(true);
    this.bellPos = bell.getWorldPosition(new THREE.Vector3());
  }

  // A message in a bottle and a gold coin in a giant clam.
  buildTreasures() {
    const R = this.L.reef;
    const b = this.findSeabed((R.x0 + R.x1) / 2, R.z1 + 6, -6.5, -3.5, 22);
    const bottle = new THREE.Group();
    const glass = new THREE.MeshStandardMaterial({ color: 0x3f8f5a, roughness: 0.1, transparent: true, opacity: 0.75, emissive: 0x0b2a14, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.26, 12), glass);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.06, 0.12, 12), glass);
    neck.position.y = 0.19;
    const cork = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.05, 8), new THREE.MeshStandardMaterial({ color: 0xa0784a }));
    cork.position.y = 0.27;
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.18, 8), new THREE.MeshStandardMaterial({ color: 0xf1e6c8 }));
    bottle.add(body, neck, cork, paper);
    bottle.position.set(b.x, b.y + 0.05, b.z);
    bottle.rotation.set(0, 0.7, Math.PI / 2 - 0.25);
    this.scene.add(bottle);
    this.bottle = { o: bottle, x: b.x, z: b.z, y: b.y };

    const w = this.wreckSpot;
    const c = this.findSeabed(w.x + 7, w.z - 5, -8, -4.5, 10);
    const clam = new THREE.Group();
    const shell = new THREE.MeshStandardMaterial({ color: 0xbfb6a0, roughness: 0.8 });
    const inside = new THREE.MeshStandardMaterial({ color: 0x9b6fa8, roughness: 0.5 });
    const bot = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 8, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), shell);
    const top = new THREE.Mesh(new THREE.SphereGeometry(0.45, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), shell);
    top.rotation.x = -0.9;
    top.position.z = -0.3;
    top.position.y = 0.05;
    const mantle = new THREE.Mesh(new THREE.CircleGeometry(0.42, 18), inside);
    mantle.rotation.x = -Math.PI / 2;
    const coin = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 18), new THREE.MeshStandardMaterial({ color: 0xffcf4a, metalness: 1, roughness: 0.25, emissive: 0x664400, emissiveIntensity: 0.8 }));
    coin.position.y = 0.02;
    clam.add(bot, top, mantle, coin);
    clam.position.set(c.x, c.y + 0.1, c.z);
    this.scene.add(clam);
    this.clam = { o: clam, coin, x: c.x, z: c.z, y: c.y };
  }

  addInteractions() {
    const g = this.game;
    const P = this.player;
    const s = () => g.s;
    g.interactables.push({
      pos: this.rack,
      r: 2.2,
      label: () => (s().items.mask ? null : 'Borrow a snorkel mask (free)'),
      act: () => {
        g.give('mask');
        this.ui.toast('+ Snorkel mask and fins. Underwater is crystal clear now, and you can dive much deeper (C).', 'item');
        g.memory('mask', 'Borrowed a snorkel mask from the rack by the dock. Everything underwater is suddenly HD.');
      },
    });
    const deep = (y) => P.swimming && P.underwater && Math.abs(P.pos.y + EYE - y) < 2.2;
    g.interactables.push({
      get pos() {
        return { x: g.adventures.bellPos.x, z: g.adventures.bellPos.z };
      },
      r: 2.2,
      label: () => (deep(this.bellPos.y) && !s().items.bell && !s().flags.bellReturned ? 'Unhook the ship’s bell' : null),
      act: () => {
        g.give('bell');
        this.bell.visible = false;
        this.audio.blip('good');
        this.ui.toast("The bell of The Unsinkable I comes away in your hand, green and heavy. Somebody at the dock should have this.", 'item');
      },
    });
    g.interactables.push({
      pos: this.bottle,
      r: 1.8,
      label: () => (deep(this.bottle.y) && this.bottle.o.visible ? 'Pick up the bottle' : null),
      act: () => {
        this.bottle.o.visible = false;
        g.give('note');
        g.narrate(
          [
            "There's a note inside, in faded ink: 'To whoever finds this. I came to Palmera Cay for a long weekend in 1994. The bartender gave me a diagnosis. I have been happier here than anywhere. Do NOT send help. If my wife asks, I am at the shops. - W.H.'",
          ],
          () => g.memory('bottle', "Found a message in a bottle on the seabed, signed 'W.H.', 1994. Do not send help."),
          0
        );
      },
    });
    g.interactables.push({
      pos: this.clam,
      r: 1.8,
      label: () => (deep(this.clam.y) && this.clam.coin.visible ? 'Take the gold coin from the giant clam' : null),
      act: () => {
        this.clam.coin.visible = false;
        g.give('coin');
        this.ui.toast('+ An old gold coin. The clam closes, very slowly, in what you choose to read as forgiveness.', 'item');
      },
    });
    // Karaoke at the bar: rainy days, and late evenings.
    const B = this.L.bar;
    g.interactables.push({
      pos: B,
      r: 6,
      label: () => {
        const rain = g.weather && g.weather.rain > 0.3;
        const late = s().hour >= 21 && s().hour < 24.5;
        if (!(rain || late) || s().today.karaoke) return null;
        return rain ? 'Start a rainy-day karaoke session' : 'Karaoke night at the bar';
      },
      act: () => g.openDialogue('karaoke'),
    });
  }

  // ------------------------------------------------------------ karaoke
  karaoke(song) {
    const g = this.game;
    g.s.today.karaoke = true;
    const B = this.L.bar;
    const here = (key) => {
      const n = g.npcs[key];
      if (n && n.person.group.visible && Math.hypot(n.pos.x - B.x, n.pos.z - B.z) < 12) return true;
      const e = this.getExtras().find((x) => x.h.role.key === key);
      return !!(e && e.h.group.visible && Math.hypot(e.h.group.position.x - B.x, e.h.group.position.z - B.z) < 14);
    };
    const open = {
      ballad: "You close your eyes for the big opening note of 'Sunburn of Love'. It is not the note. It is near the note. It waves at the note from across the street.",
      disco: "'Out of Office' kicks in with a beat built for people who have just switched off their notifications. You point at the ceiling. The ceiling points back.",
      country: "You give 'Hammock Nights' everything: the twang, the heartbreak, a long verse about a hammock that understood you better than your manager.",
    }[song];
    const cards = [open];
    if (here('dez')) cards.push("Dez harmonises from behind the bar without looking up from the glass he is polishing. It's annoyingly good.");
    if (here('brenda')) cards.push("Brenda times the song with her watch. When it ends, she writes '3:47 - joyful' in her itinerary and underlines it twice.");
    if (here('gary')) cards.push('Gary films it on his laptop, held over his head. It uploads instantly. The rain has given him one bar of signal, finally, for this.');
    if (here('pearl')) cards.push("Nana Pearl heckles every chorus. Then she does the dance break. She has a dance break. Nobody knew there was a dance break.");
    if (here('skye')) cards.push("Skye isn't filming. She's singing along, badly, phone forgotten on the counter.");
    if (here('gordon') || g.s.hour < 23.5) cards.push('From across the resort, faintly, a man in a pool joins in on the last chorus. Gordon.');
    const walt = here('walt') && !g.s.memories.some((m) => m.id === 'walt_sings');
    if (walt) {
      cards.push(
        "Then Walt stands up. Doris says 'Walter.' He says 'Yes, dear,' takes the microphone, and sings the next song in a deep, warm baritone that stops the rain for a second. Nobody speaks. Doris is crying. 'He used to sing in a band,' she whispers. 'In 1994.'"
      );
    }
    cards.push('The rain drums on the thatch. The machine gives you a score of 61. Dez overrides it to 100. "House rules," he says.');
    g.narrate(
      cards,
      () => {
        const m = g.mult('karaoke');
        g.fx({ fun: 22 * m, relax: 8 * m, energy: -4 });
        g.memory('karaoke', 'Sang karaoke at The Salty Coconut while the rain came down. The machine said 61. Dez said 100.');
        if (walt) g.memory('walt_sings', 'Heard Walt Huxley sing. Deep, warm baritone. Doris cried. He used to be in a band, in 1994.');
      },
      0.75
    );
  }

  // ------------------------------------------------------------ sunset cruise
  startCruise() {
    const g = this.game;
    const W = this.world;
    const boat = W.boat;
    if (!boat || this.cruise) return;
    g.s.today.cruise = true;
    g.fx({ credits: -30 });
    // Out from the dock, west along the coast, and back a little further out.
    const home = boat.position.clone();
    const homeYaw = boat.rotation.y;
    // Leave and come back round the east side of the dock's T-shaped end.
    const out1 = new THREE.Vector3(home.x + 7, 0, home.z + 3);
    const out2 = new THREE.Vector3(home.x + 10, 0, home.z + 26);
    const pts = [home.clone(), out1, out2];
    const aStart = Math.atan2(out2.z + 6, out2.x - 6);
    const aEnd = aStart + 1.25;
    const arc = (off, from, to, n, skipFirst = false) => {
      for (let i = skipFirst ? 1 : 0; i <= n; i++) {
        const a = from + ((to - from) * i) / n;
        const s = findShore(0, 0, Math.cos(a), Math.sin(a));
        pts.push(new THREE.Vector3(s.x + Math.cos(a) * off, 0, s.z + Math.sin(a) * off));
      }
    };
    arc(45, aStart, aEnd, 7, true);
    arc(75, aEnd, aStart, 7);
    pts.push(new THREE.Vector3(home.x + 12, 0, home.z + 30), out2.clone().setX(out2.x + 1), out1.clone(), home.clone());
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    const len = curve.getLength();
    this.cruise = { curve, dur: len / 6.5, t: 0, home, homeYaw, len };
    g.busy = true;
    this.player.yaw = boat.rotation.y + Math.PI;
    this.player.pitch = -0.2;
    const d = this.getDolphin();
    if (d) d.escort = boat;
    this.ui.toast('The Unsinkable II pulls away from the dock. The Captain points the bow at the sun.', 'neutral');
  }

  update(dt, t) {
    // Seaweed on the wreck sways a little.
    for (const [i, w] of this.weeds.entries()) w.rotation.z = Math.sin(t * 0.8 + i) * 0.25;
    if (this.clam.coin.visible) this.clam.coin.rotation.y += dt * 0.6;
    const C = this.cruise;
    if (!C) return;
    const boat = this.world.boat;
    C.t += dt;
    const u = Math.min(1, C.t / C.dur);
    // Ease in and out of the dock.
    const e = u < 0.08 ? (u / 0.08) ** 2 * 0.08 : u > 0.92 ? 1 - ((1 - u) / 0.08) ** 2 * 0.08 : u;
    const p = C.curve.getPointAt(Math.min(1, Math.max(0, e)));
    const tan = C.curve.getTangentAt(Math.min(0.999, Math.max(0.001, e)));
    boat.position.x = p.x;
    boat.position.z = p.z;
    const yaw = Math.atan2(tan.x, tan.z);
    let dy = yaw - boat.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    boat.rotation.y += dy * Math.min(1, dt * 2);
    // You sit on the open foredeck, just ahead of the cabin (the bow points
    // along +z), eyes about 1.5 m above the waterline.
    const P = this.player;
    _v.set(0, 0, 0.9).applyAxisAngle(new THREE.Vector3(0, 1, 0), boat.rotation.y);
    P.pos.set(boat.position.x + _v.x, boat.position.y + 1.55 - EYE, boat.position.z + _v.z);
    P.vel.set(0, 0, 0);
    if (u >= 1) this.endCruise();
  }

  endCruise() {
    const C = this.cruise;
    const g = this.game;
    const boat = this.world.boat;
    boat.position.x = C.home.x;
    boat.position.z = C.home.z;
    boat.rotation.y = C.homeYaw;
    this.cruise = null;
    const d = this.getDolphin();
    if (d) d.escort = null;
    const D = this.L.dock;
    this.player.teleport(D.x, D.z1 - 8, this.world.groundAt(D.x, D.z1 - 8), Math.PI);
    g.busy = false;
    const reg = g.s.flags.metReg ? 'Reg' : 'A dolphin';
    g.narrate(
      [
        `The sun slides into the sea off the bow, setting the whole coast on fire: the bungalows, the bar's string lights, the lighthouse on its hill. ${reg} races the boat the whole way, leaping through the gold.`,
        "The Captain cuts the engine and for a minute you just drift. 'Every evening,' he says. 'Thirty years. Never gets old.' He lets you steer home. You go in a perfect circle. He calls it 'textbook.'",
      ],
      () => {
        g.fx({ fun: 16, relax: 20 });
        g.memory('cruise', `Took the Captain's sunset cruise along the coast. ${reg} raced the boat through the gold the whole way.`);
      },
      0
    );
  }
}
