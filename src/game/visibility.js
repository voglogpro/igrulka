import { groundVisible } from './units/infantry/cover.js';
import { BUILDINGS } from './config.js';
import { buildingConnected } from './city/road-network.js';
// The whole battlefield is visible. Radar supplies fire-control assistance, never fog of war.

export const VISION = { radar: 320 };
export function sensorSources(s, side) {
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
export const pointVisible = () => true;
export const unitVisible = (s, side, u) => u.delay <= 0 && (u.hp > 0 || u.status === 'falling');
export const eventVisible = () => true;
export function observedTarget(s, side, id) {
  const u = (s.groundUnits || []).find((u) => u.id === Number(id) && u.hp > 0);
  if (u) return groundVisible(s, side, u) ? { ...u, ground: true } : null;
  const b = s.buildings.find((b) => b.id === Number(id));
  if (b) return b.demolished ? null : b;
  const r = s.roads.find((r) => r.id === Number(id) && !r.removed);
  return r ? { ...r, key: 'road', x: (r.ax + r.bx) / 2, z: (r.az + r.bz) / 2, progress: 1 } : null;
}
export function knownTargets(s, side) {
  return [...s.buildings, ...s.roads]
    .filter((b) => b.side !== side)
    .map((b) => observedTarget(s, side, b.id))
    .filter((b) => b && b.hp > 0);
}
