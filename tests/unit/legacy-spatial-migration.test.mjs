import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../src/game/index.js';
import { LEGACY_OIL_FIELDS, expandLegacyX, expandV23X, expandLegacyZ } from '../../src/game/map.js';
const migrateX = (x) => expandV23X(expandLegacyX(x));

function legacy(version = 14) {
  const s = E.createGame(8914);
  s.version = version;
  s.mode = 'multiplayer';
  for (const b of s.buildings) b.x -= Math.sign(b.x) * 592;
  for (const r of s.roads) {
    r.ax -= Math.sign(r.ax) * 592;
    r.bx -= Math.sign(r.bx) * 592;
  }
  return s;
}
function building(s, key, x, z, side = 0) {
  const b = {
    id: s.nextId++,
    side,
    key,
    x,
    z,
    hp: E.BUILDINGS[key].hp,
    maxHp: E.BUILDINGS[key].hp,
    progress: 1,
    rotation: 0,
    queue: [],
  };
  s.buildings.push(b);
  return b;
}
function connector(s, b) {
  const r = {
    id: s.nextId++,
    side: b.side,
    ax: b.x + Math.sign(b.x) * 70,
    az: b.z,
    bx: b.x + Math.sign(b.x) * 18,
    bz: b.z,
    hp: 120,
    maxHp: 120,
    connectorTo: b.id,
  };
  s.roads.push(r);
  b.roadLink = r.id;
  return r;
}
function oldSea(x, z) {
  const qx = Math.abs(x - E.riverX(z)) - 80,
    qz = Math.abs(z) - 1000;
  return (
    Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) +
    Math.min(Math.max(qx, qz), 0) -
    120 +
    Math.sin(x * 0.031 + z * 0.017) * 9 +
    Math.sin(z * 0.043 + x * 0.006) * 6
  );
}
function oldPortX(sign, z) {
  let low = 0,
    high = 500;
  for (let i = 0; i < 45; i++) {
    const mid = (low + high) / 2;
    if (oldSea(sign * mid, z) < 20) low = mid;
    else high = mid;
  }
  return (sign * (low + high)) / 2;
}

for (const version of [13, 14])
  test(`v${version} off-centre paid wells preserve field-relative offsets and attached driveways`, () => {
    const s = legacy(version),
      originals = [];
    for (const old of LEGACY_OIL_FIELDS.filter((f) => Math.abs(f.x) === 90)) {
      const z = version < 14 ? old.z : expandLegacyZ(old.z);
      const b = building(s, 'oilwell', old.x + 10, z + 8, old.x < 0 ? 0 : 1),
        road = connector(s, b);
      originals.push({ b, road, field: E.OIL_FIELDS.find((f) => f.id === old.id) });
    }
    const before = structuredClone(s),
      loaded = E.load(E.save(s));
    assert.deepEqual(s, before);
    for (const { b, road, field } of originals) {
      const current = loaded.buildings.find((v) => v.id === b.id),
        link = loaded.roads.find((v) => v.id === road.id);
      assert.equal(
        E.oilFieldAt(current.x, current.z)?.id,
        field.id,
        'paid well still taps the same field',
      );
      assert.ok(Math.abs(current.x - field.x - 10) < 1e-9);
      assert.ok(Math.abs(current.z - field.z - 8) < 1e-9);
      assert.ok(Math.abs(link.bx - current.x - (road.bx - b.x)) < 1e-9);
      assert.ok(Math.abs(link.bz - current.z - (road.bz - b.z)) < 1e-9);
      assert.equal(link.ax, migrateX(road.ax), 'junction stays on the transformed main road');
      const again = E.load(E.save(loaded)).buildings.find((v) => v.id === b.id);
      assert.deepEqual(again, current);
    }
  });

test('v14 shore ports remain on the new shore across both z grids, preserving IDs, payment and quay attachments once', () => {
  const s = legacy(),
    originals = [];
  for (const sign of [-1, 1])
    for (let z = -900; z <= 900; z += 100) {
      const b = building(s, 'port', oldPortX(sign, z), z, sign < 0 ? 0 : 1),
        road = connector(s, b);
      assert.ok(Math.abs(oldSea(b.x, b.z) - 20) < 1e-6, 'fixture is on the original valid shore');
      originals.push({ b, road });
    }
  const before = structuredClone(s),
    loaded = E.load(E.save(s));
  assert.deepEqual(s, before);
  assert.deepEqual(
    loaded.sides.map((f) => [f.credits, f.materials, f.oil]),
    s.sides.map((f) => [f.credits, f.materials, f.oil]),
  );
  for (const { b, road } of originals) {
    const current = loaded.buildings.find((v) => v.id === b.id),
      link = loaded.roads.find((v) => v.id === road.id);
    const shore = E.seaDistance(current.x, current.z);
    assert.ok(shore >= 8 && shore <= 34, `port ${b.id} has invalid new shore distance ${shore}`);
    assert.equal(current.hp, b.hp);
    assert.equal(current.side, b.side);
    assert.ok(Math.abs(link.bx - current.x - (road.bx - b.x)) < 1e-8);
    assert.ok(Math.abs(link.bz - current.z - (road.bz - b.z)) < 1e-8);
    assert.equal(link.ax, migrateX(road.ax));
    assert.ok(E.seaDistance(E.berthOf(current).x, E.berthOf(current).z) < 0);
    const again = E.load(E.save(loaded)).buildings.find((v) => v.id === b.id);
    assert.deepEqual(again, current, 'v15 import must never move the port a second time');
  }
});
