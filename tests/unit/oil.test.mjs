import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

function fresh() {
  const s = E.createGame(512);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 1e5;
    f.materials = 1e4;
    f.tech = Object.keys(E.TECH);
  }
  return s;
}
function ready(s, side, key, x, z) {
  const b = E.build(s, side, key, x, z);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
// A street from the camp road to a point, so road-bound buildings can stand there.
function street(s, x, z) {
  assert.equal(typeof E.buildRoad(s, 0, -705, -45, x, z), 'object');
}

test('oil fields are mirrored, flat and dry; wells stand only on a field', () => {
  for (const f of E.OIL_FIELDS) {
    assert.ok(E.OIL_FIELDS.some((g) => g.x === -f.x && g.z === -f.z));
    assert.ok(E.seaDistance(f.x, f.z) > 100);
    assert.ok(E.groundHeight(f.x, f.z) < 0.01);
  }
  const s = fresh();
  street(s, -866, -228);
  assert.match(E.canPlace(s, 'oilwell', -820, -180, 0), /месторождение/);
  assert.equal(E.canPlace(s, 'oilwell', -880, -250, 0), null);
});

test('wells fill the storage, tanks raise it, and surplus beyond capacity is lost', () => {
  const s = fresh();
  street(s, -866, -228);
  ready(s, 0, 'oilwell', -880, -250);
  const f = s.sides[0];
  assert.equal(E.oilStorage(s, 0), E.OIL.baseStorage);
  E.advance(s, 30);
  assert.ok(f.oil > E.OIL.start + 10, f.oil);
  E.advance(s, 400);
  assert.ok(Math.abs(f.oil - E.OIL.baseStorage) < 1e-6, 'capped by the headquarters reserve');
  ready(s, 0, 'oiltank', -790, -60);
  assert.equal(E.oilStorage(s, 0), E.OIL.baseStorage + E.BUILDINGS.oiltank.storage);
  E.advance(s, 30);
  assert.ok(f.oil > E.OIL.baseStorage);
});

test('machines need oil to be built and crawl on empty tanks; infantry needs none', () => {
  const s = fresh();
  ready(s, 0, 'barracks', -680, -10);
  ready(s, 0, 'factory', -550, -10);
  const f = s.sides[0];
  f.oil = 10;
  assert.match(E.recruit(s, 0, 'leopard'), /нефти/);
  assert.match(E.produce(s, 0, 'cruise'), /нефти/);
  assert.equal(E.recruit(s, 0, 'infantry'), true);
  f.oil = 100;
  assert.equal(E.recruit(s, 0, 'leopard'), true);
  assert.equal(f.oil, 100 - E.GROUND_UNITS.leopard.oil);
  // Engines burn fuel on the move; dry tanks slow the machine to a crawl.
  const tank = E.makeGround(s, 0, 'leopard', -450, 250);
  s.groundUnits.push(tank);
  E.orderGround(s, 0, [tank.id], { x: -300, z: 250 });
  const before = f.oil;
  E.advance(s, 1);
  assert.ok(f.oil < before);
  const fast = Math.abs(tank.x + 450);
  f.oil = 0;
  const x = tank.x;
  E.advance(s, 1);
  assert.ok(Math.abs(tank.x - x) < fast * E.OIL.dryCrawl + 1);
});

test('a destroyed tank burns for minutes and sets the neighbouring tank on fire', () => {
  const s = fresh();
  const a = ready(s, 0, 'oiltank', -790, -60),
    b = ready(s, 0, 'oiltank', -790, -25);
  s.sides[0].oil = 600;
  a.hp = 0;
  E.step(s, 0.05);
  assert.ok(a.fire > E.OIL.fire - 1);
  assert.ok(s.events.some((e) => e.type === 'oilfire' && e.buildingId === a.id));
  assert.ok(s.sides[0].oil <= E.oilStorage(s, 0), 'the burnt tank takes its share of the stock');
  E.advance(s, 90);
  assert.equal(b.hp, 0, 'the fire spreads to the next tank');
  assert.ok(b.fire > 0);
  const copy = E.load(E.save(s));
  assert.equal(copy.buildings.find((x) => x.id === a.id).fire, a.fire);
});

test('a port ship sails to the island exchange, sells surplus oil and comes home with cargo', () => {
  const s = fresh();
  let x = -330;
  while (E.seaDistance(x, -20) > 20) x += 3;
  assert.equal(typeof E.buildRoad(s, 0, -525, -45, x - 30, -20), 'object');
  const port = ready(s, 0, 'port', x, -20);
  assert.match(E.canPlace(s, 'port', -600, 300, 0), /берегу/);
  ready(s, 0, 'oiltank', -790, -60);
  const f = s.sides[0];
  f.oil = 650;
  E.step(s, 0.05);
  assert.equal(s.ships.length, 1);
  const ship = s.ships[0];
  for (const p of [ship, E.berthOf(port), E.quayOf(port)]) assert.ok(E.seaDistance(p.x, p.z) < 0);
  let reached = false,
    credits = f.credits;
  for (let i = 0; i < 4000 && !(reached && ship.state === 'docked' && !ship.cargo); i++) {
    E.step(s, 0.05);
    assert.ok(E.seaDistance(ship.x, ship.z) < 0, 'ships stay on the water');
    if (ship.state === 'returning') reached = true;
  }
  assert.ok(reached);
  assert.ok(f.oil < 650, 'surplus oil was sold');
  assert.ok(f.credits > credits, 'sale and goods paid');
  assert.deepEqual(E.load(E.save(s)).ships, s.ships);
  port.hp = 0;
  E.step(s, 0.05);
  assert.equal(s.ships.length, 0, 'a ship is lost with its port');
});

test('old campaigns gain the starting oil stock and an empty fleet; corrupt values are refused', () => {
  const s = fresh();
  s.version = 11;
  delete s.ships;
  for (const f of s.sides) delete f.oil;
  const copy = E.load(E.save(s));
  assert.equal(copy.sides[0].oil, E.OIL.start);
  assert.deepEqual(copy.ships, []);
  const bad = fresh();
  bad.sides[0].oil = -5;
  assert.throws(() => E.load(E.save(bad)), /нефти/);
  const fleet = fresh();
  fleet.ships = [
    { id: 1, side: 0, portId: 999, x: 0, z: 0, yaw: 0, state: 'docked', wait: 0, path: [] },
  ];
  assert.throws(() => E.load(E.save(fleet)), /флот/);
});
