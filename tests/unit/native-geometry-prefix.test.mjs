import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import {
  ReferencedVertexPrefixCache,
  FULL_GEOMETRY_PREFIX,
} from '../../native/parity/geometry-prefix.mjs';
import { SceneExporter } from '../../native/parity/scene-protocol.mjs';
import { markNativeImmutableGeometry } from '../../native/parity/immutable-geometry.mjs';

const decode = (attribute) => {
  const bytes = Buffer.from(attribute.data, 'base64');
  const Type =
    attribute.type === 'u16' ? Uint16Array : attribute.type === 'u32' ? Uint32Array : Float32Array;
  return [...new Type(bytes.buffer, bytes.byteOffset, bytes.byteLength / Type.BYTES_PER_ELEMENT)];
};
function fixture(index = null, count = 12) {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera();
  const geometry = new T.BufferGeometry();
  geometry.setAttribute(
    'position',
    new T.BufferAttribute(
      Float32Array.from({ length: count * 3 }, (_, i) => i),
      3,
    ),
  );
  if (index) geometry.setIndex(index);
  const material = new T.MeshStandardMaterial(),
    mesh = new T.Mesh(geometry, material);
  scene.add(mesh);
  return { scene, camera, geometry, mesh, material, exporter: new SceneExporter() };
}

test('indexed prefixes retain referenced vertex IDs instead of truncating to index count', () => {
  const s = fixture([9, 8, 7, 2, 4, 1]);
  s.geometry.setDrawRange(0, 3);
  const packet = s.exporter.capture(s.scene, s.camera, 1);
  const data = packet.definitions.geometries[0];
  assert.equal(data.attributes.position.count, 10, 'index9 needs all vertices 0..9');
  assert.equal(data.index.count, 3);
  assert.deepEqual(decode(data.index), [9, 8, 7]);
  assert.equal(decode(data.attributes.position)[9 * 3], 27);
  assert.deepEqual([...s.geometry.index.array], [9, 8, 7, 2, 4, 1]);
  assert.equal(s.geometry.attributes.position.count, 12, 'source capacity unchanged');
});

test('nonzero indexed range keeps index prefix and original shared owner/material group ranges', () => {
  const s = fixture([9, 8, 7, 2, 4, 1]);
  s.geometry.setDrawRange(3, 3);
  s.geometry.addGroup(0, 3, 0);
  s.geometry.addGroup(3, 3, 1);
  s.mesh.material = [s.material, new T.MeshBasicMaterial()];
  const other = new T.Mesh(s.geometry, s.mesh.material);
  s.scene.add(other);
  const packet = s.exporter.capture(s.scene, s.camera, 1);
  const data = packet.definitions.geometries[0];
  assert.equal(packet.definitions.geometries.length, 1);
  assert.equal(
    data.attributes.position.count,
    5,
    'unused indices before start do not enlarge the vertex prefix',
  );
  assert.deepEqual(decode(data.index), [9, 8, 7, 2, 4, 1], 'do not remap or remove index prefix');
  assert.deepEqual(data.groups, s.geometry.groups);
  for (const object of packet.frame.objects) {
    assert.deepEqual(object.drawRange, { start: 3, count: 3 });
    assert.deepEqual(
      object.materials,
      s.mesh.material.map((material) => material.uuid),
    );
    const selected = decode(data.index).slice(
      object.drawRange.start,
      object.drawRange.start + object.drawRange.count,
    );
    assert.deepEqual(selected, [2, 4, 1]);
    assert.ok(selected.every((id) => id < data.attributes.position.count));
  }
  s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(
    s.exporter.geometryPrefixes.indexScans,
    1,
    'shared/static owners reuse one cached scan',
  );
});

test('nonindexed and interleaved prefixes include start and preserve every instanced attribute', () => {
  const s = fixture(null, 10);
  const source = Float32Array.from({ length: 10 * 5 }, (_, i) => i);
  const interleaved = new T.InterleavedBuffer(source, 5);
  s.geometry.setAttribute('position', new T.InterleavedBufferAttribute(interleaved, 3, 0));
  s.geometry.setAttribute('uv', new T.InterleavedBufferAttribute(interleaved, 2, 3));
  s.geometry.setAttribute(
    'aTint',
    new T.InstancedBufferAttribute(new Float32Array(20 * 3).fill(0.7), 3),
  );
  const instanceData = new T.InstancedInterleavedBuffer(new Float32Array(15 * 4).fill(0.4), 4);
  s.geometry.setAttribute('otherTint', new T.InterleavedBufferAttribute(instanceData, 3, 0));
  s.geometry.setDrawRange(2, 4);
  const packet = s.exporter.capture(s.scene, s.camera, 1),
    data = packet.definitions.geometries[0];
  assert.equal(data.attributes.position.count, 6);
  assert.equal(data.attributes.uv.count, 6);
  assert.deepEqual(decode(data.attributes.position).slice(15), [25, 26, 27]);
  assert.deepEqual(decode(data.attributes.uv).slice(10), [28, 29]);
  assert.equal(data.attributes.aTint.count, 20);
  assert.equal(data.attributes.aTint.instanced, true);
  assert.equal(data.attributes.otherTint.count, 15);
  assert.equal(data.attributes.otherTint.instanced, true);
  assert.deepEqual(packet.frame.objects[0].drawRange, { start: 2, count: 4 });
  assert.equal(data.index, null);
});

test('range growth and shrink resend changed prefix counts without producer version changes', () => {
  const s = fixture([7, 6, 4, 3, 9, 10, 0, 1, 2]);
  s.geometry.setDrawRange(0, 3);
  const first = s.exporter.capture(s.scene, s.camera, 1).definitions.geometries[0];
  assert.equal(first.attributes.position.count, 8);
  s.geometry.setDrawRange(0, 6);
  const grown = s.exporter.capture(s.scene, s.camera, 2).frame.geometryUpdates[0];
  assert.equal(grown.attributes.position.count, 11);
  assert.equal(grown.index.count, 6);
  assert.equal(grown.attributes.position.version, first.attributes.position.version);
  assert.equal(grown.index.version, first.index.version);
  s.geometry.setDrawRange(6, 3);
  const shrunk = s.exporter.capture(s.scene, s.camera, 3).frame.geometryUpdates[0];
  assert.equal(shrunk.attributes.position.count, 3);
  assert.equal(shrunk.index.count, 9);
  s.geometry.setDrawRange(0, 9);
  const again = s.exporter.capture(s.scene, s.camera, 4).frame.geometryUpdates[0];
  assert.equal(again.attributes.position.count, 11);
  assert.equal(
    again.index,
    undefined,
    'previous index prefix already contains the whole selected window',
  );
  assert.equal(s.geometry.index.version, 0);
  assert.equal(s.geometry.attributes.position.version, 0);
});

test('scan cache tracks index identity/version/count, position count and draw range but not position version', () => {
  const s = fixture([0, 2, 1, 5, 6, 7]);
  s.geometry.setDrawRange(0, 3);
  const cache = new ReferencedVertexPrefixCache(),
    first = cache.get(s.geometry);
  for (let i = 0; i < 50; i++) assert.equal(cache.get(s.geometry), first);
  assert.equal(cache.indexScans, 1);
  s.geometry.attributes.position.needsUpdate = true;
  cache.get(s.geometry);
  assert.equal(cache.indexScans, 1);
  s.geometry.index.needsUpdate = true;
  cache.get(s.geometry);
  assert.equal(cache.indexScans, 2);
  s.geometry.setIndex(new T.BufferAttribute(new Uint16Array([0, 2, 1, 5, 6, 7]), 1));
  cache.get(s.geometry);
  assert.equal(cache.indexScans, 3);
  s.geometry.setAttribute('position', new T.BufferAttribute(new Float32Array(15 * 3), 3));
  cache.get(s.geometry);
  assert.equal(cache.indexScans, 4);
  s.geometry.setDrawRange(3, 3);
  assert.equal(cache.get(s.geometry).vertexPrefix, 8);
  assert.equal(cache.indexScans, 5);
  s.geometry.index.count = 3;
  assert.equal(cache.get(s.geometry), FULL_GEOMETRY_PREFIX, 'invalid index range falls back');
});

test('native LODs retain every vertex/index bank and clearing them restores exact prefixes', () => {
  const s = fixture([0, 1, 2, 7, 8, 9]);
  s.geometry.setDrawRange(0, 3);
  s.geometry.userData.nativeLods = [
    { distance: 0.2, index: new T.BufferAttribute(new Uint16Array([9, 10, 11]), 1) },
  ];
  const first = s.exporter.capture(s.scene, s.camera, 1).definitions.geometries[0];
  assert.equal(first.attributes.position.count, 12);
  assert.equal(first.index.count, 6);
  assert.deepEqual(decode(first.nativeLods[0].index), [9, 10, 11]);
  assert.equal(s.exporter.geometryPrefixes.indexScans, 0);
  s.geometry.userData.nativeLods = [];
  const cleared = s.exporter.capture(s.scene, s.camera, 2).frame.geometryUpdates[0];
  assert.equal(cleared.attributes.position.count, 3);
  assert.equal(cleared.index.count, 3);
  assert.deepEqual(cleared.nativeLods, []);
});

test('invalid or unknown range/index falls back to full buffers without remapping', () => {
  for (const range of [
    { start: -1, count: 3 },
    { start: 0.5, count: 3 },
    { start: 0, count: NaN },
    { start: 0, count: 2.5 },
    { start: 0, count: 99 },
    { start: 20, count: 0 },
  ]) {
    const s = fixture([0, 1, 2]);
    s.geometry.drawRange = range;
    assert.equal(new ReferencedVertexPrefixCache().get(s.geometry), FULL_GEOMETRY_PREFIX);
  }
  for (const indices of [
    [0, 50, 2],
    [0, -1, 2],
    [0, 1.5, 2],
    [0, NaN, 2],
  ]) {
    const s = fixture();
    s.geometry.setIndex(new T.BufferAttribute(new Float32Array(indices), 1));
    s.geometry.setDrawRange(0, 3);
    const cache = new ReferencedVertexPrefixCache();
    assert.equal(cache.get(s.geometry), FULL_GEOMETRY_PREFIX);
    assert.equal(cache.get(s.geometry), FULL_GEOMETRY_PREFIX);
    assert.equal(cache.indexScans, 1, 'invalid selected index result is cached too');
  }
  const s = fixture([0, 1, 2]);
  s.geometry.index.normalized = true;
  assert.equal(new ReferencedVertexPrefixCache().get(s.geometry), FULL_GEOMETRY_PREFIX);
});

test('new exporter/cache reset sends complete referenced prefixes; immutable bank remains complete', () => {
  const s = fixture([0, 1, 2, 8, 9, 10]);
  s.geometry.setDrawRange(0, 3);
  s.exporter.capture(s.scene, s.camera, 1);
  s.exporter.geometryCache.clear();
  const reset = s.exporter.capture(s.scene, s.camera, 2).definitions.geometries[0];
  assert.equal(reset.attributes.position.count, 3);
  assert.deepEqual(decode(reset.index), [0, 1, 2]);
  assert.equal(s.exporter.geometryPrefixes.indexScans, 1);
  const fresh = new SceneExporter().capture(s.scene, s.camera, 1).definitions.geometries[0];
  assert.deepEqual(decode(fresh.attributes.position), decode(reset.attributes.position));
  markNativeImmutableGeometry(s.geometry);
  const complete = new SceneExporter().capture(s.scene, s.camera, 1).definitions.geometries[0];
  assert.equal(complete.attributes.position.count, 12);
  assert.equal(complete.index.count, 6);
  s.geometry.setDrawRange(3, 3);
  assert.equal(
    new SceneExporter().capture(s.scene, s.camera, 1).definitions.geometries[0].attributes.position
      .count,
    12,
  );
});

test('source-sized tracer transport sends referenced vertices without the unused 1536-segment capacity', () => {
  const s = fixture(null, 1536 * 2);
  s.geometry.setAttribute('color', new T.BufferAttribute(new Float32Array(1536 * 2 * 3), 3));
  s.scene.remove(s.mesh);
  s.scene.add(new T.LineSegments(s.geometry, new T.LineBasicMaterial({ vertexColors: true })));
  s.geometry.setDrawRange(0, 12); // Original six-tail-segment geometry for one round.
  const data = s.exporter.capture(s.scene, s.camera, 1).definitions.geometries[0];
  assert.equal(data.attributes.position.count, 12);
  assert.equal(data.attributes.color.count, 12);
  const rawBytes = Object.values(data.attributes).reduce(
    (sum, attribute) => sum + Buffer.from(attribute.data, 'base64').length,
    0,
  );
  assert.equal(rawBytes, 288);
  assert.equal(
    (1536 * 2 * 3 * 4 * 2) / rawBytes,
    256,
    '256x less raw attribute data in this one-round fixture',
  );
  s.geometry.setDrawRange(0, 1536 * 2);
  const full = s.exporter.capture(s.scene, s.camera, 2).frame.geometryUpdates[0];
  assert.equal(full.attributes.position.count, 1536 * 2);
  assert.equal(full.attributes.color.count, 1536 * 2);
});
