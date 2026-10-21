import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { FixedCamera, CAMERA } from '../../src/rendering/camera.js';
import { PerspectiveCamera, Vector3 } from '../../vendor/three/three.module.js';
const fresh = () => {
  const s = E.createGame(117);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = s.ai.nextScout = 1e9;
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
}
function town(s, side = 0) {
  const x = side === 0 ? -615 : 615;
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
  assert.match(E.canPlace(s, 'housing', -300, 200), /улицей/);
  assert.equal(E.canPlace(s, 'housing', -615, -80), null);
  const b = E.build(s, 0, 'housing', -615, -80);
  assert.ok(b.roadLink);
  assert.ok(s.roads.some((r) => r.connectorTo === b.id));
  assert.equal(E.supplyFactor(s, b), 1);
  assert.equal(E.canPlace(s, 'gun', -300, 200), null);
  assert.match(E.canPlace(s, 'housing', 0, 0), /земля/);
});
test('cutting the only trunk reduces downstream economy to 20%; bypass and repair restore supply', () => {
  const s = fresh();
  funds(s);
  const b = ready(s, 0, 'industry', -560, -80),
    before = E.economy(s, 0).materials,
    central = s.roads.find((r) => r.side === 0 && r.camp && r.ax < -615 && r.bx > -615);
  E.damageRoad(s, central, 100);
  assert.equal(E.supplyFactor(s, b), 0.2);
  assert.ok(Math.abs(E.economy(s, 0).materials - before * 0.2) < 1e-9);
  assert.equal(E.repair(s, central.id), true);
  E.advance(s, 7);
  assert.equal(E.supplyFactor(s, b), 1);
  E.damageRoad(s, central, 120);
  const first = E.buildRoad(s, 0, -690, -45, -690, 45);
  assert.equal(typeof first, 'object');
  assert.equal(typeof E.buildRoad(s, 0, -690, 45, -530, 45), 'object');
  assert.equal(typeof E.buildRoad(s, 0, -530, 45, -530, -45), 'object');
  assert.equal(E.supplyFactor(s, b), 1);
});
test('an attack aimed at a road actually severs it and the next tick updates supply', () => {
  const s = fresh();
  funds(s);
  town(s);
  const enemy = town(s, 1),
    central = s.roads.find((r) => r.side === 1 && r.camp && r.ax < 615 && r.bx > 615);
  s.sides[0].inventory.drone = 1;
  assert.equal(E.launch(s, 0, 'drone', central.id), 1);
  E.advance(s, 40);
  assert.ok(central.hp < central.maxHp * 0.3);
  assert.equal(E.supplyFactor(s, enemy.industry), 0.2);
  assert.ok(s.stats.roadsCut >= 1);
});
test('road construction splits long streets, validates collisions, and supports snapping', () => {
  const s = fresh();
  funds(s);
  const r = E.buildRoad(s, 0, -705, -45, -830, -45);
  assert.equal(typeof r, 'object');
  assert.equal(r.segments.length, 2);
  assert.ok(r.segments.every((seg) => E.network(s, 0).ids.has(seg.id)));
  assert.match(E.buildRoad(s, 0, -660, 0, -570, 0), /здание/);
  assert.match(E.buildRoad(s, 0, -100, 0, 100, 0), /суше/);
  const snapped = E.snapRoadPoint(s, 0, -827, -43);
  assert.equal(snapped.x, -830);
  assert.equal(snapped.z, -45);
});
test('factory stock and autonomous launcher are separate stages; clicks reserve stock once', () => {
  const s = fresh();
  funds(s);
  assert.match(E.produce(s, 0, 'drone'), /завод/);
  ready(s, 0, 'power', -670, -80);
  ready(s, 0, 'factory', -680, -10);
  assert.equal(E.produce(s, 0, 'drone', 3), true);
  E.advance(s, 37);
  assert.equal(s.sides[0].inventory.drone, 3);
  assert.match(E.launch(s, 0, 'drone', 2), /площадку/);
  const launcher = ready(s, 0, 'launcher', -350, -150);
  assert.equal(launcher.roadLink, undefined);
  assert.equal(E.launch(s, 0, 'drone', 2, 2), 2);
  assert.equal(E.launch(s, 0, 'drone', { x: 580, z: 30 }, 1), 1);
  assert.equal(s.units.length, 3);
  assert.equal(s.sides[0].inventory.drone, 0);
  assert.match(E.launch(s, 0, 'drone', 2), /складе/);
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
  assert.equal(E.repair(s, t.factory.roadLink), true);
  E.advance(s, 20);
  assert.equal(s.sides[0].inventory.drone, 1);
});
function movingDrone(s) {
  const u = {
    id: s.nextId++,
    side: 1,
    key: 'heavy',
    x: -310,
    z: 20,
    y: 57,
    startX: 300,
    startZ: 20,
    tx: -615,
    tz: 0,
    targetId: 1,
    hp: 1000,
    maxHp: 1000,
    travelled: 610,
    total: 915,
    delay: 0,
    phase: 1,
  };
  s.units.push(u);
  return u;
}
test('gun rounds follow gravity without homing and record real hits and misses', () => {
  const s = fresh();
  funds(s);
  ready(s, 0, 'gun', -460, 0);
  ready(s, 0, 'radar', -600, 100);
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
  ready(s, 0, 'gun', -460, 0);
  movingDrone(s);
  s.sides[0].materials = 0;
  E.advance(s, 1);
  assert.equal(s.stats.shots, 0);
  const win = fresh();
  funds(win);
  town(win);
  win.buildings[1].hp = 90;
  win.sides[0].inventory.drone = 1;
  E.launch(win, 0, 'drone', 2);
  E.advance(win, 40);
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
  assert.ok(controls.target.x <= 795 && controls.target.z >= -480);
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
  assert.ok(Math.abs(controls.target.x) <= 795 && Math.abs(controls.target.z) <= 480);
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
  assert.ok(own.every((b) => Math.abs(b.x - 615) <= 200 && Math.abs(b.z) <= 300));
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
test('complete research chain and all four weapons participate in a live defended battle', () => {
  const s = fresh();
  funds(s);
  for (const hq of s.buildings) {
    hq.hp = hq.maxHp = 8000;
  }
  for (const owner of [0, 1]) {
    const x = owner === 0 ? -615 : 615;
    town(s, owner);
    assert.equal(typeof E.buildRoad(s, owner, x - 90, -45, x - 170, -45), 'object');
    ready(s, owner, 'lab', x - 120, -80);
    assert.match(E.research(s, owner, 'cruise'), /предыдущее/);
  }
  for (const key of [
    'autocannon',
    'heavy',
    'missileDefense',
    'efficiency',
    'cruise',
    'abm',
    'ballistic',
  ]) {
    for (const owner of [0, 1]) assert.equal(E.research(s, owner, key), true);
    E.advance(s, E.TECH[key].time + 1);
  }
  for (const owner of [0, 1]) {
    const x = owner === 0 ? -615 : 615;
    ready(s, owner, 'gun', x + (owner === 0 ? 170 : -170), 0);
    ready(s, owner, 'sam', x + (owner === 0 ? 180 : -180), 85);
    for (const key of Object.keys(E.WEAPONS)) assert.equal(E.produce(s, owner, key, 4), true);
  }
  E.advance(s, 420);
  for (const key of Object.keys(E.WEAPONS)) {
    for (const owner of [0, 1]) {
      assert.ok(s.sides[owner].inventory[key] >= 4);
      assert.equal(E.launch(s, owner, key, owner === 0 ? 2 : 1, 4), 4);
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
