import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  appendGroundOrder,
  groundRouteStatus,
  GROUND_ROUTE_LIMIT,
} from '../../src/game/units/ground/route-queue.js';
import { groundFormationDestinations } from '../../src/game/units/ground/orders.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fresh() {
  const s = E.createGame(82);
  s.mode = 'multiplayer';
  for (const side of s.sides) {
    side.credits = side.materials = 1e6;
  }
  return s;
}
function unit(s, key = 'infantry', x = -1092, z = 250, side = 0) {
  const u = E.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}
function until(s, condition, seconds = 40) {
  const end = s.time + seconds;
  while (!condition() && s.time < end && !s.result) E.step(s, 0.05);
  assert.ok(condition(), `condition did not become true by ${s.time.toFixed(2)} seconds`);
}
function add(s, u, x, z = 250, mode = 'move') {
  assert.equal(appendGroundOrder(s, u.side, [u.id], { x, z, mode }), 1);
}
function obstacle(s, x, z) {
  const b = { id: s.nextId++, side: 0, key: 'radar', x, z, progress: 1, hp: 100, maxHp: 100 };
  s.buildings.push(b);
  s.networkRevision++;
  return b;
}

test('the first queued click starts idle, guarding and digging units immediately', () => {
  for (const state of ['idle', 'guard', 'dig']) {
    const s = fresh();
    const u = unit(s);
    if (state === 'guard') assert.equal(E.guardGround(s, 0, [u.id], u), 1);
    if (state === 'dig') assert.equal(E.commandUnits(s, 0, [u.id], 'dig'), 1);
    add(s, u, -992);
    assert.equal(u.guard, null);
    assert.equal(u.digging, false);
    assert.equal(u.order.mode, 'move');
    assert.equal(u.routeQueue.length, 0);
    E.advance(s, 1);
    assert.ok(u.x > -1082, state);
    until(s, () => !u.routeState);
    assert.ok(distance(u, { x: -992, z: 250 }) < 4);
  }
});

test('append preserves the current ordinary order and actually visits each leg in order', () => {
  const s = fresh();
  const u = unit(s);
  assert.equal(E.orderGround(s, 0, [u.id], { x: -992, z: 250 }), 1);
  const current = structuredClone(u.order);
  const path = structuredClone(u.path);
  add(s, u, -992, 350);
  add(s, u, -892, 350);
  assert.deepEqual(u.order, current);
  assert.deepEqual(u.path, path);
  const visited = [];
  let previous = JSON.stringify(u.order);
  until(s, () => {
    const next = JSON.stringify(u.order);
    if (next !== previous) {
      visited.push({ x: u.x, z: u.z, destination: { x: u.order.x, z: u.order.z } });
      previous = next;
    }
    return !u.routeState;
  });
  assert.equal(visited.length, 2);
  assert.ok(distance(visited[0], { x: -992, z: 250 }) < 4);
  assert.deepEqual(visited[0].destination, { x: -992, z: 350 });
  assert.ok(distance(visited[1], { x: -992, z: 350 }) < 4);
  assert.ok(distance(u, { x: -892, z: 350 }) < 4);
  assert.equal(groundRouteStatus(s, 0, u.id).status, 'idle');
});

test('twelve pending points fit after the active leg and the next append changes nothing', () => {
  const s = fresh();
  const u = unit(s);
  add(s, u, -992);
  for (let i = 0; i < GROUND_ROUTE_LIMIT; i++) add(s, u, -992 + i * 5, 300);
  assert.equal(u.routeQueue.length, GROUND_ROUTE_LIMIT);
  const before = structuredClone(u);
  assert.match(appendGroundOrder(s, 0, [u.id], { x: -892, z: 300 }), /12/);
  assert.deepEqual(u, before);
  assert.equal(groundRouteStatus(s, 0, u.id).points.length, 13);
});

test('mixed formation offsets are fixed when appended and survive casualties and formation changes', () => {
  const s = fresh();
  const units = ['infantry', 'apc', 'mog', 'infantry', 'machinegunner'].map((key, i) =>
    unit(s, key, -1142 + i * 12, 230),
  );
  const ids = units.map((u) => u.id);
  const a = { x: -1022, z: 250 };
  const b = { x: -922, z: 350, mode: 'attackmove' };
  const expectedA = groundFormationDestinations(s, 0, units, a);
  const expectedB = groundFormationDestinations(s, 0, units, b);
  assert.equal(appendGroundOrder(s, 0, ids, a), units.length);
  assert.equal(appendGroundOrder(s, 0, ids, b), units.length);
  for (let i = 0; i < units.length; i++) {
    assert.deepEqual({ x: units[i].order.x, z: units[i].order.z }, expectedA[i]);
    assert.deepEqual(units[i].routeQueue, [{ ...expectedB[i], mode: 'attackmove' }]);
  }
  units[0].hp = 0;
  s.formations[0] = 'column';
  until(s, () => units.slice(1).every((u) => !u.routeState));
  for (let i = 1; i < units.length; i++) {
    assert.deepEqual({ x: units[i].order.x, z: units[i].order.z }, expectedB[i]);
    assert.ok(distance(units[i], expectedB[i]) < 4);
  }
});

test('direct move, stop, guard, dig, retreat and boarding clear queues; fire and camouflage retain them', () => {
  for (const command of ['move', 'stop', 'guard', 'dig', 'retreat', 'board']) {
    const s = fresh();
    const u = unit(s);
    add(s, u, -992);
    add(s, u, -892);
    assert.equal(E.commandUnits(s, 0, [u.id], 'fire'), 1);
    assert.equal(E.commandUnits(s, 0, [u.id], 'camo'), 1);
    assert.equal(u.routeQueue.length, 1);
    assert.ok(u.routeState);
    let result;
    if (command === 'move') result = E.orderGround(s, 0, [u.id], { x: -1042, z: 350 });
    else if (command === 'guard') result = E.guardGround(s, 0, [u.id], { x: -1042, z: 350 });
    else if (command === 'board') {
      const apc = unit(s, 'apc', -1042, 350);
      result = E.boardGround(s, 0, [u.id], apc.id);
    } else result = E.commandUnits(s, 0, [u.id], command);
    assert.equal(result, 1, command);
    assert.equal(u.routeState, null, command);
    assert.deepEqual(u.routeQueue, [], command);
  }
});

test('invalid appends and refused direct commands preserve the active route', () => {
  const s = fresh();
  const u = unit(s);
  add(s, u, -992);
  add(s, u, -892);
  const before = structuredClone(u);
  for (const point of [
    null,
    [],
    { x: Infinity, z: 0 },
    { x: E.FIELD.x + 1, z: 0 },
    { x: -892, z: 300, mode: 'constructor' },
    { x: 0, z: 0 },
  ]) {
    assert.equal(typeof appendGroundOrder(s, 0, [u.id], point), 'string');
    assert.deepEqual(u, before);
  }
  assert.equal(typeof E.orderGround(s, 0, [u.id], { x: E.FIELD.x + 100, z: 0 }), 'string');
  assert.equal(typeof E.guardGround(s, 0, [u.id], { x: 0, z: 0 }), 'string');
  assert.deepEqual(u, before);
  assert.equal(groundRouteStatus(s, 1, u.id), null);
});

test('boarding, carried passengers and active deliveries refuse route appends without changes', () => {
  const s = fresh();
  const apc = unit(s, 'apc', -1072, 250);
  const u = unit(s);
  assert.equal(E.boardGround(s, 0, [u.id], apc.id), 1);
  assert.match(appendGroundOrder(s, 0, [u.id], { x: -892, z: 300 }), /посадку/);
  until(s, () => !!u.carrierId);
  assert.match(appendGroundOrder(s, 0, [u.id], { x: -892, z: 300 }), /пассажиров/);
  assert.equal(E.deliverGround(s, 0, apc.id, { x: -892, z: 300 }), 1);
  const before = structuredClone(apc);
  assert.match(appendGroundOrder(s, 0, [apc.id], { x: -842, z: 300 }), /доставку/);
  assert.deepEqual(apc, before);
});

test('delivery replaces a loaded APC route while preserving all boarded infantry', () => {
  const s = fresh();
  const apc = unit(s, 'apc', -1072, 250);
  const p = unit(s, 'infantry', -1082, 250);
  assert.equal(E.boardGround(s, 0, [p.id], apc.id), 1);
  until(s, () => p.carrierId === apc.id);
  add(s, apc, -992);
  add(s, apc, -892, 300);
  assert.equal(E.deliverGround(s, 0, apc.id, { x: -942, z: 350 }), 1);
  assert.deepEqual(apc.routeQueue, []);
  assert.equal(apc.routeState, null);
  assert.equal(p.carrierId, apc.id);
  until(s, () => !apc.delivery);
  assert.ok(distance(apc, { x: -942, z: 350 }) < 4);
  assert.equal(p.carrierId, null);
});

test('a queued march crosses the northern land corridor and continues on the far shore', () => {
  const s = fresh();
  const z = E.CORRIDORS[0];
  const u = unit(s, 'infantry', -892, z);
  add(s, u, 892, z);
  add(s, u, 922, z + 120);
  let corridorSamples = 0;
  until(
    s,
    () => {
      assert.ok(E.seaDistance(u.x, u.z) > 0, 'the march never wades into the sea');
      if (Math.abs(u.x) < 40) corridorSamples++;
      return !u.routeState;
    },
    120,
  );
  assert.ok(corridorSamples > 0);
  assert.ok(distance(u, { x: 922, z: z + 120 }) < 4);
});

test('a queued point blocked by a new building remains pending until its demolition', () => {
  const s = fresh();
  const u = unit(s);
  add(s, u, -1042);
  add(s, u, -942);
  add(s, u, -892, 350);
  const b = obstacle(s, -942, 250);
  until(s, () => u.routeState?.status === 'blocked');
  assert.equal(u.routeQueue.length, 2, 'unreachable next point must not be silently popped');
  assert.ok(distance(u, { x: -1042, z: 250 }) < 4);
  E.advance(s, 2);
  assert.equal(u.routeQueue.length, 2);
  b.hp = 0;
  b.demolished = true;
  s.networkRevision++;
  until(s, () => !u.routeState);
  assert.ok(distance(u, { x: -892, z: 350 }) < 4);
});

test('an active leg blocked after departure cannot advance to a later point through a partial A* path', () => {
  const s = fresh();
  const u = unit(s, 'apc');
  add(s, u, -942);
  add(s, u, -892, 350);
  const b = obstacle(s, -942, 250);
  until(s, () => u.routeState?.status === 'blocked');
  assert.equal(u.routeQueue.length, 1);
  assert.ok(distance(u, { x: -942, z: 250 }) > 4);
  assert.equal(u.order.x, -942);
  b.hp = 0;
  b.demolished = true;
  s.networkRevision++;
  until(s, () => !u.routeState);
  assert.ok(distance(u, { x: -892, z: 350 }) < 4);
});

test('attackmove fights a real target before proceeding to the next queued leg', () => {
  const s = fresh();
  const u = unit(s, 'leopard', -1092, 250);
  const enemy = unit(s, 'infantry', -932, 250, 1);
  enemy.holdFire = true;
  enemy.hp = enemy.maxHp = 1e5;
  add(s, u, -1032, 250, 'attackmove');
  add(s, u, -942, 350);
  E.advance(s, 4);
  assert.equal(u.routeQueue.length, 1);
  assert.equal(u.order.mode, 'attackmove');
  assert.ok(enemy.hp < enemy.maxHp, 'actual shots must hit while the queue waits');
  enemy.hp = 0;
  until(s, () => !u.routeState);
  assert.ok(distance(u, { x: -942, z: 350 }) < 4);
});

test('hold fire lets an attackmove route resume without waiting for a visible enemy', () => {
  const s = fresh();
  const u = unit(s);
  const enemy = unit(s, 'infantry', -942, 250, 1);
  enemy.holdFire = true;
  add(s, u, -1032, 250, 'attackmove');
  add(s, u, -992, 350);
  assert.equal(E.commandUnits(s, 0, [u.id], 'fire'), 1);
  until(s, () => !u.routeState);
  assert.ok(distance(u, { x: -992, z: 350 }) < 4);
});

test('active and blocked route states survive save/load, preserve pause and finish deterministically', () => {
  const s = fresh();
  const u = unit(s);
  add(s, u, -1042);
  add(s, u, -942, 300);
  E.advance(s, 1);
  const loaded = E.load(E.save(s));
  const restored = loaded.groundUnits.find((v) => v.id === u.id);
  assert.equal(loaded.version, E.VERSION);
  assert.deepEqual(restored.routeState, u.routeState);
  assert.deepEqual(restored.routeQueue, u.routeQueue);
  E.step(loaded, 0);
  assert.equal(loaded.time, s.time);
  until(s, () => !u.routeState);
  until(loaded, () => !restored.routeState);
  assert.equal(loaded.time, s.time);
  assert.deepEqual({ x: restored.x, z: restored.z }, { x: u.x, z: u.z });
  const b = obstacle(s, -892, 300);
  // It was valid when queued; occupation occurs after accepting the command.
  b.demolished = true;
  add(s, u, -912, 350);
  add(s, u, -892, 300);
  b.demolished = false;
  s.networkRevision++;
  until(s, () => u.routeState?.status === 'blocked');
  const blocked = E.load(E.save(s));
  const v = blocked.groundUnits.find((v) => v.id === u.id);
  assert.equal(groundRouteStatus(blocked, 0, v.id).status, 'blocked');
  assert.deepEqual(v.routeQueue, u.routeQueue);
});

test('side one routes remain under explicit control during a solo AI tick', () => {
  const s = fresh();
  const u = unit(s, 'apc', 1042, 250, 1);
  add(s, u, 942);
  add(s, u, 892, 350);
  s.mode = 'solo';
  s.time = 231;
  s.ai.nextArmy = 0;
  u.hp = u.maxHp * 0.2;
  E.step(s, 0.05);
  assert.equal(u.order.mode, 'move');
  assert.equal(u.routeQueue.length, 1);
  until(s, () => !u.routeState);
  assert.ok(distance(u, { x: 892, z: 350 }) < 4);
});
