import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { updateServices } from '../../src/game/city/service.js';
import { dirtyNetwork, projectPoint } from '../../src/game/city/road-network.js';
import {
  serviceFieldRoute,
  servicePathClear,
  SERVICE_RADIUS,
} from '../../src/game/city/service-field-routes.js';

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
  const b = build(s, side, 'service', sign * (E.HQ_X + 65), -80);
  const t = build(s, side, 'housing', sign * (E.HQ_X - 55), -80);
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
  assert.match(E.canPlace(s, 'service', -700, 250), /улицей/);
  const quote = E.purchaseQuote(s, 0, 'building', 'service');
  const plan = E.placementPlan(s, 0, 'service', -1080, -80);
  const b = E.build(s, 0, 'service', -1080, -80);
  assert.equal(typeof b, 'object');
  assert.equal(before - s.sides[0].credits, quote.cost + plan.driveCost);
  assert.equal(s.sides[0].materials, 3000 - quote.metal);
  E.advance(s, 1);
  assert.equal(s.serviceVehicles.length, 0);
  E.advance(s, E.BUILDINGS.service.time);
  assert.equal(s.serviceVehicles.length, cfg.vehicles);
  assert.ok(distance(s.serviceVehicles[0], s.serviceVehicles[1]) >= 5.9);
  near(E.economy(s, 0).upkeep, E.BUILDINGS.service.upkeep);
  assert.equal(E.serviceStatus(s, 0, b.id).status, 'idle');
});

test('real simulation drives a dry field route, pays only for actual repair, then physically returns', () => {
  const { s, b, t } = town(),
    startHp = t.hp;
  let repaired = 0,
    observedTravel = false,
    observedOffRoad = false;
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
        E.walkable(s, v.x, v.z, SERVICE_RADIUS),
        'the van stays dry and outside building footprints',
      );
      if (
        !s.roads.some(
          (r) => r.side === v.side && !r.removed && projectPoint(v.x, v.z, r).distance < 1.3,
        )
      )
        observedOffRoad = true;
      previous.set(v.id, { x: v.x, z: v.z });
      if (v.state === 'outbound') observedTravel = true;
      if (delta > 0 && v.target?.id === t.id) assert.ok(distance(v, t) < E.BUILDINGS.housing.size);
    }
    if (s.time < 3) assert.equal(t.hp, startHp, 'no remote repair while driving');
  }
  near(repaired, 120);
  assert.equal(t.hp, t.maxHp);
  assert.equal(observedTravel, true);
  assert.equal(observedOffRoad, true, 'field dispatch does not require a street beneath the van');
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

test('a broken street does not block field travel, but zero materials prevents any free HP', () => {
  const { s, b, t } = town();
  E.advance(s, 0.5);
  const cut = s.roads.find((r) => r.camp && r.side === 0 && r.ax === -1045);
  E.damageRoad(s, cut, 120);
  assert.equal(E.network(s, 0).connected.length, 0);
  s.sides[0].materials = 0;
  const hp = t.hp;
  E.advance(s, 8);
  assert.equal(cut.hp, 0);
  assert.equal(t.hp, hp);
  assert.ok(
    s.serviceVehicles.some((v) => v.x > cut.ax),
    'a broken street is not an impassable field barrier',
  );
  assert.ok(s.serviceVehicles.some((v) => v.target?.id === cut.id));
  assert.ok(E.supplyFactor(s, b) < 1, 'ordinary HQ supply penalties remain');
  s.sides[0].materials = 3000;
  E.advance(s, 35);
  assert.equal(cut.hp, cut.maxHp);
  assert.equal(cut.blocked, false);
  assert.equal(t.hp, t.maxHp);
  assert.equal(E.supplyFactor(s, b), 1);
});

test('a removed street is never reconstructed while a house beyond the gap is repaired over the field', () => {
  const { s, t } = town();
  const gap = s.roads.find((r) => r.camp && r.side === 0 && r.ax === -1045);
  gap.removed = true;
  gap.hp = 0;
  dirtyNetwork(s);
  E.advance(s, 30);
  assert.equal(t.hp, t.maxHp);
  assert.equal(gap.hp, 0);
  assert.equal(gap.removed, true);
});

test('removing all streets leaves field crews active and keeps their bounded dispatch cadence', () => {
  const { s, b, t } = town();
  E.advance(s, 2);
  for (const r of s.roads) if (r.side === 0) r.removed = true;
  dirtyNetwork(s);
  const hp = t.hp;
  E.advance(s, 0.05);
  assert.equal(E.serviceStatus(s, 0, b.id).status, 'active');
  assert.ok(s.serviceVehicles.some((v) => v.state === 'outbound' && v.path.length));
  const positions = s.serviceVehicles.map((v) => ({ x: v.x, z: v.z }));
  const schedule = s.serviceVehicles.map((v) => v.thinkAt);
  E.advance(s, 0.2);
  assert.deepEqual(
    s.serviceVehicles.map((v) => v.thinkAt),
    schedule,
  );
  assert.ok(s.serviceVehicles.some((v, i) => distance(v, positions[i]) > 0));
  assert.ok(s.serviceVehicles.every((v) => v.revision === s.networkRevision));
  assert.equal(t.hp, hp);
  E.advance(s, 30);
  assert.equal(t.hp, t.maxHp);
});

test('storms slow the same physical field journey without disabling or replacing the fleet', () => {
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
  const enemy = build(s, 1, 'launcher', -960, 80);
  enemy.hp -= 50;
  const unfinished = E.build(s, 0, 'launcher', -850, 80);
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

test('the field route bends around a building and every travelled segment stays outside its walls', () => {
  const s = fresh();
  const from = { x: -1050, z: 250 },
    target = { ax: -850, az: 250, bx: -850, bz: 250 },
    oldRoute = serviceFieldRoute(s, from, target, 'road');
  assert.ok(servicePathClear(s, from, oldRoute.path));
  const obstacle = build(s, 0, 'launcher', -950, 250);
  assert.equal(
    servicePathClear(s, from, oldRoute.path),
    false,
    'a new building must invalidate a previously dry straight leg',
  );
  const route = serviceFieldRoute(s, from, target, 'road');
  assert.ok(route);
  assert.ok(route.cost > 200);
  let previous = from;
  for (const point of route.path) {
    const length = distance(previous, point);
    for (let i = 0; i <= Math.ceil(length); i++) {
      const fraction = i / Math.max(1, Math.ceil(length));
      const x = previous.x + (point.x - previous.x) * fraction,
        z = previous.z + (point.z - previous.z) * fraction;
      assert.ok(
        E.walkable(s, x, z, SERVICE_RADIUS),
        `route clips obstacle #${obstacle.id} at ${x},${z}`,
      );
    }
    previous = point;
  }
  assert.deepEqual(route.path.at(-1), { x: -850, z: 250 });
});

test('fleet limits are configured, shared per owner and independent between multiplayer sides', () => {
  const s = fresh();
  for (const side of [0, 1]) {
    const first = build(s, side, 'service', side ? 1080 : -1080, -80);
    for (let i = 0; i < 4; i++) s.buildings.push({ ...first, id: s.nextId++ });
    s.sides[side].purchases.building.service = 5;
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

function waterJobs(s, count) {
  const template = s.roads.find((r) => r.side === 0);
  return Array.from({ length: count }, (_, i) => {
    const road = {
      ...template,
      id: s.nextId++,
      ax: -500,
      bx: -450,
      az: -150 + i * 50,
      bz: -150 + i * 50,
      hp: 0,
      blocked: true,
      removed: false,
      connectorTo: null,
    };
    s.roads.push(road);
    return road;
  });
}

test('an unreachable water target is never remotely repaired and blocked crews retry only on cadence', () => {
  const { s, b, t } = town();
  t.hp = t.maxHp;
  const [water] = waterJobs(s, 1);
  assert.equal(serviceFieldRoute(s, b, water, 'road'), null);
  serviceTime(s, 0.05);
  assert.equal(E.serviceStatus(s, 0, b.id).status, 'blocked');
  const snapshot = structuredClone(s.serviceVehicles),
    credits = s.sides[0].credits;
  serviceTime(s, 0.2);
  assert.deepEqual(s.serviceVehicles, snapshot);
  serviceTime(s, cfg.cadence);
  assert.ok(s.serviceVehicles.every((v, i) => v.thinkAt > snapshot[i].thinkAt));
  assert.equal(water.hp, 0);
  assert.equal(s.sides[0].credits, credits);
});

test('six closer unreachable jobs cannot starve a farther reachable house', () => {
  const { s, t } = town();
  t.x = -1800;
  t.z = 700;
  const unreachable = waterJobs(s, 6);
  dirtyNetwork(s);
  serviceTime(s, 0.05);
  assert.ok(s.serviceVehicles.every((v) => v.state === 'blocked' && v.dispatchCursor === 6));
  const saved = E.load(E.save(s));
  assert.ok(
    saved.serviceVehicles.every((v) => v.dispatchCursor === 6),
    'dispatch fairness cursor survives save/load',
  );
  serviceTime(s, cfg.cadence + 0.05);
  assert.ok(s.serviceVehicles.some((v) => v.target?.id === t.id && v.state === 'outbound'));
  serviceTime(s, 100);
  assert.equal(t.hp, t.maxHp);
  assert.ok(unreachable.every((r) => r.hp === 0));
});

test('either owner saves mid-drive and mid-repair and continues the same actual journey and charges', () => {
  for (const side of [0, 1])
    for (const elapsed of [2, 7]) {
      const { s, b } = town(side);
      E.advance(s, elapsed);
      const loaded = E.load(E.save(s));
      assert.deepEqual(loaded.serviceVehicles, s.serviceVehicles);
      // Loading invalidates graph caches, represented by networkRevision+1.
      const fleet = (state) =>
        state.serviceVehicles.map(({ revision, ...v }) => ({
          ...v,
          revision: revision - state.networkRevision,
        }));
      for (let tick = 0; tick < 600; tick++) {
        E.step(s, 0.05);
        E.step(loaded, 0.05);
        assert.deepEqual(
          fleet(loaded),
          fleet(s),
          `owner ${side}, saved at ${elapsed}s, tick ${tick}`,
        );
        assert.deepEqual(
          loaded.sides,
          s.sides,
          'load must preserve repair timing and income each tick',
        );
      }
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
      v.serviceVehicles[0].x = E.FIELD * 2;
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
  const p = { x: -800, y: 2, z: 0, vx: 10, vy: 1, vz: 0, speed: 10, life: 0, maxLife: 10 };
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
