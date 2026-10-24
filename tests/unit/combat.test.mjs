import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { FixedCamera, CAMERA } from '../../src/rendering/camera.js';
import { PerspectiveCamera } from '../../vendor/three/three.module.js';
function fresh() {
  const s = E.createGame(17);
  s.ai.nextBuild = s.ai.nextAttack = s.ai.nextResearch = 1e9;
  for (const f of s.sides) {
    f.credits = 20000;
    f.materials = 3000;
  }
  return s;
}
function ready(s, side, key, x, z) {
  const b = E.build(s, side, key, x, z);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function airborne(s, x = -615, z = -80) {
  const d = E.WEAPONS.drone,
    u = {
      id: s.nextId++,
      side: 1,
      key: 'drone',
      status: 'flying',
      hp: d.hp,
      maxHp: d.hp,
      x,
      y: 80,
      z,
      prevX: x,
      prevY: 80,
      prevZ: z,
      vx: 0,
      vy: 0,
      vz: 0,
      startX: x,
      startZ: z,
      tx: 0,
      tz: z,
      total: 615,
      travelled: 100,
      delay: 0,
      phase: 0,
      launched: true,
    };
  s.units.push(u);
  return u;
}

test('right click cancels once, right drag only orbits, and pointer loss cannot leave rotation stuck', () => {
  const events = {},
    canvas = {
      style: { cursor: '' },
      addEventListener(k, fn) {
        (events[k] ||= []).push(fn);
      },
      setPointerCapture() {},
      hasPointerCapture() {
        return true;
      },
      releasePointerCapture() {},
    },
    c = new FixedCamera(new PerspectiveCamera(45, 1, 2, 5000), canvas);
  let cancelled = 0;
  c.onContextClick = () => cancelled++;
  const send = (name, e = {}) =>
    events[name].forEach((fn) =>
      fn({
        pointerId: 1,
        button: 2,
        buttons: 2,
        clientX: 100,
        clientY: 100,
        preventDefault() {},
        ...e,
      }),
    );
  const yaw = c.yaw;
  send('pointerdown');
  send('pointermove', { clientX: 102 });
  send('pointerup');
  assert.equal(cancelled, 1);
  assert.equal(c.yaw, yaw);
  send('pointerdown');
  send('pointermove', { clientX: 400, clientY: -10000 });
  assert.equal(c.pitch, CAMERA.minPitch);
  c.zoomDistance = CAMERA.min;
  c.update(10);
  assert.ok(c.camera.position.y > 45);
  send('pointerup');
  assert.equal(cancelled, 1);
  assert.notEqual(c.yaw, yaw);
  const origin = c.desired.clone();
  c.update(0.1, { KeyW: true });
  assert.ok(c.desired.clone().sub(origin).dot(c.forward) > 0);
  send('pointerdown');
  send('pointercancel');
  assert.equal(c.rotating, false);
  assert.equal(cancelled, 1);
});
test('autonomous launchers accept repeated targets, reserve stock once, and enforce independent queue capacity', () => {
  const s = fresh(),
    a = ready(s, 0, 'launcher', -330, 170),
    b = ready(s, 0, 'launcher', -450, 190);
  s.sides[0].inventory.drone = 20;
  assert.equal(a.roadLink, undefined);
  assert.equal(E.supplyFactor(s, a), 1);
  assert.equal(E.launch(s, 0, 'drone', { x: 615, z: 0 }, 5, a.id), 5);
  assert.equal(E.launch(s, 0, 'drone', { x: 615, z: 80 }, 5, a.id), 5);
  assert.equal(E.launch(s, 0, 'drone', { x: 615, z: 120 }, 5, a.id), 2);
  assert.equal(s.sides[0].inventory.drone, 8);
  assert.match(E.launch(s, 0, 'drone', 2, 1, a.id), /Очередь/);
  assert.equal(E.launch(s, 0, 'drone', 2, 1, b.id), 1);
  assert.equal(s.sides[0].inventory.drone, 7);
  assert.deepEqual(
    s.units.filter((u) => u.sourceId === a.id).map((u) => u.tz),
    [0, 0, 0, 0, 0, 80, 80, 80, 80, 80, 120, 120],
  );
  const saved = E.load(E.save(s));
  E.advance(saved, 10);
  assert.equal(
    E.queuedLaunches(
      saved,
      saved.buildings.find((x) => x.id === a.id),
    ),
    0,
  );
  assert.equal(saved.sides[0].inventory.drone, 7);
  assert.ok(saved.events.filter((e) => e.type === 'launch').length >= 12);
});
test('a destroyed launcher returns only unlaunched reserved aircraft to stock', () => {
  const s = fresh(),
    site = ready(s, 0, 'launcher', -330, 170);
  s.sides[0].inventory.drone = 5;
  E.launch(s, 0, 'drone', 2, 5, site.id);
  E.advance(s, 0.05);
  const launched = s.units.filter((u) => u.launched).length;
  assert.equal(launched, 1);
  E.damageBuilding(s, site, 10000);
  E.advance(s, 0.1);
  assert.equal(s.sides[0].inventory.drone, 4);
  assert.equal(s.units.length, 1);
  assert.equal(s.units[0].launched, true);
});
test('ruins block construction until cleared, remove the driveway and remain cleared after reload', () => {
  const s = fresh(),
    b = ready(s, 0, 'industry', -560, -80),
    road = s.roads.find((r) => r.connectorTo === b.id);
  E.damageBuilding(s, b, 10000);
  assert.match(E.canPlace(s, 'industry', b.x, b.z), /руины/);
  assert.ok(E.observedTarget(s, 0, b.id));
  assert.equal(E.demolish(s, b.id), true);
  assert.equal(road.removed, true);
  assert.equal(E.targetById(s, b.id), null);
  assert.equal(E.canPlace(s, 'industry', b.x, b.z), null);
  assert.equal(E.observedTarget(E.load(E.save(s)), 0, b.id), null);
  assert.equal(E.demolish(s, b.id), false);
  assert.equal(E.demolish(s, 2), false);
});
test('roads reject identical, reversed, partial and close parallel overlays without charging; proper junctions work', () => {
  const s = fresh(),
    cash = s.sides[0].credits;
  for (const p of [
    [-705, -45, -645, -45],
    [-645, -45, -705, -45],
    [-735, -45, -660, -45],
    [-705, -42, -645, -42],
  ])
    assert.match(E.buildRoad(s, 0, ...p), /уже есть дорога/);
  assert.equal(s.sides[0].credits, cash);
  assert.equal(typeof E.buildRoad(s, 0, -705, -45, -800, -45), 'object');
  assert.equal(typeof E.buildRoad(s, 0, -690, -45, -690, -160), 'object');
});
test('interception can leave a falling wingless aircraft; the crash damages the actual roof underneath once', () => {
  const s = fresh(),
    b = ready(s, 0, 'housing', -615, -80),
    u = airborne(s);
  s.rng = 1;
  E.damageAircraft(s, u, 100, 0);
  assert.equal(u.status, 'falling');
  assert.ok([-1, 1].includes(u.missingWing));
  assert.equal(s.sides[0].kills, 1);
  E.advance(s, 0.4);
  assert.ok(s.units.includes(u));
  assert.ok(u.y < 80);
  assert.equal(b.hp, b.maxHp);
  E.advance(s, 5);
  assert.equal(s.units.length, 0);
  assert.equal(s.stats.crashes, 1);
  assert.ok(b.hp < b.maxHp);
  const hp = b.hp;
  E.advance(s, 5);
  assert.equal(b.hp, hp);
  assert.equal(s.sides[0].kills, 1);
});
test('the other interception outcome is an airburst without a ground blast', () => {
  const s = fresh(),
    b = ready(s, 0, 'housing', -615, -80),
    u = airborne(s);
  s.rng = 1100;
  E.damageAircraft(s, u, 100, 0);
  assert.equal(u.status, 'airburst');
  assert.equal(s.stats.airbursts, 1);
  E.advance(s, 5);
  assert.equal(s.units.length, 0);
  assert.equal(s.stats.crashes, 0);
  assert.equal(b.hp, b.maxHp);
});
test('a falling aircraft round trips without losing velocity, collision or damage state', () => {
  const s = fresh();
  ready(s, 0, 'housing', -615, -80);
  const u = airborne(s);
  s.rng = 1;
  E.damageAircraft(s, u, 100, 0);
  E.advance(s, 0.5);
  const restored = E.load(E.save(s));
  assert.equal(restored.units[0].status, 'falling');
  assert.equal(restored.units[0].y, u.y);
  E.advance(restored, 5);
  E.advance(s, 5);
  assert.equal(restored.stats.crashes, 1);
  assert.equal(restored.buildings[2].hp, s.buildings[2].hp);
});
test('bullet motion has vertical acceleration and never bends horizontally toward a target', () => {
  const s = fresh(),
    u = airborne(s, -400, 0);
  u.hp = u.maxHp = 10000;
  const p = {
    id: s.nextId++,
    side: 0,
    kind: 'bullet',
    x: -700,
    y: 90,
    z: 0,
    px: -700,
    py: 90,
    pz: 0,
    vx: 300,
    vy: 15,
    vz: 0,
    speed: 301,
    gravity: E.COMBAT.gravity,
    damage: 3.5,
    targetId: u.id,
    life: 0,
    maxLife: 2,
  };
  s.projectiles.push(p);
  E.advance(s, 0.1);
  assert.ok(Math.abs(p.x + 670) < 1e-8);
  assert.ok(Math.abs(p.y - (90 + 15 * 0.1 - 0.5 * E.COMBAT.gravity * 0.1 * 0.1)) < 1e-8);
  assert.ok(Math.abs(p.vy - (15 - E.COMBAT.gravity * 0.1)) < 1e-8);
  assert.equal(p.vz, 0);
  assert.equal(p.vx, 300);
});
test('fog of intelligence hides enemy units without an observer, but buildings stay known', () => {
  const s = fresh(),
    u = airborne(s, 700, 300);
  assert.equal(E.WEAPONS.scout, undefined);
  assert.equal(E.unitVisible(s, 0, u), false);
  assert.equal(E.unitVisible(s, 1, u), true);
  assert.ok(E.knownTargets(s, 0).some((t) => t.id === 2));
  assert.equal(E.observedTarget(s, 0, 2).hp, 1100);
  assert.equal(E.pointVisible(s, 0, 700, 300), false);
  const tank = E.makeGround(s, 1, 'leopard', 400, 100);
  s.groundUnits.push(tank);
  assert.equal(E.groundVisible(s, 0, tank), false);
  const scout = E.makeGround(s, 0, 'sniper', 300, 100);
  s.groundUnits.push(scout);
  s.time += 1;
  assert.equal(E.groundVisible(s, 0, tank), true);
  // Losing the observer hides the target again after the grid refreshes.
  scout.hp = 0;
  s.time += 1;
  assert.equal(E.groundVisible(s, 0, tank), false);
});
test('one working radar shows every enemy unit on the map, and an unpowered one does not', () => {
  const s = fresh(),
    u = airborne(s, 700, 300),
    tank = E.makeGround(s, 1, 'leopard', 500, -300);
  s.groundUnits.push(tank);
  const radar = ready(s, 0, 'radar', -560, 120);
  s.time += 1;
  assert.equal(E.sensorSources(s, 0).length, 1);
  assert.equal(E.unitVisible(s, 0, u), true);
  assert.equal(E.groundVisible(s, 0, tank), true);
  // Without the power plant the radar stays dark while the demand is unmet.
  radar.hp = 0;
  s.time += 1;
  assert.equal(E.unitVisible(s, 0, u), false);
});
test('version 5 removes recon missions and production, refunds their exact costs and preserves the campaign', () => {
  const s = fresh(),
    factory = ready(s, 0, 'factory', -680, -10);
  s.version = 5;
  s.sides[0].inventory.scout = 2;
  factory.queue = [{ key: 'scout', progress: 0.5 }];
  const u = airborne(s);
  u.key = 'scout';
  u.side = 0;
  s.intel = [{}, {}];
  const cash = s.sides[0].credits,
    metal = s.sides[0].materials,
    restored = E.load(E.save(s));
  assert.equal(restored.version, E.VERSION);
  assert.equal(restored.units.length, 0);
  assert.equal(restored.sides[0].inventory.scout, undefined);
  assert.equal(restored.sides[0].credits, cash + 4 * 65);
  assert.equal(restored.sides[0].materials, metal + 4 * 5);
  assert.equal(restored.buildings.find((b) => b.id === factory.id).queue.length, 0);
  assert.equal(restored.intel, undefined);
  assert.equal(restored.buildings.length, s.buildings.length);
});
test('legacy overlapping streets are split into uncovered sections while preserving HQ connectivity', () => {
  const s = fresh();
  s.version = 5;
  s.roads.push({
    id: s.nextId++,
    side: 0,
    ax: -815,
    az: -45,
    bx: -415,
    bz: -45,
    hp: 120,
    maxHp: 120,
  });
  const restored = E.load(E.save(s)),
    roads = restored.roads.filter((r) => r.side === 0 && !r.removed);
  assert.equal(roads.length, 5);
  assert.ok(
    Math.abs(roads.reduce((n, r) => n + Math.hypot(r.bx - r.ax, r.bz - r.az), 0) - 400) < 1e-8,
  );
  assert.ok(roads.every((r) => E.network(restored, 0).ids.has(r.id)));
  for (const r of roads)
    assert.equal(
      E.overlappingRoad(
        { ...restored, roads: roads.filter((other) => other.id !== r.id) },
        r.ax,
        r.az,
        r.bx,
        r.bz,
      ),
      null,
    );
  assert.deepEqual(E.load(E.save(restored)).roads, restored.roads);
});
