import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import {
  writeInstanceMatrix,
  finishInstanceUpdates,
} from '../../src/rendering/performance/instance-updates.js';

function fixture(capacity = 16) {
  const mesh = new T.InstancedMesh(new T.BoxGeometry(), new T.MeshBasicMaterial(), capacity);
  mesh.count = 0;
  return mesh;
}

test('identical Float32 poses preserve uploads and picking bounds, including subpixel rounding', () => {
  const mesh = fixture(),
    matrix = new T.Matrix4().compose(
      new T.Vector3(0.1, 0.2, 0.3),
      new T.Quaternion().setFromEuler(new T.Euler(0.17, 0.23, 0.41)),
      new T.Vector3(1.1, 0.7, 1.3),
    );
  assert.equal(writeInstanceMatrix(mesh, 0, matrix), true);
  assert.equal(finishInstanceUpdates(mesh, 1), true);
  assert.deepEqual(mesh.instanceMatrix.array.slice(0, 16), new Float32Array(matrix.elements));
  mesh.instanceMatrix.clearUpdateRanges(); // The preceding GPU draw consumed the upload.
  mesh.computeBoundingSphere();
  const sphere = mesh.boundingSphere,
    version = mesh.instanceMatrix.version;
  for (let i = 0; i < 60; i++) {
    assert.equal(writeInstanceMatrix(mesh, 0, matrix.clone()), false);
    assert.equal(finishInstanceUpdates(mesh, 1), false);
  }
  assert.equal(mesh.instanceMatrix.version, version);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, []);
  assert.equal(mesh.boundingSphere, sphere);
  matrix.elements[12] += 1e-12;
  assert.equal(writeInstanceMatrix(mesh, 0, matrix), false, 'same Float32 transform is unchanged');
});

test('one changed instance uploads its small range and pending hidden writes cannot be lost', () => {
  const mesh = fixture(),
    matrix = new T.Matrix4().makeTranslation(10, 2, 3);
  writeInstanceMatrix(mesh, 3, matrix);
  finishInstanceUpdates(mesh, 4);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 48, count: 16 }]);
  matrix.elements[12] = 20;
  writeInstanceMatrix(mesh, 7, matrix);
  finishInstanceUpdates(mesh, 8);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 48, count: 80 }]);
  assert.equal(mesh.instanceMatrix.array[3 * 16 + 12], 10);
  assert.equal(mesh.instanceMatrix.array[7 * 16 + 12], 20);
  mesh.instanceMatrix.clearUpdateRanges();
  writeInstanceMatrix(mesh, 10, matrix);
  finishInstanceUpdates(mesh, 11);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 160, count: 16 }]);
});

test('culling count changes refresh bounds without uploading identical matrix data', () => {
  const mesh = fixture(),
    matrix = new T.Matrix4().makeTranslation(30, 0, 0);
  writeInstanceMatrix(mesh, 0, matrix);
  finishInstanceUpdates(mesh, 1);
  mesh.instanceMatrix.clearUpdateRanges();
  const version = mesh.instanceMatrix.version;
  mesh.computeBoundingSphere();
  finishInstanceUpdates(mesh, 0);
  assert.equal(mesh.visible, false);
  assert.equal(mesh.boundingSphere, null);
  assert.equal(mesh.instanceMatrix.version, version);
  finishInstanceUpdates(mesh, 1);
  assert.equal(mesh.visible, true);
  mesh.updateMatrixWorld();
  const ray = new T.Raycaster(new T.Vector3(30, 0, 10), new T.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(mesh).length, 'returning instances remain pickable');
});

test('a replacement instance buffer retains live matrices without keeping old dirty ranges', () => {
  const mesh = fixture(2),
    matrix = new T.Matrix4().makeTranslation(5, 0, 0);
  writeInstanceMatrix(mesh, 0, matrix);
  finishInstanceUpdates(mesh, 1);
  const old = mesh.instanceMatrix;
  mesh.instanceMatrix = new T.InstancedBufferAttribute(new Float32Array(4 * 16), 16);
  mesh.instanceMatrix.array.set(old.array);
  matrix.elements[12] = 12;
  writeInstanceMatrix(mesh, 2, matrix);
  finishInstanceUpdates(mesh, 3);
  assert.equal(mesh.instanceMatrix.array[12], 5);
  assert.equal(mesh.instanceMatrix.array[2 * 16 + 12], 12);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 32, count: 16 }]);
});
