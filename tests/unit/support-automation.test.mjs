import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import { updateGround } from '../../src/game/units/ground/update.js';
import { event } from '../../src/game/shared/events.js';
import { dirtyNetwork } from '../../src/game/city/road-network.js';

function fresh() {
  const s = E.createGame(8993);
  s.mode = 'multiplayer';
  s.rules.oil = false;
  for (const f of s.sides) {
    f.credits = 10000;
    f.materials = 1000;
  }
  return s;
}
function unit(s, key, side = 0, x = (side ? 1 : -1) * 1000, z = 250) {
  const u = E.makeGround(s, side, key, x, z);
  u.holdFire = true;
  s.groundUnits.push(u);
  return u;
}

test('the global rear switch stops automatic work and movement, preserves manual orders, and explicitly restores support', () => {
  const s = fresh(),
    truck = unit(s, 'supplytruck'),
    apc = unit(s, 'apc', 0, -990),
    medic = unit(s, 'medic', 0, -1192, 280),
    rifle = unit(s, 'infantry', 0, -1187, 280);
  apc.hp = 40;
  rifle.hp = 10;
  assert.equal(executeCommand(s, 0, 'rear-auto', { enabled: false }), true);
  E.advance(s, 2);
  assert.equal(apc.hp, 40);
  assert.equal(rifle.hp, 10);
  assert.equal(truck.path.length, 0);
  assert.equal(medic.path.length, 0);
  assert.equal(E.orderGround(s, 0, [truck.id], { x: -1232, z: 300 }), 1);
  const order = structuredClone(truck.order);
  E.advance(s, 1);
  assert.notEqual(truck.x, -1000);
  assert.deepEqual(truck.order, order);
  assert.equal(executeCommand(s, 0, 'rear-auto', { enabled: true }), true);
  assert.equal(truck.supportManual, false);
  assert.equal(truck.routeState, null);
  E.advance(s, 10);
  assert.ok(apc.hp > 40);
  assert.ok(rifle.hp > 10);
  assert.equal(E.commandUnits(s, 0, [truck.id], 'stop'), 1);
  assert.equal(executeCommand(s, 0, 'support-auto', { ids: [truck.id], enabled: true }), 1);
  assert.equal(truck.supportManual, false);
});

test('selected support mode is side-aware and rejects mixed, foreign and malformed selections atomically', () => {
  const s = fresh(),
    a = unit(s, 'medic'),
    b = unit(s, 'supplytruck', 1),
    rifle = unit(s, 'infantry');
  for (const [side, u] of [
    [0, a],
    [1, b],
  ]) {
    E.commandUnits(s, side, [u.id], 'stop');
    assert.equal(executeCommand(s, side, 'support-auto', { ids: [u.id], enabled: true }), 1);
    assert.equal(u.supportManual, false);
    assert.equal(executeCommand(s, side, 'support-auto', { ids: [u.id], enabled: false }), 1);
    assert.equal(u.supportManual, true);
  }
  for (const args of [
    { ids: [a.id, b.id], enabled: true },
    { ids: [a.id, rifle.id], enabled: true },
    { ids: [a.id, a.id], enabled: true },
    { ids: [a.id], enabled: 'yes' },
    { ids: [-1], enabled: true },
    { ids: [], enabled: true },
  ]) {
    const before = E.save(s);
    assert.equal(typeof executeCommand(s, 0, 'support-auto', args), 'string');
    assert.equal(E.save(s), before);
  }
  executeCommand(s, 0, 'rear-auto', { enabled: false });
  const other = { manual: b.supportManual, path: structuredClone(b.path) };
  assert.equal(executeCommand(s, 0, 'support-auto', { ids: [a.id], enabled: true }), 1);
  assert.equal(s.sides[0].rearAuto, true);
  assert.equal(a.supportManual, false);
  assert.equal(b.supportManual, other.manual);
  assert.deepEqual(b.path, other.path);
});

function groundAdvance(s, seconds, onTick = () => {}) {
  for (let t = 0; t < seconds - 1e-8; t += 0.05) {
    s.time += 0.05;
    updateGround(s, [E.economy(s, 0), E.economy(s, 1)], 0.05, { event, random: E.random });
    onTick();
  }
}

test('a truck carrying spare shells physically fetches missing rifle rounds and conserves paid cargo across save/load', () => {
  const s = fresh(),
    plant = E.build(s, 0, 'ammofactory', -1272, -10);
  assert.equal(typeof plant, 'object');
  plant.progress = 1;
  plant.hp = plant.maxHp;
  const truck = unit(s, 'supplytruck'),
    rifle = unit(s, 'infantry', 0, -1192, 265);
  truck.ammoCargo.shell = 6;
  rifle.groundAmmo = 0;
  rifle.ammoReserve = 0;
  const money = s.sides[0].credits,
    metal = s.sides[0].materials;
  E.updateAmmoProduction(s);
  assert.equal(s.sides[0].credits, money - 12);
  assert.equal(s.sides[0].materials, metal - 1);
  assert.equal(s.sides[0].ammoStock.small, 60);
  for (const r of s.roads) if (r.side === 0) r.blocked = true;
  dirtyNetwork(s);
  let pickup = false;
  for (let i = 0; i < 600 && !pickup; i++)
    groundAdvance(s, 0.05, () => {
      if (truck.ammoCargo.small > 0) {
        pickup = true;
        assert.ok(Math.hypot(truck.x - plant.x, truck.z - plant.z) <= 45);
        assert.equal(rifle.ammoReserve, 0, 'pickup cannot teleport rounds to a distant patient');
      }
    });
  assert.ok(pickup, 'a different remaining cargo type cannot block warehouse pickup');
  assert.equal(truck.ammoCargo.shell, 6);
  const loaded = E.load(E.save(s));
  groundAdvance(s, 35);
  groundAdvance(loaded, 35);
  assert.ok(E.ammunitionStatus(s, rifle).total > 0);
  const rounds = (state) =>
    state.sides[0].ammoStock.small +
    state.groundUnits.reduce(
      (n, u) =>
        n +
        (u.ammoCargo?.small || 0) +
        (u.key === 'infantry' ? E.ammunitionStatus(state, u).total : 0),
      0,
    );
  assert.equal(rounds(s), 60);
  assert.equal(rounds(loaded), 60);
  assert.deepEqual(loaded.sides, s.sides);
  assert.deepEqual(
    loaded.groundUnits.map((u) => u.ammoCargo),
    s.groundUnits.map((u) => u.ammoCargo),
  );
  assert.ok(
    Math.hypot(loaded.groundUnits[0].x - truck.x, loaded.groundUnits[0].z - truck.z) < 1e-6,
  );
});

test('a missing ammo class without warehouse stock does not cause repeated useless depot trips', () => {
  const s = fresh(),
    plant = E.build(s, 0, 'ammofactory', -1272, -10);
  assert.equal(typeof plant, 'object');
  plant.progress = 1;
  plant.hp = plant.maxHp;
  const truck = unit(s, 'supplytruck'),
    rifle = unit(s, 'infantry', 0, -1192, 265);
  truck.ammoCargo.shell = 6;
  rifle.groundAmmo = 0;
  rifle.ammoReserve = 0;
  groundAdvance(s, 12);
  assert.equal(s.sides[0].ammoStock.small, 0);
  assert.equal(truck.ammoCargo.shell, 6);
  assert.ok(!truck.order || Math.hypot(truck.order.x - plant.x, truck.order.z - plant.z) > 100);
  assert.ok(Math.hypot(truck.x + 1192, truck.z - 250) < 80);
});

test('paid medic and truck deployments obey near and far destinations before explicit automatic support resumes', () => {
  for (const key of ['medic', 'supplytruck'])
    for (const point of [
      { x: -1232, z: 80 },
      { x: -992, z: 300 },
    ]) {
      const s = fresh(),
        facility = E.recruitmentFacility(key);
      for (const [type, x, z] of [
        [facility, -1272, -10],
        ['power', -1272, -80],
      ]) {
        const b = E.build(s, 0, type, x, z);
        assert.equal(typeof b, 'object', b);
        b.progress = 1;
        b.hp = b.maxHp;
      }
      const credits = s.sides[0].credits,
        metal = s.sides[0].materials;
      const plan = E.deploymentPlan(s, 0, key, point, 1);
      assert.equal(plan.ok, true);
      let previous = plan.origin,
        length = 0;
      for (const p of plan.path) {
        length += Math.hypot(p.x - previous.x, p.z - previous.z);
        previous = p;
      }
      const deadline = E.GROUND_UNITS[key].time + length / (E.GROUND_UNITS[key].speed * 0.5) + 10;
      assert.equal(typeof E.deployGround(s, 0, key, point, 1), 'object');
      assert.equal(s.sides[0].credits, credits - E.GROUND_UNITS[key].cost);
      assert.equal(s.sides[0].materials, metal - E.GROUND_UNITS[key].metal);
      let u;
      do {
        E.step(s, 0.05);
        u = s.groundUnits.find((v) => v.key === key);
      } while (s.time < deadline && (!u || u.path.length));
      assert.ok(u);
      assert.equal(u.supportManual, true);
      assert.ok(
        Math.hypot(u.x - point.x, u.z - point.z) < 14,
        `${key} must reach its paid destination`,
      );
      const copy = E.load(E.save(s));
      assert.equal(copy.groundUnits.find((v) => v.id === u.id).supportManual, true);
      const ally = unit(s, key === 'medic' ? 'infantry' : 'apc', 0, u.x - 100, u.z);
      ally.hp = 10;
      E.advance(s, 2);
      assert.equal(ally.hp, 10, 'manual destination must not become a roaming support order');
      s.sides[0].rearAuto = false;
      assert.equal(executeCommand(s, 0, 'support-auto', { ids: [u.id], enabled: true }), 1);
      E.advance(s, 12);
      assert.ok(ally.hp > 10);
      assert.equal(u.supportManual, false);
    }
});
