import { BUILDINGS, GROUND_UNITS, MAP } from './config.js';
import { buildingConnected } from './city/road-network.js';

// Compatibility API for the retired map fog. Radar remains an AA targeting aid;
// concealment of individual infantry is handled separately in infantry/cover.js.
export const VISION = { radar: 320 };
export const GRID = {
  cell: 40,
  cols: Math.ceil(MAP.width / 40),
  rows: Math.ceil(MAP.depth / 40),
  ox: -MAP.width / 2,
  oz: -MAP.depth / 2,
};

// Radars that actually work: they need power from the connected grid.
export function radarSources(s, side) {
  const buildings = s.buildings.filter((b) => b.side === side && b.hp > 0 && b.progress >= 1);
  let power = 10,
    demand = 0;
  for (const b of buildings) {
    const d = BUILDINGS[b.key];
    if (!d) continue;
    if (d.power < 0)
      power -=
        d.power * (0.5 + (0.5 * b.hp) / b.maxHp) * (buildingConnected(s, b, d.size) ? 1 : 0.2);
    else demand += d.power;
  }
  return power < demand * 0.5
    ? []
    : buildings
        .filter((b) => b.key === 'radar')
        .map((b) => ({ x: b.x, z: b.z, air: VISION.radar, kind: 'radar', id: b.id }));
}

// Rain, fog and night shrink every observation circle; radar is not affected.
export const weatherVisibility = (s) => s.weather?.visibility ?? 1;

// Seeing distance of an observer. Weather and night shrink the sight but never below the range
// of its own direct-fire weapon, so a gun can always shoot at what it could reach.
export function observerRadius(o, scale = 1) {
  const d = GROUND_UNITS[o.key];
  if (d) {
    const reach = d.indirect ? 0 : Math.max(d.groundRange || 0, d.range || 0);
    return Math.max((d.sight || 150) * scale, reach);
  }
  const b = BUILDINGS[o.key];
  const sight = o.key === 'hq' ? 260 : 150;
  return Math.max(sight * scale, b?.range || 0);
}

// One immutable compatibility snapshot; no per-side observer grid or periodic rebuild.
const openVision = Object.freeze({
  radar: false,
  grid: new Uint8Array(GRID.cols * GRID.rows).fill(1),
});
export function visionOf() {
  return openVision;
}
export function fogVisible() {
  return true;
}
