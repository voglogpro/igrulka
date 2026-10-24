import { groundVisible } from './units/infantry/cover.js';
// The map and ordinary targets are open. Infantry concealment remains independent.
import { radarSources, VISION } from './vision-grid.js';
export { VISION };
export const sensorSources = radarSources;
export const pointVisible = () => true;
export const unitVisible = (_s, _side, u) => u.delay <= 0 && (u.hp > 0 || u.status === 'falling');
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
