import * as THREE from 'three';
import { WORLD_SIZE, height, shared } from './terrain.js';
import { smoothstep } from './noise.js';

// [dirX, dirZ, amplitude, wavelength]. Speeds come from the deep-water
// dispersion relation so the swell moves like real swell.
const WAVES = [
  [0.28, 1.0, 0.2, 21],
  [-0.55, 1.0, 0.11, 10.5],
  [1.0, 0.45, 0.055, 5.2],
  [-0.9, 0.35, 0.03, 3.3],
].map(([dx, dz, a, l]) => {
  const len = Math.hypot(dx, dz);
  const k = (2 * Math.PI) / l;
  return { dx: dx / len, dz: dz / len, a, k, w: Math.sqrt(9.8 * k) };
});

export const waterUniforms = {
  uTime: shared.uTime,
  uSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uSunColor: { value: new THREE.Color(1, 1, 1) },
  uZenith: { value: new THREE.Color('#3d7fd6') },
  uHorizon: { value: new THREE.Color('#bcd9ef') },
  uFogColor: { value: new THREE.Color('#bcd9ef') },
  uFogDensity: { value: 0.0016 },
  uHeight: { value: null },
  uWorld: { value: WORLD_SIZE },
  uOuter: { value: 0 },
  uAmbient: { value: 1 },
};

export function waveHeight(x, z, t) {
  const depth = Math.max(0, -height(x, z));
  const damp = 0.35 + 0.65 * smoothstep(0, 3, depth);
  let y = 0;
  for (let i = 0; i < 3; i++) {
    const W = WAVES[i];
    y += W.a * Math.sin(W.k * (W.dx * x + W.dz * z) - W.w * t + i * 1.7);
  }
  return y * damp;
}

const waveGLSL = WAVES.map(
  (W, i) => `vec4(${W.dx.toFixed(4)}, ${W.dz.toFixed(4)}, ${W.a.toFixed(4)}, ${W.k.toFixed(4)})`
).join(',\n  ');
const omegaGLSL = WAVES.map((W) => W.w.toFixed(4)).join(', ');

const common = /* glsl */ `
uniform float uTime;
uniform sampler2D uHeight;
uniform float uWorld;
const vec4 WAVES[4] = vec4[4](
  ${waveGLSL}
);
const float OMEGA[4] = float[4](${omegaGLSL});
float seabed(vec2 p) {
  vec2 uv = p / uWorld + 0.5;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -32.0;
  return texture2D(uHeight, uv).r;
}
float hb(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float nb(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(hb(i),hb(i+vec2(1,0)),f.x), mix(hb(i+vec2(0,1)),hb(i+vec2(1,1)),f.x), f.y); }
// Shoreline breakers. x: crest height, y: breaking foam, z: whitewater left behind.
vec3 breakers(vec2 p, float depth) {
  float along = nb(p * 0.035) * 6.0;               // sets stagger along the shore
  float ph = depth * 1.7 + uTime * 0.8 + along;
  float s = sin(ph);
  float grow = smoothstep(3.2, 1.3, depth) * smoothstep(0.05, 0.6, depth);
  float crest = pow(max(s, 0.0), 6.0) * grow;
  float breaking = smoothstep(0.6, 1.0, pow(max(s, 0.0), 3.0)) * smoothstep(1.8, 0.5, depth) * smoothstep(0.02, 0.3, depth);
  float wash = pow(max(sin(ph - 0.9), 0.0), 2.0) * smoothstep(1.3, 0.05, depth);
  return vec3(crest, breaking, wash);
}
// Returns height in x, slope in yz.
vec3 waves(vec2 p, float damp, int count) {
  vec3 r = vec3(0.0);
  for (int i = 0; i < 4; i++) {
    if (i >= count) break;
    vec4 W = WAVES[i];
    float ph = W.w * dot(W.xy, p) - OMEGA[i] * uTime + float(i) * 1.7;
    r.x += W.z * sin(ph);
    r.yz += W.z * W.w * cos(ph) * W.xy;
  }
  return r * damp;
}
`;

const vertexShader = /* glsl */ `
${common}
varying vec3 vWPos;
varying float vDepth;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float depth = max(0.0, -seabed(wp.xz));
  float damp = 0.35 + 0.65 * smoothstep(0.0, 3.0, depth);
  wp.y += waves(wp.xz, damp, 3).x;
  vec3 br = breakers(wp.xz, depth);
  wp.y += br.x * 0.3;
  // Swash: the sea surges a little way up the sand and draws back.
  wp.y += (0.5 + 0.5 * sin(uTime * 0.8 + nb(wp.xz * 0.035) * 6.0 + 1.2)) * 0.1 * smoothstep(0.7, 0.0, depth);
  vWPos = wp.xyz;
  vDepth = depth;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${common}
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uOuter;
uniform float uAmbient;
varying vec3 vWPos;
varying float vDepth;

float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
vec2 ripple(vec2 p) {
  float e = 0.08;
  float a = vn(p); float bx = vn(p + vec2(e, 0.0)); float bz = vn(p + vec2(0.0, e));
  return vec2(bx - a, bz - a) / e;
}

void main() {
  if (uOuter > 0.5 && abs(vWPos.x) < uWorld*0.5 - 4.0 && abs(vWPos.z) < uWorld*0.5 - 4.0) discard;
  float depth = vDepth;
  float damp = 0.35 + 0.65 * smoothstep(0.0, 3.0, depth);
  vec3 w = waves(vWPos.xz, damp, 4);
  vec2 det = ripple(vWPos.xz * 0.9 + vec2(uTime * 0.35, uTime * 0.2)) * 0.06
           + ripple(vWPos.xz * 2.3 - vec2(uTime * 0.25, -uTime * 0.31)) * 0.035;
  vec3 N = normalize(vec3(-w.y - det.x, 1.0, -w.z - det.y));

  vec3 toCam = cameraPosition - vWPos;
  float dist = length(toCam);
  vec3 V = toCam / dist;
  // Far away the ripples average out; flatten to avoid shimmering.
  N = normalize(mix(N, vec3(0.0, 1.0, 0.0), smoothstep(80.0, 600.0, dist) * 0.7));

  float sunUp = clamp(uSunDir.y * 4.0, 0.0, 1.0);
  vec3 col;
  float alpha;

  if (gl_FrontFacing) {
    float ndv = max(dot(N, V), 0.0);
    float fres = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
    vec3 R = reflect(-V, N);
    R.y = abs(R.y);
    vec3 sky = mix(uHorizon, uZenith, pow(clamp(R.y, 0.0, 1.0), 0.45));

    vec3 shallow = vec3(0.16, 0.78, 0.72);
    vec3 mid = vec3(0.02, 0.45, 0.58);
    vec3 deep = vec3(0.0, 0.11, 0.26);
    vec3 body = mix(shallow, mid, smoothstep(0.5, 5.0, depth));
    body = mix(body, deep, smoothstep(4.0, 26.0, depth));
    float light = 0.25 + 0.75 * max(uSunDir.y, 0.0);
    body *= light * uAmbient;
    // Light scattering through wave crests.
    body += vec3(0.05, 0.25, 0.22) * pow(max(dot(V, -uSunDir) * 0.5 + 0.5, 0.0), 3.0) * max(w.x, 0.0) * 2.0 * sunUp;

    float spec = pow(max(dot(R, uSunDir), 0.0), 900.0) * 60.0 + pow(max(dot(R, uSunDir), 0.0), 90.0) * 0.6;
    col = mix(body, sky, fres) + uSunColor * spec * sunUp;

    alpha = mix(0.2, 0.97, 1.0 - exp(-depth * 0.42));
    alpha = max(alpha, fres);

    // Lapping foam at the waterline plus drifting patches.
    float n = vn(vWPos.xz * 1.6 + uTime * 0.3) * vn(vWPos.xz * 0.5 - uTime * 0.1);
    float band = sin(depth * 5.0 - uTime * 1.6) * 0.5 + 0.5;
    float foam = smoothstep(0.3, 0.0, depth) * (0.6 + 0.4 * band);
    foam += smoothstep(0.8, 0.15, depth) * smoothstep(0.7, 0.95, band) * 0.5;
    foam *= smoothstep(0.2, 0.5, n + 0.2);
    vec3 br = breakers(vWPos.xz, depth);
    float churn = vn(vWPos.xz * 0.8 + vec2(uTime * 0.6, 0.0)) * vn(vWPos.xz * 2.7 - uTime * 0.4);
    foam += br.y * smoothstep(0.1, 0.45, churn + 0.15) * 1.2;
    foam += br.z * smoothstep(0.25, 0.6, churn + 0.1) * 0.75;
    foam = clamp(foam, 0.0, 1.0);
    // Light glows through the thin lip of a cresting wave.
    col += vec3(0.04, 0.22, 0.2) * br.x * sunUp * light;
    col = mix(col, vec3(0.92) * light * uAmbient, foam * 0.85);
    alpha = max(alpha, foam * 0.9);
  } else {
    // Seen from below: the bright, wobbly ceiling of the sea.
    float up = max(dot(-N, -V), 0.0);
    col = mix(vec3(0.02, 0.3, 0.36), uHorizon * 1.2, pow(up, 3.0)) * (0.3 + 0.7 * max(uSunDir.y, 0.0));
    alpha = 0.92;
  }

  float fog = 1.0 - exp(-uFogDensity * uFogDensity * dist * dist);
  col = mix(col, uFogColor, fog);
  alpha = mix(alpha, 1.0, fog);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export function buildWater(heightTex) {
  waterUniforms.uHeight.value = heightTex;
  const group = new THREE.Group();

  const mk = (outer) =>
    new THREE.ShaderMaterial({
      uniforms: { ...waterUniforms, uOuter: { value: outer ? 1 : 0 } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

  const inner = new THREE.Mesh(new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, 320, 320).rotateX(-Math.PI / 2), mk(false));
  inner.renderOrder = 10;
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(14000, 14000, 60, 60).rotateX(-Math.PI / 2), mk(true));
  outer.renderOrder = 9;
  outer.position.y = -0.02;
  inner.frustumCulled = false;
  outer.frustumCulled = false;
  group.add(inner, outer);
  return group;
}
