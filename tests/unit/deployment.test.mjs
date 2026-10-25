import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import { deployGround, deploymentPlan } from '../../src/game/units/ground/deployment.js';
import {
  squadRoster,
  squadArrivalPoint,
  retargetSquadReserves,
} from '../../src/game/units/ground/squads.js';

const goal = { x: -800, z: 250 };
const canonical = (p) => ({ ...p, mode: 'attackmove' });
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fresh() {
  const s = E.createGame(834);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
  }
  return s;
}
function barracks(s, side = 0, x = side ? 1080 : -1080, key = 'barracks') {
  const b = E.build(s, side, key, x, -10);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
const units = (s, id) => s.groundUnits.filter((u) => u.squadId === id && u.hp > 0);

test('deployment preview proves the real spawn path and all arrival slots without mutating paid state', () => {
  const s = fresh(),
    b = barracks(s);
  const before = E.save(s);
  const p = deploymentPlan(s, 0, 'infantry', goal, 5);
  assert.equal(p.ok, true);
  assert.equal(p.siteId, b.id);
  assert.equal(p.reason, '');
  assert.deepEqual(p.point, canonical(goal));
  assert.deepEqual(p.cost, {
    credits: E.GROUND_UNITS.infantry.cost * 5,
    materials: E.GROUND_UNITS.infantry.metal * 5,
  });
  assert.ok(p.path.length);
  assert.ok(Number.isFinite(p.origin.x) && Number.isFinite(p.origin.z));
  assert.ok(distance(p.origin, b) < 85);
  assert.ok(distance(p.path.at(-1), goal) < 1e-6);
  assert.equal(E.save(s), before);
  for (let slot = 0; slot < 5; slot++) {
    const arrival = squadArrivalPoint({ key: 'infantry', squadSlot: slot, destination: p.point });
    assert.equal(E.walkable(s, arrival.x, arrival.z, 0.84), true);
  }
});

test('invalid types, counts, owners, destinations and sites cannot spend money, allocate ids or queue troops', () => {
  const s = fresh(),
    b = barracks(s);
  const before = E.save(s);
  for (const [side, key, point, count, id] of [
    [0, 'constructor', goal, 1],
    [0, '__proto__', goal, 1],
    [0, 'missing', goal, 1],
    [0, 'infantry', goal, 0],
    [0, 'infantry', goal, 6],
    [0, 'infantry', goal, 1.5],
    [0, 'infantry', null, 1],
    [0, 'infantry', { x: 0, z: 0 }, 1],
    [0, 'infantry', { x: Infinity, z: 250 }, 1],
    [0, 'infantry', goal, 1, b.id + 100],
    [1, 'infantry', goal, 1, b.id],
    [2, 'infantry', goal, 1],
  ]) {
    assert.equal(deploymentPlan(s, side, key, point, count, id).ok, false);
    assert.ok(deploymentPlan(s, side, key, point, count, id).reason);
    assert.equal(deployGround(s, side, key, point, count, id), false);
    assert.equal(E.save(s), before);
  }
});

test('automatic deployment chooses an available reachable barracks and preserves paid queues at the others', () => {
  const s = fresh(),
    a = barracks(s),
    b = barracks(s, 0, -950);
  assert.equal(deploymentPlan(s, 0, 'infantry', goal, 2).siteId, b.id);
  b.armyQueue = Array.from({ length: 8 }, () => ({ key: 'infantry', progress: 0.2 }));
  const before = structuredClone(b.armyQueue);
  const accepted = deployGround(s, 0, 'infantry', goal, 2);
  assert.equal(accepted.siteId, a.id);
  assert.deepEqual(b.armyQueue, before);
  assert.equal(a.armyQueue.length, 2);
});

test('resource, facility and queue limits are checked before payment', () => {
  for (const condition of ['credits', 'materials', 'facility', 'queue', 'finished']) {
    const s = fresh(),
      b = barracks(s);
    let key = 'infantry';
    if (condition === 'credits') s.sides[0].credits = 0;
    if (condition === 'materials') s.sides[0].materials = 0;
    if (condition === 'facility') key = 'leopard';
    if (condition === 'queue')
      b.armyQueue = Array.from({ length: 8 }, () => ({ key, progress: 0 }));
    if (condition === 'finished') s.result = 'victory';
    const before = E.save(s);
    assert.equal(deployGround(s, 0, key, goal, 1, b.id), false, condition);
    assert.equal(E.save(s), before, condition);
  }
});

test('a batch needs room for every slot and cannot buy an order beyond blocked corridors', () => {
  const s = fresh();
  barracks(s);
  assert.equal(deploymentPlan(s, 0, 'infantry', { x: -(E.FIELD.x - 14), z: 250 }, 1).ok, true);
  const before = E.save(s);
  assert.equal(deployGround(s, 0, 'infantry', { x: -(E.FIELD.x - 14), z: 250 }, 5), false);
  assert.equal(E.save(s), before);
  const obstacles = [];
  // Wall off both land corridors with enemy buildings from the sea to the map edge.
  for (const sign of [-1, 1])
    for (let z = E.SEA.halfZ - 60; z <= E.FIELD.z + 10; z += 20) {
      const b = {
        id: s.nextId++,
        side: 1,
        key: 'radar',
        x: 0,
        z: sign * z,
        hp: 100,
        maxHp: 100,
        progress: 1,
      };
      s.buildings.push(b);
      obstacles.push(b);
    }
  s.networkRevision++;
  assert.equal(deploymentPlan(s, 0, 'infantry', { x: 900, z: 250 }, 1).ok, false);
  for (const b of obstacles) {
    b.hp = 0;
    b.demolished = true;
  }
  s.networkRevision++;
  assert.equal(deploymentPlan(s, 0, 'infantry', { x: 900, z: 250 }, 1).ok, true);
});

test('five paid recruits really spawn, walk to different slots and form one persistent squad', () => {
  for (const key of ['infantry', 'apc']) {
    const s = fresh(),
      b = barracks(s, 0, -1080, key === 'infantry' ? 'barracks' : 'vehiclebase');
    const f = s.sides[0],
      before = { credits: f.credits, materials: f.materials };
    const result = deployGround(s, 0, key, goal, 5, b.id);
    assert.equal(result.count, 5);
    assert.equal(result.siteId, b.id);
    assert.equal(f.credits, before.credits - E.GROUND_UNITS[key].cost * 5);
    assert.equal(f.materials, before.materials - E.GROUND_UNITS[key].metal * 5);
    assert.equal(s.groundUnits.length, 0, 'a deployment must train instead of teleporting troops');
    assert.deepEqual(
      b.armyQueue.map((q) => q.squadSlot),
      [0, 1, 2, 3, 4],
    );
    assert.equal(new Set(b.armyQueue.map((q) => q.squadId)).size, 1);
    E.advance(s, key === 'apc' ? 145 : 65);
    const actual = units(s, result.squadId);
    assert.equal(actual.length, 5);
    assert.equal(b.armyQueue.length, 0);
    assert.equal(new Set(actual.map((u) => `${u.order.x},${u.order.z}`)).size, 5);
    for (const u of actual) {
      assert.deepEqual(u.squadGoal, canonical(goal));
      assert.ok(distance(u, squadArrivalPoint(u)) <= 4);
      assert.equal(u.routeState, null);
    }
    assert.deepEqual(squadRoster(s, 0), [
      { id: result.squadId, key, ids: actual.map((u) => u.id), queued: 0, goal: canonical(goal) },
    ]);
  }
});

test('each batch has a separate id, and fully queued squads cannot all be redirected by an empty selection', () => {
  const s = fresh(),
    b = barracks(s);
  const a = deployGround(s, 0, 'infantry', goal, 2, b.id);
  const next = deployGround(s, 0, 'infantry', { x: -850, z: 350 }, 2, b.id);
  assert.notEqual(a.squadId, next.squadId);
  assert.deepEqual(
    squadRoster(s, 0).map((q) => [q.id, q.ids.length, q.queued]),
    [
      [a.squadId, 0, 2],
      [next.squadId, 0, 2],
    ],
  );
  const before = E.save(s);
  assert.equal(retargetSquadReserves(s, 0, [], { x: -700, z: 300 }), 0);
  assert.equal(E.save(s), before);
});

test('only a complete field selection redirects paid reinforcements, without altering current field orders', () => {
  const s = fresh(),
    b = barracks(s);
  const result = deployGround(s, 0, 'infantry', goal, 3, b.id);
  E.advance(s, 4);
  const first = units(s, result.squadId)[0];
  assert.ok(first);
  assert.equal(b.armyQueue.length, 2);
  const next = { x: -750, z: 350 },
    order = structuredClone(first.order);
  assert.equal(retargetSquadReserves(s, 0, [first.id], next), 1);
  assert.deepEqual(
    first.order,
    order,
    'metadata retarget must not replace the caller-issued field order',
  );
  assert.ok(b.armyQueue.every((q) => q.destination.x === next.x && q.destination.z === next.z));
  E.advance(s, 4);
  const field = units(s, result.squadId);
  assert.equal(field.length, 2);
  assert.equal(b.armyQueue.length, 1);
  const before = E.save(s);
  assert.equal(retargetSquadReserves(s, 0, [first.id], { x: -700, z: 400 }), 0);
  assert.equal(E.save(s), before);
  assert.equal(
    retargetSquadReserves(
      s,
      1,
      field.map((u) => u.id),
      next,
    ),
    0,
  );
  assert.equal(
    retargetSquadReserves(
      s,
      0,
      field.map((u) => u.id),
      { x: -700, z: 400 },
    ),
    1,
  );
  assert.equal(b.armyQueue[0].destination.x, -700);
});

test('explicitly cleared squad destinations wait at base while legacy recruit retains normal rally', () => {
  const s = fresh(),
    b = barracks(s);
  assert.equal(E.setRally(s, 0, b.id, goal), true);
  const result = deployGround(s, 0, 'infantry', goal, 3, b.id);
  E.advance(s, 4);
  const first = units(s, result.squadId)[0];
  assert.equal(retargetSquadReserves(s, 0, [first.id], null), 1);
  assert.equal(E.commandUnits(s, 0, [first.id], 'stop'), 1);
  E.advance(s, 15);
  for (const u of units(s, result.squadId)) {
    assert.equal(u.squadGoal, null);
    assert.equal(u.order, null);
    assert.ok(!u.guard);
    assert.ok(distance(u, b) < 85);
  }
  assert.equal(E.recruit(s, 0, 'infantry', b.id), true);
  E.advance(s, 4);
  const legacy = s.groundUnits.at(-1);
  assert.equal(legacy.squadId, undefined);
  assert.ok(legacy.guard);
});

test('a newly blocked deployment waits and resumes after the real obstacle is cleared', () => {
  const s = fresh(),
    b = barracks(s);
  const result = deployGround(s, 0, 'infantry', goal, 1, b.id);
  const block = {
    id: s.nextId++,
    side: 0,
    key: 'radar',
    ...goal,
    hp: 100,
    maxHp: 100,
    progress: 1,
  };
  s.buildings.push(block);
  s.networkRevision++;
  E.advance(s, 5);
  const u = units(s, result.squadId)[0];
  assert.equal(u.routeState.status, 'blocked');
  assert.equal(u.path.length, 0);
  assert.ok(distance(u, b) < 85);
  block.hp = 0;
  block.demolished = true;
  s.networkRevision++;
  E.advance(s, 40);
  assert.equal(u.routeState, null);
  assert.ok(distance(u, goal) <= 4);
});

test('either owner can save a partially trained squad and resume its paid reinforcements', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      b = barracks(s, side),
      point = { x: side ? 800 : -800, z: 250 };
    const result = deployGround(s, side, 'infantry', point, 3, b.id);
    E.advance(s, 4);
    const loaded = E.load(E.save(s));
    assert.deepEqual(squadRoster(loaded, side), squadRoster(s, side));
    E.advance(s, 65);
    E.advance(loaded, 65);
    const fields = (s) =>
      units(s, result.squadId).map(({ id, key, x, z, squadId, squadSlot, squadGoal }) => ({
        id,
        key,
        x,
        z,
        squadId,
        squadSlot,
        squadGoal,
      }));
    assert.deepEqual(fields(loaded), fields(s));
    assert.deepEqual(loaded.sides, s.sides);
    assert.deepEqual(squadRoster(loaded, side), squadRoster(s, side));
  }
});

test('the command gateway binds paid deployments to either owner and rejects foreign sites and malformed requests atomically', () => {
  const s = fresh(),
    sites = [barracks(s, 0), barracks(s, 1)];
  for (const side of [0, 1]) {
    const point = { x: side ? 800 : -800, z: 250 };
    const accepted = executeCommand(s, side, 'deploy', {
      key: 'infantry',
      point,
      count: 5,
      siteId: sites[side].id,
    });
    assert.equal(accepted.siteId, sites[side].id);
    assert.equal(accepted.count, 5);
    assert.deepEqual(
      sites[side].armyQueue.map((q) => q.squadSlot),
      [0, 1, 2, 3, 4],
    );
    assert.ok(
      sites[side].armyQueue.every(
        (q) =>
          q.squadId === accepted.squadId &&
          q.destination.mode === 'attackmove' &&
          q.destination.x === point.x &&
          q.destination.z === point.z,
      ),
    );
    const before = E.save(s);
    const base = { key: 'infantry', point, count: 1, siteId: sites[side].id };
    for (const invalid of [
      { siteId: sites[1 - side].id },
      { point: { x: NaN, z: 250 } },
      { point: { ...point, mode: 'constructor' } },
      { point: { ...point, mode: 'attack' } },
      { count: 0 },
      { count: 6 },
      { count: 1.5 },
      { count: NaN },
      { key: '__proto__' },
      { key: 'constructor' },
    ]) {
      assert.equal(typeof executeCommand(s, side, 'deploy', { ...base, ...invalid }), 'string');
      assert.equal(E.save(s), before);
    }
  }
});

test('gateway orders redirect the complete squad reserves and numeric stop makes later paid recruits wait', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      b = barracks(s, side),
      sign = side ? 1 : -1;
    const accepted = executeCommand(s, side, 'deploy', {
      key: 'infantry',
      point: { x: sign * 800, z: 250 },
      count: 5,
      siteId: b.id,
    });
    E.advance(s, 8);
    const field = units(s, accepted.squadId);
    assert.equal(field.length, 2);
    const point = { x: sign * 750, z: 350 },
      ids = field.map((u) => u.id);
    assert.equal(
      executeCommand(s, side, 'order', { ids: [ids[0]], aim: { ...point, mode: 'move' } }),
      1,
    );
    assert.ok(
      b.armyQueue.every((q) => q.destination.z === 250),
      'partial selection preserves reserves',
    );
    assert.equal(executeCommand(s, side, 'order', { ids, aim: { ...point, mode: 'move' } }), 2);
    assert.ok(b.armyQueue.every((q) => q.destination.z === 350 && q.destination.mode === 'move'));
    assert.equal(executeCommand(s, side, 'stance', { ids, command: 'stop' }), 2);
    assert.ok(b.armyQueue.every((q) => q.destination === null));
    const loaded = E.load(E.save(s));
    E.advance(loaded, 25);
    const actual = units(loaded, accepted.squadId);
    assert.equal(actual.length, 5);
    for (const u of actual) {
      assert.equal(u.squadGoal, null);
      assert.equal(u.order, null);
    }
    assert.ok(actual.filter((u) => !ids.includes(u.id)).every((u) => distance(u, b) < 85));
  }
});

test('save validation preserves all five squad slots and rejects corrupt queued or field metadata', () => {
  const s = fresh(),
    b = barracks(s);
  const accepted = deployGround(s, 0, 'infantry', goal, 5, b.id);
  E.advance(s, 4);
  const raw = JSON.parse(E.save(s));
  const loaded = E.load(JSON.stringify(raw));
  const restored = loaded.buildings.find((site) => site.id === b.id);
  assert.deepEqual(
    units(loaded, accepted.squadId).map((u) => u.squadSlot),
    [0],
  );
  assert.deepEqual(
    restored.armyQueue.map((q) => q.squadSlot),
    [1, 2, 3, 4],
  );
  assert.deepEqual(units(loaded, accepted.squadId)[0].squadGoal, canonical(goal));
  for (const mutate of [
    (v) => {
      v.buildings.find((site) => site.id === b.id).armyQueue[0].squadSlot = 5;
    },
    (v) => {
      v.buildings.find((site) => site.id === b.id).armyQueue[0].squadSlot = -1;
    },
    (v) => {
      v.buildings.find((site) => site.id === b.id).armyQueue[0].destination.mode = 'attack';
    },
    (v) => {
      v.groundUnits[0].squadSlot = 1.5;
    },
    (v) => {
      v.groundUnits[0].squadId = 'constructor';
    },
    (v) => {
      v.groundUnits[0].squadGoal.mode = '__proto__';
    },
    (v) => {
      v.groundUnits[0].squadGoal.x = E.FIELD.x + 1;
    },
  ]) {
    const damaged = structuredClone(raw);
    mutate(damaged);
    assert.throws(() => E.load(JSON.stringify(damaged)));
  }
});
