import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { armyTargetRequest, recruitmentHTML } from '../../src/ui/army-recruitment.js';

test('composition input accepts explicit integer goals including zero and refuses invalid roles/counts', () => {
  assert.deepEqual(armyTargetRequest('infantry', '50'), { key: 'infantry', count: 50 });
  assert.deepEqual(armyTargetRequest('leopard', '0'), { key: 'leopard', count: 0 });
  for (const value of ['', -1, 121, 1.5, 'not a count'])
    assert.equal(armyTargetRequest('infantry', value), null);
  assert.equal(armyTargetRequest('unknown', 5), null);
});

test('composition editor reflects per-type persistent goals without an enable toggle', () => {
  const state = E.createGame(895);
  assert.equal(E.setArmyTarget(state, 0, 'infantry', 50), true);
  assert.equal(E.setArmyTarget(state, 0, 'leopard', 5), true);
  assert.equal(E.setArmyTarget(state, 0, 'heavytank', 2), true);
  const infantry = recruitmentHTML({ state, armyCategory: 'infantry' });
  const vehicles = recruitmentHTML({ state, armyCategory: 'vehicles' });
  assert.match(infantry, /value="50" data-army-target="infantry"/);
  assert.match(vehicles, /value="5" data-army-target="leopard"/);
  assert.match(vehicles, /value="2" data-army-target="heavytank"/);
  assert.doesNotMatch(infantry + vehicles, /repeat-toggle|auto-defense-toggle/);
  assert.equal(E.armyCompositionStatus(state, 0).totals.desired, 57);
});
