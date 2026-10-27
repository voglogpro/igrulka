import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateDistrictAI } from '../../src/game/ai/district-ai.js';
function fresh() {
  const s = E.createGame(823);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = s.ai.nextArmy = 1e9;
  s.sides[1].credits = 10000;
  s.sides[1].materials = 1000;
  return s;
}
function soldiers(s, n) {
  for (let i = 0; i < n; i++) {
    const u = E.makeGround(s, 1, 'infantry', E.HQ_X - 115, 200 + i * 4);
    u.holdFire = true;
    s.groundUnits.push(u);
  }
}
test('solo district AI submits all idle soldiers to the shared bounded planner and captures real depots', () => {
  const s = fresh();
  soldiers(s, 7);
  updateDistrictAI(s);
  assert.equal(s.groundUnits.filter((u) => u.autoDefense).length, 7);
  assert.ok(s.groundUnits.every((u) => !u.aiDistrict && !u.guard && !u.path.length));
  E.advance(s, 10);
  assert.ok(s.groundUnits.every((u) => u.guard && u.defensePost));
  assert.equal(new Set(s.groundUnits.map((u) => u.defensePost.corridorId)).size, 2);
  E.advance(s, 180);
  assert.ok(s.districts.some((d) => d.owner === 1));
  assert.ok(E.economy(s, 1).districts.active > 0);
});
test('multiplayer never receives district orders or free repairs from an AI', () => {
  const s = fresh();
  s.mode = 'multiplayer';
  soldiers(s, 7);
  Object.assign(s.districts[0], { owner: 1, control: -1, hp: 0 });
  const before = E.save(s);
  updateDistrictAI(s);
  assert.equal(E.save(s), before);
});
test('legacy injured district guards transfer to the common controller and repairs still charge resources', () => {
  const s = fresh();
  soldiers(s, 1);
  const u = s.groundUnits[0];
  assert.equal(E.captureDistrict(s, 1, [u.id], 'north-depot'), 1);
  u.aiDistrict = 'north-depot';
  u.hp = u.maxHp * 0.2;
  Object.assign(s.districts[0], { owner: 1, control: -1, hp: 0 });
  updateDistrictAI(s);
  assert.equal(u.aiDistrict, null);
  assert.equal(u.guard, null);
  assert.equal(u.autoDefense, true);
  assert.equal(
    u.order,
    null,
    'health reactions belong to shared tactics, not a second bot controller',
  );
  assert.equal(s.districts[0].repairing, true);
  const materials = s.sides[1].materials;
  E.advance(s, 1);
  assert.ok(s.districts[0].hp > 0);
  assert.ok(s.sides[1].materials < materials);
});
