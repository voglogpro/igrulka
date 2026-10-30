import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { SEA, expandLegacyZ, expandLegacyX, expandV23X } from '../../src/game/map.js';
const migrateX = (x) => expandV23X(expandLegacyX(x));
import { GRID, fogVisible } from '../../src/game/vision-grid.js';
import { walkable, groundPath } from '../../src/game/units/ground/navigation.js';
import { moveUnits } from '../../src/game/units/aviation/flight.js';
import { pointOnRoute } from '../../src/game/units/aviation/routes.js';

function oldCampaign() {
  // Explicit 8.7 coordinates, with current fixture defaults supplying non-spatial fields.
  const s = E.createGame(117);
  s.version = 13;
  for (const b of s.buildings) if (b.key === 'hq') b.x = b.side === 0 ? -615 : 615;
  for (const r of s.roads) {
    r.ax -= Math.sign(r.ax) * 592;
    r.bx -= Math.sign(r.bx) * 592;
  }
  s.mode = 'multiplayer';
  s.time = 100;
  s.sides[0].credits = 2345;
  s.sides[0].materials = 117;
  s.sides[0].science = 43;
  s.sides[0].oil = 89;
  s.sides[0].inventory.drone = 7;
  const well = {
    id: s.nextId++,
    side: 0,
    key: 'oilwell',
    x: -450,
    z: -640,
    hp: E.BUILDINGS.oilwell.hp,
    maxHp: E.BUILDINGS.oilwell.hp,
    progress: 1,
    cooldown: 0,
    rotation: 0,
    queue: [],
  };
  s.buildings.push(well);
  const moving = E.makeGround(s, 0, 'infantry', -400, 1010);
  moving.order = { mode: 'move', x: 400, z: 1010 };
  moving.path = [
    { x: -100, z: 1010 },
    { x: 400, z: 1010 },
  ];
  const central = E.makeGround(s, 0, 'infantry', -900, 0);
  s.groundUnits.push(moving, central);
  return { s, well, moving, central };
}

test('expanded 4800x4000 map contains the 2240m sea and both wide land corridors span the field', () => {
  assert.deepEqual([E.MAP.width, E.MAP.depth, SEA.halfZ * 2, SEA.halfX], [4800, 4000, 2240, 792]);
  assert.deepEqual(E.CORRIDORS, [-1360, 1360]);
  const s = E.createGame(117);
  for (const z of E.CORRIDORS) {
    for (let x = -E.FIELD.x + 8; x <= E.FIELD.x - 8; x += 8)
      assert.equal(walkable(s, x, z, 6), true, `corridor blocked at ${x},${z}`);
    const path = groundPath(s, { x: -1500, z }, { x: 1500, z }, 6);
    assert.deepEqual(path.at(-1), { x: 1500, z });
  }
  assert.equal(walkable(s, 0, 0, 3), false, 'sea centre remains impassable');
});

test('vision dimensions cover both corridors but points are open for both sides', () => {
  const s = E.createGame(117);
  assert.equal(GRID.rows * GRID.cell, 4000);
  assert.equal(GRID.cols * GRID.cell, 4800);
  for (const z of E.CORRIDORS) s.groundUnits.push(E.makeGround(s, 0, 'infantry', -20, z));
  for (const z of E.CORRIDORS) {
    assert.equal(fogVisible(s, 0, -20, z), true);
    assert.equal(fogVisible(s, 0, 20, z), true);
    assert.equal(fogVisible(s, 1, -20, z), true);
  }
});

test('version13 import preserves identity, money and central coordinates while following oil fields', () => {
  const { s, well, central } = oldCampaign();
  const before = structuredClone(s);
  const restored = E.load(E.save(s));
  assert.deepEqual(s, before, 'save and load must not mutate the caller campaign');
  assert.equal(restored.version, E.VERSION);
  assert.deepEqual(
    restored.sides.map((f) => [f.credits, f.materials, f.science, f.oil, f.inventory]),
    s.sides.map((f) => [f.credits, f.materials, 0, f.oil, f.inventory]),
  );
  assert.deepEqual(
    restored.buildings.map((b) => [b.id, b.x]),
    s.buildings.map((b) => [b.id, migrateX(b.x)]),
  );
  assert.equal(restored.nextId, s.nextId);
  for (const hq of restored.buildings.filter((b) => b.key === 'hq')) assert.equal(hq.z, 0);
  assert.equal(restored.groundUnits.find((u) => u.id === central.id).z, 0);
  const migrated = restored.buildings.find((b) => b.id === well.id);
  assert.equal(migrated.z, expandLegacyZ(-640));
  const field = E.oilFieldAt(migrated.x, migrated.z);
  assert.ok(field, 'an existing paid well must still tap an oil field');
  assert.deepEqual([field.x, field.z], [migrated.x, migrated.z]);
});

test('moving legacy army follows the expanded corridor with a safe rebuilt route exactly once', () => {
  const { s, moving } = oldCampaign();
  const migrated = E.load(E.save(s));
  const u = migrated.groundUnits.find((unit) => unit.id === moving.id);
  assert.deepEqual([u.x, u.z, u.order.x, u.order.z], [migrateX(-400), 1360, migrateX(400), 1360]);
  assert.ok(walkable(migrated, u.x, u.z));
  assert.deepEqual(u.path, groundPath(migrated, u, u.order, E.GROUND_UNITS[u.key].size * 0.42));
  assert.notDeepEqual(u.path, moving.path);
  let previous = u;
  for (const next of u.path) {
    const steps = Math.ceil(Math.hypot(next.x - previous.x, next.z - previous.z) / 4);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      assert.ok(
        walkable(
          migrated,
          previous.x + (next.x - previous.x) * t,
          previous.z + (next.z - previous.z) * t,
        ),
      );
    }
    previous = next;
  }
  const again = E.load(E.save(migrated));
  assert.deepEqual(again.groundUnits, migrated.groundUnits);
  assert.deepEqual(again.buildings, migrated.buildings);
  assert.deepEqual(again.roads, migrated.roads);
});

test('legacy aircraft continues from its transformed position without a progress-fraction jump', () => {
  const { s, moving } = oldCampaign();
  moving.threatZ = 1010;
  const d = E.WEAPONS.drone;
  s.units.push({
    id: s.nextId++,
    side: 0,
    key: 'drone',
    hp: d.hp,
    maxHp: d.hp,
    status: 'flying',
    launched: true,
    delay: 0,
    x: -600,
    y: d.altitude,
    z: 1010,
    startX: -600,
    startZ: 0,
    tx: 600,
    tz: 1010,
    total: 2210,
    travelled: 1010,
    route: [
      { x: -600, z: 0, d: 0 },
      { x: -600, z: 1010, d: 1010 },
      { x: 600, z: 1010, d: 2210 },
    ],
  });
  const migrated = E.load(E.save(s)),
    u = migrated.units[0];
  assert.equal(migrated.groundUnits.find((v) => v.id === moving.id).threatZ, 1360);
  assert.equal(u.z, 1360);
  assert.deepEqual(pointOnRoute(u.route, u.travelled), { x: u.x, z: u.z });
  const before = { x: u.x, z: u.z };
  moveUnits(migrated, 1 / 30);
  assert.ok(Math.hypot(u.x - before.x, u.z - before.z) <= d.speed / 30 + 0.01);
  assert.ok(u.x > before.x, 'next step proceeds along the next leg, rather than backtracking');
  const restored = E.load(E.save(migrated));
  assert.deepEqual(restored.units[0].route, u.route, 'current saves are not stretched twice');
});

test('legacy aircraft without an explicit route retains its actual position on the first tick', () => {
  const { s } = oldCampaign(),
    d = E.WEAPONS.drone;
  s.units.push({
    id: s.nextId++,
    side: 0,
    key: 'drone',
    hp: d.hp,
    maxHp: d.hp,
    status: 'flying',
    launched: true,
    delay: 0,
    x: -600,
    y: d.altitude,
    z: 505,
    startX: -600,
    startZ: 0,
    tx: -600,
    tz: 1010,
    total: 1010,
    travelled: 505,
  });
  const migrated = E.load(E.save(s)),
    u = migrated.units[0];
  const before = { x: u.x, z: u.z };
  assert.deepEqual(pointOnRoute(u.route, u.travelled), before);
  moveUnits(migrated, 1 / 30);
  assert.ok(Math.hypot(u.x - before.x, u.z - before.z) <= d.speed / 30 + 0.01);
});

test('legacy ballistic altitude remains continuous and its migration correction survives save/load', () => {
  const { s } = oldCampaign(),
    d = E.WEAPONS.ballistic;
  const peak = 5 + d.altitude;
  s.units.push({
    id: s.nextId++,
    side: 0,
    key: 'ballistic',
    hp: d.hp,
    maxHp: d.hp,
    status: 'flying',
    launched: true,
    delay: 0,
    x: -600,
    y: peak,
    z: 505,
    startX: -600,
    startZ: 0,
    tx: -600,
    tz: 1010,
    total: 1010,
    travelled: 505,
  });
  const migrated = E.load(E.save(s));
  assert.ok(Math.abs(migrated.units[0].flightHeightOffset) > 1);
  const restored = E.load(E.save(migrated));
  assert.deepEqual(restored.units, migrated.units);
  moveUnits(restored, 1 / 30);
  assert.ok(Math.abs(restored.units[0].y - peak) < 0.5, 'no instant altitude jump at the old apex');
  assert.ok(Number.isFinite(restored.units[0].vy));
});

test('v14 width migration preserves local headquarters, driveway and building offsets exactly once', () => {
  const { s } = oldCampaign();
  s.version = 14;
  const hq = s.buildings.find((b) => b.key === 'hq' && b.side === 0);
  const b = {
    id: s.nextId++,
    side: 0,
    key: 'barracks',
    x: hq.x - 65,
    z: -10,
    hp: E.BUILDINGS.barracks.hp,
    maxHp: E.BUILDINGS.barracks.hp,
    progress: 1,
    armyQueue: [{ key: 'infantry', progress: 0.42 }],
    queue: [],
  };
  s.buildings.push(b);
  const road = {
    id: s.nextId++,
    side: 0,
    ax: hq.x,
    az: 0,
    bx: b.x,
    bz: b.z,
    hp: 100,
    maxHp: 100,
    connectorTo: b.id,
  };
  s.roads.push(road);
  const initial = {
    offset: b.x - hq.x,
    roadOffset: road.ax - b.x,
    length: Math.hypot(road.bx - road.ax, road.bz - road.az),
  };
  const loaded = E.load(E.save(s));
  const nextHq = loaded.buildings.find((v) => v.id === hq.id),
    next = loaded.buildings.find((v) => v.id === b.id);
  const nextRoad = loaded.roads.find((v) => v.id === road.id);
  assert.equal(nextHq.x, -E.HQ_X);
  assert.equal(next.x - nextHq.x, initial.offset);
  assert.equal(nextRoad.ax - next.x, initial.roadOffset);
  assert.equal(Math.hypot(nextRoad.bx - nextRoad.ax, nextRoad.bz - nextRoad.az), initial.length);
  assert.equal(next.armyQueue[0].progress, 0.42);
  assert.equal(next.z, b.z, 'v14 receives width migration only');
  const again = E.load(E.save(loaded));
  assert.deepEqual(again.buildings, loaded.buildings);
  assert.deepEqual(again.roads, loaded.roads);
});
