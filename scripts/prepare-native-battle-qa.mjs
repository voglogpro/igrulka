import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/index.js';

// SYNTHETIC DENSITY ONLY. Five hundred unpaid factory-default units are initial fixture data.
// Facilities are paid and built through original commands/ticks. No HP/ammo/stock/resource buffs.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'artifacts/native/battle-qa');
await mkdir(directory, { recursive: true });
const state = E.createGame(8163500, { mode: 'multiplayer', difficulty: 'normal' });
assert.deepEqual(E.aiSides(state), [], 'Original two-human mode; no edited AI schedules');
const ledger = [];
const resourceFields = ['credits', 'materials', 'components', 'oil'];
const resources = (side) =>
  Object.fromEntries(resourceFields.map((key) => [key, state.sides[side][key] || 0]));
for (const side of [0, 1]) {
  assert.deepEqual(resources(side), { credits: 3200, materials: 200, components: 0, oil: 150 });
  const hq = state.buildings.find((b) => b.side === side && b.key === 'hq');
  for (const key of ['power', 'housing', 'ammofactory']) {
    let building;
    const before = resources(side);
    for (let z = -12; z >= -115 && !building; z -= 12)
      for (let x = hq.x - 120; x <= hq.x + 120 && !building; x += 12) {
        if (E.canPlace(state, key, x, z, side)) continue;
        const result = E.build(state, side, key, x, z);
        if (typeof result !== 'string' && result) building = result;
      }
    assert.ok(building, 'No paid original plot for ' + side + '/' + key);
    const after = resources(side);
    assert.ok(after.credits < before.credits && after.materials < before.materials);
    ledger.push({ side, key, id: building.id, before, after });
  }
}
let setupSteps = 0;
while (state.buildings.some((b) => b.progress < 1) && setupSteps < 4000) {
  E.step(state, 0.05);
  setupSteps++;
}
assert.ok(
  state.buildings.every((b) => b.progress === 1),
  'Real facility construction completes',
);
const composition = {
  infantry: 120,
  machinegunner: 35,
  mog: 15,
  atrifle: 15,
  atgm: 10,
  engineer: 10,
  medic: 15,
  leopard: 10,
  supplytruck: 10,
  howitzer: 5,
  mlrs: 5,
};
const units = [],
  commands = [];
const signature = (unit) =>
  Object.fromEntries(
    [
      'hp',
      'maxHp',
      'ammo',
      'ammoReserve',
      'groundAmmo',
      'groundReload',
      'reloadLeft',
      'fpvAmmo',
      'ammoCargo',
      'level',
    ]
      .filter((key) => unit[key] !== undefined)
      .map((key) => [key, structuredClone(unit[key])]),
  );
for (const side of [0, 1]) {
  const sign = side === 0 ? -1 : 1;
  const lanes = E.CORRIDORS.map((z) => {
    const points = [];
    for (let x = 80; x <= 352; x += 16)
      for (let offset = -80; offset <= 80; offset += 16) {
        const point = { x: sign * x, z: z + offset };
        if (
          !E.isWater(point.x, point.z) &&
          E.inField(point.x, point.z, 10) &&
          E.walkable(state, point.x, point.z, 5)
        )
          points.push(point);
      }
    return { z, points, units: [] };
  });
  let cursor = 0;
  for (const [key, count] of Object.entries(composition))
    for (let i = 0; i < count; i++) {
      const lane = lanes[cursor++ % lanes.length];
      const point = lane.points[lane.units.length];
      assert.ok(point, 'Enough separate valid dry initial positions');
      const unit = E.makeGround(state, side, key, point.x, point.z);
      const defaults = signature(unit);
      unit.y = 1 + E.groundHeight(unit.x, unit.z);
      unit.yaw = side === 0 ? Math.PI / 2 : -Math.PI / 2;
      state.groundUnits.push(unit);
      lane.units.push(unit);
      assert.deepEqual(signature(unit), defaults);
      units.push({ id: unit.id, side, key, x: unit.x, z: unit.z, defaults });
    }
  for (const lane of lanes) {
    const combat = lane.units.filter((u) => !E.GROUND_UNITS[u.key].support);
    for (let start = 0; start < combat.length; start += 12) {
      const ids = combat.slice(start, start + 12).map((u) => u.id);
      const aim = {
        x: -sign * 70,
        z: lane.z + ((Math.floor(start / 12) % 3) - 1) * 16,
        mode: 'attackmove',
      };
      const accepted = E.orderGround(state, side, ids, aim, { defer: true });
      assert.equal(accepted, ids.length, 'All initial tactical orders accepted');
      commands.push({ side, ids, aim, accepted });
    }
  }
}
assert.equal(state.groundUnits.length, 500);
assert.equal(units.filter((u) => u.side === 0).length, 250);
for (const item of units)
  assert.deepEqual(
    signature(state.groundUnits.find((u) => u.id === item.id)),
    item.defaults,
    'Orders cannot grant health or ammo',
  );
const raw = E.save(state),
  restored = E.load(raw);
assert.equal(restored.groundUnits.length, 500);
for (const item of units)
  assert.deepEqual(
    signature(restored.groundUnits.find((u) => u.id === item.id)),
    item.defaults,
    'Save/load retains factory defaults',
  );
const sha256 = createHash('sha256').update(raw).digest('hex');
const fixture = {
  raw,
  sha256,
  syntheticDensityOnly: true,
  paidRecruitment: false,
  battleSeconds: 60,
  expected: {
    count: 500,
    units,
    setupTime: restored.time,
    resources: restored.sides.map((_, side) => resources(side)),
    facilities: ledger.map((item) => ({ id: item.id, key: item.key, side: item.side })),
  },
  cameras: [
    { x: 0, z: E.CORRIDORS[0], distance: 540 },
    { x: 0, z: E.CORRIDORS[1], distance: 540 },
  ],
  limitations: [
    '500 initial units are synthetic unpaid density; all constructor HP/ammo/reserves are unchanged',
    'Original two-human simulation mode, not a bot-economic difficulty or multiplayer acceptance',
    'Facilities use paid original construction/ticks; no manually filled stock, crates or cargo',
    'Browser battle uses60wallseconds of normal unpaused ticks, not E.step or time acceleration',
    'Observed event counts are lower bounds because the original event buffer is bounded',
  ],
};
await writeFile(path.join(directory, 'fixture.json'), raw, 'utf8');
const template = await readFile(path.join(root, 'scripts/native-battle-qa.js'), 'utf8');
await writeFile(
  path.join(directory, 'native-battle-qa.generated.js'),
  'window.__SKYFRONT_BATTLE_FIXTURE__=' + JSON.stringify(fixture) + ';\n' + template,
  'utf8',
);
const report = {
  passed: true,
  syntheticDensityOnly: true,
  paidRecruitment: false,
  sha256,
  setupSteps,
  setupTime: restored.time,
  count: 500,
  compositionPerSide: composition,
  paidFacilities: ledger,
  initialOrders: commands.length,
  browserScript: path.join(directory, 'native-battle-qa.generated.js'),
  limitations: fixture.limitations,
};
await writeFile(
  path.join(directory, 'prepare-report.json'),
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);
console.log(JSON.stringify(report, null, 2));
if (process.argv.includes('--preflight')) {
  const probe = E.load(raw),
    started = performance.now();
  const initial = new Map(
    probe.groundUnits.map((u) => [
      u.id,
      {
        x: u.x,
        z: u.z,
        hp: u.hp,
        ammo: (u.ammo || 0) + (u.groundAmmo || 0) + (u.ammoReserve || 0),
      },
    ]),
  );
  const moved = new Set(),
    spent = new Set(),
    wounded = new Set(),
    patients = new Set();
  let shots = 0,
    lastEvent = 0,
    maxSupplyVehicles = 0,
    maxCrates = 0,
    maxReloading = 0,
    healed = 0;
  const previousHp = new Map(probe.groundUnits.map((u) => [u.id, u.hp]));
  for (let tick = 0; tick < 1200; tick++) {
    E.step(probe, 0.05);
    for (const event of probe.events)
      if (event.id > lastEvent) {
        if (event.type === 'shot' && event.ground) shots++;
      }
    lastEvent = Math.max(lastEvent, ...probe.events.map((e) => e.id));
    if (tick % 5 !== 0) continue;
    maxSupplyVehicles = Math.max(maxSupplyVehicles, probe.ammoVehicles.length);
    maxCrates = Math.max(maxCrates, probe.ammoCrates.length);
    maxReloading = Math.max(
      maxReloading,
      probe.groundUnits.filter((u) => u.groundReload > 0 || u.reloadLeft > 0).length,
    );
    for (const unit of probe.groundUnits) {
      const before = initial.get(unit.id);
      if (!before) continue;
      if (Math.hypot(unit.x - before.x, unit.z - before.z) > 1) moved.add(unit.id);
      if (unit.hp < unit.maxHp) wounded.add(unit.id);
      if ((unit.ammo || 0) + (unit.groundAmmo || 0) + (unit.ammoReserve || 0) < before.ammo)
        spent.add(unit.id);
      if (unit.hp > (previousHp.get(unit.id) ?? unit.hp)) healed++;
      previousHp.set(unit.id, unit.hp);
      if (unit.key === 'medic' && unit.patientId) patients.add(unit.id);
      assert.ok(Number.isFinite(unit.x + unit.y + unit.z + unit.hp) && unit.hp <= unit.maxHp);
    }
  }
  const outcome = {
    passed: shots > 0 && moved.size > 0 && spent.size > 0 && wounded.size > 0,
    scope: 'Original CPU60simulationseconds preflight; not native real-time performance',
    elapsedCpuMs: performance.now() - started,
    simulationElapsed: probe.time - restored.time,
    shotsObserved: shots,
    moved: moved.size,
    ammoUsed: spent.size,
    wounded: wounded.size,
    healedObservations: healed,
    medicsWithPatients: patients.size,
    maxReloading,
    maxSupplyVehicles,
    maxCrates,
    remaining: probe.groundUnits.length,
  };
  await writeFile(
    path.join(directory, 'cpu-preflight.json'),
    JSON.stringify(outcome, null, 2) + '\n',
    'utf8',
  );
  console.log(JSON.stringify(outcome, null, 2));
  assert.equal(outcome.passed, true);
}
