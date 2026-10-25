import test from 'node:test';
import assert from 'node:assert/strict';
import { createSnapshotEncoder, createSnapshotDecoder } from '../../src/network/snapshots.js';
import * as E from '../../src/game/index.js';
import { compactPlayerView } from '../../src/network/perspective.js';

const wire = (message) => JSON.parse(JSON.stringify(message));
const fixture = () => ({
  time: 0,
  sides: [{ credits: 3200.123456, inventory: { drone: 2 } }],
  groundUnits: [{ id: 1, x: 10, z: 20, hp: 80.12345, path: [{ x: 22, z: 30 }] }],
  units: [],
  projectiles: [],
  events: [],
  weather: { wind: { x: 1, z: 2 } },
});

test('delta snapshots retain exact budgets/HP and millimetre-bounded display coordinates without mutating source', () => {
  const encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder(),
    s = fixture();
  s.groundUnits[0].x = 10.123456;
  const first = decoder.decode(wire(encoder.encode(s)));
  assert.equal(first.sides[0].credits, 3200.123456);
  assert.equal(first.groundUnits[0].hp, 80.12345);
  assert.ok(Math.abs(first.groundUnits[0].x - s.groundUnits[0].x) <= 0.005);
  assert.equal(s.groundUnits[0].x, 10.123456);
  s.time = 0.1;
  s.sides[0].credits -= 15;
  s.groundUnits[0].x = 11.2345;
  const message = wire(encoder.encode(s)),
    next = decoder.decode(message);
  assert.equal(message.state, undefined);
  assert.equal(next.sides[0].credits, s.sides[0].credits);
  assert.equal(next.groundUnits[0].x, 11.23);
  assert.equal(first.groundUnits[0].x, 10.12, 'old interpolation samples stay immutable');
  assert.equal(first.sides[0].credits, 3200.123456);
});

test('entity additions, deaths, reorder, changed route, deleted fields and new dictionary fields round trip', () => {
  const encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder(),
    s = fixture();
  decoder.decode(wire(encoder.encode(s)));
  s.groundUnits.push({ id: 9, key: 'mog', x: 21, hp: 90, level: 1 });
  s.groundUnits[0].path = [{ x: 44, z: 55 }];
  delete s.groundUnits[0].hp;
  s.events = [{ id: 10, type: 'shot', mx: 1, my: 3, mz: 2 }];
  let next = decoder.decode(wire(encoder.encode(s)));
  assert.deepEqual(next, s);
  s.groundUnits.reverse();
  assert.deepEqual(decoder.decode(wire(encoder.encode(s))), s);
  s.groundUnits = s.groundUnits.filter((u) => u.id === 9);
  s.events = [];
  delete s.weather.wind.x;
  s.weather.rain = 0.5;
  next = decoder.decode(wire(encoder.encode(s)));
  assert.deepEqual(next, s);
});

test('field supply crate additions, finite stock changes and removal round trip as entity deltas', () => {
  const encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder(),
    state = { ...fixture(), ammoCrates: [] };
  decoder.decode(wire(encoder.encode(state)));
  state.ammoCrates.push({
    id: 50,
    side: 0,
    key: 'ammo-crate',
    x: 120,
    z: -140,
    hp: 100,
    stock: { small: 360, shell: 0, rocket: 0, sam: 0 },
  });
  assert.deepEqual(decoder.decode(wire(encoder.encode(state))), state);
  state.ammoCrates[0].stock.small -= 120;
  assert.deepEqual(decoder.decode(wire(encoder.encode(state))), state);
  state.ammoCrates = [];
  assert.deepEqual(decoder.decode(wire(encoder.encode(state))), state);
});

test('a missing delta baseline is rejected and resync uses a fresh monotonically numbered full snapshot', () => {
  const encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder(),
    s = fixture();
  const first = wire(encoder.encode(s));
  decoder.decode(first);
  s.time = 0.1;
  const skipped = wire(encoder.encode(s));
  s.time = 0.2;
  const third = wire(encoder.encode(s));
  assert.throws(() => decoder.decode(third), /baseline/);
  assert.equal(
    decoder.decode(skipped).time,
    0.1,
    'failed decoding did not advance dictionary or state',
  );
  encoder.reset();
  const resync = wire(encoder.encode(s));
  assert.ok(resync.sync.seq > third.sync.seq);
  assert.equal(resync.sync.base, 0);
  assert.equal(decoder.decode(resync).time, 0.2);
});

test('snapshot path edits reject prototype keys and malformed entity references without touching earlier samples', () => {
  const encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder(),
    s = fixture();
  const old = decoder.decode(wire(encoder.encode(s)));
  s.time = 1;
  const change = wire(encoder.encode(s));
  const bad = wire(change);
  bad.delta.set.push([['__proto__', 'polluted'], true]);
  assert.throws(() => decoder.decode(bad), /path/);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(old, fixture());
  assert.equal(decoder.decode(change).time, 1);
});

test('both human perspectives preserve concealed enemies, paid orders and allied ownership through a real battle stream', () => {
  const s = E.createGame(8102, { mode: 'coop' }),
    clients = [0, 2].map((side) => ({
      side,
      encoder: createSnapshotEncoder(),
      decoder: createSnapshotDecoder(),
    }));
  for (let i = 0; i < 60; i++) {
    E.step(s, 0.05);
    for (const { side, encoder, decoder } of clients) {
      const view = compactPlayerView(s, side),
        message = wire(encoder.encode(view));
      const next = decoder.decode(message);
      assert.equal(next.time, view.time);
      assert.deepEqual(next.sides, view.sides);
      assert.equal(next.buildings.filter((b) => b.key === 'hq').length, 4);
      assert.equal(
        next.buildings.find((b) => b.key === 'hq' && b.side === 0).z,
        side ? 1015 : -1015,
      );
    }
  }
});

test('a moving crowd sends changed fields without repeating static paid routes or all historical effects', () => {
  const s = fixture(),
    encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder();
  s.groundUnits = Array.from({ length: 480 }, (_, id) => ({
    id: id + 1,
    key: 'infantry',
    x: id,
    z: 0,
    hp: 80,
    path: Array.from({ length: 64 }, (_, i) => ({ x: i, z: id })),
    order: { mode: 'move', x: 100, z: 100 },
  }));
  const full = wire(encoder.encode(s));
  decoder.decode(full);
  for (const u of s.groundUnits) u.x += 1.25;
  const change = wire(encoder.encode(s));
  assert.ok(JSON.stringify(change).length < JSON.stringify(full).length / 20);
  assert.ok(!JSON.stringify(change).includes('"path"'));
  const next = decoder.decode(change);
  assert.equal(next.groundUnits.length, 480);
  assert.deepEqual(next.groundUnits[0].path, s.groundUnits[0].path);
});

test('walking removes route heads and appends queued waypoints without retransmitting unchanged paid route points', () => {
  const s = fixture(),
    encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder();
  s.groundUnits[0].path = Array.from({ length: 64 }, (_, x) => ({ x, z: 30 }));
  const first = decoder.decode(wire(encoder.encode(s)));
  s.groundUnits[0].path.shift();
  s.groundUnits[0].path.push({ x: 64, z: 30 });
  const message = wire(encoder.encode(s));
  assert.ok(JSON.stringify(message).length < 350);
  assert.equal(message.delta.entities.groundUnits.splices[0][2], 1);
  assert.deepEqual(decoder.decode(message).groundUnits[0].path, s.groundUnits[0].path);
  assert.equal(first.groundUnits[0].path[0].x, 0);
  s.groundUnits[0].path = [{ x: 900, z: 1 }];
  assert.deepEqual(
    decoder.decode(wire(encoder.encode(s))).groundUnits[0].path,
    s.groundUnits[0].path,
  );
});
