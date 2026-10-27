import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  moveGroundUnit,
  groundMovementMetrics,
  GROUND_RECOVERY_PATHS_PER_STEP,
} from '../../src/game/units/ground/movement.js';
import { groundStepClear } from '../../src/game/units/ground/navigation.js';

const radius = (u) => E.GROUND_UNITS[u.key].size * 0.42;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fresh(coop = false) {
  const s = E.createGame(812, coop ? { mode: 'coop' } : undefined);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.rules.oil = false;
  s.settlementLayoutMask = 0;
  return s;
}
function unit(s, key, x, z, goal = null, side = 0) {
  const u = E.makeGround(s, side, key, x, z);
  if (goal) {
    u.path = [{ ...goal }];
    u.order = { ...goal, mode: 'move', targetId: null };
  }
  s.groundUnits.push(u);
  assert.equal(E.walkable(s, x, z, radius(u)), true, 'fixture starts on clear land');
  return u;
}
function tick(s, seconds, inspect = () => {}, units = s.groundUnits) {
  for (let n = 0; n < Math.round(seconds * 20); n++) {
    s.time += 0.05;
    for (const u of units) {
      const before = { x: u.x, z: u.z };
      moveGroundUnit(s, u, 0.05, E.GROUND_UNITS[u.key].speed);
      assert.ok(distance(before, u) <= E.GROUND_UNITS[u.key].speed * 0.05 + 1e-6);
      assert.ok(groundStepClear(s, before, u, radius(u)), 'every actual step stays on land');
    }
    inspect(s);
  }
}
function separated(units) {
  for (let i = 0; i < units.length; i++)
    for (let j = i + 1; j < units.length; j++)
      assert.ok(
        distance(units[i], units[j]) >= radius(units[i]) + radius(units[j]) + 0.34,
        `physical footprints overlap: ${units[i].id}/${units[j].id}`,
      );
}
function wall(s, x, z, r = 10) {
  s.buildings.push({
    id: s.nextId++,
    key: 'housing',
    side: 0,
    x,
    z,
    r,
    hp: 100,
    maxHp: 100,
    progress: 1,
  });
  s.networkRevision++;
}

test('a vehicle physically goes around a stationary deployed MOG without moving its post', () => {
  const s = fresh(),
    mog = unit(s, 'mog', -1200, -400),
    tank = unit(s, 'leopard', -1280, -400, { x: -1120, z: -400 });
  mog.setup = 1;
  mog.moving = false;
  mog.guard = { x: mog.x, z: mog.z };
  const post = structuredClone(mog);
  let detour = 0;
  tick(s, 12, () => {
    separated([tank, mog]);
    detour = Math.max(detour, Math.abs(tank.z + 400));
  });
  assert.ok(distance(tank, tank.order) <= 1);
  assert.ok(detour > radius(tank) + radius(mog));
  assert.deepEqual(mog, post, 'avoidance does not push or take over a stationary unit');
});

test('opposing allied vehicles keep right and both reach their original destinations', () => {
  const s = fresh(true),
    a = unit(s, 'leopard', -1300, -400, { x: -1100, z: -400 }),
    b = unit(s, 'leopard', -1100, -400, { x: -1300, z: -400 }, 2);
  tick(s, 15, () => separated([a, b]));
  assert.ok(distance(a, a.order) <= 1, JSON.stringify(a));
  assert.ok(distance(b, b.order) <= 1, JSON.stringify(b));
});

test('an occupied intermediate waypoint is bypassed while the final player goal is retained', () => {
  const s = fresh(),
    mog = unit(s, 'mog', -1200, -400),
    tank = unit(s, 'leopard', -1280, -400, { x: -1120, z: -450 });
  tank.path = [{ x: mog.x, z: mog.z }, { ...tank.path[0] }];
  const goal = structuredClone(tank.order);
  tick(s, 15, () => separated([tank, mog]));
  assert.ok(distance(tank, goal) <= 1);
  assert.deepEqual(tank.order, goal);
  assert.equal(tank.path.length, 0);
});

test('a single-file choke yields by reversing rather than phasing or deadlocking', () => {
  const s = fresh();
  for (let x = -1280; x <= -1120; x += 20) {
    wall(s, x, -416);
    wall(s, x, -384);
  }
  const a = unit(s, 'leopard', -1320, -400, { x: -1080, z: -400 }),
    b = unit(s, 'leopard', -1080, -400, { x: -1320, z: -400 });
  let reversed = false,
    previous = b.x;
  tick(s, 40, () => {
    separated([a, b]);
    reversed ||= b.x > previous + 0.01;
    previous = b.x;
  });
  assert.equal(reversed, true, 'the yielding vehicle makes real backward steps');
  assert.ok(distance(a, a.order) <= 1, JSON.stringify(a));
  assert.ok(distance(b, b.order) <= 1, JSON.stringify(b));
});

test('two opposing columns clear a choke even when the rear units are processed first', () => {
  const s = fresh();
  for (let x = -1280; x <= -1120; x += 20) {
    wall(s, x, -416);
    wall(s, x, -384);
  }
  for (const direction of [-1, 1])
    for (let i = 0; i < 4; i++) {
      const u = unit(s, 'leopard', direction < 0 ? -1080 + i * 20 : -1320 - i * 20, -400, {
        x: direction < 0 ? -1400 : -1000,
        z: -460 + i * 20,
      });
      u.path.unshift({ x: direction < 0 ? -1320 : -1080, z: -400 });
    }
  s.groundUnits.reverse();
  tick(s, 50, () => separated(s.groundUnits));
  for (const u of s.groundUnits) assert.ok(distance(u, u.order) <= 1, JSON.stringify(u));
});

test('an allied column passes a fixed gun group without changing manual mission metadata', () => {
  const s = fresh(),
    mog = unit(s, 'mog', -1240, -400),
    tanks = Array.from({ length: 8 }, (_, i) =>
      unit(s, 'leopard', -1340 - i * 18, -400, { x: -1000 - i * 18, z: -400 }),
    ),
    mission = tanks[4];
  mission.routeState = { status: 'moving', retryAt: 5 };
  mission.routeQueue = [{ x: -900, z: -300, mode: 'move' }];
  mission.supplyTrip = { crateId: 44, returnX: -1200, returnZ: -500 };
  mission.delivery = { x: -1072, z: -400, status: 'moving', retryAt: 5 };
  const saved = structuredClone({
    order: mission.order,
    routeState: mission.routeState,
    routeQueue: mission.routeQueue,
    supplyTrip: mission.supplyTrip,
    delivery: mission.delivery,
  });
  tick(s, 30, () => separated([...tanks, mog]));
  for (const tank of tanks) assert.ok(distance(tank, tank.order) <= 1);
  for (const [key, value] of Object.entries(saved)) assert.deepEqual(mission[key], value);
});

test('static recovery is globally budgeted and retries retain blocked manual routes', () => {
  const s = fresh();
  for (let z = -700; z <= -200; z += 20) wall(s, -1200, z);
  const units = Array.from({ length: 12 }, (_, i) =>
    unit(s, 'leopard', -1214, -680 + i * 40, { x: -1160, z: -680 + i * 40 }),
  );
  const attempted = new Set();
  tick(s, 2, () => {
    const metrics = groundMovementMetrics(s);
    assert.ok(metrics.replans <= GROUND_RECOVERY_PATHS_PER_STEP);
    for (const u of units) if (u.repathAt > s.time) attempted.add(u.id);
    assert.ok(units.every((u) => u.order && u.path.length));
  });
  assert.equal(attempted.size, units.length, 'later units are not starved by early retries');
  const blocked = units[0],
    original = structuredClone(blocked.order);
  tick(s, 30);
  assert.ok(distance(blocked, original) <= 1, 'the actual detour eventually passes the wall');
});

test('five hundred marching units use local buckets and no per-unit A* recovery', () => {
  const s = fresh(),
    units = Array.from({ length: 500 }, (_, i) => {
      const x = -1750 + (i % 20) * 24,
        z = -850 + Math.floor(i / 20) * 24;
      return unit(s, i % 5 ? 'infantry' : 'leopard', x, z, { x: x + 150, z });
    });
  tick(s, 1, () => {
    const metrics = groundMovementMetrics(s);
    assert.equal(metrics.replans, 0);
    assert.ok(metrics.checks < units.length * 100, JSON.stringify(metrics));
    assert.ok(metrics.candidates <= units.length * 9);
  });
  assert.ok(units.every((u) => u.x > u.order.x - 150));
});

test('save/load does not change derived avoidance, boarding clearance or a manual stop', () => {
  const s = fresh(),
    a = unit(s, 'leopard', -1300, -400, { x: -1100, z: -400 }),
    b = unit(s, 'leopard', -1100, -400, { x: -1300, z: -400 });
  tick(s, 4);
  const loaded = E.load(E.save(s));
  tick(s, 8);
  tick(loaded, 8);
  for (const u of [a, b]) {
    const copy = loaded.groundUnits.find((v) => v.id === u.id);
    assert.deepEqual([copy.x, copy.z, copy.path, copy.yaw], [u.x, u.z, u.path, u.yaw]);
  }
  const passenger = unit(s, 'infantry', -1400, -400, { x: -1380, z: -400 }),
    carrier = unit(s, 'apc', -1380, -400);
  passenger.boardingId = carrier.id;
  passenger.order.mode = 'board';
  tick(s, 1);
  assert.ok(distance(passenger, carrier) < 4, 'boarding is handled by the existing 15 m gate');
  const manual = unit(s, 'leopard', -1600, -400, { x: -1550, z: -400 });
  tick(s, 0.1);
  assert.ok(manual.path.length);
  assert.equal(E.commandUnits(s, 0, [manual.id], 'stop'), 1);
  const stopped = { x: manual.x, z: manual.z };
  tick(s, 1);
  assert.deepEqual({ x: manual.x, z: manual.z }, stopped);
  assert.equal(manual.path.length, 0);
});

test('the real simulation tick moves two mixed columns past each other and fixed MOG posts', () => {
  const s = fresh(),
    movers = [];
  for (let row = 0; row < 5; row++) {
    const z = -650 + row * 40;
    unit(s, 'mog', -1240, z);
    for (let col = 0; col < 4; col++) {
      const key = col % 2 ? 'infantry' : 'leopard';
      movers.push(
        unit(s, key, -1360 - col * 20, z, { x: -1100 - col * 20, z }),
        unit(s, key, -1120 + col * 20, z, { x: -1380 + col * 20, z }),
      );
    }
  }
  for (const u of s.groundUnits) u.holdFire = true;
  for (let i = 0; i < 500; i++) {
    const positions = s.groundUnits.map((u) => ({ x: u.x, z: u.z }));
    E.step(s, 0.05);
    for (let j = 0; j < s.groundUnits.length; j++) {
      const u = s.groundUnits[j];
      assert.ok(distance(positions[j], u) <= E.GROUND_UNITS[u.key].speed * 0.05 + 1e-6);
      assert.ok(groundStepClear(s, positions[j], u, radius(u)));
    }
    separated(s.groundUnits);
  }
  assert.ok(movers.every((u) => distance(u, u.order) <= 1));
  assert.ok(s.groundUnits.filter((u) => u.key === 'mog').every((u) => u.x === -1240));
});

test('a tactical vehicle backs away while keeping its hull facing a recent threat', () => {
  const s = fresh(),
    u = unit(s, 'leopard', -1200, -400, { x: -1250, z: -400 });
  u.order.mode = 'cover';
  u.threatX = -1100;
  u.threatZ = -400;
  u.threatAt = s.time;
  tick(s, 1);
  assert.ok(u.x < -1200);
  assert.ok(Math.abs(u.yaw - Math.PI / 2) < 1e-6);
});

test('swept steps cannot jump a ruin or shoreline even when both endpoints are free', () => {
  const s = fresh();
  wall(s, -1200, -400, 3);
  s.buildings.at(-1).hp = 0;
  assert.ok(E.walkable(s, -1210, -400, 1));
  assert.ok(E.walkable(s, -1190, -400, 1));
  assert.equal(groundStepClear(s, { x: -1210, z: -400 }, { x: -1190, z: -400 }, 1), false);
  assert.ok(E.walkable(s, -800, 0, 3));
  assert.ok(E.walkable(s, 800, 0, 3));
  assert.equal(groundStepClear(s, { x: -800, z: 0 }, { x: 800, z: 0 }, 3), false);
});
