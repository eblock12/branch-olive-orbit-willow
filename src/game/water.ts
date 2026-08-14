import * as THREE from "three";
import { Block, isWater } from "./blocks";
import { SEA_LEVEL } from "./chunk";
import type { World } from "./world";

/** Animated water surface + reflection/refraction + underwater mode */

const waterVertex = /* glsl */ `
uniform float uTime;
attribute vec3 color;
varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vLocalXZ;
varying float vIsTop;
varying float vFaceH;

void main() {
  vec3 pos = position;
  vIsTop = normal.y > 0.5 ? 1.0 : 0.0;
  vFaceH = color.g;
  // No per-vertex displacement — adjacent blocks share edges and any
  // Y offset opens a seam. Ripple lives in the fragment shader.
  vec4 world = modelMatrix * vec4(pos, 1.0);
  vWorldPos = world.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vLocalXZ = pos.xz;
  gl_Position = projectionMatrix * viewMatrix * world;
}
`;

const waterFragment = /* glsl */ `
uniform float uTime;
uniform vec3 uSkyColor;
uniform vec3 uHorizonColor;
uniform vec3 uDeepColor;
uniform vec3 uShallowColor;
uniform vec3 uSunDir;
uniform vec3 uSunColor;
uniform float uSunIntensity;
uniform float uUnderwater;
uniform sampler2D tReflection;
uniform sampler2D tRefraction;
uniform float uHasReflection;
uniform float uHasRefraction;
uniform vec2 uResolution;

varying vec3 vWorldPos;
varying vec3 vNormal;
varying vec2 vLocalXZ;
varying float vIsTop;
varying float vFaceH;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * noise(p);
    p = p * 2.07 + vec2(11.7, 3.1);
    a *= 0.5;
  }
  return v;
}

void main() {
  vec3 N = normalize(vNormal);
  if (!gl_FrontFacing) N = -N;
  float t = uTime;
  vec3 V = normalize(cameraPosition - vWorldPos);
  float ndv = max(dot(N, V), 0.0);

  vec2 screenUv = gl_FragCoord.xy / uResolution;

  if (vIsTop > 0.5) {
    // ── Surface ──────────────────────────────────────────
    float n1 = noise(vLocalXZ * 0.7 + vec2(t * 0.25, t * 0.18));
    float n2 = noise(vLocalXZ * 1.6 + vec2(-t * 0.22, t * 0.3));
    vec3 ripple = vec3((n1 - 0.5) * 0.35, 0.0, (n2 - 0.5) * 0.35);
    N = normalize(N + ripple);
    ndv = max(dot(N, V), 0.0);
    float fresnel = mix(0.12, 1.0, pow(1.0 - ndv, 3.5));
    vec2 distort = ripple.xz * 0.04;

    vec3 refractCol = mix(uDeepColor * 0.65, uShallowColor, pow(ndv, 0.65));
    if (uHasRefraction > 0.5) {
      vec3 sampled = texture2D(tRefraction, clamp(screenUv + distort, 0.0, 1.0)).rgb;
      refractCol = mix(refractCol, sampled, 0.72);
    }

    vec3 R = reflect(-V, N);
    float skyMix = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
    vec3 skyCol = mix(uHorizonColor, uSkyColor, skyMix);
    vec3 reflectCol = skyCol;
    if (uHasReflection > 0.5) {
      vec2 ruv = screenUv + distort * 1.4;
      ruv.y = 1.0 - ruv.y;
      vec3 mirrored = texture2D(tReflection, clamp(ruv, 0.0, 1.0)).rgb;
      reflectCol = mix(skyCol, mirrored, 0.88);
    }

    vec3 H = normalize(V + normalize(-uSunDir));
    float spec = pow(max(dot(N, H), 0.0), 96.0) * uSunIntensity;
    float sparkle = pow(noise(vLocalXZ * 8.0 + t * 2.0), 6.0) * fresnel * uSunIntensity;

    vec3 col = mix(refractCol, reflectCol, fresnel * 0.92);
    col += uSunColor * (spec * 0.55 + sparkle * 0.25);
    float alpha = mix(0.52, 0.82, fresnel);

    if (uUnderwater > 0.5) {
      col = mix(uShallowColor * 0.8, reflectCol, fresnel * 0.6);
      col += uSunColor * spec * 0.3;
      alpha = mix(0.35, 0.75, fresnel);
    }
    gl_FragColor = vec4(col, clamp(alpha, 0.35, 0.92));
    return;
  }

  // ── Side faces: same water language as the surface, vertical plane ──
  // NO per-block height gradient (that stacked into striped bands).
  vec2 faceUv = abs(N.x) > abs(N.z)
    ? vec2(vWorldPos.z, vWorldPos.y)
    : vec2(vWorldPos.x, vWorldPos.y);

  vec2 warp = vec2(
    fbm(faceUv * 0.28 + vec2(t * 0.07, 4.2)),
    fbm(faceUv * 0.28 + vec2(9.1, -t * 0.06))
  );
  vec2 uv = faceUv * 0.42 + (warp - 0.5) * 2.4;

  float n1 = fbm(uv + vec2(t * 0.11, -t * 0.08));
  float n2 = fbm(uv * 1.85 + vec2(-t * 0.13, t * 0.09));
  float n3 = noise(uv * 3.4 + vec2(t * 0.2, t * 0.16));

  // Ripple the face so it reads as a water surface, not a painted wall
  vec3 tanH = abs(N.x) > 0.5 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tanV = vec3(0.0, 1.0, 0.0);
  N = normalize(N + tanH * (n1 - 0.5) * 0.55 + tanV * (n2 - 0.5) * 0.5);
  ndv = max(dot(N, V), 0.0);

  float fresnel = mix(0.1, 1.0, pow(1.0 - ndv, 3.0));
  vec2 distort = vec2(n1 - 0.5, n2 - 0.5) * 0.035;

  // World-space depth only (continuous down a column — not per block)
  float worldDepth = clamp((62.0 - vWorldPos.y) / 14.0, 0.0, 1.0);
  vec3 body = mix(uShallowColor, uDeepColor * 0.75, worldDepth * 0.55 + (1.0 - ndv) * 0.25);
  body = mix(body, body * 1.18 + uSunColor * 0.08, n1 * n2 * 0.55);

  // Soft blotchy caustics, not stripes
  float caust = pow(clamp(n1 * 0.55 + n2 * 0.35 + n3 * 0.25, 0.0, 1.0), 2.4);
  body += uSunColor * caust * 0.16 * uSunIntensity;

  vec3 refractCol = body;
  if (uHasRefraction > 0.5) {
    vec3 sampled = texture2D(tRefraction, clamp(screenUv + distort, 0.0, 1.0)).rgb;
    refractCol = mix(body, sampled * vec3(0.55, 0.78, 0.92), 0.4);
  }

  vec3 R = reflect(-V, N);
  float skyMix = clamp(R.y * 0.5 + 0.5, 0.0, 1.0);
  vec3 skyCol = mix(uHorizonColor, uSkyColor, skyMix);

  vec3 col = mix(refractCol, skyCol, fresnel * 0.78);

  vec3 L = normalize(-uSunDir);
  float spec = pow(max(dot(N, normalize(V + L)), 0.0), 72.0) * uSunIntensity;
  float sparkle = pow(n3, 8.0) * fresnel * uSunIntensity;
  col += uSunColor * (spec * 0.4 + sparkle * 0.22);

  // Thin noisy lip only at the true surface of this cell
  float foam = smoothstep(0.93, 0.995, clamp(vFaceH, 0.0, 1.0));
  foam *= 0.4 + 0.6 * noise(vec2(faceUv.x * 2.8 + t * 0.9, t * 0.3));
  col = mix(col, mix(uShallowColor, vec3(0.85, 0.94, 1.0), 0.5), foam * 0.45);

  float alpha = mix(0.9, 0.97, fresnel);
  alpha = clamp(alpha, 0.86, 0.98);

  if (uUnderwater > 0.5) {
    col = mix(uDeepColor * 0.65, uShallowColor, 0.4 + n1 * 0.2);
    alpha = mix(0.22, 0.5, fresnel);
  }

  gl_FragColor = vec4(col, alpha);
}
`;

export function createWaterMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uSkyColor: { value: new THREE.Color(0x6eb6e8) },
      uHorizonColor: { value: new THREE.Color(0xc8dce8) },
      uDeepColor: { value: new THREE.Color(0x0a3a5c) },
      uShallowColor: { value: new THREE.Color(0x2a8fc8) },
      uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3).normalize() },
      uSunColor: { value: new THREE.Color(0xfff2d0) },
      uSunIntensity: { value: 1 },
      uUnderwater: { value: 0 },
      tReflection: { value: null as THREE.Texture | null },
      tRefraction: { value: null as THREE.Texture | null },
      uHasReflection: { value: 0 },
      uHasRefraction: { value: 0 },
      uResolution: { value: new THREE.Vector2(1, 1) },
    },
    vertexShader: waterVertex,
    fragmentShader: waterFragment,
    transparent: true,
    depthWrite: true,
    side: THREE.DoubleSide,
    // Don't fight fog too hard — engine sets underwater fog
    fog: false,
  });
}

export type WaterFaceArrays = {
  positions: number[];
  normals: number[];
  indices: number[];
};

/**
 * Planar reflection + refraction render targets and underwater post tint.
 */
export class WaterFX {
  readonly material: THREE.ShaderMaterial;
  private reflectionRT: THREE.WebGLRenderTarget;
  private refractionRT: THREE.WebGLRenderTarget;
  private reflectCam = new THREE.PerspectiveCamera();
  private clipBias = 0.02;
  underwater = false;
  private time = 0;
  /** Fullscreen underwater tint quad */
  private underQuad: THREE.Mesh;
  private underMat: THREE.ShaderMaterial;
  private underScene = new THREE.Scene();
  private underCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  constructor() {
    this.material = createWaterMaterial();
    const rtOpts: THREE.RenderTargetOptions = {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
    };
    this.reflectionRT = new THREE.WebGLRenderTarget(512, 512, rtOpts);
    this.refractionRT = new THREE.WebGLRenderTarget(512, 512, rtOpts);
    this.material.uniforms.tReflection!.value = this.reflectionRT.texture;
    this.material.uniforms.tRefraction!.value = this.refractionRT.texture;

    this.underMat = new THREE.ShaderMaterial({
      transparent: true,
      depthTest: false,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uStrength: { value: 0 },
        uColor: { value: new THREE.Color(0x0c4a6e) },
      },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform float uStrength;
        uniform vec3 uColor;
        varying vec2 vUv;
        float hash(vec2 p) {
          return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
        }
        void main() {
          vec2 uv = vUv;
          // Caustic-ish shimmer
          float c = sin(uv.x * 30.0 + uTime * 2.0) * sin(uv.y * 22.0 - uTime * 1.5);
          c += sin((uv.x + uv.y) * 40.0 + uTime * 3.0) * 0.5;
          c = c * 0.04 + 0.0;
          // Vignette
          float vig = smoothstep(0.2, 0.95, length(uv - 0.5) * 1.4);
          vec3 col = uColor;
          float a = uStrength * (0.45 + vig * 0.4) + c * uStrength;
          gl_FragColor = vec4(col, clamp(a, 0.0, 0.75));
        }
      `,
    });
    this.underQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.underMat);
    this.underScene.add(this.underQuad);
  }

  setSize(w: number, h: number): void {
    const rw = Math.min(1024, Math.max(256, Math.floor(w / 2)));
    const rh = Math.min(1024, Math.max(256, Math.floor(h / 2)));
    this.reflectionRT.setSize(rw, rh);
    this.refractionRT.setSize(rw, rh);
    this.material.uniforms.uResolution!.value.set(w, h);
  }

  /**
   * Detect head-in-water and update fog / water uniforms.
   * Call before reflection passes.
   */
  updateState(
    world: World,
    eyeX: number,
    eyeY: number,
    eyeZ: number,
    skyColor: THREE.Color,
    fog: THREE.Fog,
    sunDir: THREE.Vector3,
    sunColor: THREE.Color,
    sunIntensity: number,
    dayFactor: number,
  ): void {
    const head = world.getBlock(
      Math.floor(eyeX),
      Math.floor(eyeY),
      Math.floor(eyeZ),
    );
    this.underwater = isWater(head);

    const u = this.material.uniforms;
    u.uSkyColor!.value.copy(skyColor);
    u.uHorizonColor!.value.copy(skyColor).lerp(new THREE.Color(0xd8e8f0), 0.45);
    u.uSunDir!.value.copy(sunDir).normalize();
    u.uSunColor!.value.copy(sunColor);
    u.uSunIntensity!.value = Math.max(0.15, sunIntensity * dayFactor);
    u.uUnderwater!.value = this.underwater ? 1 : 0;

    if (this.underwater) {
      // Dense blue-green underwater fog
      fog.color.set(0x0a3d55);
      fog.near = 2;
      fog.far = 28;
      this.underMat.uniforms.uStrength!.value = 1;
      this.underMat.uniforms.uColor!.value.set(0x0a4a62);
    } else {
      this.underMat.uniforms.uStrength!.value = 0;
    }
  }

  update(dt: number): void {
    this.time += dt;
    this.material.uniforms.uTime!.value = this.time;
    this.underMat.uniforms.uTime!.value = this.time;
  }

  /**
   * Planar reflection/refraction scene captures.
   * Disabled for performance — water falls back to procedural tint/specular.
   * Set ENABLE_WATER_RTS true to re-enable.
   */
  static readonly ENABLE_WATER_RTS = false;

  /**
   * Render reflection (mirrored about sea-level surface) and refraction
   * (scene from camera with water hidden). Call before main render.
   */
  renderPasses(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera,
    waterGroup: THREE.Object3D,
  ): void {
    const u = this.material.uniforms;
    if (!WaterFX.ENABLE_WATER_RTS || this.underwater) {
      u.uHasReflection!.value = 0;
      u.uHasRefraction!.value = 0;
      return;
    }

    const planeY = SEA_LEVEL + 1; // top of water block at sea level
    waterGroup.visible = false;
    const prevShadow = renderer.shadowMap.enabled;
    renderer.shadowMap.enabled = false;

    // --- Refraction: current view without water ---
    {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.refractionRT);
      renderer.clear();
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
      u.uHasRefraction!.value = 1;
    }

    // --- Reflection: mirror camera across horizontal plane ---
    {
      this.reflectCam.copy(camera);
      this.reflectCam.position.copy(camera.position);
      this.reflectCam.position.y = planeY * 2 - camera.position.y;
      const e = new THREE.Euler().setFromQuaternion(camera.quaternion, "YXZ");
      e.x = -e.x;
      this.reflectCam.quaternion.setFromEuler(e);
      this.reflectCam.fov = camera.fov;
      this.reflectCam.aspect = camera.aspect;
      this.reflectCam.near = camera.near;
      this.reflectCam.far = camera.far;
      this.reflectCam.updateProjectionMatrix();
      this.reflectCam.updateMatrixWorld(true);

      const clipPlane = new THREE.Plane(
        new THREE.Vector3(0, 1, 0),
        -planeY + this.clipBias,
      );
      this.applyObliqueClip(this.reflectCam, clipPlane);

      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(this.reflectionRT);
      renderer.clear();
      renderer.render(scene, this.reflectCam);
      renderer.setRenderTarget(prev);
      camera.updateProjectionMatrix();
      u.uHasReflection!.value = 1;
    }

    renderer.shadowMap.enabled = prevShadow;
    waterGroup.visible = true;
  }

  /** Terragen-style oblique near-plane clip for planar reflection */
  private applyObliqueClip(cam: THREE.Camera, clipPlane: THREE.Plane): void {
    cam.updateMatrixWorld(true);
    const m = cam.projectionMatrix;
    const q = new THREE.Vector4();
    const clip = clipPlane.clone();
    clip.applyMatrix4(cam.matrixWorldInverse);

    q.x = (Math.sign(clip.normal.x) + m.elements[8]) / m.elements[0];
    q.y = (Math.sign(clip.normal.y) + m.elements[9]) / m.elements[5];
    q.z = -1;
    q.w = (1 + m.elements[10]) / m.elements[14];

    const c = new THREE.Vector4(
      clip.normal.x,
      clip.normal.y,
      clip.normal.z,
      clip.constant,
    );
    c.multiplyScalar(2.0 / c.dot(q));

    m.elements[2] = c.x;
    m.elements[6] = c.y;
    m.elements[10] = c.z + 1.0;
    m.elements[14] = c.w;
  }

  /** Draw underwater color grade after main scene */
  renderUnderwaterOverlay(renderer: THREE.WebGLRenderer): void {
    if (!this.underwater) return;
    const prevAuto = renderer.autoClear;
    renderer.autoClear = false;
    renderer.clearDepth();
    renderer.render(this.underScene, this.underCam);
    renderer.autoClear = prevAuto;
  }

  dispose(): void {
    this.material.dispose();
    this.reflectionRT.dispose();
    this.refractionRT.dispose();
    this.underMat.dispose();
    this.underQuad.geometry.dispose();
  }
}
