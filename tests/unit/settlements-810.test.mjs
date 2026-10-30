import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { toV22Layout } from '../support/v22-layout.mjs';
import {
  SETTLEMENTS,
  createSettlements,
  settlementHomeSide,
  settlementStatus,
  settlementIncome,
  updateSettlements,
  restoreSettlements,
} from '../../src/game/territory/settlements.js';
import { restoreDistricts } from '../../src/game/territory/persistence.js';
import { addRoad } from '../../src/game/city/roads.js';
import { dirtyNetwork } from '../../src/game/city/road-network.js';
import { updateOil } from '../../src/game/city/oil.js';
import { playerView } from '../../src/network/perspective.js';
import {
  SETTLEMENT_FOOTPRINTS,
  activeSettlementFootprints,
  settlementHouseEnabled,
  settlementLayout,
  SETTLEMENT_COMPONENTS,
} from '../../src/game/territory/settlements.config.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function fresh(coop = false) {
  const s = E.createGame(810, { mode: coop ? 'coop' : 'multiplayer' });
  s.rules.oil = false;
  s.settlements ??= createSettlements();
  s.settlementClock ??= { next: 0, elapsed: 0 };
  for (const ai of [s.ai, ...Object.values(s.aiBySide || {})]) {
    ai.nextBuild = 1e9;
    ai.nextAttack = 1e9;
  }
  return s;
}
function link(s, side, d) {
  const hq = s.buildings.find((b) => b.side === side && b.key === 'hq');
  const entrance = settlementLayout(d).entrance;
  return addRoad(s, side, hq.x, hq.z - 45, entrance.x, entrance.z);
}
function foot(s, side, d, key = 'infantry') {
  const u = E.makeGround(s, side, key, d.x, d.z);
  u.holdFire = true;
  u.autoDefense = false;
  // These are deliberate local occupants, not idle bot recruits volunteering
  // for a new post on their own city's front.
  u.guard = { x: d.x, z: d.z };
  u.order = { ...u.guard, mode: 'guard' };
  s.groundUnits.push(u);
  return u;
}
function tick(s, seconds) {
  E.advance(s, seconds);
  return s;
}
function paidRoadPath(s, side, d) {
  const camp = s.roads.filter((r) => r.side === side && !r.connectorTo).at(-1);
  const start = { x: camp.bx, z: camp.bz },
    goal = settlementLayout(d).entrance;
  const nodes = [{ ...start, parent: -1 }],
    seen = new Set(['0,0']);
  for (let cursor = 0; cursor < nodes.length && nodes.length < 6000; cursor++) {
    const p = nodes[cursor];
    if (
      Math.hypot(p.x - goal.x, p.z - goal.z) <= 120 &&
      !E.roadPreview(s, side, p.x, p.z, goal.x, goal.z).error
    ) {
      const result = [goal];
      for (let i = cursor; i >= 0; i = nodes[i].parent)
        result.push({ x: nodes[i].x, z: nodes[i].z });
      return result.reverse();
    }
    for (const [dx, dz] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ]) {
      const x = p.x + dx * 80,
        z = p.z + dz * 80,
        key = `${x},${z}`;
      if (seen.has(key) || Math.abs(x) > E.FIELD.x || Math.abs(z) > E.FIELD.z) continue;
      if (E.roadPreview(s, side, p.x, p.z, x, z).error) continue;
      seen.add(key);
      nodes.push({ x, z, parent: cursor });
    }
  }
  return null;
}

test('two central depots and eight balanced road villages are dry and initially neutral', () => {
  const s = fresh();
  assert.equal(E.DISTRICTS.length, 2);
  assert.deepEqual(
    E.DISTRICTS.map((d) => [d.id, d.x, d.z]),
    [
      ['north-depot', 0, -1360],
      ['south-depot', 0, 1360],
    ],
  );
  assert.equal(SETTLEMENTS.length, 8);
  assert.equal(s.settlements.length, 8);
  for (const d of SETTLEMENTS) {
    assert.ok(E.seaDistance(d.x, d.z) > 0);
    assert.ok(E.groundHeight(d.x, d.z) < 1.2);
    assert.equal(settlementStatus(s, d.id).owner, null);
  }
  assert.deepEqual(
    [0, 1].map((side) => SETTLEMENTS.filter((d) => settlementHomeSide(s, d) === side).length),
    [4, 4],
  );
  assert.deepEqual(settlementIncome(s, 0), {
    income: 0,
    materials: 0,
    owned: 0,
    active: 0,
    isolated: 0,
    blocked: 0,
  });
  assert.equal(
    s.buildings.some((b) => b.side === -1),
    false,
  );
});
test('a disconnected road near a village pays nothing; its actual HQ link activates without infantry', () => {
  const s = fresh(),
    d = SETTLEMENTS[0];
  const entrance = settlementLayout(d).entrance;
  const endpoint = addRoad(s, 0, entrance.x - 40, entrance.z, entrance.x + 40, entrance.z);
  tick(s, 1.1);
  assert.equal(settlementStatus(s, d.id).owner, null);
  const hq = s.buildings.find((b) => b.side === 0);
  addRoad(s, 0, hq.x, hq.z - 45, endpoint.ax, endpoint.az);
  tick(s, 0.1);
  const status = settlementStatus(s, d.id);
  assert.equal(status.owner, 0);
  assert.equal(status.reason, 'active');
  const rate = E.economy(s, 0);
  assert.ok(rate.settlements.income > 0);
  assert.ok(rate.settlements.materials > 0);
  const before = structuredClone(s.sides[0]);
  tick(s, 4);
  assert.ok(s.sides[0].credits > before.credits);
  near(s.sides[0].materials - before.materials, rate.materials * 4);
  assert.equal(s.events.filter((e) => e.type === 'settlementConnected').length, 1);
});
test('all eight villages can be reached using real legal paid road segments from the proper solo city', () => {
  for (const d of SETTLEMENTS) {
    const s = fresh(),
      side = settlementHomeSide(s, d);
    s.sides[side].credits = 100000;
    const route = paidRoadPath(s, side, d);
    assert.ok(route, `no legal road approach: ${d.id}`);
    const money = s.sides[side].credits;
    let expected = 0;
    for (let i = 1; i < route.length; i++) {
      const a = route[i - 1],
        b = route[i],
        preview = E.roadPreview(s, side, a.x, a.z, b.x, b.z);
      assert.equal(preview.error, undefined, `${d.id}: ${preview.error}`);
      expected += preview.cost;
      assert.equal(typeof E.buildRoad(s, side, a.x, a.z, b.x, b.z), 'object');
    }
    near(money - s.sides[side].credits, expected);
    assert.ok(expected > 100);
    tick(s, 0.1);
    assert.equal(settlementStatus(s, d.id).active, true, d.id);
    assert.equal(settlementStatus(s, d.id).owner, side);
  }
});
test('road destruction stops income immediately, retains ownership and restoring the same road resumes it', () => {
  const s = fresh(),
    d = SETTLEMENTS[0],
    r = link(s, 0, d);
  tick(s, 0.1);
  assert.equal(settlementIncome(s, 0).active, 1);
  r.hp = 0;
  dirtyNetwork(s);
  assert.equal(settlementStatus(s, d.id).reason, 'road');
  assert.equal(settlementIncome(s, 0).active, 0);
  assert.equal(settlementStatus(s, d.id).owner, 0);
  const metal = s.sides[0].materials;
  tick(s, 2);
  near(s.sides[0].materials, metal);
  r.hp = r.maxHp;
  dirtyNetwork(s);
  assert.equal(settlementIncome(s, 0).active, 1);
  const resumed = E.economy(s, 0).materials;
  tick(s, 2);
  near(s.sides[0].materials - metal, resumed * 2);
});
test('all four cities get their nearest two villages; allied roads cannot steal a live owner even after a break', () => {
  const s = fresh(true);
  assert.equal(s.sides.length, 4);
  for (const d of SETTLEMENTS) link(s, settlementHomeSide(s, d), d);
  tick(s, 0.1);
  for (let side = 0; side < 4; side++) {
    assert.equal(settlementIncome(s, side).active, 2);
    assert.ok(settlementIncome(s, side).income > 0);
    near(
      settlementIncome(s, side).income,
      (settlementIncome(s, 0).income / E.economy(s, 0).bonus) * E.economy(s, side).bonus,
    );
  }
  const d = SETTLEMENTS[0],
    value = s.settlements.find((v) => v.id === d.id);
  link(s, 2, d);
  tick(s, 1.1);
  assert.equal(value.owner, 0);
  for (const r of s.roads) if (r.side === 0) r.hp = 0;
  dirtyNetwork(s);
  tick(s, 1.1);
  assert.equal(value.owner, 0);
  assert.equal(settlementStatus(s, d.id).active, false);
  s.buildings.find((b) => b.key === 'hq' && b.side === 0).hp = 0;
  dirtyNetwork(s);
  tick(s, 1.1);
  assert.equal(value.owner, 2);
  assert.equal(settlementStatus(s, d.id).active, true);
});
test('each of four network perspectives derives home villages from the actual HQ positions after side reorder', () => {
  const s = fresh(true);
  for (const d of SETTLEMENTS) link(s, settlementHomeSide(s, d), d);
  tick(s, 0.1);
  for (let viewer = 0; viewer < 4; viewer++) {
    const view = playerView(s, viewer),
      authorityHQ = s.buildings.find((b) => b.key === 'hq' && b.side === viewer);
    for (const d of SETTLEMENTS) {
      const status = settlementStatus(view, d.id),
        isOwn =
          Math.sign(authorityHQ.x) === Math.sign(d.x) &&
          Math.sign(authorityHQ.z) === Math.sign(d.z);
      assert.equal(status.homeSide === 0, isOwn, `viewer${viewer} ${d.id}`);
      assert.equal(status.owner === 0, isOwn);
      assert.equal(status.active, true);
    }
  }
});
test('hostile vehicles suppress output but infantry must neutralize then capture; a road is still needed after conquest', () => {
  const s = fresh(),
    d = SETTLEMENTS[0];
  link(s, 0, d);
  tick(s, 0.1);
  const tank = foot(s, 1, d, 'leopard');
  tick(s, 2);
  assert.equal(settlementStatus(s, d.id).owner, 0);
  assert.equal(settlementStatus(s, d.id).reason, 'hostile');
  assert.equal(settlementIncome(s, 0).income, 0);
  tank.hp = 0;
  const infantry = foot(s, 1, d);
  tick(s, 10);
  assert.equal(settlementStatus(s, d.id).owner, 0);
  tick(s, 3);
  assert.equal(settlementStatus(s, d.id).owner, null);
  tick(s, 23);
  assert.equal(settlementStatus(s, d.id).owner, 1);
  assert.equal(settlementStatus(s, d.id).reason, 'road');
  assert.equal(settlementIncome(s, 1).income, 0);
  link(s, 1, d);
  tick(s, 0.1);
  assert.equal(settlementStatus(s, d.id).active, true);
  assert.equal(infantry.hp, E.GROUND_UNITS.infantry.hp);
});
test('allies do not contest each other, enemy presence freezes capture and loaded passengers never capture', () => {
  const s = fresh(true),
    d = SETTLEMENTS[0];
  link(s, 0, d);
  tick(s, 0.1);
  foot(s, 0, d);
  foot(s, 2, d);
  tick(s, 1.1);
  assert.equal(settlementStatus(s, d.id).contested, false);
  assert.equal(settlementStatus(s, d.id).active, true);
  const enemy = foot(s, 3, d);
  tick(s, 2);
  assert.equal(settlementStatus(s, d.id).contested, true);
  near(settlementStatus(s, d.id).control, 1);
  for (const u of s.groundUnits) if (u.side % 2 === 0) u.hp = 0;
  const apc = foot(s, 3, d, 'apc');
  enemy.carrierId = apc.id;
  tick(s, 14);
  assert.equal(settlementStatus(s, d.id).owner, 0);
  near(settlementStatus(s, d.id).control, 1);
});
test('pause/endgame do not progress settlement capture or spend any resources', () => {
  const s = fresh(),
    d = SETTLEMENTS[0];
  link(s, 0, d);
  tick(s, 0.1);
  foot(s, 1, d);
  tick(s, 2);
  const before = structuredClone(s.settlements),
    money = s.sides.map((f) => [f.credits, f.materials]);
  s.paused = true;
  updateSettlements(s, 10);
  assert.deepEqual(s.settlements, before);
  s.paused = false;
  s.result = 'victory';
  updateSettlements(s, 10);
  assert.deepEqual(s.settlements, before);
  assert.deepEqual(
    s.sides.map((f) => [f.credits, f.materials]),
    money,
  );
});
test('a contested village freezes partially neutralized control instead of repairing it behind both armies', () => {
  const s = fresh(),
    d = SETTLEMENTS[0];
  link(s, 0, d);
  tick(s, 0.1);
  foot(s, 1, d);
  tick(s, 4);
  const partial = settlementStatus(s, d.id).control;
  assert.ok(partial > 0 && partial < 1);
  foot(s, 0, d);
  tick(s, 5);
  assert.equal(settlementStatus(s, d.id).contested, true);
  near(settlementStatus(s, d.id).control, partial);
});
test('save/load mid-capture retains the cadence, ownership, paid city and exact continuation', () => {
  const s = fresh(),
    d = SETTLEMENTS[0];
  link(s, 0, d);
  tick(s, 0.1);
  foot(s, 1, d);
  tick(s, 5.35);
  const restored = E.load(E.save(s));
  assert.deepEqual(restored.settlements, s.settlements);
  assert.deepEqual(restored.settlementClock, s.settlementClock);
  tick(s, 3.4);
  tick(restored, 3.4);
  assert.deepEqual(restored.settlements, s.settlements);
  assert.deepEqual(restored.settlementClock, s.settlementClock);
  assert.deepEqual(restored.sides, s.sides);
});
test('settlement imports whitelist configuration and reject invalid owner, duplicate ids and clocks', () => {
  const s = fresh();
  s.settlements[0].income = 1e9;
  s.settlements[0].x = 0;
  s.settlements[0].name = 'forged';
  restoreSettlements(s);
  assert.equal('income' in s.settlements[0], false);
  assert.equal(settlementStatus(s, SETTLEMENTS[0].id).x, SETTLEMENTS[0].x);
  for (const mutate of [
    (s) => {
      s.settlements[0].owner = 4;
    },
    (s) => {
      s.settlements[0].id = 'constructor';
    },
    (s) => {
      s.settlements[1].id = s.settlements[0].id;
    },
    (s) => {
      s.settlements[0].control = NaN;
    },
    (s) => {
      s.settlementClock.elapsed = 2;
    },
  ]) {
    const bad = fresh();
    mutate(bad);
    assert.throws(() => restoreSettlements(bad));
  }
});
test('four v16 districts merge by corridor without city or treasury changes, conflicting owners become neutral exactly once', () => {
  const s = fresh();
  s.version = 16;
  s.districts = ['north-depot', 'north-relay', 'south-relay', 'south-depot'].map((id, i) => ({
    id,
    owner: i < 2 ? 0 : i === 2 ? 0 : 1,
    control: i < 3 ? 1 : -1,
    capturing: null,
    contested: false,
    blocked: false,
    hp: id.endsWith('depot') ? 180 : 150,
    repairing: false,
  }));
  const city = structuredClone({
    buildings: s.buildings,
    roads: s.roads,
    sides: s.sides,
    nextId: s.nextId,
  });
  restoreDistricts(s, 16);
  assert.equal(s.districts.length, 2);
  assert.deepEqual(
    s.districts.map((d) => [d.owner, d.hp]),
    [
      [0, 180],
      [null, 180],
    ],
  );
  assert.deepEqual(
    { buildings: s.buildings, roads: s.roads, sides: s.sides, nextId: s.nextId },
    city,
  );
  const before = structuredClone(s.districts);
  restoreDistricts(s, 17);
  assert.deepEqual(s.districts, before);
});
test('four-side depot capture sums allied infantry but ownership and repair costs remain per city', () => {
  const s = fresh(true),
    d = E.DISTRICTS[0];
  foot(s, 2, d);
  foot(s, 0, d);
  tick(s, 18);
  assert.equal(s.districts[0].owner, 0);
  assert.equal(E.districtIncome(s, 0).outputBonus, 0.15);
  assert.equal(E.districtIncome(s, 2).outputBonus, 0);
  const other = fresh(true);
  foot(other, 3, d);
  tick(other, 23);
  assert.equal(other.districts[0].owner, 3);
  assert.equal(other.districts[0].control, -1);
  assert.equal(E.districtIncome(other, 3).active, 1);
  assert.equal(E.districtIncome(other, 1).active, 0);
});
test('a city-to-depot march takes its physical route, stays on land and captures within its travel budget on either bank', () => {
  for (const side of [0, 1]) {
    const s = fresh(),
      d = E.DISTRICTS[side],
      u = foot(s, side, { x: side ? 1092 : -1092, z: side ? 200 : -200 });
    const start = { x: u.x, z: u.z };
    assert.equal(E.captureDistrict(s, side, [u.id], d.id), 1);
    let length = 0,
      previous = start;
    for (const point of u.path) {
      const distance = Math.hypot(point.x - previous.x, point.z - previous.z);
      length += distance;
      for (let step = 0; step <= Math.ceil(distance / 4); step++) {
        const t = step / Math.max(1, Math.ceil(distance / 4));
        assert.ok(
          E.walkable(
            s,
            previous.x + (point.x - previous.x) * t,
            previous.z + (point.z - previous.z) * t,
            2,
          ),
        );
      }
      previous = point;
    }
    assert.ok(length > 1400);
    const speed = E.GROUND_UNITS.infantry.speed;
    tick(s, 4);
    assert.ok(Math.hypot(u.x - start.x, u.z - start.z) <= speed * 4 + 1);
    assert.equal(s.districts[side].owner, null);
    tick(s, length / speed + E.DISTRICT_RULES.captureSeconds + 5 - 4);
    assert.equal(s.districts[side].owner, side);
    assert.equal(s.events.filter((e) => e.type === 'districtCaptured').length, 1);
  }
});
test('depot percentage boosts only its owner output once, leaves upkeep fixed, and damaged or blocked sites lose the appropriate bonus', () => {
  const s = fresh(true),
    side = 2,
    hq = s.buildings.find((b) => b.key === 'hq' && b.side === side);
  for (const [key, x, z] of [
    ['industry', hq.x + 70, hq.z + 70],
    ['oilwell', hq.x - 80, hq.z + 60],
  ]) {
    const d = E.BUILDINGS[key],
      b = {
        id: s.nextId++,
        key,
        side,
        x,
        z,
        hp: d.hp,
        maxHp: d.hp,
        progress: 1,
        cooldown: 0,
        rotation: 0,
      };
    s.buildings.push(b);
    addRoad(s, side, hq.x, hq.z - 45, x, z);
  }
  const base = E.economy(s, side),
    ally = E.economy(s, 0),
    rawOil = E.oilProduction(s, side, base.productivity);
  Object.assign(s.districts[0], { owner: side, control: 1 });
  let rates = E.economy(s, side);
  near(rates.gross, base.gross * 1.15 + 0.5);
  near(rates.materials, base.materials * 1.15 + 0.1);
  near(rates.upkeep, base.upkeep);
  near(E.economy(s, 0).gross, ally.gross);
  s.sides[side].oil = 0;
  updateOil(
    s,
    s.sides.map((_, id) => E.economy(s, id)),
    1,
  );
  near(s.sides[side].oil, rawOil * 1.15);
  Object.assign(s.districts[1], { owner: side, control: 1 });
  rates = E.economy(s, side);
  near(rates.gross, base.gross * 1.3 + 1);
  near(rates.materials, base.materials * 1.3 + 0.2);
  s.districts[0].hp = E.DISTRICTS[0].hp / 2;
  rates = E.economy(s, side);
  near(rates.outputBonus, 1 + 0.15 + 0.15 * 0.675);
  s.districts[0].blocked = true;
  rates = E.economy(s, side);
  near(rates.outputBonus, 1.15);
  near(rates.materials, base.materials * 1.15 + 0.1);
});
test('v16 imports suppress houses over the paid city, road, troops and pending destinations without moving those assets', () => {
  const s = fresh(),
    houses = SETTLEMENT_FOOTPRINTS;
  s.version = 16;
  delete s.settlements;
  delete s.settlementClock;
  delete s.settlementHouseMask;
  const d = E.BUILDINGS.barracks,
    b = {
      id: s.nextId++,
      key: 'barracks',
      side: 0,
      x: houses[0].x,
      z: houses[0].z,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
      cooldown: 0,
      rotation: 0,
      rally: { x: houses[8].x, z: houses[8].z },
      armyQueue: [],
    };
  s.buildings.push(b);
  addRoad(s, 0, houses[1].x, houses[1].z - 20, houses[1].x, houses[1].z + 20);
  s.sides[0].purchases.building.barracks = 1;
  const u = foot(s, 0, houses[2]);
  u.guard = { x: houses[4].x, z: houses[4].z };
  u.order = { mode: 'move', x: houses[6].x, z: houses[6].z };
  u.path = [{ x: houses[10].x, z: houses[10].z }];
  const ready = (key, x, z) => {
    const d = E.BUILDINGS[key],
      b = {
        id: s.nextId++,
        key,
        side: 0,
        x,
        z,
        hp: d.hp,
        maxHp: d.hp,
        progress: 1,
        cooldown: 0,
        rotation: 0,
      };
    s.buildings.push(b);
    s.sides[0].purchases.building[key] = 1;
    return b;
  };
  const station = ready('service', -1272, -80),
    depot = ready('ammofactory', -1142, -80);
  s.serviceVehicles.push({
    id: s.nextId++,
    side: 0,
    stationId: station.id,
    x: houses[12].x,
    z: houses[12].z,
    yaw: 0,
    state: 'idle',
    target: null,
    path: [],
    roadIds: [],
    revision: s.networkRevision,
    thinkAt: 0,
    dispatchCursor: 0,
  });
  s.ammoVehicles.push({
    id: s.nextId++,
    side: 0,
    depotId: depot.id,
    slot: 0,
    x: houses[14].x,
    z: houses[14].z,
    home: { x: depot.x, z: depot.z - 30 },
    hp: E.AMMUNITION.vehicle.hp,
    maxHp: E.AMMUNITION.vehicle.hp,
    y: E.groundHeight(houses[14].x, houses[14].z) + 1,
    yaw: 0,
    path: [{ x: houses[11].x, z: houses[11].z }],
    status: 'blocked',
    targetId: u.id,
    targetKind: 'ground',
    cargo: { kind: 'ammo', key: 'small', amount: 7 },
    pickup: null,
    retryAt: 0,
    revision: s.networkRevision,
    goal: { x: houses[13].x, z: houses[13].z },
  });
  s.trenches.push({ id: s.nextId++, side: 0, x: houses[3].x, z: houses[3].z, progress: 1, yaw: 0 });
  const assets = structuredClone({
    buildings: s.buildings,
    roads: s.roads,
    ground: s.groundUnits,
    service: s.serviceVehicles,
    ammo: s.ammoVehicles,
    trenches: s.trenches,
    sides: s.sides,
    nextId: s.nextId,
  });
  const loaded = E.load(E.save(toV22Layout(s)));
  for (const index of [0, 1, 2, 3, 4, 6, 8, 10, 11, 12, 13, 14])
    assert.equal(settlementHouseEnabled(loaded, index), false, `house${index}`);
  assert.equal(settlementHouseEnabled(loaded, 15), true, 'unoccupied houses survive');
  assert.deepEqual(
    {
      buildings: loaded.buildings,
      roads: loaded.roads,
      ground: loaded.groundUnits,
      service: loaded.serviceVehicles,
      ammo: loaded.ammoVehicles,
      trenches: loaded.trenches,
      sides: loaded.sides,
      nextId: loaded.nextId,
    },
    assets,
  );
  assert.equal(E.walkable(loaded, u.x, u.z, 2), true);
  assert.equal(
    E.walkable(loaded, loaded.serviceVehicles[0].x, loaded.serviceVehicles[0].z, 3),
    true,
  );
  assert.equal(E.walkable(loaded, loaded.ammoVehicles[0].x, loaded.ammoVehicles[0].z, 3), true);
  assert.deepEqual(loaded.ammoVehicles[0].cargo, { kind: 'ammo', key: 'small', amount: 7 });
  const again = E.load(E.save(loaded));
  assert.equal(again.settlementHouseMask, loaded.settlementHouseMask);
  assert.deepEqual(again.buildings, loaded.buildings);
  assert.deepEqual(again.groundUnits, loaded.groundUnits);
  assert.deepEqual(again.serviceVehicles, loaded.serviceVehicles);
  assert.deepEqual(again.ammoVehicles, loaded.ammoVehicles);
});
test('legacy house mask remains strict while current component masks cache ordinary town footprints', () => {
  const s = fresh();
  assert.equal(s.settlementHouseMask, 65535);
  const all = activeSettlementFootprints(s);
  assert.equal(all.length, 20);
  assert.equal(activeSettlementFootprints(s), all);
  s.settlementLayoutMask &= ~1;
  const partial = activeSettlementFootprints(s);
  assert.equal(partial.length, 19);
  assert.notEqual(partial, all);
  assert.equal(activeSettlementFootprints(s), partial);
  assert.equal(partial.includes(SETTLEMENT_COMPONENTS[0]), false);
  for (const value of [undefined, null, -1, 65536, 1.5, '65535']) {
    const bad = fresh();
    bad.settlementHouseMask = value;
    assert.throws(() => E.load(E.save(bad)), /геометрия поселений/);
  }
  const empty = fresh();
  empty.settlementHouseMask = 0;
  assert.equal(E.load(E.save(empty)).settlementHouseMask, 0);
  empty.settlementLayoutMask = 0;
  assert.deepEqual(activeSettlementFootprints(empty), []);
});
