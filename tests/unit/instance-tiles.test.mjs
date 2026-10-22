import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { tileInstances } from '../../src/rendering/terrain/instance-tiles.js';
import { clearTrees } from '../../src/rendering/terrain/environment.js';
test('forest tiles preserve every tree and its color; each camera can cull distant tiles', () => {
  const geo = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial();
  const source = new T.InstancedMesh(geo, material, 4);
  source.castShadow = true;
  const matrix = new T.Matrix4();
  const records = [
    { x: 30, z: 30 },
    { x: 50, z: 70 },
    { x: 1000, z: 1000 },
    { x: 1020, z: 1010 },
  ];
  for (const [i, p] of records.entries()) {
    source.setMatrixAt(i, matrix.makeTranslation(p.x, 2, p.z));
    source.setColorAt(i, new T.Color(i % 2 ? '#ff0000' : '#00ff00'));
    p.index = i;
  }
  const scene = new T.Scene(),
    forest = tileInstances(scene, [source], records);
  assert.equal(forest.chunks.length, 2);
  assert.equal(
    scene.children.reduce((n, m) => n + m.count, 0),
    4,
  );
  for (const p of records) {
    const m = p.meshes[0];
    m.getMatrixAt(p.index, matrix);
    assert.equal(matrix.elements[12], p.x);
    assert.equal(m.geometry, geo);
    assert.equal(m.material, material);
    assert.ok(m.castShadow);
  }
  const camera = new T.OrthographicCamera(0, 200, 200, 0, 0.1, 100);
  camera.position.set(0, 30, 0);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const frustum = new T.Frustum().setFromProjectionMatrix(
    new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
  assert.ok(!frustum.intersectsObject(forest.chunks[1][0]));
  clearTrees.call({ trees: records, forest }, 30, 30, 5);
  records[0].meshes[0].getMatrixAt(records[0].index, matrix);
  assert.equal(matrix.elements[0], 0);
  records[1].meshes[0].getMatrixAt(records[1].index, matrix);
  assert.equal(matrix.elements[0], 1);
  const color = new T.Color();
  records[1].meshes[0].getColorAt(records[1].index, color);
  assert.equal(color.getHex(), 0xff0000);
});
