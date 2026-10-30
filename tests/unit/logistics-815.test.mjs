import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { FIELD_SUPPLY } from '../../src/game/city/field-ammo.js';

function fresh(mode = 'multiplayer') {
  const s = E.createGame(815, { mode });
  s.rules.oil = false;
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.components = 500;
  }
  return s;
}
function ready(s, key, x, z, side = 0) {
  const b = E.build(s, side, key, x, z);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function box(s, x, z, side = 0, amount = 120) {
  const c = {
    id: s.nextId++,
    side,
    key: 'ammo-crate',
    x,
    z,
    hp: FIELD_SUPPLY.hp,
    maxHp: FIELD_SUPPLY.hp,
    stock: { small: amount, shell: 0, rocket: 0, sam: 0 },
  };
  (s.ammoCrates ||= []).push(c);
  return c;
}
function rifleman(s, side, x, z, empty = false) {
  const u = E.makeGround(s, side, 'infantry', x, z);
  u.holdFire = true;
  if (empty) u.groundAmmo = u.ammoReserve = 0;
  s.groundUnits.push(u);
  return u;
}

test('a drone base assembles on parallel lines and its paid queue finishes sooner', () => {
  const s = fresh();
  const X = -E.HQ_X;
  ready(s, 'power', X - 55, -80);
  const factory = ready(s, 'factory', X - 65, -10);
  assert.equal(E.produce(s, 0, 'drone', 4), true);
  E.advance(s, E.WEAPONS.drone.time + 0.5);
  assert.equal(factory.launchStore.drone + E.weaponStock(s, 0, 'drone') > 0, true);
  // Two lines at the base level: two finished craft after one assembly time.
  assert.equal(factory.queue.length, 4 - E.FACTORY_LINES[0]);
  E.advance(s, E.WEAPONS.drone.time);
  assert.equal(factory.queue.length, 0);
  assert.equal(E.weaponStock(s, 0, 'drone'), 4);
});

test('ready craft are shared between the empty pads instead of filling the nearest one', () => {
  const s = fresh();
  const X = -E.HQ_X;
  ready(s, 'power', X - 55, -80);
  const factory = ready(s, 'factory', X - 65, -10);
  const near = ready(s, 'launcher', X + 65, -10),
    far = ready(s, 'launcher', X + 200, 300);
  E.acceptLaunchDelivery(factory, 'drone', 6);
  E.advance(s, 60);
  const stock = (pad) => E.availableLaunchStock(pad, 'drone');
  assert.ok(stock(near) >= 2, `near ${stock(near)}`);
  assert.ok(stock(far) >= 2, `far ${stock(far)}`);
  assert.equal(E.weaponStock(s, 0, 'drone'), 6, 'no craft is created or lost on the way');
});

test('posts walk only to a nearby box and never around the sea to a distant depot', () => {
  const s = fresh();
  const far = box(s, 0, -1360);
  const u = rifleman(s, 0, 24, 1300, true);
  u.autoDefense = true;
  u.guard = { x: u.x, z: u.z };
  E.advance(s, 3);
  assert.equal(u.supplyTrip, undefined, 'a 2.6 km walk is not a resupply trip');
  const near = box(s, 24 + FIELD_SUPPLY.walkRadius - 30, 1300);
  E.advance(s, 2);
  assert.equal(u.supplyTrip?.crateId, near.id);
  assert.notEqual(u.supplyTrip?.crateId, far.id);
});

test('an unguarded box is captured with its rounds by enemy infantry, but not while guarded', () => {
  const s = fresh();
  const c = box(s, -300, -1500, 0, 90);
  const guard = rifleman(s, 0, c.x - 30, c.z);
  rifleman(s, 1, c.x + 10, c.z);
  E.advance(s, 2);
  assert.equal(c.side, 0, 'a nearby defender keeps the box');
  guard.hp = 0;
  E.advance(s, 2);
  assert.equal(c.side, 1);
  assert.equal(c.stock.small, 90);
  const loaded = E.load(E.save(s));
  assert.equal(loaded.ammoCrates.find((v) => v.id === c.id).side, 1);
});
