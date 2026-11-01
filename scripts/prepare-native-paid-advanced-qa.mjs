import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.resolve(
  process.argv[2] || path.join(root, 'artifacts/native/paid-advanced-ready.json'),
);
const output = path.resolve(
  process.argv[3] || path.join(root, 'artifacts/native/parity-paid-advanced-qa.js'),
);
const raw = await readFile(fixturePath, 'utf8');
const report = JSON.parse(
  await readFile(path.join(path.dirname(fixturePath), 'paid-advanced-report.json'), 'utf8'),
);
const sha256 = createHash('sha256').update(raw).digest('hex');
assert.equal(report.ok, true, 'Run the paid source-only fixture successfully first');
assert.equal(report.syntheticVisualFixture, false);
assert.equal(report.networkClaim, false);
assert.equal(
  sha256,
  report.checkpoints.find((checkpoint) => checkpoint.file.endsWith('paid-advanced-ready.json'))
    ?.sha256,
  'Paid checkpoint/report mismatch',
);
const state = E.load(raw);
assert.equal(state.mode, 'multiplayer');
assert.deepEqual(E.aiSides(state), []);
const fields = [
  'id',
  'key',
  'x',
  'z',
  'hp',
  'maxHp',
  'groundAmmo',
  'ammoReserve',
  'ammo',
  'carrierId',
  'boardingId',
  'autoDefense',
];
const signature = (unit) =>
  Object.fromEntries(
    fields.filter((key) => unit[key] !== undefined).map((key) => [key, unit[key]]),
  );
const fixture = {
  raw,
  sha256,
  source: path.relative(root, fixturePath).replaceAll('\\', '/'),
  ids: report.ids,
  paidLineage: {
    ok: true,
    simulationSteps: report.simulationSteps,
    sourceMode: report.gameMode,
    syntheticVisualFixture: report.syntheticVisualFixture,
    networkClaim: report.networkClaim,
    commandCount: report.ledger.length,
  },
  expected: {
    time: state.time,
    resources: Object.fromEntries(
      ['credits', 'materials', 'oil', 'components'].map((key) => [key, state.sides[0][key] || 0]),
    ),
    groundUnits: state.groundUnits.map(signature),
    weather: state.weather,
  },
  transport: {
    move: report.ledger.find((command) => command.type === 'order').payload.aim,
    deliver: report.ledger.find((command) => command.type === 'deliver').payload.point,
  },
  navalAim: report.ledger.find((command) => command.type === 'launch').payload.aim,
};
const template = await readFile(
  path.join(root, 'scripts/native-parity-paid-advanced-qa.js'),
  'utf8',
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  'window.__SKYFRONT_PAID_ADVANCED_FIXTURE__ = ' + JSON.stringify(fixture) + ';\n' + template,
  'utf8',
);
console.log(
  JSON.stringify(
    {
      output,
      sha256,
      ids: fixture.ids,
      resources: fixture.expected.resources,
      readyTime: state.time,
      syntheticVisualFixture: false,
      networkClaim: false,
    },
    null,
    2,
  ),
);
