import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { MARKET } from '../../src/game/city/economy.js';

function town(count) {
  const s = E.createGame(8150);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextArmy = s.ai.nextStrike = 1e9;
  s.sides[0].credits = 1e5;
  s.sides[0].materials = 1e4;
  const X = -E.HQ_X;
  for (const [ax, az, bx, bz] of [
    [-90, -45, -200, -45],
    [90, -45, 200, -45],
    [-200, 55, 200, 55],
  ])
    E.buildRoad(s, 0, X + ax, az, X + bx, bz);
  const spots = [];
  for (const dz of [-80, -10, 90, 20])
    for (const dx of [-110, -55, 55, 110, 165]) spots.push([X + dx, dz]);
  const place = (key) => {
    for (const [x, z] of spots) {
      if (E.canPlace(s, key, x, z, 0)) continue;
      const b = E.build(s, 0, key, x, z);
      if (typeof b === 'string') continue;
      b.progress = 1;
      b.hp = b.maxHp;
      return b;
    }
    throw Error('no site for ' + key);
  };
  place('power');
  place('power');
  for (let i = 0; i < count; i++) place('housing');
  return { s, place };
}

test('market turnover follows the connected homes and further markets add less', () => {
  const few = town(1),
    many = town(4);
  few.place('market');
  many.place('market');
  const a = E.economy(few.s, 0).market,
    b = E.economy(many.s, 0).market;
  assert.equal(a.markets, 1);
  assert.ok(b.income > a.income, 'more homes, more trade');
  const perHome = MARKET.perHome * (b.homes - a.homes);
  assert.ok(Math.abs(b.income - a.income - perHome) < 1e-6);
  many.place('market');
  const c = E.economy(many.s, 0).market;
  assert.equal(c.markets, 2);
  assert.ok(c.income - b.income < b.income, 'a second market adds less than the first');
  assert.ok(c.income * 60 > 100, 'a market is a visible income source');
});

test('without an enemy market the bot trades with its own connected villages and is paid', () => {
  const s = E.createGame(8151);
  s.buildings[0].hp = s.buildings[0].maxHp = 1e8;
  s.ai.nextStrike = s.ai.nextAttack = 1e9;
  const villageTrips = new Set();
  for (let t = 0; t < 1500 && !(s.sides[1].trades > 0); t++) {
    E.advance(s, 1);
    for (const u of s.groundUnits) if (u.side === 1 && u.trade?.village) villageTrips.add(u.id);
  }
  assert.equal(E.tradeReport(s, 0).markets, 0);
  assert.ok(villageTrips.size > 0, 'caravans head for home villages');
  assert.ok(s.sides[1].trades > 0 && s.sides[1].tradeIncome >= E.TRADE.domestic.credits);
  assert.equal(E.load(E.save(s)).sides[1].trades, s.sides[1].trades);
});
