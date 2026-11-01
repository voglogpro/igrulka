import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

function sea() {
  const s = E.createGame(8161);
  s.mode = 'multiplayer';
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.components = 500;
  }
  const shore = (side, z, key) => {
    const sign = side ? 1 : -1;
    for (let x = sign * (E.HQ_X - 200); Math.abs(x) > 500; x -= sign * 4)
      if (!E.canPlace(s, key, x, z, side)) {
        const b = E.build(s, side, key, x, z);
        b.progress = 1;
        b.hp = b.maxHp;
        return b;
      }
    throw Error('no shore for ' + key);
  };
  return { s, shore };
}

test('a patrol boat sinks an enemy missile ship and then shells the undefended enemy shore', () => {
  const { s, shore } = sea();
  shore(0, 0, 'patrolbase');
  const base = shore(1, 200, 'navalbase');
  assert.match(E.canPlace(s, 'patrolbase', -E.HQ_X, 300, 0) || '', /воды/);
  E.advance(s, 120);
  assert.ok(s.events.some((e) => e.type === 'shipSunk') || base.hp < base.maxHp);
  E.advance(s, 120);
  assert.equal(base.hp, 0, 'the naval base on the shore is shelled to ruin');
  const boat = s.warships.find((v) => v.class === 'patrol');
  assert.ok(boat && boat.hp > 0);
  assert.deepEqual(E.load(E.save(s)).warships, s.warships);
});

test('a coastal battery keeps patrol boats out of its waters', () => {
  const { s, shore } = sea();
  shore(0, 0, 'patrolbase');
  const base = shore(1, 200, 'navalbase'),
    battery = shore(1, -200, 'coastgun');
  E.advance(s, 240);
  assert.equal(base.hp, base.maxHp);
  assert.equal(battery.hp, battery.maxHp);
  assert.ok(s.warships.some((v) => v.class === 'missile' && v.hp > 0));
});

test('a field anti-tank gun costs 200, needs no road and destroys an advancing tank', () => {
  const { s } = sea();
  assert.equal(E.BUILDINGS.atgun.cost, 200);
  const gun = E.build(s, 0, 'atgun', -400, -1500);
  assert.notEqual(typeof gun, 'string', gun);
  gun.progress = 1;
  gun.hp = gun.maxHp;
  const tank = E.makeGround(s, 1, 'leopard', -180, -1500);
  tank.holdFire = true;
  s.groundUnits.push(tank);
  E.advance(s, 40);
  assert.equal(tank.hp, 0);
  assert.ok(gun.groundAmmo + gun.ammoReserve < 12, 'paid shells were spent');
});
