import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { impactGround } from '../../src/game/units/ground/combat.js';
import { moveProjectiles } from '../../src/game/combat/projectiles.js';

function quiet() {
  const s = E.createGame(1022);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = s.ai.nextArmy = 1e9;
  return s;
}

for (const key of ['machinegunner', 'assault']) {
  test(`${key} keeps its actual shared magazine size after reloading`, () => {
    const s = quiet(),
      u = E.makeGround(s, 0, key, -1012, 0);
    s.groundUnits.push(u);
    const expected = E.GROUND_UNITS[key].groundMagazine;
    assert.equal(u.groundAmmo, expected);
    u.groundAmmo = 0;
    E.advance(s, 7);
    assert.equal(u.groundReload, 0);
    assert.equal(u.groundAmmo, expected);
  });
}

for (const [key, expected] of [
  ['infantry', E.GROUND_UNITS.infantry.groundMagazine],
  ['machinegunner', E.GROUND_UNITS.machinegunner.groundMagazine],
  ['assault', E.GROUND_UNITS.assault.groundMagazine],
  ['mog', E.GROUND_UNITS.mog.groundMagazine],
]) {
  test(`${key} recruits with its configured shared magazine and refills the same amount`, () => {
    const s = quiet();
    s.mode = 'multiplayer';
    s.sides[0].credits = 10000;
    s.sides[0].materials = 1000;
    const b = E.build(s, 0, 'barracks', -1272, -10);
    assert.notEqual(typeof b, 'string', b);
    b.progress = 1;
    b.hp = b.maxHp;
    assert.equal(E.setRallyMode(s, 0, b.id, 'wait'), true);
    assert.equal(E.recruit(s, 0, key, b.id), true);
    b.armyQueue[0].progress = 0.999;
    E.advance(s, 0.1);
    const u = s.groundUnits.find((u) => u.key === key);
    assert.ok(u);
    assert.equal(u.groundAmmo, expected);
    u.groundAmmo = 0;
    E.advance(s, 7);
    assert.equal(u.groundReload, 0);
    assert.equal(u.groundAmmo, expected);
    assert.equal(
      E.load(E.save(s)).groundUnits.find((saved) => saved.id === u.id).groundAmmo,
      expected,
    );
  });
}

test('configured shared magazines preserve the separate sniper, APC and AA-only weapon cycles', () => {
  const s = quiet();
  s.mode = 'multiplayer';
  const sniper = E.makeGround(s, 0, 'sniper', -1022, 250);
  const apc = E.makeGround(s, 0, 'apc', -1042, 250);
  const shilka = E.makeGround(s, 0, 'shilka', -1062, 250);
  s.groundUnits.push(sniper, apc, shilka);
  assert.equal(sniper.groundAmmo, 5);
  assert.equal(apc.groundAmmo, 80);
  assert.equal(shilka.groundAmmo, 30);
  E.advance(s, 0.05);
  assert.equal(shilka.ammo, E.GROUND_UNITS.shilka.magazine);
  sniper.groundAmmo = 0;
  apc.groundAmmo = 0;
  shilka.ammo = 0;
  E.advance(s, 7);
  assert.equal(sniper.groundAmmo, 5);
  assert.equal(apc.groundAmmo, 80);
  assert.equal(shilka.groundAmmo, 30);
  assert.equal(shilka.ammo, E.GROUND_UNITS.shilka.magazine);
});

test('ground-only sniper cools down without needing an airborne target or an AA weapon', () => {
  const s = quiet(),
    u = E.makeGround(s, 0, 'sniper', -1012, 0);
  s.groundUnits.push(u);
  u.heat = 1;
  E.advance(s, 6);
  assert.ok(u.heat < 0.4, `Sniper remained at heat ${u.heat}`);
});

test('a ground round which misses the selected building cannot deal damage through its target ID', () => {
  const s = quiet(),
    b = s.buildings[1],
    hp = b.hp;
  impactGround(s, {
    side: 0,
    source: 99,
    shooterKey: 'infantry',
    targetId: b.id,
    kind: 'bullet',
    damage: 50,
    tx: b.x + 100,
    tz: b.z,
    px: b.x - 100,
    pz: b.z,
  });
  assert.equal(b.hp, hp);
});

test('a direct ground hit still damages the building at the actual impact point', () => {
  const s = quiet(),
    b = s.buildings[1],
    hp = b.hp;
  impactGround(s, {
    side: 0,
    source: 99,
    shooterKey: 'infantry',
    targetId: b.id,
    kind: 'bullet',
    damage: 50,
    tx: b.x,
    tz: b.z,
    px: b.x - 100,
    pz: b.z,
  });
  assert.ok(b.hp < hp);
});

test('the last ground projectile step lands on its actual destination without overshooting', () => {
  const s = quiet(),
    p = {
      id: s.nextId++,
      side: 0,
      source: 99,
      shooterKey: 'infantry',
      domain: 'ground',
      kind: 'bullet',
      targetId: null,
      x: -1092,
      z: 100,
      y: 2,
      px: -500,
      pz: 100,
      py: 2,
      vx: 270,
      vz: 0,
      vy: 0,
      tx: -1061,
      tz: 100,
      damage: 4,
      flight: 31 / 270,
      life: 0,
      maxLife: 2,
    };
  s.projectiles.push(p);
  moveProjectiles(s, 0.05);
  moveProjectiles(s, 0.05);
  moveProjectiles(s, 0.05);
  assert.equal(p.dead, true);
  assert.ok(Math.abs(p.x - p.tx) < 1e-8, `Overshot destination by ${p.x - p.tx}`);
  assert.equal(p.z, p.tz);
});
