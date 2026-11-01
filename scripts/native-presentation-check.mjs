import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { Vector3, Ray } from '../vendor/three/three.module.js';
import { nativePresentationTransform } from '../native/parity/presentation-transform.mjs';
import {
  bindPresentationWorld,
  trenchDepth,
  presentationUnitY,
  presentationCorpseY,
  presentationGroundPoint,
  presentationMuzzleEvent,
  presentationProjectilePoint,
} from '../native/parity/trench-presentation.mjs';
import { registerVisualWorld, captureVisualBindings } from '../native/parity/visual-bindings.mjs';

let checks = 0;
const near = (a, b, label) => {
  assert.ok(Math.abs(a - b) < 1e-6, label);
  checks++;
};
const record = { x: 0, z: 0, yaw: 0, stretch: 1, progress: 1, level: 1 };
near(trenchDepth(record, 0, 0), 1.55, 'full excavation');
near(trenchDepth(record, 10, 0), 0, 'outside end');
near(trenchDepth(record, 0, 2.2), 0, 'outside wall');
near(trenchDepth({ ...record, progress: 0 }, 0, 0), 0, 'undug position');
near(
  trenchDepth({ ...record, yaw: Math.PI / 2 }, 0, 6),
  trenchDepth(record, 6, 0),
  'rotated same floor',
);
assert.ok(trenchDepth(record, 8, 0) > 0 && trenchDepth(record, 8, 0) < 1.55);
checks++;
const unit = { id: 7, key: 'infantry', ground: true, x: 0, y: 1, z: 0, trenchId: 1 };
const world = {
  scene: {},
  state: { weather: { kind: 'clear', amount: 0 }, groundUnits: [unit] },
  height: () => 0,
  fortifications: { models: new Map([[1, record]]), pools: [{ uuid: 'source-trench' }] },
};
bindPresentationWorld(world);
const before = JSON.stringify(unit);
globalThis.__SKYFRONT_NATIVE__ = { enhancedGraphics: false };
near(presentationUnitY(world, unit), 1, 'baseline keeps old pose');
globalThis.__SKYFRONT_NATIVE__.enhancedGraphics = true;
near(presentationUnitY(world, unit), -1.5, 'feet align to floor with 5cm clearance');
near(presentationCorpseY(world, unit, 0.55), -1, 'wounded pose remains above floor');
near(presentationUnitY(world, { ...unit, carrierId: 99 }), 1, 'passenger not sunk');
near(presentationUnitY(world, { ...unit, x: 20 }), 0.05, 'departed soldier stands on the terrain');
near(presentationUnitY(world, { ...unit, key: 'tank' }), 1, 'vehicle not sunk');
const ray = new Ray(new Vector3(0, 10, 0), new Vector3(0, -1, 0));
near(
  presentationGroundPoint(world, ray, new Vector3()).y,
  -1.55,
  'pointer intersects actual floor',
);
assert.equal(JSON.stringify(unit), before);
checks++;
const partial = { ...record, progress: 0.42 };
world.fortifications.models.set(1, partial);
near(
  presentationUnitY(world, unit),
  0.05 - trenchDepth(partial, 0, 0),
  'partial digging also has actual foot contact',
);
near(
  presentationUnitY(world, unit, 0, 5),
  0.05,
  'member outside narrow trench stays on solid ground',
);
world.fortifications.models.set(1, record);
const event = Object.freeze({ buildingId: 7, my: 2.6 });
near(presentationMuzzleEvent(world, event).my, 0.1, 'infantry flash shares floor offset');
const barrel = Object.freeze({ ...event, barrelTip: true });
assert.equal(presentationMuzzleEvent(world, barrel), barrel);
checks++;
const projectile = Object.freeze({ source: 7, life: 0, flight: 1 });
near(
  presentationProjectilePoint(projectile, 0, new Vector3(0, 2.6, 0)).y,
  0.1,
  'drawn tracer starts at the same flash',
);
near(
  presentationProjectilePoint(projectile, 1, new Vector3(0, 20, 0)).y,
  20,
  'air endpoint remains authoritative',
);
assert.equal(projectile.life, 0);
checks++;
registerVisualWorld(world);
assert.equal(captureVisualBindings(world.scene, true).trenches.length, 1);
checks++;
assert.equal(captureVisualBindings(world.scene), undefined);
checks++;
world.fortifications.models.set(1, { ...record, progress: 0.5 });
assert.equal(captureVisualBindings(world.scene).trenches[0].progress, 0.5);
checks++;
world.fortifications.models.clear();
assert.equal(captureVisualBindings(world.scene).trenches.length, 0);
checks++;
for (const name of [
  'src/rendering/models/infantry/soldiers.js',
  'src/rendering/input/build-tools.js',
  'src/rendering/sync.js',
  'src/rendering/effects/tracer-path.js',
  'src/rendering/performance/contact-shadows.js',
  'src/rendering/models/ground.js',
]) {
  const source = await readFile(name, 'utf8');
  const changed = nativePresentationTransform(name, source);
  assert.ok(changed.startsWith('import {'));
  checks++;
  assert.notEqual(changed, source);
  checks++;
}
console.log(
  JSON.stringify({
    passed: true,
    checks,
    scope:
      'CPU presentation edges, baseline, input floor and native-only patch guards; not GPU acceptance',
  }),
);
