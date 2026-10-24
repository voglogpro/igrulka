import test from 'node:test';
import assert from 'node:assert/strict';
import { createGame } from '../../src/game/state.js';
import { TECH, BUILDINGS } from '../../src/game/config.js';
import {
  research,
  researchProjects,
  researchStatus,
  updateResearch,
} from '../../src/game/research/research.js';
import { supplyFactor } from '../../src/game/city/economy.js';
import { restoreEconomy } from '../../src/game/persistence/economy.js';
import { save, load } from '../../src/game/persistence/saves.js';
import { step } from '../../src/game/simulation.js';

function fresh(count = 2) {
  const s = createGame(117);
  for (const f of s.sides) {
    f.science = 10000;
    f.credits = 100000;
    f.purchases = { building: {} };
    f.researchQueue = [];
  }
  for (let i = 0; i < count; i++)
    s.buildings.push({
      id: s.nextId++,
      side: 0,
      key: 'lab',
      x: -680 - i * 80,
      z: -80,
      hp: BUILDINGS.lab.hp,
      maxHp: BUILDINGS.lab.hp,
      progress: 1,
    });
  return s;
}

test('two ready labs buy two independent projects once, never bypass prerequisites', () => {
  const s = fresh(),
    f = s.sides[0];
  assert.equal(research(s, 0, 'heavy'), true);
  assert.equal(research(s, 0, 'autocannon'), true);
  const resources = [f.credits, f.science];
  assert.equal(typeof research(s, 0, 'heavy'), 'string');
  assert.equal(typeof research(s, 0, 'efficiency'), 'string');
  assert.deepEqual([f.credits, f.science], resources);
  assert.deepEqual(
    researchProjects(s, 0).map((p) => p.key),
    ['heavy', 'autocannon'],
  );
  assert.equal(f.research.key, 'heavy', 'legacy primary project remains available');
  assert.equal(researchStatus(s, 0).activeCount, 2);
  const third = { id: s.nextId++, side: 0, key: 'lab', hp: 100, progress: 1, x: -1000, z: -200 };
  s.buildings.push(third);
  assert.match(research(s, 0, 'cruise'), /предыдущее/);
  assert.ok(!f.tech.includes('heavy'));
});

test('power and road efficiency are shared fairly; extra idle labs cannot accelerate one project', () => {
  const s = fresh();
  research(s, 0, 'heavy');
  research(s, 0, 'autocannon');
  const labs = s.buildings.filter((b) => b.key === 'lab');
  const meanRoad = labs.reduce((sum, b) => sum + supplyFactor(s, b), 0) / labs.length;
  updateResearch(s, 0, { productivity: 0.4 }, 1);
  const [a, b] = researchProjects(s, 0);
  assert.ok(Math.abs(a.progress * TECH.heavy.time - 0.4 * meanRoad) < 1e-12);
  assert.ok(Math.abs(a.progress * TECH.heavy.time - b.progress * TECH.autocannon.time) < 1e-12);
  const single = fresh();
  research(single, 0, 'heavy');
  const expected = Math.max(
    ...single.buildings.filter((b) => b.key === 'lab').map((b) => supplyFactor(single, b)),
  );
  updateResearch(single, 0, { productivity: 1 }, 1);
  assert.ok(Math.abs(single.sides[0].research.progress * TECH.heavy.time - expected) < 1e-12);
});

test('destroyed and unfinished laboratories pause extras, then resume without repayment or lost progress', () => {
  const s = fresh();
  research(s, 0, 'heavy');
  research(s, 0, 'autocannon');
  const labs = s.buildings.filter((b) => b.key === 'lab');
  labs[1].hp = 0;
  updateResearch(s, 0, { productivity: 1 }, 2);
  assert.ok(s.sides[0].research.progress > 0);
  assert.equal(s.sides[0].researchQueue[0].progress, 0);
  assert.equal(researchStatus(s, 0).activeCount, 1);
  labs[0].progress = 0.9;
  const before = structuredClone(researchProjects(s, 0));
  updateResearch(s, 0, { productivity: 1 }, 5);
  assert.deepEqual(researchProjects(s, 0), before);
  labs[0].progress = labs[1].progress = 1;
  labs[1].hp = labs[1].maxHp;
  const funds = s.sides[0].credits;
  updateResearch(s, 0, { productivity: 1 }, 2);
  assert.ok(s.sides[0].researchQueue[0].progress > 0);
  assert.equal(s.sides[0].credits, funds);
});

test('completion emits each technology once and promotes the next legacy primary project', () => {
  const s = fresh();
  research(s, 0, 'heavy');
  research(s, 0, 'autocannon');
  s.sides[0].research.progress = 1;
  updateResearch(s, 0, { productivity: 1 }, 0.1);
  assert.equal(s.sides[0].research.key, 'autocannon');
  assert.deepEqual(s.sides[0].researchQueue, []);
  assert.equal(s.events.filter((e) => e.type === 'research').length, 1);
  s.sides[0].research.progress = 1;
  updateResearch(s, 0, { productivity: 1 }, 0.1);
  updateResearch(s, 0, { productivity: 1 }, 0.1);
  assert.equal(s.sides[0].research, null);
  assert.equal(s.events.filter((e) => e.type === 'research').length, 2);
  assert.equal(research(s, 0, 'cruise'), true);
});

test('research save adapter preserves legacy project and rejects duplicate/unpaid prerequisite projects', () => {
  const legacy = fresh();
  legacy.sides[0].research = { key: 'heavy', progress: 0.42 };
  restoreEconomy(legacy, 13);
  assert.deepEqual(legacy.sides[0].research, { key: 'heavy', progress: 0.42 });
  assert.deepEqual(legacy.sides[0].researchQueue, []);
  research(legacy, 0, 'autocannon');
  const restored = structuredClone(legacy);
  restoreEconomy(restored, 14);
  assert.deepEqual(researchProjects(restored, 0), researchProjects(legacy, 0));
  for (const project of [
    { key: 'heavy', progress: 0 },
    { key: 'cruise', progress: 0 },
    { key: 'autocannon', progress: -1 },
    { key: 'autocannon', progress: Infinity },
  ]) {
    const bad = structuredClone(legacy);
    bad.sides[0].researchQueue = [project];
    assert.throws(() => restoreEconomy(bad, 14), /исследования/);
  }
});

test('simulation and actual save/load keep both research slots progressing', () => {
  const s = fresh();
  s.mode = 'multiplayer';
  research(s, 0, 'heavy');
  research(s, 0, 'autocannon');
  step(s, 0.1);
  const projects = researchProjects(s, 0);
  assert.ok(projects.every((project) => project.progress > 0));
  const restored = load(save(s));
  assert.deepEqual(researchProjects(restored, 0), projects);
  const progress = projects.map((project) => project.progress);
  step(restored, 0.1);
  assert.ok(
    researchProjects(restored, 0).every((project, index) => project.progress > progress[index]),
  );
});
