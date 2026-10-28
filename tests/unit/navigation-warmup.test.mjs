import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

const key = Symbol.for('skyfront.navigation-warmup-test');
globalThis[key] = { calls: 0 };
const hook = registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/src/game/map.js')) return result;
    return {
      ...result,
      source:
        String(result.source).replace(
          'export const riverDistance =',
          'const originalRiverDistance =',
        ) +
        `\nexport const riverDistance = (...args) => {
          globalThis[Symbol.for('skyfront.navigation-warmup-test')].calls++;
          return originalRiverDistance(...args);
        };\n`,
    };
  },
});
const E = await import('../../src/game/index.js');
const { navigationWarmup } = await import('../../src/game/units/ground/navigation.js');
after(() => {
  hook.deregister();
  delete globalThis[key];
});

function finish(iterator) {
  const progress = [];
  for (const value of iterator) {
    assert.ok(progress.length < 1000, 'preparation is finite');
    assert.ok(value.completed <= value.total);
    progress.push(value);
  }
  assert.equal(progress.at(-1).completed, progress.at(-1).total);
  return progress;
}

test('preparation yields bounded terrain chunks, can be cancelled and never publishes a partial field', () => {
  const s = E.createGame(8121),
    before = E.save(s);
  const iterator = navigationWarmup(s, { radii: [1], terrainBatch: 128 });
  assert.equal(iterator.next().value.completed, 0);
  const start = globalThis[key].calls;
  assert.equal(iterator.next().value.phase, 'terrain');
  assert.equal(globalThis[key].calls - start, 128, 'one turn does not compute the entire map');
  iterator.return();
  assert.equal(E.save(s), before);
  const from = { x: -900, z: -400 },
    to = { x: -180, z: -1182 };
  const route = E.groundPath(s, from, to, 1);
  assert.ok(route.length > 1, 'ordinary navigation can safely finish after an aborted preparation');
  assert.deepEqual(route.at(-1), to);
  for (const p of route) assert.ok(E.walkable(s, p.x, p.z, 1));
  assert.equal(E.save(s), before);
});

test('complete preparation covers unique real footprints and both fronts without changing game state or paths', () => {
  for (const mode of ['multiplayer', 'coop']) {
    const s = E.createGame(8121, { mode });
    const expectedFootprints = new Set([
      3,
      ...Object.values(E.GROUND_UNITS).map((d) => Math.ceil(d.size * 0.84) / 2),
    ]);
    const before = E.save(s);
    const from = { x: -900, z: -400 },
      to = { x: -180, z: -1182 };
    const reference = E.groundPath(s, from, to, 3.78);
    const progress = finish(navigationWarmup(s));
    assert.equal(progress.filter((p) => p.phase === 'paths').length, expectedFootprints.size * 4);
    assert.ok(expectedFootprints.size * 4 <= 40);
    assert.deepEqual(E.groundPath(s, from, to, 3.78), reference);
    assert.equal(
      E.save(s),
      before,
      `${mode}: no time, RNG, events, orders or paid resources changed`,
    );
  }
});

test('preparation tolerates city changes between turns and falls back to current obstacle masks', () => {
  const s = E.createGame(8121, { mode: 'multiplayer' }),
    from = { x: -900, z: -400 },
    to = { x: -180, z: -1182 },
    reference = E.groundPath(s, from, to, 1);
  const iterator = navigationWarmup(s, { radii: [1, 4] });
  iterator.next();
  iterator.next();
  const point = reference[Math.floor(reference.length / 2)];
  s.buildings.push({
    id: s.nextId++,
    side: 0,
    key: 'housing',
    ...point,
    hp: 100,
    maxHp: 100,
    progress: 1,
  });
  s.networkRevision++;
  const before = E.save(s);
  finish(iterator);
  const route = E.groundPath(s, from, to, 1);
  assert.notDeepEqual(route, reference);
  for (const p of route) assert.ok(E.walkable(s, p.x, p.z, 1));
  assert.equal(E.save(s), before);
});

test('an iterator stops when the same state object receives replacement campaign arrays', () => {
  const s = E.createGame(8121, { mode: 'multiplayer' }),
    iterator = navigationWarmup(s, { radii: [1] });
  iterator.next();
  s.buildings = structuredClone(s.buildings);
  const before = E.save(s);
  assert.equal(iterator.next().done, true);
  assert.equal(E.save(s), before);
});
