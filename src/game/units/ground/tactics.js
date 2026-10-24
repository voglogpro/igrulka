import { GROUND_UNITS, BUILDINGS, isInfantry } from '../../config.js';
import { COVER_PATCHES, coverInfo } from '../infantry/cover.js';
import { groundPath, walkable } from './navigation.js';
import { orderGround } from './orders.js';

// Autonomous reactions to incoming fire. Player orders always win: only idle units and units
// advancing with attack-move react, and attack-move resumes once the unit has recovered.
export const COVER_SEEK_RADIUS = 42;
export const COVER_SEEK_SUPPRESSION = 0.42;
export const THREAT_MEMORY = 4;
const COVER_RETRY = 3.5;
const RECOVERED_SUPPRESSION = 0.18;
const MIN_COVER_STAY = 2.5;
const GAIN_THRESHOLD = 0.14;

const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

export function recordThreat(s, u, from) {
  if (!from || !Number.isFinite(from.x) || !Number.isFinite(from.z)) return;
  u.threatX = from.x;
  u.threatZ = from.z;
  u.threatAt = s.time;
}

function reactive(u) {
  if (u.carrierId || u.boardingId || u.guard || u.delivery || u.routeState || u.digging)
    return false;
  if (u.holdFire || u.camouflaged) return false;
  if (!u.order) return !u.path?.length;
  return ['attackmove', 'cover'].includes(u.order.mode);
}

function crowd(s, u, p) {
  let near = 0;
  for (const v of s.groundUnits)
    if (v.id !== u.id && v.side === u.side && v.hp > 0 && !v.carrierId) {
      const goal = v.order?.mode === 'cover' && v.path?.length ? v.order : v;
      if (distance(goal, p) < 5) near++;
    }
  return near;
}

function coverCandidates(s, u, threat) {
  const out = [];
  const add = (x, z) => {
    if (Math.hypot(x - u.x, z - u.z) <= COVER_SEEK_RADIUS) out.push({ x, z });
  };
  for (const p of COVER_PATCHES) {
    const d = distance(u, p);
    if (d - p.r > COVER_SEEK_RADIUS) continue;
    const k = d > 0 ? Math.max(0, p.r - 5) / d : 0;
    add(p.x + (u.x - p.x) * k, p.z + (u.z - p.z) * k);
  }
  for (const t of s.trenches || []) if (t.progress >= 1 && t.side === u.side) add(t.x, t.z);
  for (const b of s.buildings) {
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
          cover * 100 - distance(u, p) * 0.7 - crowd(s, u, p) * 22 - Math.max(0, advance) * 0.8,
      };
    })
    .filter((p) => p.cover >= here + GAIN_THRESHOLD)
    .sort((a, b) => b.score - a.score || a.x - b.x || a.z - b.z);
  for (const p of ranked.slice(0, 3)) {
    const path = groundPath(s, u, p, radius);
    if (path.length) return { point: p, path };
  }
  return null;
}

function fallBack(s, u, threat) {
  const radius = GROUND_UNITS[u.key].size * 0.42;
  const d = distance(u, threat) || 1;
  for (const turn of [0, 0.6, -0.6]) {
    const dx = ((u.x - threat.x) / d) * Math.cos(turn) - ((u.z - threat.z) / d) * Math.sin(turn),
      dz = ((u.x - threat.x) / d) * Math.sin(turn) + ((u.z - threat.z) / d) * Math.cos(turn),
      p = { x: u.x + dx * 34, z: u.z + dz * 34 };
    if (!walkable(s, p.x, p.z, radius)) continue;
    const path = groundPath(s, u, p, radius);
    if (path.length) return { point: p, path };
  }
  return null;
}

function leaveCover(s, u) {
  const goal = u.coverResume;
  u.coverResume = null;
  u.coverSince = null;
  u.order = null;
  u.path = [];
  if (goal) orderGround(s, u.side, [u.id], { ...goal, mode: 'attackmove' });
}

export function updateGroundTactics(s, u, target) {
  const d = GROUND_UNITS[u.key];
  if (!d || u.hp <= 0) return;
  if (u.order?.mode === 'cover') {
    if (u.path?.length) return;
    u.coverSince ??= s.time;
    if (
      (u.suppression || 0) < RECOVERED_SUPPRESSION &&
      s.time - u.coverSince > MIN_COVER_STAY &&
      s.time - (u.threatAt ?? -Infinity) > 1.5
    )
      return leaveCover(s, u);
  }
  if ((u.coverCheckAt || 0) > s.time || !reactive(u)) return;
  const recent = s.time - (u.threatAt ?? -Infinity) < THREAT_MEMORY;
  if (!recent || !Number.isFinite(u.threatX)) return;
  const threat = { x: u.threatX, z: u.threatZ };
  let move;
  if (isInfantry(u.key)) {
    if ((u.suppression || 0) < COVER_SEEK_SUPPRESSION && u.hp / u.maxHp > 0.35) return;
    u.coverCheckAt = s.time + COVER_RETRY;
    if (coverInfo(s, u, threat).cover >= 0.5) return;
    move = findCover(s, u, threat);
  } else {
    // Vehicles hit by something they cannot answer reverse out of the firing line.
    u.coverCheckAt = s.time + COVER_RETRY;
    if (target || u.hp / u.maxHp > 0.6) return;
    move = fallBack(s, u, threat);
  }
  if (!move) return;
  if (u.order?.mode === 'attackmove')
    u.coverResume = { x: u.order.x, z: u.order.z, targetId: u.order.targetId ?? null };
  else if (u.order?.mode !== 'cover') u.coverResume = null;
  u.path = move.path;
  u.order = { x: move.point.x, z: move.point.z, mode: 'cover', targetId: null };
  u.coverSince = null;
}
