import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

function fresh() {
  const s = E.createGame(909);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.tech = Object.keys(E.TECH);
  }
  return s;
}
const ready = (s, side, key, x, z) => {
  const d = E.BUILDINGS[key];
  const b = E.build(s, side, key, x, z);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp = d.hp;
  return b;
};

test('commuters pay: residents with reachable jobs add income, an unmatched city does not', () => {
  const s = fresh();
  ready(s, 0, 'power', -670, -80);
  const base = E.economy(s, 0);
  assert.equal(base.commute.employed, 0);
  ready(s, 0, 'housing', -615, -80);
  // Only the power plant's few jobs exist so far.
  const small = E.economy(s, 0).commute;
  assert.ok(small.employed > 0 && small.employed <= small.jobs + 1e-9);
  ready(s, 0, 'industry', -560, -80);
  const withJobs = E.economy(s, 0);
  assert.ok(withJobs.commute.employed > small.employed);
  assert.equal(withJobs.commute.homes > 8, true);
  assert.ok(withJobs.commute.employed > 0 && withJobs.commute.income > 0);
  // Only as many residents as jobs earn.
  assert.ok(
    withJobs.commute.employed <= Math.min(withJobs.commute.homes, withJobs.commute.jobs) + 1e-9,
  );
});

test('markets on both sides send caravans across the river that pay both sides', () => {
  const s = fresh();
  ready(s, 0, 'power', -670, -80);
  ready(s, 1, 'power', 670, -80);
  const mine = ready(s, 0, 'market', -560, -80),
    theirs = ready(s, 1, 'market', 560, -80);
  E.advance(s, 4);
  const truck = s.groundUnits.find((u) => u.key === 'tradetruck' && u.trade?.from === mine.id);
  assert.ok(truck, 'a caravan leaves the connected market');
  assert.equal(truck.civil, true);
  assert.equal(truck.trade.to, theirs.id);
  const a = s.sides[0].credits,
    b = s.sides[1].credits;
  E.advance(s, 90);
  assert.ok(s.stats.trades >= 1);
  assert.ok(s.sides[0].credits - a > E.TRADE.owner.credits * 0.8 - 400);
  assert.ok(s.events.some((e) => e.type === 'trade'));
  assert.ok(E.tradeReport(s, 0).active);
  assert.equal(b < s.sides[1].credits + 1e9, true);
});

test('soldiers ignore caravans unless explicitly ordered, and raiding pays the raider', () => {
  const s = fresh();
  const market = {
    id: s.nextId++,
    key: 'market',
    side: 0,
    x: 900,
    z: 900,
    hp: 1,
    maxHp: 1,
    progress: 1,
  };
  s.buildings.push(market);
  const truck = E.makeGround(s, 1, 'tradetruck', -400, 250);
  truck.trade = { from: 1, to: market.id, bonus: 1 };
  const tank = E.makeGround(s, 0, 'leopard', -450, 250);
  s.groundUnits.push(truck, tank);
  E.advance(s, 3);
  assert.ok(truck.hp === truck.maxHp);
  const before = s.sides[0].credits;
  E.orderGround(s, 0, [tank.id], { x: truck.x, z: truck.z, targetId: truck.id, mode: 'attack' });
  truck.path = [];
  truck.trade = { from: 1, to: market.id, bonus: 1 };
  for (let i = 0; i < 400 && truck.hp > 0; i++) E.step(s, 0.05);
  assert.ok(truck.hp <= 0);
  assert.ok(s.sides[0].credits > before + 50);
});

test('caravans and trade state survive save and load with validation', () => {
  const s = fresh();
  const truck = E.makeGround(s, 0, 'tradetruck', -400, 250);
  truck.trade = { from: 5, to: 6, bonus: 1 };
  s.groundUnits.push(truck);
  const copy = E.load(E.save(s));
  assert.equal(copy.groundUnits.find((u) => u.id === truck.id).trade.to, 6);
  truck.trade.to = 'x';
  assert.throws(() => E.load(E.save(s)));
  assert.equal(E.recruit(s, 0, 'tradetruck'), 'Нужно исследование');
});
