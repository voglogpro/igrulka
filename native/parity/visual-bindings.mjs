// Read-only semantic ownership for the native art layer. Nothing here changes
// authoritative state, damage, paths or visibility. Presentation transforms are
// applied separately, equally to the drawn mesh and its original picking proxy.
const readers = new WeakMap();
import { bindPresentationWorld } from './trench-presentation.mjs';

export function registerVisualWorld(world) {
  bindPresentationWorld(world);
  if (readers.has(world.scene)) return;
  readers.set(world.scene, { world, terrain: null, trenches: new Map() });
}

export function captureVisualBindings(scene, reset = false) {
  const reader = readers.get(scene);
  if (!reader) return undefined;
  const { world } = reader;
  const result = {};
  const weather = world.state.weather;
  const weatherKey = weather && `${weather.kind}/${weather.amount}`;
  if (reset || weatherKey !== reader.weatherKey) {
    reader.weatherKey = weatherKey;
    result.weather = weather ? { kind: weather.kind, amount: weather.amount } : null;
  }
  if (world.ground && (reset || reader.terrain !== world.ground)) {
    const ground = world.ground;
    reader.terrain = ground;
    result.terrain = {
      objectId: ground.uuid,
      geometryId: ground.geometry.uuid,
      materialIds: (Array.isArray(ground.material) ? ground.material : [ground.material]).map(
        (material) => material.uuid,
      ),
    };
  }
  const models = world.fortifications?.models;
  if (models) {
    let changed = reset || reader.trenches.size !== models.size;
    if (!changed)
      for (const [id, record] of models)
        if (reader.trenches.get(id) !== record) {
          changed = true;
          break;
        }
    if (changed) {
      reader.trenches = new Map(models);
      result.trenches = Array.from(models, ([id, record]) => ({ id, ...record }));
      result.trenchPools = world.fortifications.pools.map((pool) => pool.uuid);
    }
  }
  return Object.keys(result).length ? result : undefined;
}
