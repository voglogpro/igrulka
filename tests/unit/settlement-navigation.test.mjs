import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { groundPath, walkable } from '../../src/game/units/ground/navigation.js';
import {
  SETTLEMENTS,
  SETTLEMENT_FOOTPRINTS,
  SETTLEMENT_COMPONENTS,
  settlementLayout,
} from '../../src/game/territory/settlements.config.js';

test('real paths go around village houses, while every settlement centre remains a traversable destination', () => {
  const s = E.createGame(810, { mode: 'coop' }),
    radius = 2;
  for (const house of SETTLEMENT_COMPONENTS)
    assert.equal(walkable(s, house.x, house.z, radius), false);
  for (const site of SETTLEMENTS) {
    assert.equal(walkable(s, site.x, site.z, radius), true, site.id);
    const centrePath = groundPath(s, settlementLayout(site).entrance, site, radius);
    assert.ok(centrePath.length, site.id);
    assert.deepEqual(centrePath.at(-1), { x: site.x, z: site.z });
  }
  const house = SETTLEMENT_COMPONENTS[0];
  const start = { x: house.x - 45, z: house.z },
    end = { x: house.x + 45, z: house.z };
  const path = groundPath(s, start, end, radius);
  assert.ok(path.length > 1, 'a single straight leg would cross the house');
  assert.deepEqual(path.at(-1), end);
  let from = start;
  for (const to of path) {
    const steps = Math.ceil(Math.hypot(to.x - from.x, to.z - from.z));
    for (let i = 0; i <= steps; i++) {
      const t = i / (steps || 1),
        x = from.x + (to.x - from.x) * t,
        z = from.z + (to.z - from.z) * t;
      assert.equal(
        walkable(s, x, z, radius),
        true,
        'every metre of the actual route clears terrain and houses',
      );
    }
    from = to;
  }
  const again = groundPath(s, start, end, radius);
  assert.deepEqual(again, path, 'cached grid retains the same static footprints');
});

test('a version-sixteen soldier retains its exact position and can walk away after an overlapping new house is masked', () => {
  const source = E.createGame(810);
  source.mode = 'multiplayer';
  source.version = 16;
  const house = SETTLEMENT_FOOTPRINTS[0];
  const soldier = E.makeGround(source, 0, 'infantry', house.x, house.z);
  source.groundUnits.push(soldier);
  delete source.settlementHouseMask;
  const original = { x: soldier.x, z: soldier.z };
  const restored = E.load(E.save(source)),
    unit = restored.groundUnits.find((u) => u.id === soldier.id);
  assert.deepEqual({ x: unit.x, z: unit.z }, original, 'migration never teleports an old soldier');
  assert.equal(restored.settlementHouseMask & 1, 0, 'the colliding scenery house is omitted');
  assert.equal(walkable(restored, unit.x, unit.z, 2), true);
  const target = { x: unit.x, z: unit.z - 60 };
  assert.equal(E.orderGround(restored, 0, [unit.id], target), 1);
  E.advance(restored, 12);
  assert.ok(
    Math.hypot(unit.x - target.x, unit.z - target.z) < 3,
    'the actual soldier completes a sixty-metre walk',
  );
  const again = E.load(E.save(restored));
  assert.equal(
    again.settlementHouseMask,
    restored.settlementHouseMask,
    'state seventeen reload preserves the mask',
  );
});
