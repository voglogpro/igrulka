import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  deliverGround,
  transportDeliveryStatus,
  DELIVERY_RETRY_SECONDS,
  updateTransportDeliveries,
} from '../../src/game/units/vehicles/transport-orders.js';
import {
  planGroundUnload,
  UNLOAD_RADII,
  UNLOAD_SLOTS_PER_RING,
} from '../../src/game/units/vehicles/transport.js';
import { damageGround } from '../../src/game/units/ground/combat.js';

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const destination = { x: -680, z: 250 };

function fresh() {
  const s = E.createGame(82);
  s.mode = 'multiplayer';
  for (const side of s.sides) {
    side.credits = side.materials = 1e6;
  }
  return s;
}

function unit(s, key, point, side = 0) {
  const u = E.makeGround(s, side, key, point.x, point.z);
  s.groundUnits.push(u);
  return u;
}

function until(s, condition, seconds = 30) {
  const end = s.time + seconds;
  while (!condition() && s.time < end && !s.result) E.step(s, 0.05);
  assert.ok(condition(), `condition did not become true by ${s.time.toFixed(2)} seconds`);
}

function loaded(keys = ['assault', 'mog', 'infantry', 'engineer'], side = 0) {
  const s = fresh();
  const apc = unit(s, 'apc', { x: -850, z: 250 }, side);
  const passengers = keys.map((key, i) => unit(s, key, { x: apc.x - 6, z: apc.z + i - 2 }, side));
  assert.equal(
    E.boardGround(
      s,
      side,
      passengers.map((u) => u.id),
      apc.id,
    ),
    keys.length,
  );
  until(s, () => passengers.every((u) => u.carrierId === apc.id), 3);
  return { s, apc, passengers };
}

function blockade(s, center) {
  const units = [];
  for (const ring of UNLOAD_RADII)
    for (let i = 0; i < UNLOAD_SLOTS_PER_RING; i++) {
      const angle = (i * Math.PI * 2) / UNLOAD_SLOTS_PER_RING;
      units.push(
        unit(s, 'infantry', {
          x: center.x + Math.cos(angle) * ring,
          z: center.z + Math.sin(angle) * ring,
        }),
      );
    }
  return units;
}

function assertLanded(s, apc, passengers) {
  assert.equal(apc.delivery, null);
  assert.equal(apc.order, null);
  assert.equal(new Set(passengers.map((p) => `${p.x},${p.z}`)).size, passengers.length);
  for (const p of passengers) {
    assert.equal(p.carrierId, null);
    assert.equal(p.boardingId, null);
    assert.ok(distance(p, apc) <= UNLOAD_RADII.at(-1) + 1e-6);
    assert.equal(E.walkable(s, p.x, p.z, E.GROUND_UNITS[p.key].size * 0.42), true);
    assert.equal(p.prevX, p.x);
    assert.equal(p.prevZ, p.z);
    assert.deepEqual(p.path, []);
  }
}

test('a full mixed APC actually drives and unloads all eight seats through the simulation tick', () => {
  const { s, apc, passengers } = loaded();
  const initial = { x: apc.x, z: apc.z };
  assert.equal(deliverGround(s, 0, apc.id, destination), 4);
  assert.deepEqual({ x: apc.x, z: apc.z }, initial, 'issuing an order must not teleport the APC');
  assert.deepEqual(transportDeliveryStatus(s, 0, apc.id), {
    status: 'moving',
    passengers: 4,
    seats: 8,
    capacity: 8,
    point: destination,
    error: null,
  });
  E.advance(s, 1);
  assert.ok(distance(apc, initial) > 20 && distance(apc, initial) < 33);
  assert.ok(passengers.every((p) => p.carrierId === apc.id && distance(p, apc) < 0.01));
  until(s, () => !apc.delivery);
  assert.ok(distance(apc, destination) < 4);
  assertLanded(s, apc, passengers);
  const mog = passengers.find((u) => u.key === 'mog');
  assert.equal(mog.setup, 0, 'transported MOG must deploy again after unloading');
  E.advance(s, 3.1);
  assert.equal(mog.setup, 1);
});

test('boarding reservations count members and reject new boarding during delivery', () => {
  const { s, apc, passengers } = loaded();
  const ninth = unit(s, 'infantry', { x: apc.x - 10, z: apc.z });
  assert.equal(typeof E.boardGround(s, 0, [ninth.id], apc.id), 'string');
  assert.equal(deliverGround(s, 0, apc.id, destination), passengers.length);
  passengers.at(-1).hp = 0;
  assert.match(E.boardGround(s, 0, [ninth.id], apc.id), /доставку/);
  assert.equal(ninth.boardingId, undefined);
  assert.equal(E.commandUnits(s, 0, [apc.id], 'stop'), 1);
  assert.equal(E.boardGround(s, 0, [ninth.id], apc.id), 1, 'dead passengers must release seats');
});

test('empty, foreign, pending boarding and invalid destination refusals preserve current orders', () => {
  const s = fresh();
  const apc = unit(s, 'apc', { x: -850, z: 250 });
  assert.match(deliverGround(s, 0, apc.id, destination), /посадите/);
  assert.equal(typeof deliverGround(s, 1, apc.id, destination), 'string');
  assert.equal(transportDeliveryStatus(s, 1, apc.id), null);
  const p = unit(s, 'infantry', { x: -930, z: 250 });
  assert.equal(E.boardGround(s, 0, [p.id], apc.id), 1);
  assert.match(deliverGround(s, 0, apc.id, destination), /Дождитесь посадки/);
  until(s, () => p.carrierId === apc.id, 10);
  assert.equal(deliverGround(s, 0, apc.id, destination), 1);
  const mission = structuredClone(apc.delivery);
  const order = structuredClone(apc.order);
  for (const point of [null, [], { x: NaN, z: 0 }, { x: E.FIELD.x + 1, z: 0 }, { x: 0, z: 0 }]) {
    assert.equal(typeof deliverGround(s, 0, apc.id, point), 'string');
    assert.deepEqual(apc.delivery, mission);
    assert.deepEqual(apc.order, order);
  }
});

test('a repeated valid delivery retargets the same passengers without duplicating them', () => {
  const { s, apc, passengers } = loaded(['infantry', 'machinegunner']);
  assert.equal(deliverGround(s, 0, apc.id, destination), 2);
  E.advance(s, 1);
  const next = { x: -830, z: 390 };
  assert.equal(deliverGround(s, 0, apc.id, next), 2);
  assert.deepEqual(transportDeliveryStatus(s, 0, apc.id).point, next);
  until(s, () => !apc.delivery);
  assert.ok(distance(apc, next) < 4);
  assertLanded(s, apc, passengers);
  assert.equal(s.groundUnits.length, 3);
});

test('accepted move, stop, guard and retreat cancel delivery while passengers stay aboard', () => {
  for (const command of ['move', 'stop', 'guard', 'retreat']) {
    const { s, apc, passengers } = loaded(['infantry']);
    assert.equal(deliverGround(s, 0, apc.id, destination), 1);
    const result =
      command === 'move'
        ? E.orderGround(s, 0, [apc.id], { x: -820, z: 390 })
        : command === 'guard'
          ? E.guardGround(s, 0, [apc.id], { x: -820, z: 390 })
          : E.commandUnits(s, 0, [apc.id], command);
    assert.equal(result, 1, command);
    assert.equal(apc.delivery, null, `${command} must cancel immediately`);
    E.advance(s, 10);
    assert.equal(passengers[0].carrierId, apc.id, `${command} must not later auto-unload`);
  }
});

test('manual unload cancels the delivery and cannot trigger a second remote unload', () => {
  const { s, apc, passengers } = loaded(['assault', 'infantry']);
  assert.equal(deliverGround(s, 0, apc.id, destination), 2);
  E.advance(s, 1);
  assert.equal(E.unloadGround(s, 0, apc.id), 2);
  assertLanded(s, apc, passengers);
  const stopped = { x: apc.x, z: apc.z };
  E.advance(s, 8);
  assert.deepEqual({ x: apc.x, z: apc.z }, stopped);
  assert.equal(E.unloadGround(s, 0, apc.id), 0);
});

test('delivery and passengers survive a current-version save and finish after loading', () => {
  const { s, apc } = loaded();
  assert.equal(deliverGround(s, 0, apc.id, destination), 4);
  E.advance(s, 1);
  const restored = E.load(E.save(s));
  assert.equal(restored.version, E.VERSION);
  const v = restored.groundUnits.find((u) => u.id === apc.id);
  assert.deepEqual(v.delivery, apc.delivery);
  const passengers = restored.groundUnits.filter((p) => p.carrierId === v.id);
  assert.equal(passengers.length, 4);
  const paused = E.save(restored);
  E.step(restored, 0);
  assert.equal(E.save(restored), paused, 'paused ticks must not advance route or retries');
  until(restored, () => !v.delivery);
  assertLanded(restored, v, passengers);
  assert.equal(new Set(restored.groundUnits.map((u) => u.id)).size, restored.groundUnits.length);
});

test('a fully occupied landing refuses the command before mutating the carrier', () => {
  const { s, apc, passengers } = loaded(['infantry', 'infantry']);
  blockade(s, destination);
  assert.match(deliverGround(s, 0, apc.id, destination), /места для высадки/);
  assert.equal(apc.delivery, undefined);
  assert.equal(apc.order, null);
  assert.ok(passengers.every((p) => p.carrierId === apc.id));
});

test('a landing occupied after departure waits atomically and retries on game time', () => {
  const { s, apc, passengers } = loaded(['infantry', 'assault']);
  assert.equal(deliverGround(s, 0, apc.id, destination), 2);
  const blockers = blockade(s, destination);
  until(s, () => apc.delivery?.status === 'blocked');
  assert.ok(
    passengers.every((p) => p.carrierId === apc.id),
    'never unload only half a delivery',
  );
  const retryAt = apc.delivery.retryAt;
  assert.ok(retryAt > s.time && retryAt <= s.time + DELIVERY_RETRY_SECONDS + 1e-6);
  const waiting = { x: apc.x, z: apc.z },
    pendingPath = structuredClone(apc.path),
    budget = s.sides.map((side) => [side.credits, side.materials]),
    passengerIds = passengers.map((p) => p.id);
  updateTransportDeliveries(s);
  assert.deepEqual(
    s.sides.map((side) => [side.credits, side.materials]),
    budget,
  );
  assert.deepEqual(
    passengers.map((p) => p.id),
    passengerIds,
  );
  assert.deepEqual(apc.path, pendingPath, 'the paid delivery keeps its pending physical route');
  E.advance(s, 0.2);
  assert.deepEqual({ x: apc.x, z: apc.z }, waiting);
  assert.equal(apc.moving, false, 'waiting really stops the carrier until its retry');
  for (const u of blockers) u.hp = 0;
  E.advance(s, Math.max(0, retryAt - s.time - 0.1));
  assert.ok(passengers.every((p) => p.carrierId === apc.id));
  until(s, () => !apc.delivery, 2);
  assertLanded(s, apc, passengers);
});

test('a newly blocked destination waits for demolition instead of unloading away from the point', () => {
  const { s, apc, passengers } = loaded(['infantry']);
  assert.equal(deliverGround(s, 0, apc.id, destination), 1);
  const obstacle = {
    id: s.nextId++,
    key: 'radar',
    side: 0,
    ...destination,
    hp: 100,
    maxHp: 100,
    progress: 1,
  };
  s.buildings.push(obstacle);
  s.networkRevision++;
  until(s, () => apc.delivery?.status === 'blocked', 30);
  assert.equal(passengers[0].carrierId, apc.id);
  assert.ok(distance(apc, destination) > 4);
  obstacle.demolished = true;
  obstacle.hp = 0;
  s.networkRevision++;
  until(s, () => !apc.delivery, 30);
  assertLanded(s, apc, passengers);
  assert.ok(distance(apc, destination) < 4);
});

test('shore and city-wall exits remain on connected walkable ground', () => {
  const { s, apc, passengers } = loaded(['infantry', 'infantry']);
  const shore = { x: -675, z: 0 };
  assert.equal(deliverGround(s, 0, apc.id, shore), 2);
  until(s, () => !apc.delivery, 35);
  assertLanded(s, apc, passengers);
  assert.ok(passengers.every((p) => p.x < 0));
  const wallCenter = { x: -730, z: 100 };
  s.buildings.push({
    id: s.nextId++,
    key: 'radar',
    side: 0,
    ...wallCenter,
    hp: 100,
    maxHp: 100,
    progress: 1,
  });
  s.networkRevision++;
  const virtual = { ...apc, x: -750, z: 100 };
  for (const p of passengers) p.carrierId = apc.id;
  const plan = planGroundUnload(s, virtual);
  assert.equal(plan.error, null);
  for (const point of plan.placements) {
    assert.ok(point.x < wallCenter.x, 'exit cannot pass through the building to the far side');
    for (let t = 0; t <= 1; t += 0.05)
      assert.equal(
        E.walkable(
          s,
          virtual.x + (point.x - virtual.x) * t,
          virtual.z + (point.z - virtual.z) * t,
          E.GROUND_UNITS[point.key].size * 0.42,
        ),
        true,
      );
  }
});

test('destroyed carrier cancels delivery and existing ejection produces no duplicate passengers', () => {
  const { s, apc, passengers } = loaded(['infantry', 'assault']);
  assert.equal(deliverGround(s, 0, apc.id, destination), 2);
  E.advance(s, 1);
  damageGround(s, apc, 1e6);
  assert.equal(apc.delivery, null, 'death must cancel immediately');
  for (const p of passengers) {
    assert.equal(p.carrierId, null);
    assert.equal(p.hp, p.maxHp * 0.4);
    assert.ok(distance(p, apc) <= 60);
  }
  E.advance(s, 10);
  assert.equal(s.groundUnits.length, passengers.length);
  assert.equal(new Set(s.groundUnits.map((p) => p.id)).size, passengers.length);
});

test('side one owns its delivery and solo army AI must not unload an active mission early', () => {
  const { s, apc, passengers } = loaded(['infantry'], 1);
  const next = { x: -700, z: 390 };
  assert.equal(deliverGround(s, 0, apc.id, next), 'Выберите свой действующий БТР');
  assert.equal(deliverGround(s, 1, apc.id, next), 1);
  s.mode = 'solo';
  s.time = 231;
  s.ai.nextArmy = 0;
  apc.hp = apc.maxHp * 0.4;
  E.step(s, 0.05);
  assert.equal(passengers[0].carrierId, apc.id, 'low HP APC AI must respect explicit delivery');
  assert.equal(apc.delivery.status, 'moving');
  until(s, () => !apc.delivery);
  assert.equal(passengers[0].carrierId, null);
  assert.ok(distance(apc, next) < 4);
});

test('the same seed and orders produce the same route and landing positions', () => {
  const run = () => {
    const { s, apc, passengers } = loaded();
    assert.equal(deliverGround(s, 0, apc.id, destination), 4);
    until(s, () => !apc.delivery);
    return { time: s.time, positions: [apc, ...passengers].map(({ id, x, z }) => ({ id, x, z })) };
  };
  assert.deepEqual(run(), run());
});
