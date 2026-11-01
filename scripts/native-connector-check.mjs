// Includes the existing presentation edge checks before connector-specific cases.
import './native-presentation-check.mjs';
import assert from 'node:assert/strict';
import * as T from '../vendor/three/three.module.js';
import * as E from '../src/game/index.js';
import * as P from '../native/parity/trench-presentation.mjs';
import * as V from '../native/parity/visual-bindings.mjs';
import * as L from '../native/parity/trench-link-layout.mjs';
import { trenchRenderPieces } from '../src/game/defense/trench-footprint.js';
import { prepareDefensivePosition } from '../src/game/defense/fortifications.js';
import { FortificationView } from '../src/rendering/defense/fortifications.js';

let count = 0;
const check = (label, value) => {
  assert.ok(value, label);
  count++;
};
const near = (label, a, b, tolerance = 1e-6) => check(label, Math.abs(a - b) < tolerance);
const a = { id: 101, x: 0, z: 0, yaw: 0, progress: 1 },
  b = { id: 102, x: 60, z: 0, yaw: 0, progress: 1 };
const unit = { id: 777, key: 'infantry', x: 30, y: 1, z: 0, hp: 100 };
const link = { a, b, ax: 0, az: 0, bx: 60, bz: 0, level: 2, side: 0, ayaw: 0, byaw: 0 };
const world = {
  scene: {},
  state: { time: 0, groundUnits: [unit], weather: { kind: 'clear', amount: 0 } },
  height: () => 0,
  fortifications: {
    models: new Map([
      [101, { ...a, y: 0.07, stretch: 1, level: 2 }],
      [102, { ...b, y: 0.07, stretch: 1, level: 2 }],
    ]),
    pools: [{ uuid: 'section0' }],
    links: {
      records: new Map([['101:102', link]]),
      height: () => 0,
      pools: [{ uuid: 'source-link0' }, { uuid: 'source-link1' }],
    },
  },
};
globalThis.__SKYFRONT_NATIVE__ = { enhancedGraphics: true };
V.registerVisualWorld(world);
const snapshot = V.captureVisualBindings(world.scene, true);
const pieces = trenchRenderPieces(a, b);
check('source section count preserved', snapshot.trenches.length === 2);
check('source exact piece count preserved', snapshot.trenchLinks.length === pieces.length);
check(
  'source exact link pool identities exported',
  snapshot.trenchLinkPools.join('/') === 'source-link0/source-link1',
);
for (const [i, pose] of snapshot.trenchLinks.entries()) {
  const piece = pieces[i];
  near('source exact from endpoint ' + i, pose.ax, piece.from);
  near('source exact to endpoint ' + i, pose.bx, piece.to);
  near('source exact width ' + i, pose.widthScale, piece.narrow ? 0.45 : 1);
  check(
    'source ramp flags ' + i,
    pose.rampStart === (i === 0) && pose.rampEnd === (i === pieces.length - 1),
  );
  const mid = (pose.ax + pose.bx) / 2;
  near(
    'unit uses connector floor without assigned trench ' + i,
    P.presentationUnitY(world, { ...unit, x: mid }),
    0.14 - P.trenchDepth(pose, mid, 0),
  );
}
const inner = snapshot.trenchLinks.find((p) => !p.rampStart && !p.rampEnd);
near('deep connector centre', P.presentationUnitY(world, { ...unit, x: inner.x }), -1.41);
const narrow = snapshot.trenchLinks.find((p) => p.widthScale === 0.45);
check('source contains narrow piece', !!narrow);
near(
  'narrow outside member stays solid',
  P.presentationUnitY(world, { ...unit, x: narrow.x, z: 1.1 }),
  0.05,
);
near(
  'narrow inside member descends',
  P.presentationUnitY(world, { ...unit, x: narrow.x, z: 0.2 }),
  -1.41,
);
const ray = new T.Ray(new T.Vector3(inner.x, 10, 0), new T.Vector3(0, -1, 0));
near(
  'pointer hits connector floor',
  P.presentationGroundPoint(world, ray, new T.Vector3(inner.x, 0, 0)).y,
  -1.46,
);
const before = JSON.stringify({ a, b, unit, link });
const iterator = world.fortifications.links.records[Symbol.iterator];
world.fortifications.links.records[Symbol.iterator] = () => {
  throw Error('Per-unit source link scan is forbidden');
};
for (let i = 0; i < 1000; i++) P.presentationUnitY(world, { ...unit, x: inner.x, z: 0 });
count++;
world.fortifications.links.records[Symbol.iterator] = iterator;
check('helpers do not change source state', JSON.stringify({ a, b, unit, link }) === before);
check(
  'unchanged capture omits geometry snapshot',
  V.captureVisualBindings(world.scene) === undefined,
);
const layout = L.presentationTrenchLayout(world);
const index = layout.buckets;
const bucket = index.get(0);
const connectorArray = layout.connectors;
world.state = { ...world.state, time: 0.05, groundUnits: [{ ...unit }] };
world.fortifications.links.records.set('101:102', { ...link, a: { ...a }, b: { ...b } });
check(
  'network snapshot identity churn omits static link geometry',
  V.captureVisualBindings(world.scene) === undefined,
);
check(
  'network snapshot identity churn reuses connector index',
  L.presentationTrenchLayout(world).buckets === index &&
    L.presentationTrenchLayout(world).connectors === connectorArray,
);
world.fortifications.models.set(101, { ...world.fortifications.models.get(101), progress: 0.75 });
const progressPacket = V.captureVisualBindings(world.scene);
check(
  'construction packet omits unchanged connectors',
  !Object.hasOwn(progressPacket, 'trenchLinks'),
);
check(
  'construction progress preserves spatial index',
  L.presentationTrenchLayout(world).buckets === index,
);
check('construction progress preserves bucket arrays', index.get(0) === bucket);
world.fortifications.links.records.clear();
const removed = V.captureVisualBindings(world.scene);
check('removed links explicitly exported empty', removed.trenchLinks.length === 0);
near(
  'removed connector returns floor to terrain',
  P.presentationUnitY(world, { ...unit, x: inner.x }),
  0.05,
);
globalThis.__SKYFRONT_NATIVE__.enhancedGraphics = false;
near('baseline keeps original height at connector', P.presentationUnitY(world, unit), 1);
const campaign = E.createGame({ mode: 'multiplayer' });
for (const z of [0, 60]) {
  const engineer = E.makeGround(campaign, 0, 'engineer', -1815, z);
  engineer.guard = { x: engineer.x, z: engineer.z };
  campaign.groundUnits.push(engineer);
  const trench = prepareDefensivePosition(campaign, engineer);
  assert.ok(trench, 'Original position factory accepts the scoped synthetic site');
  trench.progress = 1;
  trench.fortificationWork = 30;
}
const walker = E.makeGround(campaign, 0, 'infantry', -1815, 30);
campaign.groundUnits.push(walker);
const scene = new T.Scene();
const forts = new FortificationView(scene, { height: () => 0 });
forts.sync(campaign);
const actualWorld = { scene, state: campaign, fortifications: forts, height: () => 0 };
globalThis.__SKYFRONT_NATIVE__.enhancedGraphics = true;
V.registerVisualWorld(actualWorld);
const saved = E.save(campaign);
const actualSnapshot = V.captureVisualBindings(scene, true);
check('original source view emits a real connected link', actualSnapshot.trenchLinks.length > 0);
check(
  'unassigned original factory infantry uses connected floor',
  P.presentationUnitY(actualWorld, walker) < 0,
);
P.presentationCorpseY(actualWorld, walker, 0.55);
P.presentationMuzzleEvent(actualWorld, { buildingId: walker.id, my: 2.6 });
forts.sync(campaign);
V.captureVisualBindings(scene);
check('full original E.save unchanged by connector presentation', E.save(campaign) === saved);
forts.dispose();
console.log(
  JSON.stringify({
    passed: true,
    includedBaseChecks: 37,
    connectorChecks: count,
    scope:
      'CPU source endpoints, ramps, widths, floor/picking, cache and exact original E.save preservation; no GPU acceptance',
  }),
);
