import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import * as T from '../../vendor/three/three.module.js';
import { RTSWorld } from '../../src/rendering/world.js';
import { sync } from '../../src/rendering/sync.js';
import { RoadVisualCache } from '../../src/rendering/performance/road-visual-cache.js';
import { updateSelectionCoverage } from '../../src/rendering/performance/selection-coverage.js';

function fixture() {
  const s = E.createGame(813, { mode: 'multiplayer' });
  Object.assign(s.sides[0], { credits: 100000, materials: 10000 });
  const radar = E.build(s, 0, 'radar', -1080, -10);
  assert.equal(typeof radar, 'object', String(radar));
  Object.assign(radar, { hp: radar.maxHp, progress: 1 });
  const d = E.BUILDINGS.gun;
  const gun = {
    id: s.nextId++,
    side: 0,
    key: 'gun',
    x: -1000,
    z: -10,
    hp: d.hp,
    maxHp: d.hp,
    progress: 1,
    level: 0,
  };
  s.buildings.push(gun);
  s.events = [];
  const w = {
    state: s,
    armySelection: [],
    selection: new T.Mesh(new T.RingGeometry(), new T.MeshBasicMaterial()),
    coverage: new T.Object3D(),
    callbacks: {},
    host: { classList: { toggle() {} } },
    models: new Map(),
    unitModels: new Map(),
    groundModels: new Map(),
    roadModels: new Map(),
    roadVisuals: new Map(),
    roadView: new RoadVisualCache(),
    roadBatch: { sync() {} },
    road: () => new T.Group(),
    sharedGeometries: new Set(),
    sharedMaterials: new Set(),
    renderer: { shadowMap: {} },
    groundVisibility: { sync: () => new Set() },
    infantry: { sync() {}, meshes: [] },
    vehicleBatch: { sync() {} },
    contactShadows: { sync() {} },
    syncTrenches() {},
    combatFX: { updateTracers() {} },
    visualDt: 0,
    battleTime: 0,
    model() {
      const root = new T.Group(),
        content = new T.Group();
      root.add(content);
      return { root, content, scaffold: {} };
    },
  };
  w.select = RTSWorld.prototype.select.bind(w);
  return { w, s, radar, gun };
}
const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('real world selection and sync display the working radar and effective upgraded AA radii', () => {
  const { w, s, radar, gun } = fixture();
  w.select(radar.id);
  assert.equal(w.coverage.visible, true);
  near(w.coverage.scale.x, 850);
  radar.level = 1;
  sync.call(w);
  near(w.coverage.scale.x, 1020);
  radar.level = 0;
  s.time += 0.5;
  w.select(gun.id);
  near(w.coverage.scale.x, 240.5);
  gun.level = 1;
  sync.call(w);
  near(w.coverage.scale.x, E.defenseStats(s.sides[0], gun).range * 1.3);
  gun.x = 0;
  sync.call(w);
  near(w.coverage.scale.x, E.defenseStats(s.sides[0], gun).range);
  near(w.coverage.position.x, 0);
});

test('power loss, removal, revision and paused new campaigns refresh working coverage', () => {
  const { w, s, radar, gun } = fixture();
  w.select(gun.id);
  near(w.coverage.scale.x, 240.5);
  for (let i = 0; i < 5; i++)
    s.buildings.push({
      id: s.nextId++,
      side: 0,
      key: 'electronics',
      hp: 330,
      maxHp: 330,
      progress: 1,
      x: -900,
      z: i * 40,
    });
  s.time += 0.5;
  updateSelectionCoverage(w, gun);
  near(w.coverage.scale.x, 185);
  w.select(radar.id);
  assert.equal(w.coverage.visible, false);
  s.buildings = s.buildings.filter((b) => b.key !== 'electronics');
  s.networkRevision++;
  updateSelectionCoverage(w, radar);
  assert.equal(w.coverage.visible, true);
  near(w.coverage.scale.x, 850);
  s.buildings.splice(s.buildings.indexOf(radar), 1);
  s.networkRevision++;
  w.select(gun.id);
  near(w.coverage.scale.x, 185);
  const next = E.createGame(814, { mode: 'multiplayer' });
  next.buildings.push({ ...radar, id: next.nextId++ });
  w.state = next;
  w.select(next.buildings.at(-1).id);
  assert.equal(w.coverage.visible, true);
  near(w.coverage.scale.x, 850);
});

test('same-frame calls and moving AA reuse radar scans until the bounded half-second cadence', () => {
  const { w, s, gun } = fixture();
  let scans = 0;
  s.buildings = new Proxy(s.buildings, {
    get(target, key, receiver) {
      if (key === 'filter')
        return (...args) => {
          scans++;
          return Array.prototype.filter.apply(target, args);
        };
      return Reflect.get(target, key, receiver);
    },
  });
  w.select(gun.id);
  const initial = scans;
  assert.ok(initial > 0);
  for (let i = 0; i < 100; i++) {
    gun.x += 0.01;
    updateSelectionCoverage(w, gun);
  }
  assert.equal(scans, initial);
  s.time = 0.49;
  updateSelectionCoverage(w, gun);
  assert.equal(scans, initial);
  s.time = 0.5;
  updateSelectionCoverage(w, gun);
  assert.ok(scans > initial);
});

test('infantry, multi-selection and preview ownership preserve existing coverage policies including FPV 320', () => {
  const { w, s, gun } = fixture();
  const operator = E.makeGround(s, 0, 'operator', -1000, -50);
  s.groundUnits.push(operator);
  w.select(operator.id);
  assert.equal(w.coverage.visible, false);
  w.armySelection = [operator.id];
  const proxy = new T.Group();
  proxy.userData.signature = 'operator:0:0';
  w.groundModels.set(operator.id, proxy);
  RTSWorld.prototype.setGroundTargeting.call(w, 'fpv');
  assert.equal(w.coverage.visible, true);
  near(w.coverage.scale.x, 320);
  sync.call(w);
  assert.equal(w.coverage.visible, true);
  near(w.coverage.scale.x, 320);
  w.groundTargeting = null;
  const mog = E.makeGround(s, 0, 'mog', -950, -50);
  s.groundUnits.push(mog);
  w.armySelection = [operator.id, mog.id];
  w.select(mog.id);
  assert.equal(w.coverage.visible, false);
  w.armySelection = [];
  for (const flag of ['buildKey', 'aiming', 'groundTargeting']) {
    w[flag] = true;
    w.coverage.visible = true;
    w.coverage.scale.setScalar(123);
    updateSelectionCoverage(w, gun);
    assert.equal(w.coverage.visible, true);
    near(w.coverage.scale.x, 123);
    w[flag] = null;
  }
});
