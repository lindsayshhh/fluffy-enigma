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

// Ambient occlusion that ignores the (transparent) sea surface and the sky.
class SceneAO extends GTAOPass {
  constructor(scene, camera, w, h, skip) {
    super(scene, camera, w, h);
    this.skip = skip;
  }
  render(...args) {
    const was = this.skip.map((o) => o.visible);
    this.skip.forEach((o) => (o.visible = false));
    super.render(...args);
    this.skip.forEach((o, i) => (o.visible = was[i]));
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
