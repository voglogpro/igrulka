import { equipmentModifiers } from '../combat/upgrade-tiers.js';
import { acceptLaunchDelivery } from '../units/aviation/launch-supply.js';
import { updateElectronics } from './electronics.js';
import { BUILDINGS, WEAPONS } from '../config.js';
import { event } from '../shared/events.js';
import { supplyFactor } from './economy.js';
import { passable, dirtyNetwork } from './road-network.js';
// Assembly lines of a drone base by equipment level.
export const FACTORY_LINES = [2, 3, 4];
export function updateConstruction(s, rates, dt) {
  for (const b of s.buildings) {
    if (b.hp <= 0) continue;
    const d = BUILDINGS[b.key];
    if (b.progress < 1) {
      const old = b.progress;
      b.progress = Math.min(1, b.progress + dt / d.time);
      b.hp = Math.min(b.maxHp, b.hp + (b.progress - old) * b.maxHp * 0.7);
      if (b.progress === 1) event(s, 'complete', { side: b.side, x: b.x, z: b.z, key: b.key });
      continue;
    }
    if (b.repairing) {
      b.hp = Math.min(b.maxHp, b.hp + 12 * dt);
      if (b.hp === b.maxHp) b.repairing = false;
    }
    b.launchCooldown = Math.max(0, (b.launchCooldown || 0) - dt);
    if (b.key === 'factory' && b.queue?.length) {
      // Parallel assembly lines: the first items of the paid queue are built side by side.
      // A finished craft waits on its line until the factory warehouse has room for it.
      const lines = Math.min(b.queue.length, FACTORY_LINES[Math.max(0, Math.min(2, b.level || 0))]),
        rate =
          dt * rates[b.side].productivity * supplyFactor(s, b) * equipmentModifiers(b).production;
      for (let i = 0; i < lines; i++) {
        const q = b.queue[i];
        q.progress = Math.min(1, q.progress + rate / WEAPONS[q.key].time);
      }
      for (let i = 0; i < Math.min(lines, b.queue.length);) {
        const q = b.queue[i];
        if (q.progress >= 1 && acceptLaunchDelivery(b, q.key, 1)) {
          b.queue.splice(i, 1);
          event(s, 'produced', { side: b.side, key: q.key, x: b.x, z: b.z });
        } else i++;
      }
    }
  }
  updateElectronics(s, rates, dt);
  for (const r of s.roads)
    if (r.repairing && !r.removed) {
      const before = passable(r);
      r.hp = Math.min(r.maxHp, r.hp + 16 * dt);
      if (r.hp >= r.maxHp * 0.85) r.blocked = false;
      if (before !== passable(r)) dirtyNetwork(s);
      if (r.hp === r.maxHp) r.repairing = false;
    }
}
