import * as THREE from 'three';
import { computeLayout } from './layout.js';
import { buildTerrain, shared, height } from './terrain.js';
import { buildWater, waterUniforms } from './water.js';
import { SkySystem } from './sky.js';
import { World } from './props.js';
import { makeCast, makeSeagull } from './people.js';
import { Audio } from './audio.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { Game, loadSave, clearSave, newState } from './game.js';
import { smoothstep } from './noise.js';
import { loadAssets, loadLateScenes } from './assets.js';
import { loadHumans, makeHumanCast } from './humans.js';
import { Post } from './post.js';
import { Weather } from './weather.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { CHARACTERS } from './dialogue.js';
import { Dolphin } from './dolphin.js';
import { Wildlife, SPECIES } from './wildlife.js';
import { Pool } from './pool.js';
import { drawMap } from './map.js';
import { Flowers } from './flowers.js';

const TOUCH = isTouchDevice();
if (TOUCH) document.body.classList.add('touch');
let touch = null;
import { findShore } from './terrain.js';

const canvas = document.getElementById('c');
const startBtn = document.getElementById('start');
const contBtn = document.getElementById('continue');
const titleEl = document.getElementById('title');
const pauseEl = document.getElementById('pause');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setClearColor(0x0b1530);

const QUALITY_KEY = 'palmera-cay-quality';
let quality = 'high';
try {
  // Phones and tablets start on the lighter graphics setting.
  quality = localStorage.getItem(QUALITY_KEY) || (TOUCH ? 'low' : 'high');
} catch {
  /* storage unavailable */
}

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0xc4dcef, 0.0016);
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 6000);

const params = new URLSearchParams(location.search);
const step = () => new Promise((r) => requestAnimationFrame(() => r()));
const loadBar = document.querySelector('#loadbar i');
// Status text on the start button, plus overall progress (0..1) on the bar.
const status = (t, f) => {
  startBtn.textContent = t;
  if (loadBar && f !== undefined) loadBar.style.width = `${Math.round(f * 100)}%`;
};

let game;
let player;
let ui;
let audio;
let sky;
let world;
let L;
let started = false;
let water;
let post;
let weather;
let failedNote = null;

function applyQuality(q) {
  quality = q;
  renderer.setPixelRatio(Math.min(devicePixelRatio, q === 'high' ? 1.5 : 1));
  if (post) {
    post.setQuality(q);
    post.setSize(innerWidth, innerHeight);
  }
  if (sky) {
    const size = q === 'high' ? 2048 : 1024;
    sky.sun.shadow.mapSize.set(size, size);
    if (sky.sun.shadow.map) {
      sky.sun.shadow.map.dispose();
      sky.sun.shadow.map = null;
    }
  }
  try {
    localStorage.setItem(QUALITY_KEY, q);
  } catch {
    /* storage unavailable */
  }
}

async function build() {
  status('Unpacking textures…', 0.02);
  const assets = await loadAssets(renderer, (f) => status(`Unpacking textures… ${Math.round(f * 100)}%`, 0.02 + f * 0.38));
  status('Raising the island…', 0.42);
  await step();
  L = computeLayout();
  const T = assets.tex;
  const layers = T.sand_01 && T.damp_beach_sand && T.sparse_grass && T.rock_ground ? { sand: T.sand_01, wet: T.damp_beach_sand, grass: T.sparse_grass, rock: T.rock_ground } : null;
  const terrain = buildTerrain(L.paths, layers);
  scene.add(terrain.mesh);
  water = buildWater(terrain.heightTex);
  scene.add(water);

  status('Painting the sky…', 0.48);
  await step();
  sky = new SkySystem(renderer, scene);
  weather = new Weather(scene);
  applyQuality(quality);

  status('Planting palms…', 0.52);
  await step();
  world = new World(scene, L);
  try {
    pool = new Pool(scene, world, L);
  } catch (e) {
    console.warn('Pool failed to build', e);
  }

  status('Waking up the locals…', 0.6);
  await step();
  const cast = makeCast();
  let extras = [];
  try {
    const humans = await loadHumans((f) => status(`Waking up the locals… ${Math.round(f * 100)}%`, 0.6 + f * 0.38));
    const made = makeHumanCast(humans);
    Object.assign(cast, made.cast);
    extras = made.extras;
  } catch (e) {
    console.warn('Realistic characters failed to load; using the simple ones.', e);
    assets.failed.push('characters');
  }
  setupExtras(extras);
  const gull = makeSeagull();
  scene.add(gull);
  audio = new Audio();
  ui = new UI(audio);
  player = new Player(camera, world, canvas);
  if (TOUCH) {
    player.touchMode = true;
    touch = new TouchControls(player, {
      interact: () => {
        if (!started || game.busy || !player.enabled) return;
        if (photoMode) return snapPhoto();
        if (game.focus()) game.interact();
        else if (player.swimming) {
          // "Climb out" is Space on a keyboard.
          player.touchJump = true;
          setTimeout(() => (player.touchJump = false), 250);
        }
      },
      journal: () => openJournal(),
      camera: () => setPhotoMode(!photoMode),
      pause: () => openPause(),
    });
  }

  if (assets.failed.length) {
    console.warn('Assets that failed to load:', assets.failed);
    failedNote = `Some realistic models couldn't load (${assets.failed.slice(0, 4).join(', ')}${assets.failed.length > 4 ? ', ...' : ''}), so simpler versions are shown.`;
  }

  const saved = loadSave();
  const fresh = () => {
    const g = new Game({ world, cast, gull, ui, audio, player, L, sky, weather, state: newState() });
    return g;
  };
  game = fresh();
  addExtraInteractions(game);
  if (pool) hookPool(game);
  player.teleport(L.spawn.x, L.spawn.z, world.myHut.deckY, -0.7);

  // Debug hooks: ?hour=17.5 starts at a given time, ?at=bar teleports.
  if (params.has('hour')) game.s.hour = parseFloat(params.get('hour'));

  player.onUnlock = () => {
    if (started && !game.busy) {
      if (photoMode) setPhotoMode(false);
      pauseEl.classList.add('show');
    }
  };
  let lastWhistle = 0;
  player.onBounds = () => {
    const now = performance.now();
    if (now - lastWhistle > 6000) {
      lastWhistle = now;
      audio.whistle();
      ui.toast('A lifeguard whistle. From the dock, Captain Lorenzo yells: "Too far, sailor!"', 'neutral');
    }
  };

  status('Start your vacation', 1);
  document.getElementById('loadbar').classList.add('done');
  startBtn.disabled = false;
  if (saved) {
    contBtn.hidden = false;
    contBtn.textContent = `Continue (Day ${saved.day})`;
  }

  startBtn.onclick = () => {
    clearSave();
    begin(false);
  };
  contBtn.onclick = () => {
    Object.assign(game.s, saved);
    game.s.hour = 8;
    begin(true);
  };

  try {
    post = new Post(renderer, scene, camera, { skipAO: [water, sky.sky, sky.clouds, sky.cloudDeck, sky.stars, sky.moonMesh, weather.drops, weather.bow, weather.veil, ...(pool ? [pool.water, pool.under] : [])] });
    applyQuality(quality);
  } catch (e) {
    console.warn('Post-processing unavailable; rendering directly.', e);
    post = null;
  }

  // The animals arrive in the background once everything else is up.
  loadLateScenes().then((a) => {
    try {
      flowers = new Flowers(scene, a, world, L, { lite: TOUCH || quality === 'low' });
    } catch (e) {
      console.warn('Flowers failed to set up', e);
    }
    try {
      wildlife = new Wildlife(scene, a, world, L, { lite: TOUCH || quality === 'low' });
      hookWildlife(game);
    } catch (e) {
      console.warn('Wildlife failed to set up', e);
    }
    if (a.scenes.dolphin) {
      try {
        dolphin = new Dolphin(scene, a.scenes.dolphin, a.clips.dolphin, L);
        addDolphin(game);
      } catch (e) {
        console.warn('Dolphin failed to set up', e);
      }
    }
  });

  window.__palmera = { game, player, world, L, sky, post, weather, extras: () => extraList, dolphin: () => dolphin, wildlife: () => wildlife, pool: () => pool, flowers: () => flowers };
  requestAnimationFrame(loop);
}

function begin(resumed) {
  audio.start();
  titleEl.classList.remove('show');
  document.body.classList.remove('ui-free');
  started = true;
  ui.hud(game.s, game, true);
  if (failedNote) ui.toast(failedNote, 'bad');
  const s = game.s;
  if (resumed) {
    game.narrate([`Day ${s.day}. The sun is already up and so, technically, are you.`], null, 0);
  } else {
    game.narrate(
      [
        'The boat dropped you at Bungalow 7 this morning. Your out-of-office is on. Your phone, unfortunately, is also on.',
        'You have three days on Palmera Cay. The goal: as much fun and as much relaxation as a human body can hold. Ideally at the same time.',
      ],
      null,
      0
    );
  }
}

canvas.addEventListener('click', () => {
  if (started && game && !game.busy && !pauseEl.classList.contains('show')) player.lock();
});
const NAMES = Object.fromEntries(Object.entries(CHARACTERS).map(([k, v]) => [k, v.name]));
function openJournal(tab = 'log') {
  if (!started || game.busy) return;
  if (photoMode) setPhotoMode(false);
  game.busy = true;
  player.unlock();
  ui.journal(
    game.journal(),
    game.s,
    () => {
      game.busy = false;
      player.lock();
    },
    { tab, photos, drawMap: (c) => drawMap(c, { L, game, player, extras: extraList, dolphin, names: NAMES }) }
  );
}

// ---------------------------------------------------------------- camera
let photoMode = false;
const photos = [];
function setPhotoMode(on) {
  if (on && (!started || game.busy || !player.enabled)) return;
  photoMode = on;
  document.body.classList.toggle('photo', on);
}

// Who or what is in the middle of the frame?
const _pv = new THREE.Vector3();
function photoSubject() {
  const cands = [];
  for (const [key, n] of Object.entries(game.npcs)) if (n.person.group.visible) cands.push({ key, name: NAMES[key], pos: _pv.set(n.pos.x, n.pos.y + 1.4, n.pos.z).clone(), range: 30 });
  for (const e of extraList) {
    if (!e.h.group.visible) continue;
    const key = e.h.role.key;
    const p = e.h.group.position;
    cands.push({ key: key || 'stranger', name: NAMES[key] || 'a stranger having the time of her life', pos: new THREE.Vector3(p.x, p.y + 1.4, p.z), range: 30 });
  }
  if (dolphin) cands.push({ key: 'reg', name: game.s.flags.metReg ? 'Reg' : 'a dolphin', pos: dolphin.head(new THREE.Vector3()), range: 35 });
  if (game.gull && game.gull.visible) cands.push({ key: 'kevin', name: 'Kevin the seagull', pos: game.gull.getWorldPosition(new THREE.Vector3()), range: 25 });
  if (wildlife) {
    for (const a of wildlife.list) {
      const o = a.key === 'turtle' ? world.turtle : a.c.obj;
      if (!o.visible && a.key !== 'turtle') continue;
      const small = a.key === 'fiddler' || a.key === 'hermit' || a.key === 'butterfly';
      cands.push({ key: a.key, name: a.key === 'gulls' ? 'seagulls over the beach' : `a ${SPECIES[a.key].label}`, pos: o.getWorldPosition(new THREE.Vector3()), range: small ? 8 : a.key === 'gulls' ? 60 : 30 });
    }
  }
  let best = null;
  let bestScore = Infinity;
  for (const c of cands) {
    const d = c.pos.distanceTo(camera.position);
    if (d > c.range) continue;
    const v = c.pos.clone().project(camera);
    if (v.z > 1 || Math.abs(v.x) > 0.8 || Math.abs(v.y) > 0.85) continue;
    const score = d * (1 + Math.abs(v.x) + Math.abs(v.y));
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}

function snapPhoto() {
  if (!photoMode || game.busy) return;
  const hour = game.s.hour % 24;
  if (post) post.render(0, t, { focus: null, underwater: player.underwater });
  else renderer.render(scene, camera);
  let full;
  try {
    full = canvas.toDataURL('image/jpeg', 0.9);
  } catch (e) {
    console.warn('Could not capture the photo', e);
    return;
  }
  const subj = photoSubject();
  const when = hour >= 17.3 && hour < 19.3 ? ' at golden hour' : hour >= 19.3 || hour < 5.5 ? ' at night' : '';
  let caption;
  if (subj) caption = `${subj.name[0].toUpperCase()}${subj.name.slice(1)}${when}, day ${game.s.day}`;
  else if (pool && pool.onDeck(player.pos.x, player.pos.z)) caption = `The pool${when}, day ${game.s.day}`;
  else caption = hour >= 17.3 && hour < 19.3 ? `Sunset over Palmera Cay, day ${game.s.day}` : hour >= 19.3 || hour < 5.5 ? `Palmera Cay by night, day ${game.s.day}` : `Palmera Cay, day ${game.s.day}`;
  // A small copy for the album.
  const img = new Image();
  const photo = { full, thumb: full, caption, subject: subj ? subj.key : null, n: photos.length + 1 };
  img.onload = () => {
    const c = document.createElement('canvas');
    c.width = 480;
    c.height = Math.round((480 * img.height) / img.width);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    photo.thumb = c.toDataURL('image/jpeg', 0.75);
  };
  img.src = full;
  photos.push(photo);
  if (photos.length > 24) photos.shift().full = null;
  game.photos = photos;
  ui.flash();
  audio.shutter();
  // Something new for the album?
  const seen = (game.s.photoSubjects = game.s.photoSubjects || {});
  if (subj && !seen[subj.key]) {
    seen[subj.key] = true;
    game.fx({ fun: 4, relax: 2 });
    const n = Object.keys(seen).length;
    if (n >= 6) game.memory('photographer', `Filled a holiday album: ${n} different subjects, from ${photos.find((p) => p.subject).caption.split(',')[0].toLowerCase()} onwards.`);
  }
  game.busy = true;
  player.unlock();
  setTimeout(
    () =>
      ui.photoCard(photo, (again) => {
        game.busy = false;
        player.lock();
        if (!again) setPhotoMode(false);
      }),
    250
  );
}

canvas.addEventListener('mousedown', (e) => {
  if (photoMode && player.locked && e.button === 0) snapPhoto();
});

function openPause() {
  if (!started || game.busy) return;
  player.unlock();
  pauseEl.classList.add('show');
}

document.getElementById('resume').onclick = () => {
  pauseEl.classList.remove('show');
  player.lock();
};
const qSel = document.getElementById('quality');
qSel.value = quality;
qSel.onchange = () => applyQuality(qSel.value);
document.getElementById('volume').oninput = (e) => audio && audio.setVolume(parseFloat(e.target.value));

addEventListener('keydown', (e) => {
  if (!started || !game) return;
  if (e.code === 'Tab') e.preventDefault();
  if (game.busy || !player.enabled) return;
  if (e.code === 'KeyE') game.interact();
  if (e.code === 'KeyJ') openJournal();
  if (e.code === 'KeyM') openJournal('map');
  if (e.code === 'KeyP') setPhotoMode(!photoMode);
  if (e.code === 'Enter' && photoMode) snapPhoto();
  if (e.code === 'KeyH') document.body.classList.toggle('ui-free');
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  if (post) post.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
let t = 0;
const fogDay = new THREE.Color();
const fogWater = new THREE.Color('#0d5560');

function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  t += dt;
  shared.uTime.value = t;

  if (started) {
    player.update(dt, t);
    game.update(dt, t);
    if (wildlife) wildlife.update(dt, t, { player, hour: game.s.hour % 24, rain: weather.rain, camera });
    if (flowers) flowers.update(t, camera);
    if (pool) {
      const party = game.poolPartyActive();
      pool.setParty(party);
      pool.update(dt, t, player, sky.sun.intensity);
      if (!party) checkPoolRunning(t);
      else if (pool.onDeck(player.pos.x, player.pos.z) || pool.inPool(player.pos.x, player.pos.z)) {
        partyTime += dt;
        if (partyTime > 20 && !game.s.memories.some((m) => m.id === 'pool_dance')) {
          game.fx({ fun: 12, relax: 6 });
          ui.toast('Doris grabs your hand and pulls you into the dancing. Walt, it turns out, can really move.', 'good');
          game.memory('pool_dance', 'Danced at the pool party under the coloured lights. Walt, it turns out, can really move.');
        }
      }
    }
    if (dolphin) {
      const talkingReg = game.talking === 'reg';
      dolphin.setStage(game.bonfireActive() ? L.bonfire : null);
      dolphin.update(dt, t, { player, hour: game.s.hour % 24, talking: talkingReg, speaking: talkingReg && ui.typing });
      if (talkingReg && ui.typing && t - lastClick > 0.22) {
        lastClick = t;
        audio.dolphin();
      }
    }
    game.keepPlayerOut(extraList.map((e) => e.h.group));
    player.syncCamera(t);
    const f = game.focus();
    const climb = !f && player.enabled && !game.busy && player.swimming && world.platformNear(player.pos.x, player.pos.z, 0.9);
    if (touch) {
      // On touch screens the action button carries the prompt.
      ui.prompt(null);
      touch.update(photoMode ? 'Take photo' : f && player.enabled ? f.label : climb ? 'Climb out' : null, !game.busy && player.enabled);
    } else if (f && player.enabled) ui.prompt(f.label);
    else if (climb) ui.prompt('Climb out', 'Space');
    else ui.prompt(null);
    ui.hud(game.s, game);
  } else {
    // Title-screen flyover.
    const a = t * 0.04 + 2.2;
    camera.position.set(Math.cos(a) * 210, 34 + Math.sin(t * 0.1) * 4, Math.sin(a) * 170 + 40);
    camera.lookAt(0, 4, 30);
    if (game) game.updateNPCs(dt, t);
  }

  const hour = game ? game.s.hour : 9.5;
  const focus = started ? player.pos : new THREE.Vector3(0, 0, 40);
  weather.update(dt, t, game ? game.s.day : 1, hour % 24, camera, sky.dir);
  sky.update(hour % 24, focus, dt, weather.rain);
  shared.uWet.value = weather.wet;
  weather.setOvercastColor(sky.state.fog);
  const st = sky.state;
  const night = 1 - smoothstep(-6, 4, sky.elevation);
  shared.uSun.value = Math.min(1.2, st.sunI / 3);

  const under = started && player.underwater;
  ui && ui.setUnderwater(under);
  fogDay.copy(st.fog);
  scene.fog.color.copy(under ? fogWater : fogDay);
  scene.fog.density = under ? 0.075 : 0.0014 + night * 0.002 + weather.rain * 0.006;

  const wu = waterUniforms;
  wu.uSunDir.value.copy(sky.dir);
  wu.uSunColor.value.copy(st.sun).multiplyScalar(Math.min(1, st.sunI / 2));
  wu.uZenith.value.copy(st.zen);
  wu.uHorizon.value.copy(st.hor);
  wu.uFogColor.value.copy(scene.fog.color);
  wu.uFogDensity.value = scene.fog.density;
  wu.uAmbient.value = 0.35 + 0.65 * (1 - night);
  wu.uRain.value = weather.rain;
  wu.uGlow.value = smoothstep(0.5, 0.95, night);
  if (started) {
    wu.uPlayer.value.copy(player.pos);
    const churn = player.kayak ? Math.abs(player.boatSpeed) / 3 : player.swimming ? Math.hypot(player.vel.x, player.vel.z) / 1.5 + 0.55 : 0;
    wu.uStir.value = THREE.MathUtils.damp(wu.uStir.value, Math.min(1, churn), 4, dt);
  }
  for (const m of water.children) {
    // Each mesh has its own uniform object for uOuter; the rest are shared references.
    m.material.uniforms.uFogDensity.value = scene.fog.density;
  }

  world.update(t, dt, night, started && player.swimming ? player.camera.position : null);
  updateExtras(dt, t, hour % 24);

  if (audio && started) {
    const p = player.pos;
    const h = height(p.x, p.z);
    audio.update(dt, {
      shore: player.swimming ? 0 : Math.max(0, h * 8),
      underwater: under,
      night: night > 0.5,
      barDist: Math.hypot(p.x - L.bar.x, p.z - L.bar.z),
      partyDist: L.pool ? Math.hypot(p.x - L.pool.x, p.z - L.pool.z) : Infinity,
      party: !!game && game.poolPartyActive(),
      wind: Math.min(1, Math.max(0, (p.y - 3) / 18)),
      hour,
      rain: weather.rain,
      underRoof: world.underRoof(p.x, p.z),
    });
  }

  let dof = null;
  if (started && game.talking) {
    const ex = extraList.find((e) => e.h.role.key === game.talking);
    const n = game.npcs[game.talking] ? game.npcs[game.talking].pos : ex && ex.h.group.position;
    if (n) dof = camera.position.distanceTo(_head.set(n.x, n.y + 1.6, n.z));
    else if (game.talking === 'reg' && dolphin) dof = camera.position.distanceTo(dolphin.head(_head));
  }
  if (post) {
    post.setSun(sky.dir, sky.elevation, st.sun, under);
    post.render(dt, t, { focus: dof, underwater: under });
  }
  else renderer.render(scene, camera);
}
const _head = new THREE.Vector3();

build().catch((err) => {
  console.error(err);
  status('Something went wrong building the island');
  const p = document.createElement('pre');
  p.style.cssText = 'white-space:pre-wrap;color:#fbb;font-size:12px;text-align:left;max-width:640px';
  p.textContent = String(err && err.stack ? err.stack : err);
  document.querySelector('#title .inner').appendChild(p);
});

// Background beachgoers: they don't talk, they just vacation.
let extraList = [];
function setupExtras(extras) {
  const spots = [
    () => {
      const l = L.loungers[1];
      return { day: { x: l.x + 1.5, z: l.z + 4, face: 0 }, hours: [9, 19.5] };
    },
    () => {
      const s = findShore(4, 0, 0, 1);
      return { day: { x: s.x, z: s.z + 2.5, face: 0.2 }, hours: [9, 18.5] };
    },
    () => {
      const l = L.loungers[6];
      return { day: { x: l.x - 1.5, z: l.z + 3.5, face: -0.4 }, night: { x: L.bar.x - 8.5, z: L.bar.z + 6, face: 0.8 }, hours: [9, 24.5] };
    },
  ];
  // The pool crowd stand where pool.js says, at their own hours.
  const poolHours = { chad: [9, 18], gordon: [7, 23.5], doris: [7, 17], walt: [7, 17] };
  const byKey = { skye: spots[0] };
  extraList = extras
    .map((h, i) => {
      const key = h.role.key;
      let cfg;
      if (key && poolHours[key]) {
        if (!pool) return null;
        cfg = { day: pool.spots[key], hours: poolHours[key], rainproof: key === 'gordon' };
      } else if (byKey[key]) cfg = byKey[key]();
      else cfg = spots[2]();
      scene.add(h.group);
      return { h, cfg };
    })
    .filter(Boolean);
}

// Standing places round the outside of the bonfire circle.
const BONFIRE_RING = { skye: 0.55, chad: 1.6, doris: 2.4, walt: 2.75, gordon: 3.7 };
function bonfireSpot(key) {
  const a = BONFIRE_RING[key] + Math.PI;
  const B = L.bonfire;
  return { x: B.x + Math.cos(a) * 4.6, z: B.z + Math.sin(a) * 4.6, face: Math.atan2(-Math.cos(a), -Math.sin(a)) };
}

// The pool: slide, cannonballs, the flamingo, loungers, and Chad's whistle.
let pool = null;
let poolWhistle = 0;
let partyTime = 0;
function hookPool(g) {
  g.pool = pool;
  const P = pool;
  const chadHere = () => extraList.some((e) => e.h.role.key === 'chad' && e.h.group.visible);
  g.interactables.push({
    pos: P.slideBase,
    r: 2.2,
    y: P.deck,
    label: () => 'Ride the water slide',
    act: () => {
      g.busy = true;
      audio.blip('good');
      P.startSlide(player, () => {
        g.busy = false;
        audio.splash(true);
        const m = g.mult('slide');
        g.fx({ fun: 16 * m, relax: 2 * m, energy: -3 });
        ui.toast(['WHEEEEEEEE. You shoot out of the bottom of the slide and hit the water like a happy torpedo.', 'Faster this time. You might have screamed. Gordon gives you a thumbs up.', 'You go down backwards. It is a mistake. It is also wonderful.'][g.counter('slideLine') % 3], 'good');
        g.memory('slide', 'Went down the water slide and screamed the whole way. Gordon gave it a ten.');
      });
    },
  });
  g.interactables.push({
    pos: { x: P.board.x0 - 0.4, z: P.board.z },
    r: 1.8,
    y: P.deck,
    label: () => (g.poolPartyActive() && !g.s.memories.some((m) => m.id === 'pool_party') ? 'Enter the cannonball contest!' : 'Cannonball off the diving board!'),
    act: () => {
      g.busy = true;
      P.startCannonball(player, () => {
        g.busy = false;
        audio.splash(true);
        const m = g.mult('cannonball');
        g.fx({ fun: 14 * m, energy: -3 });
        if (g.poolPartyActive() && !g.s.memories.some((m) => m.id === 'pool_party')) {
          g.fx({ fun: 18, relax: 6 });
          ui.toast('SPLOOSH. The judges confer. Chad: 9.5. And Doris... holds up a FOUR. The deck goes silent. Then the whole party goes wild. Gordon spills his drink.', 'good');
          g.memory('pool_party', 'Won the pool party cannonball contest. Doris gave you a 4, the highest score in recorded history.');
        } else if (chadHere()) {
          const a = (6 + Math.random() * 3.5).toFixed(1);
          const b = (6 + Math.random() * 3.5).toFixed(1);
          const doris = Math.random() < 0.15 ? 4 : Math.floor(1 + Math.random() * 3);
          ui.toast(`SPLOOSH. Chad holds up scorecards: ${a}, ${b}, and a ${doris} from Doris, who got wet.`, 'good');
          g.memory('cannonball', `Did a cannonball off the diving board. Chad scored it ${a} and ${b}. Doris gave it a ${doris}.`);
        } else {
          ui.toast('SPLOOSH. A perfect cannonball, witnessed by nobody. The best kind.', 'good');
          g.memory('cannonball', 'Did a cannonball off the diving board. Nobody saw. It was perfect.');
        }
      });
    },
  });
  const flam = P.floaties[0];
  g.interactables.push({
    get pos() {
      return flam.o.position;
    },
    r: 1.9,
    label: () => (player.swimming ? 'Flop onto the inflatable flamingo' : null),
    act: () => {
      const m = g.mult('flamingo');
      g.narrate(
        [['You haul yourself onto the flamingo with all the grace of a walrus climbing a bouncy castle. It squeaks. You float. The flamingo stares at the sky with you.', 'The flamingo spins you slowly in a circle. Every few turns the slide comes into view, then Chad, then the sea. It feels like a very slow, very good fairground ride.'][g.counter('flamingo') % 2]],
        () => {
          g.fx({ relax: 16 * m, fun: 8 * m });
          g.memory('flamingo', 'Floated around the pool on an inflatable flamingo. Did not fall off. Mostly.');
        },
        0.5
      );
    },
  });
  for (const l of P.loungers) {
    g.interactables.push({
      pos: l,
      r: 1.6,
      y: P.deck,
      label: () => (l.reserved && !g.s.flags.towelPeace ? 'Lie on a reserved lounger' : 'Lounge by the pool'),
      act: () => {
        if (l.reserved && !g.s.flags.towelPeace) {
          ui.toast("Walt appears out of nowhere. 'That one's reserved,' he says quietly. He doesn't look happy about it either.", 'neutral');
          return;
        }
        const m = g.mult('poolLounge');
        g.narrate([["You stretch out by the pool. Somewhere, a cannonball. Somewhere else, Chad's whistle. Neither of them is your problem.", 'Sun, a breeze, the smell of chlorine and coconut sunscreen. Gordon is humming. You doze off for a bit.'][g.counter('poolLounge') % 2]], () => g.fx({ relax: 14 * m, fun: 3 * m, energy: 6 }), 1);
      },
    });
  }
}

// Chad doesn't allow running on his deck.
function checkPoolRunning(t) {
  if (!pool || !player.running || player.swimming || !pool.onDeck(player.pos.x, player.pos.z)) return;
  if (Math.abs(player.pos.y - pool.deck) > 0.5 || t - poolWhistle < 15) return;
  if (!extraList.some((e) => e.h.role.key === 'chad' && e.h.group.visible)) return;
  poolWhistle = t;
  audio.whistle();
  ui.toast(["Chad: *FWEEEEP* 'WALK! This is a pool, not a marathon!'", "Chad: *FWEEEEP* 'Running is for people being chased by bears. Do you see a bear?'", "Chad: *FWEEEEP* 'That's a warning! Next time it's a stern look!'"][Math.floor(Math.random() * 3)], 'neutral');
}
// Wildlife: a toast the first time you spot each species; a memory for all.
let wildlife = null;
let flowers = null;
function hookWildlife(g) {
  wildlife.getSpotted = () => (g.s.spotted = g.s.spotted || {});
  wildlife.onCry = (kind) => (kind === 'macaw' ? audio.macaw() : audio.gull());
  wildlife.onSpot = (key) => {
    ui.toast(SPECIES[key].spot, 'item');
    g.fx({ fun: 3, relax: 3 });
    const seen = Object.keys(g.s.spotted).filter((k) => SPECIES[k]).length;
    if (seen >= Object.keys(SPECIES).length) g.memory('naturalist', 'Spotted every kind of wildlife on Palmera Cay, from fiddler crabs to macaws. David Attenborough would be proud. Or at least polite.');
  };
}

// Reg the dolphin: talkable when he's come over and is waiting at the surface.
let dolphin = null;
let lastClick = 0;
function addDolphin(g) {
  g.dolphin = dolphin;
  dolphin.onSplash = (big) => audio.splash(big);
  dolphin.onTowDone = () => {
    const m = g.mult('regTow');
    g.fx({ fun: 18 * m, relax: 6 * m, energy: -4 });
    ui.toast('Reg lets you go with a flick of his tail. You are grinning so hard your face hurts.', 'good');
    g.memory('reg_tow', "Held on to a dolphin's fin and got towed right round the bay. Reg said it counts as cardio.");
  };
  g.interactables.push({
    kind: 'npc',
    key: 'reg',
    r: 4.2,
    get pos() {
      return dolphin.pos;
    },
    visible: () => dolphin.state === 'wait' && !dolphin.trick && !dolphin.tow,
    label: () => (g.s.flags.metReg ? 'Talk to Reg' : 'Say hello to the dolphin'),
    act: () => g.openDialogue('reg'),
  });
}

// Beachgoers with something to say (only Skye, for now) become talkable.
function addExtraInteractions(g) {
  for (const e of extraList) {
    const key = e.h.role.key;
    if (!key || !CHARACTERS[key]) continue;
    g.interactables.push({
      kind: 'npc',
      key,
      r: 2.6,
      get pos() {
        return e.h.group.position;
      },
      visible: () => e.h.group.visible,
      label: () => `Talk to ${CHARACTERS[key].name.split(' ')[0]}`,
      act: () => g.openDialogue(key),
    });
  }
}

function updateExtras(dt, t, hour) {
  for (const { h, cfg } of extraList) {
    // Beachgoers head indoors when it rains.
    const atParty = game && game.poolPartyActive() && pool && pool.partySpots[h.role.key];
    const on = (hour >= cfg.hours[0] && hour < cfg.hours[1] && (weather.rain < 0.3 || cfg.rainproof)) || !!atParty || (game && game.bonfireActive() && BONFIRE_RING[h.role.key] !== undefined && (h.role.key !== 'gordon' || game.s.memories.some((m) => m.id === 'gordon')));
    h.group.visible = on;
    if (!on) continue;
    const evening = cfg.night && hour >= 19;
    let spot = evening ? cfg.night : cfg.day;
    // The last night: everyone you've met comes to the bonfire (Gordon only
    // if you got him to relax enough to leave the pool).
    const key = h.role.key;
    const atFire = game && game.bonfireActive() && BONFIRE_RING[key] !== undefined && (key !== 'gordon' || game.s.memories.some((m) => m.id === 'gordon'));
    if (atFire) spot = bonfireSpot(key);
    else if (atParty) spot = atParty;
    h.group.position.set(spot.x, world.groundAt(spot.x, spot.z), spot.z);
    const talking = !!game && game.talking === h.role.key && !!h.role.key;
    // Face whoever she's talking to; otherwise drift back to her own view.
    const want = talking ? Math.atan2(player.pos.x - spot.x, player.pos.z - spot.z) : spot.face;
    let dy = want - h.group.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    h.group.rotation.y += dy * Math.min(1, dt * (talking ? 5 : 1.5));
    h.pose = (evening && h.role.evening) || (atParty && ['doris', 'walt', 'partygirl', 'gordon'].includes(key)) ? 'dance' : null;
    // Skye takes selfies on and off, until someone talks her out of it.
    if (h.role.selfie && !talking && !(game && game.s.flags.skyePhoneDown) && (t + 3) % 19 < 11) h.pose = 'laptop';
    const near = started && Math.hypot(player.pos.x - spot.x, player.pos.z - spot.z) < 7;
    const far = Math.hypot(player.pos.x - spot.x, player.pos.z - spot.z) > 75;
    h.update(dt, t, { look: near ? player.pos : null, talking, speaking: talking && ui.typing, far: far && !talking });
  }
}
