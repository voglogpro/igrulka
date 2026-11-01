import { NativeModelPack } from './model-pack.mjs';
import data from '../art-assets/ground-v04.json' with { type: 'json' };
import { presentationEnabled } from './trench-presentation.mjs';

const pack = new NativeModelPack(data, { paintScale: 0.6 });
export function nativeVehicleWarmupModels() {
  return presentationEnabled() ? Object.keys(data.models).map((key) => pack.create(key, 0, 2)) : [];
}
export function buildNativeVehicle(world, u, root, paint, accent, dynamic) {
  if (!presentationEnabled()) return false;
  const model = pack.create(u.key, u.side, u.level || 0);
  if (!model) return false;
  for (const child of [...model.children]) root.add(child);
  root.userData.nativeArt = u.key;
  for (const joint of data.models[u.key].contract.joints || []) {
    const node = root.getObjectByName(joint.name);
    if (!node) continue;
    if (joint.muzzles) node.userData.muzzles = joint.muzzles.map((a) => [...a]);
    if (joint.backward) node.userData.backward = true;
  }
  if (u.key === 'mog') root.getObjectByName('turret').userData.backward = true;
  root.userData.turret = root.getObjectByName('turret');
  root.userData.pitch = root.getObjectByName('pitch');
  root.traverse((node) => {
    if (node.isMesh || ['turret', 'pitch', 'recoil', 'dish', 'field-position'].includes(node.name))
      dynamic.add(node);
  });
  return true;
}
export function animateNativeVehicleDrive(model, phase) {
  if (!model.userData.nativeArt) return false;
  // Rigid authored wheels use the existing simulation-derived drivePhase.
  // No duplicate source wheel meshes or per-vehicle material copies are needed.
  model.traverse((node) => {
    if (node.userData.wheel_axis || node.userData.drive_axis === 'X') node.rotation.x = phase;
  });
  return true;
}
