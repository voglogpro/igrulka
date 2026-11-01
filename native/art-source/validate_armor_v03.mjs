import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as T from '../../vendor/three/three.module.js';

// CPU-only authoring acceptance. No renderer, GLB runtime installation or gameplay changes.
const root = fileURLToPath(new URL('../..', import.meta.url));
const directory = path.resolve(process.argv[2] || path.join(root, 'artifacts/native/armor-v03'));
const exported = JSON.parse(await readFile(path.join(directory, 'report.json'), 'utf8'));
const results = [];
const close = (actual, expected, label, epsilon = 0.0001) =>
  assert.ok(
    actual.distanceTo(new T.Vector3(...expected)) < epsilon,
    label + ': ' + actual.toArray(),
  );
for (const record of exported.lods) {
  const filename = path.join(directory, `armor_v03_lod${record.lod}.glb`);
  const data = await readFile(filename);
  assert.equal(data.readUInt32LE(0), 0x46546c67);
  assert.equal(data.readUInt32LE(4), 2);
  assert.equal(data.readUInt32LE(8), data.length);
  assert.equal(createHash('sha256').update(data).digest('hex'), record.sha256);
  const jsonLength = data.readUInt32LE(12);
  assert.equal(data.readUInt32LE(16), 0x4e4f534a);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString('utf8'));
  const binHeader = 20 + jsonLength;
  assert.equal(data.readUInt32LE(binHeader + 4), 0x004e4942);
  const binary = data.subarray(binHeader + 8, binHeader + 8 + data.readUInt32LE(binHeader));
  const names = new Map(gltf.nodes.map((node, index) => [node.name, index]));
  assert.equal(names.size, gltf.nodes.length, 'Unique stable node names');
  for (const name of [
    'ArmorV03',
    'hull',
    'turret',
    'gun',
    'recoil',
    'muzzle',
    'collisionProxy',
    'track_left',
    'track_right',
  ])
    assert.ok(names.has(name), 'Missing ' + name);
  const parents = new Map();
  for (const [index, node] of gltf.nodes.entries())
    for (const child of node.children || []) {
      assert.ok(!parents.has(child), 'Single parent');
      parents.set(child, index);
    }
  for (const [child, parent] of [
    ['hull', 'ArmorV03'],
    ['turret', 'hull'],
    ['gun', 'turret'],
    ['recoil', 'gun'],
    ['muzzle', 'recoil'],
    ['collisionProxy', 'hull'],
  ])
    assert.equal(parents.get(names.get(child)), names.get(parent), child + ' hierarchy');
  const local = (node) =>
    node.matrix
      ? new T.Matrix4().fromArray(node.matrix)
      : new T.Matrix4().compose(
          new T.Vector3(...(node.translation || [0, 0, 0])),
          new T.Quaternion(...(node.rotation || [0, 0, 0, 1])),
          new T.Vector3(...(node.scale || [1, 1, 1])),
        );
  const worldCache = new Map();
  function world(index) {
    if (worldCache.has(index)) return worldCache.get(index);
    const matrix = local(gltf.nodes[index]);
    if (parents.has(index)) matrix.premultiply(world(parents.get(index)));
    worldCache.set(index, matrix);
    return matrix;
  }
  const origin = (name) => new T.Vector3().setFromMatrixPosition(world(names.get(name)));
  close(origin('hull'), [0, 0, 0], 'Hull origin');
  close(origin('turret'), [0, 4.1, 0], 'Y-up original turret pivot');
  close(origin('gun'), [0, 5.12, 2.2], '+Z original gun pivot');
  close(origin('muzzle'), [0, 5.12, 11.76], 'Original muzzle world position');
  for (const name of ['hull', 'turret', 'gun', 'recoil']) {
    const basis = new T.Matrix3().setFromMatrix4(world(names.get(name)));
    close(
      new T.Vector3(0, 1, 0).applyMatrix3(basis).normalize(),
      [0, 1, 0],
      name + ' Y-up joint basis',
    );
    close(
      new T.Vector3(0, 0, 1).applyMatrix3(basis).normalize(),
      [0, 0, 1],
      name + ' +Z-forward joint basis',
    );
  }
  const articulated = world(names.get('hull'))
    .clone()
    .multiply(local(gltf.nodes[names.get('turret')]))
    .multiply(new T.Matrix4().makeRotationY(0.8))
    .multiply(local(gltf.nodes[names.get('gun')]))
    .multiply(new T.Matrix4().makeRotationX(-0.3))
    .multiply(local(gltf.nodes[names.get('recoil')]))
    .multiply(new T.Matrix4().makeTranslation(0, 0, -0.5))
    .multiply(local(gltf.nodes[names.get('muzzle')]));
  const posedMuzzle = new T.Vector3().setFromMatrixPosition(articulated);
  const expectedPosed = new T.Vector3(0, 0, 9.06)
    .applyMatrix4(new T.Matrix4().makeRotationX(-0.3))
    .add(new T.Vector3(0, 1.02, 2.2))
    .applyMatrix4(new T.Matrix4().makeRotationY(0.8))
    .add(new T.Vector3(0, 4.1, 0));
  close(posedMuzzle, expectedPosed.toArray(), 'Turret/elevation/recoil articulate in source axes');
  assert.equal(gltf.nodes[names.get('gun')].extras.source_joint_name, 'pitch');
  assert.equal(gltf.nodes[names.get('collisionProxy')].mesh, undefined, 'Proxy must never render');
  assert.equal(gltf.nodes[names.get('ArmorV03')].extras.game_axes, 'Y-up,+Z-forward,+X-right');
  for (const side of ['left', 'right']) {
    const wheels = [...names.keys()].filter((n) => n.startsWith('road_wheel_' + side + '_'));
    assert.equal(wheels.length, 7);
    const meshIds = new Set(wheels.map((n) => gltf.nodes[names.get(n)].mesh));
    assert.equal(meshIds.size, 1, 'Wheel mesh is shared per side');
    close(
      origin('road_wheel_' + side + '_00'),
      [side === 'left' ? -4.28 : 4.28, 1.23, -3.9],
      'Wheel axes',
    );
  }
  const sizes = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
  const components = {
    5121: [1, 'readUInt8'],
    5123: [2, 'readUInt16LE'],
    5125: [4, 'readUInt32LE'],
    5126: [4, 'readFloatLE'],
  };
  function accessor(index) {
    const value = gltf.accessors[index],
      view = gltf.bufferViews[value.bufferView];
    const [bytes, read] = components[value.componentType],
      count = sizes[value.type];
    assert.ok(bytes && count, 'Supported accessor');
    const start = (view.byteOffset || 0) + (value.byteOffset || 0),
      stride = view.byteStride || bytes * count;
    const result = [];
    for (let i = 0; i < value.count; i++) {
      const row = [];
      for (let j = 0; j < count; j++) row.push(binary[read](start + i * stride + j * bytes));
      assert.ok(row.every(Number.isFinite));
      result.push(row);
    }
    return result;
  }
  let assembledTriangles = 0,
    uniqueTriangles = 0,
    degenerate = 0;
  const meshTriangles = [],
    bounds = new T.Box3();
  for (const mesh of gltf.meshes) {
    let triangles = 0;
    for (const primitive of mesh.primitives) {
      assert.equal(primitive.mode ?? 4, 4);
      const positions = accessor(primitive.attributes.POSITION),
        normals = accessor(primitive.attributes.NORMAL);
      const uv = accessor(primitive.attributes.TEXCOORD_0);
      assert.equal(positions.length, normals.length);
      assert.equal(positions.length, uv.length);
      assert.ok(
        normals.every((n) => Math.abs(Math.hypot(...n) - 1) < 0.002),
        'Unit normals',
      );
      const indices =
        primitive.indices === undefined
          ? positions.map((_, i) => i)
          : accessor(primitive.indices).flat();
      assert.equal(indices.length % 3, 0);
      assert.ok(indices.every((i) => Number.isInteger(i) && i >= 0 && i < positions.length));
      for (let i = 0; i < indices.length; i += 3) {
        const a = new T.Vector3(...positions[indices[i]]),
          b = new T.Vector3(...positions[indices[i + 1]]),
          c = new T.Vector3(...positions[indices[i + 2]]);
        if (b.sub(a).cross(c.sub(a)).lengthSq() < 1e-16) degenerate++;
      }
      triangles += indices.length / 3;
    }
    uniqueTriangles += triangles;
    meshTriangles.push(triangles);
  }
  for (const [index, node] of gltf.nodes.entries()) {
    if (node.mesh === undefined) continue;
    assembledTriangles += meshTriangles[node.mesh];
    for (const primitive of gltf.meshes[node.mesh].primitives)
      for (const value of accessor(primitive.attributes.POSITION))
        bounds.expandByPoint(new T.Vector3(...value).applyMatrix4(world(index)));
  }
  assert.equal(degenerate, 0, 'Nondegenerate exported triangles');
  assert.equal(
    assembledTriangles,
    record.triangles,
    'Actual assembled GLB matches Blender topology report',
  );
  assert.ok(
    assembledTriangles >= record.budget[0] && assembledTriangles <= record.budget[1],
    'LOD budget',
  );
  assert.ok(gltf.materials.length <= 3);
  assert.ok(gltf.materials.every((m) => !m.alphaMode || m.alphaMode === 'OPAQUE'));
  assert.ok(
    gltf.images.length >= 3 && gltf.images.every((i) => i.bufferView !== undefined && !i.uri),
    'Embedded paint images',
  );
  const paint = gltf.materials.find((m) => m.name === 'armor_v03_olive_paint');
  assert.ok(
    paint.pbrMetallicRoughness.baseColorTexture &&
      paint.pbrMetallicRoughness.metallicRoughnessTexture &&
      paint.normalTexture,
  );
  const dimensions = bounds.getSize(new T.Vector3());
  assert.ok(
    dimensions.x > 9 &&
      dimensions.x < 11 &&
      dimensions.y > 5 &&
      dimensions.y < 10 &&
      dimensions.z > 16 &&
      dimensions.z < 19,
    'Game-compatible tank dimensions',
  );
  results.push({
    lod: record.lod,
    passed: true,
    bytes: data.length,
    sha256: record.sha256,
    assembledTriangles,
    uniqueTriangles,
    nodes: gltf.nodes.length,
    meshes: gltf.meshes.length,
    materials: gltf.materials.map((m) => m.name),
    images: gltf.images.map((i) => ({
      name: i.name,
      mimeType: i.mimeType,
      bytes: gltf.bufferViews[i.bufferView].byteLength,
    })),
    samplers: gltf.samplers,
    muzzleWorld: origin('muzzle').toArray(),
    posedMuzzle: posedMuzzle.toArray(),
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      dimensions: dimensions.toArray(),
    },
  });
}
assert.ok(
  results.every(
    (item, i) => i === 0 || item.assembledTriangles < results[i - 1].assembledTriangles,
  ),
);
const result = {
  passed: true,
  scope:
    'CPU GLB topology/hierarchy/axis/material/embedded-image checks only; no visual/GPU/FPS/runtime-install claim',
  lods: results,
};
await writeFile(
  path.join(directory, 'validation.json'),
  JSON.stringify(result, null, 2) + '\n',
  'utf8',
);
console.log(JSON.stringify(result, null, 2));
