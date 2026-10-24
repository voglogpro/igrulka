import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { ai } from '../../src/game/ai/city-ai.js';

function fresh() {
  const s = E.createGame(888);
  s.rules.rear = false;
  s.ai.nextBuild = s.ai.nextResearch = s.ai.nextAttack = 1e9;
  s.sides[1].credits = 100000;
  s.sides[1].science = 10000;
  s.sides[1].materials = 1000;
  return s;
}
function building(s, key, x, progress = 1) {
  const d = E.BUILDINGS[key],
    b = { id: s.nextId++, side: 1, key, x, z: 200, hp: d.hp, maxHp: d.hp, progress };
  s.buildings.push(b);
  return b;
}

test('city AI fills real parallel lab slots, skips paid projects and never prepays duplicate or locked research', () => {
  const s = fresh();
  building(s, 'lab', 500);
  building(s, 'lab', 580);
  building(s, 'lab', 660);
  assert.equal(E.research(s, 1, 'autocannon'), true);
  const paid = [s.sides[1].credits, s.sides[1].science];
  s.ai.nextResearch = 0;
  ai(s);
  const projects = E.researchProjects(s, 1);
  assert.equal(projects.length, 3);
  assert.equal(new Set(projects.map((p) => p.key)).size, 3);
  assert.equal(projects[0].key, 'autocannon');
  assert.ok(projects.some((p) => p.key === 'heavy'));
  assert.ok(
    projects.every(
      (p) => !E.TECH[p.key].requires || s.sides[1].tech.includes(E.TECH[p.key].requires),
    ),
  );
  const newlyPaid = projects.slice(1).reduce(
    (sum, p) => ({
      cost: sum.cost + E.TECH[p.key].cost,
      science: sum.science + E.TECH[p.key].science,
    }),
    { cost: 0, science: 0 },
  );
  assert.deepEqual(
    [s.sides[1].credits, s.sides[1].science],
    [paid[0] - newlyPaid.cost, paid[1] - newlyPaid.science],
  );
  const before = E.save(s);
  s.ai.nextResearch = 0;
  const resources = [s.sides[1].credits, s.sides[1].science];
  ai(s);
  assert.deepEqual([s.sides[1].credits, s.sides[1].science], resources);
  assert.deepEqual(E.researchProjects(s, 1), projects);
  assert.ok(before.length > 0);
});

test('destroyed and unfinished labs provide no new AI slots and the original difficulty cadence stays intact', () => {
  for (const difficulty of Object.keys(E.DIFFICULTY)) {
    const s = fresh();
    s.difficulty = difficulty;
    building(s, 'lab', 500);
    building(s, 'lab', 580, 0.5);
    building(s, 'lab', 660).hp = 0;
    const bonus = E.economy(s, 1).bonus;
    s.ai.nextResearch = 0;
    ai(s);
    assert.equal(E.researchProjects(s, 1).length, 1);
    assert.equal(s.ai.nextResearch, E.DIFFICULTY[difficulty].researchEvery);
    assert.equal(E.economy(s, 1).bonus, bonus);
  }
});

test('aircraft production reserves the actual next building quote at both cheap and escalated lifetime prices', () => {
  for (const purchased of [0, 4]) {
    const s = fresh();
    building(s, 'factory', 500).queue = [];
    building(s, 'launcher', 600);
    s.sides[1].purchases = { building: { sam: purchased } };
    s.ai.plannedBuild = 'sam';
    const quote = E.purchaseQuote(s, 1, 'building', 'sam');
    s.sides[1].credits = E.BUILDINGS.sam.cost + 100;
    const before = s.sides[1].credits;
    ai(s);
    const queue = s.buildings.find((b) => b.key === 'factory').queue;
    if (quote.cost > E.BUILDINGS.sam.cost) {
      assert.equal(queue.length, 0);
      assert.equal(s.sides[1].credits, before);
    } else {
      assert.equal(queue.length, 1);
      assert.ok(s.sides[1].credits >= quote.cost);
    }
  }
});
