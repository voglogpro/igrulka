import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import {
  updateGroundRoutes,
  GROUND_ROUTE_PATHS_PER_STEP,
} from '../../src/game/units/ground/route-queue.js';

function fixture(mode, side = 0) {
  const s = E.createGame(8112, mode ? { mode } : {});
  s.rules.rear = false;
  s.rules.oil = false;
  for (const ai of [s.ai, ...Object.values(s.aiBySide || {})])
    ai.nextBuild = ai.nextArmy = ai.nextAttack = 1e9;
  for (let i = 0; i < 40; i++) {
    const north = s.sides.length > 2 ? side < 2 : i % 2 === 0;
    const u = E.makeGround(
      s,
      side,
      'machinegunner',
      side % 2 ? 420 : -420,
      (north ? -1 : 1) * (1320 + Math.floor(i / 2) * 5),
    );
    u.autoDefense = true;
    u.stance = { mode: 'defend', post: 'auto' };
    u.guard = { x: u.x, z: u.z };
    u.defensePost = {
      corridorId: north ? 'north' : 'south',
      slot: i % 3,
      row: Math.floor(i / 6) * 2,
    };
    s.groundUnits.push(u);
  }
  return s;
}

test('30 percent attack leaves 14 of 20 defenders on each front and does no synchronous path search', () => {
  const s = fixture(),
    credits = s.sides[0].credits,
    stock = structuredClone(s.sides[0].ammoStock);
  assert.deepEqual(E.defenseAttackStatus(s, 0), {
    total: 40,
    eligible: 40,
    count: 12,
    reason: '',
    ok: true,
  });
  assert.equal(executeCommand(s, 0, 'defense-attack', {}), 12);
  for (const front of ['north', 'south'])
    assert.equal(
      s.groundUnits.filter((u) => u.autoDefense && u.defensePost.corridorId === front).length,
      14,
    );
  const attackers = s.groundUnits.filter((u) => u.stance?.mode === 'attack');
  assert.equal(attackers.length, 12);
  assert.ok(
    attackers.every(
      (u) => !u.path.length && u.routeState && u.routeQueue.length === 1 && !u.autoDefense,
    ),
  );
  assert.equal(attackers.filter((u) => u.order.z < 0).length, 6);
  assert.equal(attackers.filter((u) => u.order.z > 0).length, 6);
  assert.equal(s.sides[0].credits, credits);
  assert.deepEqual(s.sides[0].ammoStock, stock);
  updateGroundRoutes(s);
  assert.equal(attackers.filter((u) => u.path.length).length, GROUND_ROUTE_PATHS_PER_STEP);
  assert.ok(attackers.filter((u) => u.path.length).every((u) => u.stance?.mode === 'attack'));
});

test('pending attack survives save/load and later manual stop cancels its unplanned route', () => {
  const s = fixture();
  assert.equal(E.launchDefenseAttack(s, 0), 12);
  const restored = E.load(E.save(s));
  const attackers = restored.groundUnits.filter((u) => u.stance?.mode === 'attack');
  assert.equal(attackers.length, 12);
  assert.ok(attackers.every((u) => u.routeState && u.routeQueue.length === 1));
  const stopped = attackers[0];
  assert.equal(E.commandUnits(restored, 0, [stopped.id], 'stop'), 1);
  for (let i = 0; i < 10; i++) {
    restored.time += 0.05;
    updateGroundRoutes(restored);
  }
  assert.equal(stopped.routeState, null);
  assert.equal(stopped.order, null);
  assert.equal(stopped.path.length, 0);
  assert.ok(attackers.slice(1).every((u) => u.path.length));
});

test('attack excludes wounded, supply trips, carried infantry, MOG and manual orders; rejects forged command arguments atomically', () => {
  const s = fixture();
  s.groundUnits[0].downed = { t: 1 };
  s.groundUnits[1].supplyTrip = { crateId: 123 };
  s.groundUnits[2].carrierId = 123;
  s.groundUnits[3].autoDefense = false;
  s.groundUnits[3].guard = null;
  s.groundUnits[3].order = { mode: 'move', x: -900, z: 250 };
  const mog = E.makeGround(s, 0, 'mog', -1100, 250);
  mog.autoDefense = true;
  mog.guard = { x: mog.x, z: mog.z };
  s.groundUnits.push(mog);
  const excluded = s.groundUnits.slice(0, 4).map((u) => structuredClone(u));
  assert.equal(E.defenseAttackStatus(s, 0).eligible, 36);
  const before = E.save(s);
  assert.equal(
    typeof executeCommand(s, 0, 'defense-attack', { ids: [s.groundUnits[0].id] }),
    'string',
  );
  assert.equal(E.save(s), before);
  assert.equal(E.launchDefenseAttack(s, 0), 10);
  for (let i = 0; i < 4; i++) assert.deepEqual(s.groundUnits[i], excluded[i]);
  assert.ok(mog.autoDefense);
  assert.ok(mog.guard);
});

test('cooperative attack commands own only their city and keep one defender per occupied direction', () => {
  const s = fixture('coop', 2),
    friend = E.makeGround(s, 0, 'machinegunner', -900, -1300);
  friend.autoDefense = true;
  friend.guard = { x: friend.x, z: friend.z };
  s.groundUnits.push(friend);
  const before = structuredClone(friend);
  assert.equal(executeCommand(s, 2, 'defense-attack', {}), 12);
  assert.deepEqual(friend, before);
  assert.ok(
    s.groundUnits
      .filter((u) => u.side === 2 && u.stance?.mode === 'attack')
      .every((u) => u.order.z > 0),
  );
  const small = fixture();
  small.groundUnits = small.groundUnits.slice(0, 2);
  assert.equal(E.defenseAttackStatus(small, 0).ok, false);
  assert.equal(typeof E.launchDefenseAttack(small, 0), 'string');
});
