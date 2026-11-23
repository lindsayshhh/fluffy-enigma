import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { smoothstep, lerp, rng } from './noise.js';

// Colour keys by solar elevation (degrees).
const KEYS = [
  { el: -18, sun: '#000000', sunI: 0, sky: '#0b1430', ground: '#05070c', hemiI: 0.18, zen: '#02050f', hor: '#0b1530', fog: '#0a1226', exp: 0.6 },
  { el: -6, sun: '#ff6a3a', sunI: 0, sky: '#243457', ground: '#14100e', hemiI: 0.3, zen: '#0c1a3c', hor: '#5a4a64', fog: '#3a3a55', exp: 0.55 },
  { el: 0, sun: '#ff7b3d', sunI: 0.6, sky: '#7a7fae', ground: '#3a2a20', hemiI: 0.55, zen: '#24467e', hor: '#ff9b62', fog: '#d6977a', exp: 0.5 },
  { el: 8, sun: '#ffa45c', sunI: 2.6, sky: '#9cc0e8', ground: '#6b5a40', hemiI: 0.55, zen: '#2f6cc0', hor: '#f5c79a', fog: '#e4c6a6', exp: 0.5 },
  { el: 25, sun: '#fff0d8', sunI: 3.5, sky: '#a9d0f5', ground: '#8a7a5a', hemiI: 0.6, zen: '#2a6fd0', hor: '#bfdaf0', fog: '#c4dcef', exp: 0.5 },
  { el: 90, sun: '#fffaf0', sunI: 3.8, sky: '#b5d8fa', ground: '#9a8a66', hemiI: 0.65, zen: '#1f63c9', hor: '#c9e2f5', fog: '#cde3f3', exp: 0.48 },
];
const cache = KEYS.map((k) => ({
  ...k,
  sun: new THREE.Color(k.sun),
  sky: new THREE.Color(k.sky),
  ground: new THREE.Color(k.ground),
  zen: new THREE.Color(k.zen),
  hor: new THREE.Color(k.hor),
  fog: new THREE.Color(k.fog),
}));

function sample(el) {
  let i = 0;
  while (i < cache.length - 2 && el > cache[i + 1].el) i++;
  const a = cache[i];
  const b = cache[i + 1];
  const t = smoothstep(a.el, b.el, el);
  const out = {};
  for (const key of ['sun', 'sky', 'ground', 'zen', 'hor', 'fog']) out[key] = a[key].clone().lerp(b[key], t);
  for (const key of ['sunI', 'hemiI', 'exp']) out[key] = lerp(a[key], b[key], t);
  return out;
}

function cloudTexture(seed) {
  const r = rng(seed);
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 38; i++) {
    const x = 40 + r() * 176;
    const y = 50 + r() * 40 - (Math.abs(x - 128) < 60 ? r() * 25 : 0);
    const rad = 14 + r() * 30;
    const grad = g.createRadialGradient(x, y, 0, x, y, rad);
    const shade = Math.min(255, 200 + Math.floor((110 - y) * 0.9) + Math.floor(r() * 20));
    grad.addColorStop(0, `rgba(${shade},${shade},${Math.min(255, shade + 4)},0.6)`);
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, rad, 0, Math.PI * 2);
    g.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class SkySystem {
  constructor(renderer, scene) {
    this.renderer = renderer;
    this.scene = scene;

    this.sky = new Sky();
    this.sky.scale.setScalar(4500);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 2.6;
    u.rayleigh.value = 1.1;
    u.mieCoefficient.value = 0.004;
    u.mieDirectionalG.value = 0.82;
    scene.add(this.sky);

    this.envScene = new THREE.Scene();
    this.envSky = new Sky();
    this.envSky.scale.setScalar(100);
    this.envSky.material.uniforms = u;
    this.envScene.add(this.envSky);
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = null;
    this.lastEnvEl = 999;

    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -60;
    sc.right = 60;
    sc.top = 60;
    sc.bottom = -60;
    sc.near = 1;
    sc.far = 400;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.04;
    scene.add(this.sun, this.sun.target);

    this.moon = new THREE.DirectionalLight(0x8fa8ff, 0.0);
    scene.add(this.moon, this.moon.target);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x886644, 1);
    scene.add(this.hemi);

    this.dir = new THREE.Vector3();
    this.state = sample(30);

    this.buildStars();
    this.buildClouds();
    this.clouds.visible = false;
    this.buildCloudDeck();
  }

  buildStars() {
    const r = rng(42);
    const n = 2500;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const th = r() * Math.PI * 2;
      const y = r() * 0.95 + 0.05;
      const rr = Math.sqrt(1 - y * y);
      pos[i * 3] = Math.cos(th) * rr * 4000;
      pos[i * 3 + 1] = y * 4000;
      pos[i * 3 + 2] = Math.sin(th) * rr * 4000;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.starMat = new THREE.PointsMaterial({ color: 0xffffff, size: 2.2, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
    this.stars = new THREE.Points(g, this.starMat);
    this.stars.renderOrder = -1;
    this.scene.add(this.stars);

    const mg = new THREE.SphereGeometry(60, 24, 16);
    this.moonMesh = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0xf1efe6, fog: false, transparent: true }));
    this.scene.add(this.moonMesh);
  }

  // A high cloud deck: one big plane, shaded per pixel from layered noise,
  // lit from the sun's side and drifting with the wind. Replaces the old
  // flat cloud sprites (kept below as this.clouds, hidden, for the sky
  // tint code).
  buildCloudDeck() {
    this.cloudUniforms = {
      uTime: { value: 0 },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Color(1, 1, 1) },
      uSky: { value: new THREE.Color(0.6, 0.75, 0.9) },
      uShade: { value: new THREE.Color(0.55, 0.6, 0.7) },
      uLight: { value: 1 },
      uCover: { value: 0.43 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.cloudUniforms,
      vertexShader: /* glsl */ `
        varying vec3 vW;
        void main() {
          vec4 w = modelMatrix * vec4(position, 1.0);
          vW = w.xyz;
          gl_Position = projectionMatrix * viewMatrix * w;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uLight, uCover;
        uniform vec3 uSunDir, uSunColor, uSky, uShade;
        varying vec3 vW;
        float h(vec2 p) { p = fract(p * vec2(127.1, 311.7)); p += dot(p, p + 34.5); return fract(p.x * p.y); }
        float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
        float fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n(p); p = p * 2.03 + 7.1; a *= 0.5; } return s; }
        float density(vec2 p) {
          vec2 q = p * 0.00055 + vec2(uTime * 0.0035, uTime * 0.0012);
          float d = fbm(q + fbm(q * 0.5) * 0.6);
          return smoothstep(uCover, uCover + 0.16, d);
        }
        void main() {
          vec3 toW = vW - cameraPosition;
          float dist = length(toW);
          vec3 dir = toW / dist;
          float d = density(vW.xz);
          if (d < 0.01) discard;
          // Self-shadowing: how much cloud lies between here and the sun.
          vec2 sunStep = normalize(uSunDir.xz + 1e-4) * 140.0;
          float occ = density(vW.xz + sunStep) * 0.5 + density(vW.xz + sunStep * 2.2) * 0.35;
          float lit = clamp(1.0 - occ * 0.9, 0.15, 1.0);
          // Bright rims when looking toward the sun through thin cloud.
          float silver = pow(max(dot(dir, normalize(uSunDir)), 0.0), 8.0) * (1.0 - d) * 1.5;
          vec3 col = mix(uShade, uSunColor * 1.25, lit) + uSunColor * silver;
          col = mix(col, uSky, 0.15) * uLight;
          // Fade into the haze toward the horizon.
          float horizon = smoothstep(0.02, 0.16, dir.y);
          gl_FragColor = vec4(col, min(1.0, d * 1.25) * horizon * 0.96);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      fog: false,
    });
    this.cloudDeck = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000, 1, 1).rotateX(Math.PI / 2), mat);
    this.cloudDeck.position.y = 900;
    this.cloudDeck.renderOrder = -1;
    this.cloudDeck.frustumCulled = false;
    this.scene.add(this.cloudDeck);
  }

  buildClouds() {
    const r = rng(7);
    this.clouds = new THREE.Group();
    const texes = [1, 2, 3, 4].map((s) => cloudTexture(s * 99));
    this.cloudMats = [];
    for (let i = 0; i < 34; i++) {
      const mat = new THREE.SpriteMaterial({ map: texes[i % 4], transparent: true, depthWrite: false, fog: false, opacity: 0.85 });
      this.cloudMats.push(mat);
      const s = new THREE.Sprite(mat);
      const a = r() * Math.PI * 2;
      const d = 1200 + r() * 2400;
      s.position.set(Math.cos(a) * d, 260 + r() * 420, Math.sin(a) * d);
      const w = 500 + r() * 900;
      s.scale.set(w, w * 0.42, 1);
      s.userData.speed = 1.5 + r() * 2;
      this.clouds.add(s);
    }
    this.scene.add(this.clouds);
  }

  // hour: 0-24 (fractional)
  // rain: 0..1 from the weather. Overcast skies dim the sun, grey the sky
  // and fog, and thicken the cloud deck.
  update(hour, focus, dt, rain = 0) {
    const dayT = (hour - 6.1) / 12.6; // 0 at sunrise, 1 at sunset
    const el = Math.sin(dayT * Math.PI) * 74 * (dayT >= 0 && dayT <= 1 ? 1 : 0.35);
    const elev = THREE.MathUtils.degToRad(el);
    const az = Math.PI * THREE.MathUtils.clamp(dayT, -0.2, 1.2); // east -> south -> west
    this.dir.set(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev) * 0.55 + 0.2).normalize();

    const s = sample(el);
    if (rain > 0) {
      const grey = new THREE.Color(0.55, 0.58, 0.62);
      s.sunI *= 1 - 0.8 * rain;
      s.hemiI *= 1 - 0.3 * rain;
      s.zen.lerp(grey.clone().multiplyScalar(0.8), rain * 0.75);
      s.hor.lerp(grey, rain * 0.75);
      s.fog.lerp(grey.clone().multiplyScalar(s.sunI > 0.3 ? 1 : 0.4), rain * 0.8);
      s.sky.lerp(grey, rain * 0.5);
    }
    this.state = s;
    this.elevation = el;

    this.sky.material.uniforms.sunPosition.value.copy(this.dir).multiplyScalar(450000);
    this.sky.material.uniforms.rayleigh.value = lerp(2.4, 1.1, smoothstep(0, 20, el));
    this.sky.visible = el > -12;

    this.sun.color.copy(s.sun);
    this.sun.intensity = s.sunI;
    this.sun.position.copy(focus).addScaledVector(this.dir, 200);
    this.sun.target.position.copy(focus);
    this.sun.castShadow = el > -1;

    const night = 1 - smoothstep(-10, -2, el);
    this.moon.intensity = 0.35 * night;
    const moonDir = new THREE.Vector3(-this.dir.x, Math.max(0.35, -this.dir.y), -this.dir.z * 0.4 + 0.3).normalize();
    this.moon.position.copy(focus).addScaledVector(moonDir, 200);
    this.moon.target.position.copy(focus);
    this.moonMesh.position.copy(focus).addScaledVector(moonDir, 3800);
    this.moonMesh.material.opacity = smoothstep(-2, -10, el) * 0.95 + 0.05;

    this.hemi.color.copy(s.sky);
    this.hemi.groundColor.copy(s.ground);
    this.hemi.intensity = s.hemiI;

    this.starMat.opacity = night;
    this.stars.position.copy(focus);
    this.stars.rotation.y = hour * 0.02;

    const cloudTint = new THREE.Color(1, 1, 1).lerp(s.sun, 0.45).multiplyScalar(Math.max(0.1, Math.min(1.7, s.sunI / 2 + 0.1)));
    const cu = this.cloudUniforms;
    cu.uTime.value += dt;
    cu.uSunDir.value.copy(this.dir);
    cu.uSunColor.value.copy(s.sun).lerp(new THREE.Color(1, 1, 1), smoothstep(5, 35, el) * 0.6);
    cu.uSky.value.copy(s.hor);
    // Cloud undersides: a soft blue-grey taken from the sky, never muddy.
    cu.uShade.value.copy(s.hor).lerp(s.zen, 0.35).lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(0.82);
    cu.uLight.value = Math.max(0.06, Math.min(1.4, s.sunI / 2.4 + 0.08)) * (1 - rain * 0.35);
    cu.uCover.value = 0.43 - rain * 0.33;
    this.cloudDeck.position.x = focus.x;
    this.cloudDeck.position.z = focus.z;
    for (const sp of this.clouds.children) {
      sp.position.x += sp.userData.speed * dt;
      if (sp.position.x > 3600) sp.position.x = -3600;
      sp.material.color.copy(cloudTint);
    }

    if (this.scene.fog) this.scene.fog.color.copy(s.fog);
    this.renderer.toneMappingExposure = s.exp;

    // Re-bake the environment map when the sun has moved enough to notice.
    if (Math.abs(el - this.lastEnvEl) > 1.5) {
      this.lastEnvEl = el;
      if (this.envRT) this.envRT.dispose();
      this.envRT = this.pmrem.fromScene(this.envScene, 0, 0.1, 1000);
      this.scene.environment = this.envRT.texture;
    }
    this.scene.environmentIntensity = lerp(0.08, 0.42, smoothstep(-8, 15, el));
  }
}
