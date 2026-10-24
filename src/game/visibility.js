import { groundVisible } from './units/infantry/cover.js';
// Enemy buildings are always known; enemy units and launches need an observer or a radar.
import { fogVisible, radarSources, VISION } from './vision-grid.js';
export { VISION };
export const sensorSources = radarSources;
export const pointVisible = (s, side, x, z) => fogVisible(s, side, x, z);
export const unitVisible = (s, side, u) =>
  u.delay <= 0 &&
  (u.hp > 0 || u.status === 'falling') &&
  (u.side === side || fogVisible(s, side, u.x, u.z));
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
