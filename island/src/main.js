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
import { loadAssets } from './assets.js';
import { loadHumans, makeHumanCast } from './humans.js';
import { Post } from './post.js';
import { Weather } from './weather.js';
import { TouchControls, isTouchDevice } from './touch.js';
import { CHARACTERS } from './dialogue.js';

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
const status = (t) => (startBtn.textContent = t);

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
  status('Unpacking textures…');
  const assets = await loadAssets(renderer, (f) => status(`Unpacking textures… ${Math.round(f * 100)}%`));
  status('Raising the island…');
  await step();
  L = computeLayout();
  const T = assets.tex;
  const layers = T.sand_01 && T.damp_beach_sand && T.sparse_grass && T.rock_ground ? { sand: T.sand_01, wet: T.damp_beach_sand, grass: T.sparse_grass, rock: T.rock_ground } : null;
  const terrain = buildTerrain(L.paths, layers);
  scene.add(terrain.mesh);
  water = buildWater(terrain.heightTex);
  scene.add(water);

  status('Painting the sky…');
  await step();
  sky = new SkySystem(renderer, scene);
  weather = new Weather(scene);
  applyQuality(quality);

  status('Planting palms…');
  await step();
  world = new World(scene, L);

  status('Waking up the locals…');
  await step();
  const cast = makeCast();
  let extras = [];
  try {
    status('Waking up the locals… 0%');
    const humans = await loadHumans((f) => status(`Waking up the locals… ${Math.round(f * 100)}%`));
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
        if (game.focus()) game.interact();
        else if (player.swimming) {
          // "Climb out" is Space on a keyboard.
          player.touchJump = true;
          setTimeout(() => (player.touchJump = false), 250);
        }
      },
      journal: () => openJournal(),
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
  player.teleport(L.spawn.x, L.spawn.z, world.myHut.deckY, -0.7);

  // Debug hooks: ?hour=17.5 starts at a given time, ?at=bar teleports.
  if (params.has('hour')) game.s.hour = parseFloat(params.get('hour'));

  player.onUnlock = () => {
    if (started && !game.busy) {
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

  status('Start your vacation');
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
    post = new Post(renderer, scene, camera, { skipAO: [water, sky.sky, sky.clouds, sky.cloudDeck, sky.stars, sky.moonMesh, weather.drops, weather.bow, weather.veil] });
    applyQuality(quality);
  } catch (e) {
    console.warn('Post-processing unavailable; rendering directly.', e);
    post = null;
  }

  window.__palmera = { game, player, world, L, sky, post, weather, extras: () => extraList };
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
function openJournal() {
  if (!started || game.busy) return;
  game.busy = true;
  player.unlock();
  ui.journal(game.journal(), game.s, () => {
    game.busy = false;
    player.lock();
  });
}

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
    game.keepPlayerOut(extraList.map((e) => e.h.group));
    player.syncCamera(t);
    const f = game.focus();
    const climb = !f && player.enabled && !game.busy && player.swimming && world.platformNear(player.pos.x, player.pos.z, 0.9);
    if (touch) {
      // On touch screens the action button carries the prompt.
      ui.prompt(null);
      touch.update(f && player.enabled ? f.label : climb ? 'Climb out' : null, !game.busy && player.enabled);
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
  extraList = extras.map((h, i) => {
    const cfg = spots[i % spots.length]();
    scene.add(h.group);
    return { h, cfg };
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
    const on = hour >= cfg.hours[0] && hour < cfg.hours[1] && weather.rain < 0.3;
    h.group.visible = on;
    if (!on) continue;
    const evening = cfg.night && hour >= 19;
    const spot = evening ? cfg.night : cfg.day;
    h.group.position.set(spot.x, world.groundAt(spot.x, spot.z), spot.z);
    const talking = !!game && game.talking === h.role.key && !!h.role.key;
    // Face whoever she's talking to; otherwise drift back to her own view.
    const want = talking ? Math.atan2(player.pos.x - spot.x, player.pos.z - spot.z) : spot.face;
    let dy = want - h.group.rotation.y;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    h.group.rotation.y += dy * Math.min(1, dt * (talking ? 5 : 1.5));
    h.pose = evening && h.role.evening ? 'dance' : null;
    // Skye takes selfies on and off, until someone talks her out of it.
    if (h.role.selfie && !talking && !(game && game.s.flags.skyePhoneDown) && (t + 3) % 19 < 11) h.pose = 'laptop';
    const near = started && Math.hypot(player.pos.x - spot.x, player.pos.z - spot.z) < 7;
    h.update(dt, t, { look: near ? player.pos : null, talking, speaking: talking && ui.typing });
  }
}
