import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateFortification } from '../../src/game/defense/fortifications.js';
import { coverInfo } from '../../src/game/units/infantry/cover.js';
import {
  trenchLinks,
  invalidateTrenchLinks,
  beginTrenchLinkBatch,
  endTrenchLinkBatch,
} from '../../src/game/defense/trench-links.js';

function fixture(count = 240) {
  const s = E.createGame(81266, { mode: 'multiplayer' });
  s.time = 1;
  s.rules.rear = false;
  s.rules.oil = false;
  for (let i = 0; i < count; i++) {
    const x = -1700 + (i % 16) * 40,
      z = -1000 + Math.floor(i / 16) * 40,
      u = E.makeGround(s, 0, 'infantry', x, z),
      t = { id: s.nextId++, side: 0, x, z, progress: 0.999, yaw: 0 };
    s.trenches.push(t);
    u.digging = true;
    u.trenchId = t.id;
    u.holdFire = true;
    s.groundUnits.push(u);
  }
  return s;
}
function instrument(s) {
  let builds = 0;
  s.trenches = new Proxy(s.trenches, {
    get(target, key, receiver) {
      // Graph preparation sorts its completed endpoint list. Frontline status
      // also filters trenches, but those cheap counters are not graph builds.
      if (key === 'filter')
        return (...args) => {
          const completed = Array.prototype.filter.apply(target, args);
          completed.sort = (...sortArgs) => {
            builds++;
            return Array.prototype.sort.apply(completed, sortArgs);
          };
          return completed;
        };
      return Reflect.get(target, key, receiver);
    },
  });
  return () => builds;
}
function complete(s) {
  for (const u of s.groundUnits) {
    updateFortification(s, u, 0.05);
    coverInfo(s, { key: 'infantry', x: u.x + 4, z: u.z + 4 });
  }
}
const geometry = (s) =>
  trenchLinks(s).map((link) => ({ id: link.id, a: link.a.id, b: link.b.id, side: link.side }));

test('240 actual same-time completions and cover queries build at most initial/final graphs without changing paid work', () => {
  const batched = fixture(),
    ordinary = fixture(),
    builds = instrument(batched),
    ordinaryBuilds = instrument(ordinary);
  beginTrenchLinkBatch(batched);
  try {
    complete(batched);
    assert.equal(builds(), 1);
  } finally {
    endTrenchLinkBatch(batched);
  }
  complete(ordinary);
  assert.equal(ordinaryBuilds(), 240, 'the unbatched workload reproduces repeated real graph work');
  assert.deepEqual(geometry(batched), geometry(ordinary));
  assert.equal(builds(), 2);
  assert.ok(batched.trenches.every((t) => t.progress === 1));
  assert.equal(
    E.save(batched),
    E.save(ordinary),
    'batching changes no construction events, charges or persistent records',
  );
  const final = trenchLinks(batched);
  assert.equal(trenchLinks(batched), final);
  assert.equal(builds(), 2);
});

test('the real simulation wraps the ground phase even when every soldier reads cover after completing work', () => {
  const s = fixture(),
    builds = instrument(s);
  for (const u of s.groundUnits)
    Object.defineProperty(u, 'holdFire', {
      configurable: true,
      enumerable: true,
      get() {
        coverInfo(s, { key: 'infantry', x: u.x + 4, z: u.z + 4 });
        return true;
      },
    });
  E.step(s, 0.05);
  trenchLinks(s);
  assert.ok(s.trenches.every((t) => t.progress === 1));
  assert.ok(builds() <= 2, `real step rebuilt the connection graph ${builds()} times`);
});

test('nested batches and finally cleanup expose completed/captured geometry immediately at the same paused time', () => {
  const s = fixture(3),
    time = s.time;
  const initial = trenchLinks(s);
  beginTrenchLinkBatch(s);
  try {
    s.trenches[0].progress = s.trenches[1].progress = 1;
    invalidateTrenchLinks(s);
    beginTrenchLinkBatch(s);
    try {
      s.trenches[2].progress = 1;
      invalidateTrenchLinks(s);
    } finally {
      endTrenchLinkBatch(s);
    }
    assert.equal(trenchLinks(s), initial, 'inner end must not prematurely expose growing geometry');
  } finally {
    endTrenchLinkBatch(s);
  }
  assert.equal(s.time, time);
  const completed = trenchLinks(s);
  assert.ok(completed.length > 0);
  beginTrenchLinkBatch(s);
  try {
    s.trenches[1].side = 1;
    invalidateTrenchLinks(s);
    assert.equal(trenchLinks(s), completed);
  } finally {
    endTrenchLinkBatch(s);
  }
  assert.ok(trenchLinks(s).some((link) => link.side === null));
  assert.equal(s.time, time, 'render queries do not need another simulation tick');
  assert.throws(() => {
    beginTrenchLinkBatch(s);
    try {
      s.trenches[1].side = 0;
      invalidateTrenchLinks(s);
      throw Error('work interrupted');
    } finally {
      endTrenchLinkBatch(s);
    }
  }, /work interrupted/);
  assert.ok(trenchLinks(s).every((link) => link.side === 0));
});

test('normal manual invalidation outside batches remains immediate and isolated between campaigns', () => {
  const a = fixture(2),
    b = fixture(2);
  for (const s of [a, b]) for (const t of s.trenches) t.progress = 1;
  const oldA = trenchLinks(a),
    oldB = trenchLinks(b);
  a.trenches[1].side = 1;
  invalidateTrenchLinks(a);
  assert.notEqual(trenchLinks(a), oldA);
  assert.equal(trenchLinks(a)[0].side, null);
  assert.equal(trenchLinks(b), oldB);
  endTrenchLinkBatch(a); // A defensive extra cleanup cannot lock future invalidation.
  a.trenches[1].side = 0;
  invalidateTrenchLinks(a);
  assert.equal(trenchLinks(a)[0].side, 0);
});

test('cold save forks complete the same 240 positions with identical geometry, resource charges and RNG', () => {
  const hot = fixture();
  for (const u of hot.groundUnits) {
    u.guard = { x: u.x, z: u.z };
    u.order = { ...u.guard, mode: 'guard' };
  }
  const before = hot.sides[0].materials,
    cold = E.load(E.save(hot));
  for (let i = 0; i < 4; i++) {
    E.step(hot, 0.05);
    E.step(cold, 0.05);
    assert.deepEqual(cold.trenches, hot.trenches);
    assert.deepEqual(cold.sides, hot.sides);
    assert.equal(cold.rng, hot.rng);
    assert.deepEqual(geometry(cold), geometry(hot));
    assert.deepEqual(
      cold.groundUnits.map((u) => [u.id, u.x, u.z, u.digging, u.trenchId]),
      hot.groundUnits.map((u) => [u.id, u.x, u.z, u.digging, u.trenchId]),
    );
  }
  assert.ok(
    hot.sides[0].materials < before,
    'continued fortification work really charges the saved budget',
  );
});
