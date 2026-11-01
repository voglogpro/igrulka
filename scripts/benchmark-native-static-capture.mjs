import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as T from '../vendor/three/three.module.js';
import { SceneExporter } from '../native/parity/scene-protocol.mjs';
import { registerStaticWorld } from '../native/parity/static-scenery-cache.mjs';

// CPU exporter comparison only, never a game/FPS/GPU benchmark.
const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.resolve(
  process.argv[2] || path.join(root, 'artifacts/native/static-capture-benchmark.json'),
);
const scene = new T.Scene(),
  camera = new T.PerspectiveCamera(45, 16 / 9, 2, 9000);
const geometries = Array.from({ length: 87 }, (_, i) => new T.BoxGeometry(1 + i * 0.005, 1, 1));
const materials = Array.from(
  { length: 88 },
  (_, i) => new T.MeshStandardMaterial({ color: new T.Color(0.2 + i * 0.001, 0.3, 0.2) }),
);
const matrix = new T.Matrix4(),
  trees = [];
for (let pair = 0; pair < 1272; pair++) {
  const meshes = [];
  for (let part = 0; part < 2; part++) {
    const index = (pair % 2) * 2 + part;
    const mesh = new T.InstancedMesh(geometries[index], materials[index], 10);
    for (let i = 0; i < 10; i++)
      mesh.setMatrixAt(
        i,
        matrix.makeTranslation((pair % 70) * 30 + i, part * 7, Math.floor(pair / 70) * 30),
      );
    scene.add(mesh);
    meshes.push(mesh);
  }
  for (let i = 0; i < 10; i++) trees.push({ index: i, meshes });
}
scene.updateMatrixWorld(true);
for (const tree of trees)
  for (const mesh of tree.meshes) mesh.matrixAutoUpdate = mesh.matrixWorldAutoUpdate = false;
for (let i = 0; i < 270; i++) {
  const geometry = geometries[4 + (i % 83)],
    material = materials[4 + (i % 84)];
  const mesh =
    i < 14
      ? new T.InstancedMesh(geometry, material, i < 13 ? 36 : 32)
      : new T.Mesh(geometry, material);
  if (mesh.isInstancedMesh)
    for (let j = 0; j < mesh.count; j++)
      mesh.setMatrixAt(j, matrix.makeTranslation(i * 10 + j, 1, 0));
  mesh.position.set((i % 30) * 12, 0, Math.floor(i / 30) * 12);
  scene.add(mesh);
}
assert.equal(registerStaticWorld({ scene, trees }), true);
const full = new SceneExporter({ useStaticScenery: false }),
  resident = new SceneExporter();
const samples = { complete: [], resident: [] },
  phases = {};
let sequence = 0;
for (let iteration = 0; iteration < 80; iteration++) {
  sequence++;
  const order =
    iteration % 2
      ? [
          ['resident', resident],
          ['complete', full],
        ]
      : [
          ['complete', full],
          ['resident', resident],
        ];
  for (const [name, exporter] of order) {
    const start = performance.now();
    const packet = exporter.capture(scene, camera, sequence);
    const elapsed = performance.now() - start;
    assert.equal(exporter.objectCache.size, 2814);
    if (iteration > 0) assert.equal(packet.frame.objects.length, 0);
    if (iteration >= 20) samples[name].push(elapsed);
    phases[name] = exporter.diagnostics();
  }
}
const summarize = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    samples: sorted.length,
    meanMs: values.reduce((a, b) => a + b, 0) / values.length,
    p50Ms: sorted[Math.floor(sorted.length * 0.5)],
    p95Ms: sorted[Math.floor((sorted.length - 1) * 0.95)],
    maximumMs: sorted.at(-1),
  };
};
const result = {
  passed: true,
  scope: 'Node CPU-only synthetic paused exporter cost, not actual game/browser/GPU/FPS acceptance',
  scene: {
    visibleLeaves: 2814,
    residentTreeLeaves: 2544,
    otherLeaves: 270,
    sourceLikeGeometryCount: geometries.length,
    sourceLikeMaterialCount: materials.length,
    syntheticGroundInstances: 500,
  },
  warmupIterations: 20,
  complete: summarize(samples.complete),
  resident: summarize(samples.resident),
  lastProfiles: phases,
};
result.meanReductionPercent = (1 - result.resident.meanMs / result.complete.meanMs) * 100;
await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(result, null, 2) + '\n', 'utf8');
console.log(JSON.stringify(result, null, 2));
