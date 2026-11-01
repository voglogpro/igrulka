import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/index.js';
import { executeCommand } from '../src/network/commands.js';
import { step } from '../src/game/simulation.js';
import { save, load } from '../src/game/persistence/saves.js';

// Paid normal-game integration scenario. No state edits, grants, spawned units or AI overrides.
const state = E.createGame(8162026, { difficulty: 'normal', mode: 'solo' });
assert.equal(state.sides[0].credits, 3200);
const commands = [];
const resources = () =>
  Object.fromEntries(
    ['credits', 'materials', 'oil', 'components'].map((k) => [k, state.sides[0][k] || 0]),
  );
function command(type, payload) {
  const before = resources();
  const result = executeCommand(state, 0, type, payload);
  assert.notEqual(typeof result, 'string', `${type}: ${result}`);
  assert.notEqual(result, false, `${type} refused`);
  commands.push({ time: state.time, type, payload, before, after: resources() });
  return result;
}
let sawWeaponCargo = false;
function until(predicate, label) {
  while (!predicate()) {
    assert.ok(state.time < 600, `${label}: simulation limit 600s reached`);
    assert.equal(state.result, null, `${label}: match finished prematurely`);
    step(state, 0.05);
    sawWeaponCargo ||= state.ammoVehicles.some(
      (v) =>
        v.side === 0 &&
        v.hp > 0 &&
        v.cargo?.kind === 'weapon' &&
        v.cargo.key === 'drone' &&
        v.cargo.amount > 0,
    );
  }
}
const hq = state.buildings.find((b) => b.side === 0 && b.key === 'hq');
const endpoint = { x: hq.x + 90, z: hq.z - 45 };
command('road', { a: endpoint, b: { x: endpoint.x + 180, z: endpoint.z } });
for (const [key, dx, dz] of [
  ['power', -65, -10],
  ['housing', -65, -80],
  ['industry', -5, -80],
  ['factory', 65, -10],
  ['electronics', 65, -80],
  ['launcher', 125, -10],
  ['housing', 125, -80],
])
  command('build', { key, x: hq.x + dx, z: hq.z + dz, rotation: 0 });
const factory = state.buildings.find((b) => b.side === 0 && b.key === 'factory');
const launcher = state.buildings.find((b) => b.side === 0 && b.key === 'launcher');
until(
  () => factory.progress >= 1 && launcher.progress >= 1 && state.sides[0].components >= 1,
  'factory/electronics construction',
);
const productionBefore = resources();
command('produce', { key: 'drone' });
assert.equal(productionBefore.credits - state.sides[0].credits, E.WEAPONS.drone.cost);
assert.equal(productionBefore.components - state.sides[0].components, E.WEAPONS.drone.components);
command('launch-supply', { id: launcher.id, key: 'drone', count: 1 });
until(() => (launcher.launchStore?.drone || 0) >= 1, 'physical drone delivery');
assert.ok(sawWeaponCargo, 'A real weapon-carrying delivery vehicle must have existed');
const localBefore = launcher.launchStore.drone;
const enemyHQ = state.buildings.find((b) => b.side === 1 && b.key === 'hq');
command('launch', {
  key: 'drone',
  siteId: launcher.id,
  count: 1,
  aim: { x: enemyHQ.x, z: enemyHQ.z },
});
assert.equal(
  launcher.launchStore.drone,
  localBefore - 1,
  'Launch consumes the physically delivered local stock',
);
until(
  () =>
    state.units.some(
      (u) => u.side === 0 && u.key === 'drone' && u.sourceId === launcher.id && u.launched,
    ),
  'actual drone takeoff',
);
const craft = state.units.find(
  (u) => u.side === 0 && u.key === 'drone' && u.sourceId === launcher.id && u.launched,
);
const snapshot = save(state),
  restored = load(snapshot);
assert.equal(restored.time, state.time);
assert.equal(restored.rng, state.rng);
assert.equal(restored.sides[0].credits, state.sides[0].credits);
assert.ok(
  restored.units.some((u) => u.id === craft.id && u.launched),
  'Flying drone survives save/load',
);
assert.equal(
  restored.buildings.find((b) => b.id === launcher.id).launchStore.drone,
  launcher.launchStore.drone,
);
const directory = fileURLToPath(new URL('../artifacts/native/', import.meta.url));
await mkdir(directory, { recursive: true });
await writeFile(directory + 'paid-battle.json', snapshot, 'utf8');
const report = {
  scope:
    'paid normal-game production, physical delivery, takeoff and save/load integration; not a balance proof',
  time: state.time,
  initialCredits: 3200,
  resources: resources(),
  sawWeaponCargo,
  drone: { id: craft.id, launched: craft.launched, sourceId: craft.sourceId },
  commands,
};
await writeFile(directory + 'paid-battle-report.json', JSON.stringify(report, null, 2), 'utf8');
console.log(JSON.stringify(report, null, 2));
