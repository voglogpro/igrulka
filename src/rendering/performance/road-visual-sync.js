import { passable } from '../../game/index.js';
import { disposeTree } from '../mesh-utils.js';

// Layout clipping is global data, while decorated models have local footprints.
export function syncRoadVisuals(world) {
  // Only batch casters affect the sun map; clearTrees owns real forest invalidation.
  const view = world.roadView.update(world.state.roads, passable);
  if (view.layoutChanged)
    world.streetLayout = view.roads.map((r) => ({
      a: { x: r.ax, z: r.az },
      b: { x: r.bx, z: r.bz },
      width: r.connectorTo ? 5 : 10,
      index: r.id,
    }));
  for (const id of view.removed) {
    const model = world.roadModels.get(id);
    if (model) disposeTree(model, world.sharedGeometries, world.sharedMaterials);
    world.roadModels.delete(id);
    world.roadVisuals.delete(id);
    if (world.roadBatch.castShadows) world.renderer.shadowMap.needsUpdate = true;
  }
  for (const r of view.changed) {
    const old = world.roadModels.get(r.id);
    if (old) disposeTree(old, world.sharedGeometries, world.sharedMaterials);
    world.roadModels.set(r.id, world.road(r, world.streetLayout));
    const record = view.records.get(r.id);
    world.roadVisuals.set(r.id, `${record.open}:${record.stage}:${record.intact}`);
    if (world.roadBatch.castShadows) world.renderer.shadowMap.needsUpdate = true;
  }
  if (view.layoutChanged || view.changed.length) world.roadBatch.sync(world.roadModels);
}
