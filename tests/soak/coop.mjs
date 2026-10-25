import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as E from '../../src/game/index.js';

const reports = [],
  directory = new URL('../../artifacts/qa/', import.meta.url);
mkdirSync(directory, { recursive: true });
for (const seed of [81, 810, 8100]) {
  let s = E.createGame(seed, { mode: 'coop' });
  for (const side of [0, 2]) E.hqOf(s, side).hp = E.hqOf(s, side).maxHp = 1e8;
  let reloads = 0;
  for (let seconds = 0; seconds < 1200; seconds += 5) {
    E.advance(s, 5);
    assert.equal(s.result, null, 'both passive human cities survive the full simulation');
    for (const side of E.sideIds(s)) {
      for (const key of ['credits', 'materials', 'oil'])
        assert.ok(Number.isFinite(s.sides[side][key]) && s.sides[side][key] >= 0);
      assert.ok(s.ammoVehicles.filter((v) => v.side === side).length <= E.AMMUNITION.fleetLimit);
    }
    for (const entity of [...s.buildings, ...s.groundUnits, ...s.units, ...s.ammoVehicles]) {
      assert.ok(E.validSide(s, entity.side));
      assert.ok(
        Number.isFinite(entity.x) && Number.isFinite(entity.z) && Number.isFinite(entity.hp),
      );
    }
    if (seconds === 395 || seconds === 795) {
      const stocks = JSON.parse(JSON.stringify(s.sides)),
        cities = JSON.parse(JSON.stringify(s.buildings));
      s = E.load(E.save(s));
      reloads++;
      assert.deepEqual(s.sides, stocks);
      assert.deepEqual(s.buildings, cities);
    }
  }
  for (const side of [1, 3]) {
    for (const key of ['housing', 'industry', 'barracks', 'vehiclebase', 'factory', 'ammofactory'])
      assert.ok(
        s.buildings.some((b) => b.side === side && b.key === key && b.progress >= 1),
        `seed${seed} bot${side} paid ${key}`,
      );
    assert.ok(
      s.groundUnits.some((u) => u.side === side),
      `seed${seed} bot${side} recruited an army`,
    );
    assert.ok(
      s.settlements.some((d) => d.owner === side),
      `seed${seed} bot${side} connected a settlement`,
    );
    assert.ok(s.sides[side].spentAmmo > 0, `seed${seed} bot${side} launched paid aircraft`);
  }
  reports.push({
    seed,
    gameSeconds: s.time,
    reloads,
    buildings: s.buildings.length,
    army: s.groundUnits.length,
    settlements: s.settlements.map((d) => ({ id: d.id, owner: d.owner })),
    bots: [1, 3].map((side) => ({
      side,
      spentAmmo: s.sides[side].spentAmmo,
      credits: s.sides[side].credits,
    })),
  });
  process.stdout.write(
    `Coop seed ${seed}: 20 game minutes, 4 cities, both paid bots, save/load x${reloads} PASS\n`,
  );
  writeFileSync(
    new URL('coop810.json', directory),
    JSON.stringify({ status: reports.length === 3 ? 'pass' : 'running', reports }, null, 2),
  );
}
