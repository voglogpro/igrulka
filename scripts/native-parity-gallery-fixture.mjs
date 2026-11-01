import assert from 'node:assert/strict';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as E from '../src/game/index.js';
import { addRoad } from '../src/game/city/roads.js';
import { physicalPlacement, SHORE } from '../src/game/city/construction.js';
import { upgradeable } from '../src/game/combat/upgrades.js';
import { damageGround } from '../src/game/units/ground/combat.js';
import { tryDown } from '../src/game/units/ground/rear.js';
import { updatePorts } from '../src/game/city/ports.js';
import { updateWarships, navalStation } from '../src/game/city/naval.js';
import { prepareDefensivePosition } from '../src/game/defense/fortifications.js';
import { event } from '../src/game/shared/events.js';
import { basePosition } from '../src/game/units/aviation/flight.js';

// SYNTHETIC VISUAL GALLERY ONLY. It does not prove production, balance,
// connected economy, navigation, battle performance or successful GPU rendering.
const root = fileURLToPath(new URL('..', import.meta.url));
const directory = path.join(root, 'artifacts/native');
await mkdir(directory, { recursive: true });
const state = E.createGame(8162600, { difficulty: 'normal', mode: 'solo' });
const initialResources = Object.fromEntries(
  ['credits', 'materials', 'components', 'oil'].map((k) => [k, state.sides[0][k]]),
);
const buildingCases = [],
  groundCases = [],
  trenchCases = [],
  aircraftCases = [];
const defaultAmmo = new Map();
const activeBuildings = Object.keys(E.BUILDINGS).filter((key) => !E.BUILDINGS[key].retired);
const ammoFields = ['ammo', 'ammoReserve', 'groundAmmo', 'groundReload', 'fpvAmmo', 'ammoCargo'];
const ammoSignature = (entity) =>
  Object.fromEntries(
    ammoFields.filter((k) => entity[k] != null).map((k) => [k, structuredClone(entity[k])]),
  );
let buildingCursor = 0;

function landPlots() {
  const points = [];
  for (let z = -850; z <= 850; z += 82)
    for (let x = -2290; x <= -1050; x += 82) points.push({ x, z });
  return points;
}
const ordinaryPlots = landPlots();
function chooseBuildingPlot(key) {
  let points;
  if (key === 'oilwell')
    points = E.OIL_FIELDS.filter((f) => f.x < -900).map(({ x, z }) => ({ x, z }));
  else if (SHORE.has(key)) {
    points = [];
    for (let z = -1030; z <= 1030; z += 62)
      for (let x = -980; x <= -680; x += 8) points.push({ x, z });
  } else {
    points = [...ordinaryPlots.slice(buildingCursor), ...ordinaryPlots.slice(0, buildingCursor)];
  }
  const plot = points.find(
    (p) =>
      E.inField(p.x, p.z, E.BUILDINGS[key].size) &&
      !E.isWater(p.x, p.z) &&
      !physicalPlacement(state, key, p.x, p.z, 0),
  );
  assert.ok(plot, 'No physically valid own-bank plot for ' + key);
  if (!SHORE.has(key) && key !== 'oilwell')
    buildingCursor = (ordinaryPlots.indexOf(plot) + 1) % ordinaryPlots.length;
  return plot;
}

function makeBuilding(key, pose, level = 0) {
  const { x, z } = chooseBuildingPlot(key);
  // Use the ORIGINAL building constructor in an isolated local context. This
  // temporary constructor street and HQ do not become fake gallery supply roads.
  const factory = E.createGame(8162601, { difficulty: 'normal', mode: 'solo' });
  const headquarters = factory.buildings.find((b) => b.side === 0 && b.key === 'hq');
  headquarters.x = x + 68;
  headquarters.z = z - 35;
  factory.roads = [];
  factory.nextId = state.nextId;
  Object.assign(factory.sides[0], { credits: 1e8, materials: 1e8, components: 1e8, oil: 1e8 });
  addRoad(factory, 0, x - 44, z - 35, x + 44, z - 35);
  const b = E.build(factory, 0, key, x, z, 0);
  assert.notEqual(typeof b, 'string', `${key} constructor: ${b}`);
  const originalAmmunition = ammoSignature(b);
  b.progress = 1;
  b.hp = b.maxHp;
  for (let i = 0; i < level; i++) assert.equal(E.upgradeDefense(factory, 0, b.id), true);
  state.nextId = factory.nextId;
  delete b.roadLink;
  assert.equal(physicalPlacement(state, key, x, z, 0), null);
  state.buildings.push(b);
  if (pose === 'construction') {
    b.progress = 0.36;
    b.hp = b.maxHp * (0.3 + 0.7 * b.progress);
  } else if (pose === 'damaged') E.damageBuilding(state, b, b.maxHp * 0.65);
  else if (pose === 'ruins') E.damageBuilding(state, b, b.maxHp);
  assert.deepEqual(
    ammoSignature(b),
    originalAmmunition,
    'Visual/upgrade pose must not change factory ammunition',
  );
  defaultAmmo.set(b.id, originalAmmunition);
  buildingCases.push({
    id: b.id,
    key,
    pose,
    level: b.level || 0,
    x,
    z,
    hp: b.hp,
    maxHp: b.maxHp,
    progress: b.progress,
  });
  return b;
}

// Reserve the geographically constrained well/shore plots before other rows.
const orderedBuildings = [...activeBuildings].sort(
  (a, b) => Number(SHORE.has(b) || b === 'oilwell') - Number(SHORE.has(a) || a === 'oilwell'),
);
for (const key of orderedBuildings) {
  makeBuilding(key, 'complete');
  if (upgradeable({ key })) {
    makeBuilding(key, 'complete', 1);
    makeBuilding(key, 'complete', 2);
  }
  for (const pose of ['construction', 'damaged', 'ruins']) makeBuilding(key, pose);
}

let groundCursor = 0;
const groundPlots = [];
for (let z = 250; z <= 1140; z += 34)
  for (let x = -2280; x <= -1160; x += 34) groundPlots.push({ x, z });
function chooseGroundPlot(key, extraRadius = 0) {
  const d = E.GROUND_UNITS[key],
    clearance = Math.max(d.size, extraRadius);
  for (let i = groundCursor; i < groundPlots.length; i++) {
    const p = groundPlots[i];
    if (
      !E.inField(p.x, p.z, clearance + 4) ||
      E.isWater(p.x, p.z) ||
      E.groundHeight(p.x, p.z) > 1.2 ||
      !E.walkable(state, p.x, p.z, clearance * 0.5 + 1)
    )
      continue;
    if (
      state.groundUnits.some(
        (u) =>
          Math.hypot(u.x - p.x, u.z - p.z) < (E.GROUND_UNITS[u.key].size + clearance) * 0.6 + 8,
      )
    )
      continue;
    if (
      state.buildings.some(
        (b) =>
          Math.hypot(b.x - p.x, b.z - p.z) <
          (E.BUILDINGS[b.key]?.size || 30) * 0.65 + clearance + 8,
      )
    )
      continue;
    groundCursor = i + 1;
    return p;
  }
  throw Error('No physically valid empty dry ground plot for ' + key);
}
function makeGround(key, pose = 'complete', level = 0) {
  const p = chooseGroundPlot(key);
  const u = E.makeGround(state, 0, key, p.x, p.z);
  const originalAmmunition = ammoSignature(u);
  state.groundUnits.push(u);
  for (let i = 0; i < level; i++) assert.equal(E.upgradeDefense(state, 0, u.id), true);
  if (pose === 'damaged') damageGround(state, u, u.maxHp * 0.6, undefined, 'bullet');
  else if (pose === 'downed') {
    for (let i = 0; i < 60 && !u.downed; i++) tryDown(state, u, 'bullet');
    assert.ok(u.downed, 'Source tryDown must actually construct this downed pose');
  }
  assert.deepEqual(ammoSignature(u), originalAmmunition);
  defaultAmmo.set(u.id, originalAmmunition);
  groundCases.push({
    id: u.id,
    key,
    pose,
    level: u.level,
    x: u.x,
    z: u.z,
    hp: u.hp,
    maxHp: u.maxHp,
  });
  return u;
}
state.sides[0].credits = 1e8;
for (const key of Object.keys(E.GROUND_UNITS)) {
  makeGround(key);
  if (upgradeable({ key })) {
    makeGround(key, 'complete', 1);
    makeGround(key, 'complete', 2);
  }
  makeGround(key, 'damaged');
  if (E.isInfantry(key) && !E.GROUND_UNITS[key].support) makeGround(key, 'downed');
}

// All six existing trench stages, created with the existing position factory.
for (let stage = 0; stage <= E.FORTIFICATION_TOP; stage++) {
  const p = chooseGroundPlot('engineer', 18);
  const u = E.makeGround(state, 0, 'engineer', p.x, p.z);
  u.guard = { x: p.x, z: p.z };
  state.groundUnits.push(u);
  const t = prepareDefensivePosition(state, u);
  assert.ok(t, 'Source defensive-position factory rejected the plot');
  t.progress = stage === 0 ? 0.5 : 1;
  t.fortificationWork = stage <= 1 ? 0 : E.FORTIFICATION.thresholds[stage - 2];
  assert.equal(E.fortificationStatus(t).level, stage);
  trenchCases.push({
    id: t.id,
    stage,
    x: t.x,
    z: t.z,
    source: 'prepareDefensivePosition; explicit synthetic visual progress/work pose',
  });
  defaultAmmo.set(u.id, ammoSignature(u));
}

// Original fleet creation routines, with dt=0 and no production/AI tick.
updatePorts(state, 0);
updateWarships(state, 0);
for (const ship of [...state.ships, ...state.warships]) {
  assert.ok(E.inField(ship.x, ship.z));
  assert.ok(E.isWater(ship.x, ship.z), 'Ship may not be placed on dry land');
}
for (const ship of state.warships) {
  const base = state.buildings.find((b) => b.id === ship.baseId);
  const d = E.BUILDINGS[base.key].naval;
  assert.equal(ship.hp, d.hp);
  assert.equal(ship.maxHp, d.hp);
  assert.ok(E.isWater(navalStation(base).x, navalStation(base).z));
}

// All registered aircraft use the original launch constructor and route sampler.
// Stock here is allocated explicitly for VISUAL coverage, never paid production.
for (const [i, key] of Object.keys(E.WEAPONS).entries()) {
  const site = state.buildings.find(
    (b) =>
      b.side === 0 &&
      b.hp === b.maxHp &&
      b.progress === 1 &&
      ['launcher', 'silo'].includes(b.key) &&
      E.launchSiteAllows(b, key),
  );
  assert.ok(site, 'No normal launch site for ' + key);
  assert.equal(E.acceptLaunchDelivery(site, key, 1), 1);
  assert.equal(E.launch(state, 0, key, { x: E.HQ_X - 300, z: 300 + i * 35 }, 1, site.id), 1);
  const u = state.units.at(-1);
  u.delay = 0;
  u.launched = true;
  u.travelled = u.total * (0.12 + i * 0.035);
  const p = basePosition(u, u.travelled);
  Object.assign(u, p);
  aircraftCases.push({
    id: u.id,
    key,
    status: u.status,
    x: u.x,
    y: u.y,
    z: u.z,
    hp: u.hp,
    maxHp: u.maxHp,
  });
  assert.equal(u.hp, E.WEAPONS[key].hp);
}

for (const [i, key] of [
  'tank',
  'rocket',
  'artillery',
  'fpv',
  ...Object.keys(E.WEAPONS),
].entries()) {
  const p = chooseGroundPlot('infantry');
  event(state, 'impact', { key, side: 0, x: p.x, y: 1, z: p.z, radius: 8 + i });
}

// No debug budget persists in the loadable campaign. The entities themselves are
// deliberately unpaid initial fixture data and must not be used as balance proof.
Object.assign(state.sides[0], initialResources);
const raw = E.save(state),
  restored = E.load(raw);
for (const entity of [...restored.buildings, ...restored.groundUnits]) {
  if (defaultAmmo.has(entity.id))
    assert.deepEqual(
      ammoSignature(entity),
      defaultAmmo.get(entity.id),
      'Ammunition changed through original save/load',
    );
}
const allIds = [
  ...restored.buildings,
  ...restored.groundUnits,
  ...restored.units,
  ...restored.ships,
  ...restored.warships,
  ...restored.trenches,
].map((o) => o.id);
assert.equal(new Set(allIds).size, allIds.length);
function finiteTree(value, where = 'state') {
  if (typeof value === 'number') assert.ok(Number.isFinite(value), 'Non-finite number ' + where);
  else if (Array.isArray(value))
    value.forEach((item, i) => finiteTree(item, where + '[' + i + ']'));
  else if (value && typeof value === 'object')
    for (const [key, item] of Object.entries(value)) finiteTree(item, where + '.' + key);
}
finiteTree(restored);
for (const b of restored.buildings.filter((b) => b.key !== 'hq')) {
  assert.equal(
    physicalPlacement(
      {
        ...restored,
        buildings: restored.buildings.filter((other) => other.id !== b.id),
        groundUnits: [],
      },
      b.key,
      b.x,
      b.z,
      0,
    ),
    null,
    'Final building physics: ' + b.key,
  );
}
for (const u of restored.groundUnits)
  assert.ok(
    !E.isWater(u.x, u.z) &&
      E.groundHeight(u.x, u.z) <= 1.2 &&
      E.walkable(restored, u.x, u.z, E.GROUND_UNITS[u.key].size * 0.42),
    'Final unit physics ' + u.key,
  );
assert.deepEqual(
  Object.fromEntries(Object.keys(initialResources).map((k) => [k, restored.sides[0][k]])),
  initialResources,
);

const report = {
  fixture: 'artifacts/native/visual-gallery.json',
  sha256: createHash('sha256').update(raw).digest('hex'),
  gameVersion: '8.16.0',
  schema: restored.version,
  purpose: 'SYNTHETIC PAUSED VISUAL MODEL/STATE COVERAGE ONLY',
  paidProduction: false,
  balanceProof: false,
  realCampaign: false,
  simulationTicks: 0,
  resourceAllocation:
    'Temporary constructor/upgrade contexts use explicit debug funding. Persisted budget equals normal starting resources. Entities and aircraft stock are unpaid fixture allocations.',
  finalRoadContract:
    'Only original HQ camp roads persist. Gallery buildings are not a connected economy. Original E.build constructor used an isolated temporary local HQ/street; final gallery positions independently pass source physicalPlacement.',
  defaultHpAmmo:
    'Complete models retain registry max HP and factory ammunition; damage/downed/construction/ruins are explicitly labelled visual states. Source upgradeDefense preserves HP/ammunition.',
  buildings: { keys: activeBuildings.length, variants: buildingCases.length, cases: buildingCases },
  ground: {
    keys: Object.keys(E.GROUND_UNITS).length,
    variants: groundCases.length,
    plusTrenchEngineers: trenchCases.length,
    cases: groundCases,
  },
  aircraft: {
    keys: Object.keys(E.WEAPONS).length,
    variants: aircraftCases.length,
    cases: aircraftCases,
  },
  fleet: {
    merchant: restored.ships.length,
    warships: restored.warships.length,
    classes: [...new Set(restored.warships.map((s) => s.class))],
    ships: [...restored.ships, ...restored.warships].map((s) => ({
      id: s.id,
      class: s.class || 'merchant',
      x: s.x,
      z: s.z,
      state: s.state,
    })),
  },
  fortifications: trenchCases,
  scars: restored.groundScars.length,
  physics: {
    sourceLoadAccepted: true,
    allNumbersFinite: true,
    uniqueEntityIds: true,
    allGroundDryAndWalkable: true,
    allBuildingsPhysicallyValid: true,
    allShipsOnWater: true,
  },
  exclusions: [
    'Retired lab is deliberately excluded; it is unavailable in the reference game.',
    'Headquarters intact models come from createGame. Extra damaged/ruined HQs are not fabricated because there is no public HQ build factory; use a separate explicit HQ damage scenario.',
    'Dead ground units are removed by original sync; corpses/wrecks are transient original event effects and need the companion runtime event recipe.',
    'Events are intentionally cleared by original save(); the companion event recipe must run after import for transient combat FX.',
    'No claim of actual battle, connected supply, paid factory work, AI, FPS or native rendering follows from this CPU fixture.',
  ],
};
await writeFile(path.join(directory, 'visual-gallery.json'), raw, 'utf8');
await writeFile(
  path.join(directory, 'visual-gallery-report.json'),
  JSON.stringify(report, null, 2) + '\n',
  'utf8',
);
console.log(
  JSON.stringify(
    {
      fixture: report.fixture,
      sha256: report.sha256,
      buildings: report.buildings.keys,
      buildingVariants: report.buildings.variants,
      groundKeys: report.ground.keys,
      groundVariants: report.ground.variants,
      aircraft: report.aircraft.keys,
      merchant: report.fleet.merchant,
      warships: report.fleet.warships,
      fortifications: report.fortifications.length,
      scars: report.scars,
      physics: report.physics,
    },
    null,
    2,
  ),
);
