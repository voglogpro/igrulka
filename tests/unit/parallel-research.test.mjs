// Legacy parallel-project imports remain covered after retiring the research mechanic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/game/state.js';
import { TECH, BUILDINGS, VERSION } from '../../src/game/config.js';
import { restoreEconomy } from '../../src/game/persistence/economy.js';
import { restoreRetiredResearch } from '../../src/game/persistence/retired-research.js';
import { save, load } from '../../src/game/persistence/saves.js';

function legacy() {
  const s = createGame(117);
  s.version = 14;
  s.mode = 'multiplayer';
  for (const f of s.sides) Object.assign(f, { tech: [], research: null, researchQueue: [] });
  s.sides[0].research = { key: 'heavy', progress: 0.42 };
  s.sides[0].researchQueue = [{ key: 'autocannon', progress: 0.73 }];
  return s;
}

test('legacy parallel projects remain validated before their one-time credit refund', () => {
  const s = legacy(),
    f = s.sides[0],
    credits = f.credits;
  restoreEconomy(s, 14);
  restoreRetiredResearch(s, 14);
  assert.equal(f.credits - credits, TECH.heavy.cost + TECH.autocannon.cost);
  assert.deepEqual(f.tech, []);
  assert.equal(f.research, null);
  assert.deepEqual(f.researchQueue, []);
  restoreRetiredResearch(s, 15);
  assert.equal(f.credits - credits, TECH.heavy.cost + TECH.autocannon.cost);
});

test('corrupt, duplicate and unpaid prerequisite projects cannot inflate migration compensation', () => {
  for (const project of [
    { key: 'heavy', progress: 0 },
    { key: 'cruise', progress: 0 },
    { key: 'autocannon', progress: -1 },
    { key: 'autocannon', progress: Infinity },
    { key: 'constructor', progress: 0 },
    { key: '__proto__', progress: 0 },
  ]) {
    const s = legacy();
    s.sides[0].researchQueue = [project];
    assert.throws(() => restoreEconomy(s, 14));
  }
});

test('completed technology receives no project refund while both sides retain their actual paid queues', () => {
  const s = legacy();
  s.sides[1].tech = ['heavy'];
  s.sides[1].research = { key: 'cruise', progress: 0.1 };
  const credits = s.sides.map((f) => f.credits);
  restoreEconomy(s, 14);
  restoreRetiredResearch(s, 14);
  assert.equal(s.sides[0].credits - credits[0], TECH.heavy.cost + TECH.autocannon.cost);
  assert.equal(s.sides[1].credits - credits[1], TECH.cruise.cost);
  assert.deepEqual(s.sides[1].tech, []);
});

test('earlier demolished lab ordinals preserve the next live lab historical refund', () => {
  const s = legacy();
  s.sides[0].research = null;
  s.sides[0].researchQueue = [];
  const lab = {
    id: s.nextId++,
    side: 0,
    key: 'lab',
    x: -800,
    z: 300,
    hp: BUILDINGS.lab.hp,
    maxHp: BUILDINGS.lab.hp,
    progress: 0.7,
  };
  s.buildings.push(lab);
  s.sides[0].purchases.building.lab = 5;
  const before = s.sides[0].credits;
  restoreEconomy(s, 14);
  restoreRetiredResearch(s, 14);
  assert.equal(s.sides[0].credits - before, Math.round(BUILDINGS.lab.cost * 1.5));
  assert.equal(lab.demolished, true);
});

test('real v14 load migrates paid projects and saves without another refund', () => {
  const s = legacy(),
    before = s.sides.map((f) => f.credits);
  const restored = load(save(s));
  assert.equal(restored.version, VERSION);
  assert.equal(restored.sides[0].credits - before[0], TECH.heavy.cost + TECH.autocannon.cost);
  assert.deepEqual(restored.sides[0].tech, []);
  assert.equal(restored.sides[0].research, null);
  const again = load(save(restored));
  assert.deepEqual(again.sides, restored.sides);
});

test('current saves reject resurrected projects and legacy lab placement rather than refunding them repeatedly', () => {
  const s = createGame(117);
  s.sides[0].research = { key: 'heavy', progress: 0.1 };
  assert.throws(() => load(save(s)));
  s.sides[0].research = null;
  s.buildings.push({
    id: s.nextId++,
    side: 0,
    key: 'lab',
    x: -800,
    z: 300,
    hp: BUILDINGS.lab.hp,
    maxHp: BUILDINGS.lab.hp,
    progress: 1,
  });
  assert.throws(() => load(save(s)));
});
