import * as E from '../../game/index.js';
import { radarSources } from '../../game/vision-grid.js';

const caches = new WeakMap();
function sourcesFor(world, target) {
  const s = world.state,
    time = s.time || 0,
    network = !!world.callbacks?.isNetwork?.();
  let cache = caches.get(world);
  if (
    !cache ||
    cache.seed !== s.seed ||
    cache.mode !== s.mode ||
    cache.players !== s.sides.length ||
    time < cache.time ||
    (cache.state !== s && time <= cache.time) ||
    (!network && cache.sides !== s.sides)
  ) {
    cache = { seed: s.seed, mode: s.mode, players: s.sides.length };
    caches.set(world, cache);
  }
  const radar = target.key === 'radar';
  const selectedRadarChanged =
    radar &&
    (cache.radarId !== target.id ||
      cache.radarLevel !== target.level ||
      cache.radarX !== target.x ||
      cache.radarZ !== target.z ||
      cache.radarHp !== target.hp ||
      cache.radarProgress !== target.progress);
  if (
    !cache.sources ||
    cache.revision !== s.networkRevision ||
    time >= cache.nextAt ||
    selectedRadarChanged
  ) {
    cache.sources = radarSources(s, target.side);
    cache.revision = s.networkRevision;
    cache.nextAt = time + 0.5;
  }
  cache.time = time;
  cache.state = s;
  cache.sides = s.sides;
  if (radar) {
    cache.radarId = target.id;
    cache.radarLevel = target.level;
    cache.radarX = target.x;
    cache.radarZ = target.z;
    cache.radarHp = target.hp;
    cache.radarProgress = target.progress;
  }
  return cache.sources;
}

export function updateSelectionCoverage(world, target) {
  // Targeting/build previews own the same mesh, including the FPV 320 m ring.
  if (world.buildKey || world.aiming || world.groundTargeting) return;
  const base = E.BUILDINGS[target?.key] || E.GROUND_UNITS[target?.key];
  if (
    !target ||
    target.side !== 0 ||
    target.hp <= 0 ||
    target.demolished ||
    target.progress < 1 ||
    (target.ground && world.armySelection.length > 1) ||
    (E.isInfantry(target.key) && target.key !== 'mog') ||
    (target.key !== 'radar' && !base?.range)
  ) {
    world.coverage.visible = false;
    return;
  }
  const sources = sourcesFor(world, target);
  const range =
    target.key === 'radar'
      ? sources.find((source) => source.id === target.id)?.air || 0
      : E.defenseStats(world.state.sides[target.side], target).range *
        E.radarFireSupport(world.state, target.side, target.x, target.z, sources).rangeMultiplier;
  world.coverage.visible = range > 0;
  if (range > 0) {
    world.coverage.scale.setScalar(range);
    world.coverage.position.set(target.x, 1.4, target.z);
  }
}
