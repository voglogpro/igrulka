import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import * as E from '../../src/game/index.js';
const summaries = [];
const reportDirectory = new URL('../../artifacts/qa/', import.meta.url);
mkdirSync(reportDirectory, { recursive: true });
const report = {
  campaigns: 0,
  minutesPerCampaign: 20,
  version: E.VERSION,
  status: 'running',
  summaries,
};
const saveReport = () =>
  writeFileSync(new URL('soak89-final.json', reportDirectory), JSON.stringify(report, null, 2));
writeFileSync(
  new URL('soak89-final.log', reportDirectory),
  '8.9 campaign soak: 12 x 20 game minutes; ordinary paid AI, no resource grants\n',
);
try {
  for (let seed = 1; seed <= 12; seed++) {
    const s = E.createGame(seed);
    // Keep only the passive player's headquarters alive so all twelve full campaigns can finish.
    // Economy, construction, ammunition, fleet and army purchases use ordinary starting resources.
    s.buildings[0].hp = s.buildings[0].maxHp = 1e8;
    const cargoVehicles = new Set();
    for (let seconds = 0; seconds < 1200; seconds += 5) {
      E.advance(s, 5);
      for (const v of s.ammoVehicles) if (v.cargo) cargoVehicles.add(v.id);
      for (const f of s.sides)
        for (const kind of E.AMMUNITION.kinds) {
          assert.ok(
            Number.isSafeInteger(f.ammoStock[kind]) &&
              f.ammoStock[kind] >= 0 &&
              f.ammoStock[kind] <= E.AMMUNITION.stock[kind],
            `seed ${seed}: bounded paid ${kind} stock`,
          );
        }
      for (const u of [...s.buildings, ...s.groundUnits]) {
        const profile = E.ammunitionProfile(u);
        if (!profile) continue;
        assert.ok(
          Number.isSafeInteger(u.ammoReserve) &&
            u.ammoReserve >= 0 &&
            u.ammoReserve <= profile.capacity,
          `seed ${seed}: finite reserve ${u.key}:${u.id}`,
        );
        assert.ok(
          Number.isSafeInteger(u[profile.field]) &&
            u[profile.field] >= 0 &&
            u[profile.field] <= profile.capacity,
          `seed ${seed}: finite magazine ${u.key}:${u.id}`,
        );
      }
      for (const side of [0, 1])
        assert.ok(s.ammoVehicles.filter((v) => v.side === side).length <= E.AMMUNITION.fleetLimit);
    }
    for (const f of s.sides)
      for (const key of ['credits', 'materials', 'science'])
        assert.ok(Number.isFinite(f[key]) && f[key] >= 0);
    for (const b of s.buildings)
      for (const key of ['hp', 'progress', 'x', 'z']) assert.ok(Number.isFinite(b[key]));
    for (const u of s.groundUnits)
      for (const key of ['hp', 'x', 'z']) assert.ok(Number.isFinite(u[key]));
    for (const d of s.districts) {
      assert.ok(Number.isFinite(d.hp) && d.hp >= 0);
      assert.ok(Number.isFinite(d.control) && Math.abs(d.control) <= 1);
      assert.ok([null, 0, 1].includes(d.owner));
    }
    assert.ok(s.stats.districtsCaptured >= 2, `seed ${seed}: bot must capture sites`);
    assert.ok(s.buildings.some((b) => b.side === 1 && b.key === 'barracks'));
    assert.ok(s.groundUnits.some((u) => u.side === 1));
    assert.ok(s.buildings.some((b) => b.side === 1 && b.key === 'vehiclebase'));
    assert.ok(s.buildings.some((b) => b.side === 1 && b.key === 'factory' && b.progress >= 1));
    for (const key of ['ammofactory', 'silo'])
      assert.ok(
        s.buildings.some((b) => b.side === 1 && b.key === key && b.hp > 0 && b.progress >= 1),
        `seed ${seed}: paid ready ${key}`,
      );
    assert.ok(
      s.buildings.every(
        (b) => Number.isInteger(b.level || 0) && (b.level || 0) >= 0 && (b.level || 0) <= 2,
      ),
    );
    assert.ok(
      s.groundUnits.every((u) => Number.isInteger(u.level) && u.level >= 0 && u.level <= 2),
    );
    assert.ok(
      s.groundUnits.every((u) => u.maxHp === E.GROUND_UNITS[u.key].hp),
      'individual equipment never increases unit health',
    );
    for (const f of s.sides) {
      assert.deepEqual(f.tech, []);
      assert.equal(f.research, null);
      assert.deepEqual(f.researchQueue, []);
    }
    assert.ok(s.buildings.every((b) => b.key !== 'lab'));
    assert.ok(
      E.weaponStock(s, 1, 'cruise') > 0 ||
        s.units.some((u) => u.side === 1 && u.key === 'cruise') ||
        s.buildings.some((b) => b.side === 1 && b.queue?.some((q) => q.key === 'cruise')),
      `seed ${seed}: paid missile production must remain available without research`,
    );
    assert.ok(s.stats.impacts > 10);
    assert.ok(s.buildings.filter((b) => b.side === 1 && b.key === 'housing').length >= 8);
    assert.ok(s.buildings.filter((b) => b.side === 1 && b.key === 'sam').length >= 2);
    const restored = E.load(E.save(s));
    assert.deepEqual(restored.sides, s.sides);
    assert.equal(restored.time, s.time);
    assert.deepEqual(restored.districts, s.districts);
    assert.deepEqual(restored.ammoVehicles, s.ammoVehicles);
    assert.ok(
      Object.values(s.sides[1].ammoStock).some((n) => n > 0) ||
        s.ammoVehicles.some((v) => v.side === 1 && v.cargo?.kind === 'ammo'),
      `seed ${seed}: actual paid ammunition production`,
    );
    summaries.push({
      seed,
      buildings: s.buildings.length,
      research: s.sides[1].researchQueue.length,
      impacts: s.stats.impacts,
      army: s.groundUnits.length,
      crossed: s.groundUnits.filter((u) => u.side === 1 && u.x < 0).length,
      vehiclebases: s.buildings.filter((b) => b.side === 1 && b.key === 'vehiclebase').length,
      districts: s.districts.filter((d) => d.owner === 1).length,
      captures: s.stats.districtsCaptured,
      ammoStock: { ...s.sides[1].ammoStock },
      fleet: s.ammoVehicles.filter((v) => v.side === 1 && v.hp > 0).length,
      cargoVehiclesObserved: cargoVehicles.size,
      cruiseStock: E.weaponStock(s, 1, 'cruise'),
    });
    report.campaigns = summaries.length;
    const line = JSON.stringify(summaries.at(-1));
    console.log(line);
    appendFileSync(new URL('soak89-final.log', reportDirectory), line + '\n');
    saveReport();
  }
  report.status = 'passed';
  saveReport();
  console.log(JSON.stringify(report));
} catch (error) {
  report.status = 'failed';
  report.failure = { seed: summaries.length + 1, message: error.message };
  saveReport();
  appendFileSync(
    new URL('soak89-final.log', reportDirectory),
    'FAIL ' + JSON.stringify(report.failure) + '\n',
  );
  throw error;
}
