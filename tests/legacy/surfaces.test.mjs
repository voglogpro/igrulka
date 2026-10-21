import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../../vendor/three/three.module.js';
import { CityWorld } from '../../archive/legacy/world.js';
import {
  ROAD_SURFACE as ROAD,
  RIVER_SURFACE as RIVER,
} from '../../src/rendering/terrain/road-surfaces.js';

function geometryWorld() {
  const w = Object.create(CityWorld.prototype);
  Object.assign(w, {
    scene: new THREE.Scene(),
    materials: {},
    geometry: {
      box: new THREE.BoxGeometry(1, 1, 1),
      cylinder: new THREE.CylinderGeometry(1, 1, 1, 10),
    },
    grassMaterial: new THREE.MeshStandardMaterial(),
    state: { roads: [] },
    buildings: [],
    nativeRoads: [],
    roadGroup: new THREE.Group(),
  });
  w.scene.add(w.roadGroup);
  return w;
}
function hitsAt(object, x, z) {
  object.updateMatrixWorld(true);
  return new THREE.Raycaster(
    new THREE.Vector3(x, 300, z),
    new THREE.Vector3(0, -1, 0),
  ).intersectObject(object, true);
}

test('road markings sit above asphalt, and curbs do not cover the asphalt slab', () => {
  const w = geometryWorld();
  w.road({ x: -80, z: 0 }, { x: 80, z: 0 }, 10);
  w.batchRoads();
  let marking;
  w.roadGroup.traverse((m) => {
    if (!marking && m.isMesh && m.material.name === 'road-mark') marking = m;
  });
  assert.ok(marking);
  const center = marking.getWorldPosition(new THREE.Vector3()),
    hits = hitsAt(w.roadBatch, center.x, center.z),
    paint = hits.find((h) => h.object.material.name === 'road-mark'),
    asphalt = hits.find((h) => h.object.material.name === 'road-asphalt');
  assert.ok(paint && asphalt);
  assert.ok(paint.point.y - asphalt.point.y > 0.2);
  assert.equal(hits[0].object.material.name, 'road-mark');
  assert.equal(hitsAt(w.roadBatch, 25, 0)[0].object.material.name.startsWith('road-'), true);
  assert.equal(hitsAt(w.roadBatch, 25, 5.7)[0].object.material.name, 'road-curb');
  w.batchRoads();
  assert.ok(w.roadBatch.children.length > 0, 'rebuilding instanced streets remains valid');
});

test('crossing streets leave the junction free of curb strips and lane markings', () => {
  const w = geometryWorld();
  w.road({ x: -100, z: 0 }, { x: 100, z: 0 }, 10);
  w.road({ x: 0, z: -100 }, { x: 0, z: 100 }, 10);
  w.batchRoads();
  for (const [x, z] of [
    [0, 0],
    [4, 0],
    [0, 4],
    [4, 4],
    [-4, -4],
  ]) {
    const hits = hitsAt(w.roadBatch, x, z);
    assert.ok(hits.length);
    assert.equal(hits[0].object.material.name, 'road-asphalt', `junction ${x},${z}`);
  }
});

const terrainWorld = geometryWorld();
terrainWorld.createTerrain();
terrainWorld.scene.updateMatrixWorld(true);
test('the river has upward-facing opaque water and a bed separated from its surface', () => {
  const w = terrainWorld,
    normals = w.water.geometry.attributes.normal;
  assert.equal(w.water.material.transparent, false);
  assert.equal(w.water.material.depthWrite, true);
  for (let i = 0; i < normals.count; i++) assert.ok(normals.getY(i) > 0.99);
  for (const z of [-2200, -1300, -450, 0, 550, 1300, 2200]) {
    const x = w.riverX(z),
      bed = hitsAt(w.terrain, x, z)[0],
      water = hitsAt(w.water, x, z)[0];
    assert.ok(bed && water);
    assert.ok(water.point.y - bed.point.y > 4, `river bed at ${z}`);
    const bank = hitsAt(w.terrain, x + RIVER.meshHalfWidth + 30, z)[0];
    assert.ok(bank.point.y > RIVER.level + 0.8, `dry bank at ${z}`);
  }
});

test('terrain stays below intercity streets, including the long route across hills', () => {
  const w = terrainWorld;
  for (const r of w.nativeRoads.filter((r) => !r.bridge))
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const x = r.a.x + (r.b.x - r.a.x) * t,
        z = r.a.z + (r.b.z - r.a.z) * t,
        land = hitsAt(w.terrain, x, z)[0];
      assert.ok(land);
      assert.ok(
        land.point.y < ROAD.asphaltBase + ROAD.asphaltThickness - 0.25,
        `ground intersects street at ${x},${z}`,
      );
    }
  const a = { x: 480, z: 40 },
    b = { x: 600, z: 40 };
  w.state.roads = [{ id: 1, a, b }];
  w.updateTerrainGeometry();
  for (const t of [0.25, 0.5, 0.75]) {
    const land = hitsAt(w.terrain, a.x + (b.x - a.x) * t, 40)[0];
    assert.ok(land.point.y < 0.15, 'custom street corridor is also cleared');
  }
});
