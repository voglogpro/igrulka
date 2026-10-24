import { pcm as first } from './samples/footstep-1.js';
import { pcm as second } from './samples/footstep-2.js';
import { pcm as third } from './samples/footstep-3.js';
import { pcm as truck } from './samples/truck-engine.js';

const FOOT = new Set([
  'infantry',
  'atrifle',
  'atgm',
  'machinegunner',
  'sniper',
  'assault',
  'engineer',
  'operator',
  'medic',
  'mog',
]);
export function recordedGroundSample(rate, kind, variant = 0) {
  const bytes = atob(kind === 'truck' ? truck : [first, second, third][variant]);
  const source = new Float32Array(bytes.length / 2);
  for (let i = 0; i < source.length; i++) {
    const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
    source[i] = (value >= 32768 ? value - 65536 : value) / 32768;
  }
  const data = new Float32Array(Math.round((source.length * rate) / 16000));
  for (let i = 0; i < data.length; i++) {
    const at = (i * 16000) / rate,
      index = Math.floor(at),
      fraction = at - index;
    data[i] = source[index] * (1 - fraction) + source[(index + 1) % source.length] * fraction;
  }
  return data;
}

// Four nearby walkers, at most eight short starts/second; no per-soldier audio loop.
export class FootstepScheduler {
  constructor() {
    this.next = new Map();
    this.lastTime = -1;
    this.nextGroup = 0;
  }
  take(units, listener, time, silent = false) {
    if (time < this.lastTime) {
      this.next.clear();
      this.nextGroup = time;
    }
    this.lastTime = time;
    if (silent) {
      this.next.clear();
      this.nextGroup = time;
      return null;
    }
    if (time < this.nextGroup) return null;
    const nearest = [];
    for (const u of units) {
      if (!FOOT.has(u.key) || u.hp <= 0 || !u.moving || u.downed || u.carrierId) continue;
      const distance = Math.hypot(u.x - listener.x, (u.y ?? 2) - listener.y, u.z - listener.z);
      if (distance >= 320 || (nearest.length === 4 && distance >= nearest[3].distance)) continue;
      nearest.push({ u, distance });
      nearest.sort((a, b) => a.distance - b.distance);
      if (nearest.length > 4) nearest.pop();
    }
    const ids = new Set(nearest.map((item) => item.u.id));
    for (const id of this.next.keys()) if (!ids.has(id)) this.next.delete(id);
    const item = nearest.find((item) => (this.next.get(item.u.id) ?? -1) <= time);
    if (!item) return null;
    this.next.set(item.u.id, time + 0.46);
    this.nextGroup = time + 0.125;
    return item.u;
  }
}
