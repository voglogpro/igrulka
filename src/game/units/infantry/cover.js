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
function coverForDirection(value, from, u) {
  if (!value.wall) return { cover: value.cover, concealment: value.concealment, kind: value.kind };
  const range = Math.hypot(from?.x - u.x, from?.z - u.z);
  const facing =
    range > 0 ? ((from.x - u.x) * value.wall.nx + (from.z - u.z) * value.wall.nz) / range : 1;
  const wallCover = facing > 0.45 ? 0.33 : 0.08;
  return wallCover > value.cover
    ? { cover: wallCover, concealment: value.concealment, kind: 'Стена' }
    : { cover: value.cover, concealment: value.concealment, kind: value.kind };
}

export function coverInfo(s, u, from = null) {
  let cache = coverCache.get(s);
  if (!cache) {
    cache = new WeakMap();
    coverCache.set(s, cache);
  }
  const previous = cache.get(u);
  if (
    previous &&
    previous.time === s.time &&
    previous.revision === s.networkRevision &&
    previous.x === u.x &&
    previous.z === u.z
  )
    return coverForDirection(previous.value, from, u);
  let cover = 0,
    concealment = 0,
    kind = 'Открыто',
    wall = null;
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
  if (isInfantry(u.key))
    for (const b of s.buildings) {
      if (b.hp <= 0 || b.demolished || b.progress < 1) continue;
      const half = (BUILDINGS[b.key]?.size || 30) * 0.56;
      const dx = u.x - b.x;
      const dz = u.z - b.z;
      const edgeX = Math.abs(dx) - half;
      const edgeZ = Math.abs(dz) - half;
      if (edgeX >= 0 && edgeX <= 12 && Math.abs(dz) <= half + 4 && (!wall || edgeX < wall.distance))
        wall = { nx: Math.sign(dx), nz: 0, distance: edgeX };
      if (edgeZ >= 0 && edgeZ <= 12 && Math.abs(dx) <= half + 4 && (!wall || edgeZ < wall.distance))
        wall = { nx: 0, nz: Math.sign(dz), distance: edgeZ };
    }
  for (const t of s.trenches || [])
    if (t.progress >= 1 && Math.hypot(t.x - u.x, t.z - u.z) < 5) {
      cover = Math.max(cover, 0.72);
      concealment = Math.max(concealment, 0.55);
      kind = 'Окоп';
    }
  const value = { cover, concealment, kind, wall };
  cache.set(u, { time: s.time, revision: s.networkRevision, x: u.x, z: u.z, value });
  return coverForDirection(value, from, u);
}
export function lineOfSight(s, a, b) {
  return !s.buildings.some(
    (o) =>
      o.hp > 0 &&
      !o.demolished &&
      o.id !== a.id &&
      o.id !== b.id &&
      (BUILDINGS[o.key]?.height || 15) > 4 &&
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
