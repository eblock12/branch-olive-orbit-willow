import * as THREE from "three";

/** Soft ground blob shadow for entities (cheap Minecraft-style drop shadow). */

let sharedShadowTexture: THREE.CanvasTexture | null = null;
let sharedShadowGeo: THREE.PlaneGeometry | null = null;

function getShadowTexture(): THREE.CanvasTexture {
  if (sharedShadowTexture) return sharedShadowTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const g = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.08,
    size / 2,
    size / 2,
    size * 0.48,
  );
  g.addColorStop(0, "rgba(0,0,0,0.5)");
  g.addColorStop(0.4, "rgba(0,0,0,0.25)");
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  sharedShadowTexture = tex;
  return tex;
}

function getShadowGeometry(): THREE.PlaneGeometry {
  if (sharedShadowGeo) return sharedShadowGeo;
  sharedShadowGeo = new THREE.PlaneGeometry(1, 1);
  sharedShadowGeo.rotateX(-Math.PI / 2);
  return sharedShadowGeo;
}

/**
 * Create a ground blob shadow mesh.
 * @param radius Approx half-width in world units.
 */
export function createEntityShadow(radius = 0.45): THREE.Mesh {
  // Per-instance material so opacity can animate without affecting others
  const mat = new THREE.MeshBasicMaterial({
    map: getShadowTexture(),
    transparent: true,
    opacity: 0.9,
    depthWrite: false,
    depthTest: true,
    side: THREE.DoubleSide,
    fog: true,
  });
  const mesh = new THREE.Mesh(getShadowGeometry(), mat);
  mesh.scale.set(radius * 2, 1, radius * 2);
  mesh.renderOrder = -1;
  mesh.name = "entityShadow";
  mesh.position.y = 0.02;
  return mesh;
}

/**
 * Place shadow at world feet position.
 * @param hop 0–1 how lifted the entity is (shrinks / fades shadow slightly)
 * @param lengthScale stretch along local Z (body length), default 1
 * @param widthScale stretch along local X, default 1
 */
export function updateEntityShadow(
  shadow: THREE.Mesh,
  x: number,
  groundY: number,
  z: number,
  baseRadius = 0.45,
  hop = 0,
  yaw = 0,
  lengthScale = 1,
  widthScale = 1,
): void {
  const h = Math.max(0, Math.min(1, hop));
  shadow.position.set(x, groundY + 0.02, z);
  shadow.rotation.y = yaw;
  const shrink = 1 - h * 0.22;
  shadow.scale.set(
    baseRadius * 2 * widthScale * shrink,
    1,
    baseRadius * 2 * lengthScale * shrink,
  );
  const mat = shadow.material as THREE.MeshBasicMaterial;
  mat.opacity = 0.92 - h * 0.28;
  shadow.visible = true;
}

export function disposeEntityShadow(shadow: THREE.Mesh): void {
  const mat = shadow.material;
  if (mat instanceof THREE.Material) mat.dispose();
}

export function disposeEntityShadowShared(): void {
  sharedShadowGeo?.dispose();
  sharedShadowGeo = null;
  sharedShadowTexture?.dispose();
  sharedShadowTexture = null;
}
