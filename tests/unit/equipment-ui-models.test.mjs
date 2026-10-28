import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import * as T from '../../vendor/three/three.module.js';
import {
  equipmentHTML,
  supplyHTML,
  updateEquipmentDetails,
} from '../../src/ui/equipment-detail.js';
import { model } from '../../src/rendering/models/buildings.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { groundModel } from '../../src/rendering/models/ground.js';

test('equipment inspector follows cash availability, paid tier and real launch cadence', () => {
  const state = E.createGame(8911),
    unit = E.makeGround(state, 0, 'gepard', -850, 250);
  state.groundUnits.push(unit);
  state.sides[0].credits = 0;
  assert.match(equipmentHTML(state, unit), /data-upgrade="\d+" disabled/);
  state.sides[0].credits = 10000;
  const quote = E.upgradeStatus(state, 0, unit.id);
  assert.match(equipmentHTML(state, unit), new RegExp(`Улучшить · ${quote.cost} ₡`));
  E.upgradeDefense(state, 0, unit.id);
  assert.match(equipmentHTML(state, unit), /108% → 116%/);
  E.upgradeDefense(state, 0, unit.id);
  assert.doesNotMatch(equipmentHTML(state, unit), /data-upgrade/);
  assert.equal(equipmentHTML(state, { ...unit, side: 1 }), '');
  const factory = { id: 999, key: 'factory', side: 0, hp: 100, progress: 1, level: 0 };
  state.buildings.push(factory);
  assert.match(equipmentHTML(state, factory), /Выпуск/);
  assert.doesNotMatch(equipmentHTML(state, factory), /Темп пуска/);
  factory.launchStore = { drone: 1, heavy: 0 };
  assert.match(supplyHTML(state, factory), /Склад завода: 1/);
  assert.doesNotMatch(supplyHTML(state, factory), /Пуск/);
});

test('supply refreshes preserve an unchanged upgrade button DOM subtree', () => {
  const state = E.createGame(8914),
    site = {
      id: 999,
      key: 'launcher',
      side: 0,
      hp: 100,
      progress: 1,
      level: 0,
      launchStore: { drone: 1 },
    };
  state.buildings.push(site);
  state.sides[0].credits = 10000;
  const contents = new Map(
      ['[data-supply-content]', '[data-equipment-content]'].map((key) => [
        key,
        {
          writes: 0,
          set innerHTML(value) {
            this.html = value;
            this.writes++;
          },
        },
      ]),
    ),
    host = { querySelector: (selector) => contents.get(selector) };
  updateEquipmentDetails(host, state, site);
  site.launchStore.drone = 0;
  updateEquipmentDetails(host, state, site);
  assert.equal(contents.get('[data-equipment-content]').writes, 1);
  assert.equal(contents.get('[data-supply-content]').writes, 2);
  site.level = 1;
  updateEquipmentDetails(host, state, site);
  assert.equal(contents.get('[data-equipment-content]').writes, 2);
});

function worldFixture() {
  return {
    scene: new T.Scene(),
    facade: null,
    emission: null,
    glowTexture: null,
    height: () => 0,
    clearTrees() {},
    boxGeo: new T.BoxGeometry(1, 1, 1),
    cylGeo: new T.CylinderGeometry(1, 1, 1, 12),
    sphereGeo: new T.IcosahedronGeometry(1, 1),
    materials: new Map(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    mat: RTSWorld.prototype.mat,
    box: RTSWorld.prototype.box,
    cyl: RTSWorld.prototype.cyl,
  };
}
function geometryIds(root) {
  const ids = [];
  root.traverse((o) => {
    if (o.geometry) ids.push(o.geometry.uuid);
  });
  return ids;
}
test('building tiers retain independent aiming pivots and reuse immutable geometry within each tier', () => {
  const world = worldFixture();
  for (const key of ['gun', 'sam', 'launcher', 'silo', 'ammofactory']) {
    const entity = { id: 1, key, side: 0, hp: 100, x: 0, z: 0, level: 0 };
    const a = model.call(world, entity),
      b = model.call(world, { ...entity, id: 2, x: 50 });
    assert.deepEqual(geometryIds(a.root), geometryIds(b.root), key);
    assert.equal(b.root.position.x, 50);
    assert.notEqual(a.content, b.content);
    if (a.root.userData.turret) {
      assert.notEqual(a.root.userData.turret, b.root.userData.turret);
      assert.ok(b.root.userData.turret.parent);
    }
    const upgraded = model.call(world, { ...entity, id: 3, level: 2 });
    assert.notDeepEqual(
      geometryIds(upgraded.root),
      geometryIds(a.root),
      `${key} tier must alter visible geometry`,
    );
    assert.deepEqual(
      geometryIds(upgraded.root),
      geometryIds(model.call(world, { ...entity, id: 4, level: 2 }).root),
    );
  }
});
test('mobile MOG tiers use distinct fortifications while same-tier copies share geometry', () => {
  const world = worldFixture(),
    u = { id: 11, key: 'mog', side: 0, level: 0 },
    a = groundModel(world, u),
    b = groundModel(world, { ...u, id: 12 }),
    upgraded = groundModel(world, { ...u, id: 13, level: 2 });
  assert.deepEqual(geometryIds(a), geometryIds(b));
  assert.equal(a.userData.fieldPosition.userData.equipmentLevel, 0);
  assert.equal(upgraded.userData.fieldPosition.userData.equipmentLevel, 2);
  assert.notDeepEqual(geometryIds(a), geometryIds(upgraded));
});
