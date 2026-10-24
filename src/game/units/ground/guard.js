import { FIELD, GROUND_UNITS, isInfantry } from '../../config.js';
import { groundPath, walkable } from './navigation.js';
import { coverInfo, groundVisible, lineOfSight } from '../infantry/cover.js';
import { cancelTransportDelivery } from '../vehicles/transport.js';
import { clearGroundRoute } from './route-queue.js';

const GUARD_RADIUS = 95;
const ALLY_RADIUS = 68;
const ASSIST_RADIUS = 55;
const MAX_LEASH = 145;
const TARGET_REPATH = 1.4;
export const GUARD_COVER_RADIUS = 26;
export const GUARD_POST_RADIUS = 54;
export const GUARD_POST_CANDIDATES = 121;
export const GUARD_PATH_ATTEMPTS = 4;
export const GUARD_POST_CLEARANCE = 7;

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pointValid = (s, u, p) =>
  p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  Math.abs(p.x) <= FIELD.x &&
  Math.abs(p.z) <= FIELD.z &&
  walkable(s, p.x, p.z, GROUND_UNITS[u.key].size * 0.42);

function coveredPost(s, u, p) {
  const size = GROUND_UNITS[u.key].size;
  const occupied = s.groundUnits
    .filter((v) => v.id !== u.id && v.side === u.side && v.hp > 0 && !v.carrierId)
    .map((v) => ({ unit: v, point: v.guard || (!v.path?.length ? v : null) }))
    .filter((entry) => entry.point);
  const free = (candidate) =>
    occupied.every(
      ({ unit, point }) =>
        distance(candidate, point) >=
        (size + GROUND_UNITS[unit.key].size) * 0.5 + GUARD_POST_CLEARANCE - 1e-6,
    );
  const candidates = [{ x: p.x, z: p.z, distance: 0, nearby: true }];
  if (isInfantry(u.key))
    for (const radius of [10, 18, GUARD_COVER_RADIUS])
      for (let i = 0; i < 8; i++) {
        const angle = (i * Math.PI) / 4;
        candidates.push({
          x: p.x + Math.cos(angle) * radius,
          z: p.z + Math.sin(angle) * radius,
          distance: radius,
          nearby: true,
        });
      }
  // Reserve destinations when assigning orders, before recruits arrive there.
  // A fixed lattice makes simultaneous queues deterministic without per-tick separation work.
  const step = Math.max(10, size + GUARD_POST_CLEARANCE);
  const extent = Math.floor(GUARD_POST_RADIUS / step);
  const slots = [];
  for (let iz = -extent; iz <= extent; iz++)
    for (let ix = -extent; ix <= extent; ix++) {
      const radius = Math.hypot(ix * step, iz * step);
      if (radius > GUARD_POST_RADIUS || radius === 0) continue;
      slots.push({ x: p.x + ix * step, z: p.z + iz * step, distance: radius, nearby: false });
    }
  slots.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
  const seen = new Set(
    candidates.map((candidate) => `${candidate.x.toFixed(6)},${candidate.z.toFixed(6)}`),
  );
  for (const slot of slots) {
    if (candidates.length >= GUARD_POST_CANDIDATES) break;
    const key = `${slot.x.toFixed(6)},${slot.z.toFixed(6)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    candidates.push(slot);
  }
  const ranked = candidates
    .filter((candidate) => pointValid(s, u, candidate) && free(candidate))
    .map((candidate) => ({
      ...candidate,
      score:
        coverInfo(s, { key: u.key, x: candidate.x, z: candidate.z }).cover * 100 -
        candidate.distance * 0.6,
    }))
    .sort(
      (a, b) => Number(b.nearby) - Number(a.nearby) || b.score - a.score || a.distance - b.distance,
    );
  for (const candidate of ranked.slice(0, GUARD_PATH_ATTEMPTS)) {
    if (distance(u, candidate) <= 3) return { point: candidate, path: [] };
    const path = groundPath(s, u, candidate, GROUND_UNITS[u.key].size * 0.42);
    if (path.length) return { point: candidate, path };
  }
  return null;
}

function assignPost(s, u, p, snapToCover = false) {
  if (!pointValid(s, u, p)) return false;
  const placement = snapToCover
    ? coveredPost(s, u, p)
    : {
        point: p,
        path: groundPath(s, u, p, GROUND_UNITS[u.key].size * 0.42),
      };
  if (!placement || (!placement.path.length && distance(u, placement.point) > 3)) return false;
  const post = { x: placement.point.x, z: placement.point.z };
  clearGroundRoute(u);
  cancelTransportDelivery(u);
  u.guard = post;
  u.stance = null;
  u.guardTargetId = null;
  u.guardNextThink = 0;
  u.path = placement.path;
  u.order = { ...post, mode: 'guard' };
  u.boardingId = null;
  u.digging = false;
  u.trenchId = null;
  u.navRevision = s.networkRevision;
  return true;
}

export function guardGround(s, side, ids, point) {
  if (s.result) return 'Кампания завершена';
  const units = (s.groundUnits || []).filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && !u.downed && ids.includes(u.id),
  );
  if (!units.length) return 'Выберите доступные наземные отряды';
  let assigned = 0;
  for (const u of units) if (assignPost(s, u, point, true)) assigned++;
  return assigned || 'Нет свободного доступного места для поста';
}

export function defendLineGround(s, side, ids, a, b) {
  if (s.result) return 'Кампания завершена';
  if (![a?.x, a?.z, b?.x, b?.z].every(Number.isFinite)) return 'Укажите оба конца линии';
  const units = (s.groundUnits || []).filter(
    (u) => u.side === side && u.hp > 0 && !u.carrierId && ids.includes(u.id),
  );
  if (!units.length) return 'Выберите доступные наземные отряды';
  let assigned = 0;
  for (let i = 0; i < units.length; i++) {
    const t = units.length === 1 ? 0.5 : i / (units.length - 1);
    if (assignPost(s, units[i], { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t })) assigned++;
  }
  return assigned || 'Линия не проходит по доступной суше';
}

function threats(s, u) {
  const alliedPosts = s.groundUnits.filter(
    (v) => v.side === u.side && v.hp > 0 && v.guard && distance(v.guard, u.guard) <= ALLY_RADIUS,
  );
  return s.groundUnits
    .filter(
      (enemy) =>
        enemy.side !== u.side &&
        enemy.hp > 0 &&
        !enemy.carrierId &&
        distance(enemy, u.guard) <= MAX_LEASH &&
        groundVisible(s, u.side, enemy) &&
        (distance(enemy, u.guard) <= GUARD_RADIUS ||
          alliedPosts.some(
            (ally) => ally.id !== u.id && distance(enemy, ally.guard) <= ASSIST_RADIUS,
          )) &&
        lineOfSight(s, u, enemy),
    )
    .sort((a, b) => distance(a, u.guard) - distance(b, u.guard) || a.id - b.id);
}

export function updateGuard(s, u) {
  if (!u.guard || !GROUND_UNITS[u.key] || u.carrierId || u.boardingId) return;
  if ((u.guardNextThink || 0) > s.time) return;
  u.guardNextThink = s.time + 0.4;
  const d = GROUND_UNITS[u.key];
  const target = u.holdFire ? null : threats(s, u)[0];
  const firingDistance = (d.groundRange || 0) * 0.78;
  if (target && firingDistance > 0) {
    u.guardTargetId = target.id;
    if (
      distance(u, target) > firingDistance &&
      (!u.path?.length || u.order?.mode !== 'guardIntercept' || (u.guardRepathAt || 0) <= s.time)
    ) {
      const toward = {
        x: target.x + (u.x - target.x) * (firingDistance / distance(u, target)),
        z: target.z + (u.z - target.z) * (firingDistance / distance(u, target)),
      };
      if (pointValid(s, u, toward)) {
        const path = groundPath(s, u, toward, d.size * 0.42);
        if (path.length) {
          u.path = path;
          u.order = { ...toward, mode: 'guardIntercept', targetId: target.id };
          u.guardRepathAt = s.time + TARGET_REPATH;
        }
      }
    } else if (distance(u, target) <= firingDistance && u.order?.mode === 'guardIntercept') {
      u.path = [];
    }
    return;
  }
  u.guardTargetId = null;
  if (distance(u, u.guard) <= 3) {
    u.path = [];
    u.order = { ...u.guard, mode: 'guard' };
    return;
  }
  if (!u.path?.length || u.order?.mode !== 'guard') {
    const path = groundPath(s, u, u.guard, d.size * 0.42);
    if (path.length) {
      u.path = path;
      u.order = { ...u.guard, mode: 'guard' };
    }
  }
}
