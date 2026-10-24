import { isInfantry, GROUND_UNITS } from '../config.js';
import { event } from '../shared/events.js';
import { FORTIFICATION as C } from './config.js';
import { invalidateFrontline } from './cache.js';
const workTimes = new WeakMap();

export function fortificationStatus(t) {
  const progress = Math.max(0, Math.min(1, t?.progress || 0));
  const work = Math.max(0, Math.min(C.maxWork, t?.fortificationWork || 0));
  const level = progress < 1 ? 0 : work >= C.maxWork ? 3 : work >= C.secondLevel ? 2 : 1;
  const nextProgress =
    level === 0
      ? progress
      : level === 1
        ? work / C.secondLevel
        : level === 2
          ? (work - C.secondLevel) / (C.maxWork - C.secondLevel)
          : 1;
  return {
    level,
    progress,
    nextProgress,
    cover: C.cover[level],
    label: ['Земляные работы', 'Окоп', 'Укреплённый окоп', 'Блокпост'][level],
  };
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
  let t = s.trenches.find(
    (t) => t.side === u.side && Math.hypot(t.x - u.x, t.z - u.z) < C.postRadius,
  );
  if (!t && s.trenches.length < C.maxPositions) {
    t = { id: s.nextId++, side: u.side, x: u.x, z: u.z, progress: 0, yaw: u.yaw || 0 };
    s.trenches.push(t);
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
      const work = Math.min(
        C.maxWork - (t.fortificationWork || 0),
        dt * speed,
        f.credits / C.creditsPerWork,
        f.materials / C.materialsPerWork,
      );
      if (work > 0) {
        t.fortificationWork = Math.min(C.maxWork, (t.fortificationWork || 0) + work);
        if (C.maxWork - t.fortificationWork < 1e-8) t.fortificationWork = C.maxWork;
        f.credits = Math.max(0, f.credits - work * C.creditsPerWork);
        f.materials = Math.max(0, f.materials - work * C.materialsPerWork);
      }
    }
  }
  const after = fortificationStatus(t).level;
  if (after > before) {
    invalidateFrontline(s);
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
