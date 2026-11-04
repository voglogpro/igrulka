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
        const hull = { patrolbase: 'patrol', navalbase: 'missile' }[key];
        if (hull) assert.equal(typeof E.buyShip(s, side, b.id, hull), 'number');
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

test('a destroyer is bought at a naval base, guns down drones and launches drones from its shaft', () => {
  const { s, shore } = sea();
  const base = shore(0, 0, 'navalbase');
  // The fixture's missile ship is sunk; the yard then builds the big hull for its full price.
  E.applyBlast(s, s.warships[0].x, s.warships[0].z, 5000, 4);
  E.advance(s, 1);
  assert.equal(E.buyShip(s, 0, base.id, 'patrol'), 'Эта верфь не строит такой корабль');
  const credits = s.sides[0].credits;
  const id = E.buyShip(s, 0, base.id, 'destroyer');
  assert.equal(typeof id, 'number');
  assert.equal(credits - s.sides[0].credits, E.SHIPS.destroyer.cost);
  assert.equal(E.buyShip(s, 0, base.id, 'destroyer'), 'У причала уже есть корабль');
  const ship = s.warships.find((v) => v.id === id);
  assert.equal(ship.maxHp, E.SHIPS.destroyer.hp);
  assert.equal(E.launchSiteAllows(base, 'drone'), true, 'the launch shaft takes drones');
  assert.equal(E.launchStoreCapacity(base, 'drone'), 8);
  // Enemy drones over the ship are met by machine-gun fire.
  for (let i = 0; i < 6; i++)
    s.units.push({
      id: s.nextId++,
      side: 1,
      key: 'drone',
      x: ship.x + 150 + i * 10,
      y: 60,
      z: ship.z,
      vx: -20,
      vy: 0,
      vz: 0,
      hp: E.WEAPONS.drone.hp,
      maxHp: E.WEAPONS.drone.hp,
      launched: true,
      status: 'flying',
      targetX: ship.x,
      targetZ: ship.z,
    });
  const before = s.stats.shots;
  E.advance(s, 2);
  assert.ok(s.stats.shots > before, 'the mounts open fire');
  assert.ok(s.projectiles.some((p) => p.sourceId === ship.id) || s.stats.shots - before >= 3);
  assert.ok(E.acceptLaunchDelivery(base, 'drone', 3) > 0 || base.launchStore.drone === 3);
  const launched = E.launch(s, 0, 'drone', { x: E.HQ_X - 300, z: 0 }, 3, base.id);
  assert.equal(launched, 3);
  // The hand-made enemy drones are test props, not a saved flight plan.
  s.units = s.units.filter((u) => u.side === 0);
  s.projectiles = [];
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.warships, s.warships);
});
