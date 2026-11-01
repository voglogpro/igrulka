import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as E from '../src/game/index.js';
import { save, load } from '../src/game/persistence/saves.js';
import { projectNativeState } from '../native/runtime/bridge.mjs';

// Unpaid initial entities for a paused render/IPC fixture. This is not a campaign,
// balance scenario, combat test or simulation performance measurement.
const state = E.createGame(816500, { difficulty: 'normal', mode: 'solo' });
const beforeResources = JSON.stringify(state.sides);
const hq = state.buildings.find((b) => b.side === 0 && b.key === 'hq');
const expected = new Map();
const spawn = (key, dx, dz) => {
  const x = hq.x + dx,
    z = hq.z + dz;
  assert.ok(E.inField(x, z));
  assert.equal(E.isWater(x, z), false);
  assert.ok(E.groundHeight(x, z) <= 1.2, `Expected planned flat plot: ${key} at ${x},${z}`);
  const unit = E.makeGround(state, 0, key, x, z);
  state.groundUnits.push(unit);
  expected.set(unit.id, {
    key: unit.key,
    hp: unit.hp,
    maxHp: unit.maxHp,
    groundAmmo: unit.groundAmmo,
    ammo: unit.ammo,
    ammoReserve: unit.ammoReserve,
  });
};
for (let i = 0; i < 450; i++)
  spawn(i < 400 ? 'infantry' : 'machinegunner', -155 + (i % 30) * 9, 100 + Math.floor(i / 30) * 9);
for (let i = 0; i < 30; i++) spawn('leopard', -165 + (i % 10) * 35, -150 - Math.floor(i / 10) * 35);
for (let i = 0; i < 20; i++)
  spawn('supplytruck', -135 + (i % 10) * 30, -290 - Math.floor(i / 10) * 30);
assert.equal(JSON.stringify(state.sides), beforeResources, 'No debug resource grant or debit');
assert.equal(state.time, 0);
const campaign = save(state);
const restored = load(campaign);
assert.equal(restored.groundUnits.length, 500);
let normalHpCount = 0,
  normalAmmoCount = 0;
for (const unit of restored.groundUnits) {
  const reference = expected.get(unit.id);
  assert.ok(reference);
  assert.equal(unit.hp, E.GROUND_UNITS[unit.key].hp);
  assert.equal(unit.maxHp, E.GROUND_UNITS[unit.key].hp);
  assert.equal(unit.hp, reference.hp);
  normalHpCount++;
  for (const key of ['groundAmmo', 'ammo', 'ammoReserve'])
    assert.equal(unit[key], reference[key], `Factory ammo changed on load: ${unit.id}/${key}`);
  normalAmmoCount++;
  assert.equal(unit.autoDefense, false);
  assert.equal(unit.order, null);
  assert.equal(unit.path.length, 0);
}
const snapshot = projectNativeState(restored, true, 1);
assert.equal(snapshot.groundUnits.length, 500);
const counts = Object.fromEntries(
  ['infantry', 'machinegunner', 'leopard', 'supplytruck'].map((key) => [
    key,
    restored.groundUnits.filter((u) => u.key === key).length,
  ]),
);
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'artifacts/native');
await mkdir(directory, { recursive: true });
const fixture = path.join(directory, 'render-500.json');
const reportPath = path.join(directory, 'render-500-report.json');
const report = {
  fixture,
  gameVersion: '8.16.0',
  schema: restored.version,
  seed: restored.seed,
  purpose: 'Paused native GPU/render and IPC payload stress fixture only',
  realCampaign: false,
  balanceProof: false,
  debugEntityAllocation: true,
  paidProduction: false,
  debugResourceAllocation: false,
  simulationStepsExecuted: 0,
  requiredPaused: true,
  pauseContract:
    'Bridge load pauses. Keep paused for rendering; AI remains normal if deliberately resumed.',
  entityFactory: 'Existing E.makeGround defaults; no HP/ammo/speed overrides or invulnerability',
  countAfterOriginalLoad: restored.groundUnits.length,
  countInPrivateNativeView: snapshot.groundUnits.length,
  normalHpCount,
  normalAmmoCount,
  roleCounts: counts,
  positions:
    'Explicit flat plots near own HQ; initial placement for this fixture, not a gameplay teleport',
  resources: {
    credits: restored.sides[0].credits,
    materials: restored.sides[0].materials,
    oil: restored.sides[0].oil,
  },
  campaignJsonBytes: Buffer.byteLength(campaign),
  nativeStateJsonBytes: Buffer.byteLength(JSON.stringify(snapshot)),
  measuredPerformance: false,
  warning:
    'Generator does not run GPU, browser, A*, a simulation tick or benchmark. Runtime frame times must be measured separately.',
};
await writeFile(fixture, campaign, 'utf8');
await writeFile(reportPath, JSON.stringify(report, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(report, null, 2));
