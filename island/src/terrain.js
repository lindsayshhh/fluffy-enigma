import * as THREE from 'three';
import { fbm, smoothstep, valueNoise } from './noise.js';

export const WORLD_SIZE = 720;
export const HILL = { x: 58, z: -48 };

// Shared uniforms so the main loop can animate every shader at once.
export const shared = {
  uTime: { value: 0 },
  uSun: { value: 1 },
  uWet: { value: 0 }, // 0 dry .. 1 soaked after rain
};

// Height of the ground (land or seabed) in metres. Sea level is 0.
export function height(x, z) {
  const ex = x / 150;
  const ez = z / 105;
  const warp = (fbm(x * 0.008 + 3.3, z * 0.008 - 7.1, 3) - 0.5) * 0.26;
  const d = Math.sqrt(ex * ex + ez * ez) + warp;
  const s = 1 - d;
  let h;
  if (s >= 0) {
    const rolling = fbm(x * 0.018 + 11, z * 0.018 + 4, 4);
    h = 3.0 * smoothstep(0, 0.22, s) + 3.2 * smoothstep(0.12, 0.6, s) * rolling;
    const hd = (x - HILL.x) ** 2 + (z - HILL.z) ** 2;
    h += 19 * Math.exp(-hd / (2 * 24 * 24)) * smoothstep(0.02, 0.25, s);
    // Rocky eastern headland.
    h += 6 * smoothstep(0.55, 1, ex) * smoothstep(0.05, 0.3, s) * fbm(x * 0.05, z * 0.05, 3);
  } else {
    // Shallow turquoise shelf, widest along the southern (resort) shore.
    const len = Math.hypot(x, z) || 1;
    const south = smoothstep(-0.3, 0.9, z / len);
    const shelf = 0.1 + 0.22 * south;
    const o = -s;
    if (o < shelf) {
      h = -(o / shelf) * (2.6 + 1.2 * south);
      h -= (valueNoise(x * 0.06, z * 0.06) - 0.5) * 0.6 * smoothstep(0, 0.05, o);
    } else {
      h = -(2.6 + 1.2 * south) - (o - shelf) * 70;
    }
    h = Math.max(h, -32);
  }
  return h;
}

export function slope(x, z) {
  const e = 0.75;
  const dx = height(x + e, z) - height(x - e, z);
  const dz = height(x, z + e) - height(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

// March from a point in a direction until we hit water. Returns the shoreline.
export function findShore(x, z, dx, dz) {
  const l = Math.hypot(dx, dz);
  dx /= l;
  dz /= l;
  for (let i = 0; i < 2000; i++) {
    if (height(x, z) < 0) return { x, z };
    x += dx * 0.25;
    z += dz * 0.25;
  }
  return { x, z };
}

function distToSegment(px, pz, a, b) {
  const vx = b.x - a.x;
  const vz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((px - a.x) * vx + (pz - a.z) * vz) / (vx * vx + vz * vz)));
  return Math.hypot(px - (a.x + vx * t), pz - (a.z + vz * t));
}

export function pathDistance(x, z, paths) {
  let best = Infinity;
  for (const p of paths) {
    for (let i = 0; i < p.length - 1; i++) {
      best = Math.min(best, distToSegment(x, z, p[i], p[i + 1]));
    }
  }
  return best;
}

const C = (hex) => new THREE.Color(hex);
const PAL = {
  deep: C('#9c8a68'),
  underwater: C('#d8c59c'),
  wet: C('#b9a17a'),
  sand: C('#e9d6ad'),
  sandWarm: C('#dcc08e'),
  grass: C('#55712a'),
  grassDry: C('#8a8a42'),
  grassLush: C('#3e6420'),
  dirt: C('#9b7b55'),
  rock: C('#7d766c'),
  rockDark: C('#5a544c'),
};

// layers: optional { sand, wet, grass, rock } -> { map, normal } photo textures.
export function buildTerrain(paths, layers = null) {
  const seg = 340;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const splat = new Float32Array(pos.count * 4);
  const col = new THREE.Color();
  const ref = new THREE.Color();
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);

    const sl = slope(x, z);
    const n = fbm(x * 0.05, z * 0.05, 3);
    const n2 = valueNoise(x * 0.4, z * 0.4);

    let wW = 1 - smoothstep(0.25, 0.95, h);
    let wG = 0;
    let wR = 0;
    if (h < -4) {
      col.copy(PAL.underwater).lerp(PAL.deep, smoothstep(-4, -14, h));
    } else if (h < 0.35) {
      col.copy(PAL.underwater).lerp(PAL.wet, smoothstep(-0.8, 0.2, h));
    } else if (h < 2.3) {
      col.copy(PAL.wet).lerp(PAL.sand, smoothstep(0.35, 0.9, h));
      col.lerp(PAL.sandWarm, n * 0.6);
    } else {
      const g = smoothstep(2.3, 3.4, h);
      col.copy(PAL.sand).lerp(PAL.sandWarm, n);
      tmp.copy(PAL.grass).lerp(PAL.grassDry, smoothstep(0.35, 0.7, n)).lerp(PAL.grassLush, smoothstep(0.5, 0.2, n) * 0.7);
      col.lerp(tmp, g);
      const rock = smoothstep(0.55, 0.9, sl) + smoothstep(15, 22, h) * 0.6;
      tmp.copy(PAL.rock).lerp(PAL.rockDark, n2);
      col.lerp(tmp, Math.min(1, rock));
      wR = Math.min(1, rock);
      wG = g * (1 - wR);
    }
    if (h > 0.9) {
      const pd = pathDistance(x, z, paths);
      if (pd < 2.2) {
        tmp.copy(h < 2.6 ? PAL.sandWarm : PAL.dirt);
        const pw = smoothstep(2.2, 0.9, pd) * 0.85;
        col.lerp(tmp, pw);
        if (h < 2.6) wR *= 1 - pw;
        else wR += wG * pw;
        wG *= 1 - pw;
      }
    }
    // Micro variation so the vertex colours don't look airbrushed.
    col.multiplyScalar(0.94 + n2 * 0.1);
    const wS = Math.max(0, 1 - wW - wG - wR);
    splat.set([wS, wW, wG, wR], i * 4);
    if (layers) {
      // With photo textures the palette becomes a gentle tint relative to each layer.
      ref.setRGB(
        PAL.sand.r * wS + PAL.wet.r * wW + PAL.grass.r * wG + PAL.rock.r * wR,
        PAL.sand.g * wS + PAL.wet.g * wW + PAL.grass.g * wG + PAL.rock.g * wR,
        PAL.sand.b * wS + PAL.wet.b * wW + PAL.grass.b * wG + PAL.rock.b * wR
      );
      col.setRGB(
        THREE.MathUtils.clamp(col.r / ref.r, 0.55, 1.5),
        THREE.MathUtils.clamp(col.g / ref.g, 0.55, 1.5),
        THREE.MathUtils.clamp(col.b / ref.b, 0.55, 1.5)
      );
    }
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aSplat', new THREE.BufferAttribute(splat, 4));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  if (layers) mat.defines = { TEXTURED: '' };
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uSun = shared.uSun;
    shader.uniforms.uWet = shared.uWet;
    if (layers) {
      ['sand', 'wet', 'grass', 'rock'].forEach((k, i) => {
        shader.uniforms[`tD${i}`] = { value: layers[k].map };
        shader.uniforms[`tN${i}`] = { value: layers[k].normal || layers[k].map };
      });
    }
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nattribute vec4 aSplat;\nvarying vec4 vSplat;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvWNormal = normalize(mat3(modelMatrix) * objectNormal);\nvSplat = aSplat;'
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
varying vec3 vWNormal;
varying vec4 vSplat;
#ifdef TEXTURED
uniform sampler2D tD0, tD1, tD2, tD3, tN0, tN1, tN2, tN3;
// Two scales blended so the tiling doesn't show from a distance.
vec4 layer(sampler2D t, vec2 uv) { return mix(texture2D(t, uv), texture2D(t, uv * 0.21 + 0.37), 0.35); }
// Metres per texture tile for sand, wet sand, grass, rock.
const vec4 TILE = vec4(2.6, 3.0, 2.2, 3.5);
#endif
uniform float uTime;
uniform float uSun;
uniform float uWet;
float h21(vec2 p){ p = fract(p*vec2(123.34, 456.21)); p += dot(p, p+45.32); return fract(p.x*p.y); }
float vn(vec2 p){ vec2 i=floor(p); vec2 f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),f.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),f.x), f.y); }
float caustic(vec2 uv, float t){
  vec2 p = mod(uv*6.28318, 6.28318) - 250.0;
  vec2 i = p; float c = 1.0; float inten = 0.005;
  for (int n = 0; n < 4; n++) {
    float tt = t * (1.0 - (3.5 / float(n+1)));
    i = p + vec2(cos(tt - i.x) + sin(tt + i.y), sin(tt - i.y) + cos(tt + i.x));
    c += 1.0/length(vec2(p.x / (sin(i.x+tt)/inten), p.y / (cos(i.y+tt)/inten)));
  }
  c /= 4.0; c = 1.17 - pow(c, 1.4);
  return pow(abs(c), 8.0);
}`
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
#ifdef TEXTURED
vec4 w = vSplat / max(0.001, dot(vSplat, vec4(1.0)));
vec2 p = vWPos.xz;
vec3 alb = vec3(0.0);
// Per-layer grading: bleach the sand toward tropical cream, green up the grass.
if (w.x > 0.01) { vec3 c = layer(tD0, p / TILE.x).rgb; float l = dot(c, vec3(0.3, 0.59, 0.11)); alb += mix(vec3(l), c, 0.6) * vec3(1.75, 1.62, 1.4) * w.x; }
if (w.y > 0.01) alb += layer(tD1, p / TILE.y).rgb * vec3(1.45, 1.38, 1.28) * w.y;
if (w.z > 0.01) alb += layer(tD2, p / TILE.z).rgb * vec3(0.95, 1.42, 0.68) * w.z;
if (w.w > 0.01) alb += layer(tD3, p / TILE.w).rgb * 1.25 * w.w;
diffuseColor.rgb *= alb;
#endif`
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
#ifdef TEXTURED
vec3 nt = vec3(0.0);
if (w.x > 0.01) nt += (layer(tN0, p / TILE.x).xyz * 2.0 - 1.0) * w.x;
if (w.y > 0.01) nt += (layer(tN1, p / TILE.y).xyz * 2.0 - 1.0) * w.y;
if (w.z > 0.01) nt += (layer(tN2, p / TILE.z).xyz * 2.0 - 1.0) * w.z;
if (w.w > 0.01) nt += (layer(tN3, p / TILE.w).xyz * 2.0 - 1.0) * w.w;
vec3 wn = normalize(normalize(vWNormal) + vec3(nt.x, 0.0, nt.y) * 1.1);
normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
#endif`
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
#ifdef TEXTURED
roughnessFactor = dot(w, vec4(0.95, 0.5, 0.95, 0.9));
#endif
// Rain-soaked ground is darker and glossier.
roughnessFactor *= 1.0 - 0.6 * uWet * smoothstep(0.0, 0.5, vWPos.y);`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
#ifndef TEXTURED
float grain = vn(vWPos.xz*3.1)*0.5 + vn(vWPos.xz*11.0)*0.35 + h21(floor(vWPos.xz*40.0))*0.15;
diffuseColor.rgb *= 0.9 + grain*0.18;
#endif
float sub = smoothstep(0.05, -0.6, vWPos.y);
if (sub > 0.0) {
  float c = caustic(vWPos.xz*0.055, uTime*0.55) + caustic(vWPos.xz*0.09 + 3.1, uTime*0.4)*0.6;
  float fade = exp(vWPos.y*0.12);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.93, 0.95), sub);
  diffuseColor.rgb += vec3(0.9, 1.0, 0.95) * min(c, 1.6) * 0.32 * uSun * sub * fade;
}
// Damp sand right at the waterline.
float wet = smoothstep(0.9, 0.15, vWPos.y) * smoothstep(-0.4, 0.1, vWPos.y);
diffuseColor.rgb *= 1.0 - wet*0.22;
diffuseColor.rgb *= 1.0 - uWet * 0.28 * smoothstep(0.0, 0.5, vWPos.y);`
      );
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';

  // Seabed heights for the water shader (depth tint, foam, wave damping).
  const N = 256;
  const data = new Uint16Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1) - 0.5) * WORLD_SIZE;
      const z = (j / (N - 1) - 0.5) * WORLD_SIZE;
      data[j * N + i] = THREE.DataUtils.toHalfFloat(height(x, z));
    }
  }
  const heightTex = new THREE.DataTexture(data, N, N, THREE.RedFormat, THREE.HalfFloatType);
  heightTex.magFilter = THREE.LinearFilter;
  heightTex.minFilter = THREE.LinearFilter;
  heightTex.wrapS = heightTex.wrapT = THREE.ClampToEdgeWrapping;
  heightTex.needsUpdate = true;

  return { mesh, heightTex };
}
