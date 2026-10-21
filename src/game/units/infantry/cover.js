import { BUILDINGS, GROUND_UNITS, isInfantry, riverDistance, dayPhase } from '../../config.js';
import { segmentDistance } from '../../city/road-network.js';
let seed = 81273;
const rnd = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
export const COVER_PATCHES = [];
const coverCache = new WeakMap();
for (let i = 0; i < 180 && COVER_PATCHES.length < 82; i++) {
  const x = (rnd() - 0.5) * 1640,
    z = (rnd() - 0.5) * 1080,
    r = 13 + rnd() * 17;
  if (riverDistance(x, z) < 105 || Math.hypot(x + 615, z) < 175 || Math.hypot(x - 615, z) < 175)
    continue;
  COVER_PATCHES.push({ x, z, r, forest: i % 3 !== 0 });
}
export function coverInfo(s, u) {
  let cache = coverCache.get(s);
  if (!cache) {
    cache = new WeakMap();
    coverCache.set(s, cache);
  }
  const previous = cache.get(u);
  if (previous && previous.time === s.time && previous.x === u.x && previous.z === u.z)
    return previous.value;
  let cover = 0,
    concealment = 0,
    kind = 'Открыто';
  for (const p of COVER_PATCHES)
    if (Math.hypot(u.x - p.x, u.z - p.z) < p.r) {
      cover = p.forest ? 0.4 : 0.25;
      concealment = p.forest ? 0.75 : 0.6;
      kind = p.forest ? 'Лес' : 'Кустарник';
      break;
    }
  for (const b of s.buildings)
    if (
      b.hp <= 0 &&
      !b.demolished &&
      Math.hypot(b.x - u.x, b.z - u.z) < (BUILDINGS[b.key]?.size || 30) * 0.75
    ) {
      cover = Math.max(cover, 0.5);
      concealment = Math.max(concealment, 0.4);
      kind = 'Руины';
    }
  for (const t of s.trenches || [])
    if (t.progress >= 1 && Math.hypot(t.x - u.x, t.z - u.z) < 5) {
      cover = Math.max(cover, 0.72);
      concealment = Math.max(concealment, 0.55);
      kind = 'Окоп';
    }
  const value = { cover, concealment, kind };
  cache.set(u, { time: s.time, x: u.x, z: u.z, value });
  return value;
}
export function lineOfSight(s, a, b) {
  return !s.buildings.some(
    (o) =>
      o.hp > 0 &&
      !o.demolished &&
      o.id !== a.id &&
      o.id !== b.id &&
      (BUILDINGS[o.key]?.height || 15) > 4 &&
      Math.hypot(a.x - o.x, a.z - o.z) > (BUILDINGS[o.key]?.size || 30) * 0.65 &&
      segmentDistance(o.x, o.z, a.x, a.z, b.x, b.z) < (BUILDINGS[o.key]?.size || 30) * 0.48,
  );
}
export function groundVisible(s, side, u) {
  if (!u || u.hp <= 0 || u.carrierId) return false;
  if (u.side === side || !isInfantry(u.key)) return true;
  const c = coverInfo(s, u);
  if (!c.concealment || u.moving) return true;
  const factor = u.camouflaged ? 0.2 : 0.43,
    flash = s.time - (u.lastFire ?? -1000) < 2.2,
    night = 0.65 + dayPhase(s.time).daylight * 0.35;
  const observers = [
    ...(s.groundUnits || []).filter((v) => v.side === side && v.hp > 0 && !v.carrierId),
    ...s.buildings.filter((b) => b.side === side && b.hp > 0 && b.progress >= 1),
  ];
  const value = observers.some((v) => {
    const sight = GROUND_UNITS[v.key]?.sight || (v.key === 'hq' ? 220 : 120),
      range = Math.max(27, sight * night * (flash ? Math.max(factor, 0.6) : factor));
    return Math.hypot(v.x - u.x, v.z - u.z) < range && lineOfSight(s, v, u);
  });
  return value;
}
export function recordFire(s, u, random) {
  u.lastFire = s.time;
  s.contacts ||= [[], []];
  for (let side = 0; side < 2; side++) {
    if (side === u.side || groundVisible(s, side, u)) continue;
    const heard = (s.groundUnits || []).some(
      (v) => v.side === side && v.hp > 0 && !v.carrierId && Math.hypot(v.x - u.x, v.z - u.z) < 300,
    );
    if (!heard) continue;
    const old = s.contacts[side].find((c) => c.unitId === u.id);
    if (old && s.time - old.time < 2) continue;
    const contact = {
      unitId: u.id,
      x: u.x + (random(s) - 0.5) * 30,
      z: u.z + (random(s) - 0.5) * 30,
      radius: 20,
      expires: s.time + 7,
      time: s.time,
    };
    if (old) Object.assign(old, contact);
    else s.contacts[side].push(contact);
  }
}
