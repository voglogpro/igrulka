import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { addRoad } from '../../src/game/city/roads.js';
import { applyBlast, damageBuilding } from '../../src/game/combat/damage.js';
import { playerView, snapshotPlayerView } from '../../src/network/perspective.js';
import { createSnapshotEncoder, createSnapshotDecoder } from '../../src/network/snapshots.js';
import { depositFieldAmmo } from '../../src/game/city/field-ammo.js';
const sum = (s) =>
  s.sides[0].ammoStock.small +
  s.ammoVehicles.reduce(
    (n, v) => n + (v.cargo?.kind === 'ammo' && v.cargo.key === 'small' ? v.cargo.amount : 0),
    0,
  ) +
  (s.ammoCrates || []).reduce((n, c) => n + c.stock.small, 0) +
  s.groundUnits.reduce((n, u) => n + (u.groundAmmo || 0) + (u.ammoReserve || 0), 0);
function fresh() {
  const s = E.createGame(811, { mode: 'multiplayer' });
  s.rules.oil = false;
  s.rules.rear = false;
  for (const f of s.sides) {
    f.credits = 0;
    f.materials = 0;
  }
  return s;
}
function foot(s, x = -900, z = -80, key = 'infantry') {
  const u = E.makeGround(s, 0, key, x, z);
  u.holdFire = true;
  u.autoDefense = false;
  u.groundAmmo = 0;
  u.ammoReserve = 0;
  s.groundUnits.push(u);
  return u;
}
function plant(s) {
  const d = E.BUILDINGS.ammofactory,
    b = {
      id: s.nextId++,
      side: 0,
      key: 'ammofactory',
      x: -1080,
      z: -80,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
      rotation: 0,
      cooldown: 0,
      queue: [],
    };
  s.buildings.push(b);
  s.sides[0].purchases.building.ammofactory = 1;
  addRoad(s, 0, -1015, -45, b.x, b.z + 20);
  return b;
}
function box(s, x, z, amount = 120, side = 0) {
  const c = {
    id: s.nextId++,
    side,
    key: 'ammo-crate',
    x,
    z,
    hp: 100,
    maxHp: 100,
    stock: { small: amount, shell: 0, rocket: 0, sam: 0 },
  };
  s.ammoCrates.push(c);
  return c;
}
test('one physical paid batch supplies twelve nearby soldiers through one field crate without creating ammunition', () => {
  const s = fresh();
  plant(s);
  for (let i = 0; i < 12; i++) foot(s, -900 + i * 4, -80);
  s.sides[0].ammoStock.small = 360;
  let moving = false,
    crateSeen = false,
    maxCargo = 0;
  for (let t = 0; t < 45; t += 0.25) {
    E.advance(s, 0.25);
    assert.equal(sum(s), 360);
    moving ||= s.ammoVehicles.some((v) => v.targetKind === 'field' && v.path.length > 0);
    crateSeen ||= s.ammoCrates.length > 0;
    maxCargo = Math.max(maxCargo, ...s.ammoVehicles.map((v) => v.cargo?.amount || 0));
  }
  assert.equal(moving, true);
  assert.equal(crateSeen, true);
  assert.equal(maxCargo, 360);
  assert.ok(s.groundUnits.every((u) => u.groundAmmo > 0));
  assert.ok(s.ammoCrates.length <= 1);
  assert.equal(s.sides[0].ammoProductionSpent, 0);
});
test('eight abandoned paid stocks never block a ninth physical drop, and more than eight per side survive save and all perspectives', () => {
  const s = fresh();
  for (let i = 0; i < 8; i++) box(s, -1500 + i * 80, -1300, 120);
  const cargo = {
    side: 0,
    x: -900,
    z: 250,
    fieldPoint: { x: -900, z: 250 },
    cargo: { kind: 'ammo', key: 'small', amount: 360 },
  };
  const accepted = depositFieldAmmo(s, cargo);
  cargo.cargo.amount -= accepted;
  assert.equal(accepted, 360);
  assert.equal(cargo.cargo.amount, 0);
  assert.equal(s.ammoCrates.length, 9);
  assert.equal(
    s.ammoCrates.reduce((n, c) => n + c.stock.small, 0),
    1320,
  );
  const restored = E.load(E.save(s));
  assert.deepEqual(restored.ammoCrates, s.ammoCrates);
  const coop = E.createGame(1, { mode: 'coop' });
  for (let side = 0; side < 4; side++)
    for (let i = 0; i < 9; i++)
      box(coop, (side % 2 ? 1 : -1) * (700 + i * 80), side < 2 ? -1300 : 1300, 120, side);
  const loaded = E.load(E.save(coop));
  assert.equal(loaded.ammoCrates.length, 36);
  for (let side = 0; side < 4; side++) {
    const view = playerView(loaded, side);
    assert.equal(view.ammoCrates.filter((c) => c.side === 0 && c.stock.small === 120).length, 9);
    assert.ok(view.ammoCrates.filter((c) => c.side !== 0).every((c) => !('stock' in c)));
  }
});
test('empty automatic infantry physically approaches a local crate, reloads and visits its original post again', () => {
  const s = fresh(),
    u = foot(s, -1000, -80),
    home = { x: u.x, z: u.z };
  u.autoDefense = true;
  u.guard = { ...home };
  const crate = box(s, -930, -80, 60);
  E.step(s, 0.05);
  assert.equal(u.supplyTrip?.crateId, crate.id);
  assert.ok(u.path.length > 0);
  let approached = false,
    returned = false,
    tripSeen = true;
  for (let t = 0; t < 15; t += 0.05) {
    E.step(s, 0.05);
    approached ||= Math.hypot(u.x - crate.x, u.z - crate.z) < 36;
    returned ||= tripSeen && !u.supplyTrip && Math.hypot(u.x - home.x, u.z - home.z) <= 4;
    tripSeen ||= !!u.supplyTrip;
  }
  assert.equal(approached, true);
  assert.equal(returned, true);
  assert.ok(u.groundAmmo + u.ammoReserve > 0);
  assert.equal(sum(s), 60);
});
test('accepted manual move/stop overrides a supply trip immediately and saves with the new order intact', () => {
  for (const command of ['move', 'stop']) {
    const s = fresh(),
      u = foot(s, -1000, -80);
    u.autoDefense = true;
    u.guard = { x: u.x, z: u.z };
    box(s, -930, -80);
    E.step(s, 0.05);
    assert.ok(u.supplyTrip);
    if (command === 'move') assert.equal(E.orderGround(s, 0, [u.id], { x: -1100, z: -100 }), 1);
    else assert.equal(E.commandUnits(s, 0, [u.id], 'stop'), 1);
    assert.equal(u.supplyTrip, undefined);
    const restored = E.load(E.save(s));
    assert.deepEqual(restored.groundUnits[0].order, u.order);
    E.advance(s, 2);
    assert.equal(u.supplyTrip, undefined);
    assert.equal(u.autoDefense, false);
  }
});
test('empty automatic armor physically reloads at a crate eighty metres away and returns; manual armor keeps its order', () => {
  const s = fresh(),
    u = foot(s, -1000, -100, 'leopard'),
    home = { x: u.x, z: u.z };
  u.autoDefense = true;
  u.guard = { ...home };
  const crate = box(s, -920, -100, 0);
  crate.stock.shell = 24;
  let moved = false,
    returned = false;
  E.step(s, 0.05);
  assert.ok(u.supplyTrip);
  assert.ok(u.path.length);
  for (let t = 0; t < 25; t += 0.05) {
    E.step(s, 0.05);
    moved ||= Math.hypot(u.x - home.x, u.z - home.z) > 30;
    returned ||= !u.supplyTrip && Math.hypot(u.x - home.x, u.z - home.z) <= 4;
  }
  assert.equal(moved, true);
  assert.equal(returned, true);
  assert.ok(u.groundAmmo + u.ammoReserve > 0);
  assert.equal(crate.stock.shell + u.groundAmmo + u.ammoReserve, 24);
  const manual = fresh(),
    v = foot(manual, -1000, -100, 'leopard');
  box(manual, -920, -100, 0).stock.shell = 24;
  assert.equal(E.orderGround(manual, 0, [v.id], { x: -1100, z: -100 }), 1);
  const order = structuredClone(v.order);
  E.updateFieldSupply(manual);
  assert.equal(v.supplyTrip, undefined);
  assert.deepEqual(v.order, order);
});
test('stationary MOG, AA and armor reload locally while quiet support and explicit movement never start a supply trip', () => {
  const s = fresh();
  const mog = foot(s, -900, -80, 'mog'),
    tank = foot(s, -850, -80, 'leopard'),
    medic = foot(s, -950, -80, 'medic');
  const small = box(s, -900, -70, 180),
    shell = box(s, -850, -70, 0);
  shell.stock.shell = 24;
  for (const u of [mog, tank, medic]) {
    u.autoDefense = true;
    u.guard = { x: u.x, z: u.z };
  }
  const before = [mog, tank, medic].map((u) => ({ x: u.x, z: u.z }));
  E.updateFieldSupply(s);
  assert.ok(mog.ammoReserve > 0);
  assert.ok(tank.ammoReserve > 0);
  for (let i = 0; i < 3; i++) {
    const u = [mog, tank, medic][i];
    assert.equal(u.supplyTrip, undefined);
    assert.deepEqual({ x: u.x, z: u.z }, before[i]);
  }
  assert.ok(small.stock.small < 180);
});
test('version eighteen preserves a previously loaded direct delivery instead of converting or losing its paid cargo', () => {
  const s = fresh(),
    u = foot(s);
  plant(s);
  E.updateAmmoLogistics(s, 0.05);
  const van = s.ammoVehicles[0];
  const goal = { x: u.x - 12, z: u.z };
  Object.assign(van, {
    targetKind: 'ground',
    targetId: u.id,
    fieldPoint: null,
    cargo: { kind: 'ammo', key: 'small', amount: 30 },
    goal,
    path: E.groundPath(s, van, goal, 3),
    status: 'outbound',
  });
  s.sides[0].ammoStock.small = 330;
  s.version = 18;
  delete s.ammoCrates;
  delete s.fieldSupplyAt;
  const restored = E.load(E.save(s)),
    same = restored.ammoVehicles.find((v) => v.id === van.id);
  assert.equal(same.targetKind, 'ground');
  assert.equal(same.targetId, u.id);
  assert.deepEqual(same.cargo, van.cargo);
  assert.equal(sum(restored), 360);
  E.advance(restored, 30);
  assert.ok(restored.groundUnits[0].groundAmmo > 0);
  assert.equal(sum(restored), 360);
});
test('mid-delivery and mid-walk save/load keep finite cargo, destination and exact continuation', () => {
  const s = fresh();
  plant(s);
  foot(s);
  s.sides[0].ammoStock.small = 120;
  E.advance(s, 1.2);
  const restored = E.load(E.save(s));
  E.advance(s, 20);
  E.advance(restored, 20);
  assert.deepEqual(restored.ammoCrates, s.ammoCrates);
  assert.deepEqual(restored.sides, s.sides);
  const physicalVan = ({ revision, ...v }) => v;
  assert.deepEqual(restored.ammoVehicles.map(physicalVan), s.ammoVehicles.map(physicalVan));
  const t = fresh(),
    u = foot(t, -1000, -80);
  u.autoDefense = true;
  u.guard = { x: u.x, z: u.z };
  box(t, -930, -80);
  E.advance(t, 1.2);
  const saved = E.load(E.save(t));
  assert.deepEqual(saved.groundUnits[0].supplyTrip, u.supplyTrip);
  E.advance(t, 6);
  E.advance(saved, 6);
  const physicalUnit = ({ navRevision, ...u }) => u;
  assert.deepEqual(saved.groundUnits.map(physicalUnit), t.groundUnits.map(physicalUnit));
  assert.deepEqual(saved.ammoCrates, t.ammoCrates);
});
test('destroying the distant source plant does not erase a healthy van or its already paid field cargo', () => {
  const s = fresh(),
    depot = plant(s);
  for (let i = 0; i < 12; i++) foot(s, -900 + i * 4, -80);
  s.sides[0].ammoStock.small = 360;
  E.advance(s, 1.1);
  const van = s.ammoVehicles.find((v) => v.cargo);
  assert.ok(van);
  assert.equal(van.cargo.amount, 360);
  damageBuilding(s, depot, depot.maxHp + 1);
  assert.doesNotThrow(() => E.load(E.save(s)));
  for (let t = 0; t < 30; t += 0.5) {
    E.advance(s, 0.5);
    assert.equal(sum(s), 360);
  }
  assert.ok(s.groundUnits.every((u) => u.groundAmmo > 0));
});
test('crate area damage destroys paid local stock without refund, while forged stocks and foreign trip links are rejected', () => {
  const s = fresh(),
    c = box(s, -900, -80);
  applyBlast(s, c.x, c.z, 1e6, 10);
  assert.equal(c.hp, 0);
  assert.equal(c.stock.small, 0);
  assert.equal(s.sides[0].ammoStock.small, 0);
  assert.doesNotThrow(() => E.load(E.save(s)));
  for (const mutate of [
    (v) => (v.ammoCrates[0].stock.small = 721),
    (v) => (v.ammoCrates[0].id = v.buildings[0].id),
    (v) => (v.ammoCrates[0].side = 4),
    (v) => (v.ammoCrates[0].stock.constructor = 1),
  ]) {
    const t = fresh();
    box(t, -900, -80);
    mutate(t);
    assert.throws(() => E.load(E.save(t)));
  }
});
test('a real hostile drone can select and destroy a crate while foreign inspection never reveals its stock', () => {
  const s = fresh(),
    crate = box(s, -900, -80),
    d = E.BUILDINGS.launcher,
    launcher = {
      id: s.nextId++,
      side: 1,
      key: 'launcher',
      x: -700,
      z: 0,
      hp: d.hp,
      maxHp: d.hp,
      progress: 1,
      rotation: 0,
      cooldown: 0,
      queue: [],
    };
  s.buildings.push(launcher);
  s.sides[1].purchases.building.launcher = 1;
  E.initLaunchStore(launcher);
  launcher.launchStore.drone = 2;
  assert.equal(E.observedTarget(s, 0, crate.id).fieldCrate, true);
  assert.equal(E.observedTarget(s, 1, crate.id).stock, undefined);
  assert.equal(E.launch(s, 1, 'drone', crate.id, 2, launcher.id), 2);
  E.advance(s, 25);
  assert.equal(crate.hp, 0);
  assert.equal(crate.stock.small, 0);
  assert.ok(s.stats.impacts > 0);
});
test('all four network perspectives retain only own stocks and snapshot encoding remains detached', () => {
  const s = E.createGame(1, { mode: 'coop' });
  for (let side = 0; side < 4; side++)
    box(s, side % 2 ? 900 : -900, side < 2 ? -1300 : 1300, 60 + side, side);
  for (let side = 0; side < 4; side++) {
    const view = playerView(s, side);
    assert.equal(view.ammoCrates.find((c) => c.side === 0).stock.small, 60 + side);
    assert.ok(view.ammoCrates.filter((c) => c.side !== 0).every((c) => !('stock' in c)));
  }
  const encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder(),
    wire = encoder.encode(snapshotPlayerView(s, 2));
  const first = decoder.decode(JSON.parse(JSON.stringify(wire)));
  s.ammoCrates[2].stock.small = 0;
  assert.equal(first.ammoCrates.find((c) => c.side === 0).stock.small, 62);
});
