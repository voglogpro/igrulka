import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  moveCivicVehicle,
  moveGroundUnit,
  groundMovementMetrics,
  GROUND_RECOVERY_PATHS_PER_STEP,
} from '../../src/game/units/ground/movement.js';
import { groundStepClear } from '../../src/game/units/ground/navigation.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const radius = (u) =>
  u.stationId != null || u.depotId != null ? 3 : E.GROUND_UNITS[u.key].size * 0.42;
function fresh(coop = false) {
  const s = E.createGame(81255, coop ? { mode: 'coop' } : { mode: 'multiplayer' });
  s.rules.rear = false;
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 10000;
    f.materials = 1000;
  }
  for (const p of [s.ai, ...Object.values(s.aiBySide || {})])
    p.nextBuild = p.nextAttack = p.nextArmy = 1e9;
  return s;
}
function ready(s, key, side = 0, dx = 65, dz = -10) {
  const hq = E.hqOf(s, side),
    b = E.build(s, side, key, hq.x + dx, hq.z + dz);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function mog(s, x, z, side = 0) {
  const u = E.makeGround(s, side, 'mog', x, z);
  u.guard = { x, z };
  u.setup = 1;
  u.holdFire = true;
  s.groundUnits.push(u);
  return u;
}
function ammo(s, x, z, goal, side = 0, depot = null) {
  depot ||= ready(s, 'factory', side);
  const v = {
    id: s.nextId++,
    side,
    depotId: depot.id,
    slot: 0,
    x,
    z,
    y: E.groundHeight(x, z) + 1,
    hp: E.AMMUNITION.vehicle.hp,
    maxHp: E.AMMUNITION.vehicle.hp,
    yaw: 0,
    home: { ...goal },
    goal: { ...goal },
    path: [{ ...goal }],
    status: 'returning',
    targetId: null,
    targetKind: null,
    pickup: null,
    cargo: { kind: 'weapon', key: 'drone', amount: 1 },
    retryAt: 0,
    revision: s.networkRevision,
  };
  s.ammoVehicles.push(v);
  return v;
}
function service(s, x, z, goal, side = 0, station = null) {
  station ||= ready(s, 'service', side, -65);
  const v = {
    id: s.nextId++,
    side,
    stationId: station.id,
    x,
    z,
    yaw: 0,
    state: 'returning',
    target: null,
    path: [{ ...goal }],
    roadIds: [],
    revision: s.networkRevision,
    thinkAt: s.time + 100,
    dispatchCursor: 0,
  };
  s.serviceVehicles.push(v);
  return v;
}
function tick(s, seconds, inspect = () => {}) {
  for (let n = 0; n < Math.round(seconds * 20); n++) {
    s.time += 0.05;
    for (const v of [...s.ammoVehicles, ...s.serviceVehicles]) {
      const before = { x: v.x, z: v.z };
      moveCivicVehicle(s, v, 0.05, 32);
      assert.ok(distance(before, v) <= 1.6 + 1e-6, 'steering preserves finite travel speed');
      assert.ok(groundStepClear(s, before, v, 3));
    }
    inspect();
  }
}
function separated(units) {
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++)
      assert.ok(
        distance(units[i], units[j]) >= radius(units[i]) + radius(units[j]) + 0.34,
        `overlap ${units[i].id}/${units[j].id}`,
      );
}

test('both civic fleets bypass a deployed MOG while preserving its post and their paid mission schemas', () => {
  const s = fresh(),
    fixed = mog(s, -1392, -400),
    a = ammo(s, -1492, -400, { x: -1292, z: -400 }),
    b = service(s, -1292, -400, { x: -1492, z: -400 });
  const stationary = structuredClone(fixed),
    cargo = structuredClone(a.cargo),
    keys = [Object.keys(a), Object.keys(b)];
  let detour = 0;
  tick(s, 20, () => {
    separated([fixed, a, b]);
    detour = Math.max(detour, Math.abs(a.z + 400), Math.abs(b.z + 400));
  });
  assert.equal(a.path.length, 0);
  assert.equal(b.path.length, 0);
  assert.ok(detour > 3 + radius(fixed));
  assert.deepEqual(fixed, stationary);
  assert.deepEqual(a.cargo, cargo);
  assert.deepEqual(
    [Object.keys(a), Object.keys(b)],
    keys,
    'no civic moving/repathAt/navRevision fields added',
  );
  assert.equal(a.status, 'returning');
  assert.equal(b.state, 'returning');
});

test('all four owners share physical fleet avoidance without treating foreign vans as pass-through objects', () => {
  const s = fresh(true),
    vans = [];
  for (const side of [0, 1, 2, 3]) {
    const z = -700 + side * 70;
    vans.push(
      ammo(s, -1300, z, { x: -1292, z }, side),
      service(s, -1100, z, { x: -1492, z }, side),
    );
  }
  tick(s, 16, () => separated(vans));
  assert.ok(vans.every((v) => !v.path.length));
});

test('opposite-heading allied and hostile vans both keep their physical footprints', () => {
  for (const otherSide of [1, 2]) {
    const s = fresh(true),
      a = ammo(s, -1492, -400, { x: -1292, z: -400 }, 0),
      b = service(s, -1292, -400, { x: -1492, z: -400 }, otherSide);
    tick(s, 15, () => separated([a, b]));
    assert.equal(a.path.length, 0);
    assert.equal(b.path.length, 0);
  }
});

test('cold save continuation retains hp-less repair vans, finite cargo and exact avoidance trajectories', () => {
  const s = fresh();
  mog(s, -1392, -400);
  ammo(s, -1492, -400, { x: -1292, z: -400 });
  service(s, -1292, -400, { x: -1492, z: -400 });
  tick(s, 2);
  const cold = E.load(E.save(s));
  tick(s, 12);
  tick(cold, 12);
  const view = (state) =>
    [...state.ammoVehicles, ...state.serviceVehicles].map((v) => ({
      id: v.id,
      x: v.x,
      z: v.z,
      yaw: v.yaw,
      path: v.path,
      cargo: v.cargo,
      status: v.status,
      state: v.state,
    }));
  assert.deepEqual(view(cold), view(s));
  assert.equal(cold.ammoVehicles[0].cargo.amount, 1);
  assert.equal(Object.hasOwn(cold.serviceVehicles[0], 'hp'), false);
});

test('actual ammo dispatch drives around a fixed MOG and delivers only its loaded weapon', () => {
  const s = fresh(),
    factory = ready(s, 'factory'),
    silo = E.build(s, 0, 'silo', -992, 250);
  assert.equal(typeof silo, 'object');
  silo.progress = 1;
  silo.hp = silo.maxHp;
  s.sides[0].inventory.cruise = 1;
  s.sides[0].credits = 0;
  E.step(s, 0.05);
  const van = s.ammoVehicles.find((v) => v.cargo?.key === 'cruise');
  assert.ok(van);
  const point = van.path.find((p) => distance(p, van) > 30 && distance(p, silo) > 40);
  assert.ok(point);
  const fixed = mog(s, point.x, point.z),
    stationary = structuredClone(fixed);
  for (let i = 0; i < 1200 && silo.launchStore.cruise !== 1; i++) {
    const before = { x: van.x, z: van.z };
    E.step(s, 0.05);
    assert.ok(distance(van, before) <= 1.6 + 1e-6);
    separated([fixed, van]);
    assert.equal(
      (s.sides[0].inventory.cruise || 0) +
        s.ammoVehicles.reduce(
          (sum, v) => sum + (v.cargo?.key === 'cruise' ? v.cargo.amount : 0),
          0,
        ) +
        (silo.launchStore.cruise || 0),
      1,
    );
  }
  assert.equal(silo.launchStore.cruise, 1);
  assert.deepEqual(fixed.guard, stationary.guard);
  assert.equal(factory.hp, factory.maxHp);
});

test('actual repair dispatch bypasses a fixed MOG before charging for local repairs', () => {
  const s = fresh();
  ready(s, 'service', 0, -65, -80);
  const hq = E.hqOf(s, 0),
    target = E.build(s, 0, 'housing', hq.x + 55, hq.z - 80);
  assert.equal(typeof target, 'object');
  target.progress = 1;
  target.hp = target.maxHp - 120;
  E.step(s, 0.05);
  const van = s.serviceVehicles.find((v) => v.target?.id === target.id);
  assert.ok(van);
  const point = van.path.find((p) => distance(p, van) > 20 && distance(p, target) > 25);
  assert.ok(point);
  const fixed = mog(s, point.x, point.z),
    post = structuredClone(fixed.guard);
  for (let i = 0; i < 1000 && target.hp < target.maxHp; i++) {
    const before = { x: van.x, z: van.z };
    E.step(s, 0.05);
    assert.ok(distance(van, before) <= 1.6 + 1e-6);
    separated([fixed, van]);
  }
  assert.equal(target.hp, target.maxHp);
  assert.deepEqual(fixed.guard, post);
  assert.equal(Object.hasOwn(van, 'moving'), false);
});

test('500 marching soldiers and both van fleets reuse one local index despite harmless fleet-array copies', () => {
  const s = fresh(),
    units = [];
  for (let i = 0; i < 500; i++) {
    const x = -1942 + (i % 20) * 24,
      z = -850 + Math.floor(i / 20) * 24,
      u = E.makeGround(s, 0, 'infantry', x, z);
    u.path = [{ x: x + 150, z }];
    u.order = { x: x + 150, z, mode: 'move' };
    s.groundUnits.push(u);
    units.push(u);
  }
  const a = ammo(s, -1992, -150, { x: -1792, z: -150 }),
    b = service(s, -1992, -100, { x: -1792, z: -100 });
  s.time = 0.05;
  moveCivicVehicle(s, a, 0.05, 32);
  s.ammoVehicles = [...s.ammoVehicles];
  let fleetMembershipReads = 0;
  s.serviceVehicles = new Proxy([...s.serviceVehicles], {
    get(target, key, receiver) {
      if (key === 'every') fleetMembershipReads++;
      return Reflect.get(target, key, receiver);
    },
  });
  for (const u of units) moveGroundUnit(s, u, 0.05, 17);
  moveCivicVehicle(s, b, 0.05, 32);
  const metrics = groundMovementMetrics(s);
  assert.equal(metrics.indexBuilds, 1);
  assert.equal(metrics.replans, 0);
  assert.ok(metrics.checks < 502 * 100, JSON.stringify(metrics));
  assert.equal(metrics.moves, 502);
  assert.equal(
    fleetMembershipReads,
    1,
    'copied fleet membership is not scanned again for each soldier',
  );
});

test('army and civic static recoveries share two slots and keep final destinations without adding van clocks', () => {
  const s = fresh(),
    depot = ready(s, 'factory'),
    station = ready(s, 'service', 0, -65);
  for (let z = -700; z <= -200; z += 20)
    s.buildings.push({
      id: s.nextId++,
      key: 'housing',
      side: 0,
      x: -1392,
      z,
      r: 10,
      hp: 100,
      maxHp: 100,
      progress: 1,
    });
  s.networkRevision++;
  const vans = [
    ammo(s, -1406, -680, { x: -1352, z: -680 }, 0, depot),
    service(s, -1406, -580, { x: -1352, z: -580 }, 0, station),
  ];
  for (let i = 0; i < 4; i++) {
    const u = E.makeGround(s, 0, 'leopard', -1406, -480 + i * 60);
    u.path = [{ x: -1352, z: u.z }];
    u.order = { ...u.path[0], mode: 'move' };
    s.groundUnits.push(u);
  }
  const goals = vans.map((v) => ({ ...v.path.at(-1) }));
  for (let n = 0; n < 100; n++) {
    s.time += 0.05;
    for (const v of vans) moveCivicVehicle(s, v, 0.05, 32);
    for (const u of s.groundUnits) moveGroundUnit(s, u, 0.05, 20);
    assert.ok(groundMovementMetrics(s).replans <= GROUND_RECOVERY_PATHS_PER_STEP);
  }
  for (let i = 0; i < vans.length; i++) {
    assert.equal(Object.hasOwn(vans[i], 'repathAt'), false);
    assert.equal(Object.hasOwn(vans[i], 'navRevision'), false);
    assert.ok(distance(vans[i].path.at(-1) || vans[i], goals[i]) <= 1);
  }
});
