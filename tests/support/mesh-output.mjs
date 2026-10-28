import { createHash } from 'node:crypto';

// A fixed transformed scene exercises the emitted attributes, grouping and
// untouched dynamic/transparent details without depending on random UUIDs.
export function staticMeshOutput(T, batchStatic) {
  const root = new T.Group();
  root.position.set(13, -2, 27);
  root.rotation.set(0.21, -0.17, 0.43);
  const colors = ['#ee3322', '#336688', '#338833'];
  const materials = colors.map((color) => new T.MeshStandardMaterial({ color, roughness: 0.8 }));
  for (let i = 0; i < 36; i++) {
    const geometry =
      i % 2 ? new T.BoxGeometry(1 + i / 11, 2, 3) : new T.CylinderGeometry(1, 2, 3, 8);
    if (i % 5 === 0) geometry.deleteAttribute('uv');
    const mesh = new T.Mesh(geometry, materials[i % 3]);
    mesh.position.set(i * 1.3 - 20, (i % 7) * 0.4, (i % 4) * 3 - 4);
    mesh.rotation.set(i * 0.021, i * 0.13, -i * 0.041);
    mesh.scale.set(i % 4 === 0 ? -1.2 : 1.1, 0.5 + i / 30, 1.7);
    mesh.castShadow = i % 3 !== 0;
    mesh.receiveShadow = i % 4 !== 0;
    mesh.renderOrder = i % 2;
    root.add(mesh);
  }
  const dynamic = new T.Group();
  dynamic.userData.dynamic = true;
  const turret = new T.Mesh(new T.BoxGeometry(), materials[0]);
  dynamic.add(turret);
  root.add(dynamic);
  const transparent = new T.Mesh(
    new T.BoxGeometry(),
    new T.MeshStandardMaterial({ transparent: true, opacity: 0.5 }),
  );
  root.add(transparent);
  batchStatic(root);
  const hash = createHash('sha256');
  const counts = [];
  for (const child of root.children) {
    if (!child.isMesh || child === transparent) continue;
    const description = {
      castShadow: child.castShadow,
      receiveShadow: child.receiveShadow,
      renderOrder: child.renderOrder,
      vertexColors: child.material.vertexColors,
      color: child.material.color.toArray(),
    };
    hash.update(JSON.stringify(description));
    const attributes = {};
    for (const key of ['position', 'normal', 'uv', 'color']) {
      const attr = child.geometry.getAttribute(key);
      attributes[key] = attr?.count || 0;
      if (attr)
        hash.update(Buffer.from(attr.array.buffer, attr.array.byteOffset, attr.array.byteLength));
    }
    counts.push(attributes);
  }
  return {
    sha256: hash.digest('hex'),
    counts,
    dynamicUntouched: turret.parent === dynamic,
    transparentUntouched: transparent.parent === root,
    rootPosition: root.position.toArray(),
  };
}
