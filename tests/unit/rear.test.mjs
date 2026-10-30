import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { damageGround } from '../../src/game/units/ground/combat.js';
import { DOWNED } from '../../src/game/units/ground/rear.js';

function fresh() {
  const s = E.createGame(555);
  s.mode = 'multiplayer';
  for (const f of s.sides) {
    f.credits = 1e6;
    f.materials = 1e6;
  }
  return s;
}
function unit(s, side, key, x, z = 250) {
  const u = E.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
}

test('some mortal wounds only put a soldier down, and a downed soldier cannot act or be ordered', () => {
  const s = fresh();
  let downed = 0,
    killed = 0;
  for (let i = 0; i < 60; i++) {
    const u = unit(s, 0, 'infantry', -1092 + i, 250);
    damageGround(s, u, 1000, () => {}, 'bullet');
    if (u.downed) downed++;
    else if (u.hp === 0) killed++;
  }
  assert.ok(downed > 5 && killed > 5, `${downed}/${killed}`);
  const u = s.groundUnits.find((v) => v.downed);
  assert.ok(u.hp > 0 && u.hp <= u.maxHp * 0.2);
  assert.equal(typeof E.orderGround(s, 0, [u.id], { x: -892, z: 250 }), 'string');
  const hostile = unit(s, 1, 'infantry', u.x + 20, u.z);
  E.advance(s, 2);
  assert.equal(hostile.enemyId === u.id, false);
});

test('without help a downed soldier bleeds out; a medic revives and heals the wounded', () => {
  const s = fresh();
  const lone = unit(s, 0, 'infantry', -992, 250);
  lone.downed = { t: 0, revive: 0 };
  lone.hp = 4;
  E.advance(s, DOWNED.bleedOut + 2);
  assert.equal(
    s.groundUnits.some((u) => u.id === lone.id),
    false,
  );
  const hurt = unit(s, 0, 'infantry', -992, 280);
  hurt.downed = { t: 0, revive: 0 };
  hurt.hp = 4;
  const sore = unit(s, 0, 'infantry', -972, 280);
  sore.hp = sore.maxHp * 0.3;
  unit(s, 0, 'medic', -1022, 280);
  E.advance(s, 25);
  assert.equal(hurt.downed, null);
  assert.ok(hurt.hp >= hurt.maxHp * DOWNED.reviveHp);
  assert.ok(sore.hp > sore.maxHp * 0.6);
});

test('a supply truck mends machines and buildings by itself and follows the army', () => {
  const s = fresh();
  const tank = unit(s, 0, 'leopard', -1192, 250);
  tank.hp = 200;
  const truck = unit(s, 0, 'supplytruck', -1202, 250);
  tank.groundReload = 20;
  const before = s.sides[0].credits;
  E.advance(s, 10);
  assert.ok(tank.hp > 230);
  assert.ok(tank.groundReload < 12);
  assert.ok(s.sides[0].credits < before);
  const far = unit(s, 0, 'infantry', -992, 250);
  far.guard = null;
  const start = truck.x;
  assert.equal(E.orderGround(s, 0, [tank.id], { x: -992, z: 250 }), 1);
  E.advance(s, 40);
  assert.ok(Math.hypot(truck.x - tank.x, truck.z - tank.z) < 150);
  assert.ok(truck.x > start + 100, 'the truck physically follows the departing machine');
});

test('rear service never purchases unselected medics or trucks even for a large army', () => {
  const s = fresh();
  for (let i = 0; i < 10; i++) unit(s, 0, 'infantry', -1192, 200 + i * 6);
  for (let i = 0; i < 3; i++) unit(s, 0, 'leopard', -1292, 200 + i * 15);
  const before = s.sides[0].materials;
  E.advance(s, 20);
  assert.equal(s.groundUnits.filter((u) => ['medic', 'supplytruck'].includes(u.key)).length, 0);
  assert.equal(s.sides[0].materials, before);
  assert.ok(s.buildings.every((b) => !b.armyQueue?.length));
});

test('support units and wounded soldiers survive save and load, with older saves migrated', () => {
  const s = fresh();
  const u = unit(s, 0, 'infantry', -992, 250);
  u.downed = { t: 3, revive: 1 };
  u.hp = 4;
  unit(s, 0, 'medic', -1002, 250);
  const copy = E.load(E.save(s));
  assert.equal(copy.groundUnits.find((v) => v.id === u.id).downed.t, 3);
  const old = JSON.parse(E.save(s));
  delete old.rules;
  for (const f of old.sides) delete f.rearAuto;
  const migrated = E.load(JSON.stringify(old));
  assert.equal(migrated.rules.rear, true);
  assert.equal(migrated.sides[0].rearAuto, true);
  u.downed = { t: 'x', revive: 0 };
  assert.throws(() => E.load(E.save(s)));
});

test('medics keep healing past seventy percent and front camps stay on their own land crossing', () => {
  const s = fresh();
  const hurt = unit(s, 0, 'infantry', -992, -1350);
  hurt.hp = hurt.maxHp * 0.72;
  const medic = unit(s, 0, 'medic', -997, -1350);
  unit(s, 0, 'infantry', -992, 1350);
  const south = unit(s, 0, 'medic', -1012, 1350);
  E.advance(s, 4);
  assert.ok(hurt.hp >= hurt.maxHp * 0.95);
  assert.ok(medic.z < -1000 && south.z > 1000);
  assert.equal(medic.supportFront, 0);
  assert.equal(south.supportFront, 1);
});

test('supply truck transports a medic using real passenger seats then safely dismounts', () => {
  const s = fresh();
  unit(s, 0, 'infantry', -842, 250);
  const truck = unit(s, 0, 'supplytruck', -1192, 250);
  const medic = unit(s, 0, 'medic', -1200, 250);
  E.advance(s, 1);
  assert.ok(medic.boardingId === truck.id || medic.carrierId === truck.id);
  E.advance(s, 2);
  assert.equal(medic.carrierId, truck.id);
  const loaded = E.load(E.save(s));
  const passenger = loaded.groundUnits.find((u) => u.id === medic.id);
  assert.equal(passenger.carrierId, truck.id);
  E.advance(loaded, 35);
  assert.equal(passenger.carrierId, null);
  assert.equal(passenger.supportManual, false);
  assert.ok(passenger.x > -1042);
});
