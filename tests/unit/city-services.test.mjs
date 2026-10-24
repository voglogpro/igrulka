import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateServices } from '../../src/game/city/service.js';
import { addRoad } from '../../src/game/city/roads.js';
import { dirtyNetwork, projectPoint } from '../../src/game/city/road-network.js';
import { serviceRoadGraph, serviceRoutes } from '../../src/game/city/service-roads.js';

const cfg = E.BUILDINGS.service.service;
const near = (a, b, epsilon = 1e-7) => assert.ok(Math.abs(a - b) < epsilon, `${a} versus ${b}`);
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
function fresh() {
  const s = E.createGame(2410);
  s.mode = 'multiplayer';
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 20000;
    f.materials = 3000;
    f.rearAuto = false;
  }
  return s;
}
function build(s, side, key, x, z) {
  const b = E.build(s, side, key, x, z);
  assert.equal(typeof b, 'object', String(b));
  b.progress = 1;
  b.hp = b.maxHp;
  return b;
}
function town(side = 0) {
  const s = fresh(),
    sign = side ? 1 : -1;
  const b = build(s, side, 'service', sign * 680, -80);
  const t = build(s, side, 'housing', sign * 560, -80);
  t.hp -= 120;
  return { s, b, t };
}
function serviceTime(s, seconds) {
  for (let t = 0; t < seconds - 1e-8; t += 0.05) {
    s.time += 0.05;
    updateServices(s, 0.05);
  }
}

test('the station requires an actual street, pays normal construction and upkeep, and only completed stations get a limited fleet', () => {
  const s = fresh(),
    before = s.sides[0].credits;
  assert.match(E.canPlace(s, 'service', -300, 250), /улицей/);
  const b = E.build(s, 0, 'service', -680, -80);
  assert.equal(typeof b, 'object');
  assert.ok(before - s.sides[0].credits >= E.BUILDINGS.service.cost);
  assert.equal(s.sides[0].materials, 3000 - E.BUILDINGS.service.metal);
  E.advance(s, 1);
  assert.equal(s.serviceVehicles.length, 0);
  E.advance(s, E.BUILDINGS.service.time);
  assert.equal(s.serviceVehicles.length, cfg.vehicles);
  assert.ok(distance(s.serviceVehicles[0], s.serviceVehicles[1]) >= 5.9);
  near(E.economy(s, 0).upkeep, E.BUILDINGS.service.upkeep);
  assert.equal(E.serviceStatus(s, 0, b.id).status, 'idle');
});

test('real simulation sends a crew along the street and driveway, repairs for the exact resources, then physically returns', () => {
  const { s, b, t } = town(),
    startHp = t.hp;
  let repaired = 0,
    observedTravel = false;
  const previous = new Map();
  for (let i = 0; i < 500; i++) {
    const oldHp = t.hp,
      credits = s.sides[0].credits,
      materials = s.sides[0].materials;
    const rates = E.economy(s, 0);
    E.step(s, 0.05);
    const delta = t.hp - oldHp;
    near(credits + rates.net * 0.05 - s.sides[0].credits, delta * cfg.creditsPerHp);
    near(materials + rates.materials * 0.05 - s.sides[0].materials, delta * cfg.materialsPerHp);
    repaired += delta;
    for (const v of s.serviceVehicles) {
      if (previous.has(v.id)) assert.ok(distance(v, previous.get(v.id)) <= cfg.speed * 0.05 + 1e-7);
      assert.ok(
        s.roads.some(
          (r) => r.side === v.side && !r.removed && projectPoint(v.x, v.z, r).distance < 1.3,
        ),
      );
      previous.set(v.id, { x: v.x, z: v.z });
      if (v.state === 'outbound') observedTravel = true;
      if (delta > 0 && v.target?.id === t.id) assert.ok(distance(v, t) < E.BUILDINGS.housing.size);
    }
    if (s.time < 3) assert.equal(t.hp, startHp, 'no remote repair while driving');
  }
  near(repaired, 120);
  assert.equal(t.hp, t.maxHp);
  assert.equal(observedTravel, true);
  assert.ok(s.serviceVehicles.every((v) => v.state === 'idle' && distance(v, b) < 28));
  assert.equal(s.groundUnits.length, 0, 'the civic fleet does not duplicate army rear units');
});

test('disable cancels work immediately, crews drive home, and re-enabling resumes without buying another fleet', () => {
  const { s, b, t } = town();
  E.advance(s, 6);
  assert.ok(t.hp > t.maxHp - 120);
  const hp = t.hp,
    ids = s.serviceVehicles.map((v) => v.id);
  assert.equal(E.setServiceEnabled(s, 1, b.id, false), 'Ремонтная станция недоступна');
  assert.equal(E.setServiceEnabled(s, 0, b.id, 'false'), 'Ремонтная станция недоступна');
  assert.equal(E.setServiceEnabled(s, 0, b.id, false), true);
  E.advance(s, 10);
  assert.equal(t.hp, hp);
  assert.equal(E.serviceStatus(s, 0, b.id).status, 'disabled');
  assert.ok(s.serviceVehicles.every((v) => !v.target && v.state === 'idle' && distance(v, b) < 28));
  assert.equal(E.setServiceEnabled(s, 0, b.id, true), true);
  E.advance(s, 25);
  assert.equal(t.hp, t.maxHp);
  assert.deepEqual(
    s.serviceVehicles.map((v) => v.id),
    ids,
  );
});

test('empty resources halt repair and fractional reserves buy only affordable actual HP', () => {
  const { s, b, t } = town();
  serviceTime(s, 5.5);
  for (const empty of ['credits', 'materials']) {
    s.sides[0].credits = s.sides[0].materials = 10;
    s.sides[0][empty] = 0;
    const hp = t.hp,
      before = { ...s.sides[0] };
    serviceTime(s, 1);
    assert.equal(t.hp, hp);
    assert.equal(s.sides[0].credits, before.credits);
    assert.equal(s.sides[0].materials, before.materials);
    assert.equal(E.serviceStatus(s, 0, b.id).status, empty);
  }
  s.sides[0].credits = cfg.creditsPerHp * 0.25;
  s.sides[0].materials = cfg.materialsPerHp * 0.25;
  const hp = t.hp;
  serviceTime(s, 1);
  near(t.hp - hp, 0.25);
  near(s.sides[0].credits, 0);
  near(s.sides[0].materials, 0);
  s.sides[0].credits = 100;
  s.sides[0].materials = 100;
  serviceTime(s, 20);
  assert.equal(t.hp, t.maxHp);
});

test('a station in a cut-off district repairs the accessible edge before any crew can cross the gap', () => {
  const { s, b, t } = town();
  E.advance(s, 0.5);
  const cut = s.roads.find((r) => r.camp && r.side === 0 && r.ax === -645);
  E.damageRoad(s, cut, 120);
  assert.equal(E.network(s, 0).connected.length, 0);
  s.sides[0].materials = 0;
  const hp = t.hp;
  E.advance(s, 8);
  assert.equal(cut.hp, 0);
  assert.equal(t.hp, hp);
  assert.ok(s.serviceVehicles.every((v) => v.x <= cut.ax + 1e-6));
  assert.ok(s.serviceVehicles.some((v) => v.target?.id === cut.id));
  assert.ok(E.supplyFactor(s, b) < 1, 'ordinary HQ supply penalties remain');
  s.sides[0].materials = 3000;
  E.advance(s, 35);
  assert.equal(cut.hp, cut.maxHp);
  assert.equal(cut.blocked, false);
  assert.equal(t.hp, t.maxHp);
  assert.equal(E.supplyFactor(s, b), 1);
});

test('an isolated road component cannot be crossed, and removing a road cannot order a free reconstruction', () => {
  const { s, t } = town();
  const gap = s.roads.find((r) => r.camp && r.side === 0 && r.ax === -645);
  gap.removed = true;
  gap.hp = 0;
  dirtyNetwork(s);
  E.advance(s, 30);
  assert.equal(t.hp, t.maxHp - 120);
  assert.equal(gap.hp, 0);
  assert.ok(s.serviceVehicles.every((v) => v.x <= gap.ax + 1e-6));
});

test('a station without any local access reports road and blocked crews retry on cadence rather than every tick', () => {
  const { s, b, t } = town();
  E.advance(s, 2);
  for (const r of s.roads) if (r.side === 0) r.removed = true;
  dirtyNetwork(s);
  const hp = t.hp;
  E.advance(s, 0.05);
  assert.equal(E.serviceStatus(s, 0, b.id).status, 'road');
  assert.ok(s.serviceVehicles.every((v) => v.state === 'blocked' && !v.path.length));
  const positions = s.serviceVehicles.map((v) => ({ x: v.x, z: v.z }));
  const schedule = s.serviceVehicles.map((v) => v.thinkAt);
  E.advance(s, 0.2);
  assert.deepEqual(
    s.serviceVehicles.map((v) => v.thinkAt),
    schedule,
  );
  assert.deepEqual(
    s.serviceVehicles.map((v) => ({ x: v.x, z: v.z })),
    positions,
  );
  assert.ok(s.serviceVehicles.every((v) => v.revision === s.networkRevision));
  assert.equal(t.hp, hp);
});

test('storms slow the same physical road journey without disabling or replacing the fleet', () => {
  const clear = town(),
    storm = town();
  Object.assign(storm.s.weather, {
    kind: 'storm',
    amount: 1,
    goal: 1,
    next: 'storm',
    until: 1e6,
    strikeAt: 1e6,
  });
  E.advance(clear.s, 2);
  E.advance(storm.s, 2);
  const a = clear.s.serviceVehicles.find((v) => v.target),
    b = storm.s.serviceVehicles.find((v) => v.target);
  assert.ok(a.x > b.x + 3, 'the storm crew must have covered less of the same eastbound street');
  assert.equal(clear.t.hp, storm.t.hp);
  E.advance(storm.s, 30);
  assert.equal(storm.t.hp, storm.t.maxHp);
  assert.equal(storm.s.serviceVehicles.length, cfg.vehicles);
});

test('destroyed and unfinished buildings and enemy property are never repaired; station loss removes its dependent fleet', () => {
  const { s, b, t } = town();
  const enemy = build(s, 1, 'launcher', -560, 80);
  enemy.hp -= 50;
  const unfinished = E.build(s, 0, 'launcher', -450, 80);
  const removed = s.roads.find((r) => r.side === 1);
  removed.hp = 0;
  E.advance(s, 3);
  t.hp = 0;
  dirtyNetwork(s);
  const before = enemy.hp,
    unfinishedHp = unfinished.hp;
  serviceTime(s, 25);
  assert.equal(t.hp, 0);
  assert.equal(enemy.hp, before);
  assert.equal(unfinished.hp, unfinishedHp);
  assert.equal(removed.hp, 0);
  assert.ok(s.serviceVehicles.every((v) => !v.target));
  b.hp = 0;
  serviceTime(s, 1);
  assert.equal(s.serviceVehicles.length, 0);
  assert.equal(E.serviceStatus(s, 0, b.id).status, 'ruined');
});

test('manual prepaid repair stays separate and the city service cannot charge for its HP gain', () => {
  const { s, t } = town();
  assert.equal(E.repair(s, t.id, 0), true);
  const credits = s.sides[0].credits,
    materials = s.sides[0].materials;
  serviceTime(s, 10);
  assert.equal(t.hp, t.maxHp - 120);
  assert.equal(s.sides[0].credits, credits);
  assert.equal(s.sides[0].materials, materials);
  E.advance(s, 11);
  assert.equal(t.hp, t.maxHp);
});

test('the road route preserves bends and junctions instead of driving a straight line through the city', () => {
  const s = fresh();
  addRoad(s, 0, -525, -45, -500, -45);
  addRoad(s, 0, -500, -45, -500, -130);
  const graph = serviceRoadGraph(s, 0),
    last = s.roads.at(-1);
  const route = serviceRoutes(graph, { x: -680, z: -45 })({ x: -500, z: -130 }, last.id);
  assert.ok(route);
  assert.ok(route.path.some((p) => p.x === -500 && p.z === -45));
  assert.ok(route.cost > Math.hypot(180, 85));
  assert.deepEqual(route.path.at(-1), { x: -500, z: -130 });
});

test('fleet limits are configured, shared per owner and independent between multiplayer sides', () => {
  const s = fresh();
  for (const side of [0, 1]) {
    const first = build(s, side, 'service', side ? 680 : -680, -80);
    for (let i = 0; i < 4; i++) s.buildings.push({ ...first, id: s.nextId++ });
  }
  E.advance(s, 0.1);
  for (const side of [0, 1]) {
    const fleet = s.serviceVehicles.filter((v) => v.side === side);
    assert.equal(fleet.length, cfg.sideLimit);
    assert.ok(
      fleet.every(
        (v) => fleet.filter((other) => other.stationId === v.stationId).length <= cfg.vehicles,
      ),
    );
  }
  assert.equal(new Set(s.serviceVehicles.map((v) => v.id)).size, cfg.sideLimit * 2);
  assert.equal(E.load(E.save(s)).serviceVehicles.length, cfg.sideLimit * 2);
});

test('either owner saves mid-drive and mid-repair and continues the same actual journey and charges', () => {
  for (const side of [0, 1])
    for (const elapsed of [2, 7]) {
      const { s, b } = town(side);
      E.advance(s, elapsed);
      const loaded = E.load(E.save(s));
      assert.deepEqual(loaded.serviceVehicles, s.serviceVehicles);
      E.advance(s, 30);
      E.advance(loaded, 30);
      // Loading invalidates graph caches, represented by networkRevision+1.
      const fleet = (state) =>
        state.serviceVehicles.map(({ revision, ...v }) => ({
          ...v,
          revision: revision - state.networkRevision,
        }));
      assert.deepEqual(fleet(loaded), fleet(s));
      assert.deepEqual(loaded.sides, s.sides);
      assert.deepEqual(loaded.buildings, s.buildings);
      assert.equal(E.serviceStatus(loaded, side, b.id).status, 'idle');
      assert.deepEqual(loaded.weather, s.weather);
    }
});

test('stopping simulation preserves the fleet and resources and game-over forbids repair or toggles', () => {
  const { s, b } = town();
  E.advance(s, 6);
  const paused = E.save(s);
  E.step(s, 0);
  E.step(s, NaN);
  updateServices(s, 0);
  assert.equal(E.save(s), paused);
  s.result = 'victory';
  const finished = E.save(s);
  E.advance(s, 10);
  updateServices(s, 1);
  assert.equal(E.save(s), finished);
  assert.equal(typeof E.setServiceEnabled(s, 0, b.id, false), 'string');
});

test('old campaigns migrate with an empty fleet; malformed, foreign and wrong-type service metadata are rejected', () => {
  const { s, b, t } = town();
  E.advance(s, 6);
  const raw = JSON.parse(E.save(s));
  for (const corrupt of [
    (v) => {
      v.serviceVehicles[0].x = 900;
    },
    (v) => {
      v.serviceVehicles[0].state = '__proto__';
    },
    (v) => {
      v.serviceVehicles[0].stationId = t.id;
    },
    (v) => {
      v.serviceVehicles[0].target = { kind: 'constructor', id: t.id };
    },
    (v) => {
      v.serviceVehicles[0].target = { kind: 'building', id: 2 };
    },
    (v) => {
      v.serviceVehicles[0].path = [{ x: null, z: 0 }];
    },
    (v) => {
      v.serviceVehicles[0].thinkAt = -1;
    },
    (v) => {
      v.serviceVehicles[0].revision = v.networkRevision + 1;
    },
    (v) => {
      v.serviceVehicles[0].id = b.id;
    },
    (v) => {
      v.buildings.find((a) => a.id === t.id).serviceEnabled = true;
    },
    (v) => {
      v.buildings.find((a) => a.id === b.id).serviceEnabled = 'yes';
    },
  ]) {
    const value = structuredClone(raw);
    corrupt(value);
    assert.throws(() => E.load(JSON.stringify(value)));
  }
  delete raw.serviceVehicles;
  assert.throws(() => E.load(JSON.stringify(raw)));
  raw.version = 10;
  const migrated = E.load(JSON.stringify(raw));
  assert.deepEqual(migrated.serviceVehicles, []);
  assert.equal(migrated.version, E.VERSION);
  assert.deepEqual(migrated.weather, s.weather);
  assert.deepEqual(migrated.sides, s.sides);
});

test('optional ballistic projectile fields retain old saves and reject nonphysical imported values', () => {
  const s = fresh();
  const p = { x: -400, y: 2, z: 0, vx: 10, vy: 1, vz: 0, speed: 10, life: 0, maxLife: 10 };
  s.projectiles.push(p);
  assert.equal(E.load(E.save(s)).projectiles.length, 1);
  Object.assign(p, { originY: 2, gravity: 18, arc: 150 });
  assert.deepEqual(E.load(E.save(s)).projectiles, s.projectiles);
  for (const [key, value] of [
    ['originY', 'NaN'],
    ['gravity', -1],
    ['gravity', 101],
    ['gravity', '18'],
    ['arc', -1],
    ['arc', 'x'],
  ]) {
    const bad = structuredClone(s);
    bad.projectiles[0][key] = value;
    assert.throws(() => E.load(E.save(bad)));
  }
});
