import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { groundEngagement } from '../../src/game/units/ground/engagement.js';

function fresh() {
  const s = E.createGame(77);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e5;
    f.tech = Object.keys(E.TECH);
  }
  return s;
}
function unit(s, side, key, x, z = 250) {
  const u = E.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}

test('a howitzer fires over a building that blocks direct fire', () => {
  const s = fresh(),
    gun = unit(s, 0, 'howitzer', -560),
    target = unit(s, 1, 'leopard', -260);
  target.hp = target.maxHp = 1e5;
  s.buildings.push({
    id: s.nextId++,
    key: 'radar',
    side: 0,
    x: -410,
    z: 250,
    hp: 300,
    maxHp: 300,
    progress: 1,
  });
  s.networkRevision++;
  assert.equal(E.lineOfSight(s, gun, target), false);
  assert.equal(groundEngagement(s, gun).target?.id, target.id);
  E.advance(s, 9);
  assert.ok(s.events.some((e) => e.type === 'shot' && e.shooter === 'howitzer'));
});

test('artillery shells fly a high arc and burst with area damage', () => {
  const s = fresh();
  const gun = unit(s, 0, 'howitzer', -560);
  const crowd = [0, 1, 2].map((i) => unit(s, 1, 'infantry', -180 + i * 3, 250 + i * 2));
  for (const u of crowd) u.holdFire = true;
  // Hidden infantry in the forest has to be spotted first.
  assert.equal(groundEngagement(s, gun).target, null);
  unit(s, 0, 'sniper', -215).holdFire = true;
  gun.nextThink = 0;
  let apex = 0;
  for (let i = 0; i < 400 && crowd.some((u) => u.hp === u.maxHp); i++) {
    E.step(s, 0.05);
    for (const p of s.projectiles) if (p.shooterKey === 'howitzer') apex = Math.max(apex, p.y);
  }
  assert.ok(apex > 60, `apex ${apex}`);
  assert.ok(s.events.some((e) => e.type === 'impact' && e.key === 'artillery'));
  assert.ok(crowd.filter((u) => u.hp < u.maxHp).length >= 2);
});

test('targets inside the dead zone are ignored', () => {
  const s = fresh(),
    gun = unit(s, 0, 'howitzer', -500);
  unit(s, 1, 'leopard', -440);
  assert.equal(groundEngagement(s, gun).target, null);
});
