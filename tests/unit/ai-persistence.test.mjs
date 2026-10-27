import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { aiState } from '../../src/game/ai/state.js';
import { ai } from '../../src/game/ai/city-ai.js';
import { updateArmyAI } from '../../src/game/ai/army-ai.js';

function ready(s, side, key, dx) {
  const hq = E.hqOf(s, side),
    b = E.build(s, side, key, hq.x + dx, hq.z - 10);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function fresh(mode) {
  const s = E.createGame(81244, mode ? { mode } : {});
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.oil = 10000;
  }
  for (const side of E.aiSides(s)) {
    const plan = aiState(s, side);
    plan.nextBuild = plan.nextAttack = plan.nextArmy = 1e9;
  }
  return s;
}
function decisions(s) {
  return {
    time: s.time,
    rng: s.rng,
    ai: s.ai,
    aiBySide: s.aiBySide,
    sides: s.sides.map((f) => ({ credits: f.credits, materials: f.materials, oil: f.oil })),
    queues: s.buildings.map((b) => ({ id: b.id, air: b.queue, army: b.armyQueue })),
    units: s.groundUnits.map((u) => ({
      id: u.id,
      x: u.x,
      z: u.z,
      hp: u.hp,
      autoDefense: u.autoDefense,
      stance: u.stance ?? null,
      order: u.order,
      guard: u.guard ?? null,
      path: u.path,
      defensePost: u.defensePost,
    })),
  };
}

test('mid-second cold load preserves bot decision clocks and paid production across real simulation steps', () => {
  const hot = fresh(),
    b = ready(hot, 1, 'barracks', 65);
  ready(hot, 1, 'factory', -65);
  assert.equal(E.recruit(hot, 1, 'infantry', b.id, 3), true);
  hot.time = 300.25;
  hot.ai.nextArmy = 0;
  ai(hot, 1);
  updateArmyAI(hot, { random: E.random }, 1);
  assert.equal(
    hot.ai.aiGroundReserve.amount,
    335,
    'the budget was cached before buying anti-armor',
  );
  assert.equal(hot.ai.aiGroundReserve.nextAt, 301.25);
  assert.equal(b.armyQueue.at(-1).key, 'atrifle');
  hot.sides[1].credits = 420;
  hot.time = 300.6;
  const u = E.makeGround(hot, 1, 'infantry', E.HQ_X - 100, 120);
  hot.groundUnits.push(u);
  hot.events = [];
  const cold = E.load(E.save(hot));
  assert.deepEqual(cold.ai, hot.ai);
  for (let i = 0; i < 60; i++) {
    E.step(hot, 0.05);
    E.step(cold, 0.05);
    assert.deepEqual(decisions(cold), decisions(hot), `cold load changed decisions at step ${i}`);
  }
  assert.equal(hot.groundUnits.find((v) => v.id === u.id).autoDefense, true);
});

test('cooperative bots persist independent reserve windows and validate their exact schema', () => {
  const s = fresh('coop');
  s.time = 10;
  Object.assign(s.ai, { aiDefenseAt: 10.75, aiGroundReserve: { amount: 335, nextAt: 10.6 } });
  Object.assign(s.aiBySide[3], {
    aiDefenseAt: 10.9,
    aiGroundReserve: { amount: 630, nextAt: 10.8 },
  });
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.ai, s.ai);
  assert.deepEqual(loaded.aiBySide[3], s.aiBySide[3]);
  for (const side of [1, 3])
    for (const corrupt of [
      (p) => (p.aiDefenseAt = -1),
      (p) => (p.aiDefenseAt = '10'),
      (p) => (p.aiDefenseAt = 11.01),
      (p) => (p.aiGroundReserve.amount = 701),
      (p) => (p.aiGroundReserve.amount = -1),
      (p) => (p.aiGroundReserve.amount = null),
      (p) => (p.aiGroundReserve.nextAt = 11.01),
      (p) => (p.aiGroundReserve.nextAt = '10'),
      (p) => (p.aiGroundReserve.extra = true),
      (p) => delete p.aiGroundReserve.amount,
      (p) => (p.aiGroundReserve = []),
    ]) {
      const raw = JSON.parse(E.save(s));
      corrupt(side === 1 ? raw.ai : raw.aiBySide[3]);
      assert.throws(() => E.load(JSON.stringify(raw)), /такт армии бота/);
    }
});

test('version19 migration initializes decision windows without changing cities, money or paid queues', () => {
  const s = fresh('coop'),
    b = ready(s, 3, 'barracks', 65);
  assert.equal(E.recruit(s, 3, 'infantry', b.id, 2), true);
  const raw = JSON.parse(E.save(s));
  raw.version = 19;
  for (const p of [raw.ai, raw.aiBySide[3]]) {
    delete p.aiDefenseAt;
    delete p.aiGroundReserve;
  }
  const loaded = E.load(JSON.stringify(raw));
  for (const side of [1, 3]) {
    assert.equal(aiState(loaded, side).aiDefenseAt, 0);
    assert.deepEqual(aiState(loaded, side).aiGroundReserve, { amount: 0, nextAt: 0 });
    assert.equal(loaded.sides[side].credits, s.sides[side].credits);
    assert.equal(loaded.sides[side].materials, s.sides[side].materials);
  }
  assert.deepEqual(loaded.buildings.find((v) => v.id === b.id).armyQueue, b.armyQueue);
});
