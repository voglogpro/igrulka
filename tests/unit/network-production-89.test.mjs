import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand, PROTOCOL_VERSION } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';
import { event } from '../../src/game/shared/events.js';

test('army composition commands are bounded, atomic and apply only to the authenticated side', () => {
  const s = E.createGame(89);
  assert.equal(PROTOCOL_VERSION, 17);
  assert.equal(executeCommand(s, 1, 'army-target', { key: 'infantry', count: 50, side: 0 }), true);
  assert.deepEqual(s.sides[0].armyComposition.targets, {});
  assert.deepEqual(s.sides[1].armyComposition.targets, { infantry: 50 });
  for (const args of [
    { key: 'infantry', count: -1 },
    { key: 'infantry', count: E.ARMY_TARGET_MAX + 1 },
    { key: 'infantry', count: 0.5 },
    { key: 'infantry', count: '5' },
    { key: 'constructor', count: 1 },
    { key: '__proto__', count: 1 },
    { key: 'leopard', count: Infinity },
  ]) {
    const before = E.save(s);
    assert.equal(typeof executeCommand(s, 1, 'army-target', args), 'string');
    assert.equal(E.save(s), before);
  }
  assert.equal(executeCommand(s, 1, 'army-target', { key: 'infantry', count: 0 }), true);
  assert.deepEqual(s.sides[1].armyComposition.targets, {});
});

test('both player perspectives retain only their own production goals while public craters remain visible', () => {
  const s = E.createGame(90);
  E.setArmyTarget(s, 0, 'infantry', 50);
  E.setArmyTarget(s, 1, 'leopard', 5);
  s.time = 10;
  event(s, 'impact', { key: 'drone', side: 0, x: -E.HQ_X, z: 0 });
  event(s, 'impact', { key: 'ballistic', side: 1, x: E.HQ_X, z: 0 });
  assert.equal(s.groundScars.length, 2);
  for (const side of [0, 1]) {
    const view = playerView(s, side);
    assert.deepEqual(view.sides[0].armyComposition, s.sides[side].armyComposition);
    assert.equal(view.sides[1].armyComposition, undefined);
    assert.equal(view.groundScars.length, 2, 'the removed map fog cannot hide distant craters');
    const own = view.groundScars.find((c) => c.x === (side === 0 ? -E.HQ_X : E.HQ_X));
    const enemy = view.groundScars.find((c) => c.x === (side === 0 ? E.HQ_X : -E.HQ_X));
    assert.equal(own.side, 0, 'local ownership is normalized');
    assert.equal(enemy.side, 1);
  }
});

test('small drone craters survive current save/load and malformed entries are rejected', () => {
  const s = E.createGame(91);
  s.time = 12;
  event(s, 'crash', { key: 'drone', side: 0, x: -E.HQ_X - 70, z: 20 });
  assert.equal(s.groundScars.length, 1);
  assert.ok(s.groundScars[0].radius <= 3);
  const loaded = E.load(E.save(s));
  assert.deepEqual(loaded.groundScars, s.groundScars);
  for (const patch of [{ radius: 1000 }, { time: 13 }, { kind: 'constructor' }, { side: 2 }]) {
    const broken = structuredClone(s);
    Object.assign(broken.groundScars[0], patch);
    assert.throws(() => E.load(E.save(broken)));
  }
  const duplicate = structuredClone(s);
  duplicate.groundScars.push({ ...duplicate.groundScars[0] });
  assert.throws(() => E.load(E.save(duplicate)));
});

test('both owners see the complete physical fleet while cargo, collection jobs and requested stocks remain private', () => {
  const s = E.createGame(93);
  s.sides[0].ammoStock.small = 60;
  s.sides[1].ammoStock.rocket = 12;
  const base = {
    y: 1,
    z: 20,
    yaw: 0,
    status: 'outbound',
    depotId: 1,
    targetId: 999,
    path: [{ x: 1092, z: 100 }],
    cargo: { kind: 'weapon', key: 'ballistic', amount: 1 },
    hp: E.AMMUNITION.vehicle.hp,
    maxHp: E.AMMUNITION.vehicle.hp,
  };
  for (const side of [0, 1]) {
    const x = (side ? 1 : -1) * E.HQ_X;
    const site = {
      id: s.nextId++,
      side,
      key: 'silo',
      x,
      z: 200,
      hp: 300,
      maxHp: 300,
      progress: 1,
      launchStore: { drone: 0, heavy: 0, cruise: 1, ballistic: 1 },
      weaponDemand: { ballistic: 3 },
    };
    s.buildings.push(site);
    s.ammoVehicles.push(
      { ...base, id: s.nextId++, side, x, targetId: site.id, targetKind: 'building', pickup: null },
      {
        ...base,
        id: s.nextId++,
        side,
        x: x + 30,
        targetId: site.id,
        targetKind: 'building',
        cargo: null,
        pickup: { key: 'cruise', amount: 1 },
      },
    );
  }
  const authority = structuredClone(s);
  for (const side of [0, 1]) {
    const view = playerView(s, side);
    assert.equal(
      view.ammoVehicles.length,
      4,
      'public vehicles remain visible at both distant bases',
    );
    for (const original of s.ammoVehicles) {
      const projected = view.ammoVehicles.find((v) => v.id === original.id);
      assert.equal(projected.x, original.x);
      assert.equal(projected.z, original.z);
      assert.equal(projected.side, original.side === side ? 0 : 1);
      assert.equal(projected.hp, original.hp);
      assert.equal(projected.maxHp, original.maxHp);
      for (const key of ['cargo', 'pickup', 'targetId', 'targetKind', 'path']) {
        if (original.side === side) assert.deepEqual(projected[key], original[key]);
        else
          assert.equal(Object.hasOwn(projected, key), false, `foreign ${key} must remain private`);
      }
    }
    for (const site of s.buildings.filter((b) => b.key === 'silo')) {
      const projected = view.buildings.find((b) => b.id === site.id);
      if (site.side === side) {
        assert.deepEqual(projected.weaponDemand, site.weaponDemand);
        assert.deepEqual(projected.launchStore, site.launchStore);
      } else {
        assert.equal(Object.hasOwn(projected, 'weaponDemand'), false);
        assert.equal(Object.hasOwn(projected, 'launchStore'), false);
      }
    }
    assert.deepEqual(view.sides[0].ammoStock, s.sides[side].ammoStock);
    assert.equal(view.sides[1].ammoStock, undefined);
    assert.equal(view.ammoLogisticsAt, undefined);
  }
  assert.deepEqual(s, authority, 'projection never mutates authoritative cargo or requested stock');
});
