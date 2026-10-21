import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
const summaries = [];
for (let seed = 1; seed <= 12; seed++) {
  const s = E.createGame(seed);
  s.buildings[0].hp = s.buildings[0].maxHp = 1e8;
  E.advance(s, 1200);
  for (const f of s.sides)
    for (const key of ['credits', 'materials', 'science'])
      assert.ok(Number.isFinite(f[key]) && f[key] >= 0);
  for (const b of s.buildings)
    for (const key of ['hp', 'progress', 'x', 'z']) assert.ok(Number.isFinite(b[key]));
  for (const u of s.groundUnits)
    for (const key of ['hp', 'x', 'z']) assert.ok(Number.isFinite(u[key]));
  assert.ok(s.buildings.some((b) => b.side === 1 && b.key === 'barracks'));
  assert.ok(s.groundUnits.some((u) => u.side === 1));
  assert.ok(s.buildings.some((b) => b.side === 1 && (b.level || 0) > 0));
  assert.ok(s.sides[1].tech.includes('cruise'));
  assert.ok(s.stats.impacts > 10);
  assert.ok(s.buildings.filter((b) => b.side === 1 && b.key === 'housing').length >= 8);
  assert.ok(s.buildings.filter((b) => b.side === 1 && b.key === 'sam').length >= 2);
  const restored = E.load(E.save(s));
  assert.deepEqual(restored.sides, s.sides);
  assert.equal(restored.time, s.time);
  summaries.push({
    seed,
    buildings: s.buildings.length,
    tech: s.sides[1].tech.length,
    impacts: s.stats.impacts,
    army: s.groundUnits.length,
    crossed: s.groundUnits.filter((u) => u.side === 1 && u.x < 0).length,
    upgraded: s.buildings.filter((b) => b.level > 0).length,
  });
}
console.log(JSON.stringify({ campaigns: summaries.length, minutesPerCampaign: 20, summaries }));
