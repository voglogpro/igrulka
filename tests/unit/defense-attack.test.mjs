import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  recallDefenseAttack,
  updateDefenseAttacks,
} from '../../src/game/units/ground/defense-attack.js';
import { executeCommand } from '../../src/network/commands.js';
import { launchAIAssault } from '../../src/game/ai/army-ai.js';
import { enrollCityAssault } from '../../src/game/units/ground/defense-attack.js';
import { depositFieldAmmo } from '../../src/game/city/field-ammo.js';
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
      side % 2 ? 612 : -612,
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
    active: 0,
    returning: 0,
    initial: 0,
    preparing: 0,
    resupplying: 0,
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
  s.groundUnits[3].order = { mode: 'move', x: -1092, z: 250 };
  const mog = E.makeGround(s, 0, 'mog', -1292, 250);
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
    friend = E.makeGround(s, 0, 'machinegunner', -1092, -1300);
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

test('recall preserves positions, returns only own survivors, and manual commands detach membership', () => {
  const s = fixture();
  E.launchDefenseAttack(s, 0);
  const attackers = s.groundUnits.filter((u) => u.defenseAttack);
  assert.equal(E.defenseAttackStatus(s, 0).active, 12);
  attackers[0].hp = 0;
  const positions = attackers.slice(1).map((u) => [u.x, u.z]);
  assert.equal(recallDefenseAttack(s, 1), 'Нет бойцов для отзыва');
  assert.equal(recallDefenseAttack(s, 0), 11);
  assert.deepEqual(
    attackers.slice(1).map((u) => [u.x, u.z]),
    positions,
  );
  assert.equal(E.defenseAttackStatus(s, 0).returning, 11);
  const loaded = E.load(E.save(s));
  assert.equal(E.defenseAttackStatus(loaded, 0).returning, 11);
  const u = loaded.groundUnits.find((u) => u.hp > 0 && u.defenseAttack);
  E.commandUnits(loaded, 0, [u.id], 'stop');
  assert.equal(u.defenseAttack, undefined);
  updateDefenseAttacks(loaded);
  assert.equal(E.defenseAttackStatus(loaded, 0).returning, 0);
});

test('an operation continues against another public hostile building after its endpoint is destroyed', () => {
  const s = fixture();
  const building = E.build(s, 1, 'gun', 1342, 250);
  assert.equal(typeof building, 'object');
  building.progress = 1;
  E.launchDefenseAttack(s, 0);
  const u = s.groundUnits.find((u) => u.defenseAttack);
  for (const v of s.groundUnits) if (v !== u) delete v.defenseAttack;
  u.x = 1142;
  u.z = 250;
  u.path = [];
  u.routeQueue = [];
  u.routeState = null;
  s.time = 4;
  updateDefenseAttacks(s);
  const first = u.order.targetId;
  assert.ok(first);
  s.buildings.find((b) => b.id === first).hp = 0;
  u.path = [];
  u.routeState = null;
  u.routeQueue = [];
  s.time = 8;
  updateDefenseAttacks(s);
  assert.ok(u.order.targetId && u.order.targetId !== first);
  assert.equal(u.defenseAttack.phase, 'active');
  const own = s.buildings.find((b) => b.id === u.order.targetId);
  assert.notEqual(own.side, u.side);
});

test('AI assaults share the thirty percent operation and cannot repeat over an active or returning wave', () => {
  const s = fixture(undefined, 1);
  assert.equal(launchAIAssault(s, 1), 0, 'early recruitment must establish its defense first');
  s.time = 600;
  assert.equal(launchAIAssault(s, 0), 0, 'the AI helper cannot issue human orders');
  assert.equal(launchAIAssault(s, 1), 12);
  assert.equal(E.defenseAttackStatus(s, 1).active, 12);
  assert.equal(s.groundUnits.filter((u) => u.autoDefense).length, 28);
  assert.equal(launchAIAssault(s, 1), 0);
  recallDefenseAttack(s, 1);
  assert.equal(launchAIAssault(s, 1), 0);
});

test('automatic attack recruits use persistent city missions while precise manual orders detach them', () => {
  const s = E.createGame(813);
  const u = E.makeGround(s, 0, 'armoredcar', -1042, 250);
  s.groundUnits.push(u);
  u.stance = { mode: 'attack' };
  assert.equal(enrollCityAssault(s, u), true);
  assert.equal(u.defenseAttack.phase, 'active');
  assert.equal(
    E.load(E.save(s)).groundUnits.find((v) => v.id === u.id).defenseAttack.phase,
    'active',
  );
  assert.equal(E.orderGround(s, 0, [u.id], { x: -892, z: 250, mode: 'move' }), 1);
  assert.equal(u.defenseAttack, undefined);
  u.stance = { mode: 'attack' };
  enrollCityAssault(s, u);
  assert.equal(E.appendGroundOrder(s, 0, [u.id], { x: -942, z: 280 }), 1);
  assert.equal(u.defenseAttack, undefined);
  u.stance = { mode: 'attack' };
  enrollCityAssault(s, u);
  assert.equal(E.guardGround(s, 0, [u.id], { x: -942, z: 280 }), 1);
  assert.equal(u.defenseAttack, undefined);
});

test('an ordinary tank walks to ammunition then destroys two ordinary city buildings without relocation or free reloads', () => {
  const s = E.createGame(813, { mode: 'multiplayer' });
  s.rules.oil = false;
  s.rules.rear = false;
  const first = E.build(s, 1, 'launcher', 1192, 350);
  const second = E.build(s, 1, 'launcher', 1372, 350);
  assert.equal(typeof first, 'object');
  assert.equal(typeof second, 'object');
  for (const b of [first, second]) {
    b.progress = 1;
    b.hp = b.maxHp;
  }
  const u = E.makeGround(s, 0, 'leopard', 992, 350);
  s.groundUnits.push(u);
  // An exhausted paid load is the trigger. The only replacement ammunition is
  // the finite physical crate, over the normal service radius away.
  u.groundAmmo = 0;
  u.ammoReserve = 0;
  assert.equal(
    depositFieldAmmo(s, {
      side: 0,
      x: 992,
      z: 450,
      fieldPoint: { x: 992, z: 450 },
      cargo: { kind: 'ammo', key: 'shell', amount: 48 },
    }),
    48,
  );
  assert.equal(
    E.orderGround(
      s,
      0,
      [u.id],
      { x: 1092, z: 350, mode: 'attackmove', targetId: first.id },
      { defer: true },
    ),
    1,
  );
  u.stance = { mode: 'attack' };
  enrollCityAssault(s, u);
  let sawSupply = false,
    sawFirstThenSecond = false,
    loaded;
  const initialHp = u.maxHp;
  for (let i = 0; i < 2400 && second.hp > 0; i++) {
    E.step(s, 0.05);
    sawSupply ||= !!u.supplyTrip;
    if (!loaded && u.supplyTrip) loaded = E.load(E.save(s));
    if (first.hp === 0 && second.hp > 0) sawFirstThenSecond = true;
  }
  assert.equal(sawSupply, true);
  assert.ok(loaded, 'an active assault supply trip must survive loading');
  assert.equal(sawFirstThenSecond, true);
  assert.equal(first.hp, 0);
  assert.equal(second.hp, 0);
  assert.equal(u.maxHp, initialHp);
  assert.ok(u.x > 1092, 'the second target needs actual travel beyond the original point');
  const remaining = s.ammoCrates[0].stock.shell + E.ammunitionStatus(s, u).total;
  assert.ok(remaining < 48 && remaining >= 0);
  assert.equal(u.defenseAttack.phase, 'active');
  // Recall during the saved supply leg cancels that detour, preserving stock.
  const returning = loaded.groundUnits.find((v) => v.id === u.id);
  const position = { x: returning.x, z: returning.z };
  assert.equal(recallDefenseAttack(loaded, 0), 1);
  assert.equal(returning.supplyTrip, undefined);
  assert.equal(returning.order.mode, 'retreat');
  assert.deepEqual({ x: returning.x, z: returning.z }, position);
});
