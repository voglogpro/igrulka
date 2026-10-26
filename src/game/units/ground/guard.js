import { hostile } from '../../factions.js';
import { FIELD, GROUND_UNITS, isInfantry } from '../../config.js';
import { groundPath, walkable } from './navigation.js';
import { coverInfo, groundVisible, lineOfSight } from '../infantry/cover.js';
import { cancelTransportDelivery } from '../vehicles/transport.js';
import { clearGroundRoute } from './route-queue.js';
import { clearAutoDefense } from '../../defense/volunteers.js';
import { invalidateFrontline } from '../../defense/cache.js';

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

function guardCandidates(s, u, p) {
  const size = GROUND_UNITS[u.key].size;
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
  return candidates
    .filter((candidate) => pointValid(s, u, candidate))
    .map((candidate) => ({
      ...candidate,
      score:
        coverInfo(s, { key: u.key, x: candidate.x, z: candidate.z }).cover * 100 -
        candidate.distance * 0.6,
    }))
    .sort(
      (a, b) => Number(b.nearby) - Number(a.nearby) || b.score - a.score || a.distance - b.distance,
    );
}
function coveredPost(s, u, p, candidateCache = null) {
  // Static terrain/cover scores are shared only within this one group order.
  // Occupied posts are rechecked after every assignment, preserving separation.
  const key = `${u.key}:${p.x}:${p.z}`;
  let candidates = candidateCache?.get(key);
  if (!candidates) {
    candidates = guardCandidates(s, u, p);
    candidateCache?.set(key, candidates);
  }
  const size = GROUND_UNITS[u.key].size,
    occupied = s.groundUnits
      .filter((v) => v.id !== u.id && v.side === u.side && v.hp > 0 && !v.carrierId)
      .flatMap((v) => [
        { unit: v, point: v.guard || (!v.path?.length ? v : null) },
        ...(v.defenseTask ? [{ unit: v, point: v.defenseTask.home }] : []),
      ])
      .filter((entry) => entry.point);
  const ranked = candidates.filter((candidate) =>
    occupied.every(
      ({ unit, point }) =>
        distance(candidate, point) >=
        (size + GROUND_UNITS[unit.key].size) * 0.5 + GUARD_POST_CLEARANCE - 1e-6,
    ),
  );
  for (const candidate of ranked.slice(0, GUARD_PATH_ATTEMPTS)) {
    if (distance(u, candidate) <= 3) return { point: candidate, path: [] };
    const path = groundPath(s, u, candidate, GROUND_UNITS[u.key].size * 0.42);
    if (path.length) return { point: candidate, path };
  }
  return null;
}

export function assignGuardPost(
  s,
  u,
  p,
  snapToCover = false,
  { preserveDefense = false, candidateCache = null } = {},
) {
  if (!pointValid(s, u, p)) return false;
  const placement = snapToCover
    ? coveredPost(s, u, p, candidateCache)
    : {
        point: p,
        path: groundPath(s, u, p, GROUND_UNITS[u.key].size * 0.42),
      };
  if (!placement || (!placement.path.length && distance(u, placement.point) > 3)) return false;
  if (placement.path.length && distance(placement.path.at(-1), placement.point) > 3) return false;
  const post = { x: placement.point.x, z: placement.point.z };
  delete u.supplyTrip;
  clearGroundRoute(u);
  cancelTransportDelivery(u);
  if (!preserveDefense) clearAutoDefense(u);
  u.guard = post;
  if (['medic', 'supply'].includes(GROUND_UNITS[u.key]?.support)) u.supportManual = true;
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
  const candidateCache = new Map();
  for (const u of units) if (assignGuardPost(s, u, point, true, { candidateCache })) assigned++;
  if (assigned) invalidateFrontline(s);
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
    if (assignGuardPost(s, units[i], { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t }))
      assigned++;
  }
  if (assigned) invalidateFrontline(s);
  return assigned || 'Линия не проходит по доступной суше';
}

function threats(s, u) {
  // Rank cheap geometric candidates before the expensive visibility/terrain rays.
  // A guard needs the nearest visible threat, not a line-of-sight result for
  // every soldier in the opposing platoon each time its think clock fires.
  let alliedPosts;
  const candidates = [];
  for (const enemy of s.groundUnits) {
    if (!hostile(s, enemy.side, u.side) || enemy.hp <= 0 || enemy.carrierId) continue;
    const range = distance(enemy, u.guard);
    if (range > MAX_LEASH) continue;
    if (range > GUARD_RADIUS) {
      alliedPosts ||= s.groundUnits.filter(
        (v) =>
          v.id !== u.id &&
          v.side === u.side &&
          v.hp > 0 &&
          v.guard &&
          distance(v.guard, u.guard) <= ALLY_RADIUS,
      );
      if (!alliedPosts.some((ally) => distance(enemy, ally.guard) <= ASSIST_RADIUS)) continue;
    }
    candidates.push({ enemy, range });
  }
  candidates.sort((a, b) => a.range - b.range || a.enemy.id - b.enemy.id);
  for (const { enemy } of candidates)
    if (groundVisible(s, u.side, enemy) && lineOfSight(s, u, enemy)) return enemy;
  return null;
}

export function updateGuard(s, u) {
  if (u.supplyTrip) return;
  if (!u.guard || !GROUND_UNITS[u.key] || u.carrierId || u.boardingId) return;
  if ((u.guardNextThink || 0) > s.time) return;
  u.guardNextThink = s.time + 0.4;
  const d = GROUND_UNITS[u.key];
  const target = u.holdFire ? null : threats(s, u);
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
      if (pointValid(s, u, toward) && (isInfantry(u.key) || distance(toward, u.guard) <= 40)) {
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
