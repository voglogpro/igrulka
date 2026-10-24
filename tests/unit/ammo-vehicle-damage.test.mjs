import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { damageAmmoVehicle } from '../../src/game/city/ammo-vehicle-damage.js';
import { impactGround } from '../../src/game/units/ground/combat.js';
import { groundDamageMultiplier } from '../../src/game/units/ground/engagement.js';
import { playerView } from '../../src/network/perspective.js';
import { supplyHTML } from '../../src/ui/equipment-detail.js';

const C = E.AMMUNITION.vehicle;
function fresh() {
  const s = E.createGame(8920);
  s.mode = 'multiplayer';
  s.rules.oil = false;
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 10000;
    f.materials = 1000;
  }
  return s;
}
function building(s, key, x = -1080, z = -10) {
  const b = E.build(s, 0, key, x, z);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function tick(s, seconds) {
  for (let i = 0; i < Math.ceil(seconds / 0.05); i++) {
    s.time += 0.05;
    E.updateAmmoLogistics(s, 0.05);
  }
}
function shipment(kind = 'ammo') {
  const s = fresh(),
    depot = building(s, kind === 'ammo' ? 'ammofactory' : 'factory');
  let target;
  if (kind === 'ammo') {
    target = E.makeGround(s, 0, 'infantry', -1450, 250);
    target.groundAmmo = 0;
    target.ammoReserve = 0;
    target.holdFire = true;
    s.groundUnits.push(target);
    s.sides[0].ammoStock.small = E.ammunitionStatus(s, target).capacity;
  } else {
    target = building(s, 'silo', -1450, 250);
    s.sides[0].inventory.cruise = 1;
    target.weaponDemand = { cruise: 1 };
  }
  tick(s, 0.05);
  const van = s.ammoVehicles.find((v) => v.cargo);
  assert.ok(van, 'paid cargo must be picked up before the attack');
  return { s, depot, target, van };
}

test('actual blast destroys paid ammo and weapon cargo once without refund or remote delivery', () => {
  for (const kind of ['ammo', 'weapon']) {
    const { s, target, van } = shipment(kind),
      f = s.sides[0],
      before = structuredClone(f),
      losses = f.losses;
    assert.equal(kind === 'ammo' ? f.ammoStock.small : f.inventory.cruise, 0);
    E.applyBlast(s, van.x, van.z, C.hp * 10, 2);
    assert.equal(van.hp, 0);
    assert.equal(van.status, 'destroyed');
    assert.equal(van.cargo, null);
    assert.equal(van.targetId, null);
    assert.deepEqual(van.path, []);
    assert.equal(van.replaceAt, s.time + C.replacementDelay);
    assert.equal(f.credits, before.credits);
    assert.equal(f.materials, before.materials);
    assert.deepEqual(f.ammoStock, before.ammoStock);
    assert.deepEqual(f.inventory, before.inventory);
    assert.ok(f.losses > losses);
    const deaths = s.events.filter(
      (e) => e.type === 'groundDestroyed' && e.unitId === van.id,
    ).length;
    E.applyBlast(s, van.x, van.z, C.hp * 10, 2);
    assert.equal(
      s.events.filter((e) => e.type === 'groundDestroyed' && e.unitId === van.id).length,
      deaths,
    );
    tick(s, 2);
    assert.equal(
      kind === 'ammo' ? target.ammoReserve : E.availableLaunchStock(target, 'cruise'),
      0,
    );
    assert.ok(
      s.ammoVehicles.some((v) => v.id === van.id && v.hp === 0),
      'destroyed slot prevents free respawn',
    );
  }
});

test('destroyed slot survives save/load, waits its cooldown and reserves, then pays for one new vehicle', () => {
  const { s, van, depot } = shipment();
  damageAmmoVehicle(s, van, C.hp);
  const loaded = E.load(E.save(s)),
    dead = loaded.ammoVehicles.find((v) => v.id === van.id);
  assert.equal(dead.status, 'destroyed');
  assert.equal(dead.replaceAt, van.replaceAt);
  tick(loaded, C.replacementDelay - 1);
  assert.ok(loaded.ammoVehicles.includes(dead));
  loaded.sides[0].credits = 250 + C.replacementCost - 1;
  loaded.sides[0].materials = 5 + C.replacementMetal;
  tick(loaded, 3);
  assert.ok(loaded.ammoVehicles.includes(dead), 'replacement preserves the cash reserve');
  loaded.sides[0].credits++;
  tick(loaded, 2);
  const replacement = loaded.ammoVehicles.find(
    (v) => v.depotId === depot.id && v.slot === dead.slot,
  );
  assert.notEqual(replacement.id, dead.id);
  assert.equal(replacement.hp, C.hp);
  assert.equal(loaded.sides[0].credits, 250);
  assert.equal(loaded.sides[0].materials, 5);
  assert.equal(replacement.cargo, null);
});

test('blast falloff affects both sides while actual artillery impact preserves enemy-only splash policy', () => {
  const s = fresh();
  s.buildings = [];
  s.roads = [];
  const van = (id, side, x) => ({
    id,
    side,
    x,
    z: 250,
    y: 2,
    hp: 1000,
    maxHp: 1000,
    status: 'idle',
    cargo: null,
    path: [],
  });
  const own = van(s.nextId++, 0, -1300),
    enemy = van(s.nextId++, 1, -1275);
  s.ammoVehicles = [own, enemy];
  E.applyBlast(s, -1300, 250, 100, 20);
  assert.equal(own.hp, 900);
  assert.equal(enemy.hp, 980);
  own.hp = enemy.hp = 1000;
  enemy.x = -1294;
  impactGround(s, {
    side: 0,
    shooterKey: 'howitzer',
    kind: 'shell',
    damage: 100,
    source: 999,
    originX: -1340,
    originZ: 250,
    tx: -1300,
    tz: 250,
  });
  assert.equal(own.hp, 1000);
  const amount =
    100 *
    groundDamageMultiplier('howitzer', { key: 'supplytruck' }, 'shell') *
    (1 - 6 / (18 * 1.15));
  assert.ok(Math.abs(enemy.hp - (1000 - amount)) < 1e-10);
});

test('fleet death events respect fog audience and supply cargo uses readable finite-stock labels', () => {
  const s = fresh();
  const van = { id: s.nextId++, side: 1, x: 1500, z: 700, hp: C.hp, status: 'idle' };
  s.ammoVehicles = [van];
  damageAmmoVehicle(s, van, C.hp);
  const event = s.events.find((e) => e.unitId === van.id);
  assert.deepEqual(event.visibleTo, [1]);
  assert.ok(!playerView(s, 0).events.some((e) => e.id === event.id));
  assert.ok(playerView(s, 1).events.some((e) => e.id === event.id));
  const truck = E.makeGround(s, 0, 'supplytruck', -1300, 250);
  truck.ammoCargo = { small: 120, shell: 12, rocket: 0, sam: 4 };
  s.groundUnits.push(truck);
  const html = supplyHTML(s, truck);
  assert.match(html, /Патроны: 120/);
  assert.match(html, /Снаряды: 12/);
  assert.match(html, /ЗУР: 4/);
  assert.doesNotMatch(html, /undefined|Ракеты: 0/);
});

test('tank splash respects intervening walls and ordinary rifle impact does not add direct van targeting', () => {
  const s = fresh(),
    wall = building(s, 'launcher', -1370, 250),
    van = { id: s.nextId++, side: 1, x: -1300, z: 250, hp: 1000, status: 'idle' };
  s.ammoVehicles = [van];
  const shot = {
    side: 0,
    shooterKey: 'leopard',
    kind: 'shell',
    damage: 100,
    source: 999,
    originX: -1420,
    originZ: 250,
    tx: -1300,
    tz: 250,
  };
  impactGround(s, shot);
  assert.equal(van.hp, 1000, 'a wall blocks the tank round before the van');
  wall.demolished = true;
  impactGround(s, shot);
  assert.ok(van.hp < 1000, 'the same impact damages the van once the wall is gone');
  const hp = van.hp;
  impactGround(s, { ...shot, shooterKey: 'infantry', kind: 'bullet' });
  assert.equal(
    van.hp,
    hp,
    'this scoped change adds area vulnerability, not a parallel targeting system',
  );
});
