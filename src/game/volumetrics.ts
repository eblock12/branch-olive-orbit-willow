import * as THREE from "three";
import type { DayNightSample } from "./dayNight";

const SAMPLES = 20;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const FRAG = /* glsl */ `
precision highp float;
varying vec2 vUv;
uniform sampler2D tColor;
uniform vec2 uLight;
uniform vec3 uTint;
uniform float uDensity;
uniform float uDecay;
uniform float uWeight;
uniform float uExposure;
uniform float uThreshold;
uniform float uStrength;

void main() {
  if (uStrength < 0.002) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 toLight = uLight - vUv;
  vec2 stepV = toLight * (uDensity / float(${SAMPLES}));
  vec2 coord = vUv;
  float illum = 0.0;
  float w = uWeight;
  for (int i = 0; i < ${SAMPLES}; i++) {
    coord += stepV;
    vec3 s = texture2D(tColor, clamp(coord, 0.0, 1.0)).rgb;
    float lum = dot(s, vec3(0.30, 0.59, 0.11));
    float sky = smoothstep(uThreshold, uThreshold + 0.28, lum);
    illum += sky * w;
    w *= uDecay;
  }
  vec3 shafts = uTint * illum * uExposure * uStrength;
  gl_FragColor = vec4(shafts, 1.0);
}
`;

export class VolumetricLighting {
  private copy: THREE.FramebufferTexture | null = null;
  private w = 0;
  private h = 0;
  private readonly scene = new THREE.Scene();
  private readonly cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private readonly mat: THREE.ShaderMaterial;
  private readonly quad: THREE.Mesh;
  private readonly tmp = new THREE.Vector3();
  private readonly view = new THREE.Vector3();
  private readonly size = new THREE.Vector2();
  private readonly hazeTint = new THREE.Color(0xb8c4d4);
  private smoothStr = 0;
  private smoothLx = 0.5;
  private smoothLy = 0.85;
  private lastT = 0;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        tColor: { value: null },
        uLight: { value: new THREE.Vector2(0.5, 0.85) },
        uTint: { value: new THREE.Color(1, 0.92, 0.75) },
        uDensity: { value: 0.82 },
        uDecay: { value: 0.93 },
        uWeight: { value: 0.28 },
        uExposure: { value: 0.32 },
        uThreshold: { value: 0.18 },
        uStrength: { value: 0 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
      transparent: true,
      blending: THREE.AdditiveBlending,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
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
    this.copy.minFilter = THREE.LinearFilter;
    this.copy.magFilter = THREE.LinearFilter;
    this.copy.generateMipmaps = false;
    this.mat.uniforms.tColor!.value = this.copy;
  }

  /**
   * Screen-space crepuscular rays. After the main scene is on the
   * default framebuffer. Off-screen sun is clamped to the rim so looking
   * forward at noon still gets shafts from above.
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
    if (!enabled) {
      this.smoothStr += (0 - this.smoothStr) * (1 - Math.exp(-dt * 6.5));
      return;
    }

    const useSun = dn.dayFactor >= dn.nightFactor;
    const dir = useSun ? dn.sunDir : dn.moonDir;
    const elev = useSun ? dn.sunElevation : dn.moonDir.y;
    const media = Math.max(gloom, storm);
    const flash = dn.weatherFlash ?? 0;

    camera.getWorldDirection(this.view);
    const facing = this.view.dot(dir);

    this.tmp.copy(dir).multiplyScalar(800).add(camera.position);
    this.tmp.project(camera);
    const ndcX = this.tmp.x;
    const ndcY = this.tmp.y;
    const behind = this.tmp.z > 1;
    // Keep the source on (or just outside) the screen so rays still
    // originate from the sun's direction when it's above the frustum.
    const uvX = THREE.MathUtils.clamp(ndcX * 0.5 + 0.5, -0.15, 1.15);
    const uvY = THREE.MathUtils.clamp(ndcY * 0.5 + 0.5, -0.15, 1.15);
    const offX = Math.max(0, Math.abs(ndcX) - 1);
    const offY = Math.max(0, Math.abs(ndcY) - 1);
    const off = Math.hypot(offX, offY);
    const rim = 1 - THREE.MathUtils.smoothstep(0.35, 2.4, off);
    const faceK = THREE.MathUtils.smoothstep(-0.35, 0.4, facing);
    const horizon = 1 - THREE.MathUtils.smoothstep(0.08, 0.95, Math.max(0, elev));

    let target = 0;
    if (!underwater && !behind && elev > -0.12) {
      const base = 0.34 + horizon * 0.42 + media * 0.28;
      target = base * (0.4 + faceK * 0.6) * rim * (useSun ? 1 : 0.5);
      target += flash * 0.45 * rim;
      target = THREE.MathUtils.clamp(target * strengthMul, 0, 0.95);
    }

    const k = 1 - Math.exp(-dt * 5.5);
    this.smoothStr += (target - this.smoothStr) * k;
    this.smoothLx += (uvX - this.smoothLx) * k;
    this.smoothLy += (uvY - this.smoothLy) * k;

    if (this.smoothStr < 0.01) {
      this.mat.uniforms.uStrength!.value = 0;
      return;
    }

    renderer.getDrawingBufferSize(this.size);
    this.setSize(this.size.x, this.size.y);
    if (!this.copy) return;

    renderer.copyFramebufferToTexture(this.copy);

    const tint = (this.mat.uniforms.uTint!.value as THREE.Color).copy(
      useSun ? dn.sunColor : dn.moonColor,
    );
    if (media > 0.12) tint.lerp(this.hazeTint, 0.35 + media * 0.25);
    tint.multiplyScalar(0.95);

    const u = this.mat.uniforms;
    (u.uLight!.value as THREE.Vector2).set(this.smoothLx, this.smoothLy);
    u.uStrength!.value = this.smoothStr;
    u.uThreshold!.value = THREE.MathUtils.lerp(0.16, 0.08, Math.min(1, media));
    u.uExposure!.value = 0.34 + media * 0.14 + flash * 0.16;
    u.uDensity!.value = 0.84;
    u.uWeight!.value = 0.3;

    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.render(this.scene, this.cam);
    renderer.autoClear = prevAuto;
  }

  dispose(): void {
    this.copy?.dispose();
    this.copy = null;
    this.mat.dispose();
    this.quad.geometry.dispose();
  }
}
