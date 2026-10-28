import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import * as E from '../../src/game/index.js';

// Logic/economy endurance, not a frame-time benchmark. Only passive human HQ
// health is raised; every bot building, component, round and vehicle is paid.
const directory = new URL('../../artifacts/qa/813-planning/', import.meta.url);
mkdirSync(directory, { recursive: true });
const report = { version: E.VERSION, status: 'running', minutes: 20, cases: [] };
function persist() {
  writeFileSync(new URL('economy-soak.json', directory), JSON.stringify(report, null, 2));
}
persist();
try {
  for (const config of [
    { seed: 813, difficulty: 'normal' },
    { seed: 814, difficulty: 'hard' },
    { seed: 81, difficulty: 'hard', mode: 'coop' },
  ]) {
    let s = E.createGame(config.seed, config);
    const owners = E.sideIds(s),
      bots = owners.filter((side) => side % 2);
    for (const side of owners.filter((side) => side % 2 === 0))
      E.hqOf(s, side).hp = E.hqOf(s, side).maxHp = 1e8;
    const history = [],
      flights = owners.map(() => new Set()),
      produced = owners.map(() => new Set());
    let reloads = 0,
      assaults = owners.map(() => 0);
    for (let seconds = 0; seconds < 1200; seconds += 5) {
      E.advance(s, 5);
      for (const unit of s.units) if (unit.launched) flights[unit.side].add(unit.id);
      for (const event of s.events)
        if (event.type === 'produced') produced[event.side].add(event.key);
      for (const side of bots)
        assaults[side] = Math.max(assaults[side], E.defenseAttackStatus(s, side).active);
      assert.equal(s.result, null);
      for (const side of owners) {
        const f = s.sides[side];
        for (const key of [
          'credits',
          'materials',
          'oil',
          'components',
          'componentProductionSpent',
          'ammoProductionSpent',
        ])
          assert.ok(Number.isFinite(f[key]) && f[key] >= 0, `finite ${side}:${key}`);
        assert.ok(Number.isInteger(f.components) && f.components <= E.ELECTRONICS.capacity);
        assert.ok(f.oil <= E.oilStorage(s, side) + 1e-6);
      }
      if ((seconds + 5) % 60 === 0)
        history.push({
          seconds: seconds + 5,
          sides: bots.map((side) => {
            const f = s.sides[side];
            return {
              side,
              credits: f.credits,
              alloy: f.materials,
              oil: f.oil,
              oilRate: f.oilRate,
              chips: f.components,
              chipsPaid: f.componentProductionSpent,
              ammoPaid: f.ammoProductionSpent,
              flights: flights[side].size,
              army: s.groundUnits.filter((u) => u.side === side && u.hp > 0).length,
              buildings: s.buildings.filter((b) => b.side === side && b.hp > 0).map((b) => b.key),
            };
          }),
        });
      if ((seconds + 5) % 300 === 0) {
        const before = JSON.parse(E.save(s));
        s = E.load(E.save(s));
        reloads++;
        assert.deepEqual(s.sides, before.sides);
        assert.deepEqual(s.ammoVehicles, before.ammoVehicles);
        assert.deepEqual(s.groundUnits, before.groundUnits);
      }
    }
    for (const side of bots) {
      for (const key of [
        'electronics',
        'factory',
        'launcher',
        'barracks',
        'vehiclebase',
        'ammofactory',
        'oilwell',
      ])
        assert.ok(
          s.buildings.some((b) => b.side === side && b.key === key && b.hp > 0 && b.progress >= 1),
          `paid ready ${side}:${key}`,
        );
      assert.ok(s.sides[side].componentProductionSpent > 0, `bot${side} actually paid for chips`);
      assert.ok(s.sides[side].ammoProductionSpent > 0, `bot${side} actually paid for ammunition`);
      assert.ok(flights[side].size > 0, `bot${side} physically launched paid aircraft`);
    }
    report.cases.push({
      ...config,
      reloads,
      history,
      assaults,
      flights: flights.map((v) => v.size),
      produced: produced.map((v) => [...v]),
    });
    persist();
    console.log(
      `${config.mode || 'solo'} ${config.difficulty} seed${config.seed}:20min, paid chain, ${reloads} reloads PASS`,
    );
  }
  report.status = 'passed';
  persist();
} catch (error) {
  report.status = 'failed';
  report.failure = error.stack;
  persist();
  throw error;
}
