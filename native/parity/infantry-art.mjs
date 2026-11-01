import * as T from '../../vendor/three/three.module.js';
import { NativeModelPack } from './model-pack.mjs';
import data from '../art-assets/infantry-v04.json' with { type: 'json' };
import { presentationEnabled } from './trench-presentation.mjs';
import { markNativeImmutableGeometry } from './immutable-geometry.mjs';

const pack = new NativeModelPack(data),
  bodies = new Map(),
  materials = new Map();
const _p = new T.Vector3(),
  _n = new T.Vector3();
function mergedBody(key, side) {
  const id = key;
  if (bodies.has(id)) return bodies.get(id);
  const root = pack.create(key, 0);
  if (!root) return null;
  root.updateMatrixWorld(true);
  const parts = [];
  root.traverse((n) => {
    if (n.isMesh) parts.push(n);
  });
  const vertices = parts.reduce((sum, m) => sum + m.geometry.attributes.position.count, 0);
  const geometry = new T.BufferGeometry(),
    arrays = {
      position: new Float32Array(vertices * 3),
      normal: new Float32Array(vertices * 3),
      uv: new Float32Array(vertices * 2),
      uv2: new Float32Array(vertices * 2),
      color: new Float32Array(vertices * 4),
    };
  const indices = [[], [], []];
  let offset = 0;
  for (const mesh of parts) {
    const g = mesh.geometry,
      nm = new T.Matrix3().getNormalMatrix(mesh.matrixWorld),
      count = g.attributes.position.count;
    for (let i = 0; i < count; i++) {
      _p.fromBufferAttribute(g.attributes.position, i).applyMatrix4(mesh.matrixWorld);
      _n.fromBufferAttribute(g.attributes.normal, i).applyNormalMatrix(nm);
      arrays.position.set(_p.toArray(), (offset + i) * 3);
      arrays.normal.set(_n.toArray(), (offset + i) * 3);
      for (let c = 0; c < 2; c++) {
        arrays.uv[(offset + i) * 2 + c] = g.attributes.uv?.array[i * 2 + c] || 0;
        arrays.uv2[(offset + i) * 2 + c] = g.attributes.uv2?.array[i * 2 + c] || 0;
      }
      const color = mesh.material.color;
      for (let c = 0; c < 3; c++)
        arrays.color[(offset + i) * 4 + c] =
          (g.attributes.color?.array[i * g.attributes.color.itemSize + c] ?? 1) *
          [color.r, color.g, color.b][c];
      arrays.color[(offset + i) * 4 + 3] =
        g.attributes.color?.itemSize === 4 ? g.attributes.color.array[i * 4 + 3] : 0;
    }
    for (let lod = 0; lod < 3; lod++) {
      const a = lod === 0 ? g.index : g.userData.nativeLods[lod - 1]?.index;
      if (a) for (const index of a.array) indices[lod].push(index + offset);
    }
    offset += count;
  }
  for (const [name, array] of Object.entries(arrays))
    geometry.setAttribute(
      name,
      new T.BufferAttribute(array, name === 'uv' || name === 'uv2' ? 2 : name === 'color' ? 4 : 3),
    );
  geometry.setIndex(indices[0]);
  geometry.userData.nativeLods = indices.slice(1).map((a, i) => ({
    distance: [0.07, 0.24][i],
    index: new T.BufferAttribute(Uint32Array.from(a), 1),
  }));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  markNativeImmutableGeometry(geometry);
  bodies.set(id, geometry);
  return geometry;
}
export function nativeInfantryGeometry(key, side) {
  return presentationEnabled() ? mergedBody(key, side) : null;
}
export function nativeLegGeometry() {
  return presentationEnabled() && data.models['infantry-leg']
    ? mergedBody('infantry-leg', 0)
    : null;
}
const legOffset = new T.Vector3();
export function nativeLegMatrix(object) {
  // Downed/corpse source matrices place the old centred box, while the authored
  // leg uses a hip origin. Shift in the posed local Y, including the fall phase.
  if (nativeLegGeometry()) {
    legOffset.set(0, object.scale.y * 0.5, 0).applyQuaternion(object.quaternion);
    object.position.add(legOffset);
    object.updateMatrix();
  }
  return object.matrix;
}
export function nativeInfantryMaterial(key, side, leg = false) {
  if (!presentationEnabled()) return null;
  const id = key + '/' + side + '/' + leg;
  if (materials.has(id)) return materials.get(id);
  const model = data.models[key],
    contract = model?.contract || {},
    p = contract.pivots || {};
  const v = (name, fallback) => new T.Vector3(...(p[name] || fallback));
  const uniforms = {
    legMesh: { value: leg ? 1 : 0 },
    shoulderLeft: { value: v('shoulder.L', [-0.48, 2.18, 0]) },
    shoulderRight: { value: v('shoulder.R', [0.48, 2.18, 0]) },
    elbowLeft: { value: v('elbow.L', [-0.35, 1.98, 0.4]) },
    elbowRight: { value: v('elbow.R', [0.4, 1.98, 0.3]) },
    hasAtlas: { value: 0 },
    atlas: { value: null },
    legTint: { value: new T.Color(['#3c4d3f', '#52483b', '#3e5162', '#5d513c'][side]) },
  };
  const atlasName = Object.keys(data.textures).find((name) => /albedo|base.?color/i.test(name));
  if (atlasName) {
    uniforms.atlas.value = pack.texture(atlasName, true);
    uniforms.hasAtlas.value = 1;
  }
  const material = new T.ShaderMaterial({ uniforms, vertexColors: true });
  material.userData.nativeFamily = 'infantry';
  material.name = 'native04/infantry/' + id;
  materials.set(id, material);
  return material;
}
function writePose(mesh, units, time, legs) {
  let pose = mesh.userData.nativePose;
  if (!pose || pose.count < mesh.instanceMatrix.count)
    pose = mesh.userData.nativePose = new T.InstancedBufferAttribute(
      new Float32Array(mesh.instanceMatrix.count * 4),
      4,
    );
  let changed = false,
    last = -2,
    member = 0;
  for (let i = 0; i < mesh.count; i++) {
    const id = mesh.userData.unitIds[i],
      u = units.get(id);
    if (id !== last) {
      last = id;
      member = 0;
    }
    const m = legs ? Math.floor(member / 2) : member,
      leg = legs ? member % 2 : 0;
    const moving = !!u?.moving && !u.downed,
      reloading = (u?.reloadLeft || u?.groundReload || 0) > 0,
      digging = !!u?.digging;
    const action = reloading ? 2 : digging ? 3 : 1;
    const active = u && !u.downed,
      p = active && moving ? time * 12 + m * 1.7 + leg * Math.PI : 0;
    const recoil = active ? Math.exp(-Math.max(0, time - (u.lastFire ?? -100)) * 22) : 0;
    const clock = active ? (action === 1 ? (recoil > 0.002 ? recoil : 0) : time * 6) : 0;
    for (let c = 0; c < 4; c++) {
      const v = Math.fround(
        c === 0
          ? p
          : c === 1
            ? active && moving
              ? 1
              : 0
            : c === 2
              ? active
                ? action
                : 0
              : clock,
      );
      if (pose.array[i * 4 + c] !== v) {
        pose.array[i * 4 + c] = v;
        changed = true;
      }
    }
    member++;
  }
  if (changed) pose.needsUpdate = true;
}
export function syncNativeInfantryPose(batch, units, time) {
  if (!presentationEnabled()) return;
  const byId = (batch.nativePoseUnitIndex ||= new Map());
  if (byId.size > units.length + 64) byId.clear();
  for (const u of units) byId.set(u.id, u);
  for (const pool of batch.pools.values()) {
    writePose(pool.body, byId, time, false);
    writePose(pool.legs, byId, time, true);
  }
}
export function nativeInfantryWarmupMeshes() {
  if (!presentationEnabled()) return [];
  return Object.keys(data.models)
    .filter((key) => key !== 'infantry-leg')
    .flatMap((key) => [
      new T.InstancedMesh(nativeInfantryGeometry(key, 0), nativeInfantryMaterial(key, 0), 1),
      new T.InstancedMesh(nativeLegGeometry(), nativeInfantryMaterial(key, 0, true), 1),
    ]);
}
