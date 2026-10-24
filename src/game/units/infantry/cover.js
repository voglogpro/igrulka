import {
  BUILDINGS,
  GROUND_UNITS,
  isInfantry,
  dayPhase,
  groundHeight,
  terrainClear,
} from '../../config.js';
import { COVER_PATCHES } from '../../map.js';
import { segmentDistance } from '../../city/road-network.js';
import { fortificationStatus } from '../../defense/fortifications.js';
import { FORTIFICATION } from '../../defense/config.js';
// Forests and thickets are generated with the terrain so hills and woods line up.
export { COVER_PATCHES };
const coverCache = new WeakMap();
// Patches never move: bucket them once so a lookup checks only the patches around a point.
const PATCH_CELL = 64;
const patchCells = new Map();
for (const p of COVER_PATCHES)
  for (
    let cx = Math.floor((p.x - p.r) / PATCH_CELL);
    cx <= Math.floor((p.x + p.r) / PATCH_CELL);
    cx++
  )
    for (
      let cz = Math.floor((p.z - p.r) / PATCH_CELL);
      cz <= Math.floor((p.z + p.r) / PATCH_CELL);
      cz++
    ) {
      const key = cx + ',' + cz;
      if (!patchCells.has(key)) patchCells.set(key, []);
      patchCells.get(key).push(p);
    }
for (const list of patchCells.values())
  list.sort((a, b) => COVER_PATCHES.indexOf(a) - COVER_PATCHES.indexOf(b));
function patchAt(x, z) {
  for (const p of patchCells.get(Math.floor(x / PATCH_CELL) + ',' + Math.floor(z / PATCH_CELL)) ||
    [])
    if (Math.hypot(x - p.x, z - p.z) < p.r) return p;
  return null;
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
  const patch = patchAt(u.x, u.z);
  if (patch) {
    cover = patch.forest ? 0.4 : 0.25;
    concealment = patch.forest ? 0.75 : 0.6;
    kind = patch.forest ? 'Лес' : 'Кустарник';
  }
  const infantry = isInfantry(u.key);
  for (const b of s.buildings) {
    const dx = u.x - b.x,
      dz = u.z - b.z,
      size = BUILDINGS[b.key]?.size || 30;
    // Ruins reach 0.75 of the footprint, walls 0.56 plus 12 m; anything farther is irrelevant.
    if (Math.abs(dx) > size * 0.75 + 12 || Math.abs(dz) > size * 0.75 + 12 || b.demolished)
      continue;
    if (b.hp <= 0) {
      if (Math.hypot(dx, dz) < size * 0.75) {
        cover = Math.max(cover, 0.5);
        concealment = Math.max(concealment, 0.4);
        kind = 'Руины';
      }
      continue;
    }
    if (infantry && b.progress >= 1) {
      const half = size * 0.56;
      const edgeX = Math.abs(dx) - half;
      const edgeZ = Math.abs(dz) - half;
      if (edgeX >= 0 && edgeX <= 12 && Math.abs(dz) <= half + 4 && (!wall || edgeX < wall.distance))
        wall = { nx: Math.sign(dx), nz: 0, distance: edgeX };
      if (edgeZ >= 0 && edgeZ <= 12 && Math.abs(dx) <= half + 4 && (!wall || edgeZ < wall.distance))
        wall = { nx: 0, nz: Math.sign(dz), distance: edgeZ };
    }
  }
  for (const t of s.trenches || [])
    if (t.progress >= 1 && Math.hypot(t.x - u.x, t.z - u.z) < FORTIFICATION.coverRadius) {
      const fortification = fortificationStatus(t);
      cover = Math.max(cover, fortification.cover);
      concealment = Math.max(concealment, FORTIFICATION.concealment[fortification.level]);
      kind = 'Окоп';
    }
  const value = { cover, concealment, kind, wall };
  cache.set(u, { time: s.time, revision: s.networkRevision, x: u.x, z: u.z, value });
  return coverForDirection(value, from, u);
}
// Widest building footprint used as a cheap bounding-box reject before the exact segment test.
const MAX_BLOCKER_RADIUS = Math.max(30, ...Object.values(BUILDINGS).map((b) => b.size || 0)) * 0.48;
export function lineOfSight(s, a, b) {
  const minX = Math.min(a.x, b.x) - MAX_BLOCKER_RADIUS,
    maxX = Math.max(a.x, b.x) + MAX_BLOCKER_RADIUS,
    minZ = Math.min(a.z, b.z) - MAX_BLOCKER_RADIUS,
    maxZ = Math.max(a.z, b.z) + MAX_BLOCKER_RADIUS;
  for (const o of s.buildings) {
    if (o.x < minX || o.x > maxX || o.z < minZ || o.z > maxZ) continue;
    if (o.hp <= 0 || o.demolished || o.id === a.id || o.id === b.id) continue;
    const d = BUILDINGS[o.key];
    if ((d?.height || 15) <= 4) continue;
    if (segmentDistance(o.x, o.z, a.x, a.z, b.x, b.z) < (d?.size || 30) * 0.48) return false;
  }
  // Hills: the crest between two eyes hides them from each other.
  return terrainClear(a.x, a.z, eyeHeight(a), b.x, b.z, eyeHeight(b));
}
function eyeHeight(o) {
  const lift = BUILDINGS[o.key] ? 8 : GROUND_UNITS[o.key] && !isInfantry(o.key) ? 3.4 : 2.2;
  return groundHeight(o.x, o.z) + lift;
}
function observes(s, v, u, factor, flash, night) {
  const sight = GROUND_UNITS[v.key]?.sight || (v.key === 'hq' ? 220 : 120),
    range = Math.max(27, sight * night * (flash ? Math.max(factor, 0.6) : factor));
  return (v.x - u.x) ** 2 + (v.z - u.z) ** 2 < range * range && lineOfSight(s, v, u);
}
export function groundVisible(s, side, u) {
  if (!u || u.hp <= 0 || u.carrierId) return false;
  if (u.side === side) return true;
  if (!isInfantry(u.key)) return true;
  const c = coverInfo(s, u);
  if (!c.concealment || u.moving) return true;
  const factor = u.camouflaged ? 0.2 : 0.43,
    flash = s.time - (u.lastFire ?? -1000) < 2.2,
    night = (0.65 + dayPhase(s.time).daylight * 0.35) * (s.weather?.visibility ?? 1);
  for (const v of s.groundUnits || [])
    if (v.side === side && v.hp > 0 && !v.carrierId && observes(s, v, u, factor, flash, night))
      return true;
  for (const b of s.buildings)
    if (b.side === side && b.hp > 0 && b.progress >= 1 && observes(s, b, u, factor, flash, night))
      return true;
  return false;
}
// How far the sound of a shot carries, by weapon class.
const HEARING = {
  artillery: 800,
  rocket: 800,
  cannon: 620,
  antiArmor: 440,
  autocannon: 400,
  machinegun: 380,
};
export const hearingRange = (key) => HEARING[GROUND_UNITS[key]?.groundWeapon] || 300;
export function recordFire(s, u, random) {
  u.lastFire = s.time;
  s.contacts ||= [[], []];
  const range = hearingRange(u.key);
  for (let side = 0; side < 2; side++) {
    if (side === u.side || groundVisible(s, side, u)) continue;
    const heard =
      (s.groundUnits || []).some(
        (v) =>
          v.side === side &&
          v.hp > 0 &&
          !v.carrierId &&
          (v.x - u.x) ** 2 + (v.z - u.z) ** 2 < range * range,
      ) ||
      s.buildings.some(
        (b) =>
          b.side === side &&
          b.hp > 0 &&
          b.progress >= 1 &&
          (b.x - u.x) ** 2 + (b.z - u.z) ** 2 < range * range,
      );
    if (!heard) continue;
    const old = s.contacts[side].find((c) => c.unitId === u.id);
    if (old && s.time - old.time < 2) continue;
    const blur = Math.min(60, 20 + range / 40);
    const contact = {
      unitId: u.id,
      x: u.x + (random(s) - 0.5) * blur * 1.5,
      z: u.z + (random(s) - 0.5) * blur * 1.5,
      radius: blur,
      expires: s.time + 7,
      time: s.time,
    };
    if (old) Object.assign(old, contact);
    else s.contacts[side].push(contact);
  }
}
