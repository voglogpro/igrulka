import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import * as E from '../src/game/index.js';
import { executeCommand } from '../src/network/commands.js';
import { step } from '../src/game/simulation.js';
import { save, load } from '../src/game/persistence/saves.js';

// A reproducible paid starter city for native integration QA, not a balance campaign.
// Every entity/resource change comes from the normal command gateway or simulation.
const state = E.createGame(8162026, { difficulty: 'normal', mode: 'solo' });
const initial = { ...state.sides[0] };
const commands = [];
const resources = () =>
  Object.fromEntries(
    ['credits', 'materials', 'oil', 'components'].map((key) => [key, state.sides[0][key] || 0]),
  );
const command = (type, payload) => {
  const before = resources();
  const result = executeCommand(state, 0, type, payload);
  assert.notEqual(typeof result, 'string', `${type}: ${result}`);
  assert.notEqual(result, false, `${type} refused`);
  const after = resources();
  commands.push({
    time: state.time,
    type,
    payload,
    spent: Object.fromEntries(Object.keys(before).map((key) => [key, before[key] - after[key]])),
  });
  return result;
};
const until = (seconds) => {
  assert.ok(seconds <= 160, 'QA fixture must not fast-forward beyond the short starter scenario');
  while (state.time < seconds - 1e-8) step(state, Math.min(0.05, seconds - state.time));
};
const hq = state.buildings.find((b) => b.side === 0 && b.key === 'hq');
const endpoint = { x: hq.x + 90, z: hq.z - 45 };
const extended = { x: endpoint.x + 180, z: endpoint.z };
const preview = E.roadPreview(state, 0, endpoint.x, endpoint.z, extended.x, extended.z);
assert.equal(preview.error, undefined, preview.error);
command('road', { a: endpoint, b: extended });

// Deliberate street-side plots around the existing camp, not an unbounded placement search.
for (const [key, dx, dz] of [
  ['power', -65, -10],
  ['housing', -65, -80],
  ['industry', -5, -80],
  ['barracks', 65, -10],
  ['ammofactory', 65, -80],
  ['gun', 125, -10],
  ['housing', 125, -80],
]) {
  const payload = { key, x: hq.x + dx, z: hq.z + dz, rotation: 0 };
  const plan = E.placementPlan(state, 0, key, payload.x, payload.z);
  assert.equal(plan.error, undefined, `${key}: ${plan.error}`);
  command('build', payload);
}
until(35);
const barracks = state.buildings.find((b) => b.side === 0 && b.key === 'barracks');
assert.equal(barracks.progress, 1);
assert.ok(E.supplyFactor(state, barracks) > 0);
command('recruit', { key: 'infantry', count: 3, siteId: barracks.id });
command('recruit', { key: 'machinegunner', count: 2, siteId: barracks.id });
until(75);
const troops = state.groundUnits.filter((u) => u.side === 0 && u.hp > 0);
assert.equal(troops.length, 5, 'All five normally paid recruits must have completed');
command('auto-defense', { ids: troops.map((u) => u.id), enabled: true });
until(120);
assert.equal(state.result, null);
assert.ok(state.sides[0].credits > 0);
const own = state.buildings.filter((b) => b.side === 0 && b.hp > 0);
assert.ok(own.every((b) => b.progress === 1));
const campaign = save(state);
const restored = load(campaign);
assert.equal(restored.time, state.time);
assert.equal(restored.rng, state.rng);
assert.equal(restored.sides[0].credits, state.sides[0].credits);
assert.equal(restored.groundUnits.filter((u) => u.side === 0).length, 5);
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'artifacts/native/paid-city.json');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, campaign, 'utf8');
console.log(
  JSON.stringify(
    {
      fixture: output,
      gameVersion: '8.16.0',
      schema: state.version,
      scope: 'paid starter-city integration fixture; not a balance or combat campaign',
      time: state.time,
      seed: state.seed,
      buildings: own.map((b) => ({
        id: b.id,
        key: b.key,
        x: b.x,
        z: b.z,
        hp: b.hp,
        progress: b.progress,
      })),
      roads: state.roads.filter((r) => r.side === 0).length,
      troops: state.groundUnits
        .filter((u) => u.side === 0)
        .map((u) => ({
          id: u.id,
          key: u.key,
          autoDefense: u.autoDefense,
          task: u.defenseTask,
          x: u.x,
          z: u.z,
        })),
      initial: { credits: initial.credits, materials: initial.materials, oil: initial.oil },
      resources: resources(),
      economy: E.economy(state, 0),
      spentCommands: commands,
    },
    (_, value) => (value instanceof Set ? [...value] : value),
    2,
  ),
);
