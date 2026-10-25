import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { addRoad } from '../../src/game/city/roads.js';
import { dirtyNetwork } from '../../src/game/city/road-network.js';
import { damageBuilding } from '../../src/game/combat/damage.js';
import {
  SETTLEMENTS,
  settlementStatus,
  settlementHomeSide,
  updateSettlements,
} from '../../src/game/territory/settlements.js';
import {
  settlementLayout,
  activeSettlementFootprints,
  settlementComponentEnabled,
} from '../../src/game/territory/settlements.config.js';
import { playerView } from '../../src/network/perspective.js';

const near = (a, b) => assert.ok(Math.abs(a - b) < 1e-7, `${a} != ${b}`);
function fresh(coop = false) {
  const s = E.createGame(811, { mode: coop ? 'coop' : 'multiplayer' });
  s.rules.oil = false;
  for (const ai of [s.ai, ...Object.values(s.aiBySide || {})]) {
    ai.nextBuild = 1e9;
    ai.nextAttack = 1e9;
    ai.nextArmy = 1e9;
  }
  return s;
}
function link(s, side, site) {
  const hq = E.hqOf(s, side),
    p = settlementLayout(site).entrance;
  return addRoad(s, side, hq.x, hq.z - 45, p.x, p.z);
}
function claim(s, site = SETTLEMENTS[0], side = settlementHomeSide(s, site)) {
  const road = link(s, side, site);
  E.advance(s, 0.1);
  assert.equal(settlementStatus(s, site.id).owner, side);
  return {
    road,
    value: s.settlements.find((v) => v.id === site.id),
    buildings: s.buildings.filter((b) => b.settlementId === site.id),
  };
}
function ordinary(s, side, key, x, z) {
  const d = E.BUILDINGS[key],
    b = {
      id: s.nextId++,
      side,
      key,
      x,
      z,
      rotation: 0,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
      cooldown: 0,
      queue: [],
    };
  s.buildings.push(b);
  s.sides[side].purchases.building[key] = (s.sides[side].purchases.building[key] || 0) + 1;
  dirtyNetwork(s);
  return b;
}
test('eight towns have symmetric ordinary 2/3-building layouts and road-first claim creates each entity exactly once', () => {
  const s = fresh();
  const amounts = [0, 1].map((side) =>
    SETTLEMENTS.filter((d) => settlementHomeSide(s, d) === side)
      .map((d) => settlementLayout(d).components.length)
      .sort(),
  );
  assert.deepEqual(amounts[0], amounts[1]);
  assert.deepEqual(amounts[0], [2, 2, 3, 3]);
  for (const site of SETTLEMENTS) {
    const layout = settlementLayout(site);
    assert.ok(layout.components.every((b) => ['housing', 'industry'].includes(b.key)));
    assert.ok(layout.components.every((b) => E.groundHeight(b.x, b.z) < 1.2));
    assert.ok(layout.roads.every((r) => Math.hypot(r.ax - site.x, r.az - site.z) < 100));
  }
  const site = SETTLEMENTS[0],
    footprints = activeSettlementFootprints(s).length;
  const quote = E.purchaseQuote(s, 0, 'building', 'housing');
  const { value, buildings } = claim(s, site);
  assert.equal(buildings.length, 2);
  assert.equal(value.materialized, true);
  assert.equal(activeSettlementFootprints(s).length, footprints - 2);
  assert.ok(
    buildings.every((b) => b.side === 0 && b.hp === E.BUILDINGS[b.key].hp && b.progress === 1),
  );
  assert.deepEqual(
    E.purchaseQuote(s, 0, 'building', 'housing'),
    quote,
    'acquired homes do not consume paid-building ordinals',
  );
  const ids = [...value.componentIds, ...value.roadIds],
    next = s.nextId;
  E.advance(s, 4);
  assert.deepEqual([...value.componentIds, ...value.roadIds], ids);
  assert.equal(s.nextId, next);
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.settlements, s.settlements);
  assert.deepEqual(loaded.buildings, s.buildings);
});
test('town output uses ordinary health/power/upkeep/commuters exactly once; a cut stops all outpost income', () => {
  const s = fresh(),
    { road, buildings } = claim(s);
  const e = E.economy(s, 0),
    direct = buildings.reduce(
      (r, b) => {
        const o = E.buildingOutput(s, b);
        r.income += o.income;
        r.materials += o.materials;
        return r;
      },
      { income: 0, materials: 0 },
    );
  near(e.settlements.income, direct.income);
  near(e.settlements.materials, direct.materials);
  near(e.gross, 1.8 + direct.income + e.commute.income);
  near(e.materials, direct.materials);
  near(e.upkeep, E.BUILDINGS.housing.upkeep + E.BUILDINGS.industry.upkeep);
  const industry = buildings.find((b) => b.key === 'industry');
  damageBuilding(s, industry, industry.hp / 2);
  assert.ok(E.economy(s, 0).materials < e.materials);
  road.hp = 0;
  dirtyNetwork(s);
  const isolated = E.economy(s, 0);
  near(isolated.settlements.income, 0);
  near(isolated.materials, 0);
  near(isolated.commute.income, 0);
  near(isolated.gross, 1.8);
  assert.ok(buildings.every((b) => E.supplyFactor(s, b) === 0));
  road.hp = road.maxHp;
  dirtyNetwork(s);
  assert.ok(E.economy(s, 0).materials > 0);
});
test('a paid ordinary extension is built normally, shares outpost connectivity and never replaces a demolished starter', () => {
  const s = fresh(),
    site = SETTLEMENTS[0],
    { road, value } = claim(s, site);
  s.sides[0].credits = 20000;
  s.sides[0].materials = 500;
  const built = E.build(s, 0, 'housing', site.x + 35, site.z + 38);
  assert.equal(typeof built, 'object');
  assert.equal(built.settlementId, site.id);
  assert.equal(built.settlementSlot, undefined);
  assert.equal(built.progress, 0);
  E.advance(s, 18.1);
  assert.equal(built.progress, 1);
  assert.equal(E.supplyFactor(s, built), 1);
  const status = settlementStatus(s, site.id);
  assert.deepEqual(status.expansionIds, [built.id]);
  near(status.income, E.economy(s, 0).settlements.income);
  const starter = s.buildings.find((b) => b.id === value.componentIds[0]);
  assert.equal(E.demolish(s, starter.id, 0), true);
  const loaded = E.load(E.save(s));
  E.advance(loaded, 1);
  assert.equal(loaded.buildings.find((b) => b.id === starter.id).demolished, true);
  assert.equal(loaded.buildings.filter((b) => b.settlementId === site.id).length, 3);
  road.hp = 0;
  dirtyNetwork(s);
  assert.equal(E.supplyFactor(s, built), 0);
  assert.equal(E.buildingOutput(s, built).income, 0);
});
test('ordinary damage, paid repair and demolition survive enemy conquest without rebuilding or restoring hp', () => {
  const s = fresh(),
    site = SETTLEMENTS[0],
    { value, buildings } = claim(s, site);
  const home = buildings.find((b) => b.key === 'housing'),
    industry = buildings.find((b) => b.key === 'industry');
  damageBuilding(s, home, 80);
  const credits = s.sides[0].credits;
  assert.equal(E.repair(s, home.id, 0), true);
  assert.ok(s.sides[0].credits < credits);
  E.advance(s, 1);
  near(home.hp, 172);
  home.repairing = false;
  damageBuilding(s, industry, industry.maxHp + 1);
  assert.equal(industry.hp, 0);
  assert.equal(typeof E.repair(s, industry.id, 0), 'string');
  assert.equal(E.demolish(s, industry.id, 0), true);
  const ids = [...value.componentIds],
    roads = [...value.roadIds],
    before = s.buildings.length;
  const enemy = E.makeGround(s, 1, 'infantry', site.x, site.z);
  enemy.holdFire = true;
  enemy.autoDefense = false;
  s.groundUnits.push(enemy);
  E.advance(s, 36);
  assert.equal(value.owner, 1);
  assert.deepEqual(value.componentIds, ids);
  assert.equal(s.buildings.length, before);
  assert.equal(home.side, 1);
  near(home.hp, 172);
  assert.equal(industry.side, 1);
  assert.equal(industry.hp, 0);
  assert.equal(industry.demolished, true);
  assert.deepEqual(value.roadIds, roads);
  const loaded = E.load(E.save(s));
  E.advance(loaded, 2);
  assert.equal(loaded.buildings.find((b) => b.id === industry.id).hp, 0);
  assert.equal(loaded.buildings.filter((b) => b.settlementId === site.id).length, 2);
});
test('an actually launched hostile drone damages the acquired ordinary house', () => {
  const s = fresh(),
    { buildings } = claim(s),
    home = buildings.find((b) => b.key === 'housing');
  const launcher = ordinary(s, 1, 'launcher', home.x + 230, home.z + 100);
  E.initLaunchStore(launcher);
  launcher.launchStore.drone = 1;
  assert.equal(E.launch(s, 1, 'drone', home.id, 1, launcher.id), 1);
  E.advance(s, 25);
  assert.ok(home.hp < home.maxHp);
  assert.ok(s.stats.impacts > 0);
});
test('the existing city service physically reaches a damaged town house and charges only actual repaired HP', () => {
  const s = fresh(),
    site = SETTLEMENTS[0],
    { buildings } = claim(s, site),
    home = buildings.find((b) => b.key === 'housing');
  ordinary(s, 0, 'service', site.x - 80, site.z + 70);
  damageBuilding(s, home, 120);
  const credits = s.sides[0].credits,
    materials = s.sides[0].materials;
  let income = 0,
    metal = 0,
    dispatched = false,
    moved = false,
    origin = null;
  for (let t = 0; t < 15; t += 0.05) {
    const rate = E.economy(s, 0);
    income += rate.net * 0.05;
    metal += rate.materials * 0.05;
    E.step(s, 0.05);
    const van = s.serviceVehicles.find((v) => v.target?.id === home.id);
    if (van) {
      dispatched = true;
      origin ??= { x: van.x, z: van.z };
      moved ||= Math.hypot(van.x - origin.x, van.z - origin.z) > 5;
    }
  }
  assert.equal(dispatched, true);
  assert.equal(moved, true);
  assert.equal(home.hp, home.maxHp);
  near(credits + income - s.sides[0].credits, 120 * E.BUILDINGS.service.service.creditsPerHp);
  near(materials + metal - s.sides[0].materials, 120 * E.BUILDINGS.service.service.materialsPerHp);
});
test('v17 migration clears only conflicting new components, keeps paid buildings/roads/unit and old mask intact', () => {
  const s = fresh(),
    site = SETTLEMENTS[0],
    components = settlementLayout(site).components;
  s.version = 17;
  delete s.settlementLayoutMask;
  for (const value of s.settlements) {
    delete value.materialized;
    delete value.componentIds;
    delete value.roadIds;
  }
  const paid = ordinary(s, 0, 'housing', components[0].x, components[0].z);
  paid.hp = 123;
  const unit = E.makeGround(s, 0, 'infantry', components[1].x, components[1].z);
  unit.holdFire = true;
  unit.autoDefense = false;
  s.groundUnits.push(unit);
  const before = structuredClone({
    buildings: s.buildings,
    roads: s.roads,
    ground: s.groundUnits,
    sides: s.sides,
    nextId: s.nextId,
  });
  const loaded = E.load(E.save(s));
  assert.equal(loaded.version, E.VERSION);
  assert.equal(loaded.settlementHouseMask, 65535);
  assert.equal(settlementComponentEnabled(loaded, site, 0), false);
  assert.equal(settlementComponentEnabled(loaded, site, 1), false);
  assert.deepEqual(
    {
      buildings: loaded.buildings,
      roads: loaded.roads,
      ground: loaded.groundUnits,
      sides: loaded.sides,
      nextId: loaded.nextId,
    },
    before,
  );
  assert.equal(E.walkable(loaded, unit.x, unit.z, 2), true);
  const again = E.load(E.save(loaded));
  assert.equal(again.settlementLayoutMask, loaded.settlementLayoutMask);
  assert.deepEqual(again.buildings, loaded.buildings);
});
test('legacy field delivery keeps paid cargo and exact position instead of becoming trapped under a larger town building', () => {
  const s = fresh(),
    component = settlementLayout(SETTLEMENTS[1]).components[2];
  ordinary(s, 0, 'ammofactory', -1080, -80);
  E.updateAmmoLogistics(s, 0.05);
  const van = s.ammoVehicles[0];
  assert.ok(van);
  Object.assign(van, {
    x: component.x,
    z: component.z,
    y: E.groundHeight(component.x, component.z) + 1,
    status: 'returning',
    cargo: { kind: 'ammo', key: 'small', amount: 7 },
    path: [],
    goal: { ...van.home },
    targetId: null,
    targetKind: null,
  });
  s.version = 17;
  for (const value of s.settlements) {
    delete value.materialized;
    delete value.componentIds;
    delete value.roadIds;
  }
  delete s.settlementLayoutMask;
  const snapshot = structuredClone(van);
  const loaded = E.load(E.save(s)),
    same = loaded.ammoVehicles.find((v) => v.id === van.id);
  assert.deepEqual(same, snapshot);
  assert.equal(settlementComponentEnabled(loaded, SETTLEMENTS[1], 2), false);
  assert.equal(E.walkable(loaded, same.x, same.z, 3), true);
});
test('strict current loading rejects missing/duplicated/foreign components, forged markers and layout masks', () => {
  const s = fresh();
  claim(s);
  const unrelated = ordinary(s, 1, 'housing', E.HQ_X + 70, 70);
  for (const mutate of [
    (v) => (v.settlementLayoutMask = 16777216),
    (v) => v.settlements[0].componentIds.pop(),
    (v) => (v.settlements[0].componentIds[1] = v.settlements[0].componentIds[0]),
    (v) => (v.buildings.find((b) => b.settlementSlot === 0).side = 1),
    (v) => (v.buildings.find((b) => b.settlementSlot === 0).maxHp = 1e9),
    (v) => (v.buildings[0].settlementId = 'constructor'),
    (v) => (v.buildings[0].settlementId = SETTLEMENTS[0].id),
    (v) => (v.buildings.find((b) => b.id === unrelated.id).settlementId = SETTLEMENTS[0].id),
    (v) => (v.buildings.find((b) => b.settlementSlot === 0).settlementSlot = '0'),
    (v) => (v.roads[0].settlementId = SETTLEMENTS[0].id),
    (v) => (v.settlements[0].materialized = false),
  ]) {
    const value = JSON.parse(E.save(s));
    mutate(value);
    assert.throws(() => E.load(JSON.stringify(value)));
  }
});
test('coop home ownership cannot be stolen by ally; read-only four-perspective status keeps identities and damage', () => {
  const s = fresh(true);
  for (const site of SETTLEMENTS) claim(s, site);
  const site = SETTLEMENTS[0],
    value = s.settlements[0],
    ids = [...value.componentIds];
  link(s, 2, site);
  E.advance(s, 1.2);
  assert.equal(value.owner, 0);
  assert.deepEqual(value.componentIds, ids);
  const b = s.buildings.find((v) => v.id === ids[0]);
  damageBuilding(s, b, 50);
  for (let side = 0; side < 4; side++) {
    const view = playerView(s, side),
      status = settlementStatus(view, site.id);
    assert.deepEqual(status.componentIds, ids);
    assert.equal(status.components[0].hp, b.hp);
    assert.ok(status.components.every((component) => component.id > 0));
    assert.equal(view.sides[0].credits, s.sides[side].credits);
    assert.ok(view.sides.slice(1).every((f) => f.credits === 0));
  }
});
test('pause/endgame never materialize a connected town; resumed physical state continues identically after load', () => {
  const s = fresh(),
    site = SETTLEMENTS[0];
  link(s, 0, site);
  const ids = s.nextId,
    buildings = s.buildings.length;
  s.paused = true;
  updateSettlements(s, 10);
  assert.equal(s.nextId, ids);
  assert.equal(s.buildings.length, buildings);
  s.paused = false;
  s.result = 'victory';
  updateSettlements(s, 10);
  assert.equal(s.nextId, ids);
  s.result = null;
  E.advance(s, 0.1);
  damageBuilding(
    s,
    s.buildings.find((b) => b.settlementSlot === 0),
    40,
  );
  const loaded = E.load(E.save(s));
  E.advance(s, 1.7);
  E.advance(loaded, 1.7);
  assert.deepEqual(loaded.settlements, s.settlements);
  assert.deepEqual(loaded.buildings, s.buildings);
  assert.deepEqual(loaded.sides, s.sides);
});
