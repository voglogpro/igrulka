import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { groundPath } from '../../src/game/units/ground/navigation.js';
import {
  updateGroundRoutes,
  GROUND_ROUTE_PATHS_PER_STEP,
} from '../../src/game/units/ground/route-queue.js';
import { executeCommand } from '../../src/network/commands.js';

function fixture(count = 20, mode, side = 0) {
  const s = E.createGame(8121, mode ? { mode } : {});
  s.rules.rear = false;
  s.rules.oil = false;
  for (let i = 0; i < count; i++) {
    const u = E.makeGround(
      s,
      side,
      'infantry',
      -1100 + (i % 25) * 9,
      (side === 2 || i % 2 === 0 ? 1 : -1) * (1350 + Math.floor(i / 50) * 4),
    );
    assert.ok(E.walkable(s, u.x, u.z, E.GROUND_UNITS[u.key].size * 0.42));
    s.groundUnits.push(u);
  }
  return s;
}
const ids = (s, side = 0) => s.groundUnits.filter((u) => u.side === side).map((u) => u.id);
function barracks(s, x, z, { side = 0, progress = 1, hp = E.BUILDINGS.barracks.hp } = {}) {
  const b = {
    id: s.nextId++,
    side,
    key: 'barracks',
    x,
    z,
    hp,
    maxHp: E.BUILDINGS.barracks.hp,
    progress,
    rotation: 0,
  };
  s.buildings.push(b);
  s.networkRevision++;
  return b;
}

test('90 and 500 manual retreats acknowledge while paused without paths, time, RNG or economic changes', () => {
  for (const count of [90, 500]) {
    const s = fixture(count),
      finances = structuredClone(s.sides),
      rng = s.rng,
      time = s.time;
    for (const u of s.groundUnits) {
      u.autoDefense = true;
      u.guard = { x: u.x, z: u.z };
      u.routeQueue = [{ x: -900, z: 1350, mode: 'attackmove' }];
      u.routeState = { status: 'moving', retryAt: time };
    }
    assert.equal(E.commandUnits(s, 0, ids(s), 'retreat'), count);
    assert.ok(s.groundUnits.every((u) => u.order.mode === 'retreat' && !u.path.length));
    assert.ok(
      s.groundUnits.every(
        (u) => u.routeState && !u.routeQueue.length && !u.guard && !u.autoDefense,
      ),
    );
    assert.deepEqual(s.sides, finances);
    assert.equal(s.rng, rng);
    assert.equal(s.time, time, 'admission does not advance the paused simulation');
    updateGroundRoutes(s);
    assert.equal(s.groundUnits.filter((u) => u.path.length).length, GROUND_ROUTE_PATHS_PER_STEP);
  }
});

test('the existing sixteen-unit deferred threshold preserves small retreat behavior', () => {
  for (const count of [1, 15, 16]) {
    const s = fixture(count);
    assert.equal(E.commandUnits(s, 0, ids(s), 'retreat'), count);
    assert.equal(s.groundUnits.filter((u) => u.path.length).length, count < 16 ? count : 0);
    assert.equal(s.groundUnits.filter((u) => u.routeState).length, count < 16 ? 0 : count);
  }
});

test('queued retreat keeps nearest friendly base ties and exactly the original safe path to its solid centre', () => {
  const s = fixture(),
    first = s.groundUnits[0];
  const earlier = barracks(s, -1250, 1250);
  barracks(s, -1250, 1450);
  barracks(s, first.x + 30, first.z, { progress: 0.5 });
  barracks(s, first.x - 30, first.z, { hp: 0 });
  barracks(s, first.x, first.z + 30, { side: 1 });
  const expected = groundPath(s, first, earlier, E.GROUND_UNITS[first.key].size * 0.42);
  assert.ok(expected.length && !E.walkable(s, earlier.x, earlier.z, 1));
  assert.equal(E.commandUnits(s, 0, ids(s), 'retreat'), s.groundUnits.length);
  assert.deepEqual({ x: first.order.x, z: first.order.z }, { x: earlier.x, z: earlier.z });
  updateGroundRoutes(s);
  assert.deepEqual(first.path, expected);
  assert.equal(first.order.mode, 'retreat');
  assert.deepEqual({ x: first.order.x, z: first.order.z }, expected.at(-1));
  Object.assign(first, expected.at(-1));
  first.path = [];
  updateGroundRoutes(s);
  assert.equal(
    first.routeState,
    null,
    'arrival at the same physical safe cell completes pending work',
  );
});

test('a Shift-waypoint added after pending retreat survives planning and resumes after the physical retreat endpoint', () => {
  const s = fixture(),
    first = s.groundUnits[0],
    next = { x: -900, z: 1350, mode: 'move' };
  assert.equal(E.commandUnits(s, 0, ids(s), 'retreat'), s.groundUnits.length);
  assert.equal(E.appendGroundOrder(s, 0, [first.id], next), 1);
  updateGroundRoutes(s);
  assert.equal(first.routeQueue.length, 1);
  const endpoint = first.path.at(-1);
  Object.assign(first, endpoint);
  first.path = [];
  for (let tick = 0; tick < 20 && first.order.mode === 'retreat'; tick++) {
    s.time += 0.05;
    updateGroundRoutes(s);
  }
  assert.equal(first.order.mode, 'move');
  assert.equal(first.routeQueue.length, 0);
  assert.ok(first.path.length);
  assert.deepEqual({ x: first.order.x, z: first.order.z }, { x: next.x, z: next.z });
});

test('save/load retains pending retreats and newer stop, move or death prevent any stale route from returning', () => {
  const original = fixture(90);
  assert.equal(E.commandUnits(original, 0, ids(original), 'retreat'), 90);
  const s = E.load(E.save(original)),
    [stopped, moved, dead] = s.groundUnits;
  assert.ok(
    s.groundUnits.every((u) => u.routeState && !u.path.length && u.order.mode === 'retreat'),
  );
  const finances = structuredClone(s.sides),
    rng = s.rng;
  assert.equal(E.commandUnits(s, 0, [stopped.id], 'stop'), 1);
  assert.equal(E.orderGround(s, 0, [moved.id], { x: -900, z: -1350 }), 1);
  const replacement = structuredClone(moved.order),
    replacementPath = structuredClone(moved.path);
  dead.hp = 0;
  for (let tick = 0; tick < 50; tick++) {
    s.time += 0.05;
    updateGroundRoutes(s);
  }
  assert.equal(stopped.order, null);
  assert.equal(stopped.routeState, null);
  assert.deepEqual(stopped.path, []);
  assert.deepEqual(moved.order, replacement);
  assert.deepEqual(moved.path, replacementPath);
  assert.equal(moved.routeState, null);
  assert.equal(dead.routeState, null);
  assert.deepEqual(dead.path, []);
  assert.ok(s.groundUnits.slice(3).every((u) => u.path.length && u.order.mode === 'retreat'));
  assert.deepEqual(s.sides, finances);
  assert.equal(s.rng, rng);
});

test('cooperative retreat is owner-only and shares the two-path planning budget between cities', () => {
  const s = fixture(20, 'coop'),
    ally = fixture(20, 'coop', 2);
  for (const u of ally.groundUnits) {
    u.id = s.nextId++;
    s.groundUnits.push(u);
  }
  const before = E.save(s);
  assert.equal(
    typeof executeCommand(s, 0, 'stance', { ids: ids(s, 2), command: 'retreat' }),
    'string',
  );
  assert.equal(E.save(s), before);
  for (const side of [0, 2])
    assert.equal(executeCommand(s, side, 'stance', { ids: ids(s, side), command: 'retreat' }), 20);
  updateGroundRoutes(s);
  assert.equal(s.groundUnits.filter((u) => u.path.length).length, GROUND_ROUTE_PATHS_PER_STEP);
  assert.equal(s.groundUnits.filter((u) => u.side === 0 && u.path.length).length, 1);
  assert.equal(s.groundUnits.filter((u) => u.side === 2 && u.path.length).length, 1);
});
