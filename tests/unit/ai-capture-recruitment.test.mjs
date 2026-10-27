import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateArmyAI, needsCaptureInfantry } from '../../src/game/ai/army-ai.js';

function fresh() {
  const s = E.createGame(6);
  s.time = 1000;
  const f = s.sides[1];
  f.credits = 10000;
  f.materials = 1000;
  const b = E.build(s, 1, 'barracks', E.HQ_X + 65, -10);
  assert.equal(typeof b, 'object');
  b.hp = b.maxHp;
  b.progress = 1;
  return { s, b, f };
}

test('AI pays for minimum capture infantry then a mixed-role core, counting its pending queue', () => {
  const { s, b, f } = fresh();
  const before = { credits: f.credits, materials: f.materials };
  for (let i = 0; i < 3; i++) {
    s.time = (s.ai.nextArmy || s.time) + 1;
    updateArmyAI(s, { random: () => 0.99 });
  }
  assert.deepEqual(
    b.armyQueue.map((q) => q.key),
    ['infantry', 'infantry', 'infantry'],
  );
  assert.equal(before.credits - f.credits, E.GROUND_UNITS.infantry.cost * 3);
  assert.equal(before.materials - f.materials, E.GROUND_UNITS.infantry.metal * 3);
  assert.equal(needsCaptureInfantry(s), false);
  s.time = s.ai.nextArmy + 1;
  updateArmyAI(s, { random: () => 0.99 });
  assert.equal(
    b.armyQueue.at(-1).key,
    'atrifle',
    'early infantry receive affordable anti-armor support',
  );
});

test('capture recruitment leaves headquarters defenders alone and respects normal resources and completion', () => {
  const { s, b, f } = fresh();
  for (let i = 0; i < 3; i++) {
    const u = E.makeGround(s, 1, 'machinegunner', E.HQ_X - 115 + i * 10, 100);
    u.aiDefender = true;
    u.guard = { x: u.x, z: u.z };
    s.groundUnits.push(u);
  }
  assert.equal(needsCaptureInfantry(s), true);
  const guards = s.groundUnits.map((u) => structuredClone(u.guard));
  f.materials = 0;
  updateArmyAI(s, { random: () => 0.99 });
  assert.equal(b.armyQueue?.length || 0, 0, 'no free infantry when resources are short');
  assert.deepEqual(
    s.groundUnits.map((u) => u.guard),
    guards,
  );
  for (const district of s.districts) district.owner = 1;
  assert.equal(needsCaptureInfantry(s), false);
});

test('seed6 reaches and holds at least two districts on the expanded map without free units', () => {
  const s = E.createGame(6);
  s.buildings[0].hp = s.buildings[0].maxHp = 1e8;
  E.advance(s, 900);
  assert.ok(s.stats.districtsCaptured >= 2);
  assert.ok(
    s.districts.filter((d) => d.owner === 1).length >= 2,
    'paid infantry physically reached and captured sites instead of waiting for the old 700-credit threshold',
  );
  // Expanding both the coast and the city by 400m adds physical marching time.
  E.advance(s, 60);
  assert.ok(s.stats.districtsCaptured >= 2, `seed6 captures: ${s.stats.districtsCaptured}`);
  assert.ok(s.groundUnits.some((u) => u.side === 1 && u.autoDefense && u.defensePost));
});

test('the minimum capture detail can buy ordinary infantry while preserving its 250-credit reserve', () => {
  const { s, b, f } = fresh();
  f.credits = 250 + E.GROUND_UNITS.infantry.cost;
  updateArmyAI(s, { random: () => 0.99 });
  assert.equal(b.armyQueue.length, 1);
  assert.equal(b.armyQueue[0].key, 'infantry');
  assert.equal(f.credits, 250);
  f.credits = 250 + E.GROUND_UNITS.infantry.cost - 1;
  s.time = s.ai.nextArmy + 1;
  updateArmyAI(s, { random: () => 0.99 });
  assert.equal(b.armyQueue.length, 1);
});

test('idle AI defenders join the common planner instead of stale local points, while manual orders keep priority', () => {
  const { s, f } = fresh();
  f.credits = 0;
  s.ai.nextArmy = 0;
  s.ai.nextBuild = s.ai.nextAttack = 1e9;
  const units = [0, 1, 2].map((i) => {
    const u = E.makeGround(s, 1, 'machinegunner', E.HQ_X - 115 + i * 20, 200);
    u.aiDefender = true;
    s.groundUnits.push(u);
    return u;
  });
  const [reachable, blocked, manual] = units;
  reachable.defensePoint = { x: E.HQ_X - 115, z: 300 };
  blocked.defensePoint = { x: 0, z: 0 };
  assert.equal(E.orderGround(s, 1, [manual.id], { x: E.HQ_X - 75, z: 400 }), 1);
  const order = structuredClone(manual.order),
    path = structuredClone(manual.path);
  updateArmyAI(s, { random: () => 0.5 });
  assert.equal(reachable.guard, null);
  assert.equal(reachable.autoDefense, true);
  assert.equal(blocked.guard, null);
  assert.equal(blocked.autoDefense, true);
  assert.equal(blocked.path.length, 0);
  assert.deepEqual(manual.order, order);
  assert.deepEqual(manual.path, path);
  assert.equal(manual.autoDefense, false);
  const start = { x: blocked.x, z: blocked.z };
  E.advance(s, 1.2);
  assert.ok(blocked.defensePost && blocked.guard && blocked.path.length);
  assert.ok(reachable.defensePost && reachable.guard && reachable.path.length);
  assert.ok(Math.hypot(blocked.x - start.x, blocked.z - start.z) > 5);
  assert.deepEqual(manual.order, order);
});
