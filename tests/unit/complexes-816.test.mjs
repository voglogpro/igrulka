import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

function city() {
  const s = E.createGame(8160);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextArmy = s.ai.nextStrike = 1e9;
  s.sides[0].credits = 1e5;
  s.sides[0].materials = 1e4;
  s.sides[0].oil = 150;
  const X = -E.HQ_X;
  for (const [ax, az, bx, bz] of [
    [-90, -45, -200, -45],
    [90, -45, 200, -45],
    [-200, 55, 200, 55],
    [-200, 155, 200, 155],
  ])
    E.buildRoad(s, 0, X + ax, az, X + bx, bz);
  const spots = [];
  for (const dz of [-80, -10, 90, 20, 190, 120])
    for (const dx of [-110, -55, 55, 110, 165, -165]) spots.push([X + dx, dz]);
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
  return { s, place };
}

test('a production building gains a bonus for each nearby partner type and loses it with distance', () => {
  const { s, place } = city();
  place('power');
  place('power');
  const ammo = place('ammofactory');
  assert.equal(E.complexBonus(s, ammo), 1);
  assert.match(E.complexLabel(E.complexStatus(s, ammo)), /не хватает/);
  place('industry');
  place('electronics');
  s.time += 1;
  const status = E.complexStatus(s, ammo);
  assert.deepEqual(status.partners.sort(), ['electronics', 'industry']);
  assert.ok(Math.abs(status.bonus - status.max) < 1e-9);
  assert.match(E.complexLabel(status), /комплекс собран/);
  ammo.x += 2000;
  s.time += 1;
  assert.equal(E.complexBonus(s, ammo), 1, 'a distant plant has no complex');
});

test('without a working refinery drones and missiles fly slower and strike weaker', () => {
  const { s, place } = city();
  place('power');
  place('power');
  assert.equal(E.refineryActive(s, 0), false);
  assert.equal(E.weaponPerformance(s, 0), E.REFINED.without);
  const refinery = place('refinery');
  assert.equal(E.refineryActive(s, 0), true);
  assert.equal(E.weaponPerformance(s, 0), 1);
  const before = s.sides[0].oil;
  E.advance(s, 10);
  assert.ok(s.sides[0].oil < before, 'refining burns crude');
  s.sides[0].oil = 0;
  assert.equal(E.refineryActive(s, 0), false);
  assert.ok(E.problemMarkers(s, 0).some((m) => m.id === refinery.id && m.kind === 'oil'));
});
