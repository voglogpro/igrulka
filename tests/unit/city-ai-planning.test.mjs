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
  s.sides[1].components = 30;
  return s;
}
function building(s, key, x, progress = 1) {
  const d = E.BUILDINGS[key],
    b = { id: s.nextId++, side: 1, key, x, z: 200, hp: d.hp, maxHp: d.hp, progress };
  s.buildings.push(b);
  return b;
}

test('retired research never consumes AI money or creates lab projects', () => {
  const s = fresh();
  const funds = s.sides[1].credits;
  s.ai.nextResearch = 0;
  for (let i = 0; i < 4; i++) ai(s);
  assert.equal(s.sides[1].credits, funds);
  assert.deepEqual(E.researchProjects(s, 1), []);
  assert.deepEqual(s.sides[1].tech, []);
  assert.equal(
    s.buildings.some((b) => b.key === 'lab'),
    false,
  );
});

test('removing research preserves every difficulty income bonus and army/raid cadence', () => {
  const expected = {
    easy: [1, 28, 46],
    normal: [1.1, 21, 36],
    hard: [1.25, 17, 28],
    ultra: [1.45, 12, 21],
  };
  for (const [difficulty, [bonus, armyEvery, attackEvery]] of Object.entries(expected)) {
    const s = fresh();
    s.difficulty = difficulty;
    s.ai.nextResearch = 0;
    ai(s);
    assert.equal(E.economy(s, 1).bonus, bonus);
    assert.equal(E.DIFFICULTY[difficulty].armyEvery, armyEvery);
    assert.equal(E.DIFFICULTY[difficulty].attackEvery, attackEvery);
    assert.equal(s.sides[1].research, null);
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
