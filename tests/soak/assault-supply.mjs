// Functional paid logistics campaign. Ordinary starting resources, HP, oil,
// recruitment and ammunition recipes; no relocated units or injected cargo.
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import * as E from '../../src/game/index.js';
import { enrollCityAssault } from '../../src/game/units/ground/defense-attack.js';
import { assaultAmmunition } from '../../src/game/units/ground/assault-supply.js';

let s = E.createGame(8131, { mode: 'multiplayer' });
function place(side, key) {
  const hq = s.buildings.find((b) => b.side === side && b.key === 'hq');
  for (const z of [-75, -15])
    for (let dx = -300; dx <= 300; dx += 45) {
      if (E.canPlace(s, key, hq.x + dx, z, side)) continue;
      const b = E.build(s, side, key, hq.x + dx, z);
      if (typeof b === 'object') return b;
    }
  throw Error(`No funded site for ${side}:${key} at ${s.time}`);
}
for (const side of [0, 1]) {
  const hq = s.buildings.find((b) => b.side === side && b.key === 'hq');
  assert.equal(typeof E.buildRoad(s, side, hq.x - 90, -45, hq.x - 340, -45), 'object');
  assert.equal(typeof E.buildRoad(s, side, hq.x + 90, -45, hq.x + 340, -45), 'object');
  place(side, 'housing');
  place(side, 'industry');
  place(side, 'power');
}
E.advance(s, 120);
const ammo = place(0, 'ammofactory');
const barracks = place(0, 'barracks');
E.advance(s, 180);
const vehicles = place(0, 'vehiclebase');
// A real growing enemy city supplies several ordinary-HP targets.
for (let i = 0; i < 5; i++) {
  E.advance(s, 90);
  place(1, i % 2 ? 'industry' : 'housing');
}
E.advance(s, 180);
assert.equal(E.recruit(s, 0, 'infantry', barracks.id), true);
assert.equal(E.recruit(s, 0, 'howitzer', vehicles.id), true);
E.advance(s, 90);
let army = s.groundUnits.filter((u) => u.side === 0 && ['infantry', 'howitzer'].includes(u.key));
assert.equal(army.length, 2);
for (const u of army) {
  u.stance = { mode: 'attack' };
  assert.equal(enrollCityAssault(s, u), true);
}
let targets = s.buildings.filter((b) => b.side === 1);
const armyIds = new Set(army.map((u) => u.id));
const targetIds = new Set(targets.map((b) => b.id));
const evidence = {
  paid: 0,
  loadedVan: false,
  crate: false,
  supplyTrip: false,
  low: false,
  rejoined: false,
  pickups: [],
  trips: [],
  rejoinAt: null,
  destroyedAtRejoin: null,
  destroyed: 0,
  oilEnabled: s.rules.oil,
};
const previouslySupplying = new Set();
const pickedUp = new Set();
let restored = false;
for (let second = 0; second < 1500 && !s.result; second++) {
  let restoreAfterStep = false;
  const positions = new Map(
    army.map((u) => [u.id, { x: u.x, z: u.z, ammo: E.ammunitionStatus(s, u).total }]),
  );
  E.advance(s, 1);
  evidence.loadedVan ||= s.ammoVehicles.some((v) => v.cargo?.kind === 'ammo');
  evidence.crate ||= s.ammoCrates.some(
    (c) => c.side === 0 && Object.values(c.stock).some((n) => n > 0),
  );
  for (const u of army) {
    const old = positions.get(u.id);
    assert.ok(Math.hypot(u.x - old.x, u.z - old.z) <= E.GROUND_UNITS[u.key].speed + 1e-6);
    evidence.low ||= assaultAmmunition(s, u).low;
    const currentAmmo = E.ammunitionStatus(s, u).total;
    if (previouslySupplying.has(u.id) && currentAmmo > old.ammo) {
      pickedUp.add(u.id);
      evidence.pickups.push({ time: s.time, key: u.key, before: old.ammo, after: currentAmmo });
    }
    if (u.supplyTrip) {
      if (!previouslySupplying.has(u.id)) {
        const crate = s.ammoCrates.find((c) => c.id === u.supplyTrip.crateId);
        evidence.trips.push({
          time: s.time,
          key: u.key,
          x: u.x,
          z: u.z,
          crateX: crate.x,
          crateZ: crate.z,
          distance: Math.hypot(u.x - crate.x, u.z - crate.z),
        });
      }
      previouslySupplying.add(u.id);
      evidence.supplyTrip = true;
      if (!restored) {
        restoreAfterStep = true;
      }
    } else if (
      previouslySupplying.has(u.id) &&
      pickedUp.has(u.id) &&
      u.defenseAttack?.phase === 'active' &&
      !assaultAmmunition(s, u).low &&
      ['attack', 'attackmove'].includes(u.order?.mode)
    ) {
      evidence.rejoined = true;
      if (evidence.rejoinAt == null) {
        evidence.rejoinAt = s.time;
        evidence.destroyedAtRejoin = targets.filter((b) => b.hp <= 0).length;
      }
    }
  }
  evidence.destroyed = targets.filter((b) => b.hp <= 0).length;
  if (restoreAfterStep) {
    const saved = E.save(s);
    const loaded = E.load(saved);
    assert.deepEqual(loaded.sides, s.sides);
    assert.deepEqual(loaded.ammoCrates, s.ammoCrates);
    assert.deepEqual(loaded.ammoVehicles, s.ammoVehicles);
    for (const u of army) {
      const v = loaded.groundUnits.find((candidate) => candidate.id === u.id);
      assert.deepEqual(
        { x: v.x, z: v.z, trip: v.supplyTrip, ammo: E.ammunitionStatus(loaded, v).total },
        { x: u.x, z: u.z, trip: u.supplyTrip, ammo: E.ammunitionStatus(s, u).total },
      );
    }
    s = loaded;
    army = s.groundUnits.filter((u) => armyIds.has(u.id));
    targets = s.buildings.filter((b) => targetIds.has(b.id));
    restored = true;
    evidence.restoredAt = s.time;
  }
  if (evidence.rejoined && evidence.destroyed >= Math.max(3, evidence.destroyedAtRejoin + 1)) break;
}
evidence.paid = s.sides[0].ammoProductionSpent;
assert.ok(evidence.paid > 0);
assert.ok(
  evidence.loadedVan && evidence.crate && evidence.low && evidence.supplyTrip && evidence.rejoined,
);
assert.ok(evidence.destroyed >= 3);
assert.ok(evidence.destroyed > evidence.destroyedAtRejoin);
assert.ok(evidence.pickups.length > 0);
assert.ok(evidence.trips.some((t) => t.distance > 36));
assert.equal(evidence.oilEnabled, true);
assert.ok(restored);
assert.ok(s.buildings.find((b) => b.id === ammo.id).hp > 0);
writeFileSync(
  new URL('../../artifacts/qa/assault-supply8131.json', import.meta.url),
  JSON.stringify(evidence, null, 2),
);
console.log(evidence);
