import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Count the analytic shoreline queries without adding diagnostic state to the
// simulation or depending on wall time on a shared computer.
const key = Symbol.for('skyfront.navigation-terrain-test');
globalThis[key] = { calls: 0 };
const hook = registerHooks({
  load(url, context, next) {
    const result = next(url, context);
    if (!url.endsWith('/src/game/map.js')) return result;
    const source = String(result.source).replace(
      'export const riverDistance =',
      'const originalRiverDistance =',
    );
    assert.notEqual(source, String(result.source));
    return {
      ...result,
      source:
        source +
        `\nexport const riverDistance = (...args) => {
          globalThis[Symbol.for('skyfront.navigation-terrain-test')].calls++;
          return originalRiverDistance(...args);
        };\n`,
    };
  },
});
const E = await import('../../src/game/index.js');
const { corridorGeometry, defensePostPoint } = await import('../../src/game/defense/geometry.js');
const { restoreDefense } = await import('../../src/game/defense/persistence.js');
after(() => {
  hook.deregister();
  delete globalThis[key];
});
const counter = () => globalThis[key].calls;
const from = { x: -900, z: -400 },
  to = { x: -180, z: -1182 };

function assertDry(s, route, radius) {
  assert.ok(route.length > 1);
  assert.deepEqual(route.at(-1), to);
  let previous = from;
  for (const p of route) {
    const steps = Math.max(1, Math.ceil(Math.hypot(p.x - previous.x, p.z - previous.z)));
    for (let i = 0; i <= steps; i++)
      assert.ok(
        E.walkable(
          s,
          previous.x + ((p.x - previous.x) * i) / steps,
          previous.z + ((p.z - previous.z) * i) / steps,
          radius,
        ),
      );
    previous = p;
  }
}

test('new unit footprints reuse the static shoreline samples instead of resampling the whole map', () => {
  const s = E.createGame(8121),
    before = E.save(s),
    measured = [];
  for (const radius of [0.84, 1.26, 2.94, 3.78]) {
    const start = counter(),
      route = E.groundPath(s, from, to, radius);
    measured.push(counter() - start);
    assertDry(s, route, radius);
  }
  assert.ok(measured[0] > 10000, 'the first query actually prepares an uncached terrain field');
  for (const count of measured.slice(1))
    assert.ok(
      count < measured[0] / 2,
      `a new footprint should reuse the terrain field (${measured.join(', ')})`,
    );
  assert.equal(E.save(s), before, 'terrain preparation does not enter saves or consume RNG');
});

test('shared terrain does not share city obstacles or preserve demolished walls across revisions', () => {
  const s = E.createGame(8121),
    radius = 3,
    original = E.groundPath(s, from, to, radius),
    point = original[Math.floor(original.length / 2)];
  const wall = {
    id: s.nextId++,
    side: 0,
    key: 'housing',
    x: point.x,
    z: point.z,
    hp: 100,
    maxHp: 100,
    progress: 1,
  };
  s.buildings.push(wall);
  s.networkRevision++;
  const blocked = E.groundPath(s, from, to, radius);
  assert.notDeepEqual(blocked, original);
  assertDry(s, blocked, radius);
  wall.hp = 0;
  s.networkRevision++;
  assert.deepEqual(E.groundPath(s, from, to, radius), blocked, 'ruins still obstruct the route');
  wall.demolished = true;
  s.networkRevision++;
  assert.deepEqual(E.groundPath(s, from, to, radius), original);
  const other = E.createGame(8121);
  assert.deepEqual(
    E.groundPath(other, from, to, radius),
    original,
    'another city has no copied wall',
  );
});

test('restoring a full defence reuses one coastline projection per owner without changing its plans or budget', () => {
  const s = E.createGame(8121, { mode: 'multiplayer' }),
    lines = corridorGeometry(s, 0);
  for (let row = 0; row < E.FRONTLINE.maxRows; row += 2)
    for (const line of lines)
      for (const slot of line.slots) {
        const ref = { corridorId: line.id, row, slot: slot.slot },
          p = defensePostPoint(lines, ref, 1),
          u = E.makeGround(s, 0, 'infantry', p.x, p.z);
        u.autoDefense = true;
        u.guard = { ...p };
        u.order = { ...p, mode: 'guard' };
        u.defensePost = ref;
        s.groundUnits.push(u);
      }
  const before = structuredClone(s.groundUnits),
    budget = structuredClone(s.sides),
    start = counter();
  corridorGeometry(s, 0);
  const oneProjection = counter() - start,
    restoreStart = counter();
  restoreDefense(s);
  assert.ok(oneProjection > 0);
  assert.equal(counter() - restoreStart, oneProjection);
  assert.deepEqual(s.groundUnits, before);
  assert.deepEqual(s.sides, budget);
});

test('a replacement city array with the same count and revision cannot reuse its predecessor mask', () => {
  const s = E.createGame(8121),
    radius = 3,
    original = E.groundPath(s, from, to, radius),
    point = original[Math.floor(original.length / 2)],
    revision = s.networkRevision;
  s.buildings = s.buildings.map((b, i) => (i === 1 ? { ...b, x: point.x, z: point.z } : b));
  const reference = E.groundPath(structuredClone(s), from, to, radius),
    actual = E.groundPath(s, from, to, radius);
  assert.equal(s.networkRevision, revision);
  assert.notDeepEqual(reference, original);
  assert.deepEqual(actual, reference);
  assertDry(s, actual, radius);
});
