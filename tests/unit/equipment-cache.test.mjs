import test from 'node:test';
import assert from 'node:assert/strict';
import { equipmentModifiers } from '../../src/game/combat/upgrade-tiers.js';

test('equipment reads cannot change another battery and an upgrade immediately selects its correct parameters', () => {
  const first = { level: 0 },
    second = { level: 0 };
  assert.throws(() => {
    equipmentModifiers(first).range = 100;
  }, TypeError);
  assert.equal(equipmentModifiers(second).range, 1);
  first.level = 2;
  assert.equal(equipmentModifiers(first).range, 1.16);
  assert.equal(equipmentModifiers(first).rate, 1.25);
  assert.equal(equipmentModifiers(second).rate, 1);
  assert.equal(equipmentModifiers({ level: NaN }).range, 1);
  assert.equal(equipmentModifiers({ level: -2 }).range, 1);
});
