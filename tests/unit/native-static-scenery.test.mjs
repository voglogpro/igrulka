import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as T from '../../vendor/three/three.module.js';
import { SceneExporter, shaderFamily } from '../../native/parity/scene-protocol.mjs';
import {
  registerStaticWorld,
  getStaticCapturePlan,
  notifyStaticTreeInstancesChanged,
} from '../../native/parity/static-scenery-cache.mjs';
import { nativeStaticSceneryTransform } from '../../native/parity/static-scenery-transform.mjs';
import { NativeTransport, GodotRenderer } from '../../native/parity/godot-renderer.mjs';

function fixture(tilePairs = 3) {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera(45, 1.6, 0.1, 9000);
  const geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial({ color: '#456734' });
  const trees = [],
    meshes = [],
    matrix = new T.Matrix4();
  for (let pair = 0; pair < tilePairs; pair++) {
    const parts = [];
    for (let part = 0; part < 2; part++) {
      const mesh = new T.InstancedMesh(geometry, material, 2);
      for (let i = 0; i < 2; i++)
        mesh.setMatrixAt(i, matrix.makeTranslation(pair * 30 + i, part * 8, 0));
      scene.add(mesh);
      parts.push(mesh);
      meshes.push(mesh);
    }
    trees.push({ index: 0, meshes: parts }, { index: 1, meshes: parts });
  }
  scene.updateMatrixWorld(true);
  for (const mesh of meshes) mesh.matrixAutoUpdate = mesh.matrixWorldAutoUpdate = false;
  const dynamic = new T.Mesh(geometry, material);
  scene.add(dynamic);
  const world = { scene, trees };
  assert.equal(registerStaticWorld(world), true);
  return { world, scene, camera, geometry, material, meshes, dynamic };
}
const stripIdentity = (value) =>
  Array.isArray(value)
    ? value.map(stripIdentity)
    : value && typeof value === 'object'
      ? Object.fromEntries(
          Object.entries(value)
            .filter(([key]) => key !== 'identity')
            .map(([key, item]) => [key, stripIdentity(item)]),
        )
      : value;
function receiver() {
  return { objects: new Map(), geometries: new Map(), materials: new Map(), textures: new Map() };
}
function apply(state, packet) {
  if (packet.reset) for (const map of Object.values(state)) map.clear();
  for (const kind of ['geometries', 'materials', 'textures']) {
    for (const value of [
      ...packet.definitions[kind],
      ...(packet.frame[
        kind === 'geometries'
          ? 'geometryUpdates'
          : kind === 'materials'
            ? 'materialUpdates'
            : 'textureUpdates'
      ] || []),
    ]) {
      const old = state[kind].get(value.id) || {};
      state[kind].set(value.id, {
        ...old,
        ...stripIdentity(value),
        ...(value.attributes
          ? { attributes: { ...old.attributes, ...stripIdentity(value.attributes) } }
          : {}),
      });
    }
  }
  for (const object of packet.frame.objects) {
    const old = state.objects.get(object.id);
    state.objects.set(object.id, {
      ...stripIdentity(object),
      ...(object.instances
        ? { instances: { ...old?.instances, ...stripIdentity(object.instances) } }
        : {}),
    });
  }
  for (const id of packet.frame.removed) state.objects.delete(id);
  return state;
}
const sorted = (map) => [...map].sort(([a], [b]) => a.localeCompare(b));
function pair(s) {
  const fast = new SceneExporter(),
    full = new SceneExporter({ useStaticScenery: false });
  const actual = receiver(),
    expected = receiver();
  let seq = 0;
  return {
    fast,
    frame() {
      seq++;
      const reference = full.capture(s.scene, s.camera, seq),
        packet = fast.capture(s.scene, s.camera, seq);
      apply(expected, reference);
      apply(actual, packet);
      for (const kind of Object.keys(actual))
        assert.deepEqual(
          sorted(actual[kind]),
          sorted(expected[kind]),
          'resident vs complete ' + kind,
        );
      return packet;
    },
  };
}

test('exact tree residents preserve full-scene output while avoiding static traversal/matrix/resource calls', () => {
  const s = fixture(),
    q = pair(s);
  q.frame();
  for (const mesh of s.meshes) {
    mesh.updateMatrixWorld = () => {
      throw Error('resident tree matrix walk');
    };
    mesh.traverseVisible = () => {
      throw Error('resident tree traversal');
    };
  }
  // Reference exporter deliberately still traverses; prove the optimized frame independently here.
  const packet = q.fast.capture(s.scene, s.camera, 2);
  assert.equal(packet.frame.objects.length, 0);
  assert.equal(q.fast.diagnostics().staticSkipped, 6);
  assert.equal(q.fast.objectCache.size, 7);
  assert.equal(q.fast.diagnostics().leaves, 7);
});

test('tree clearing, equal-version buffer replacement and pending edits remain captured', () => {
  const s = fixture(),
    q = pair(s);
  q.frame();
  const tree = s.world.trees[0];
  for (const mesh of tree.meshes) {
    mesh.setMatrixAt(tree.index, new T.Matrix4().makeScale(0, 0, 0));
    mesh.instanceMatrix.needsUpdate = true;
    notifyStaticTreeInstancesChanged(s.world, mesh);
  }
  let packet = q.frame();
  assert.equal(packet.frame.objects.length, 2);
  const mesh = s.meshes[0],
    data = new Float32Array(mesh.instanceMatrix.array);
  data[12] = 45;
  mesh.instanceMatrix = new T.InstancedBufferAttribute(data, 16);
  packet = q.frame();
  assert.equal(packet.frame.objects.length, 1);
  assert.equal(packet.frame.objects[0].instances.matrix.version, 0);
  assert.equal(q.frame().frame.objects.length, 0);
});

test('resident shared material color, uniforms, texture transforms and geometry attributes stay live', () => {
  const s = fixture();
  const texture = new T.Texture({ width: 1, height: 1 });
  s.material.map = texture;
  const encodeTexture = () => 'data:image/png;base64,YQ==';
  const fast = new SceneExporter({ encodeTexture });
  fast.capture(s.scene, s.camera, 1);
  s.material.color.set('#aabb44');
  s.material.opacity = 0.7;
  texture.offset.set(0.2, 0.3);
  s.geometry.attributes.position.setX(0, 12);
  s.geometry.attributes.position.needsUpdate = true;
  let packet = fast.capture(s.scene, s.camera, 2);
  assert.equal(packet.frame.materialUpdates.length, 1);
  assert.equal(packet.frame.textureUpdates.length, 1);
  assert.equal(packet.frame.geometryUpdates.length, 1);
  assert.equal(packet.frame.objects.length, 0);
  const shader = new T.ShaderMaterial({
    uniforms: { daylight: { value: 0.4 }, overcast: { value: 0 } },
  });
  s.meshes[0].material = shader;
  fast.capture(s.scene, s.camera, 3);
  shader.uniforms.daylight.value = 0.8;
  packet = fast.capture(s.scene, s.camera, 4);
  assert.equal(
    packet.frame.materialUpdates.find((m) => m.id === shader.uuid).uniforms.daylight,
    0.8,
  );
});

test('tree visibility, material visibility, empty counts and scene hide/show match complete capture', () => {
  const s = fixture(),
    q = pair(s);
  q.frame();
  s.meshes[0].visible = false;
  assert.equal(q.frame().frame.removed.length, 1);
  s.meshes[0].visible = true;
  assert.equal(q.frame().frame.objects.length, 1);
  s.meshes[1].count = 0;
  q.frame();
  s.meshes[1].count = 2;
  q.frame();
  s.material.visible = false;
  q.frame();
  s.material.visible = true;
  q.frame();
  s.scene.visible = false;
  assert.equal(q.frame().frame.removed.length, 7);
  s.scene.visible = true;
  assert.equal(q.frame().frame.objects.length, 7);
});

test('unknown owners, removal/reparenting, unfreezing and owner replacement fall back without losing poses', () => {
  const s = fixture(),
    q = pair(s);
  q.frame();
  const group = new T.Group();
  s.scene.add(group);
  s.meshes[0].matrixAutoUpdate = s.meshes[0].matrixWorldAutoUpdate = true;
  group.add(s.meshes[0]);
  group.position.x = 20;
  assert.equal(getStaticCapturePlan(s.scene), null);
  q.frame();
  s.scene.add(s.meshes[0]);
  s.meshes[0].updateMatrixWorld(true);
  s.meshes[0].matrixAutoUpdate = s.meshes[0].matrixWorldAutoUpdate = false;
  assert.ok(getStaticCapturePlan(s.scene));
  q.frame();
  const unknown = new T.Mesh(s.geometry, s.material);
  s.scene.add(unknown);
  q.frame();
  unknown.position.x = 17;
  s.dynamic.position.y = 9;
  q.frame();
  s.scene.remove(unknown);
  q.frame();
  s.world.trees = [...s.world.trees];
  assert.equal(getStaticCapturePlan(s.scene), null);
  q.frame();
});

test('scene replacement and native reset retain no old resident object IDs', () => {
  const a = fixture(),
    b = fixture(1),
    exporter = new SceneExporter();
  exporter.capture(a.scene, a.camera, 1);
  const packet = exporter.capture(b.scene, b.camera, 2);
  assert.equal(packet.frame.removed.length, 7);
  assert.equal(exporter.objectCache.size, 3);
  assert.ok(
    [...exporter.objectCache.keys()].every((id) => !a.meshes.some((mesh) => mesh.uuid === id)),
  );
  const fresh = new SceneExporter().capture(b.scene, b.camera, 1);
  assert.equal(fresh.frame.objects.length, 3);
  assert.ok(fresh.definitions.geometries.length);
});

test('clearTrees native-only transform retains original producer and has an exact source guard', async () => {
  const source = await readFile(
    new URL('../../src/rendering/terrain/environment.js', import.meta.url),
    'utf8',
  );
  const result = nativeStaticSceneryTransform('/src/rendering/terrain/environment.js', source);
  assert.ok(
    result.includes(
      'mesh.instanceMatrix.needsUpdate = true;\n        notifyStaticTreeInstancesChanged(this, mesh);',
    ),
  );
  assert.equal(nativeStaticSceneryTransform('/src/game/index.js', source), source);
  assert.throws(
    () =>
      nativeStaticSceneryTransform(
        '/src/rendering/terrain/environment.js',
        source.replace('mesh.instanceMatrix.needsUpdate = true;', 'differentProducer();'),
      ),
    /expected 1/,
  );
});

test('native geometry LODs track index identity/version/count/distance and explicit clearing', () => {
  const s = fixture(1),
    exporter = new SceneExporter();
  const indices = new T.BufferAttribute(new Uint16Array([0, 1, 2]), 1);
  s.geometry.userData.nativeLods = [{ distance: 20, index: indices }];
  let packet = exporter.capture(s.scene, s.camera, 1);
  assert.equal(packet.definitions.geometries[0].nativeLods[0].index.count, 3);
  assert.equal(exporter.capture(s.scene, s.camera, 2).frame.geometryUpdates.length, 0);
  indices.setX(0, 1);
  indices.needsUpdate = true;
  packet = exporter.capture(s.scene, s.camera, 3);
  assert.equal(packet.frame.geometryUpdates[0].nativeLods[0].index.version, 1);
  const replacement = new T.BufferAttribute(new Uint16Array([2, 1, 0]), 1);
  replacement.needsUpdate = true;
  const oldIdentity = packet.frame.geometryUpdates[0].nativeLods[0].index.identity;
  s.geometry.userData.nativeLods = [{ distance: 20, index: replacement }];
  packet = exporter.capture(s.scene, s.camera, 4);
  assert.equal(packet.frame.geometryUpdates[0].nativeLods[0].index.version, 1);
  assert.notEqual(packet.frame.geometryUpdates[0].nativeLods[0].index.identity, oldIdentity);
  s.geometry.userData.nativeLods[0].distance = 45;
  assert.equal(
    exporter.capture(s.scene, s.camera, 5).frame.geometryUpdates[0].nativeLods[0].distance,
    45,
  );
  replacement.array = new Uint16Array([0, 1, 2, 2, 1, 0]);
  replacement.count = 6;
  assert.equal(
    exporter.capture(s.scene, s.camera, 6).frame.geometryUpdates[0].nativeLods[0].index.count,
    6,
  );
  delete s.geometry.userData.nativeLods;
  assert.deepEqual(exporter.capture(s.scene, s.camera, 7).frame.geometryUpdates[0].nativeLods, []);
});

test('native infantry family and pose payload retain active count, identity changes and clearing', () => {
  const s = fixture(1),
    exporter = new SceneExporter();
  const material = new T.ShaderMaterial({ uniforms: { clock: { value: 2 } } });
  material.userData.nativeFamily = 'infantry';
  assert.equal(shaderFamily(material), 'infantry');
  const mesh = s.meshes[0];
  mesh.material = material;
  mesh.userData.nativePose = new T.InstancedBufferAttribute(
    new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 9, 9]),
    4,
  );
  let packet = exporter.capture(s.scene, s.camera, 1);
  const first = packet.frame.objects.find((o) => o.id === mesh.uuid).instances.pose;
  assert.equal(first.count, 2);
  assert.equal(Buffer.from(first.data, 'base64').length, 2 * 4 * 4);
  assert.equal(packet.definitions.materials.find((m) => m.id === material.uuid).uniforms.clock, 2);
  assert.equal(exporter.capture(s.scene, s.camera, 2).frame.objects.length, 0);
  mesh.userData.nativePose = new T.BufferAttribute(new Float32Array(8).fill(3), 4);
  packet = exporter.capture(s.scene, s.camera, 3);
  assert.notEqual(packet.frame.objects[0].instances.pose.identity, first.identity);
  mesh.userData.nativePose.needsUpdate = true;
  assert.equal(exporter.capture(s.scene, s.camera, 4).frame.objects[0].instances.pose.version, 1);
  delete mesh.userData.nativePose;
  assert.equal(exporter.capture(s.scene, s.camera, 5).frame.objects[0].instances.pose, null);
  mesh.userData.nativePose = new T.BufferAttribute(new Float32Array(4), 4);
  assert.throws(() => exporter.capture(s.scene, s.camera, 6), /nativePose/);
});

test('tree dirty notifications during pending native frame coalesce into latest buffered poses', async () => {
  const s = fixture(1),
    sent = [];
  const webview = {
    postMessage(value) {
      sent.push(value);
    },
    addEventListener() {},
  };
  const transport = new NativeTransport(webview);
  transport.receive({ kind: 'native-ready', protocol: 1 });
  const renderer = new GodotRenderer({ transport, canvas: { dataset: {}, style: {} } });
  renderer.render(s.scene, s.camera);
  const first = sent.find((value) => value.kind === 'scene');
  s.meshes[0].setMatrixAt(0, new T.Matrix4().makeTranslation(20, 0, 0));
  s.meshes[0].instanceMatrix.needsUpdate = true;
  notifyStaticTreeInstancesChanged(s.world, s.meshes[0]);
  renderer.render(s.scene, s.camera);
  s.meshes[0].setMatrixAt(0, new T.Matrix4().makeTranslation(55, 0, 0));
  s.meshes[0].instanceMatrix.needsUpdate = true;
  notifyStaticTreeInstancesChanged(s.world, s.meshes[0]);
  renderer.render(s.scene, s.camera);
  assert.equal(sent.filter((value) => value.kind === 'scene').length, 1);
  transport.receive({ kind: 'scene-ack', seq: first.seq });
  await Promise.resolve();
  const second = sent.filter((value) => value.kind === 'scene')[1];
  const bytes = Buffer.from(
    second.frame.objects.find((o) => o.id === s.meshes[0].uuid).instances.matrix.data,
    'base64',
  );
  assert.equal(bytes.readFloatLE(12 * 4), 55);
  transport.receive({ kind: 'scene-ack', seq: second.seq });
  await Promise.resolve();
});
