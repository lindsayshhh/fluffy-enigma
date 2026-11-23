// Tropical showers and rainbows. The schedule is fixed per day so it's
// predictable (and testable); the last evening stays clear for the bonfire.
import * as THREE from 'three';
import { smoothstep } from './noise.js';

// [start hour, end hour] of each shower, per day of the trip. Rainbows only
// show when the sun is below 42 degrees, so the afternoon showers end late
// enough for one (the midday shower gets none, as in real life).
const SHOWERS = {
  1: [[16.0, 16.7]],
  2: [[10.9, 11.5], [16.3, 17.0]],
  3: [[10.4, 11.1]],
};
const FADE = 0.15; // hours to build up / die away

export function rainAt(day, hour) {
  let r = 0;
  for (const [a, b] of SHOWERS[day] || []) {
    r = Math.max(r, smoothstep(a - FADE, a + FADE, hour) * (1 - smoothstep(b - FADE, b + FADE, hour)));
  }
  return r;
}

// 0..1: a rainbow hangs around for a while after each shower ends.
export function rainbowAt(day, hour) {
  let v = 0;
  for (const [, b] of SHOWERS[day] || []) {
    if (hour > b - 0.05 && hour < b + 0.7) v = Math.max(v, smoothstep(b - 0.05, b + 0.15, hour) * (1 - smoothstep(b + 0.45, b + 0.7, hour)));
  }
  return v;
}

const RAIN_VERT = /* glsl */ `
  attribute float aEnd;
  uniform vec3 uCam;
  uniform float uTime;
  varying float vFade;
  void main() {
    vec3 p = position;
    float box = 36.0;
    // Wrap the drops around the camera so the shower follows the player.
    p.xz = mod(p.xz - uCam.xz + box * 0.5, box) - box * 0.5 + uCam.xz;
    p.y = mod(p.y - uTime * 24.0, 26.0) - 8.0 + uCam.y;
    p += aEnd * vec3(0.12, 0.75, 0.05); // streak length and a little wind slant
    vFade = 1.0 - smoothstep(10.0, 18.0, distance(p.xz, uCam.xz));
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const RAIN_FRAG = /* glsl */ `
  uniform float uRain;
  uniform vec3 uColor;
  varying float vFade;
  void main() { gl_FragColor = vec4(uColor, 0.3 * uRain * vFade); }`;

const BOW_FRAG = /* glsl */ `
  uniform float uAlpha;
  varying float vR;
  varying float vY;
  vec3 spectrum(float x) {
    // red (outer edge) to violet (inner edge)
    return clamp(vec3(
      abs(x * 6.0 - 3.0) - 1.0,
      2.0 - abs(x * 6.0 - 2.0),
      2.0 - abs(x * 6.0 - 4.0)), 0.0, 1.0);
  }
  void main() {
    if (vY < 0.0) discard;
    float across = (vR - 0.955) / 0.045; // 0 inner (violet) .. 1 outer (red)
    float edge = smoothstep(0.0, 0.25, across) * smoothstep(1.0, 0.75, across);
    vec3 c = spectrum((1.0 - across) * 0.78); // hue: red outside to violet inside
    // Additive on an HDR sky (before tone mapping), so it needs real brightness.
    gl_FragColor = vec4(c * edge * uAlpha * 3.5, 1.0);
  }`;
const BOW_VERT = /* glsl */ `
  varying float vR;
  varying float vY;
  void main() {
    vR = length(position.xy);
    vec4 w = modelMatrix * vec4(position, 1.0);
    vY = w.y;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;

export class Weather {
  constructor(scene) {
    this.rain = 0;
    this.wet = 0;
    this.rainbow = 0;

    // Rain streaks: line segments whose positions wrap around the camera.
    const n = 3500;
    const pos = new Float32Array(n * 6);
    const end = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) {
      const x = (Math.random() - 0.5) * 36;
      const y = Math.random() * 26;
      const z = (Math.random() - 0.5) * 36;
      pos.set([x, y, z, x, y, z], i * 6);
      end[i * 2 + 1] = 1;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    this.rainUniforms = { uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uRain: { value: 0 }, uColor: { value: new THREE.Color(0.8, 0.86, 0.95) } };
    this.drops = new THREE.LineSegments(g, new THREE.ShaderMaterial({ uniforms: this.rainUniforms, vertexShader: RAIN_VERT, fragmentShader: RAIN_FRAG, transparent: true, depthWrite: false }));
    this.drops.frustumCulled = false;
    this.drops.visible = false;
    scene.add(this.drops);

    // Overcast veil: a grey dome over the sky (drawn before the cloud deck)
    // so the bright clear-sky backdrop doesn't show at the horizon.
    this.veil = new THREE.Mesh(
      new THREE.SphereGeometry(4000, 32, 16),
      new THREE.MeshBasicMaterial({ color: 0x8a9099, side: THREE.BackSide, transparent: true, opacity: 0, depthWrite: false, fog: false })
    );
    this.veil.renderOrder = -2;
    this.veil.frustumCulled = false;
    scene.add(this.veil);

    // Rainbow: a 42-degree arc around the point directly opposite the sun.
    this.bowUniforms = { uAlpha: { value: 0 } };
    const bowGeo = new THREE.RingGeometry(0.955, 1.0, 160, 1);
    this.bow = new THREE.Mesh(bowGeo, new THREE.ShaderMaterial({ uniforms: this.bowUniforms, vertexShader: BOW_VERT, fragmentShader: BOW_FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, fog: false }));
    this.bow.frustumCulled = false;
    this.bow.visible = false;
    scene.add(this.bow);
  }

  // Match the veil to the (rain-greyed) fog so sky and horizon blend.
  setOvercastColor(c) {
    this.veil.material.color.copy(c);
  }

  update(dt, t, day, hour, camera, sunDir) {
    this.rain = THREE.MathUtils.damp(this.rain, rainAt(day, hour), 2, dt);
    // Surfaces get wet quickly and dry slowly.
    this.wet = THREE.MathUtils.damp(this.wet, this.rain > 0.2 ? 1 : 0, this.rain > 0.2 ? 0.9 : 0.12, dt);
    const sunEl = THREE.MathUtils.radToDeg(Math.asin(Math.max(-1, Math.min(1, sunDir.y))));
    // Needs sun, and a sun low enough for the 42-degree arc to clear the horizon.
    this.rainbow = rainbowAt(day, hour) * smoothstep(3, 12, sunEl) * (1 - smoothstep(30, 40, sunEl));

    const ru = this.rainUniforms;
    ru.uCam.value.copy(camera.position);
    ru.uTime.value = t;
    ru.uRain.value = this.rain;
    this.veil.position.copy(camera.position);
    this.veil.material.opacity = Math.min(0.92, this.rain * 1.1);
    this.veil.visible = this.rain > 0.01;
    this.drops.visible = this.rain > 0.01;

    this.bowUniforms.uAlpha.value = this.rainbow * 0.45;
    this.bow.visible = this.rainbow > 0.01;
    if (this.bow.visible) {
      const anti = sunDir.clone().negate();
      const D = 1500;
      const center = camera.position.clone().addScaledVector(anti, D);
      this.bow.position.copy(center);
      this.bow.scale.setScalar(D * Math.tan(THREE.MathUtils.degToRad(42)));
      this.bow.lookAt(camera.position);
    }
  }
}
