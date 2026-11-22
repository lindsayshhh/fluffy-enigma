import * as THREE from 'three';
import { fbm, smoothstep, valueNoise } from './noise.js';

export const WORLD_SIZE = 720;
export const HILL = { x: 58, z: -48 };

// Shared uniforms so the main loop can animate every shader at once.
export const shared = {
  uTime: { value: 0 },
  uSun: { value: 1 },
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

export function buildTerrain(paths) {
  const seg = 340;
  const geo = new THREE.PlaneGeometry(WORLD_SIZE, WORLD_SIZE, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const col = new THREE.Color();
  const tmp = new THREE.Color();

  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const z = pos.getZ(i);
    const h = height(x, z);
    pos.setY(i, h);

    const sl = slope(x, z);
    const n = fbm(x * 0.05, z * 0.05, 3);
    const n2 = valueNoise(x * 0.4, z * 0.4);

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
    }
    if (h > 0.9) {
      const pd = pathDistance(x, z, paths);
      if (pd < 2.2) {
        tmp.copy(h < 2.6 ? PAL.sandWarm : PAL.dirt);
        col.lerp(tmp, smoothstep(2.2, 0.9, pd) * 0.85);
      }
    }
    // Micro variation so the vertex colours don't look airbrushed.
    col.multiplyScalar(0.94 + n2 * 0.1);
    colors[i * 3] = col.r;
    colors[i * 3 + 1] = col.g;
    colors[i * 3 + 2] = col.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uSun = shared.uSun;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWPos;
uniform float uTime;
uniform float uSun;
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
        '#include <color_fragment>',
        `#include <color_fragment>
float grain = vn(vWPos.xz*3.1)*0.5 + vn(vWPos.xz*11.0)*0.35 + h21(floor(vWPos.xz*40.0))*0.15;
diffuseColor.rgb *= 0.9 + grain*0.18;
float sub = smoothstep(0.05, -0.6, vWPos.y);
if (sub > 0.0) {
  float c = caustic(vWPos.xz*0.055, uTime*0.55) + caustic(vWPos.xz*0.09 + 3.1, uTime*0.4)*0.6;
  float fade = exp(vWPos.y*0.12);
  diffuseColor.rgb *= mix(vec3(1.0), vec3(0.72, 0.93, 0.95), sub);
  diffuseColor.rgb += vec3(0.9, 1.0, 0.95) * min(c, 1.6) * 0.32 * uSun * sub * fade;
}
// Damp sand right at the waterline.
float wet = smoothstep(0.9, 0.15, vWPos.y) * smoothstep(-0.4, 0.1, vWPos.y);
diffuseColor.rgb *= 1.0 - wet*0.22;`
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
