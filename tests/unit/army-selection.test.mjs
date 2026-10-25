import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveArmySelection } from '../../src/ui/selection.js';

test('selection resolves passengers, preserves first-requested order and rejects foreign, dead or missing targets', () => {
  const state = {
    groundUnits: [
      { id: 1, side: 0, hp: 100, carrierId: 10 },
      { id: 2, side: 0, hp: 100 },
      { id: 3, side: 1, hp: 100 },
      { id: 4, side: 0, hp: 0 },
      { id: 10, side: 0, hp: 100 },
      { id: 11, side: 0, hp: 100, carrierId: 3 },
    ],
  };
  assert.deepEqual(resolveArmySelection(state, [2, 1, 10, 2, 3, 4, 99, 11]), [2, 10]);
  assert.deepEqual(resolveArmySelection(state, []), []);
});

test('large mixed selection keeps exact own IDs and never mutates its input or the army snapshot', () => {
  const units = Array.from({ length: 1000 }, (_, i) => ({
    id: i + 1,
    side: i % 3 === 0 ? 1 : 0,
    hp: i % 7 === 0 ? 0 : 100,
  }));
  const state = { groundUnits: units },
    before = structuredClone(state);
  const ids = units.map((u) => u.id).reverse(),
    original = [...ids];
  const expected = ids.filter((id) => {
    const unit = units[id - 1];
    return unit.side === 0 && unit.hp > 0;
  });
  assert.deepEqual(resolveArmySelection(state, [...ids, ...ids]), expected);
  assert.deepEqual(ids, original);
  assert.deepEqual(state, before);
});
