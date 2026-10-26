import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import * as E from '../../src/game/index.js';
import { FortificationView } from '../../src/rendering/defense/fortifications.js';
import { invalidateTrenchLinks } from '../../src/game/defense/trench-links.js';

function fixture({ visible = () => true, height = () => 0 } = {}) {
  const state = E.createGame(81205, { mode: 'multiplayer' }),
    scene = new T.Scene(),
    view = new FortificationView(scene, { height, visible });
  state.trenches = [
    {
      id: state.nextId++,
      side: 0,
      x: -1300,
      z: 200,
      yaw: Math.PI / 2,
      progress: 1,
      fortificationWork: 90,
    },
    {
      id: state.nextId++,
      side: 0,
      x: -1300,
      z: 280,
      yaw: Math.PI / 2,
      progress: 1,
      fortificationWork: 30,
    },
  ];
  return { state, scene, view };
}

test('continuous earthwork pieces meet end to end, conform to terrain and use the weaker endpoint stage', () => {
  const height = (_, z) => 2 + (z - 200) * 0.05,
    { state, view } = fixture({ height }),
    before = E.save(state);
  assert.equal(view.sync(state), true);
  assert.equal(
    E.save(state),
    before,
    'drawing must never create paid earthwork or change resources',
  );
  const link = view.links,
    pools = link.pools;
  assert.equal(link.records.size, 1);
  assert.deepEqual(
    pools.map((p) => p.count),
    [13, 13, 0],
  );
  assert.deepEqual(view.diagnostics().stages, [2, 2, 1]);
  const matrix = new T.Matrix4();
  let previous = null;
  for (let i = 0; i < pools[0].count; i++) {
    pools[0].getMatrixAt(i, matrix);
    const from = new T.Vector3(0, 0, -0.5).applyMatrix4(matrix),
      to = new T.Vector3(0, 0, 0.5).applyMatrix4(matrix);
    assert.ok(Math.abs(from.x + 1300) < 1e-5);
    assert.ok(Math.abs(from.y - (height(from.x, from.z) + 0.09)) < 1e-5);
    assert.ok(Math.abs(to.y - (height(to.x, to.z) + 0.09)) < 1e-5);
    if (previous)
      assert.ok(
        from.distanceTo(previous) < 1e-4,
        'Float32 section ends meet within a tenth of a millimetre',
      );
    else assert.ok(Math.abs(from.z - 201.6) < 1e-4);
    previous = to;
  }
  assert.ok(Math.abs(previous.z - 278.4) < 1e-4);
  for (const mesh of pools) {
    assert.ok(mesh.geometry.attributes.color);
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert.equal(mesh.material.vertexColors, true);
    assert.equal(mesh.castShadow, true);
    assert.equal(mesh.receiveShadow, true);
  }
  state.trenches[1].fortificationWork = 90;
  assert.equal(view.sync(state), true);
  assert.deepEqual(
    pools.map((p) => p.count),
    [13, 13, 13],
  );
});

test('capture keeps neutral earth colours and reuses assets while blocked or hidden links disappear', () => {
  const { state, view } = fixture(),
    pools = view.links.pools,
    resources = pools.map((p) => [p.geometry, p.material, p.instanceMatrix.array]);
  view.sync(state);
  const colors = pools.map((p) => p.geometry.attributes.color.array.slice());
  state.trenches[1].side = 1;
  invalidateTrenchLinks(state);
  assert.equal(view.sync(state), true);
  assert.equal([...view.links.records.values()][0].side, null);
  for (let i = 0; i < pools.length; i++) {
    assert.equal(pools[i].geometry, resources[i][0]);
    assert.equal(pools[i].material, resources[i][1]);
    assert.equal(pools[i].instanceMatrix.array, resources[i][2]);
    assert.deepEqual(pools[i].geometry.attributes.color.array, colors[i]);
  }
  const obstacle = {
    id: state.nextId++,
    key: 'housing',
    side: 0,
    x: -1300,
    z: 240,
    hp: E.BUILDINGS.housing.hp,
    maxHp: E.BUILDINGS.housing.hp,
    progress: 1,
  };
  state.buildings.push(obstacle);
  state.networkRevision++;
  view.sync(state);
  assert.ok(pools.every((p) => p.count === 0));
  obstacle.hp = 0;
  state.networkRevision++;
  view.sync(state);
  assert.equal(view.links.records.size, 0, 'ruins still block a new continuous trench');
  obstacle.demolished = true;
  state.networkRevision++;
  view.sync(state);
  assert.equal(view.links.records.size, 1);
  view.visible = (_, t) => t.side === 0;
  view.sync(state);
  assert.ok(
    pools.every((p) => p.count === 0),
    'both ends must be visible',
  );
  view.dispose();
  assert.equal(view.models.size, 0);
});

test('unfinished positions and open sea never produce a floating connector', () => {
  const { state, view } = fixture();
  state.trenches[1].progress = 0.5;
  view.sync(state);
  assert.equal(view.links.records.size, 0);
  for (const [i, trench] of state.trenches.entries()) {
    trench.x = 0;
    trench.z = i * 80;
    trench.progress = 1;
  }
  invalidateTrenchLinks(state);
  view.sync(state);
  assert.equal(view.links.records.size, 0);
  assert.ok(view.links.pools.every((p) => p.count === 0));
});

test('a full defensive line keeps six fixed draws and uploads nothing when only troops move', () => {
  let heightReads = 0;
  const { state, scene, view } = fixture({
    height: () => {
      heightReads++;
      return 0;
    },
  });
  state.trenches = Array.from({ length: 240 }, (_, i) => ({
    id: state.nextId++,
    side: i < 120 ? 0 : 1,
    x: -1750 + Math.floor(i / 20) * 80,
    z: -900 + (i % 20) * 80,
    progress: 1,
    fortificationWork: 90,
    yaw: Math.PI / 2,
  }));
  const soldier = E.makeGround(state, 0, 'infantry', -1500, -500);
  state.groundUnits.push(soldier);
  view.sync(state);
  assert.ok(view.links.records.size > 150);
  const meshes = [...view.pools, ...view.links.pools],
    versions = meshes.map((p) => p.instanceMatrix.version),
    rebuilds = view.links.rebuilds,
    reads = heightReads;
  assert.equal(scene.children.length, 6);
  for (let i = 0; i < 120; i++) {
    soldier.x += 1;
    state.time += 0.05;
    assert.equal(view.sync(state), false);
  }
  assert.equal(heightReads, reads);
  assert.equal(view.links.rebuilds, rebuilds);
  assert.deepEqual(
    meshes.map((p) => p.instanceMatrix.version),
    versions,
  );
  assert.ok(view.links.pools.every((p) => p.count <= view.links.capacity));
  const before = E.save(state);
  view.sync(state);
  assert.equal(E.save(state), before);
  let disposals = 0;
  for (const mesh of meshes) mesh.geometry.addEventListener('dispose', () => disposals++);
  view.dispose();
  assert.equal(disposals, 6);
  assert.equal(scene.children.length, 0);
});
