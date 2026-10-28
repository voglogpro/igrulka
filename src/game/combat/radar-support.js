import { radarSources } from '../vision-grid.js';
import { hostile, hqOf, validSide } from '../factions.js';

// A radar shares a local fire-control solution, not visibility or enemy orders.
export function radarFireSupport(s, side, x, z, sources = radarSources(s, side)) {
  let best = null;
  for (const source of sources) {
    if (source.kind !== 'radar' || Math.hypot(x - source.x, z - source.z) > (source.control || 600))
      continue;
    if (!best || (source.level || 0) > (best.level || 0)) best = source;
  }
  return best
    ? {
        active: true,
        sourceId: best.id,
        rangeMultiplier: 1.3 + (best.level || 0) * 0.04,
        spreadMultiplier: 0.65 - (best.level || 0) * 0.05,
      }
    : { active: false, sourceId: null, rangeMultiplier: 1, spreadMultiplier: 1 };
}
export function radarAirWarning(s, side) {
  const empty = {
    active: false,
    targets: 0,
    eta: null,
    bearing: null,
    sourceId: null,
    rangeBonus: 0,
    spreadBonus: 0,
  };
  if (!validSide(s, side)) return empty;
  const sources = radarSources(s, side),
    home = hqOf(s, side);
  if (!sources.length || !home) return empty;
  let targets = 0,
    nearest = null,
    closest = Infinity,
    eta = null;
  for (const u of s.units) {
    if (u.hp <= 0 || !u.launched || u.delay > 0 || !hostile(s, side, u.side)) continue;
    const observed = sources.some((r) => Math.hypot(u.x - r.x, u.z - r.z) <= r.air);
    if (!observed) continue;
    targets++;
    const dx = u.x - home.x,
      dz = u.z - home.z,
      speed2 = (u.vx || 0) ** 2 + (u.vz || 0) ** 2,
      time = speed2 > 1 ? -(dx * (u.vx || 0) + dz * (u.vz || 0)) / speed2 : -1,
      incoming = time >= 0 && Math.hypot(dx + (u.vx || 0) * time, dz + (u.vz || 0) * time) < 500,
      score = incoming ? time : 1e9 + Math.hypot(dx, dz);
    if (score < closest) {
      closest = score;
      nearest = u;
      eta = incoming ? Math.round(time) : null;
    }
  }
  const strongest = sources.reduce((a, b) => ((b.level || 0) > (a.level || 0) ? b : a)),
    boost = radarFireSupport(s, side, strongest.x, strongest.z, sources);
  let bearing = null;
  if (nearest) {
    const dx = nearest.x - home.x,
      dz = nearest.z - home.z;
    // Closest approach from public current velocity. No tx/tz/waypoints are read.
    const angle = Math.atan2(dx, -dz),
      names = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    bearing = names[(Math.round(angle / (Math.PI / 4)) + 8) % 8];
  }
  return {
    active: true,
    targets,
    eta,
    bearing,
    sourceId: strongest.id,
    rangeBonus: boost.rangeMultiplier - 1,
    spreadBonus: 1 - boost.spreadMultiplier,
  };
}
