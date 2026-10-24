import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { groundModel } from '../../src/rendering/models/ground.js';
import { model as buildingModel } from '../../src/rendering/models/buildings.js';
import { InfantryBatch } from '../../src/rendering/models/infantry/soldiers.js';
import { infantryEquipmentGeometry } from '../../src/rendering/models/equipment.js';
import { upgradeable } from '../../src/game/combat/upgrades.js';
import * as E from '../../src/game/index.js';

function world() {
  const w = {
    scene: new T.Scene(),
    facade: new T.Texture(),
    emission: new T.Texture(),
    glowTexture: new T.Texture(),
    boxGeo: new T.BoxGeometry(),
    cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
    sphereGeo: new T.IcosahedronGeometry(1, 1),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    height: () => 0,
    clearTrees() {},
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
    armySelection: [],
  };
  w.camera = new T.OrthographicCamera(-1000, 1000, 1000, -1000, 0.1, 3000);
  w.camera.position.set(0, 1500, 0);
  w.camera.up.set(0, 0, -1);
  w.camera.lookAt(0, 0, 0);
  return w;
}
const vertices = (root) => {
  let n = 0;
  root.traverse((o) => {
    if (o.geometry) n += o.geometry.attributes.position?.count || 0;
  });
  return n;
};
const geometryIds = (root) => {
  const ids = [];
  root.traverse((o) => {
    if (o.geometry) ids.push(o.geometry.uuid);
  });
  return ids.sort();
};

test('every upgradeable vehicle has distinct tier geometry and shares templates between copies', () => {
  const w = world();
  for (const key of Object.keys(E.GROUND_UNITS).filter(
    (key) => upgradeable({ key }) && !E.isInfantry(key),
  )) {
    const models = [0, 1, 2].map((level) =>
      groundModel(w, { id: 100 + level, key, side: 0, level }),
    );
    const counts = models.map(vertices);
    assert.ok(counts[1] > counts[0], `${key} tier1`);
    assert.ok(counts[2] > counts[1], `${key} tier2`);
    assert.deepEqual(
      geometryIds(groundModel(w, { id: 200, key, side: 0, level: 2 })),
      geometryIds(models[2]),
    );
  }
});

test('all upgradeable building tiers differ while repeated buildings share geometry and materials', () => {
  const w = world();
  for (const key of Object.keys(E.BUILDINGS).filter((key) => upgradeable({ key }))) {
    const build = (level) =>
      buildingModel.call(w, { id: level + 1, key, side: 0, level, x: 0, z: 0, hp: 500 });
    const models = [0, 1, 2].map(build),
      counts = models.map((m) => vertices(m.content));
    assert.ok(counts[1] > counts[0], key + ' tier1');
    assert.ok(counts[2] > counts[1], key + ' tier2');
    const materials = w.materials.size;
    assert.deepEqual(geometryIds(build(2).root), geometryIds(models[2].root));
    assert.equal(w.materials.size, materials);
  }
});

test('all upgraded infantry use only two shared equipment draws with exact body poses and picking ids', () => {
  const w = world(),
    s = E.createGame(891);
  w.state = s;
  const batch = new InfantryBatch(w),
    units = [];
  for (const key of Object.keys(E.GROUND_UNITS).filter(
    (key) => upgradeable({ key }) && E.isInfantry(key),
  ))
    for (const level of [0, 1, 2]) {
      const u = E.makeGround(s, 0, key, 20, 250);
      u.level = level;
      units.push(u);
    }
  const ids = new Set(units.map((u) => u.id));
  batch.sync(units, 0, ids);
  assert.equal(batch.equipment.length, 2);
  const first = new T.Matrix4(),
    second = new T.Matrix4();
  for (let tier = 1; tier <= 2; tier++) {
    const mesh = batch.equipment[tier - 1];
    assert.ok(mesh.count > 0);
    assert.equal(mesh.material, batch.material);
    assert.equal(mesh.geometry, infantryEquipmentGeometry(tier));
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    for (const u of units.filter((u) => u.level === tier)) {
      const equipmentIndex = mesh.userData.unitIds.indexOf(u.id);
      assert.ok(equipmentIndex >= 0, u.key);
      const body = batch.pools.get(u.key + u.side).body;
      body.getMatrixAt(body.userData.unitIds.indexOf(u.id), first);
      mesh.getMatrixAt(equipmentIndex, second);
      assert.deepEqual(first.elements, second.elements);
    }
    for (const u of units.filter((u) => !u.level))
      assert.ok(!mesh.userData.unitIds.slice(0, mesh.count).includes(u.id));
  }
  const geometries = batch.equipment.map((m) => m.geometry);
  batch.sync([], 1, new Set());
  assert.ok(batch.equipment.every((m) => m.count === 0 && !m.visible));
  batch.sync(units, 2, ids);
  assert.deepEqual(
    batch.equipment.map((m) => m.geometry),
    geometries,
  );
  assert.equal(infantryEquipmentGeometry(0), null);
});
