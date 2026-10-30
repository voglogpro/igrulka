import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { FixedCamera, CAMERA } from '../../src/rendering/camera.js';
import { PerspectiveCamera, Vector3 } from '../../vendor/three/three.module.js';
const fresh = () => {
  const s = E.createGame(117);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = s.ai.nextScout = s.ai.nextStrike = 1e9;
  return s;
};
function ready(s, side, key, x, z) {
  const b = E.build(s, side, key, x, z);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function funds(s) {
  for (const f of s.sides) {
    f.credits = 20000;
    f.materials = 3000;
    f.science = 1000;
  }
  // Ammunition production is tested here, not the oil economy.
  s.rules.oil = false;
}
function town(s, side = 0) {
  const x = side === 0 ? -1207 : 1207;
  return {
    power: ready(s, side, 'power', x - 55, -80),
    housing: ready(s, side, 'housing', x, -80),
    industry: ready(s, side, 'industry', x + 55, -80),
    factory: ready(s, side, 'factory', x - 65, -10),
    launcher: ready(s, side, 'launcher', x + 65, -10),
  };
}
test('empty equal starts, equal camp access, exact 25% bonus on every economic output', () => {
  const s = fresh();
  assert.deepEqual(s.sides[0], s.sides[1]);
  assert.equal(s.buildings.length, 2);
  assert.equal(s.units.length, 0);
  assert.equal(
    s.roads.filter((r) => r.side === 0).length,
    s.roads.filter((r) => r.side === 1).length,
  );
  funds(s);
  town(s, 0);
  town(s, 1);
  const a = E.economy(s, 0),
    b = E.economy(s, 1);
  for (const k of ['gross', 'materials', 'science']) assert.ok(Math.abs(a[k] * 1.25 - b[k]) < 1e-9);
  assert.equal(a.upkeep, b.upkeep);
  assert.equal(a.isolated, 0);
});
test('economic placement requires a connected street; construction creates a functional driveway', () => {
  const s = fresh();
  assert.match(E.canPlace(s, 'housing', -892, 200), /улицей/);
  assert.equal(E.canPlace(s, 'housing', -1207, -80), null);
  const b = E.build(s, 0, 'housing', -1207, -80);
  assert.ok(b.roadLink);
  assert.ok(s.roads.some((r) => r.connectorTo === b.id));
  assert.equal(E.supplyFactor(s, b), 1);
  assert.equal(E.canPlace(s, 'gun', -892, 200), null);
  assert.match(E.canPlace(s, 'housing', 0, 0), /земля/);
});
test('cutting the only trunk reduces downstream economy to 20%; bypass and repair restore supply', () => {
  const s = fresh();
  funds(s);
  const b = ready(s, 0, 'industry', -1152, -80),
    before = E.economy(s, 0).materials,
    central = s.roads.find((r) => r.side === 0 && r.camp && r.ax < -1207 && r.bx > -1207);
  E.damageRoad(s, central, 100);
  assert.equal(E.supplyFactor(s, b), 0.2);
  assert.ok(Math.abs(E.economy(s, 0).materials - before * 0.2) < 1e-9);
  assert.equal(E.repair(s, central.id), true);
  E.advance(s, 7);
  assert.equal(E.supplyFactor(s, b), 1);
  E.damageRoad(s, central, 120);
  const first = E.buildRoad(s, 0, -1282, -45, -1282, 45);
  assert.equal(typeof first, 'object');
  assert.equal(typeof E.buildRoad(s, 0, -1282, 45, -1122, 45), 'object');
  assert.equal(typeof E.buildRoad(s, 0, -1122, 45, -1122, -45), 'object');
  assert.equal(E.supplyFactor(s, b), 1);
});
test('an attack aimed at a road actually severs it and the next tick updates supply', () => {
  const s = fresh();
  funds(s);
  const own = town(s);
  const enemy = town(s, 1),
    central = s.roads.find((r) => r.side === 1 && r.camp && r.ax < 1207 && r.bx > 1207);
  s.sides[0].inventory.drone = 1;
  E.requestWeaponDelivery(s, 0, own.launcher.id, 'drone', 1);
  while (!E.availableLaunchStock(own.launcher, 'drone') && s.time < 40) E.step(s, 0.05);
  assert.equal(E.launch(s, 0, 'drone', central.id), 1);
  E.advance(s, 70);
  assert.ok(central.hp < central.maxHp * 0.3);
  assert.equal(E.supplyFactor(s, enemy.industry), 0.2);
  assert.ok(s.stats.roadsCut >= 1);
});
test('road construction splits long streets, validates collisions, and supports snapping', () => {
  const s = fresh();
  funds(s);
  const r = E.buildRoad(s, 0, -1297, -45, -1422, -45);
  assert.equal(typeof r, 'object');
  assert.equal(r.segments.length, 2);
  assert.ok(r.segments.every((seg) => E.network(s, 0).ids.has(seg.id)));
  assert.match(E.buildRoad(s, 0, -1252, 0, -1162, 0), /здание/);
  assert.match(E.buildRoad(s, 0, -100, 0, 100, 0), /суше/);
  const snapped = E.snapRoadPoint(s, 0, -1419, -43);
  assert.equal(snapped.x, -1422);
  assert.equal(snapped.z, -45);
});
test('factory manufactures local stock and a real pad receives and launches it once', () => {
  const s = fresh();
  funds(s);
  assert.match(E.produce(s, 0, 'drone'), /базу дронов/);
  ready(s, 0, 'power', -1262, -80);
  ready(s, 0, 'factory', -1272, -10);
  assert.equal(E.produce(s, 0, 'drone', 3), true);
  E.advance(s, 37);
  assert.equal(E.weaponStock(s, 0, 'drone'), 3);
  assert.equal(typeof E.launch(s, 0, 'drone', 2), 'string');
  const launcher = ready(s, 0, 'launcher', -942, -150);
  assert.equal(launcher.roadLink, undefined);
  E.advance(s, 35);
  assert.ok(
    E.availableLaunchStock(launcher, 'drone') >= 2,
    'paid stock physically arrives at the remote pad',
  );
  assert.equal(E.launch(s, 0, 'drone', 2, 1, launcher.id), 1);
  assert.equal(E.launch(s, 0, 'drone', { x: 1172, z: 30 }, 1, launcher.id), 1);
  assert.equal(E.launch(s, 0, 'drone', { x: 1092, z: 30 }, 1, launcher.id), 1);
  assert.equal(s.units.length, 3);
  assert.equal(s.sides[0].inventory.drone, 0);
  assert.match(E.launch(s, 0, 'drone', 2), /готового аппарата/);
});
test('road disruption also slows factory work, while the same saved queue resumes intact', () => {
  let s = fresh();
  funds(s);
  const t = town(s);
  assert.equal(E.produce(s, 0, 'drone'), true);
  E.damageRoad(
    s,
    s.roads.find((r) => r.id === t.factory.roadLink),
    120,
  );
  E.advance(s, 12);
  const q = t.factory.queue[0];
  assert.ok(q.progress < 0.21 && q.progress > 0.19);
  s = E.load(E.save(s));
  const factory = s.buildings.find((b) => b.id === t.factory.id);
  assert.ok(Math.abs(factory.queue[0].progress - 0.2) < 1e-8);
  // A driveway shares its building's fate, so it needs no separate repair.
  assert.ok(E.passable(s.roads.find((r) => r.id === t.factory.roadLink)));
  assert.equal(E.repair(s, t.factory.roadLink), 'Ремонт не требуется');
  E.advance(s, 20);
  assert.equal(E.weaponStock(s, 0, 'drone'), 1);
});
function movingDrone(s) {
  const u = {
    id: s.nextId++,
    side: 1,
    key: 'heavy',
    x: -902,
    z: 20,
    y: 57,
    startX: 1207,
    startZ: 20,
    tx: -1207,
    tz: 20,
    targetId: 1,
    hp: 1000,
    maxHp: 1000,
    travelled: 1725,
    total: 2030,
    speed: 0.001,
    delay: 0,
    phase: 1,
  };
  s.units.push(u);
  return u;
}
test('gun rounds follow gravity without homing and record real hits and misses', () => {
  const s = fresh();
  funds(s);
  ready(s, 0, 'gun', -1052, 0);
  ready(s, 0, 'radar', -1192, 100);
  const u = movingDrone(s);
  E.advance(s, 0.2);
  const p = s.projectiles.find((p) => p.kind === 'bullet');
  assert.ok(p);
  const vx = p.vx,
    vy = p.vy,
    vz = p.vz;
  u.phase += 2;
  E.advance(s, 0.05);
  const still = s.projectiles.find((q) => q.id === p.id);
  if (still) {
    assert.equal(still.vx, vx);
    assert.ok(Math.abs(still.vy - (vy - E.COMBAT.gravity * 0.05)) < 1e-8);
    assert.equal(still.vz, vz);
  }
  E.advance(s, 8);
  assert.ok(s.stats.shots > 20);
  assert.ok(s.stats.misses > 0);
  assert.ok(s.stats.hits > 0);
  assert.ok(s.sides[0].spentAmmo > 0);
  assert.ok(s.stats.hits < s.stats.shots);
});
test('leading solution advances the aim instead of aiming at the current point', () => {
  const p = E.interceptPoint(
    { x: 0, y: 0, z: 0 },
    { x: 100, y: 30, z: 0, vx: 0, vy: 0, vz: 30 },
    300,
  );
  assert.ok(p.z > 9);
  assert.ok(p.time > 0.3);
});
test('zero ammunition stops defense and impact destruction completes the campaign', () => {
  const s = fresh();
  funds(s);
  const gun = ready(s, 0, 'gun', -1052, 0);
  gun.groundAmmo = 0;
  gun.ammoReserve = 0;
  movingDrone(s);
  s.sides[0].materials = 0;
  E.advance(s, 1);
  assert.equal(s.stats.shots, 0);
  const win = fresh();
  funds(win);
  const own = town(win);
  win.buildings[1].hp = 90;
  win.sides[0].inventory.drone = 1;
  E.requestWeaponDelivery(win, 0, own.launcher.id, 'drone', 1);
  while (!E.availableLaunchStock(own.launcher, 'drone') && win.time < 40) E.step(win, 0.05);
  assert.equal(E.launch(win, 0, 'drone', 2), 1);
  E.advance(win, 70);
  assert.equal(win.result, 'victory');
  const t = win.time;
  E.advance(win, 10);
  assert.equal(win.time, t);
});
test('camera keeps zoom and focus bounds and changes angle only on request', () => {
  let wheel;
  const cam = new PerspectiveCamera(45, 1, 2, 5000),
    controls = new FixedCamera(cam, {
      addEventListener: (name, fn) => {
        if (name === 'wheel') wheel = fn;
      },
    });
  const angle = cam.position.clone().sub(controls.target).normalize();
  for (let i = 0; i < 80; i++) wheel({ preventDefault() {}, deltaY: -1000 });
  controls.update(10);
  assert.equal(controls.distance, CAMERA.min);
  assert.ok(cam.position.y > 45);
  for (let i = 0; i < 80; i++) wheel({ preventDefault() {}, deltaY: 1000 });
  controls.focus(10000, -10000);
  controls.update(10);
  assert.equal(controls.distance, CAMERA.max);
  assert.ok(controls.target.x <= E.FIELD.x - 60 && controls.target.z >= -(E.FIELD.z - 60));
  assert.ok(cam.position.clone().sub(controls.target).normalize().distanceTo(angle) < 1e-10);
  assert.equal(controls.enableRotate, true);
  assert.equal(controls.enablePan, false);
});
test('WASD and arrows pan relative to the screen while keeping angle, zoom and map bounds', () => {
  const camera = new PerspectiveCamera(45, 1, 2, 5000),
    controls = new FixedCamera(camera, { addEventListener() {} }),
    origin = controls.desired.clone(),
    angle = camera.position.clone().sub(controls.target).normalize(),
    distance = controls.distance;
  controls.update(0.1, { KeyW: true });
  const forward = controls.desired.clone().sub(origin);
  assert.ok(forward.dot(controls.forward) > 0);
  controls.update(0.1, { KeyS: true });
  assert.ok(controls.desired.distanceTo(origin) < 1e-8);
  controls.update(0.1, { KeyD: true });
  assert.ok(controls.desired.clone().sub(origin).dot(controls.right) > 0);
  controls.update(0.1, { KeyA: true });
  assert.ok(controls.desired.distanceTo(origin) < 1e-8);
  controls.update(0.1, { ArrowUp: true, ArrowRight: true });
  assert.ok(Math.abs(controls.desired.distanceTo(origin) - distance * 0.6 * 0.1) < 1e-8);
  assert.equal(controls.distance, distance);
  assert.ok(camera.position.clone().sub(controls.target).normalize().distanceTo(angle) < 1e-10);
  const before = controls.desired.clone();
  controls.update(0.1, {});
  assert.equal(controls.desired.distanceTo(before), 0);
  for (let i = 0; i < 1000; i++) controls.update(0.1, { KeyW: true });
  assert.ok(
    Math.abs(controls.target.x) <= E.FIELD.x - 60 && Math.abs(controls.target.z) <= E.FIELD.z - 60,
  );
  assert.ok(camera.position.y > 140);
});
test('AI builds a connected, compact city and manufactures real attacks from identical reserves', () => {
  const s = E.createGame(17);
  s.buildings[0].hp = s.buildings[0].maxHp = 1e8;
  E.advance(s, 650);
  const own = s.buildings.filter(
    (b) => b.side === 1 && (E.ROAD_REQUIRED.has(b.key) || b.key === 'launcher') && b.hp > 0,
  );
  assert.ok(own.some((b) => b.key === 'launcher'));
  assert.ok(own.some((b) => b.key === 'factory'));
  assert.ok(own.every((b) => E.supplyFactor(s, b) === 1));
  // Oil wells and the port stand where the fields and the shore are; the city itself is compact.
  assert.ok(
    own
      .filter((b) => !['oilwell', 'port'].includes(b.key))
      .every((b) => Math.abs(b.x - 1207) <= 200 && Math.abs(b.z) <= 300),
  );
  assert.ok(s.stats.impacts > 0 || s.units.some((u) => u.side === 1));
});
test('state round trips, validates resources and rejects foreign saves', () => {
  const s = fresh();
  funds(s);
  town(s);
  assert.deepEqual(E.load(E.save(s)).sides, s.sides);
  assert.throws(() => E.load('{}'));
  s.sides[0].credits = -1;
  assert.throws(() => E.load(E.save(s)));
});
const BASE_WEAPONS = ['drone', 'heavy', 'cruise', 'ballistic'];
test('all four base weapons participate in a live defended battle without research', () => {
  const s = fresh();
  funds(s);
  for (const hq of s.buildings) {
    hq.hp = hq.maxHp = 8000;
  }
  for (const owner of [0, 1]) {
    const x = owner === 0 ? -1207 : 1207;
    town(s, owner);
    assert.equal(typeof E.buildRoad(s, owner, x - 90, -45, x - 170, -45), 'object');
    assert.equal(typeof E.research(s, owner, 'cruise'), 'string');
  }
  for (const owner of [0, 1]) {
    const x = owner === 0 ? -1207 : 1207;
    ready(s, owner, 'gun', x + (owner === 0 ? 170 : -170), 0);
    ready(s, owner, 'sam', x + (owner === 0 ? 180 : -180), 85);
    ready(s, owner, 'silo', x + (owner === 0 ? 170 : -170), 180);
    for (const key of BASE_WEAPONS) assert.equal(E.produce(s, owner, key, 2), true);
  }
  E.advance(s, 420);
  for (const key of BASE_WEAPONS) {
    for (const owner of [0, 1]) {
      assert.ok(E.weaponStock(s, owner, key) >= 2);
      let launched = 0;
      for (const site of E.launchSites(s, owner, key)) {
        const count = Math.min(2 - launched, E.availableLaunchStock(site, key));
        if (count > 0) launched += E.launch(s, owner, key, owner === 0 ? 2 : 1, count, site.id);
      }
      assert.equal(launched, 2, 'two paid craft launch from their actual local racks');
    }
    E.advance(s, 19);
    for (const r of s.roads) if (r.hp < r.maxHp) E.repair(s, r.id, r.side);
    E.advance(s, 15);
  }
  E.advance(s, 60);
  assert.ok(s.stats.shots > 100);
  assert.ok(s.stats.hits > 0);
  assert.ok(s.stats.misses > 0);
  assert.ok(s.stats.interceptions > 0);
  assert.ok(s.stats.impacts > 0);
  assert.ok(s.sides.every((f) => Number.isFinite(f.credits) && f.credits >= 0 && f.materials >= 0));
  assert.equal(E.load(E.save(s)).stats.shots, s.stats.shots);
});

test('a driveway is never hit on its own and disappears together with its ruined building', () => {
  const s = fresh();
  funds(s);
  const t = town(s),
    drive = () => s.roads.find((r) => r.id === t.factory.roadLink);
  const before = drive().hp;
  E.applyBlast(s, drive().ax, drive().az, 30, 12);
  assert.equal(drive().hp, before);
  E.damageBuilding(s, t.factory, 1e6);
  assert.equal(drive().removed, true);
  assert.equal(E.demolish(s, t.factory.id), true);
});

test('road drawing snaps like a city builder: compass and street angles, length steps, parallel guides', () => {
  const s = fresh();
  funds(s);
  assert.equal(typeof E.buildRoad(s, 0, -1292, 200, -1092, 200), 'object');
  const block = E.ROAD_GRID.block;
  // A start near the line one block away lands exactly on it, lined up with the street end.
  const start = E.snapRoadPoint(s, 0, -1289, 200 + block + 4);
  assert.equal(start.kind, 'guide');
  assert.deepEqual([start.x, start.z], [-1292, 200 + block]);
  // Drawn almost straight: the end keeps the street direction and an 8 m length step.
  const end = E.snapRoadPoint(s, 0, -1175, 200 + block + 3, start);
  assert.ok(Math.abs(end.z - start.z) < 1e-9);
  assert.equal(Math.abs(end.x - start.x) % E.ROAD_GRID.lengthStep, 0);
  // Across from the street end the drawing snaps perpendicular.
  const across = E.snapRoadPoint(s, 0, -1090, 330, { x: -1092, z: 200 });
  assert.ok(Math.abs(across.x + 1092) < 1e-9);
  // Shift forces the nearest grid direction even far from it.
  const forced = E.snapRoadPoint(s, 0, -1192, 330, { x: -1292, z: 330 }, true);
  assert.ok(
    Math.abs(forced.z - 330) < 1e-9 || Math.abs(forced.x + 1292) < 1e-9 || forced.kind === 'angle',
  );
});
