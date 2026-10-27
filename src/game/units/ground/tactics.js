import { GROUND_UNITS, BUILDINGS, isInfantry } from '../../config.js';
import { COVER_PATCHES, coverInfo } from '../infantry/cover.js';
import { walkable } from './navigation.js';
import { allied } from '../../factions.js';
import { staticObjectsInBounds } from '../../shared/static-spatial.js';
import {
  tacticalPath,
  tacticalPathAvailable,
  tacticalTransportBusy,
  tacticalCrowd,
  canTacticalDisengage,
  noteTacticalDisengage,
  TACTICAL_RECOVERY_STAY,
  TACTICAL_RECOVERED_SUPPRESSION,
} from './tactical-budget.js';

// Short combat reactions borrow the current order; strategic posts, missions
// and supply ownership stay intact. Explicit player movement/guards take priority.
export const COVER_SEEK_RADIUS = 42;
export const COVER_SEEK_SUPPRESSION = 0.42;
export const THREAT_MEMORY = 4;
const COVER_RETRY = 3.5;
const RECOVERED_SUPPRESSION = TACTICAL_RECOVERED_SUPPRESSION;
const MIN_COVER_STAY = TACTICAL_RECOVERY_STAY;
const GAIN_THRESHOLD = 0.14;
const BUILDING_REACH = Math.max(...Object.values(BUILDINGS).map((d) => (d.size || 30) * 0.56));

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function recordThreat(s, u, from) {
  if (!from || !Number.isFinite(from.x) || !Number.isFinite(from.z)) return;
  u.threatX = from.x;
  u.threatZ = from.z;
  u.threatAt = s.time;
}

function reactive(u) {
  if (
    u.carrierId ||
    u.boardingId ||
    u.delivery ||
    u.supplyTrip ||
    u.routeQueue?.length ||
    (u.routeState && u.stance?.mode !== 'attack') ||
    (u.guard && !u.autoDefense) ||
    (u.digging && !(u.autoDefense && u.guard)) ||
    GROUND_UNITS[u.key]?.support ||
    u.civil
  )
    return false;
  if (u.holdFire || u.camouflaged) return false;
  if (!u.order) return !u.path?.length;
  return (
    ['attackmove', 'cover'].includes(u.order.mode) ||
    (u.autoDefense &&
      u.guard &&
      ['guard', 'guardReturn', 'guardIntercept', 'wait'].includes(u.order.mode))
  );
}

function coverCandidates(s, u, threat) {
  const out = [];
  const add = (x, z) => {
    if (
      Math.hypot(x - u.x, z - u.z) <= COVER_SEEK_RADIUS &&
      (!u.guard || Math.hypot(x - u.guard.x, z - u.guard.z) <= 70)
    )
      out.push({ x, z });
  };
  for (const p of COVER_PATCHES) {
    const d = distance(u, p);
    if (d - p.r > COVER_SEEK_RADIUS) continue;
    const k = d > 0 ? Math.max(0, p.r - 5) / d : 0;
    const x = p.x + (u.x - p.x) * k,
      z = p.z + (u.z - p.z) * k;
    add(x, z);
    const offset = Math.min(12, p.r * 0.3);
    const nx = -(u.z - p.z) / (d || 1),
      nz = (u.x - p.x) / (d || 1);
    add(x + nx * offset, z + nz * offset);
    add(x - nx * offset, z - nz * offset);
  }
  for (const t of staticObjectsInBounds(
    s,
    'trenches',
    u.x - COVER_SEEK_RADIUS,
    u.z - COVER_SEEK_RADIUS,
    u.x + COVER_SEEK_RADIUS,
    u.z + COVER_SEEK_RADIUS,
  ))
    if (t.progress >= 1 && allied(s, t.side, u.side)) add(t.x, t.z);
  const reach = COVER_SEEK_RADIUS + BUILDING_REACH;
  for (const b of staticObjectsInBounds(
    s,
    'buildings',
    u.x - reach,
    u.z - reach,
    u.x + reach,
    u.z + reach,
  )) {
    if (b.demolished) continue;
    const half = (BUILDINGS[b.key]?.size || 30) * 0.56;
    if (distance(u, b) - half > COVER_SEEK_RADIUS) continue;
    if (b.hp <= 0) {
      add(
        b.x + Math.sign(u.x - b.x || 1) * half * 0.6,
        b.z + Math.sign(u.z - b.z || 1) * half * 0.6,
      );
      continue;
    }
    if (b.progress < 1 || (BUILDINGS[b.key]?.height || 15) <= 4) continue;
    // Stand behind the wall that faces away from the shooter.
    const tx = b.x - threat.x,
      tz = b.z - threat.z;
    if (Math.abs(tx) > Math.abs(tz)) add(b.x + Math.sign(tx) * (half + 4), b.z);
    else add(b.x, b.z + Math.sign(tz) * (half + 4));
  }
  return out;
}

function findCover(s, u, threat) {
  const radius = GROUND_UNITS[u.key].size * 0.42;
  const here = coverInfo(s, u, threat).cover;
  const toThreat = distance(u, threat);
  const ranked = coverCandidates(s, u, threat)
    .filter((p) => walkable(s, p.x, p.z, radius))
    .map((p) => {
      const cover = coverInfo(s, { key: u.key, x: p.x, z: p.z }, threat).cover;
      const advance = toThreat - distance(p, threat);
      return {
        ...p,
        cover,
        score:
          cover * 100 -
          distance(u, p) * 0.7 -
          tacticalCrowd(s, u, p) * 22 -
          Math.max(0, advance) * 0.8,
      };
    })
    .filter((p) => p.cover >= here + GAIN_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z);
  for (const p of ranked.slice(0, 3)) {
    const path = tacticalPath(s, u, p);
    if (path === null) break;
    if (path.length) return { point: p, path };
  }
  return null;
}

function fallBack(s, u, threat) {
  const radius = GROUND_UNITS[u.key].size * 0.42;
  const d = distance(u, threat),
    nx = d > 1e-8 ? (u.x - threat.x) / d : u.side % 2 ? 1 : -1,
    nz = d > 1e-8 ? (u.z - threat.z) / d : 0;
  for (const turn of [0, 0.6, -0.6]) {
    const dx = nx * Math.cos(turn) - nz * Math.sin(turn),
      dz = nx * Math.sin(turn) + nz * Math.cos(turn),
      step = Math.min(60, Math.max(24, (GROUND_UNITS[u.key].groundMinRange || 0) + 12 - d)),
      p = { x: u.x + dx * step, z: u.z + dz * step };
    const leash = isInfantry(u.key)
      ? 70
      : Math.max(70, (GROUND_UNITS[u.key].groundMinRange || 0) + 40);
    if (u.guard && distance(p, u.guard) > leash) continue;
    if (!walkable(s, p.x, p.z, radius)) continue;
    if (tacticalCrowd(s, u, p) > 0) continue;
    const path = tacticalPath(s, u, p);
    if (path === null) break;
    if (path.length) return { point: p, path };
  }
  return null;
}

function leaveCover(s, u) {
  const goal = u.guard || u.coverResume;
  let path = [];
  if (goal && distance(u, goal) > 3) {
    if ((u.coverCheckAt || 0) > s.time) return;
    path = tacticalPath(s, u, goal, true);
    if (path === null) return;
    if (!path.length || distance(path.at(-1), goal) > 4) {
      u.coverCheckAt = s.time + 1;
      if (s.time - u.coverSince < 18) return;
      path = [];
    }
  }
  u.coverResume = null;
  u.coverSince = null;
  u.order = goal
    ? {
        x: goal.x,
        z: goal.z,
        targetId: goal.targetId ?? null,
        mode: u.guard ? 'guardReturn' : 'attackmove',
      }
    : null;
  u.path = path;
  u.navRevision = s.networkRevision;
}

export function updateGroundTactics(s, u, target) {
  const d = GROUND_UNITS[u.key];
  if (!d || !d.speed || u.hp <= 0 || s.result || s.paused) return;
  if (u.order?.mode !== 'cover' && (u.coverResume != null || u.coverSince != null)) {
    u.coverResume = null;
    u.coverSince = null;
  }
  if (u.order?.mode === 'cover') {
    if (u.path?.length) return;
    u.coverSince ??= s.time;
    const goal = u.guard || u.coverResume;
    const unsafeStandoff =
      !isInfantry(u.key) &&
      d.groundMinRange > 0 &&
      goal &&
      ((target && distance(goal, target) < d.groundMinRange + 12) ||
        (s.time - (u.threatAt ?? -Infinity) < THREAT_MEMORY &&
          Number.isFinite(u.threatX) &&
          distance(goal, { x: u.threatX, z: u.threatZ }) < d.groundMinRange + 12));
    if (
      (u.suppression || 0) < RECOVERED_SUPPRESSION &&
      s.time - u.coverSince > MIN_COVER_STAY &&
      !(u.groundReload > 0) &&
      !(u.reloadLeft > 0) &&
      !unsafeStandoff &&
      (s.time - (u.threatAt ?? -Infinity) > 1.5 || (u.autoDefense && u.guard))
    )
      return leaveCover(s, u);
  }
  if ((u.coverCheckAt || 0) > s.time || !reactive(u)) return;
  const recent = s.time - (u.threatAt ?? -Infinity) < THREAT_MEMORY;
  const reloading =
    u.groundReload > 0 ||
    (d.groundRange && u.groundAmmo === 0 && u.ammoReserve > 0) ||
    u.reloadLeft > 0;
  if (!recent && !(reloading && target)) return;
  if (!recent && target) recordThreat(s, u, target);
  if (!Number.isFinite(u.threatX) || !Number.isFinite(u.threatZ)) return;
  if (tacticalTransportBusy(s, u)) return;
  const threat = { x: u.threatX, z: u.threatZ };
  if (!tacticalPathAvailable(s, u)) return;
  if (u.order?.mode !== 'cover' && !canTacticalDisengage(s, u)) {
    u.coverCheckAt = s.time + 0.25 + (u.id % 5) * 0.03;
    return;
  }
  let move;
  if (isInfantry(u.key)) {
    if ((u.suppression || 0) < COVER_SEEK_SUPPRESSION && u.hp / u.maxHp > 0.35 && !reloading)
      return;
    u.coverCheckAt = s.time + COVER_RETRY + (u.id % 7) * 0.08;
    if (coverInfo(s, u, threat).cover >= 0.5) return;
    move = findCover(s, u, threat);
    if (!move && ((u.suppression || 0) >= 0.75 || u.hp / u.maxHp <= 0.35 || reloading))
      move = fallBack(s, u, threat);
  } else {
    // Vehicles hit by something they cannot answer reverse out of the firing line.
    u.coverCheckAt = s.time + COVER_RETRY + (u.id % 7) * 0.08;
    const minimum = d.groundMinRange || Math.max(22, d.size * 3);
    const tooClose = distance(u, threat) < minimum + (d.groundMinRange ? 24 : 0);
    if (
      !(tooClose && (d.groundMinRange || reloading || u.hp / u.maxHp < 0.65)) &&
      !(u.hp / u.maxHp < 0.35 || (!target && u.hp / u.maxHp <= 0.6))
    )
      return;
    move = fallBack(s, u, threat);
  }
  if (!move) return;
  const wasCovering = u.order?.mode === 'cover';
  if (!wasCovering) {
    const resume = u.guard || (u.order?.mode === 'attackmove' ? u.order : null);
    u.coverResume = resume ? { x: resume.x, z: resume.z, targetId: resume.targetId ?? null } : null;
  }
  noteTacticalDisengage(s, u, move.point, !wasCovering);
  u.path = move.path;
  u.order = { x: move.point.x, z: move.point.z, mode: 'cover', targetId: null };
  u.coverSince = null;
  u.digging = false;
  u.navRevision = s.networkRevision;
}
