import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from '../../vendor/three/three.module.js';
import { batchStatic } from '../../src/rendering/mesh-utils.js';
import { staticMeshOutput } from '../support/mesh-output.mjs';

test('allocation-free static batching preserves the complete frozen 8.12 vertex output byte for byte', () => {
  const result = staticMeshOutput(T, batchStatic);
  // Captured from release 78643d8 before replacing per-vertex scratch arrays.
  assert.equal(result.sha256, 'e3ba8a5c484f47ed9059aedb133b8739ff4dad1acb38e0a11f9f32b326ee2da5');
  assert.equal(result.counts.length, 6);
  assert.deepEqual(
    result.counts.map((x) => x.position),
    [288, 432, 576, 216, 576, 288],
  );
  assert.ok(result.dynamicUntouched && result.transparentUntouched);
  assert.deepEqual(result.rootPosition, [13, -2, 27]);
});
