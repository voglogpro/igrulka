// Read-only semantic ownership for the native art layer. Nothing here changes
// authoritative state, damage, paths or visibility. Presentation transforms are
// applied separately, equally to the drawn mesh and its original picking proxy.
const readers = new WeakMap();
import { bindPresentationWorld } from './trench-presentation.mjs';
import { presentationTrenchLayout } from './trench-link-layout.mjs';

export function registerVisualWorld(world) {
  bindPresentationWorld(world);
  if (readers.has(world.scene)) return;
  readers.set(world.scene, { world, terrain: null, sectionRevision: -1, linkRevision: -1 });
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
  const layout = presentationTrenchLayout(world, true);
  const newLayout = reader.layout !== layout;
  reader.layout = layout;
  if (reset || newLayout || reader.sectionRevision !== layout.sectionsRevision) {
    reader.sectionRevision = layout.sectionsRevision;
    result.trenches = layout.sections;
    result.trenchPools = world.fortifications?.pools?.map((pool) => pool.uuid) || [];
  }
  if (reset || newLayout || reader.linkRevision !== layout.linksRevision) {
    reader.linkRevision = layout.linksRevision;
    result.trenchLinks = layout.connectors;
    result.trenchLinkPools = world.fortifications?.links?.pools?.map((pool) => pool.uuid) || [];
  }
  return Object.keys(result).length ? result : undefined;
}
