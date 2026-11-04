import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

test('two rivers flow from the map edges into the sea; troops ford them, buildings keep out', () => {
  for (const sign of [-1, 1]) {
    for (const a of [1100, 1600, 2200, 2700]) {
      const z = sign * a,
        c = E.riverCenter(z);
      assert.ok(E.isWater(c, z), `river channel at ${z}`);
      if (a > 1300) assert.ok(!E.isWater(c + 200, z), 'banks are dry');
      // Fording: ground movement sees only the sea.
      if (a > 1300) assert.ok(E.walkWaterDistance(c, z) > 77);
    }
  }
  const s = E.createGame(3),
    z = 2200,
    c = E.riverCenter(z);
  assert.equal(typeof E.canPlace(s, 'housing', c, z, 0), 'string');
  assert.equal(E.walkable(s, c, z, 2), true);
});

test('ships follow the river channel to the sea and back without touching land', () => {
  const s = E.createGame(11);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextArmy = s.ai.nextStrike = 1e9;
  const z = -2450;
  s.buildings.push({
    id: s.nextId++,
    side: 0,
    key: 'port',
    x: E.riverCenter(z) - 55,
    z,
    hp: 400,
    maxHp: 400,
    progress: 1,
    rotation: 0,
    cooldown: 0,
  });
  let dry = -Infinity;
  for (let t = 0; t < 3600; t++) {
    E.step(s, 0.5);
    for (const ship of s.ships) dry = Math.max(dry, E.seaDistance(ship.x, ship.z));
  }
  assert.ok(dry < 0, `a ship stayed in water (${dry})`);
  assert.ok(s.events.some((e) => e.type === 'trade'));
  assert.equal(s.ships[0].state, 'docked');
});

test('big war and free-for-all cities stand in the far corners on flat open ground', () => {
  for (const mode of ['war', 'ffa']) {
    const s = E.createGame(5, { mode });
    const hqs = s.buildings.filter((b) => b.key === 'hq');
    assert.deepEqual(
      hqs.map((b) => [Math.abs(b.x), Math.abs(b.z)]),
      Array(4).fill([E.FAR_HQ.x, E.FAR_HQ.z]),
    );
    for (const b of hqs) {
      assert.equal(E.groundHeight(b.x, b.z), 0);
      assert.ok(E.inField(b.x, b.z, 300));
      assert.ok(
        E.OIL_FIELDS.some((f) => Math.hypot(f.x - b.x, f.z - b.z) < 900),
        'an oil field within reach',
      );
    }
    E.load(E.save(s));
  }
});
