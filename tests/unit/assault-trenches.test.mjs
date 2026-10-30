import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { ASSAULT } from '../../src/game/units/ground/defense-attack.js';
import { invalidateStaticGeometry } from '../../src/game/shared/static-spatial.js';
import { trenchContains } from '../../src/game/defense/trench-footprint.js';

function fresh() {
  const s = E.createGame(2301);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.rearAuto = false;
  }
  return s;
}
function wave(s, count, x, z) {
  return Array.from({ length: count }, (_, i) => {
    const u = E.makeGround(s, 0, 'infantry', x - (i % 4) * 6, z + Math.floor(i / 4) * 6);
    u.holdFire = true;
    u.stance = { mode: 'attack' };
    u.defenseAttack = {
      phase: 'active',
      home: { x: u.x, z: u.z },
      initial: count,
      wave: 1,
      nextAt: 0,
    };
    s.groundUnits.push(u);
    return u;
  });
}
function trench(s, side, x, z, work = 90) {
  const t = { id: s.nextId++, side, x, z, progress: 1, yaw: Math.PI / 2, fortificationWork: work };
  s.trenches.push(t);
  invalidateStaticGeometry(s, 'trenches');
  return t;
}

test('an assault wave clears an empty enemy trench on its way, keeps its work and leaves a holder', () => {
  const s = fresh();
  const t = trench(s, 1, 250, -1500, 210);
  const units = wave(s, 8, 120, -1500);
  assert.ok(Math.hypot(units[0].x - t.x, units[0].z - t.z) < ASSAULT.trenchReach);
  let captured = false;
  for (let i = 0; i < 1200 && !captured; i++) {
    E.step(s, 0.05);
    captured = t.side === 0;
  }
  assert.ok(captured, 'the empty trench changes hands physically');
  assert.ok(t.fortificationWork >= 210, 'captured work stays with the earthwork');
  assert.ok(s.events.some((e) => e.type === 'trenchCaptured' && e.trenchId === t.id));
  E.advance(s, 4);
  const holders = units.filter(
    (u) => !u.defenseAttack && u.guard && trenchContains(t, u.guard.x, u.guard.z, 4),
  );
  assert.equal(holders.length, 1, 'exactly one soldier consolidates the captured trench');
  assert.equal(holders[0].autoDefense, false);
  assert.ok(units.filter((u) => u.defenseAttack?.phase === 'active').length >= ASSAULT.holdFrom);
  const loaded = E.load(E.save(s));
  assert.equal(loaded.trenches.find((v) => v.id === t.id).side, 0);
});

test('an occupied enemy trench is not captured while its defender lives, and a weak wave never splits', () => {
  const s = fresh();
  const t = trench(s, 1, 250, -1500);
  const defender = E.makeGround(s, 1, 'infantry', t.x, t.z);
  defender.holdFire = true;
  defender.hp = defender.maxHp = 1e9;
  s.groundUnits.push(defender);
  const units = wave(s, 3, 120, -1500);
  E.advance(s, 30);
  assert.equal(t.side, 1);
  defender.hp = 0;
  E.advance(s, 30);
  assert.equal(t.side, 0);
  assert.ok(
    units.every((u) => u.hp <= 0 || u.defenseAttack),
    'a small wave keeps attacking',
  );
});
