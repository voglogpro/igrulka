import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateOil } from '../../src/game/city/oil.js';
import { GameAudio } from '../../src/audio/game-audio.js';
import { SETTLEMENT_FOOTPRINTS } from '../../src/game/territory/settlements.config.js';

const coop = () => E.createGame(810, { mode: 'coop' });
const freezeBots = (s) => {
  for (const ai of [s.ai, ...Object.values(s.aiBySide || {})])
    ai.nextBuild = ai.nextAttack = ai.nextArmy = 1e9;
};
test('four cities form a square, have independent equal budgets and connected dry camp roads', () => {
  const s = coop();
  const initial = structuredClone(s.sides[0]);
  assert.equal(s.sides.length, 4);
  for (const side of E.sideIds(s)) {
    assert.deepEqual(s.sides[side], initial);
    assert.notEqual(s.sides[side], s.sides[(side + 1) % 4]);
    const hq = E.hqOf(s, side),
      enemy = E.hqOf(s, E.pairedEnemy(s, side));
    assert.equal(Math.hypot(hq.x - enemy.x, hq.z - enemy.z), 2030);
    assert.equal(E.groundHeight(hq.x, hq.z), 0);
    assert.equal(E.isWater(hq.x, hq.z), false);
    assert.equal(s.roads.filter((r) => r.side === side).length, 3);
    assert.equal(E.economy(s, side).bonus, side % 2 ? 1.25 : 1);
    const b = E.build(s, side, 'housing', hq.x, hq.z - 80);
    assert.equal(typeof b, 'object', String(b));
    assert.equal(E.supplyFactor(s, b), 1);
  }
  assert.equal(E.allied(s, 0, 2), true);
  assert.equal(E.allied(s, 1, 3), true);
  assert.equal(E.hostile(s, 0, 3), true);
  assert.equal(E.hostile(s, 0, undefined), false);
  assert.deepEqual(E.aiSides(s), [1, 3]);
  assert.deepEqual(E.aiSides(E.createGame(810, { mode: 'multiplayer' })), []);
});
test('victory needs both opposing headquarters; losing one allied city continues the match', () => {
  for (const losingTeam of [0, 1]) {
    const s = coop();
    freezeBots(s);
    E.hqOf(s, losingTeam).hp = 0;
    E.advance(s, 0.1);
    assert.equal(s.result, null);
    E.hqOf(s, losingTeam + 2).hp = 0;
    E.advance(s, 0.1);
    assert.equal(s.result, losingTeam === 0 ? 'defeat' : 'victory');
    assert.equal(s.winnerTeam, 1 - losingTeam);
  }
});
test('depot multiplier improves output without multiplying upkeep or the flat settlement reward', () => {
  const s = coop();
  freezeBots(s);
  const hq = E.hqOf(s, 2);
  const b = E.build(s, 2, 'housing', hq.x, hq.z - 80);
  b.progress = 1;
  b.hp = b.maxHp;
  const before = E.economy(s, 2);
  Object.assign(s.districts[0], { owner: 2, control: 1 });
  const after = E.economy(s, 2),
    depot = E.districtIncome(s, 2);
  assert.equal(after.outputBonus, 1.15);
  assert.equal(after.upkeep, before.upkeep);
  assert.ok(Math.abs(after.gross - (before.gross * 1.15 + depot.income)) < 1e-9);
  assert.equal(E.economy(s, 0).outputBonus, 1, 'ally keeps its own economic ownership');
  s.buildings.push({
    id: s.nextId++,
    side: 2,
    key: 'oilwell',
    x: hq.x - 265,
    z: hq.z,
    hp: 100,
    maxHp: 100,
    progress: 1,
  });
  const rates = E.sideIds(s).map((side) => E.economy(s, side));
  const expected = E.oilProduction(s, 2, rates[2].productivity) * 1.15;
  updateOil(s, rates, 0.1);
  assert.ok(Math.abs(s.sides[2].oilRate - expected) < 1e-9);
});
test('four-city save round-trips and refuses invalid ownership or missing owner arrays', () => {
  const s = coop();
  freezeBots(s);
  E.advance(s, 0.35);
  const raw = E.save(s),
    restored = E.load(raw);
  assert.equal(restored.sides.length, 4);
  assert.deepEqual(restored.buildings, s.buildings);
  assert.deepEqual(restored.sides, s.sides);
  assert.deepEqual(restored.settlementClock, s.settlementClock);
  for (const mutate of [
    (v) => {
      v.buildings[0].side = 4;
    },
    (v) => {
      v.roads[0].side = -1;
    },
    (v) => {
      v.contacts.pop();
    },
    (v) => {
      v.formations.pop();
    },
    (v) => {
      v.mode = 'multiplayer';
    },
    (v) => {
      v.aiBySide[3].nextBuild = 'broken';
    },
    (v) => {
      v.aiBySide[3].nextAttack = null;
    },
    (v) => {
      v.aiBySide[3].nextArmy = -1;
    },
    (v) => {
      v.aiBySide[3].roadPlan = 0.5;
    },
    (v) => {
      delete v.aiBySide[3];
    },
    (v) => {
      v.aiBySide[2] = v.aiBySide[3];
    },
  ]) {
    const invalid = JSON.parse(raw);
    mutate(invalid);
    assert.throws(() => E.load(JSON.stringify(invalid)));
  }
});
test('allied drone flyover never triggers raid sirens for either human city', () => {
  const s = coop(),
    hq = E.hqOf(s, 0);
  const drone = { side: 2, hp: 100, delay: 0, x: hq.x, y: 70, z: hq.z, key: 'drone' };
  s.units.push(drone);
  const sound = new GameAudio();
  assert.equal(sound.raidThreat(s, 0), null);
  drone.side = 3;
  assert.ok(sound.raidThreat(s, 0));
});
test('settlement houses block buildings and roads while leaving the central street open', () => {
  const s = coop(),
    house = SETTLEMENT_FOOTPRINTS[0],
    site = E.SETTLEMENTS[0];
  assert.match(E.canPlace(s, 'launcher', house.x, house.z, 0), /поселения/);
  assert.match(
    E.roadPreview(s, 0, house.x - 35, house.z, house.x + 35, house.z).error,
    /поселения/,
  );
  assert.equal(E.roadPreview(s, 0, site.x, site.z - 50, site.x, site.z + 50).error, undefined);
});
