import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from '../src/game/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const fixturePath = path.resolve(
  process.argv[2] || path.join(root, 'artifacts/native/visual-gallery.json'),
);
const reportPath = path.join(path.dirname(fixturePath), 'visual-gallery-report.json');
const output = path.resolve(
  process.argv[3] || path.join(root, 'artifacts/native/parity-gallery-qa.js'),
);
const raw = await readFile(fixturePath, 'utf8');
const report = JSON.parse(await readFile(reportPath, 'utf8'));
const sha256 = createHash('sha256').update(raw).digest('hex');
assert.equal(report.sha256, sha256, 'Gallery JSON/report changed independently; regenerate both');
assert.equal(
  report.paidProduction,
  false,
  'This helper requires an explicitly synthetic visual fixture',
);
assert.equal(report.realCampaign, false);
const state = E.load(raw);
const fields = [
  'id',
  'key',
  'x',
  'z',
  'hp',
  'maxHp',
  'progress',
  'level',
  'ammo',
  'ammoReserve',
  'groundAmmo',
  'groundReload',
  'fpvAmmo',
  'ammoCargo',
  'downed',
];
const signature = (entity) =>
  Object.fromEntries(
    fields.filter((key) => entity[key] !== undefined).map((key) => [key, entity[key]]),
  );
const guns = state.buildings.filter((b) => b.key === 'gun' && b.progress === 1 && b.hp === b.maxHp);
const armor = state.groundUnits.find(
  (u) => u.key === 'heavytank' && u.level === 2 && u.hp === u.maxHp,
);
const base = state.buildings.find(
  (b) => b.key === 'navalbase' && b.progress === 1 && b.hp === b.maxHp,
);
const ship = state.warships.find((candidate) => candidate.baseId === base?.id);
assert.ok(guns.length === 3 && armor && base && ship, 'Gallery camera reference cases missing');
const fixture = {
  nativeArtVersion: process.argv.includes('--art-v04') ? 4 : 0,
  shadowComparison: process.argv.includes('--shadow-compare'),
  raw,
  sha256,
  source: path.relative(root, fixturePath).replaceAll('\\', '/'),
  holdMilliseconds: process.argv.includes('--quick')
    ? 1200
    : process.argv.includes('--art-v04')
      ? 10000
      : 45000,
  expected: {
    counts: Object.fromEntries(
      ['buildings', 'groundUnits', 'units', 'ships', 'warships', 'trenches', 'groundScars'].map(
        (key) => [key, state[key].length],
      ),
    ),
    buildingKeys: [...new Set(report.buildings.cases.map((item) => item.key))],
    groundKeys: Object.keys(E.GROUND_UNITS),
    weaponKeys: Object.keys(E.WEAPONS),
    entities: [...state.buildings, ...state.groundUnits].map(signature),
    resources: Object.fromEntries(
      ['credits', 'materials', 'components', 'oil'].map((key) => [key, state.sides[0][key]]),
    ),
  },
  cameras: [
    {
      name: 'mog',
      x: guns.reduce((sum, b) => sum + b.x, 0) / guns.length,
      z: guns.reduce((sum, b) => sum + b.z, 0) / guns.length,
      distance: 360,
    },
    { name: 'armor', x: armor.x, z: armor.z, distance: 230 },
    { name: 'naval', x: (base.x + ship.x) / 2, z: (base.z + ship.z) / 2, distance: 300 },
  ],
  coverage: {
    buildingKeys: report.buildings.keys,
    buildingVariants: report.buildings.variants,
    groundKeys: report.ground.keys,
    groundVariants: report.ground.variants,
    aircraftKeys: report.aircraft.keys,
    trenchStages: report.fortifications.length,
    scars: report.scars,
    fleet: report.fleet.classes,
  },
  limitations: report.exclusions,
};
const template = await readFile(path.join(root, 'scripts/native-parity-gallery-qa.js'), 'utf8');
await mkdir(path.dirname(output), { recursive: true });
await writeFile(
  output,
  'window.__SKYFRONT_GALLERY_FIXTURE__ = ' + JSON.stringify(fixture) + ';\n' + template,
  'utf8',
);
console.log(
  JSON.stringify(
    {
      output,
      sha256,
      counts: fixture.expected.counts,
      cameras: fixture.cameras,
      holdPerCameraMs: fixture.holdMilliseconds,
    },
    null,
    2,
  ),
);
