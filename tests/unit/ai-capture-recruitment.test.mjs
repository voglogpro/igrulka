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
  const b = E.build(s, 1, 'barracks', 680, -10);
  assert.equal(typeof b, 'object');
  b.hp = b.maxHp;
  b.progress = 1;
  return { s, b, f };
}

test('AI pays for three district infantry before random armor, counting its pending queue', () => {
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
  assert.equal(b.armyQueue.at(-1).key, 'armoredcar');
});

test('capture recruitment leaves headquarters defenders alone and respects normal resources and completion', () => {
  const { s, b, f } = fresh();
  for (let i = 0; i < 3; i++) {
    const u = E.makeGround(s, 1, 'machinegunner', 500 + i * 10, 100);
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

test('seed6 reaches two districts early on the expanded map without free units', () => {
  const s = E.createGame(6);
  s.buildings[0].hp = s.buildings[0].maxHp = 1e8;
  E.advance(s, 900);
  assert.ok(s.stats.districtsCaptured >= 2, `seed6 captures: ${s.stats.districtsCaptured}`);
  assert.ok(s.groundUnits.some((u) => u.side === 1 && u.aiDistrict));
});
