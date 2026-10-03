import * as THREE from "three";
import type { DayNightSample } from "./dayNight";

const SAMPLES = 16;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = position.xy * 0.5 + 0.5;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 uLight;
uniform vec3 uTint;
uniform float uStrength;
uniform float uTime;
uniform float uHasColor;
uniform float uThreshold;

void main() {
  if (uStrength < 0.004) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 delta = uLight - vUv;
  // Aspect-correct so shafts aren't stretched
  delta.x *= 1.6;
  float dist = length(delta);
  vec2 stepV = (uLight - vUv) / float(${SAMPLES});
  vec2 coord = vUv;
  float illum = 0.0;
  float w = 1.0;
  for (int i = 0; i < ${SAMPLES}; i++) {
    coord += stepV;
    vec2 p = clamp(coord, 0.0, 1.0);
    float occ = 1.0;
    if (uHasColor > 0.5) {
      vec3 s = texture2D(tColor, p).rgb;
      float lum = dot(s, vec3(0.30, 0.59, 0.11));
      occ = 0.28 + 0.72 * smoothstep(uThreshold, uThreshold + 0.35, lum);
    }
    // Analytical falloff from the sun — works even if the copy is black
    vec2 d = (p - uLight);
    d.x *= 1.6;
    float radial = exp(-dot(d, d) * 7.5);
    illum += (radial * 1.15 + occ * 0.55) * w;
    w *= 0.88;
  }
  illum /= float(${SAMPLES});
  float ang = atan(delta.y, delta.x);
  float rays = 0.5 + 0.5 * pow(abs(sin(ang * 5.0 + uTime * 0.15)), 3.0);
  float core = exp(-dist * 2.4);
  float shafts = illum * (0.45 + rays * 0.7) * core;
  vec3 col = uTint * shafts * uStrength * 2.8;
  gl_FragColor = vec4(col, 0.0);
}
`;

export class VolumetricLighting {
  private copy: THREE.FramebufferTexture | null = null;
  private w = 0;
  private h = 0;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, -1, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private readonly hazeTint = new THREE.Color(0xb8c4d4);
  private smoothStr = 0;
  private smoothLx = 0.5;
  private smoothLy = 0.82;
  private lastT = 0;
  private hasColor = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        uLight: { value: new THREE.Vector2(0.5, 0.85) },
        uTint: { value: new THREE.Color(1, 0.93, 0.78) },
        uStrength: { value: 0 },
        uTime: { value: 0 },
        uHasColor: { value: 0 },
        uThreshold: { value: 0.14 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3),
    );
    this.quad = new THREE.Mesh(geo, this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  setSize(pixelW: number, pixelH: number): void {
    const w = Math.max(2, pixelW | 0);
    const h = Math.max(2, pixelH | 0);
    if (w === this.w && h === this.h && this.copy) return;
    this.w = w;
    this.h = h;
    this.copy?.dispose();
    this.copy = new THREE.FramebufferTexture(w, h);
    this.copy.colorSpace = THREE.NoColorSpace;
    this.copy.minFilter = THREE.LinearFilter;
    this.copy.magFilter = THREE.LinearFilter;
    this.copy.generateMipmaps = false;
    this.mat.uniforms.tColor!.value = this.copy;
  }

  /**
   * Screen-space crepuscular rays. Analytical so they stay visible even
   * when the framebuffer copy is unusable; color buffer is an extra mask.
   */
  render(
    renderer: THREE.WebGLRenderer,
    camera: THREE.PerspectiveCamera,
    dn: DayNightSample,
    gloom: number,
    storm: number,
    underwater: boolean,
    enabled = true,
    strengthMul = 1,
  ): void {
    const now = performance.now() * 0.001;
    const dt = Math.min(0.08, Math.max(0.001, now - (this.lastT || now)));
    this.lastT = now;
    if (!enabled || underwater) {
      this.smoothStr += (0 - this.smoothStr) * (1 - Math.exp(-dt * 7));
      if (this.smoothStr < 0.004) return;
    }

    const useSun = dn.dayFactor >= dn.nightFactor;
    const dir = useSun ? dn.sunDir : dn.moonDir;
    const elev = useSun ? dn.sunElevation : dn.moonDir.y;
    const media = Math.max(gloom, storm);
    const flash = dn.weatherFlash ?? 0;

    camera.getWorldDirection(this.view);
    const facing = this.view.dot(dir);
    this.tmp
      .copy(dir)
      .multiplyScalar(Math.min(180, camera.far * 0.75))
      .add(camera.position);
    this.tmp.project(camera);
    const ndcX = this.tmp.x;
    const ndcY = this.tmp.y;
    const uvX = THREE.MathUtils.clamp(ndcX * 0.5 + 0.5, 0.04, 0.96);
    const uvY = THREE.MathUtils.clamp(ndcY * 0.5 + 0.5, 0.06, 0.96);

    // Visible whenever the body is above the horizon and you're not
    // staring at the dirt. Off-screen sun still contributes from the rim.
    // Three.smoothstep(x, min, max) — NOT GLSL (edge0, edge1, x)
    const lookUp = THREE.MathUtils.smoothstep(this.view.y, -0.28, 0.22);
    const faceK = THREE.MathUtils.smoothstep(facing, -0.25, 0.55);
    const above = THREE.MathUtils.smoothstep(elev, -0.12, 0.04);
    const radial = Math.hypot(ndcX, ndcY);
    const onScreen = 1 - THREE.MathUtils.smoothstep(radial, 0.9, 2.2);
    const vis = above * Math.max(faceK, lookUp * 0.85) * (0.45 + onScreen * 0.55);

    let target = 0;
    if (enabled && !underwater && vis > 0.02) {
      const weatherBoost = 0.75 + media * 0.55;
      target = vis * weatherBoost * Math.max(0, strengthMul);
      target += flash * 0.45 * vis;
      target = THREE.MathUtils.clamp(target, 0, 1.6);
    }

    const k = 1 - Math.exp(-dt * 6);
    this.smoothStr += (target - this.smoothStr) * k;
    this.smoothLx += (uvX - this.smoothLx) * k;
    this.smoothLy += (uvY - this.smoothLy) * k;

    if (this.smoothStr < 0.006) {
      this.mat.uniforms.uStrength!.value = 0;
      return;
    }

    renderer.getDrawingBufferSize(this.size);
    this.setSize(this.size.x, this.size.y);
    this.hasColor = 0;
    if (this.copy) {
      try {
        renderer.copyFramebufferToTexture(this.copy);
        this.hasColor = 1;
      } catch {
        this.hasColor = 0;
      }
    }

    const tint = (this.mat.uniforms.uTint!.value as THREE.Color).copy(
      useSun ? dn.sunColor : dn.moonColor,
    );
    if (media > 0.12) tint.lerp(this.hazeTint, 0.3 + media * 0.22);
    if (!useSun) tint.multiplyScalar(0.7);

    const u = this.mat.uniforms;
    (u.uLight!.value as THREE.Vector2).set(this.smoothLx, this.smoothLy);
    u.uStrength!.value = this.smoothStr;
    u.uTime!.value = now;
    u.uHasColor!.value = this.hasColor;
    u.uThreshold!.value = THREE.MathUtils.lerp(0.12, 0.06, Math.min(1, media));

    const prevAuto = renderer.autoClear;
    const prevTone = renderer.toneMapping;
    renderer.autoClear = false;
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = prevAuto;
    renderer.toneMapping = prevTone;
  }

  dispose(): void {
    this.copy?.dispose();
    this.copy = null;
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
