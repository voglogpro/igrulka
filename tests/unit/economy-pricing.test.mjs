import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/game/state.js';
import { BUILDINGS, GROUND_UNITS, WEAPONS } from '../../src/game/config.js';
import { purchaseQuote, recordBuildingPurchase } from '../../src/game/city/pricing.js';
import { build, demolish, placementPlan } from '../../src/game/city/construction.js';
import { restoreEconomy } from '../../src/game/persistence/economy.js';
import { save, load } from '../../src/game/persistence/saves.js';

function fresh() {
  const s = createGame(117);
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.purchases = { building: {} };
    f.researchQueue = [];
  }
  return s;
}

test('building groups sum sequential per-item rounded prices and cap after the fifth purchase', () => {
  const s = fresh(),
    before = JSON.stringify(s);
  const group = purchaseQuote(s, 0, 'building', 'housing', 5);
  assert.equal(group.cost, 2100);
  assert.equal(group.metal, 91);
  assert.deepEqual([group.factor, group.lastFactor, group.nextFactor], [0.5, 1.5, 1.5]);
  assert.equal(JSON.stringify(s), before, 'previews must not mutate purchase history');
  const totals = { cost: 0, metal: 0 };
  for (const factor of [0.5, 0.75, 1, 1.25, 1.5, 1.5]) {
    const quote = purchaseQuote(s, 0, 'building', 'housing');
    assert.equal(quote.factor, factor);
    if (factor !== 1.5 || totals.cost < group.cost) {
      totals.cost += quote.cost;
      totals.metal += quote.metal;
    }
    recordBuildingPurchase(s, 0, 'housing');
  }
  assert.deepEqual(totals, { cost: group.cost, metal: group.metal });
  assert.equal(purchaseQuote(s, 1, 'building', 'housing').factor, 0.5);
  assert.equal(purchaseQuote(s, 0, 'building', 'industry').factor, 0.5);
});

test('successful construction alone spends the current quote; demolition never resets history', () => {
  const s = fresh();
  const quote = purchaseQuote(s, 0, 'building', 'launcher');
  const start = s.sides[0].credits;
  const built = build(s, 0, 'launcher', -560, 80);
  assert.equal(typeof built, 'object');
  assert.equal(start - s.sides[0].credits, quote.cost);
  const ledger = structuredClone(s.sides[0].purchases);
  const failed = build(s, 0, 'launcher', -560, 80);
  assert.equal(typeof failed, 'string');
  assert.deepEqual(s.sides[0].purchases, ledger);
  assert.equal(demolish(s, built.id), true);
  assert.equal(purchaseQuote(s, 0, 'building', 'launcher').factor, 0.75);
  assert.equal(typeof build(s, 0, 'launcher', -560, 80), 'object');
  assert.equal(purchaseQuote(s, 0, 'building', 'launcher').factor, 1);
  assert.equal(purchaseQuote(load(save(s)), 0, 'building', 'launcher').factor, 1);
});

test('driveway cost remains a road cost and failed resource checks consume no ordinal', () => {
  const s = fresh(),
    plan = placementPlan(s, 0, 'housing', -560, -80);
  assert.ok(!plan.error, plan.error);
  const quote = purchaseQuote(s, 0, 'building', 'housing');
  s.sides[0].credits = quote.cost + (plan.driveCost || 0) - 1;
  assert.equal(typeof build(s, 0, 'housing', -560, -80), 'string');
  assert.equal(purchaseQuote(s, 0, 'building', 'housing').factor, 0.5);
  s.sides[0].credits++;
  const building = build(s, 0, 'housing', -560, -80);
  assert.equal(typeof building, 'object');
  assert.equal(s.sides[0].credits, 0);
  assert.equal(s.sides[0].materials, 10000 - quote.metal);
});

test('ground and weapon quotes keep base prices and building production oil is never charged', () => {
  const s = fresh();
  for (const [kind, table] of [
    ['ground', GROUND_UNITS],
    ['weapon', WEAPONS],
  ])
    for (const [key, definition] of Object.entries(table)) {
      const quote = purchaseQuote(s, 0, kind, key, 5);
      assert.equal(quote.cost, (definition.cost || 0) * 5);
      assert.equal(quote.metal, (definition.metal || 0) * 5);
      assert.equal(quote.oil, (definition.oil || 0) * 5);
      assert.equal(quote.factor, 1);
    }
  assert.ok(BUILDINGS.oilwell.oil > 0);
  assert.equal(purchaseQuote(s, 0, 'building', 'oilwell').oil, 0);
  s.rules.oil = false;
  assert.equal(purchaseQuote(s, 0, 'weapon', 'drone').oil, 0);
  for (const args of [
    [0, '__proto__', 'toString'],
    [0, 'building', '__proto__'],
    [2, 'building', 'housing'],
    [0, 'building', 'housing', 0],
    [0, 'building', 'housing', 1.5],
  ])
    assert.equal(purchaseQuote(s, ...args), null);
});

test('legacy history includes ruins and demolished plots; current history is strict and survives restoration', () => {
  const s = fresh();
  s.buildings.push(
    { side: 0, key: 'housing', hp: 0, demolished: true },
    { side: 0, key: 'housing', hp: 0 },
  );
  restoreEconomy(s, 13);
  assert.equal(purchaseQuote(s, 0, 'building', 'housing').factor, 1);
  recordBuildingPurchase(s, 0, 'housing');
  const copy = structuredClone(s);
  restoreEconomy(copy, 14);
  assert.deepEqual(copy.sides, s.sides);
  for (const bad of [-1, 0.5, Infinity, '3']) {
    const invalid = structuredClone(s);
    invalid.sides[0].purchases.building.housing = bad;
    assert.throws(() => restoreEconomy(invalid, 14), /история/);
  }
  const invalid = structuredClone(s);
  invalid.sides[0].purchases.building.housing = 0;
  assert.throws(() => restoreEconomy(invalid, 14), /история/);
});
