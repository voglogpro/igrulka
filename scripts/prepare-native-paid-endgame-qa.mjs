import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.resolve(
  process.argv[2] || path.join(root, 'artifacts/native/paid-endgame-prefinish.json'),
);
const output = path.resolve(
  process.argv[3] || path.join(root, 'artifacts/native/parity-paid-endgame-qa.js'),
);
const raw = await readFile(fixturePath, 'utf8');
const report = JSON.parse(
  await readFile(path.join(path.dirname(fixturePath), 'paid-endgame-report.json'), 'utf8'),
);
const sha256 = createHash('sha256').update(raw).digest('hex');
assert.equal(report.ok, true, 'Run the paid endgame source-only fixture successfully first');
assert.equal(report.sourceOnly, true);
assert.equal(report.grants, false);
assert.equal(report.networkClaim, false);
assert.equal(sha256, report.prefinish.sha256, 'Paid checkpoint/report mismatch');
const state = E.load(raw);
assert.equal(state.mode, 'multiplayer');
assert.deepEqual(E.aiSides(state), []);
const enemy = state.buildings.find((building) => building.id === report.ids.enemyHQ);
const ruin = state.buildings.find((building) => building.id === report.ids.ruin);
assert.equal(state.result, null);
assert.ok(enemy.hp > 0 && enemy.hp <= report.effectiveDamage);
assert.equal(ruin.side, 0);
assert.equal(ruin.hp, 0);
assert.notEqual(ruin.demolished, true);
const fixture = {
  raw,
  sha256,
  source: path.relative(root, fixturePath).replaceAll('\\', '/'),
  ids: report.ids,
  lineage: {
    ok: true,
    sourceOnly: report.sourceOnly,
    grants: false,
    networkClaim: false,
    parent: report.parent,
    precedingAttacks: report.precedingAttacks,
    effectiveDamage: report.effectiveDamage,
    ruinMethod: report.ruinMethod,
    sourceCommandCount: report.ledger.length,
  },
  expected: {
    time: state.time,
    enemyHp: enemy.hp,
    resources: Object.fromEntries(
      ['credits', 'materials', 'oil', 'components'].map((key) => [key, state.sides[0][key] || 0]),
    ),
    weather: state.weather,
    impacts: state.stats.impacts,
  },
};
const template = await readFile(
  path.join(root, 'scripts/native-parity-paid-endgame-qa.js'),
  'utf8',
);
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  'window.__SKYFRONT_PAID_ENDGAME_FIXTURE__ = ' + JSON.stringify(fixture) + ';\n' + template,
  'utf8',
);
console.log(
  JSON.stringify(
    {
      output,
      sha256,
      time: state.time,
      enemyHp: enemy.hp,
      ruinId: report.ids.ruin,
      resources: fixture.expected.resources,
      sourceOnly: true,
      grants: false,
      networkClaim: false,
    },
    null,
    2,
  ),
);
