import { isInfantry, GROUND_UNITS } from '../config.js';
import { event } from '../shared/events.js';
import { FORTIFICATION as C } from './config.js';
import { invalidateFrontline } from './cache.js';
import {
  staticObjectsInBounds,
  staticGeometryRevision,
  invalidateStaticGeometry,
} from '../shared/static-spatial.js';
import { allied } from '../factions.js';
import { trenchContested } from './positions.js';
import { invalidateTrenchLinks } from './trench-links.js';
import { TRENCH_FOOTPRINT, trenchContains } from './trench-footprint.js';
const workTimes = new WeakMap();
const nearbyGeometry = new WeakMap();
const labels = ['Земляные работы', 'Окоп', 'Укреплённый окоп', 'Блокпост', 'Опорный пункт', 'Форт'];
export const FORTIFICATION_TOP = labels.length - 1;

export function fortificationStatus(t) {
  const progress = Math.max(0, Math.min(1, t?.progress || 0));
  const work = Math.max(0, Math.min(C.maxWork, t?.fortificationWork || 0));
  let level = 0;
  if (progress >= 1) {
    level = 1;
    while (level <= C.thresholds.length && work >= C.thresholds[level - 1]) level++;
  }
  const from = level > 1 ? C.thresholds[level - 2] : 0,
    to = C.thresholds[level - 1];
  const nextProgress = level === 0 ? progress : to == null ? 1 : (work - from) / (to - from);
  return {
    level,
    progress,
    nextProgress,
    cover: C.cover[level],
    label: labels[level],
  };
}

// Earthworks change hands intact: their dug progress and fortification work stay with them.
export function captureTrench(s, t, u) {
  t.side = u.side;
  invalidateFrontline(s);
  invalidateTrenchLinks(s);
  event(s, 'trenchCaptured', { x: t.x, z: t.z, side: u.side, unitId: u.id, trenchId: t.id });
}

export function defensivePositionReady(u) {
  return (
    !!u.guard &&
    u.hp > 0 &&
    isInfantry(u.key) &&
    !GROUND_UNITS[u.key]?.support &&
    !u.carrierId &&
    !u.boardingId &&
    !u.downed &&
    !u.path?.length &&
    !u.moving &&
    u.enemyId == null &&
    u.guardTargetId == null &&
    (u.suppression || 0) <= C.suppressionLimit &&
    Math.hypot(u.x - u.guard.x, u.z - u.guard.z) <= C.postRadius
  );
}

export function prepareDefensivePosition(s, u) {
  if (!defensivePositionReady(u)) {
    // An automatic work detail must be able to fight when threatened. Explicit dig retains its rules.
    if (u.guard && u.digging) u.digging = false;
    return null;
  }
  const revision = staticGeometryRevision(s, 'trenches');
  const radius = TRENCH_FOOTPRINT.queryRadius + C.postRadius;
  let cached = nearbyGeometry.get(u);
  if (
    !cached ||
    cached.state !== s ||
    cached.x !== u.x ||
    cached.z !== u.z ||
    cached.network !== s.networkRevision ||
    cached.revision !== revision ||
    cached.objects !== s.trenches ||
    cached.count !== s.trenches.length
  ) {
    cached = {
      state: s,
      x: u.x,
      z: u.z,
      network: s.networkRevision,
      revision,
      objects: s.trenches,
      count: s.trenches.length,
      nearby: staticObjectsInBounds(
        s,
        'trenches',
        u.x - radius,
        u.z - radius,
        u.x + radius,
        u.z + radius,
      ),
    };
    nearbyGeometry.set(u, cached);
  }
  const nearby = cached.nearby.filter((t) => trenchContains(t, u.x, u.z, C.postRadius));
  let t =
    nearby.find((t) => t.side === u.side) ||
    nearby.find((t) => !trenchContested(s, t, u.side, u.id));
  if (t && !allied(s, t.side, u.side)) captureTrench(s, t, u);
  // An occupied enemy trench is physical earthwork too. Do not place a fresh
  // duplicate on top of it while its owner is still contesting the position.
  if (!t && nearby.length) return null;
  if (!t && s.trenches.length < C.maxPositions) {
    t = { id: s.nextId++, side: u.side, x: u.x, z: u.z, progress: 0, yaw: u.yaw || 0 };
    s.trenches.push(t);
    invalidateStaticGeometry(s, 'trenches');
  }
  if (t) {
    u.trenchId = t.id;
    if (t.progress < 1) u.digging = true;
  }
  return t;
}

export function updateFortification(s, u, dt) {
  if (s.result || !(dt > 0) || !Number.isFinite(dt)) return;
  const position = prepareDefensivePosition(s, u);
  const t = position || (u.digging && s.trenches.find((t) => t.id === u.trenchId));
  if (!t) {
    if (u.digging) u.digging = false;
    return;
  }
  if (!u.digging && t.progress >= 1 && (t.fortificationWork || 0) >= C.maxWork) return;
  const speed = u.key === 'engineer' ? C.engineerSpeed : 1;
  const before = fortificationStatus(t).level;
  if (u.digging && isInfantry(u.key) && !u.moving) {
    t.progress = Math.min(1, t.progress + (dt * speed) / C.baseSeconds);
    if (t.progress >= 1) u.digging = false;
  } else if (position && t.progress >= 1 && (t.fortificationWork || 0) < C.maxWork) {
    // Only one stationary builder advances a shared position per tick.
    let worked = workTimes.get(s);
    if (!worked) {
      worked = new Map();
      workTimes.set(s, worked);
    }
    if (worked.get(t.id) !== s.time) {
      worked.set(t.id, s.time);
      const f = s.sides[u.side];
      const heavy = (t.fortificationWork || 0) >= C.heavyFrom,
        credits = heavy ? C.heavyCreditsPerWork : C.creditsPerWork,
        materials = heavy ? C.heavyMaterialsPerWork : C.materialsPerWork,
        // One price per tick: a step never straddles the timber threshold.
        cap = heavy ? C.maxWork : C.heavyFrom;
      const work = Math.min(
        cap - (t.fortificationWork || 0),
        dt * speed,
        f.credits / credits,
        f.materials / materials,
      );
      if (work > 0) {
        t.fortificationWork = Math.min(cap, (t.fortificationWork || 0) + work);
        if (cap - t.fortificationWork < 1e-8) t.fortificationWork = cap;
        f.credits = Math.max(0, f.credits - work * credits);
        f.materials = Math.max(0, f.materials - work * materials);
      }
    }
  }
  const after = fortificationStatus(t).level;
  if (after > before) {
    invalidateFrontline(s);
    invalidateTrenchLinks(s);
    event(s, 'fortification', {
      x: t.x,
      z: t.z,
      side: t.side,
      unitId: u.id,
      trenchId: t.id,
      level: after,
    });
  }
}
