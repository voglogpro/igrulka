import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateDistrictAI, AI_DISTRICT_GARRISON_LIMIT } from '../../src/game/ai/district-ai.js';
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
test('solo district AI assigns a bounded set of real capture paths and leaves an attacking reserve', () => {
  const s = fresh();
  soldiers(s, 7);
  updateDistrictAI(s);
  const guards = s.groundUnits.filter((u) => u.aiDistrict);
  assert.equal(guards.length, Math.min(AI_DISTRICT_GARRISON_LIMIT, E.DISTRICTS.length));
  assert.equal(new Set(guards.map((u) => u.aiDistrict)).size, guards.length);
  assert.ok(guards.every((u) => u.path.length && u.guard));
  assert.equal(s.groundUnits.filter((u) => !u.guard).length, 7 - guards.length);
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
test('injured district guards retreat and autonomous repairs still charge resources', () => {
  const s = fresh();
  soldiers(s, 1);
  updateDistrictAI(s);
  const u = s.groundUnits[0];
  assert.ok(u.aiDistrict);
  u.hp = u.maxHp * 0.2;
  Object.assign(s.districts[0], { owner: 1, control: -1, hp: 0 });
  updateDistrictAI(s);
  assert.equal(u.aiDistrict, null);
  assert.equal(u.guard, null);
  assert.equal(u.order.mode, 'retreat');
  assert.equal(s.districts[0].repairing, true);
  const materials = s.sides[1].materials;
  E.advance(s, 1);
  assert.ok(s.districts[0].hp > 0);
  assert.ok(s.sides[1].materials < materials);
});
