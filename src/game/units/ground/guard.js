import { hostile } from '../../factions.js';
import { FIELD, GROUND_UNITS, isInfantry } from '../../config.js';
import { groundPath, walkable } from './navigation.js';
import { coverInfo, groundVisible, lineOfSight } from '../infantry/cover.js';
import { cancelTransportDelivery } from '../vehicles/transport.js';
import { clearGroundRoute } from './route-queue.js';
import { clearAutoDefense } from '../../defense/volunteers.js';
import { invalidateFrontline } from '../../defense/cache.js';
import { ENGAGEMENT_CELL, prepareGroundEngagement } from './engagement.js';
import { CandidateBuffer } from './candidate-buffer.js';

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
export const GUARD_PATHS_PER_STEP = 2;
const POST_CELL = 32;
// The shared combat index is built before movement. A full .1 s step, including
// retreat speed, moves the fastest unit less than 5 m across its original cell.
const MOVEMENT_MARGIN = 8;
const guardFrames = new WeakMap();

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const pointValid = (s, u, p) =>
  p &&
  Number.isFinite(p.x) &&
  Number.isFinite(p.z) &&
  Math.abs(p.x) <= FIELD.x &&
  Math.abs(p.z) <= FIELD.z &&
  walkable(s, p.x, p.z, GROUND_UNITS[u.key].size * 0.42);

function frame(s) {
  let value = guardFrames.get(s);
  if (
    value?.time === s.time &&
    !value.invalidated &&
    value.units === s.groundUnits &&
    value.count === s.groundUnits.length &&
    value.revision === s.networkRevision
  )
    return value;
  const previous = value?.time === s.time ? value : null,
    engagement = prepareGroundEngagement(s),
    pending = new Map(),
    sides = new Set();
  value = {
    time: s.time,
    units: s.groundUnits,
    count: s.groundUnits.length,
    revision: s.networkRevision,
    engagement,
    candidates: value?.candidates || new CandidateBuffer(),
    extras: new Map(),
    posts: null,
    selected: new Set(),
    sides: [],
    metrics: previous?.metrics || {
      indexed: 0,
      enemyChecks: 0,
      postChecks: 0,
      visibilityTests: 0,
      lineTests: 0,
      paths: 0,
      bySide: {},
    },
  };
  for (const u of s.groundUnits) {
    value.metrics.indexed++;
    if (u.hp <= 0) continue;
    // Normal live units already belong to the shared index. Preserve the old
    // guard rules for a rare unfinished record without treating buildings as troops.
    if (!u.carrierId && !engagement.ids.has(u.id)) {
      const key = `${u.side}:${Math.floor(u.x / ENGAGEMENT_CELL)},${Math.floor(u.z / ENGAGEMENT_CELL)}`;
      if (!value.extras.has(key)) value.extras.set(key, []);
      value.extras.get(key).push(u);
    }
    if (!u.guard || !GROUND_UNITS[u.key] || u.carrierId || u.boardingId || u.supplyTrip) continue;
    if (u.order?.mode === 'cover') continue;
    sides.add(u.side);
    if ((u.guardNextThink || 0) > s.time || (u.guardRepathAt || 0) > s.time) continue;
    const d = GROUND_UNITS[u.key],
      target = !u.holdFire && engagement.ids.get(u.guardTargetId),
      firingDistance = (d.groundRange || 0) * 0.78,
      intercept =
        target?.hp > 0 &&
        !target.carrierId &&
        hostile(s, target.side, u.side) &&
        firingDistance > 0;
    let needsPath;
    if (intercept) {
      const length = distance(u, target),
        toward = {
          x: target.x + (u.x - target.x) * (firingDistance / (length || 1)),
          z: target.z + (u.z - target.z) * (firingDistance / (length || 1)),
        };
      needsPath =
        length > firingDistance &&
        pointValid(s, u, toward) &&
        (isInfantry(u.key) || distance(toward, u.guard) <= 40);
    } else
      needsPath =
        distance(u, u.guard) > 3 &&
        (!u.path?.length || !['guard', 'guardReturn'].includes(u.order?.mode));
    if (!needsPath) continue;
    if (!pending.has(u.side)) pending.set(u.side, []);
    pending.get(u.side).push(u);
  }
  value.sides = [...sides].sort((a, b) => a - b);
  for (const queue of pending.values())
    queue.sort((a, b) => (a.guardRepathAt || 0) - (b.guardRepathAt || 0) || a.id - b.id);
  const positions = new Map(),
    start = Math.round(s.time * 20) % s.sides.length;
  while (value.selected.size < GUARD_PATHS_PER_STEP) {
    let progress = false;
    for (let i = 0; i < s.sides.length && value.selected.size < GUARD_PATHS_PER_STEP; i++) {
      const side = (start + i) % s.sides.length,
        index = positions.get(side) || 0,
        u = pending.get(side)?.[index];
      if (!u) continue;
      value.selected.add(u);
      positions.set(side, index + 1);
      progress = true;
    }
    if (!progress) break;
  }
  guardFrames.set(s, value);
  return value;
}

function guardPath(s, u, point) {
  if ((u.guardRepathAt || 0) > s.time) return null;
  const f = frame(s),
    used = f.metrics.bySide[u.side] || 0;
  if (
    f.metrics.paths >= GUARD_PATHS_PER_STEP ||
    (f.selected.size ? !f.selected.has(u) : f.sides.length > 1 && used >= 1)
  ) {
    // Existing think/retry clocks are a persistent pending request. Budget denial
    // retries next simulation step, while a failed real search gets normal backoff.
    u.guardNextThink = Math.min(u.guardNextThink, s.time + 0.05);
    return null;
  }
  f.metrics.paths++;
  f.metrics.bySide[u.side] = used + 1;
  u.guardRepathAt = s.time + TARGET_REPATH;
  return groundPath(s, u, point, GROUND_UNITS[u.key].size * 0.42);
}

function assists(s, f, u, enemy) {
  if (!f.posts) {
    f.posts = new Map();
    for (const v of s.groundUnits) {
      if (v.hp <= 0 || !v.guard) continue;
      const key = `${v.side}:${Math.floor(v.guard.x / POST_CELL)},${Math.floor(v.guard.z / POST_CELL)}`;
      if (!f.posts.has(key)) f.posts.set(key, []);
      f.posts.get(key).push(v);
    }
  }
  // Assistance uses the assigned post, even if that ally is currently intercepting
  // far away. Only the same city lends its guards; co-op ownership stays separate.
  const minX = Math.max(u.guard.x - ALLY_RADIUS, enemy.x - ASSIST_RADIUS),
    maxX = Math.min(u.guard.x + ALLY_RADIUS, enemy.x + ASSIST_RADIUS),
    minZ = Math.max(u.guard.z - ALLY_RADIUS, enemy.z - ASSIST_RADIUS),
    maxZ = Math.min(u.guard.z + ALLY_RADIUS, enemy.z + ASSIST_RADIUS);
  for (let z = Math.floor(minZ / POST_CELL); z <= Math.floor(maxZ / POST_CELL); z++)
    for (let x = Math.floor(minX / POST_CELL); x <= Math.floor(maxX / POST_CELL); x++)
      for (const v of f.posts.get(`${u.side}:${x},${z}`) || []) {
        f.metrics.postChecks++;
        if (
          v.id !== u.id &&
          v.hp > 0 &&
          v.guard &&
          distance(v.guard, u.guard) <= ALLY_RADIUS &&
          distance(enemy, v.guard) <= ASSIST_RADIUS
        )
          return true;
      }
  return false;
}

export function guardMetrics(s) {
  const f = guardFrames.get(s);
  return f?.time === s.time
    ? { ...f.metrics, bySide: { ...f.metrics.bySide }, limit: GUARD_PATHS_PER_STEP }
    : null;
}

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
  if (!preserveDefense) {
    clearAutoDefense(u);
    delete u.defenseAttack;
  }
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
  const cached = guardFrames.get(s);
  if (cached) cached.invalidated = true;
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
  const f = frame(s),
    cache = f.engagement,
    candidates = f.candidates;
  candidates.reset();
  const offer = (enemy) => {
    f.metrics.enemyChecks++;
    if (!GROUND_UNITS[enemy.key]) return;
    if (!hostile(s, enemy.side, u.side) || enemy.hp <= 0 || enemy.carrierId) return;
    const range = distance(enemy, u.guard);
    if (range > MAX_LEASH || (range > GUARD_RADIUS && !assists(s, f, u, enemy))) return;
    candidates.add(enemy, range);
  };
  for (
    let z = Math.floor((u.guard.z - MAX_LEASH - MOVEMENT_MARGIN) / ENGAGEMENT_CELL);
    z <= Math.floor((u.guard.z + MAX_LEASH + MOVEMENT_MARGIN) / ENGAGEMENT_CELL);
    z++
  )
    for (
      let x = Math.floor((u.guard.x - MAX_LEASH - MOVEMENT_MARGIN) / ENGAGEMENT_CELL);
      x <= Math.floor((u.guard.x + MAX_LEASH + MOVEMENT_MARGIN) / ENGAGEMENT_CELL);
      x++
    )
      for (const side of cache.enemies[u.side] || []) {
        for (const enemy of cache.sideBuckets[side].get(`${x},${z}`) || []) offer(enemy);
        for (const enemy of f.extras.get(`${side}:${x},${z}`) || []) offer(enemy);
      }
  candidates.heapify();
  while (candidates.order.length) {
    const enemy = candidates.pop();
    f.metrics.visibilityTests++;
    if (!groundVisible(s, u.side, enemy)) continue;
    f.metrics.lineTests++;
    if (lineOfSight(s, u, enemy)) return enemy;
  }
  return null;
}

export function updateGuard(s, u) {
  if (u.supplyTrip || u.order?.mode === 'cover') return;
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
        const path = guardPath(s, u, toward);
        if (path?.length) {
          u.path = path;
          u.order = { ...toward, mode: 'guardIntercept', targetId: target.id };
        }
      }
    } else if (distance(u, target) <= firingDistance && u.order?.mode === 'guardIntercept') {
      u.path = [];
    }
    return;
  }
  u.guardTargetId = null;
  if (u.order?.mode === 'guardIntercept') {
    // Losing the threat (including a hold-fire order) ends the intercept now.
    // Its old chase cooldown must not keep walking away from the guard post or
    // delay the independently budgeted return request.
    u.path = [];
    u.order = { ...u.guard, mode: 'guardReturn' };
    u.guardRepathAt = 0;
  }
  if (distance(u, u.guard) <= 3) {
    u.path = [];
    u.order = { ...u.guard, mode: 'guard' };
    return;
  }
  if (!u.path?.length || !['guard', 'guardReturn'].includes(u.order?.mode)) {
    const path = guardPath(s, u, u.guard);
    if (path?.length) {
      u.path = path;
      u.order = { ...u.guard, mode: 'guard' };
    }
  }
}
