import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { compileModelLods, parseGlb } from '../../native/art-source/compile_pack_v04.mjs';
import { NativeModelPack } from '../../native/parity/model-pack.mjs';
import { encodeBytes } from '../../native/parity/scene-protocol.mjs';
import groundData from '../../native/art-assets/ground-v04.json' with { type: 'json' };
import infantryData from '../../native/art-assets/infantry-v04.json' with { type: 'json' };
import { GROUND_UNITS, isInfantry } from '../../src/game/config.js';
import { sourceShaderWarmup } from '../../native/parity/art-warmup.mjs';

test('effect shader warmup uses private geometry and leaves original inactive pools intact', () => {
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry();
  geometry.setDrawRange(0, 0);
  const material = new T.ShaderMaterial({ vertexShader: 'aTint', fragmentShader: 'float across' });
  const original = new T.Mesh(geometry, material);
  original.visible = false;
  scene.add(original);
  let sourceDisposed = false;
  geometry.addEventListener('dispose', () => {
    sourceDisposed = true;
  });
  const snapshot = geometry.attributes.position.array.slice(),
    result = sourceShaderWarmup({ scene });
  assert.equal(result.objects.length, 1);
  assert.notEqual(result.objects[0].geometry, geometry);
  assert.equal(result.objects[0].material, material);
  assert.equal(result.objects[0].visible, true);
  assert.equal(geometry.drawRange.count, 0);
  assert.equal(original.visible, false);
  for (const g of result.geometries) g.dispose();
  assert.equal(sourceDisposed, false);
  assert.deepEqual(geometry.attributes.position.array, snapshot);
  assert.deepEqual(scene.children, [original]);
});

test('checked-in art covers the complete existing catalogue and preserves the cannon hardpoint', () => {
  assert.deepEqual(
    Object.keys(groundData.models).sort(),
    Object.keys(GROUND_UNITS)
      .filter((key) => !isInfantry(key) || key === 'mog')
      .sort(),
  );
  assert.deepEqual(
    Object.keys(infantryData.models)
      .filter((key) => key !== 'infantry-leg')
      .sort(),
    Object.keys(GROUND_UNITS).filter(isInfantry).sort(),
  );
  const pack = new NativeModelPack(groundData),
    root = pack.create('leopard', 0);
  root.updateMatrixWorld(true);
  const muzzle = root.getObjectByName('muzzle_00');
  assert.ok(
    muzzle.getWorldPosition(new T.Vector3()).distanceTo(new T.Vector3(0, 5.12, 11.76)) < 0.0001,
  );
  root.getObjectByName('turret').rotation.y = 0.8;
  root.getObjectByName('pitch').rotation.x = -0.3;
  root.getObjectByName('recoil').position.z = -0.5;
  root.updateMatrixWorld(true);
  const expected = new T.Vector3(0, 0, 9.06)
    .applyMatrix4(new T.Matrix4().makeRotationX(-0.3))
    .add(new T.Vector3(0, 1.02, 2.2))
    .applyMatrix4(new T.Matrix4().makeRotationY(0.8))
    .add(new T.Vector3(0, 4.1, 0));
  assert.ok(
    muzzle.getWorldPosition(new T.Vector3()).distanceTo(expected) < 0.0001,
    'Source yaw, elevation and recoil share original axes',
  );
});

test('native and compatibility binary encoders preserve byte offsets, padding and every byte value', () => {
  const buffer = globalThis.Buffer,
    descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
  try {
    globalThis.Buffer = undefined;
    for (const native of [false, true]) {
      let called = 0;
      Object.defineProperty(Uint8Array.prototype, 'toBase64', {
        configurable: true,
        value: native
          ? function () {
              called++;
              return buffer.from(this).toString('base64');
            }
          : undefined,
      });
      for (const length of [0, 1, 2, 3, 4, 255, 256, 8193]) {
        const bank = Uint8Array.from({ length: length + 11 }, (_, i) => (i * 71) % 256),
          slice = bank.subarray(5, 5 + length);
        assert.equal(encodeBytes(slice), buffer.from(slice).toString('base64'));
      }
      assert.equal(called, native ? 8 : 0);
    }
  } finally {
    globalThis.Buffer = buffer;
    if (descriptor) Object.defineProperty(Uint8Array.prototype, 'toBase64', descriptor);
    else delete Uint8Array.prototype.toBase64;
  }
});

function triangleGlb(scale = 1, { nan = false, index = 2 } = {}) {
  const data = new Float32Array([0, 0, 0, scale, 0, 0, 0, scale, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
  if (nan) data[0] = NaN;
  const binary = Buffer.alloc(80);
  Buffer.from(data.buffer).copy(binary);
  binary.writeUInt16LE(0, 72);
  binary.writeUInt16LE(1, 74);
  binary.writeUInt16LE(index, 76);
  const gltf = {
    asset: { version: '2.0' },
    buffers: [{ byteLength: 80 }],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: 36 },
      { buffer: 0, byteOffset: 36, byteLength: 36 },
      { buffer: 0, byteOffset: 72, byteLength: 6 },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, type: 'VEC3', count: 3 },
      { bufferView: 1, componentType: 5126, type: 'VEC3', count: 3 },
      { bufferView: 2, componentType: 5123, type: 'SCALAR', count: 3 },
    ],
    nodes: [
      { name: 'hull', translation: [0, 4, 0], children: [1] },
      { name: 'pitch', translation: [0, 1, 2], mesh: 0, extras: { source_joint_name: 'pitch' } },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2, material: 0 }] }],
    materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.2, 0.3, 0.2, 1] } }],
  };
  const json = Buffer.from(JSON.stringify(gltf)),
    jsonBytes = (json.length + 3) & ~3;
  const result = Buffer.alloc(12 + 8 + jsonBytes + 8 + binary.length, 32);
  result.writeUInt32LE(0x46546c67, 0);
  result.writeUInt32LE(2, 4);
  result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(jsonBytes, 12);
  result.writeUInt32LE(0x4e4f534a, 16);
  json.copy(result, 20);
  result.writeUInt32LE(binary.length, 20 + jsonBytes);
  result.writeUInt32LE(0x004e4942, 24 + jsonBytes);
  binary.copy(result, 28 + jsonBytes);
  return result;
}
test('authored LOD banks preserve original CPU hierarchy, picking and shared resource identity', () => {
  const model = compileModelLods([triangleGlb(), triangleGlb(0.8), triangleGlb(0.5)]);
  const pack = new NativeModelPack({ models: { unit: model }, textures: {} });
  const a = pack.create('unit', 0),
    b = pack.create('unit', 0);
  a.updateMatrixWorld(true);
  const pitch = a.getObjectByName('pitch');
  assert.deepEqual(pitch.getWorldPosition(new T.Vector3()).toArray(), [0, 5, 2]);
  assert.equal(pitch.children[0].geometry, b.getObjectByName('pitch').children[0].geometry);
  assert.equal(pitch.children[0].material, b.getObjectByName('pitch').children[0].material);
  const geometry = pitch.children[0].geometry;
  assert.equal(geometry.attributes.position.count, 9);
  assert.deepEqual([...geometry.index.array], [0, 1, 2]);
  assert.deepEqual(
    geometry.userData.nativeLods.map((x) => [...x.index.array]),
    [
      [3, 4, 5],
      [6, 7, 8],
    ],
  );
  const hits = new T.Raycaster(new T.Vector3(0.1, 5.1, 5), new T.Vector3(0, 0, -1)).intersectObject(
    a,
    true,
  );
  assert.ok(hits.length > 0, 'Native visual rest mesh remains selectable by original raycaster');
});
test('offline converter refuses corrupt binary, non-finite vertices and invalid indices before packaging', () => {
  const corrupt = triangleGlb();
  corrupt.writeUInt32LE(0, 8);
  assert.throws(() => parseGlb(corrupt), /header/);
  assert.throws(() => compileModelLods([triangleGlb(1, { nan: true })]), /finite/);
  assert.throws(() => compileModelLods([triangleGlb(1, { index: 99 })]), /indices/);
});
