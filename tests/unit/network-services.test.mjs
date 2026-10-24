import test from 'node:test';
import assert from 'node:assert/strict';
import * as game from '../../src/game/index.js';
import { executeCommand } from '../../src/network/commands.js';
import { playerView } from '../../src/network/perspective.js';
import { NetworkSession } from '../../src/network/client.js';

function station(s, side) {
  const building = {
    id: s.nextId++,
    side,
    key: 'service',
    x: side ? 600 : -600,
    z: 200,
    hp: 100,
    maxHp: 100,
    progress: 1,
    serviceEnabled: true,
    servicePrivate: { nextTask: 900 },
  };
  s.buildings.push(building);
  return building;
}

function fleet(s, b) {
  const vehicle = {
    id: s.nextId++,
    side: b.side,
    stationId: b.id,
    x: b.x,
    z: b.z,
    yaw: 0.2,
    state: 'driving',
    target: { kind: 'building', id: 876 },
    path: [{ x: -700, z: 450 }],
    roadIds: [999],
    revision: 23,
    thinkAt: 88,
    futureSchedulingSecret: { tasks: [123] },
  };
  s.serviceVehicles.push(vehicle);
  return vehicle;
}

test('service command validates ownership, exact station type and boolean before any mutation', () => {
  const s = game.createGame(493);
  const zero = station(s, 0),
    one = station(s, 1),
    vehicle = fleet(s, one);
  const before = structuredClone(s);
  for (const args of [
    { id: zero.id, enabled: false },
    { id: s.buildings.find((b) => b.side === 1 && b.key !== 'service').id, enabled: false },
    { id: vehicle.id, enabled: false },
    { id: String(one.id), enabled: false },
    { id: one.id, enabled: 0 },
    { id: one.id, enabled: 'false' },
    { id: one.id },
    { id: -1, enabled: false },
  ])
    assert.equal(typeof executeCommand(s, 1, 'service-enabled', args), 'string');
  assert.deepEqual(s, before);
  assert.equal(
    executeCommand(s, 1, 'service-enabled', { id: one.id, enabled: false, side: 0 }),
    true,
  );
  assert.equal(one.serviceEnabled, false);
  assert.equal(zero.serviceEnabled, true);
  assert.equal(vehicle.thinkAt, 0);
  assert.equal(game.serviceStatus(s, 1, one.id).status, 'disabled');
  assert.equal(executeCommand(s, 1, 'service-enabled', { id: one.id, enabled: true }), true);
  assert.equal(one.serviceEnabled, true);
  one.hp = 0;
  assert.equal(
    typeof executeCommand(s, 1, 'service-enabled', { id: one.id, enabled: false }),
    'string',
  );
  assert.equal(one.serviceEnabled, true);
});

test('both player projections keep own service plans and strictly redact all future foreign fields', () => {
  const s = game.createGame(494);
  const zero = station(s, 0),
    one = station(s, 1);
  const vehicles = [fleet(s, zero), fleet(s, one)];
  const original = structuredClone(s);
  for (const side of [0, 1]) {
    const view = playerView(s, side);
    const own = view.serviceVehicles.find((v) => v.id === vehicles[side].id);
    const foreign = view.serviceVehicles.find((v) => v.id === vehicles[1 - side].id);
    assert.deepEqual(own, { ...vehicles[side], side: 0 });
    assert.deepEqual(
      Object.keys(foreign).sort(),
      ['id', 'side', 'stationId', 'x', 'z', 'yaw', 'state'].sort(),
    );
    assert.equal(foreign.side, 1);
    assert.equal(foreign.x, vehicles[1 - side].x);
    assert.equal(foreign.stationId, vehicles[1 - side].stationId);
    assert.equal(
      view.buildings.find((b) => b.id === vehicles[1 - side].stationId).serviceEnabled,
      undefined,
    );
    assert.equal(
      view.buildings.find((b) => b.id === vehicles[1 - side].stationId).servicePrivate,
      undefined,
    );
    own.path[0].x = 888;
  }
  assert.deepEqual(s, original, 'snapshot projection must never mutate authority');
});

test('enemy ballistic snapshots retain physical arc metadata without target identities or future tasks', () => {
  const s = game.createGame(495);
  const source = s.buildings.find((b) => b.side === 1);
  const projectile = {
    id: s.nextId++,
    side: 1,
    sourceId: source.id,
    kind: 'shell',
    x: 10,
    y: 15,
    z: 30,
    vx: 20,
    vy: 10,
    vz: 0,
    originY: 6,
    arc: 105,
    gravity: 9.81,
    flight: 3,
    life: 0.5,
    tx: 200,
    tz: 50,
    targetId: 17,
    route: [{ x: 99, z: 50 }],
    target: { id: 17 },
    thinkAt: 99,
  };
  s.projectiles.push(projectile);
  const foreign = playerView(s, 0).projectiles[0];
  for (const field of ['originY', 'gravity', 'arc', 'vx', 'vy', 'vz', 'flight', 'life'])
    assert.equal(foreign[field], projectile[field]);
  for (const field of ['targetId', 'target', 'route', 'thinkAt', 'sourceId'])
    assert.equal(foreign[field], undefined);
  const own = playerView(s, 1).projectiles[0];
  assert.equal(own.targetId, 17);
  assert.equal(own.side, 0);
});

test('service interpolation smooths positions and shortest yaw while keeping latest task semantics', () => {
  const session = new NetworkSession({});
  session.room = { phase: 'playing' };
  session.previous = {
    state: {
      time: 10,
      serviceVehicles: [{ id: 1, x: 0, z: 4, yaw: Math.PI - 0.1, path: [{ x: 100, z: 100 }] }],
    },
  };
  session.latest = {
    received: 100,
    state: {
      time: 10.1,
      serviceVehicles: [
        { id: 1, x: 10, z: 8, yaw: -Math.PI + 0.1, path: [], state: 'idle' },
        { id: 2, x: 50, z: 60, yaw: 0 },
      ],
    },
  };
  const display = structuredClone(session.latest.state);
  session.renderInto(display, 150);
  assert.ok(Math.abs(display.serviceVehicles[0].x - 5) < 1e-9);
  assert.ok(Math.abs(display.serviceVehicles[0].z - 6) < 1e-9);
  assert.ok(Math.abs(display.serviceVehicles[0].yaw - Math.PI) < 1e-9);
  assert.deepEqual(display.serviceVehicles[0].path, []);
  assert.equal(display.serviceVehicles[0].state, 'idle');
  assert.equal(display.serviceVehicles[1].x, 50);
  assert.equal(session.latest.state.serviceVehicles[0].x, 10);
  session.room.phase = 'disconnected';
  session.renderInto(display, 200);
  assert.ok(Math.abs(display.serviceVehicles[0].x - 5) < 1e-9);
});
