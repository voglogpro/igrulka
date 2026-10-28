import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import * as E from '../../src/game/index.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { InfantryBatch } from '../../src/rendering/models/infantry/soldiers.js';

function fixture(count) {
  const state = E.createGame(8111),
    units = Array.from({ length: count }, (_, i) => {
      const u = E.makeGround(
        state,
        0,
        'infantry',
        -500 + (i % 100) * 10,
        -300 + Math.floor(i / 100) * 10,
      );
      u.level = 1;
      return u;
    }),
    world = {
      state,
      armySelection: units.map((u) => u.id),
      scene: new T.Scene(),
      boxGeo: new T.BoxGeometry(),
      cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
      materials: new Map(),
      sharedGeometries: new Set(),
      sharedMaterials: new Set(),
      mat: RTSWorld.prototype.mat,
      box: RTSWorld.prototype.box,
      cyl: RTSWorld.prototype.cyl,
      camera: new T.OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 3000),
    };
  world.camera.position.set(0, 1500, 0);
  world.camera.up.set(0, 0, -1);
  world.camera.lookAt(0, 0, 0);
  const batch = new InfantryBatch(world),
    visible = new Set(units.map((u) => u.id));
  return { units, world, batch, visible };
}

test('large visible armies keep all bodies, equipment and selection rings in shared growing draws', () => {
  const { units, world, batch, visible } = fixture(5000);
  // A selection lookup must use a set, not rescan thousands of selected IDs per unit.
  world.armySelection.includes = () => {
    throw new Error('quadratic selection scan');
  };
  batch.sync(units.slice(0, 1), 0, visible);
  const pool = batch.pools.get('infantry0'),
    meshes = [pool.body, pool.legs, batch.equipment[0], batch.selected],
    resources = meshes.map((m) => [m.geometry, m.material]),
    oldMatrices = meshes.map((m) => m.instanceMatrix);
  let resourceDisposals = 0,
    bufferDisposals = 0;
  for (const [geometry, material] of resources) {
    geometry.addEventListener('dispose', () => resourceDisposals++);
    material.addEventListener('dispose', () => resourceDisposals++);
  }
  for (const mesh of meshes) mesh.addEventListener('dispose', () => bufferDisposals++);
  batch.sync(units, 1, visible);
  assert.equal(pool.body.count, 5000);
  assert.equal(pool.legs.count, 10000);
  assert.equal(batch.equipment[0].count, 5000);
  assert.equal(batch.selected.count, 5000);
  assert.equal(batch.meshes.length, 4, 'growth never creates more role/equipment draws');
  for (let i = 0; i < meshes.length; i++) {
    assert.equal(meshes[i].geometry, resources[i][0]);
    assert.equal(meshes[i].material, resources[i][1]);
    assert.notEqual(meshes[i].instanceMatrix, oldMatrices[i]);
    assert.ok(meshes[i].instanceMatrix.count >= meshes[i].count);
  }
  assert.equal(resourceDisposals, 0);
  assert.ok(bufferDisposals >= 4, 'replaced instance buffers release GPU bindings');
  const matrices = meshes.map((m) => m.instanceMatrix);
  batch.sync(units, 1.05, visible);
  assert.deepEqual(
    meshes.map((m) => m.instanceMatrix),
    matrices,
  );
  const last = units.at(-1),
    ray = new T.Raycaster(new T.Vector3(last.x, 30, last.z), new T.Vector3(0, -1, 0));
  world.scene.updateMatrixWorld(true);
  assert.ok(
    ray
      .intersectObjects(batch.meshes)
      .some((hit) => hit.object.userData.unitIds[hit.instanceId] === last.id),
    'the last soldier remains selectable beyond old role/equipment capacities',
  );
});

test('animation invalidates picking bounds without aggregate matrix scans in every frame', () => {
  const { units, world, batch, visible } = fixture(90);
  batch.sync(units, 0, visible);
  const pool = batch.pools.get('infantry0'),
    ray = new T.Raycaster();
  let sphereScans = 0;
  for (const mesh of batch.meshes) {
    const compute = mesh.computeBoundingSphere;
    mesh.computeBoundingSphere = function () {
      sphereScans++;
      return compute.call(this);
    };
  }
  for (let i = 1; i <= 60; i++) batch.sync(units, i * 0.016, visible);
  assert.equal(sphereScans, 0, 'rendering does not rescan matrices for click-only bounds');
  const pick = () => {
    world.scene.updateMatrixWorld(true);
    ray.set(new T.Vector3(units[0].x, 30, units[0].z), new T.Vector3(0, -1, 0));
    return ray
      .intersectObjects(batch.meshes)
      .some((hit) => hit.object.userData.unitIds[hit.instanceId] === units[0].id);
  };
  assert.ok(pick());
  assert.ok(sphereScans > 0);
  units[0].x = 800;
  batch.sync(units, 2, visible);
  assert.equal(pool.body.boundingSphere, null);
  assert.ok(pick(), 'lazy bounds are refreshed after moving out of the previous sphere');
});

test('500 paused equipped soldiers reuse GPU data and bounds while a real pose change updates only its instances', () => {
  const { units, world, batch, visible } = fixture(500);
  batch.sync(units, 0, visible);
  const pool = batch.pools.get('infantry0'),
    meshes = [pool.body, pool.legs, batch.equipment[0], batch.selected];
  for (const mesh of meshes) {
    mesh.instanceMatrix.clearUpdateRanges();
    mesh.computeBoundingSphere();
  }
  const versions = meshes.map((m) => m.instanceMatrix.version),
    spheres = meshes.map((m) => m.boundingSphere),
    arrays = meshes.map((m) => m.instanceMatrix.array.slice());
  for (let i = 0; i < 30; i++) batch.sync(units, 0, visible);
  assert.deepEqual(
    meshes.map((m) => m.instanceMatrix.version),
    versions,
  );
  assert.deepEqual(
    meshes.map((m) => m.boundingSphere),
    spheres,
  );
  assert.ok(meshes.every((m, i) => m.instanceMatrix.array.every((v, j) => v === arrays[i][j])));
  units[0].x = 900;
  batch.sync(units, 0, visible);
  assert.deepEqual(
    meshes.map((m) => m.instanceMatrix.updateRanges),
    [
      [{ start: 0, count: 16 }],
      [{ start: 0, count: 32 }],
      [{ start: 0, count: 16 }],
      [{ start: 0, count: 16 }],
    ],
  );
  assert.ok(meshes.every((m) => m.boundingSphere === null));
  world.scene.updateMatrixWorld(true);
  const ray = new T.Raycaster(new T.Vector3(900, 30, units[0].z), new T.Vector3(0, -1, 0));
  assert.ok(
    ray
      .intersectObjects(batch.meshes)
      .some((hit) => hit.object.userData.unitIds[hit.instanceId] === units[0].id),
  );
});
