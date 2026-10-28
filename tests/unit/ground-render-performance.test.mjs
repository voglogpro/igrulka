import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { RoadVisualCache } from '../../src/rendering/performance/road-visual-cache.js';
import { VehicleBatch } from '../../src/rendering/performance/vehicle-batch.js';
import { ContactShadows } from '../../src/rendering/performance/contact-shadows.js';
import { ShadowBudget } from '../../src/rendering/performance/shadow-budget.js';
import { road } from '../../src/rendering/terrain/roads.js';
import { RTSWorld } from '../../src/rendering/world.js';

test('road cache detects topology and health changes while reusing its frame buffers', () => {
  const cache = new RoadVisualCache();
  const road = { id: 1, side: 0, ax: 0, az: 0, bx: 20, bz: 0, hp: 100, maxHp: 100 };
  const passable = (r) => r.hp > 0;
  cache.update([road], passable);
  assert.equal(cache.layoutChanged, true);
  const roads = cache.roads,
    changed = cache.changed;
  for (let i = 0; i < 100; i++) {
    cache.update([road], passable);
    assert.equal(cache.layoutChanged, false);
    assert.equal(cache.changed.length, 0);
    assert.equal(cache.roads, roads);
    assert.equal(cache.changed, changed);
  }
  road.hp = 30;
  cache.update([road], passable);
  assert.equal(cache.layoutChanged, false);
  assert.deepEqual(cache.changed, [road]);
  road.bx = 40;
  cache.update([road], passable);
  assert.equal(cache.layoutChanged, true);
  road.connectorTo = 7;
  cache.update([road], passable);
  assert.equal(cache.layoutChanged, true);
  road.removed = true;
  cache.update([road], passable);
  assert.equal(cache.layoutChanged, true);
  assert.equal(cache.roads.length, 0);
  assert.equal(cache.records.size, 0);
});

test('a hundred decorated roads share a bounded set of draws and lamp assets', () => {
  const world = {
    scene: new T.Scene(),
    boxGeo: new T.BoxGeometry(),
    cylGeo: new T.CylinderGeometry(),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    glowTexture: new T.Texture(),
    clearTrees() {},
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
  };
  const models = new Map();
  const roads = Array.from({ length: 100 }, (_, i) => ({
    id: i + 1,
    side: 0,
    ax: i * 80,
    az: 0,
    bx: i * 80,
    bz: 60,
    hp: 100,
    maxHp: 100,
    progress: 1,
  }));
  const network = roads.map((r) => ({
    a: { x: r.ax, z: r.az },
    b: { x: r.bx, z: r.bz },
    width: 10,
    index: r.id,
  }));
  for (const r of roads) models.set(r.id, road.call(world, r, network));
  const batch = new VehicleBatch(world.scene);
  batch.sync(models);
  assert.ok(batch.diagnostics().batches <= 6, 'road count must not multiply draw calls');
  const pools = [...models.values()].map((root) =>
    root.children.find((m) => m.material === world.roadGlowMaterial),
  );
  assert.ok(pools.every((m) => m && m.geometry === world.roadGlowGeometry));
  const groups = batch.groups.size;
  batch.sync(new Map());
  batch.sync(models);
  assert.equal(batch.groups.size, groups);
  batch.dispose();
});

test('shared vehicle draws preserve turret matrices, visibility, proxy ray picking and ownership', () => {
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry(2, 2, 4),
    material = new T.MeshStandardMaterial();
  const create = (id, x) => {
    const root = new T.Group();
    root.userData.groundId = id;
    root.position.x = x;
    const body = new T.Mesh(geometry, material);
    body.castShadow = true;
    root.add(body);
    const turret = new T.Group();
    turret.position.y = 2;
    root.add(turret);
    turret.add(new T.Mesh(geometry, material));
    root.userData.turret = turret;
    scene.add(root);
    return root;
  };
  const a = create(1, 0),
    b = create(2, 10),
    models = new Map([
      [1, a],
      [2, b],
    ]),
    batch = new VehicleBatch(scene);
  let geometryDisposals = 0,
    materialDisposals = 0;
  geometry.addEventListener('dispose', () => geometryDisposals++);
  material.addEventListener('dispose', () => materialDisposals++);
  batch.sync(models);
  assert.equal(batch.diagnostics().batches, 1);
  const group = [...batch.groups.values()][0];
  assert.equal(group.count, 4);
  a.position.x = 3;
  a.userData.turret.rotation.y = 0.6;
  batch.sync(models);
  const matrix = new T.Matrix4();
  group.mesh.getMatrixAt(1, matrix);
  const expected = a.userData.turret.children[0].matrixWorld.elements;
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(matrix.elements[i] - expected[i]) < 1e-5);
  const ray = new T.Raycaster(new T.Vector3(3, 0, 20), new T.Vector3(0, 0, -1));
  assert.ok(ray.intersectObject(a, true).length, 'hidden render proxies remain pickable');
  b.visible = false;
  batch.sync(models);
  assert.equal(group.count, 2);
  a.userData.turret.visible = false;
  batch.sync(models);
  assert.equal(group.count, 1);
  models.clear();
  batch.sync(models);
  assert.equal(group.mesh.count, 0);
  assert.equal(batch.records.size, 0);
  batch.dispose();
  assert.equal(batch.groups.size, 0);
  assert.equal(geometryDisposals, 0);
  assert.equal(materialDisposals, 0);
  geometry.dispose();
  material.dispose();
});

test('unchanged vehicle batches retain GPU matrices and a turret updates only its shared slot', () => {
  const scene = new T.Scene(),
    geometry = new T.BoxGeometry(),
    material = new T.MeshStandardMaterial(),
    models = new Map();
  for (let i = 0; i < 250; i++) {
    const root = new T.Group(),
      turret = new T.Group();
    root.position.x = i * 12;
    root.add(new T.Mesh(geometry, material));
    turret.position.y = 2;
    turret.add(new T.Mesh(geometry, material));
    root.add(turret);
    root.userData.turret = turret;
    scene.add(root);
    models.set(i, root);
  }
  const batch = new VehicleBatch(scene);
  batch.sync(models);
  const mesh = [...batch.groups.values()][0].mesh,
    version = mesh.instanceMatrix.version;
  mesh.instanceMatrix.clearUpdateRanges();
  for (let i = 0; i < 30; i++) batch.sync(models);
  assert.equal(mesh.instanceMatrix.version, version);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, []);
  models.get(0).userData.turret.rotation.y = 0.4;
  batch.sync(models);
  assert.deepEqual(mesh.instanceMatrix.updateRanges, [{ start: 16, count: 16 }]);
  const expected = models.get(0).userData.turret.children[0].matrixWorld;
  assert.deepEqual(mesh.instanceMatrix.array.slice(16, 32), new Float32Array(expected.elements));
  assert.equal(mesh.count, 500);
  batch.dispose();
});

test('contact shadows follow movement every sync and never become delayed sun-map casters', () => {
  const scene = new T.Scene(),
    shadows = new ContactShadows(scene, 2);
  const unit = { id: 1, key: 'leopard', hp: 100, x: -1000, z: -1360, yaw: 0 };
  shadows.sync([unit], new Set([1]));
  assert.equal(shadows.mesh.count, 1);
  assert.equal(shadows.mesh.castShadow, false);
  unit.x += 18;
  unit.z += 4;
  unit.yaw = 0.5;
  shadows.sync([unit], new Set([1]));
  const matrix = new T.Matrix4();
  shadows.mesh.getMatrixAt(0, matrix);
  assert.ok(Math.abs(matrix.elements[12] - unit.x) < 1e-4);
  assert.ok(Math.abs(matrix.elements[14] - unit.z) < 1e-4);
  shadows.sync([unit], new Set());
  assert.equal(shadows.mesh.count, 0);
  let disposed = 0;
  for (const owned of [shadows.geometry, shadows.material, shadows.texture])
    owned.addEventListener('dispose', () => disposed++);
  shadows.dispose();
  assert.equal(disposed, 3);
  assert.ok(!scene.children.includes(shadows.mesh));
});

test('static shadow budget adapts only from actual shadow frames and ignores long suspensions', () => {
  const budget = new ShadowBudget();
  budget.observeFrame(0.3);
  assert.equal(budget.mapSize, 4096);
  budget.lastWasShadow = true;
  budget.observeFrame(0.2);
  assert.equal(budget.interval, 2);
  assert.equal(budget.mapSize, 4096);
  assert.equal(budget.observeFrame(0.2), true);
  assert.equal(budget.mapSize, 2048);
  budget.observeFrame(0.2);
  assert.equal(budget.observeFrame(0.2), true);
  assert.equal(budget.mapSize, 1024);
  assert.equal(budget.observeFrame(10), false);
});
