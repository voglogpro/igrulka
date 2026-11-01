import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import * as E from '../src/game/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.resolve(
  process.argv[2] || path.join(root, 'artifacts/native/paid-city.json'),
);
const output = path.resolve(
  process.argv[3] || path.join(root, 'artifacts/native/native-parity-reload-qa.js'),
);
const raw = await readFile(fixturePath, 'utf8');
// Exactly the original import -> original store serialization -> original reload path.
const state = E.load(E.save(E.load(raw)));
assert.ok(
  state.time > 0 && state.buildings.filter((item) => item.side === 0).length > 1,
  'Use a real paid campaign fixture, not a fresh or injected army state',
);
assert.ok(
  state.sides[0].credits > 0 && state.sides[0].credits <= 3200,
  'Paid starter fixture must retain its ordinary budget',
);
const expected = {
  version: state.version,
  time: state.time,
  rng: state.rng,
  mode: state.mode ?? null,
  difficulty: state.difficulty ?? null,
  resources: Object.fromEntries(
    ['credits', 'materials', 'oil', 'components'].map((key) => [key, state.sides[0][key] ?? 0]),
  ),
  buildings: state.buildings
    .filter((item) => item.side === 0)
    .map((item) => ({
      id: item.id,
      key: item.key,
      x: item.x,
      z: item.z,
      hp: item.hp,
      maxHp: item.maxHp,
      progress: item.progress,
    }))
    .sort((a, b) => a.id - b.id),
  roads: state.roads
    .filter((item) => item.side === 0)
    .map((item) => ({
      id: item.id,
      ax: item.ax,
      az: item.az,
      bx: item.bx,
      bz: item.bz,
      hp: item.hp,
      removed: !!item.removed,
    }))
    .sort((a, b) => a.id - b.id),
  groundUnits: state.groundUnits
    .filter((item) => item.side === 0)
    .map((item) => ({
      id: item.id,
      key: item.key,
      x: item.x,
      z: item.z,
      hp: item.hp,
      squadId: item.squadId ?? null,
      groundAmmo: item.groundAmmo,
      stance: item.stance ?? null,
    }))
    .sort((a, b) => a.id - b.id),
  aircraft: state.units
    .filter((item) => item.side === 0)
    .map((item) => ({
      id: item.id,
      key: item.key,
      x: item.x,
      y: item.y,
      z: item.z,
      sourceId: item.sourceId,
      launched: !!item.launched,
      hp: item.hp,
    }))
    .sort((a, b) => a.id - b.id),
};
const fixture = {
  raw,
  expected,
  sha256: createHash('sha256').update(raw).digest('hex'),
  source: path.relative(root, fixturePath).replaceAll('\\', '/'),
  producer:
    'scripts/native-qa-fixture.mjs for default paid-city fixture; only normal commands and original simulation',
};
const script = await readFile(path.join(root, 'scripts/native-parity-reload-qa.js'), 'utf8');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  'window.__SKYFRONT_RELOAD_FIXTURE__ = ' + JSON.stringify(fixture) + ';\n' + script,
  'utf8',
);
console.log(
  JSON.stringify({
    output,
    fixture: fixture.source,
    sha256: fixture.sha256,
    time: expected.time,
    ownBuildings: expected.buildings.length,
    ownSoldiers: expected.groundUnits.length,
    expectedResources: expected.resources,
  }),
);
