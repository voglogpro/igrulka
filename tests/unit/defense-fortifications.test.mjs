import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { updateFortification } from '../../src/game/defense/fortifications.js';

function fresh() {
  const s = E.createGame(861);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 10000;
    f.materials = 1000;
    f.rearAuto = false;
  }
  return s;
}
function guard(s, key = 'infantry', x = -430, z = 380, side = 0) {
  const u = E.makeGround(s, side, key, x, z);
  u.guard = { x, z };
  u.order = { x, z, mode: 'guard' };
  u.holdFire = true;
  s.groundUnits.push(u);
  return u;
}

test('ordinary guard and exact drawn defense lines dig without consenting to reserve movement', () => {
  const s = fresh(),
    a = guard(s),
    b = guard(s, 'infantry', -390);
  assert.equal(E.defendLineGround(s, 0, [a.id, b.id], a, b), 2);
  const posts = [a, b].map((u) => ({ ...u.guard }));
  E.advance(s, 13);
  for (const [i, u] of [a, b].entries()) {
    assert.deepEqual(u.guard, posts[i]);
    assert.equal(u.autoDefense, false);
    assert.equal(E.fortificationStatus(s.trenches.find((t) => t.id === u.trenchId)).level, 1);
  }
});

test('stationary positions advance through paid stages and an engineer builds twice as fast', () => {
  const s = fresh(),
    rifle = guard(s),
    engineer = guard(s, 'engineer', -360);
  E.advance(s, 7);
  assert.ok(s.trenches.find((t) => t.id === rifle.trenchId).progress < 1);
  assert.equal(E.fortificationStatus(s.trenches.find((t) => t.id === engineer.trenchId)).level, 1);
  E.advance(s, 23);
  const a = s.trenches.find((t) => t.id === rifle.trenchId),
    b = s.trenches.find((t) => t.id === engineer.trenchId);
  assert.equal(E.fortificationStatus(a).level, 1);
  assert.equal(E.fortificationStatus(b).level, 2);
  E.advance(s, 75);
  assert.equal(E.fortificationStatus(a).level, 3);
  assert.equal(E.fortificationStatus(b).level, 3);
  assert.equal(a.progress, 1);
  assert.equal(a.fortificationWork, 90);
  assert.equal(E.fortificationStatus(a).cover, 0.82);
  assert.ok(
    s.events.filter((e) => e.type === 'fortification').length <= 6,
    'only completed stages notify',
  );
});

test('upper fortifications spend only affordable work and resource shortage never produces free protection', () => {
  const s = fresh(),
    u = guard(s);
  s.trenches.push({ id: s.nextId++, side: 0, x: u.x, z: u.z, progress: 1 });
  s.sides[0].credits = 0;
  s.sides[0].materials = 0;
  updateFortification(s, u, 1);
  const t = s.trenches[0];
  assert.equal(t.fortificationWork || 0, 0);
  s.sides[0].credits = 0.1;
  s.sides[0].materials = 0.0075;
  s.time += 1;
  updateFortification(s, u, 1);
  assert.equal(t.fortificationWork, 0.5);
  assert.equal(s.sides[0].credits, 0);
  assert.equal(s.sides[0].materials, 0);
  s.time += 1;
  updateFortification(s, u, 1);
  assert.equal(t.fortificationWork, 0.5);
  assert.equal(E.fortificationStatus(t).level, 1);
});

test('actual damage uses the strongest cover once and reinforced posts remain vulnerable to bullets and blasts', () => {
  const damages = [];
  for (const work of [0, 30, 90]) {
    const s = fresh(),
      u = guard(s);
    u.hp = u.maxHp = 1000;
    s.trenches.push({
      id: s.nextId++,
      side: 0,
      x: u.x,
      z: u.z,
      progress: 1,
      fortificationWork: work,
    });
    damageGround(s, u, 100, undefined, 'bullet', { x: -200, z: u.z });
    const bullet = 1000 - u.hp;
    damageGround(s, u, 100, undefined, 'blast', { x: -200, z: u.z });
    const blast = 1000 - bullet - u.hp;
    assert.ok(blast > 60, 'blast must still cause most of its nominal damage');
    assert.ok(bullet >= 18 - 1e-8);
    damages.push(bullet);
  }
  assert.ok(damages[0] > damages[1] && damages[1] > damages[2]);
  assert.ok(Math.abs(damages[0] - 28) < 1e-8);
  assert.ok(Math.abs(damages[2] - 18) < 1e-8);
});

test('threat interrupts automatic earthworks so the defender can shoot and moving away preserves the physical trench', () => {
  const s = fresh(),
    u = guard(s);
  u.holdFire = false;
  E.advance(s, 2);
  const t = s.trenches.find((t) => t.id === u.trenchId),
    progress = t.progress;
  const foe = E.makeGround(s, 1, 'infantry', u.x + 45, u.z);
  foe.holdFire = true;
  s.groundUnits.push(foe);
  E.advance(s, 0.4);
  assert.equal(u.digging, false);
  assert.ok(
    t.progress - progress <= 0.35 / 12,
    'only the bounded target-scan delay can advance work',
  );
  const stopped = t.progress;
  E.advance(s, 0.6);
  assert.equal(t.progress, stopped);
  assert.ok(s.events.some((e) => e.type === 'shot' && e.buildingId === u.id));
  assert.equal(E.orderGround(s, 0, [u.id], { x: -500, z: 450 }), 1);
  E.advance(s, 5);
  assert.ok(Math.hypot(u.x - t.x, u.z - t.z) > 15);
  assert.equal(t.progress, stopped);
});

test('vehicles do not grow infantry trenches and keep their fire direction near the assigned post', () => {
  const s = fresh(),
    tank = guard(s, 'leopard');
  E.advance(s, 30);
  assert.equal(s.trenches.length, 0);
  tank.holdFire = false;
  const foe = E.makeGround(s, 1, 'infantry', tank.x + 130, tank.z);
  foe.holdFire = true;
  s.groundUnits.push(foe);
  E.advance(s, 3);
  assert.ok(Math.hypot(tank.x - tank.guard.x, tank.z - tank.guard.z) <= 40);
});

test('old trenches retain progress and cover, new fortification fields round trip and malformed work is rejected', () => {
  const s = fresh(),
    u = guard(s);
  E.advance(s, 50);
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.trenches, s.trenches);
  assert.deepEqual(loaded.frontlineMemory, s.frontlineMemory);
  const old = JSON.parse(E.save(s));
  old.version = 11;
  delete old.frontlineMemory;
  delete old.trenches[0].fortificationWork;
  old.groundUnits[0].autoDefense = true;
  const migrated = E.load(JSON.stringify(old));
  assert.equal(migrated.groundUnits[0].autoDefense, false);
  assert.equal(migrated.trenches[0].progress, 1);
  assert.equal(E.fortificationStatus(migrated.trenches[0]).cover, 0.72);
  for (const value of [-1, 91, 'constructor']) {
    const bad = JSON.parse(E.save(s));
    bad.trenches[0].fortificationWork = value;
    assert.throws(() => E.load(JSON.stringify(bad)));
  }
  assert.ok(u.trenchId);
});
