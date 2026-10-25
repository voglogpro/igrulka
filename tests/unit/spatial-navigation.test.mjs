import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { activeSettlementFootprints } from '../../src/game/territory/settlements.config.js';
import { dirtyNetwork } from '../../src/game/city/road-network.js';

function linear(s, x, z, radius, ignore = null) {
  if (Math.abs(x) > E.FIELD.x || Math.abs(z) > E.FIELD.z) return false;
  if (E.riverDistance(x, z) < 77 + radius) return false;
  if (
    activeSettlementFootprints(s).some(
      (b) => Math.abs(x - b.x) < b.r + radius && Math.abs(z - b.z) < b.r + radius,
    )
  )
    return false;
  return !s.buildings.some(
    (b) =>
      b.id !== ignore &&
      !b.demolished &&
      Math.abs(x - b.x) < (E.BUILDINGS[b.key]?.size || 30) * 0.56 + radius &&
      Math.abs(z - b.z) < (E.BUILDINGS[b.key]?.size || 30) * 0.56 + radius,
  );
}
test('spatial movement lookup exactly preserves walls, neutral towns, ruins, ignored buildings and footprint edges', () => {
  const s = E.createGame(811);
  for (let i = 0; i < 500; i++)
    s.buildings.push({
      id: s.nextId++,
      key: i % 2 ? 'housing' : 'industry',
      side: i % 2,
      x: -1800 + (i % 10) * 90,
      z: -1500 + Math.floor(i / 10) * 60,
      hp: i % 3 ? 100 : 0,
      progress: 1,
    });
  for (const radius of [0.84, 1.26, 3, 5, 11, 25])
    for (let i = 0; i < 2400; i++) {
      const x = -1950 + ((i * 131.371) % 3900),
        z = -1550 + ((i * 97.713) % 3100),
        ignore = i % 7 ? null : s.buildings[i % s.buildings.length].id;
      assert.equal(E.walkable(s, x, z, radius, ignore), linear(s, x, z, radius, ignore));
    }
  const building = s.buildings[10],
    half = E.BUILDINGS[building.key].size * 0.56;
  for (const offset of [-1e-8, 0, 1e-8]) {
    const x = building.x + half + 3 + offset;
    assert.equal(E.walkable(s, x, building.z, 3), linear(s, x, building.z, 3));
  }
  building.demolished = true;
  dirtyNetwork(s);
  assert.equal(E.walkable(s, building.x, building.z, 3), linear(s, building.x, building.z, 3));
  s.buildings.push({ id: s.nextId++, key: 'housing', side: 0, x: -710, z: 0, hp: 100 });
  assert.equal(E.walkable(s, -710, 0, 3), false);
});
