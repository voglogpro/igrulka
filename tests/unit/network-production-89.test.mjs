import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { executeCommand, PROTOCOL_VERSION } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';
import { event } from '../../src/game/shared/events.js';

test('army composition commands are bounded, atomic and apply only to the authenticated side', () => {
  const s = E.createGame(89);
  assert.equal(PROTOCOL_VERSION, 8);
  assert.equal(executeCommand(s, 1, 'army-target', { key: 'infantry', count: 50, side: 0 }), true);
  assert.deepEqual(s.sides[0].armyComposition.targets, {});
  assert.deepEqual(s.sides[1].armyComposition.targets, { infantry: 50 });
  for (const args of [
    { key: 'infantry', count: -1 },
    { key: 'infantry', count: 121 },
    { key: 'infantry', count: 0.5 },
    { key: 'infantry', count: '5' },
    { key: 'constructor', count: 1 },
    { key: '__proto__', count: 1 },
    { key: 'leopard', count: 80 },
  ]) {
    const before = E.save(s);
    assert.equal(typeof executeCommand(s, 1, 'army-target', args), 'string');
    assert.equal(E.save(s), before);
  }
  assert.equal(executeCommand(s, 1, 'army-target', { key: 'infantry', count: 0 }), true);
  assert.deepEqual(s.sides[1].armyComposition.targets, {});
});

test('both player perspectives retain only their own production goals and permitted craters', () => {
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
    assert.equal(view.groundScars.length, 1, 'hidden opposing craters cannot reveal strikes');
    assert.equal(view.groundScars[0].side, 0, 'local ownership is normalized');
    assert.equal(view.groundScars[0].x, side === 0 ? -E.HQ_X : E.HQ_X);
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

test('physical supply fleet reveals permitted positions while keeping cargo and delivery plans private', () => {
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
    path: [{ x: 900, z: 100 }],
    cargo: { kind: 'weapon', key: 'ballistic', amount: 1 },
  };
  s.ammoVehicles = [
    { ...base, id: s.nextId++, side: 0, x: -E.HQ_X },
    { ...base, id: s.nextId++, side: 1, x: -E.HQ_X + 30 },
    { ...base, id: s.nextId++, side: 1, x: E.HQ_X },
  ];
  const a = playerView(s, 0),
    b = playerView(s, 1);
  assert.equal(a.ammoVehicles.length, 2, 'an unobserved enemy truck is not published');
  const observed = a.ammoVehicles.find((v) => v.side === 1);
  for (const key of ['cargo', 'targetId', 'path']) assert.equal(observed[key], undefined);
  assert.deepEqual(a.ammoVehicles.find((v) => v.side === 0).cargo, base.cargo);
  assert.deepEqual(a.sides[0].ammoStock, s.sides[0].ammoStock);
  assert.equal(a.sides[1].ammoStock, undefined);
  assert.ok(b.ammoVehicles.some((v) => v.side === 0 && v.x === E.HQ_X));
  assert.equal(a.ammoLogisticsAt, undefined);
});
