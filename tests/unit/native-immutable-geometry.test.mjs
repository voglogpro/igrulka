import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { SceneExporter } from '../../native/parity/scene-protocol.mjs';
import {
  markNativeImmutableGeometry,
  isNativeImmutableGeometry,
} from '../../native/parity/immutable-geometry.mjs';

function fixture() {
  const scene = new T.Scene(),
    camera = new T.PerspectiveCamera();
  const geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial();
  const mesh = new T.InstancedMesh(geometry, material, 2);
  mesh.setMatrixAt(0, new T.Matrix4());
  mesh.count = 1;
  scene.add(mesh);
  return { scene, camera, geometry, material, mesh, exporter: new SceneExporter() };
}

test('immutable ownership uses exact geometry refs, never copied userData or LOD shape', () => {
  const s = fixture();
  s.geometry.userData.nativeImmutable = true;
  assert.equal(isNativeImmutableGeometry(s.geometry), false);
  assert.equal(markNativeImmutableGeometry(s.geometry), s.geometry);
  assert.equal(isNativeImmutableGeometry(s.geometry), true);
  assert.equal(isNativeImmutableGeometry(s.geometry.clone()), false);
  assert.throws(() => markNativeImmutableGeometry({}), /BufferGeometry/);
});

test('known immutable geometry skips attributes/groups/LOD enumeration after its first definition', () => {
  const s = fixture();
  s.geometry.userData.nativeLods = [{ distance: 0.2, index: s.geometry.index.clone() }];
  markNativeImmutableGeometry(s.geometry);
  const first = s.exporter.capture(s.scene, s.camera, 1);
  assert.equal(first.definitions.geometries.length, 1);
  assert.equal(first.definitions.geometries[0].nativeLods.length, 1);
  const attributes = s.geometry.attributes;
  s.geometry.attributes = new Proxy(attributes, {
    ownKeys() {
      throw Error('Immutable attribute enumeration was not skipped');
    },
  });
  Object.defineProperty(s.geometry, 'groups', {
    get() {
      throw Error('Immutable group enumeration was not skipped');
    },
  });
  Object.defineProperty(s.geometry.userData, 'nativeLods', {
    get() {
      throw Error('Immutable LOD enumeration was not skipped');
    },
  });
  s.mesh.position.x = 8;
  const next = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(next.definitions.geometries.length, 0);
  assert.equal(next.frame.geometryUpdates.length, 0);
  assert.equal(next.frame.objects[0].matrix[12], 8);
});

test('cache clearing, a new exporter and replacing an immutable mesh retain complete definitions', () => {
  const s = fixture();
  markNativeImmutableGeometry(s.geometry);
  s.exporter.capture(s.scene, s.camera, 1);
  s.exporter.geometryCache.clear();
  const reset = s.exporter.capture(s.scene, s.camera, 2);
  assert.ok(reset.definitions.geometries[0].attributes.position.data);
  const fresh = new SceneExporter().capture(s.scene, s.camera, 1);
  assert.ok(fresh.definitions.geometries[0].index.data);
  const replacement = markNativeImmutableGeometry(new T.SphereGeometry(2, 6, 4));
  s.mesh.geometry = replacement;
  const replaced = s.exporter.capture(s.scene, s.camera, 3);
  assert.equal(replaced.definitions.geometries[0].id, replacement.uuid);
  assert.equal(replaced.frame.objects[0].geometry, replacement.uuid);
});

test('immutable geometry leaves materials, instance transforms/poses and source geometry live', () => {
  const s = fixture();
  markNativeImmutableGeometry(s.geometry);
  const source = new T.Mesh(new T.BoxGeometry(), s.material);
  s.scene.add(source);
  s.exporter.capture(s.scene, s.camera, 1);
  s.material.color.set('#123456');
  s.mesh.setMatrixAt(0, new T.Matrix4().makeTranslation(4, 0, 0));
  s.mesh.instanceMatrix.needsUpdate = true;
  s.mesh.userData.nativePose = new T.BufferAttribute(new Float32Array([1, 2, 3, 4]), 4);
  source.geometry.attributes.position.array[0] += 1;
  source.geometry.attributes.position.needsUpdate = true;
  const changed = s.exporter.capture(s.scene, s.camera, 2);
  assert.equal(changed.frame.materialUpdates.length, 1);
  assert.equal(changed.frame.geometryUpdates.length, 1);
  assert.equal(changed.frame.geometryUpdates[0].id, source.geometry.uuid);
  const object = changed.frame.objects.find((record) => record.id === s.mesh.uuid);
  assert.ok(object.instances.matrix.data);
  assert.ok(object.instances.pose.data);
  s.mesh.visible = false;
  assert.ok(s.exporter.capture(s.scene, s.camera, 3).frame.removed.includes(s.mesh.uuid));
  s.mesh.visible = true;
  assert.ok(
    s.exporter.capture(s.scene, s.camera, 4).frame.objects.some((r) => r.id === s.mesh.uuid),
  );
});
