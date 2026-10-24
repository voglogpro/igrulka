import * as T from '../../../vendor/three/three.module.js';

const infantryGeometry = new Map();
// Two neutral equipment templates; colours are baked, material stays shared with soldiers.
export function infantryEquipmentGeometry(level) {
  if (level !== 1 && level !== 2) return null;
  if (infantryGeometry.has(level)) return infantryGeometry.get(level);
  const parts = [
    [-0.27, 1.72, -0.34, 0.34, 0.43, 0.28, '#586748'],
    [-0.37, 2.15, -0.35, 0.035, 0.64, 0.035, '#39483b'],
  ];
  if (level === 2)
    parts.push(
      [0.2, 2.21, 0.49, 0.16, 0.14, 0.35, '#344843'],
      [0.2, 2.21, 0.675, 0.11, 0.09, 0.025, '#8ab8a4'],
      [0.34, 1.5, -0.29, 0.25, 0.29, 0.25, '#9d9a6b'],
    );
  const positions = [],
    normals = [],
    colors = [];
  for (const [x, y, z, w, h, d, paint] of parts) {
    const indexed = new T.BoxGeometry(w, h, d);
    const box = indexed.toNonIndexed();
    indexed.dispose();
    box.translate(x, y, z);
    const color = new T.Color(paint);
    positions.push(...box.attributes.position.array);
    normals.push(...box.attributes.normal.array);
    for (let i = 0; i < box.attributes.position.count; i++) colors.push(color.r, color.g, color.b);
    box.dispose();
  }
  const geometry = new T.BufferGeometry();
  geometry.setAttribute('position', new T.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new T.Float32BufferAttribute(normals, 3));
  geometry.setAttribute('color', new T.Float32BufferAttribute(colors, 3));
  geometry.computeBoundingBox();
  infantryGeometry.set(level, geometry);
  return geometry;
}

// These are small fittings, not new hulls or weapons. World caches unit geometry/materials.
export function addVehicleEquipment(world, root, level) {
  if (!level) return;
  const parent = root.getObjectByName('turret') || root;
  const y = parent === root ? 3 : 1.8;
  world.box(parent, -1.65, y, -0.5, 0.85, 0.65, 1.1, '#40534b');
  world.box(parent, -1.65, y + 0.18, 0.065, 0.6, 0.25, 0.06, '#88b8ad');
  if (level > 1) {
    world.box(parent, 1.65, y, -1, 0.9, 0.5, 0.75, '#9b9b75');
    world.box(parent, 1.65, y + 0.5, -1, 0.055, 1.5, 0.055, '#45564a');
  }
}
