import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';

// Pre-position already purchased weapons for isolated combat tests; no free rack stock.
function stage(s, site, key, count) {
  E.initLaunchStore(site);
  const accepted = E.acceptLaunchDelivery(
    site,
    key,
    Math.min(count, s.sides[site.side].inventory[key]),
  );
  s.sides[site.side].inventory[key] -= accepted;
  assert.equal(accepted, count);
}
const fresh = () => {
  const s = E.createGame(73);
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.science = 10000;
    f.tech = [];
  }
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = s.ai.nextArmy = 1e9;
  return s;
};
function ready(s, side, key, x, z) {
  const b = E.build(s, side, key, x, z);
  assert.notEqual(typeof b, 'string', b);
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function ground(s, key, x, z, side = 0) {
  const d = E.GROUND_UNITS[key],
    u = {
      id: s.nextId++,
      side,
      key,
      x,
      z,
      y: 1,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
      cooldown: 0,
      path: [],
    };
  s.groundUnits.push(u);
  return u;
}
function target(s, key = 'heavy') {
  const site = ready(s, 1, ['cruise', 'ballistic'].includes(key) ? 'silo' : 'launcher', -665, 175);
  s.sides[1].inventory[key] = 1;
  stage(s, site, key, 1);
  E.launch(s, 1, key, { x: -1100, z: 100 });
  E.advance(s, 0.1);
  const u = s.units[0];
  u.hp = u.maxHp = 1e7;
  u.speed = 0.001;
  return u;
}
test('gun magazines empty, reload without firing, then resume with a full magazine', () => {
  const s = fresh(),
    b = ready(s, 0, 'gun', -700, 100);
  target(s);
  b.groundAmmo = 1;
  E.advance(s, 0.1);
  assert.equal(b.groundAmmo, 0);
  const shots = s.stats.shots;
  E.advance(s, 1);
  assert.ok(b.groundReload > 0);
  assert.equal(s.stats.shots, shots);
  E.advance(s, 4);
  assert.ok(s.stats.shots > shots);
  assert.ok(b.groundAmmo > 0);
});
test('continuous fire heats a gun, worsens spread, and quiet time cools it', () => {
  const s = fresh(),
    b = ready(s, 0, 'gun', -700, 100);
  target(s);
  s.sides[0].tech = [];
  E.advance(s, 2);
  const cold = b.lastSpread;
  E.advance(s, 6);
  assert.ok(b.heat > 0.6, b.heat);
  assert.ok(b.lastSpread > cold);
  s.units = [];
  const heat = b.heat;
  E.advance(s, 4);
  assert.ok(b.heat < heat);
});
test('all gun systems and infantry ignore cruise and ballistic missiles, including stray rounds', () => {
  for (const key of ['gun', 'cannon', 'infantry', 'shilka', 'gepard'])
    for (const missile of ['cruise', 'ballistic'])
      assert.equal(E.canEngageAir(key, missile, true), false);
  const s = fresh(),
    b = ready(s, 0, 'gun', -700, 100),
    u = target(s, 'cruise');
  E.advance(s, 1);
  assert.equal(s.stats.shots, 0);
  const hp = u.hp;
  s.projectiles.push({
    id: s.nextId++,
    side: 0,
    kind: 'shell',
    x: u.x - 2,
    y: u.y,
    z: u.z,
    px: u.x - 2,
    py: u.y,
    pz: u.z,
    vx: 40,
    vy: 0,
    vz: 0,
    speed: 40,
    damage: 100,
    life: 0,
    maxLife: 2,
  });
  E.advance(s, 0.1);
  assert.equal(u.hp, hp);
  assert.equal(E.canEngageAir('sam', 'cruise'), true);
  assert.equal(E.canEngageAir('sam', 'ballistic'), true);
  assert.equal(E.canEngageAir('sam', 'ballistic', true), true);
});
test('cash upgrades improve accuracy, range and rate while preserving damage and health', () => {
  const s = fresh(),
    b = ready(s, 0, 'sam', -700, 100);
  const cash = s.sides[0].credits,
    metal = s.sides[0].materials;
  const initial = E.defenseStats(s.sides[0], b),
    hp = b.hp,
    maxHp = b.maxHp;
  let cost = 0;
  for (let i = 0; i < 2; i++) {
    cost += E.upgradeStatus(s, 0, b.id).cost;
    assert.equal(E.upgradeDefense(s, 0, b.id), true);
  }
  assert.equal(typeof E.upgradeDefense(s, 0, b.id), 'string');
  assert.equal(b.level, 2);
  assert.equal(s.sides[0].credits, cash - cost);
  assert.equal(s.sides[0].materials, metal);
  const improved = E.defenseStats(s.sides[0], b);
  assert.ok(
    improved.range > initial.range &&
      improved.accuracy < initial.accuracy &&
      improved.cooldown < initial.cooldown,
  );
  assert.equal(improved.damage, initial.damage);
  assert.equal(b.hp, hp);
  assert.equal(b.maxHp, maxHp);
});
test('waypoints produce a longer smooth flank route and each launched order snapshots its own path', () => {
  const s = fresh(),
    site = ready(s, 0, 'launcher', -800, 0),
    aim = {
      x: 1000,
      z: 0,
      waypoints: [
        { x: -180, z: -400 },
        { x: 800, z: -400 },
      ],
    };
  s.sides[0].inventory.drone = 2;
  stage(s, site, 'drone', 2);
  E.launch(s, 0, 'drone', aim);
  const u = s.units[0];
  assert.ok(u.total > 1300);
  aim.waypoints[0].z = 300;
  assert.ok(u.route.some((p) => p.z < -390));
  E.advance(s, 10);
  assert.ok(u.z < -100);
  assert.ok(u.y > 30);
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.units[0].route, u.route);
  assert.equal(
    E.launchStatus(s, 0, 'drone', { x: 1000, z: 0, waypoints: [{ x: NaN, z: 0 }] }),
    'Укажите точку в пределах карты',
  );
});
test('ballistic missiles ignore flank points and retain ordinary fixed statistics', () => {
  const s = fresh(),
    site = ready(s, 0, 'silo', -800, 0);
  s.sides[0].inventory.ballistic = 1;
  stage(s, site, 'ballistic', 1);
  E.launch(s, 0, 'ballistic', { x: 1000, z: 0, waypoints: [{ x: 0, z: 500 }] });
  const u = s.units[0];
  assert.equal(u.total, 1800);
  assert.equal(u.speed, E.WEAPONS.ballistic.speed);
  assert.equal(u.maxHp, E.WEAPONS.ballistic.hp);
  assert.equal(u.damage, E.WEAPONS.ballistic.damage);
  assert.deepEqual(E.load(E.save(s)).units, s.units);
});
test('barracks and armour base produce paid roles, charge upkeep and preserve their queues', () => {
  const s = fresh(),
    b = ready(s, 0, 'barracks', -1080, -10),
    v = ready(s, 0, 'vehiclebase', -950, -10),
    money = s.sides[0].credits;
  assert.equal(E.recruit(s, 0, 'infantry'), true);
  assert.equal(s.sides[0].credits, money - E.GROUND_UNITS.infantry.cost);
  assert.equal(E.recruit(s, 0, 'leopard'), true);
  E.advance(s, 12);
  assert.equal(s.groundUnits.length, 1);
  assert.equal(s.groundUnits[0].key, 'infantry');
  assert.equal(b.armyQueue.length, 0);
  assert.equal(v.armyQueue.length, 1);
  assert.equal(E.economy(s, 0).armyUpkeep, E.GROUND_UNITS.infantry.upkeep);
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.groundUnits, s.groundUnits);
  assert.deepEqual(loaded.buildings.find((t) => t.id === b.id).armyQueue, b.armyQueue);
  assert.deepEqual(loaded.buildings.find((t) => t.id === v.id).armyQueue, v.armyQueue);
});
test('ground navigation goes around the sea through a land corridor and avoids building corners', () => {
  const s = fresh();
  ready(s, 0, 'launcher', -700, -120);
  const path = E.groundPath(s, { x: -900, z: 0 }, { x: 900, z: 0 }, 4);
  assert.ok(path.length > 20);
  assert.ok(path.every((p) => E.walkable(s, p.x, p.z, 4)));
  assert.ok(path.every((p) => E.seaDistance(p.x, p.z) > 0));
  // The only dry crossing lies beyond the end of the sea.
  assert.ok(Math.max(...path.map((p) => Math.abs(p.z))) > E.SEA.halfZ);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1],
      b = path[i];
    for (let t = 0; t <= 1; t += 0.2)
      assert.ok(E.walkable(s, a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, 4));
  }
});
test('orders actually move soldiers through a corridor, tanks damage an enemy HQ and blasts damage troops', () => {
  const s = fresh(),
    u = ground(s, 'infantry', -900, 0);
  assert.equal(E.orderGround(s, 0, [u.id], { x: 850, z: 0 }), 1);
  E.advance(s, 220);
  assert.ok(u.x > 200, JSON.stringify(u));
  const tank = ground(s, 'leopard', 900, 0),
    hq = s.buildings[1],
    hp = hq.hp;
  E.advance(s, 6);
  assert.ok(hq.hp < hp);
  E.applyBlast(s, tank.x, tank.z, 100, 30);
  assert.ok(tank.hp < 650);
});
test('city building output matches the total economy and exposes road, health and power factors', () => {
  const s = fresh(),
    b = ready(s, 0, 'housing', -1015, -80),
    o = E.buildingOutput(s, b),
    e = E.economy(s, 0);
  assert.equal(o.income, e.gross - 1.8);
  assert.equal(o.road, 1);
  b.hp = b.maxHp * 0.5;
  assert.ok(E.buildingOutput(s, b).income < o.income);
  const noArmy = E.economy(s, 0).upkeep;
  ground(s, 'gepard', -800, 0);
  assert.ok(Math.abs(E.economy(s, 0).upkeep - noArmy - 0.45) < 1e-8);
});
test('v6 campaigns migrate without losing buildings, credits, flights or construction', () => {
  const s = fresh();
  ready(s, 0, 'housing', -1015, -80);
  s.version = 6;
  delete s.groundUnits;
  const copy = E.load(E.save(s));
  assert.equal(copy.version, E.VERSION);
  assert.deepEqual(
    copy.buildings.map(({ x, ...b }) => b),
    s.buildings.map(({ x, ...b }) => b),
  );
  for (let i = 0; i < s.buildings.length; i++)
    assert.equal(copy.buildings[i].x, s.buildings[i].x + Math.sign(s.buildings[i].x) * 400);
  assert.deepEqual(
    copy.sides,
    s.sides.map((f) => ({ ...f, science: 0 })),
  );
  assert.deepEqual(copy.groundUnits, []);
});
test('day/night follows simulation time, repeats after twenty minutes and never relies on wall time', () => {
  assert.ok(E.dayPhase(600).daylight > E.dayPhase(0).daylight);
  assert.ok(Math.abs(E.dayPhase(1200).hour - E.dayPhase(0).hour) < 1e-8);
  assert.equal(E.dayPhase(0).hour, 18.5);
});
test('aircraft cap and army reservations refuse excess orders before charging', () => {
  const s = fresh(),
    site = ready(s, 0, 'launcher', -800, 0);
  s.sides[0].inventory.drone = 10;
  for (let i = 0; i < 120; i++) s.units.push({ id: s.nextId++, side: 0, hp: 1, launched: true });
  const stock = s.sides[0].inventory.drone;
  assert.equal(typeof E.launch(s, 0, 'drone', { x: 1000, z: 0 }), 'string');
  assert.equal(s.sides[0].inventory.drone, stock);
  const b = ready(s, 0, 'barracks', -1080, -10);
  for (let i = 0; i < E.GROUND_LIMIT - 1; i++) ground(s, 'infantry', -300 + i, 0);
  assert.equal(E.recruit(s, 0, 'infantry'), true);
  const credits = s.sides[0].credits;
  assert.equal(typeof E.recruit(s, 0, 'infantry'), 'string');
  assert.equal(s.sides[0].credits, credits);
});
test('mobile AA and infantry fire at drones, Leopard remains ground-only, and a group order spreads arrivals', () => {
  for (const key of ['infantry', 'shilka', 'gepard']) {
    const s = fresh(),
      u = ground(s, key, -700, 100);
    target(s);
    E.advance(s, 1);
    assert.ok(s.stats.shots > 0, key);
    assert.ok(
      key === 'infantry'
        ? u.groundAmmo < E.defenseStats(s.sides[0], u).magazine
        : u.ammo < E.defenseStats(s.sides[0], u).magazine,
    );
  }
  assert.equal(E.canEngageAir('leopard', 'drone'), false);
  const s = fresh(),
    a = ground(s, 'infantry', -900, 0),
    b = ground(s, 'leopard', -850, 0);
  assert.equal(E.orderGround(s, 0, [a.id, b.id], { x: -700, z: 0 }), 2);
  assert.notEqual(a.order.x, b.order.x);
});
