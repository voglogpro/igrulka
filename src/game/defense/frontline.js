import { GROUND_UNITS, isInfantry, riverX, FIELD } from '../config.js';
import { groundVisible } from '../units/infantry/cover.js';
import { DISTRICTS } from '../territory/districts.config.js';
import { FRONTLINE as C, FRONT_SECTORS, sectorAt } from './config.js';
import { frontlineRevision } from './cache.js';

const reports = new WeakMap();
export function forgetObservedFrontlineTarget(s, id, sides) {
  for (const side of sides) {
    const memory = s.frontlineMemory?.[side];
    if (memory) memory.seen = memory.seen.filter((v) => v.id !== id);
  }
  reports.delete(s);
}
export const createFrontlineMemory = () => [0, 1].map(() => ({ nextThink: 0, seen: [] }));
export const military = (u) =>
  u.hp > 0 &&
  !u.carrierId &&
  !u.downed &&
  !!GROUND_UNITS[u.key] &&
  !GROUND_UNITS[u.key].support &&
  !u.trade;
export function defenseStrength(u) {
  const d = GROUND_UNITS[u.key];
  if (!d) return 0;
  return (
    (isInfantry(u.key)
      ? u.key === 'assault'
        ? 1.6
        : 1
      : d.indirect
        ? 1.8
        : d.groundArmor === 'heavy' || ['leopard', 'heavytank'].includes(u.key)
          ? 3
          : 2) * Math.max(0.35, Math.min(1, u.hp / u.maxHp))
  );
}

export function observedFrontline(s, side, previous = []) {
  const seen = new Map(
    previous.filter((v) => s.time - v.time <= C.memorySeconds).map((v) => [v.id, v]),
  );
  const visible = new Set();
  for (const u of s.groundUnits)
    if (u.side !== side && military(u) && groundVisible(s, side, u)) {
      seen.set(u.id, { id: u.id, x: u.x, z: u.z, strength: defenseStrength(u), time: s.time });
      visible.add(u.id);
    }
  return {
    seen: [...seen.values()].sort((a, b) => b.time - a.time || a.id - b.id).slice(0, C.maxSeen),
    visible,
  };
}

function edge(anchors, direction) {
  const front = anchors.sort((a, b) => direction * (b.x - a.x)).slice(0, 3);
  const weight = front.reduce((n, v) => n + v.weight, 0);
  return weight > 0 ? front.reduce((n, v) => n + v.x * v.weight, 0) / weight : null;
}

export function calculateFrontline(
  s,
  side,
  memory,
  visible = new Set(),
  direction = side === 0 ? 1 : -1,
) {
  const own = s.groundUnits.filter((u) => u.side === side && military(u));
  const sectors = FRONT_SECTORS.map((config) => {
    const allies = own.filter((u) => sectorAt(u.z).id === config.id);
    const defending = own.filter((u) => u.guard && sectorAt(u.guard.z).id === config.id);
    const enemies = memory.filter((u) => sectorAt(u.z).id === config.id);
    const contacts = (s.contacts?.[side] || []).filter(
      (c) =>
        c.expires > s.time &&
        !visible.has(c.unitId) &&
        !memory.some((v) => v.id === c.unitId) &&
        sectorAt(c.z).id === config.id,
    );
    const friendly = allies.reduce((n, u) => n + defenseStrength(u), 0);
    const enemy = enemies.reduce(
      (n, u) => n + u.strength * Math.max(0, 1 - (s.time - u.time) / C.memorySeconds),
      0,
    );
    const defenders = defending.length;
    const defensiveStrength = defending.reduce((n, u) => n + defenseStrength(u), 0);
    const contactsStrength = contacts.reduce(
      (n, c) => n + C.contactStrength * Math.max(0, Math.min(1, (c.expires - s.time) / 7)),
      0,
    );
    const observed = enemies.some((u) => visible.has(u.id));
    const ownAnchors = allies.map((u) => ({ x: u.x, weight: defenseStrength(u) }));
    const enemyAnchors = enemies.map((u) => ({
      x: u.x,
      weight: u.strength * Math.max(0, 1 - (s.time - u.time) / C.memorySeconds),
    }));
    let ownedDistricts = 0;
    for (const d of DISTRICTS) {
      if (sectorAt(d.z).id !== config.id) continue;
      const status = s.districts?.find((v) => v.id === d.id);
      if (status?.hp <= 0 || ![0, 1].includes(status?.owner)) continue;
      (status.owner === side ? ownAnchors : enemyAnchors).push({ x: d.x, weight: 2.5 });
      ownedDistricts++;
    }
    const ownEdge = edge(ownAnchors, direction),
      enemyEdge = edge(enemyAnchors, -direction);
    const known = ownEdge !== null || enemyEdge !== null || contacts.length > 0;
    let x =
      ownEdge !== null && enemyEdge !== null
        ? (ownEdge + enemyEdge) / 2
        : ownEdge !== null
          ? ownEdge + direction * 55
          : enemyEdge !== null
            ? enemyEdge - direction * 55
            : contacts.length
              ? contacts.reduce((n, c) => n + c.x, 0) / contacts.length - direction * 45
              : riverX(config.z);
    x = Math.max(-(FIELD.x - 100), Math.min(FIELD.x - 100, x));
    const confidence = observed
      ? Math.min(1, 0.65 + (friendly > 0 ? 0.25 : 0))
      : enemies.length
        ? Math.min(
            0.65,
            Math.max(...enemies.map((v) => 1 - (s.time - v.time) / C.memorySeconds)) * 0.65,
          )
        : known
          ? ownedDistricts
            ? 0.4
            : 0.3
          : 0;
    const pressure = (enemy + contactsStrength) / (defensiveStrength + 1);
    return {
      ...config,
      x,
      confidence,
      knowledge: observed ? 'observed' : known ? 'estimated' : 'unknown',
      friendly,
      enemy,
      contacts: contacts.length,
      threat: Math.min(100, pressure * 25),
      pressure,
      defenders,
      reserves: defending.filter((u) => u.autoDefense && !u.defenseTask).length,
      reinforcing: defending.filter((u) => u.defenseTask && !u.defenseTask.returning).length,
    };
  });
  // Unobserved spans follow neighbouring estimates, never a hidden enemy's exact coordinates.
  for (let i = 0; i < sectors.length; i++)
    if (sectors[i].knowledge === 'unknown') {
      const neighbours = sectors.filter((v, j) => j !== i && v.knowledge !== 'unknown');
      if (neighbours.length)
        sectors[i].x =
          neighbours.reduce((n, v) => n + v.x / (1 + Math.abs(v.z - sectors[i].z)), 0) /
          neighbours.reduce((n, v) => n + 1 / (1 + Math.abs(v.z - sectors[i].z)), 0);
    }
  return {
    updatedAt: s.time,
    sectors,
    polyline: sectors.map(({ id, x, z, confidence, knowledge }) => ({
      sectorId: id,
      x,
      z,
      confidence,
      knowledge,
    })),
    counts: {
      defenders: own.filter((u) => u.guard).length,
      reserves: own.filter((u) => u.guard && u.autoDefense && !u.defenseTask).length,
      reinforcing: own.filter((u) => u.defenseTask && !u.defenseTask.returning).length,
      fortified: (s.trenches || []).filter((t) => t.side === side && t.progress >= 1).length,
    },
  };
}

export function cacheFrontline(s, side, report) {
  let entry = reports.get(s);
  if (!entry) {
    entry = [];
    reports.set(s, entry);
  }
  entry[side] = {
    report,
    revision: frontlineRevision(s),
    units: s.groundUnits.length,
    trenches: s.trenches.length,
    network: s.networkRevision,
  };
}

export function frontlineReport(s, side) {
  if (![0, 1].includes(side)) return null;
  const cached = reports.get(s)?.[side];
  if (
    cached &&
    cached.revision === frontlineRevision(s) &&
    cached.units === s.groundUnits.length &&
    cached.trenches === s.trenches.length &&
    cached.network === s.networkRevision &&
    s.time >= cached.report.updatedAt &&
    s.time - cached.report.updatedAt < C.cadence
  )
    return cached.report;
  // Presentation queries consume the observed memory; only the coordinator performs enemy LoS scans.
  // This also keeps repeated network-view clones from rebuilding visibility every render frame.
  const memory = s.frontlineMemory?.[side] || { nextThink: 0, seen: [] };
  const seen = memory.seen.filter((v) => s.time - v.time <= C.memorySeconds);
  const visible = new Set(
    seen.filter((v) => v.time >= memory.nextThink - C.cadence - 1e-6).map((v) => v.id),
  );
  // Network views renumber ownership, while world coordinates keep their original orientation.
  // Only the presentation query consumes this metadata; authority decisions use the real side.
  const direction =
    s.frontlineDirections?.[side] === -1
      ? -1
      : s.frontlineDirections?.[side] === 1
        ? 1
        : side === 0
          ? 1
          : -1;
  const report = calculateFrontline(s, side, seen, visible, direction);
  cacheFrontline(s, side, report);
  return report;
}
