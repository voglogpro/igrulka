import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { tileInstances } from '../../src/rendering/terrain/instance-tiles.js';
import { freezeStaticScenery } from '../../src/rendering/performance/static-scenery.js';

function frustumAt(x) {
  const camera = new T.OrthographicCamera(-40, 40, 40, -40, 1, 300);
  camera.position.set(x, 100, 0);
  camera.up.set(0, 0, -1);
  camera.lookAt(x, 0, 0);
  camera.updateMatrixWorld();
  return new T.Frustum().setFromProjectionMatrix(
    new T.Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse),
  );
}

test('fixed scenery skips matrix work while real forest tiles retain camera/shadow bounds and clearing', () => {
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry(2, 8, 2),
    material = new T.MeshStandardMaterial(),
    source = new T.InstancedMesh(geometry, material, 4),
    records = [-600, -10, 10, 600].map((x, index) => ({ x, z: 0, index })),
    matrix = new T.Matrix4();
  source.castShadow = true;
  for (const record of records)
    source.setMatrixAt(record.index, matrix.makeTranslation(record.x, 4, 0));
  const forest = tileInstances(scene, [source], records),
    meshes = forest.chunks.flat(),
    view = frustumAt(0),
    shadow = frustumAt(600),
    visible = () =>
      meshes.map((mesh) => [view.intersectsObject(mesh), shadow.intersectsObject(mesh)]);
  scene.updateMatrixWorld(true);
  const visibility = visible(),
    transforms = meshes.map((mesh) => mesh.matrixWorld.clone()),
    bounds = meshes.map((mesh) => mesh.boundingSphere.clone());
  assert.equal(visibility.filter(([inView]) => inView).length, 2);
  assert.equal(visibility.filter(([, inShadow]) => inShadow).length, 1);
  assert.equal(freezeStaticScenery(scene), meshes.length);
  let compositions = 0,
    multiplications = 0;
  for (const mesh of meshes) {
    const update = mesh.updateMatrix,
      multiply = mesh.matrixWorld.multiplyMatrices;
    mesh.updateMatrix = function () {
      compositions++;
      return update.call(this);
    };
    mesh.matrixWorld.multiplyMatrices = function (a, b) {
      multiplications++;
      return multiply.call(this, a, b);
    };
  }
  for (let i = 0; i < 60; i++) scene.updateMatrixWorld(true);
  assert.equal(compositions, 0);
  assert.equal(multiplications, 0);
  assert.deepEqual(visible(), visibility);
  for (let i = 0; i < meshes.length; i++) {
    assert.deepEqual(meshes[i].matrixWorld.elements, transforms[i].elements);
    assert.ok(meshes[i].boundingSphere.equals(bounds[i]));
    assert.equal(meshes[i].castShadow, true);
  }
  const tree = records[1],
    mesh = tree.meshes[0],
    version = mesh.instanceMatrix.version;
  mesh.setMatrixAt(tree.index, matrix.makeScale(0, 0, 0));
  mesh.instanceMatrix.needsUpdate = true;
  mesh.getMatrixAt(tree.index, matrix);
  assert.deepEqual(matrix.elements, new T.Matrix4().makeScale(0, 0, 0).elements);
  assert.equal(
    mesh.instanceMatrix.version,
    version + 1,
    'tree clearing still reaches the GPU buffer',
  );
});

test('scenery freeze excludes lights, their moving targets, the sun disc and later mobile models', () => {
  const scene = new T.Scene(),
    fixed = new T.Group(),
    ground = new T.Mesh(new T.BoxGeometry(), new T.MeshStandardMaterial()),
    sun = new T.DirectionalLight(),
    disc = new T.Mesh(new T.SphereGeometry(), new T.MeshBasicMaterial());
  fixed.position.set(20, 3, 10);
  ground.position.set(5, 0, 2);
  fixed.add(ground);
  scene.add(fixed, sun, sun.target, disc);
  sun.position.set(40, 80, -20);
  disc.position.set(-100, 300, 20);
  const count = freezeStaticScenery(scene, { exclude: [sun, sun.target, disc] });
  assert.equal(count, 2);
  assert.equal(scene.matrixAutoUpdate, true);
  assert.equal(scene.matrixWorldAutoUpdate, true);
  for (const object of [sun, sun.target, disc]) {
    assert.equal(object.matrixAutoUpdate, true);
    assert.equal(object.matrixWorldAutoUpdate, true);
  }
  const groundMatrix = ground.matrixWorld.clone();
  sun.position.x += 25;
  sun.target.position.z += 40;
  disc.position.y += 60;
  const vehicle = new T.Group();
  vehicle.position.set(15, 0, 4);
  scene.add(vehicle);
  scene.updateMatrixWorld(true);
  assert.equal(sun.matrixWorld.elements[12], 65);
  assert.equal(sun.target.matrixWorld.elements[14], 40);
  assert.equal(disc.matrixWorld.elements[13], 360);
  assert.equal(vehicle.matrixWorld.elements[12], 15);
  assert.equal(vehicle.matrixAutoUpdate, true);
  assert.equal(vehicle.matrixWorldAutoUpdate, true);
  assert.deepEqual(ground.matrixWorld.elements, groundMatrix.elements);
});
