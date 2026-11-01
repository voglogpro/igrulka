import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/index.js';
import { prepareDefensivePosition } from '../src/game/defense/fortifications.js';
import { trenchSlotPoint } from '../src/game/defense/trench-footprint.js';
import { height } from '../src/rendering/terrain/environment.js';

// SYNTHETIC VISUAL ONLY. Factory-default soldiers are placed explicitly for art QA.
// This fixture proves neither paid recruitment, balance, pathfinding nor battle performance.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.resolve(process.argv[2] || path.join(root, 'artifacts/native/terrain-qa'));
await mkdir(directory, { recursive: true });
const state = E.createGame(8163021, { difficulty: 'normal', mode: 'solo' });
const originalResources = structuredClone(
  state.sides.map(({ credits, materials, components, oil }) => ({
    credits,
    materials,
    components,
    oil,
  })),
);
const cases = [
  { x: -1815, z: 0, yaw: 0, progress: 1, work: 30, label: 'flat-full' },
  { x: -1770, z: 28, yaw: 0.62, progress: 0.42, work: 0, label: 'flat-digging' },
  { x: -2020, z: 480, yaw: Math.PI / 2, progress: 1, work: 90, label: 'slope-longitudinal' },
  { x: -2080, z: 480, yaw: -0.55, progress: 1, work: 0, label: 'slope-oblique' },
];
const unitCases = [];
for (const item of cases) {
  assert.ok(E.inField(item.x, item.z, 20) && !E.isWater(item.x, item.z));
  const builder = E.makeGround(state, 0, 'infantry', item.x, item.z);
  Object.assign(builder, {
    y: 1 + E.groundHeight(item.x, item.z),
    yaw: item.yaw,
    guard: { x: item.x, z: item.z },
  });
  state.groundUnits.push(builder);
  const trench = prepareDefensivePosition(state, builder);
  assert.ok(trench, 'Original position constructor rejected ' + item.label);
  Object.assign(trench, { progress: item.progress, fortificationWork: item.work });
  item.trenchId = trench.id;
  for (const [index, key] of [
    [0, 'infantry'],
    [1, 'mog'],
    [2, 'machinegunner'],
  ]) {
    const point = trenchSlotPoint(trench, index);
    const unit = index === 0 ? builder : E.makeGround(state, 0, key, point.x, point.z);
    Object.assign(unit, {
      x: point.x,
      z: point.z,
      y: 1 + E.groundHeight(point.x, point.z),
      yaw: trench.yaw,
      trenchId: trench.id,
      digging: item.progress < 1,
      guard: { ...point },
      setup: key === 'mog' ? 1 : 0,
    });
    if (index !== 0) state.groundUnits.push(unit);
    unitCases.push({ id: unit.id, key, trenchId: trench.id, label: item.label, slot: index });
  }
  const dx = Math.cos(item.yaw) * 9,
    dz = -Math.sin(item.yaw) * 9;
  item.expectedRoll = Math.atan2(
    height(item.x + dx, item.z + dz) - height(item.x - dx, item.z - dz),
    18,
  );
}
const first = cases[0];
const departing = E.makeGround(state, 0, 'infantry', first.x + 12, first.z);
Object.assign(departing, {
  y: 1 + E.groundHeight(departing.x, departing.z),
  trenchId: first.trenchId,
  moving: true,
  yaw: Math.PI / 2,
});
state.groundUnits.push(departing);
unitCases.push({ id: departing.id, key: departing.key, trenchId: first.trenchId, departing: true });
assert.equal(state.trenches.length, 4);
assert.equal(state.groundUnits.length, 13);
assert.ok(
  cases.slice(2).every((item) => Math.abs(item.expectedRoll) > 0.025),
  'Use real source slopes, not forged render poses',
);
assert.deepEqual(
  state.sides.map(({ credits, materials, components, oil }) => ({
    credits,
    materials,
    components,
    oil,
  })),
  originalResources,
);
const raw = E.save(state);
const restored = E.load(raw);
assert.equal(restored.trenches.length, 4);
assert.equal(restored.groundUnits.length, 13);
assert.deepEqual(
  restored.groundUnits.map((u) => u.id),
  state.groundUnits.map((u) => u.id),
);
const sha256 = createHash('sha256').update(raw).digest('hex');
const fixture = {
  raw,
  sha256,
  syntheticVisualOnly: true,
  paidProduction: false,
  expected: {
    trenches: restored.trenches.map((t) => ({ ...t })),
    units: unitCases,
    resources: originalResources,
    counts: {
      buildings: restored.buildings.length,
      groundUnits: restored.groundUnits.length,
      trenches: restored.trenches.length,
    },
  },
  cases,
  holdMilliseconds: 6500,
  cameras: [
    {
      name: 'close-day',
      x: -1793,
      z: 12,
      distance: 100,
      yaw: -0.65,
      pitch: 0.64,
      time: 875,
      weather: { kind: 'clear', amount: 0 },
    },
    {
      name: 'slope-night',
      x: -2050,
      z: 480,
      distance: 120,
      yaw: 0.65,
      pitch: 0.65,
      time: 275,
      weather: { kind: 'fog', amount: 0.45 },
    },
    {
      name: 'city-wet',
      x: -1935,
      z: 75,
      distance: 370,
      yaw: -0.85,
      pitch: 0.62,
      time: 875,
      weather: { kind: 'rain', amount: 0.35 },
    },
  ],
  limitations: [
    'Synthetic unpaid paused art fixture',
    'No AI/pathfinding/balance/performance claim',
    'Source map is deliberately flat near HQ; real inclined cases are 480m north',
    'Temporary day/weather overrides are restored before final save equality',
  ],
};
const template = await readFile(path.join(root, 'scripts/native-terrain-qa.js'), 'utf8');
const output = path.join(directory, 'native-terrain-qa.generated.js');
await writeFile(path.join(directory, 'fixture.json'), raw, 'utf8');
await writeFile(
  output,
  'window.__SKYFRONT_TERRAIN_FIXTURE__=' + JSON.stringify(fixture) + ';\n' + template,
  'utf8',
);
const report = {
  passed: true,
  syntheticVisualOnly: true,
  paidProduction: false,
  sha256,
  output,
  cases,
  counts: fixture.expected.counts,
  holdMilliseconds: fixture.holdMilliseconds,
  limitations: fixture.limitations,
};
await writeFile(
  path.join(directory, 'prepare-report.json'),
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);
console.log(JSON.stringify(report, null, 2));
