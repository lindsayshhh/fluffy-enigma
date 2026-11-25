// Cinematic post-processing: ambient occlusion, bloom, depth of field during
// conversations, filmic tone mapping and a warm holiday colour grade.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// Runs after tone mapping, in display space.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uAspect: { value: 1 },
    uSaturation: { value: 1.12 },
    uContrast: { value: 1.06 },
    uWarmth: { value: 1 },
    uVignette: { value: 0.3 },
    uGrain: { value: 0.022 },
    uUnder: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime, uAspect, uSaturation, uContrast, uWarmth, uVignette, uGrain, uUnder;
    varying vec2 vUv;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
    void main() {
      vec2 uv = vUv;
      // A gentle wobble underwater.
      uv += uUnder * vec2(sin(uv.y * 30.0 + uTime * 2.0), cos(uv.x * 25.0 + uTime * 1.7)) * 0.0025;
      vec3 c = texture2D(tDiffuse, uv).rgb;
      float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
      c = mix(vec3(l), c, uSaturation);
      c = (c - 0.5) * uContrast + 0.5;
      // Split toning: cool, slightly teal shadows; warm, sunny highlights.
      vec3 shadows = vec3(-0.012, 0.004, 0.018);
      vec3 highlights = vec3(0.03, 0.012, -0.022);
      c += mix(shadows, highlights, smoothstep(0.15, 0.85, l)) * uWarmth;
      vec2 d = (vUv - 0.5) * vec2(uAspect, 1.0);
      float vig = smoothstep(1.05, 0.3, length(d));
      c *= mix(1.0 - uVignette, 1.0, vig);
      c += (hash(vUv * 1000.0 + fract(uTime) * 100.0) - 0.5) * uGrain;
      gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
    }`,
};

// Light shafts: march from each pixel toward the sun on screen and gather
// bright sky that isn't blocked, so light streams through gaps in the palms.
// Runs on the HDR image before tone mapping.
const ShaftShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSun: { value: new THREE.Vector2(0.5, 0.5) },
    uColor: { value: new THREE.Color(1, 0.9, 0.7) },
    uStrength: { value: 0 },
    uThreshold: { value: 1.6 },
  },
  vertexShader: GradeShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uSun;
    uniform vec3 uColor;
    uniform float uStrength, uThreshold;
    varying vec2 vUv;
    void main() {
      vec4 base = texture2D(tDiffuse, vUv);
      if (uStrength <= 0.0) { gl_FragColor = base; return; }
      const int STEPS = 36;
      vec2 delta = (uSun - vUv) * (0.9 / float(STEPS));
      vec2 uv = vUv;
      float decay = 1.0, acc = 0.0;
      for (int i = 0; i < STEPS; i++) {
        uv += delta;
        vec3 c = texture2D(tDiffuse, clamp(uv, 0.0, 1.0)).rgb;
        acc += max(dot(c, vec3(0.2126, 0.7152, 0.0722)) - uThreshold, 0.0) * decay;
        decay *= 0.955;
      }
      float shafts = acc / float(STEPS);
      // Weaker far from the sun on screen.
      shafts *= smoothstep(1.2, 0.0, length(uSun - vUv));
      gl_FragColor = vec4(base.rgb + uColor * shafts * uStrength, base.a);
    }`,
};

// Ambient occlusion that ignores the (transparent) sea surface and the sky,
// and cut-out foliage: the AO pass draws leaves as solid cards (it ignores
// alphaTest), which left pale halos round plants in front of walls.
class SceneAO extends GTAOPass {
  constructor(scene, camera, w, h, skip) {
    super(scene, camera, w, h);
    this.skip = skip;
    this.aoScene = scene;
    this.cutouts = [];
    this.lastScan = -1e9;
  }
  render(...args) {
    const now = performance.now();
    if (now - this.lastScan > 2000) {
      // Things get added as the game goes (animals, the pool), so look again now and then.
      this.lastScan = now;
      this.cutouts = [];
      this.aoScene.traverse((o) => {
        if (o.isMesh && [].concat(o.material).some((m) => m && m.alphaTest > 0)) this.cutouts.push(o);
      });
    }
    const hide = this.skip.concat(this.cutouts);
    const was = hide.map((o) => o.visible);
    hide.forEach((o) => (o.visible = false));
    super.render(...args);
    hide.forEach((o, i) => (o.visible = was[i]));
  }
}

export class Post {
  constructor(renderer, scene, camera, { skipAO = [] } = {}) {
    this.renderer = renderer;
    this.camera = camera;
    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);

    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new SceneAO(scene, camera, size.x, size.y, skipAO);
    this.ao.updateGtaoMaterial({ radius: 0.6, distanceExponent: 1.5, thickness: 1.5, scale: 1.2, samples: 12 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    this.ao.blendIntensity = 0.85;
    this.composer.addPass(this.ao);

    this.shafts = new ShaderPass(ShaftShader);
    this.composer.addPass(this.shafts);

    this.bokeh = new BokehPass(scene, camera, { focus: 3, aperture: 0.004, maxblur: 0.006 });
    this.bokeh.enabled = false;
    this.composer.addPass(this.bokeh);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.18, 0.5, 2.2);
    this.composer.addPass(this.bloom);

    this.composer.addPass(new OutputPass());

    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);

    this.focusDist = 3;
    this.setQuality('high');
  }

  setQuality(q) {
    this.quality = q;
    this.ao.enabled = q === 'high';
    this.dofAllowed = q === 'high';
  }

  setSize(w, h) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
    this.grade.uniforms.uAspect.value = w / h;
  }

  // focus: distance in metres to keep sharp, or null for no depth of field.
  // sunDir: world direction to the sun; elevation in degrees; sunColor.
  setSun(sunDir, elevation, sunColor, underwater) {
    const u = this.shafts.uniforms;
    const cam = this.camera;
    const fwd = cam.getWorldDirection(new THREE.Vector3());
    const facing = fwd.dot(sunDir);
    const p = cam.position.clone().addScaledVector(sunDir, 1000).project(cam);
    u.uSun.value.set(p.x * 0.5 + 0.5, p.y * 0.5 + 0.5);
    // Strongest when looking toward a low sun; off underwater and at night.
    const low = 0.45 + 0.9 * (1 - Math.min(1, Math.max(0, (elevation - 5) / 40)));
    const want = underwater || elevation < -1 || facing < 0.2 ? 0 : Math.min(1, (facing - 0.2) / 0.5) * low * 0.9;
    u.uStrength.value += (want - u.uStrength.value) * 0.1;
    u.uColor.value.copy(sunColor);
  }

  render(dt, t, { focus = null, underwater = false } = {}) {
    const g = this.grade.uniforms;
    g.uTime.value = t;
    g.uUnder.value = THREE.MathUtils.damp(g.uUnder.value, underwater ? 1 : 0, 6, dt);
    const want = focus !== null && this.dofAllowed;
    if (want) {
      this.focusDist = THREE.MathUtils.damp(this.focusDist, focus, 6, dt);
      this.bokeh.uniforms.focus.value = this.focusDist;
    }
    this.bokeh.enabled = want;
    this.composer.render(dt);
  }
}
