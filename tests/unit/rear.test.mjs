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
    f.tech = Object.keys(E.TECH);
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
    const u = unit(s, 0, 'infantry', -500 + i, 250);
    damageGround(s, u, 1000, () => {}, 'bullet');
    if (u.downed) downed++;
    else if (u.hp === 0) killed++;
  }
  assert.ok(downed > 5 && killed > 5, `${downed}/${killed}`);
  const u = s.groundUnits.find((v) => v.downed);
  assert.ok(u.hp > 0 && u.hp <= u.maxHp * 0.2);
  assert.equal(typeof E.orderGround(s, 0, [u.id], { x: -300, z: 250 }), 'string');
  const hostile = unit(s, 1, 'infantry', u.x + 20, u.z);
  E.advance(s, 2);
  assert.equal(hostile.enemyId === u.id, false);
});

test('without help a downed soldier bleeds out; a medic revives and heals the wounded', () => {
  const s = fresh();
  const lone = unit(s, 0, 'infantry', -400, 250);
  lone.downed = { t: 0, revive: 0 };
  lone.hp = 4;
  E.advance(s, DOWNED.bleedOut + 2);
  assert.equal(
    s.groundUnits.some((u) => u.id === lone.id),
    false,
  );
  const hurt = unit(s, 0, 'infantry', -400, 280);
  hurt.downed = { t: 0, revive: 0 };
  hurt.hp = 4;
  const sore = unit(s, 0, 'infantry', -380, 280);
  sore.hp = sore.maxHp * 0.3;
  unit(s, 0, 'medic', -430, 280);
  E.advance(s, 25);
  assert.equal(hurt.downed, null);
  assert.ok(hurt.hp >= hurt.maxHp * DOWNED.reviveHp);
  assert.ok(sore.hp > sore.maxHp * 0.6);
});

test('a supply truck mends machines and buildings by itself and follows the army', () => {
  const s = fresh();
  const tank = unit(s, 0, 'leopard', -300, 250);
  tank.hp = 200;
  const truck = unit(s, 0, 'supplytruck', -310, 250);
  tank.groundReload = 20;
  const before = s.sides[0].credits;
  E.advance(s, 10);
  assert.ok(tank.hp > 230);
  assert.ok(tank.groundReload < 12);
  assert.ok(s.sides[0].credits < before);
  const far = unit(s, 0, 'infantry', -100, 250);
  far.guard = null;
  E.orderGround(s, 0, [tank.id], { x: -100, z: 250 });
  E.advance(s, 40);
  assert.ok(Math.hypot(truck.x - tank.x, truck.z - tank.z) < 150);
});

test('each side trains medics and trucks in proportion to its army, unless switched off', () => {
  const s = fresh();
  s.buildings.push({
    id: s.nextId++,
    key: 'barracks',
    side: 0,
    x: -560,
    z: 60,
    hp: 700,
    maxHp: 700,
    progress: 1,
    armyQueue: [],
  });
  for (let i = 0; i < 10; i++) unit(s, 0, 'infantry', -500, 100 + i * 6);
  unit(s, 0, 'leopard', -480, 40);
  unit(s, 0, 'leopard', -460, 40);
  E.advance(s, 20);
  const queued = s.buildings.find((b) => b.key === 'barracks').armyQueue.map((q) => q.key);
  const total = (key) =>
    s.groundUnits.filter((u) => u.key === key).length + queued.filter((k) => k === key).length;
  assert.ok(total('medic') >= 1 && total('supplytruck') >= 1, queued.join());
  const off = fresh();
  off.sides[0].rearAuto = false;
  off.buildings.push({
    id: off.nextId++,
    key: 'barracks',
    side: 0,
    x: -560,
    z: 60,
    hp: 700,
    maxHp: 700,
    progress: 1,
    armyQueue: [],
  });
  for (let i = 0; i < 10; i++) unit(off, 0, 'infantry', -500, 100 + i * 6);
  E.advance(off, 20);
  assert.equal(off.buildings.find((b) => b.key === 'barracks').armyQueue.length, 0);
});

test('support units and wounded soldiers survive save and load, with older saves migrated', () => {
  const s = fresh();
  const u = unit(s, 0, 'infantry', -400, 250);
  u.downed = { t: 3, revive: 1 };
  u.hp = 4;
  unit(s, 0, 'medic', -410, 250);
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
