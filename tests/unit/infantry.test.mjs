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
  const s = E.createGame(37);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = s.ai.nextArmy = 1e9;
  for (const f of s.sides) {
    f.credits = 100000;
    f.materials = 10000;
    f.science = 10000;
  }
  return s;
};
const soldier = (s, key, x, z, side = 0) => {
  const u = E.makeGround(s, side, key, x, z);
  s.groundUnits.push(u);
  return u;
};
const ready = (s, key, x, z, side = 0) => {
  const b = E.build(s, side, key, x, z);
  assert.notEqual(typeof b, 'string', b);
  b.hp = b.maxHp;
  b.progress = 1;
  return b;
};
const patch = () =>
  E.COVER_PATCHES.find(
    (p) =>
      p.x > 100 &&
      p.x < 1192 &&
      Math.abs(p.z) < 800 &&
      E.groundHeight(p.x, p.z) < 0.5 &&
      E.terrainClear(p.x - 180, p.z, 2.2, p.x + 40, p.z, 2.2),
  );
test('stationary cannon is removed, mobile gun vehicles remain, and individual roles are distinct', () => {
  assert.equal(E.BUILDINGS.cannon, undefined);
  for (const key of [
    'shilka',
    'gepard',
    'leopard',
    'apc',
    'mog',
    'infantry',
    'sniper',
    'machinegunner',
    'engineer',
    'operator',
    'assault',
  ])
    assert.ok(E.GROUND_UNITS[key]);
  assert.equal(E.GROUND_UNITS.infantry.members, 1);
  assert.equal(E.GROUND_UNITS.assault.members, 3);
  assert.ok(E.GROUND_UNITS.infantry.damage < E.GROUND_UNITS.mog.damage / 10);
});
test('batch recruitment reserves five costs atomically and rally orders newly trained individuals to a forest', () => {
  const s = fresh(),
    b = ready(s, 'barracks', -1272, -10),
    cash = s.sides[0].credits;
  assert.equal(E.recruit(s, 0, 'infantry', null, 5), true);
  assert.equal(s.sides[0].credits, cash - 5 * E.GROUND_UNITS.infantry.cost);
  const p = E.COVER_PATCHES.find((p) => p.x < 0 && E.walkable(s, p.x, p.z));
  assert.equal(E.setRally(s, 0, b.id, p), true);
  E.advance(s, 20);
  assert.equal(s.groundUnits.length, 5);
  assert.ok(s.groundUnits.every((u) => u.order?.x && u.path.length));
  const before = s.sides[0].credits;
  s.sides[0].materials = 0;
  assert.equal(typeof E.recruit(s, 0, 'assault', null, 5), 'string');
  assert.equal(s.sides[0].credits, before);
});
test('saved control groups preserve unit IDs, prune dead units on recall and survive reload', () => {
  const s = fresh(),
    a = soldier(s, 'infantry', -992, 0),
    b = soldier(s, 'sniper', -972, 0);
  E.saveGroup(s, 0, 2, [a.id, b.id]);
  let loaded = E.load(E.save(s));
  assert.deepEqual(E.getGroup(loaded, 0, 2), [a.id, b.id]);
  loaded.groundUnits[0].hp = 0;
  assert.deepEqual(E.getGroup(loaded, 0, 2), [b.id]);
});
test('formation affects destinations and orders can address one soldier without moving the rest', () => {
  const s = fresh(),
    units = Array.from({ length: 8 }, (_, i) => soldier(s, 'infantry', -692 + i * 5, 0));
  s.formations[0] = 'column';
  E.orderGround(
    s,
    0,
    units.map((u) => u.id),
    { x: -892, z: 0 },
  );
  assert.equal(new Set(units.map((u) => u.order.x)).size, 2);
  const order = structuredClone(units[1].order);
  E.orderGround(s, 0, [units[0].id], { x: -842, z: 50 });
  assert.deepEqual(units[1].order, order);
  s.formations[0] = 'spread';
  E.orderGround(
    s,
    0,
    units.map((u) => u.id),
    { x: -892, z: 0 },
  );
  assert.ok(new Set(units.map((u) => u.order.x)).size > 2);
});
test('trenches take time to dig, give damage protection, persist after leaving and engineers dig faster', () => {
  const s = fresh(),
    a = soldier(s, 'infantry', -942, 150),
    b = soldier(s, 'engineer', -912, 150);
  assert.equal(E.commandUnits(s, 0, [a.id, b.id], 'dig'), 2);
  E.advance(s, 7);
  assert.ok(s.trenches.find((t) => t.id === b.trenchId).progress >= 1);
  assert.ok(s.trenches.find((t) => t.id === a.trenchId).progress < 1);
  E.advance(s, 6);
  assert.ok(E.coverInfo(s, a).cover >= 0.7);
  const before = a.hp;
  E.damageGround?.(s, a, 10);
  const hp = a.hp;
  E.applyBlast(s, a.x, a.z, 10, 2);
  assert.ok(a.hp > hp - 10);
  E.orderGround(s, 0, [a.id], { x: -892, z: 160 });
  assert.equal(a.trenchId, null);
  assert.equal(s.trenches.length, 2);
  assert.equal(E.load(E.save(s)).trenches.length, 2);
});
test('concealed infantry is hidden at distance, spotted nearby, and movement reveals it without terrain fog', () => {
  const s = fresh(),
    p = patch(),
    hidden = soldier(s, 'infantry', p.x, p.z, 1),
    observer = soldier(s, 'infantry', p.x - 170, p.z);
  hidden.camouflaged = true;
  assert.equal(E.groundVisible(s, 0, hidden), false);
  assert.equal(E.observedTarget(s, 0, hidden.id), null);
  observer.x = p.x - 20;
  assert.equal(E.groundVisible(s, 0, hidden), true);
  observer.x = p.x - 170;
  hidden.moving = true;
  assert.equal(E.groundVisible(s, 0, hidden), true);
  assert.equal(E.pointVisible(s, 0, hidden.x, hidden.z), true);
});
test('hidden shooters create imprecise expiring contacts and enemies can return fire at the area', () => {
  const s = fresh(),
    p = patch(),
    shooter = soldier(s, 'sniper', p.x, p.z, 1),
    enemy = soldier(s, 'machinegunner', p.x - 130, p.z);
  shooter.camouflaged = true;
  enemy.holdFire = true;
  E.advance(s, 1);
  assert.ok(s.contacts[0].length);
  const c = s.contacts[0][0];
  assert.ok(Math.hypot(c.x - shooter.x, c.z - shooter.z) > 0);
  assert.equal(E.groundVisible(s, 0, shooter), false);
  enemy.holdFire = false;
  E.advance(s, 0.8);
  assert.ok(
    s.projectiles.some((p) => p.side === 0 && p.targetId === null) ||
      s.events.some((e) => e.type === 'shot' && e.side === 0),
  );
  shooter.holdFire = true;
  E.advance(s, 10);
  assert.equal(s.contacts[0].length, 0);
});
test('buildings block ground line of fire; attackmove stops to fight, hold-fire prevents all new shots', () => {
  const s = fresh();
  ready(s, 'launcher', -942, 100);
  const a = soldier(s, 'infantry', -1012, 100),
    b = soldier(s, 'infantry', -872, 100, 1);
  assert.equal(E.lineOfSight(s, a, b), false);
  b.x = -1002;
  b.z = 160;
  assert.equal(E.lineOfSight(s, a, b), true);
  E.orderGround(s, 0, [a.id], { x: -200, z: 100, mode: 'attackmove' });
  E.advance(s, 0.3);
  assert.ok(Math.hypot(a.x + 1012, a.z - 100) < 2);
  E.commandUnits(s, 0, [a.id], 'fire');
  s.events = [];
  E.advance(s, 1);
  assert.ok(!s.events.some((e) => e.type === 'shot' && e.side === 0));
});
test('suppression grows under machine gun fire and recovers after disengagement', () => {
  const s = fresh(),
    a = soldier(s, 'machinegunner', -992, 250),
    b = soldier(s, 'infantry', -902, 250, 1);
  b.hp = b.maxHp = 10000;
  b.holdFire = true;
  E.advance(s, 5);
  assert.ok(b.suppression > 0.1, b.suppression);
  const pressure = b.suppression;
  a.holdFire = true;
  E.advance(s, 8);
  assert.ok(b.suppression < pressure);
});
test('boarding respects eight seats, passengers cannot shoot, unloads to dry land and survives a save', () => {
  const s = fresh(),
    apc = soldier(s, 'apc', -992, 0),
    troops = Array.from({ length: 9 }, (_, i) => soldier(s, 'infantry', -1017 + i * 2, -12));
  assert.equal(
    E.boardGround(
      s,
      0,
      troops.map((u) => u.id),
      apc.id,
    ),
    8,
  );
  E.advance(s, 3);
  const passengers = s.groundUnits.filter((u) => u.carrierId === apc.id);
  assert.equal(passengers.length, 8);
  assert.ok(passengers.every((u) => !E.groundVisible(s, 0, u)));
  const restored = E.load(E.save(s));
  assert.equal(restored.groundUnits.filter((u) => u.carrierId).length, 8);
  assert.equal(E.unloadGround(s, 0, apc.id), 8);
  assert.ok(troops.slice(0, 8).every((u) => !u.carrierId && E.walkable(s, u.x, u.z, 1)));
});
test('destroying a transport ejects wounded survivors without duplicate blast damage', () => {
  const s = fresh(),
    apc = soldier(s, 'apc', -992, 0),
    u = soldier(s, 'infantry', -1002, 0);
  E.boardGround(s, 0, [u.id], apc.id);
  E.advance(s, 1);
  assert.equal(u.carrierId, apc.id);
  E.applyBlast(s, apc.x, apc.z, 1192, 20);
  assert.equal(apc.hp, 0);
  assert.equal(u.carrierId, null);
  assert.ok(u.hp > 0 && u.hp < u.maxHp);
});
test('FPV operators consume prepaid ammunition without a second cash charge; range, cooldown and real hits remain', () => {
  const s = fresh(),
    u = soldier(s, 'operator', 1042, 0),
    hq = s.buildings[1],
    cash = s.sides[0].credits;
  assert.equal(typeof E.launchFPV(s, 0, [u.id], { x: 0, z: 0 }), 'string');
  assert.equal(E.launchFPV(s, 0, [u.id], hq), true);
  assert.equal(u.fpvAmmo, 2);
  assert.equal(s.sides[0].credits, cash);
  assert.equal(s.units[0].subtype, 'fpv');
  assert.equal(typeof E.launchFPV(s, 0, [u.id], hq), 'string');
  const hp = hq.hp;
  E.advance(s, 5);
  assert.ok(hq.hp < hp);
  assert.ok(s.stats.impacts > 0);
});
test('engineers repair nearby vehicles for resources and retreating infantry recovers at base', () => {
  const s = fresh(),
    e = soldier(s, 'engineer', -1042, 0),
    apc = soldier(s, 'apc', -1027, 0);
  apc.hp = 100;
  const metal = s.sides[0].materials;
  E.advance(s, 3);
  assert.ok(apc.hp > 100);
  assert.ok(s.sides[0].materials < metal);
  const u = soldier(s, 'infantry', -1092, -100);
  u.hp = 10;
  E.commandUnits(s, 0, [u.id], 'retreat');
  assert.equal(u.order.mode, 'retreat');
  E.advance(s, 25);
  assert.ok(u.hp > 10);
});
test('a fixed MG team packs into a mobile MOG and must deploy before firing', () => {
  const s = fresh(),
    b = ready(s, 'gun', -992, 0),
    id = E.redeployMOG(s, 0, b.id),
    u = s.groundUnits.find((u) => u.id === id);
  assert.ok(b.demolished);
  assert.equal(u.key, 'mog');
  assert.equal(u.setup, 0);
  E.advance(s, 3.1);
  assert.equal(u.setup, 1);
  E.orderGround(s, 0, [u.id], { x: -892, z: 0 });
  E.advance(s, 0.2);
  assert.equal(u.setup, 0);
});
test('v7 cannon conversion refunds the difference and legacy five-man units become five individuals', () => {
  const s = fresh();
  s.version = 7;
  const u = soldier(s, 'infantry', -992, 0);
  u.maxHp = 110;
  u.hp = 55;
  s.buildings.push({
    id: s.nextId++,
    side: 0,
    key: 'cannon',
    x: -892,
    z: 0,
    hp: 140,
    maxHp: 280,
    progress: 1,
  });
  const cash = s.sides[0].credits,
    restored = E.load(E.save(s));
  assert.equal(restored.version, E.VERSION);
  assert.equal(restored.groundUnits.length, 5);
  assert.ok(restored.groundUnits.every((u) => u.hp / u.maxHp === 0.5));
  assert.equal(restored.sides[0].credits, cash + 300);
  assert.equal(restored.buildings.at(-1).key, 'gun');
  assert.equal(restored.buildings.at(-1).hp / restored.buildings.at(-1).maxHp, 0.5);
});
test('mobile MOG needs deployment, intercepts drones, shares its magazine and cools while holding fire', () => {
  const s = fresh(),
    u = soldier(s, 'mog', -892, 100),
    site = ready(s, 'launcher', -857, 175, 1);
  s.sides[1].inventory.heavy = 1;
  stage(s, site, 'heavy', 1);
  E.launch(s, 1, 'heavy', { x: -1192, z: 100 });
  E.advance(s, 0.1);
  const drone = s.units[0];
  drone.hp = drone.maxHp = 100000;
  drone.speed = 0.001;
  E.advance(s, 1);
  assert.equal(s.stats.shots, 0);
  E.advance(s, 3);
  assert.ok(s.stats.shots > 0);
  assert.ok(u.groundAmmo < E.defenseStats(s.sides[0], u).magazine);
  u.heat = 1;
  u.holdFire = true;
  const shots = s.stats.shots;
  E.advance(s, 2);
  assert.equal(s.stats.shots, shots);
  assert.ok(u.heat < 1);
});
test('group stance commands set a common state for a mixed selection', () => {
  const s = fresh(),
    a = soldier(s, 'infantry', -992, 0),
    b = soldier(s, 'infantry', -972, 0);
  a.holdFire = true;
  b.holdFire = false;
  E.commandUnits(s, 0, [a.id, b.id], 'fire');
  assert.ok(a.holdFire && b.holdFire);
  E.commandUnits(s, 0, [a.id, b.id], 'fire');
  assert.ok(!a.holdFire && !b.holdFire);
});
