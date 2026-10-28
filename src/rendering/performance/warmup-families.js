import * as T from '../../../vendor/three/three.module.js';
import { BUILDINGS, GROUND_UNITS, WEAPONS, isInfantry } from '../../game/config.js';
import { upgradeable } from '../../game/combat/upgrades.js';
import { groundModel } from '../models/ground.js';
import { aircraftModel } from '../models/aircraft.js';
import { STATIC_BUILDING_KEYS } from '../models/buildings.js';

const identity = new T.Matrix4();
const noTrees = () => {};

// Shader families share code, but model template keys also include exact tiers
// and owners. Prepare common paid construction and own vehicle tiers explicitly;
// retain bounded active-side air variants rather than all foreign ground tiers.
export function warmupModelJobs(world) {
  const jobs = [],
    seen = new Set();
  const add = (job) => {
    const key = `${job.kind}/${job.key}/${job.side}/${job.level || 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    jobs.push(job);
  };
  for (const [key, d] of Object.entries(BUILDINGS)) {
    if (d.retired || key === 'hq') continue;
    add({ kind: 'building', key, side: 0, level: upgradeable({ key }) ? 2 : 0 });
  }
  const groundKeys = Object.keys(GROUND_UNITS).filter((key) => !isInfantry(key) || key === 'mog'),
    airKeys = [...Object.keys(WEAPONS), 'fpv'];
  for (const key of groundKeys)
    add({ kind: 'ground', key, side: 0, level: upgradeable({ key }) ? 2 : 0 });
  for (const key of airKeys) add({ kind: 'air', key, side: 0, level: 0 });
  for (const side of [1, 2, 3]) {
    add({ kind: 'building', key: 'factory', side, level: 2 });
    add({ kind: 'air', key: 'drone', side, level: 0 });
  }
  // Match the cached building families in models/buildings.js. Dynamic uncached
  // models need their own lifecycle and are not fixed by duplicate warmup jobs.
  const cachedDefenses = new Set(['gun', 'sam', 'cannon', 'launcher', 'silo']);
  for (const key of Object.keys(BUILDINGS))
    if (upgradeable({ key }) && (STATIC_BUILDING_KEYS.has(key) || cachedDefenses.has(key)))
      for (const level of [0, 1]) add({ kind: 'building', key, side: 0, level });
  for (const key of groundKeys)
    if (upgradeable({ key }))
      for (const level of [0, 1]) add({ kind: 'ground', key, side: 0, level });
  // A local two-city menu can join a four-owner co-op room after startup.
  // Prepare the four supported visual colors without adding simulation owners.
  const sideCount = 4;
  for (let side = 1; side < sideCount; side++)
    for (const key of airKeys) add({ kind: 'air', key, side, level: 0 });
  // These are actual animated role buffers, not disposable prototypes. One
  // role/side per scheduled job keeps construction inside the existing slices.
  if (world?.infantry?.pool)
    for (let side = 0; side < sideCount; side++)
      for (const key of Object.keys(GROUND_UNITS).filter(isInfantry))
        add({ kind: 'infantry', key, side, level: 0 });
  return jobs;
}

function kindOf(object) {
  if (object.isInstancedMesh) return 'instanced';
  if (object.isMesh) return 'mesh';
  if (object.isPoints) return 'points';
  if (object.isLineSegments) return 'segments';
  if (object.isLineLoop) return 'loop';
  if (object.isLine) return 'line';
  if (object.isSprite) return 'sprite';
  return null;
}

export class WarmupFamilies {
  constructor(world) {
    this.world = world;
    this.group = new T.Group();
    this.group.name = 'startup-gpu-families';
    this.staging = new T.Scene();
    this.keys = new Set();
    this.geometries = new Set();
    this.materials = new Set();
    this.existingGeometries = new Set();
    this.transientGeometries = new Set();
    this.retainedMaterials = new Set();
    this.instances = [];
    this.prototypes = 0;
  }

  collectExisting() {
    this.world.scene.traverse((object) => {
      if (object.geometry) this.existingGeometries.add(object.geometry);
      this.collectObject(object, false);
    });
  }

  collectObject(source, prototype) {
    const kind = kindOf(source);
    if (!kind || !source.material) return;
    const materials = Array.isArray(source.material) ? source.material : [source.material];
    for (const material of materials) {
      const kinds = [kind];
      if (kind === 'mesh' && (material.isMeshStandardMaterial || material.isMeshBasicMaterial))
        kinds.push('instanced');
      for (const drawKind of kinds) {
        const geometry = source.geometry;
        const coloredInstances = drawKind === 'instanced' && !!source.instanceColor;
        const key = `${geometry?.uuid}/${material.uuid}/${drawKind}/${coloredInstances}/${source.castShadow}/${source.receiveShadow}`;
        if (this.keys.has(key)) continue;
        this.keys.add(key);
        let mesh;
        if (drawKind === 'instanced') {
          mesh = new T.InstancedMesh(geometry, material, 1);
          mesh.setMatrixAt(0, identity);
          if (coloredInstances) mesh.setColorAt(0, new T.Color('#ffffff'));
          this.instances.push(mesh);
        } else if (drawKind === 'mesh') mesh = new T.Mesh(geometry, material);
        else if (drawKind === 'points') mesh = new T.Points(geometry, material);
        else if (drawKind === 'segments') mesh = new T.LineSegments(geometry, material);
        else if (drawKind === 'loop') mesh = new T.LineLoop(geometry, material);
        else if (drawKind === 'line') mesh = new T.Line(geometry, material);
        else mesh = new T.Sprite(material);
        mesh.frustumCulled = false;
        mesh.castShadow = source.castShadow;
        mesh.receiveShadow = source.receiveShadow;
        mesh.renderOrder = source.renderOrder;
        this.group.add(mesh);
        this.materials.add(material);
        if (geometry) this.geometries.add(geometry);
        if (prototype && !this.world.sharedMaterials.has(material))
          this.retainedMaterials.add(material);
        if (
          prototype &&
          geometry &&
          !this.world.sharedGeometries.has(geometry) &&
          !this.existingGeometries.has(geometry)
        )
          this.transientGeometries.add(geometry);
      }
    }
  }

  prepare(job) {
    if (job.kind === 'infantry') {
      const pool = this.world.infantry.pool(job.key, job.side);
      this.collectObject(pool.body, false);
      this.collectObject(pool.legs, false);
      this.prototypes++;
      return;
    }
    const world = this.world,
      scene = world.scene,
      clearTrees = world.clearTrees;
    const hadOwnClear = Object.hasOwn(world, 'clearTrees');
    try {
      // Keep the real world identity: model() owns WeakMap template caches.
      // Restore these temporary builder destinations before yielding to the UI.
      world.scene = this.staging;
      world.clearTrees = noTrees;
      const data = {
        id: -1,
        key: job.key,
        side: job.side,
        level: job.level,
        x: 0,
        y: 1,
        z: 0,
        hp: 1,
        progress: 1,
      };
      const root =
        job.kind === 'building'
          ? world.model(data).root
          : job.kind === 'ground'
            ? groundModel(world, data)
            : aircraftModel(world, data);
      // Ground templates can predate this world (the renderer module owns their
      // cache). Their cloned geometry/materials still belong to that cache.
      if (job.kind !== 'building')
        root.traverse((object) => {
          if (object.geometry) world.sharedGeometries.add(object.geometry);
          for (const material of Array.isArray(object.material)
            ? object.material
            : [object.material])
            if (material) world.sharedMaterials.add(material);
        });
      root.traverse((object) => this.collectObject(object, true));
      root.removeFromParent();
      this.prototypes++;
    } finally {
      world.scene = scene;
      if (hadOwnClear) world.clearTrees = clearTrees;
      else delete world.clearTrees;
      this.staging.clear();
    }
  }

  attach() {
    this.group.position.copy(this.world.controls.target);
    this.group.position.y += 8;
    this.world.scene.add(this.group);
  }

  detach() {
    this.group.removeFromParent();
  }

  diagnostics() {
    const arrays = new Set();
    for (const geometry of this.geometries) {
      for (const attribute of Object.values(geometry.attributes))
        arrays.add(attribute.array || attribute.data?.array);
      if (geometry.index) arrays.add(geometry.index.array);
    }
    return {
      prototypes: this.prototypes,
      representatives: this.group.children.length,
      geometries: this.geometries.size,
      materials: this.materials.size,
      geometryBytes: [...arrays].reduce((sum, array) => sum + (array?.byteLength || 0), 0),
      retainedMaterials: this.retainedMaterials.size,
    };
  }

  dispose() {
    this.detach();
    this.group.clear();
    for (const mesh of this.instances) mesh.dispose(); // only the tiny private instance buffers
    this.instances.length = 0;
    for (const geometry of this.transientGeometries) geometry.dispose();
    this.transientGeometries.clear();
    // Retain only uncached prototype materials as program-family keep-alives.
    // Real scene resources retain their original owners and disposal contracts.
    this.world.warmupMaterials ||= new Set();
    for (const material of this.retainedMaterials) this.world.warmupMaterials.add(material);
    this.retainedMaterials.clear();
  }
}
