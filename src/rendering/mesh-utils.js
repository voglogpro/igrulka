import * as T from '../../vendor/three/three.module.js';
// Batch a static subtree by material. Rotors, wings and turrets keep their independent transforms.
export function batchStatic(root, excluded = new Set()) {
  root.updateMatrixWorld(true);
  const inverse = root.matrixWorld.clone().invert(),
    groups = new Map();
  root.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || Array.isArray(m.material) || m.material.transparent)
      return;
    for (let p = m; p && p !== root; p = p.parent)
      if (excluded.has(p) || p.userData.dynamic) return;
    const key = m.material.uuid + '/' + m.castShadow + '/' + m.receiveShadow + '/' + m.renderOrder;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(m);
  });
  const point = new T.Vector3(),
    normal = new T.Vector3();
  for (const meshes of groups.values()) {
    if (meshes.length < 2) continue;
    let count = 0;
    for (const m of meshes)
      count += m.geometry.index?.count || m.geometry.attributes.position.count;
    const positions = new Float32Array(count * 3),
      normals = new Float32Array(count * 3),
      uvs = new Float32Array(count * 2);
    let cursor = 0;
    for (const m of meshes) {
      const geo = m.geometry,
        matrix = new T.Matrix4().multiplyMatrices(inverse, m.matrixWorld),
        nm = new T.Matrix3().getNormalMatrix(matrix),
        p = geo.attributes.position,
        n = geo.attributes.normal,
        uv = geo.attributes.uv,
        indices = geo.index;
      for (let i = 0; i < (indices?.count || p.count); i++, cursor++) {
        const index = indices ? indices.getX(i) : i;
        point.fromBufferAttribute(p, index).applyMatrix4(matrix);
        positions.set([point.x, point.y, point.z], cursor * 3);
        if (n) {
          normal.fromBufferAttribute(n, index).applyNormalMatrix(nm);
          normals.set([normal.x, normal.y, normal.z], cursor * 3);
        }
        if (uv) uvs.set([uv.getX(index), uv.getY(index)], cursor * 2);
      }
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute('position', new T.BufferAttribute(positions, 3));
    geometry.setAttribute('normal', new T.BufferAttribute(normals, 3));
    geometry.setAttribute('uv', new T.BufferAttribute(uvs, 2));
    geometry.computeBoundingSphere();
    geometry.userData.owned = true;
    const first = meshes[0],
      combined = new T.Mesh(geometry, first.material);
    combined.castShadow = first.castShadow;
    combined.receiveShadow = first.receiveShadow;
    combined.renderOrder = first.renderOrder;
    root.add(combined);
    for (const mesh of meshes) mesh.removeFromParent();
  }
}
export function disposeTree(root, sharedGeometries, sharedMaterials) {
  const geos = new Set(),
    mats = new Set();
  root.traverse((o) => {
    if (o.geometry && !sharedGeometries.has(o.geometry)) geos.add(o.geometry);
    for (const m of Array.isArray(o.material) ? o.material : [o.material])
      if (m && !sharedMaterials.has(m)) mats.add(m);
  });
  for (const geometry of geos) geometry.dispose();
  for (const material of mats) material.dispose();
  root.removeFromParent();
}

export function detailBuilding(w, b, root) {
  if (['factory', 'industry'].includes(b.key)) {
    const h = b.key === 'factory' ? 17 : 15;
    for (const x of [-9, 0, 9]) {
      w.box(root, x, h, 0, 4.5, 0.9, 7, '#68777a');
      w.cyl(root, x, h + 0.9, 0, 1.3, 0.65, '#3e4e51');
      for (const z of [-2, 2]) w.box(root, x, h + 1, z, 3, 0.2, 0.25, '#a7afa5');
    }
    for (const z of [-10, 10]) {
      w.box(root, -14, 2, z, 0.35, 11, 0.35, '#adb4a3');
      for (let y = 3; y < 13; y += 2) w.box(root, -14, y, z, 0.3, 0.18, 2.5, '#828e82');
    }
    for (let i = 0; i < 6; i++) w.box(root, -10 + i * 4, 3, 12.7, 2.5, 0.35, 0.25, '#c5b68a');
    for (const z of [-8, 8]) w.box(root, 12, 1, z, 2, 4, 4, '#626c62');
  } else if (b.key === 'power') {
    for (let i = 0; i < 5; i++) {
      w.box(root, -12 + i * 5, 1.2, 14, 2.8, 3.6, 4.5, '#9c927b');
      w.cyl(root, -12 + i * 5, 4.8, 14, 0.3, 1.5, '#c0b697');
    }
    w.box(root, -3, 12, 0, 10, 0.6, 12, '#687778');
  } else if (['housing', 'lab'].includes(b.key)) {
    for (let i = 0; i < 2; i++) {
      const y = b.key === 'lab' ? 18 : 23 + i * 6;
      w.box(root, i * 8 - 4, y, 0, 3.5, 1.5, 4, '#85938f');
      w.cyl(root, i * 8 - 4, y + 1.5, 0, 0.7, 0.5, '#4b615f');
    }
  }
}
