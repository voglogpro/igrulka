import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import {
  playerView,
  compactPlayerView,
  snapshotPlayerView,
} from '../../src/network/perspective.js';
import { createSnapshotEncoder, createSnapshotDecoder } from '../../src/network/snapshots.js';
import { loadFixture } from '../support/network-load.mjs';

function fixture() {
  const s = E.createGame(8102, { mode: 'coop' });
  for (let side = 0; side < 4; side++) {
    const hq = s.buildings.find((b) => b.side === side);
    const u = E.makeGround(s, side, 'leopard', hq.x + 70, hq.z);
    u.prevX = u.x - 1;
    u.prevY = 1;
    u.prevZ = u.z;
    u.path = [{ x: u.x + 20, z: u.z }];
    u.routeQueue = [{ mode: 'move', x: u.x + 40, z: u.z }];
    u.order = { mode: 'move', x: u.x + 20, z: u.z };
    u.ammoCargo = { small: 7, shell: 0, rocket: 0, sam: 0 };
    s.groundUnits.push(u);
    hq.armyQueue = [
      {
        key: 'infantry',
        progress: 0.4,
        destination: { x: u.x, z: u.z },
        squadId: 500 + side,
        squadSlot: 0,
      },
    ];
    hq.rally = { x: u.x, z: u.z };
    s.units.push({
      id: s.nextId++,
      side,
      key: 'drone',
      x: hq.x,
      z: hq.z,
      y: 40,
      hp: 20,
      maxHp: 20,
      delay: 0,
      launched: true,
      status: 'flying',
      prevX: hq.x - 1,
      prevY: 39,
      prevZ: hq.z,
      vx: 90,
      vy: 1,
      vz: 2,
      tx: hq.x + 300,
      tz: hq.z + 90,
      route: [
        { x: hq.x, z: hq.z, d: 0 },
        { x: hq.x + 300, z: hq.z + 90, d: 320 },
      ],
      travelled: 1,
      total: 320,
    });
    s.projectiles.push({
      id: s.nextId++,
      side,
      domain: 'ground',
      kind: 'ground',
      sourceId: u.id,
      shooterKey: 'mlrs',
      x: u.x,
      y: 5,
      z: u.z,
      px: u.x - 1,
      py: 4,
      pz: u.z - 1,
      prevX: u.x - 1,
      vx: 12,
      vy: 5,
      vz: 1,
      life: 0.1,
      maxLife: 4,
      originX: u.x - 3,
      originY: 2,
      originZ: u.z - 2,
      gravity: 18,
      flight: 3,
      damage: 30,
      privateAim: { x: secret(side), z: 2 },
    });
  }
  return s;
}
const secret = (side) => 876543 + side;
test('projection never traverses discarded foreign routes, production, side ledgers or AI caches', () => {
  const s = fixture();
  const fail = () => {
    throw Error('private object was traversed');
  };
  for (const side of [1, 2, 3]) {
    for (const u of s.groundUnits.filter((u) => u.side === side))
      Object.defineProperty(u, 'privateCache', { enumerable: true, get: fail });
    for (const u of s.units.filter((u) => u.side === side))
      Object.defineProperty(u, 'route', { enumerable: true, get: fail });
    Object.defineProperty(s.buildings[side], 'armyQueue', { enumerable: true, get: fail });
    Object.defineProperty(s.sides[side], 'privateLedger', { enumerable: true, get: fail });
  }
  s.ai.privateCache = {};
  Object.defineProperty(s.ai.privateCache, 'expensive', { enumerable: true, get: fail });
  for (const fn of [playerView, compactPlayerView]) {
    const view = fn(s, 0);
    assert.equal(view.groundUnits.length, 4);
    assert.equal(view.units.length, 4);
    assert.equal(view.groundUnits.find((u) => u.side === 2).privateCache, undefined);
    assert.equal(view.units.find((u) => u.side === 1).route, undefined);
    assert.equal(view.ai, undefined);
  }
});
test('all four full and compact views are detached and retain their own paid work, routes and supply state', () => {
  const s = fixture(),
    before = E.save(s);
  for (let side = 0; side < 4; side++)
    for (const fn of [playerView, compactPlayerView]) {
      const view = fn(s, side),
        own = s.groundUnits.find((u) => u.side === side),
        u = view.groundUnits.find((u) => u.id === own.id);
      assert.equal(u.side, 0);
      assert.deepEqual(u.path, own.path);
      assert.deepEqual(u.routeQueue, own.routeQueue);
      assert.deepEqual(u.ammoCargo, own.ammoCargo);
      const hq = view.buildings.find((b) => b.id === side + 1);
      assert.deepEqual(hq.armyQueue, s.buildings[side].armyQueue);
      assert.deepEqual(hq.rally, s.buildings[side].rally);
      assert.deepEqual(view.units.find((u) => u.side === 0).route, s.units[side].route);
      u.path[0].x += 1;
      u.routeQueue[0].z += 1;
      u.ammoCargo.small = 0;
      hq.armyQueue[0].destination.z += 3;
      view.sides[0].inventory.drone = 99;
    }
  assert.equal(E.save(s), before);
});
test('compact transport removes collision-only history but preserves exact positions, ballistic origins and MLRS trails', () => {
  const s = fixture(),
    full = playerView(s, 0),
    compact = compactPlayerView(s, 0);
  assert.equal(Object.hasOwn(full.units[0], 'prevX'), true);
  assert.equal(Object.hasOwn(full.projectiles[0], 'px'), true);
  for (const collection of ['groundUnits', 'units', 'projectiles'])
    for (const u of compact[collection]) {
      for (const key of ['prevX', 'prevY', 'prevZ', 'px', 'py', 'pz'])
        assert.equal(Object.hasOwn(u, key), false);
      const authority = s[collection].find((v) => v.id === u.id);
      assert.equal(u.x, authority.x);
      assert.equal(u.z, authority.z);
    }
  for (const p of compact.projectiles) {
    const original = s.projectiles.find((v) => v.id === p.id);
    assert.equal(p.originX, original.originX);
    assert.equal(p.originZ, original.originZ);
    assert.equal(p.gravity, 18);
    assert.equal(p.shooterKey, 'mlrs');
    assert.equal(p.damage, undefined);
    assert.equal(p.privateAim, undefined);
  }
  assert.ok(Buffer.byteLength(JSON.stringify(compact)) < Buffer.byteLength(JSON.stringify(full)));
});
test('borrowed server views match compact data for every faction without mutating authority on remap', () => {
  const s = fixture(),
    before = E.save(s);
  for (let side = 0; side < 4; side++) {
    const borrowed = snapshotPlayerView(s, side),
      compact = compactPlayerView(s, side);
    assert.deepEqual(borrowed, compact);
    assert.equal(
      borrowed.groundUnits.find((u) => u.side === 0).path,
      s.groundUnits.find((u) => u.side === side).path,
    );
    assert.notEqual(
      borrowed.groundUnits.find((u) => u.side === 0),
      s.groundUnits.find((u) => u.side === side),
    );
  }
  assert.equal(E.save(s), before);
});
test('synchronous encoding detaches borrowed routes and budgets before authority changes, preserving the delta baseline', () => {
  const s = fixture(),
    encoder = createSnapshotEncoder(),
    decoder = createSnapshotDecoder();
  const encoded = encoder.encode(snapshotPlayerView(s, 2)),
    saved = JSON.stringify(encoded);
  const first = decoder.decode(JSON.parse(saved)),
    own = s.groundUnits.find((u) => u.side === 2),
    oldX = own.path[0].x;
  own.path[0].x += 7;
  s.buildings[2].armyQueue[0].destination.z += 4;
  s.sides[2].credits += 12.345;
  assert.equal(JSON.stringify(encoded), saved);
  assert.equal(first.groundUnits.find((u) => u.side === 0).path[0].x, oldX);
  const next = encoder.encode(snapshotPlayerView(s, 2));
  assert.ok(next.delta);
  const restored = decoder.decode(JSON.parse(JSON.stringify(next)));
  assert.equal(
    restored.groundUnits.find((u) => u.side === 0).path[0].x,
    Math.round((oldX + 7) * 100) / 100,
  );
  assert.equal(restored.sides[0].credits, s.sides[2].credits);
  assert.equal(
    first.groundUnits.find((u) => u.side === 0).path[0].x,
    oldX,
    'previous interpolation sample must be immutable',
  );
});
test('the reproducible network battle keeps its historical 120-per-city sample and fires real AA with normal drone HP', () => {
  const s = loadFixture(10);
  assert.equal(s.groundUnits.length, 480);
  for (let side = 0; side < 4; side++)
    assert.equal(
      s.groundUnits.filter((u) => u.side === side).length +
        s.buildings
          .filter((b) => b.side === side)
          .reduce((n, b) => n + (b.armyQueue?.length || 0), 0),
      120,
    );
  assert.ok(s.units.every((u) => u.hp === E.WEAPONS.drone.hp && u.maxHp === E.WEAPONS.drone.hp));
  assert.ok(
    s.units.every((u) => {
      const source = s.buildings.find((b) => b.id === u.sourceId && b.side === u.side);
      return source?.key === 'launcher' && E.launchSiteAllows(source, u.key);
    }),
    'already airborne stress aircraft must originate from current legal launch sites',
  );
  for (const b of s.buildings.filter((b) => E.launchStoreCapacity(b))) {
    assert.ok(Object.values(b.launchStore).every((n) => Number.isSafeInteger(n) && n >= 0));
    assert.equal(
      E.launchStoreTotal(b),
      0,
      'staged flights cannot be duplicated as ready rack stock',
    );
  }
  E.advance(s, 0.3);
  assert.ok(s.stats.shots > 0);
  assert.ok(s.projectiles.some((p) => p.domain !== 'ground'));
});
