import { allied, hostile } from '../factions.js';
import { validSide } from '../factions.js';
import { GROUND_UNITS, isInfantry } from '../config.js';
import { groundVisible } from '../units/infantry/cover.js';
import { corridorGeometry } from './geometry.js';
import { FRONTLINE as C } from './config.js';
import { frontlineRevision } from './cache.js';

const reports = new WeakMap();
export function forgetObservedFrontlineTarget(s, id, sides) {
  for (const side of sides) {
    const memory = s.frontlineMemory?.[side];
    if (memory) memory.seen = memory.seen.filter((v) => v.id !== id);
  }
  reports.delete(s);
}
export const createFrontlineMemory = (count = 2) =>
  Array.from({ length: count }, () => ({ nextThink: 0, nextReinforce: 0, seen: [] }));
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
    if (hostile(s, u.side, side) && military(u) && groundVisible(s, side, u)) {
      seen.set(u.id, {
        id: u.id,
        x: u.x,
        z: u.z,
        // A damaged armoured vehicle still calls for an anti-armour response.
        // Preserve that known threat class inside the existing bounded strength field.
        strength: isInfantry(u.key) ? defenseStrength(u) : Math.max(2.5, defenseStrength(u)),
        time: s.time,
      });
      visible.add(u.id);
    }
  const lines = corridorGeometry(s, side),
    direction = side % 2 === 0 ? 1 : -1;
  const urgency = new Map();
  for (const v of seen.values()) {
    let closest = lines[0];
    for (const line of lines)
      if (Math.abs(line.z - v.z) < Math.abs(closest.z - v.z)) closest = line;
    const ownHalf = s.sides.length <= 2 || (closest.id === 'north' ? v.z <= 0 : v.z >= 0);
    urgency.set(v.id, ownHalf ? Math.max(0, (closest.x - v.x) * direction - 80) * v.strength : 0);
  }
  return {
    seen: [...seen.values()]
      .sort(
        (a, b) =>
          (urgency.get(b.id) || 0) - (urgency.get(a.id) || 0) || b.time - a.time || a.id - b.id,
      )
      .slice(0, C.maxSeen),
    visible,
  };
}

const corridorContains = (line, point) => {
  const low = Math.min(...line.points.map((p) => p.z)),
    high = Math.max(...line.points.map((p) => p.z));
  return (
    point.z >= low - C.postGap && point.z <= high + C.postGap && Math.abs(point.x - line.x) < 500
  );
};

export function calculateFrontline(
  s,
  side,
  memory,
  visible = new Set(),
  direction = side % 2 === 0 ? 1 : -1,
) {
  const own = s.groundUnits.filter((u) => u.side === side && military(u));
  const lines = corridorGeometry(s, side, direction);
  const rearAssignments = new Map();
  const rearAssignment = (point) => {
    if (rearAssignments.has(point)) return rearAssignments.get(point);
    let closest = null,
      best = Infinity;
    for (const line of lines) {
      const distance = Math.abs(line.z - point.z);
      if (distance < best || (distance === best && line.id.localeCompare(closest.id) < 0)) {
        closest = line;
        best = distance;
      }
    }
    let result = null;
    if (
      closest &&
      (closest.x - point.x) * direction > 80 &&
      (s.sides.length <= 2 || (closest.id === 'north' ? point.z <= 0 : point.z >= 0))
    ) {
      let slot = closest.slots[0];
      for (const candidate of closest.slots)
        if (Math.abs(candidate.z - point.z) < Math.abs(slot.z - point.z)) slot = candidate;
      result = { corridorId: closest.id, slot: slot.slot };
    }
    rearAssignments.set(point, result);
    return result;
  };
  const rearBreach = (line, point) => rearAssignment(point)?.corridorId === line.id;
  const belongs = (line, point) => corridorContains(line, point) || rearBreach(line, point);
  const posts = [];
  const sectors = lines.map((line) => {
    const depot = s.districts.find((d) => d.id === line.districtId);
    const enemies = memory.filter((v) => belongs(line, v));
    const contacts = (s.contacts?.[side] || []).filter(
      (v) =>
        v.expires > s.time &&
        belongs(line, v) &&
        !visible.has(v.unitId) &&
        !memory.some((m) => m.id === v.unitId),
    );
    const decay = (v) => Math.max(0, 1 - (s.time - v.time) / C.memorySeconds);
    const enemy = enemies.reduce((sum, v) => sum + v.strength * decay(v), 0);
    const assigned = own.filter(
      (u) =>
        u.guard &&
        (u.defensePost?.corridorId === line.id ||
          (!u.defensePost && corridorContains(line, u.guard))),
    );
    const observed = enemies.some((v) => visible.has(v.id));
    const known = observed || enemies.length > 0 || contacts.length > 0;
    const knowledge = observed ? 'observed' : known ? 'estimated' : 'unknown';
    const confidence = observed
      ? 0.9
      : enemies.length
        ? Math.max(...enemies.map(decay)) * 0.65
        : contacts.length
          ? 0.3
          : 0;
    const contactStrength = (c) =>
      C.contactStrength * Math.max(0, Math.min(1, (c.expires - s.time) / 7));
    const strength = assigned.reduce((sum, u) => sum + defenseStrength(u), 0);
    const pressure =
      (enemy + contacts.reduce((sum, c) => sum + contactStrength(c), 0)) / (strength + 1);
    const primary = line.slots.map((slot) => {
      const occupants = assigned.filter(
        (u) =>
          !u.defenseCapture &&
          !u.defenseTask &&
          ((u.defensePost?.slot === slot.slot && u.defensePost.row === 0) ||
            (!u.autoDefense &&
              u.guard &&
              Math.hypot(u.guard.x - slot.x, u.guard.z - slot.z) <= 12)),
      );
      const defenders = own.filter(
        (u) =>
          u.guard && Math.abs(u.z - slot.z) <= C.postGap * 0.65 && Math.abs(u.x - slot.x) <= 100,
      );
      const nearby = enemies.filter((v) =>
        rearBreach(line, v)
          ? rearAssignment(v).slot === slot.slot
          : Math.abs(v.z - slot.z) <= C.postGap * 0.8,
      );
      const breached = nearby.filter((v) => rearBreach(line, v));
      const intrusion = breached
        .slice()
        .sort((a, b) => (a.x - b.x) * direction || b.strength - a.strength || a.id - b.id)[0];
      const localEnemy = nearby.reduce((sum, v) => sum + v.strength * decay(v), 0);
      const localContacts = contacts
        .filter((c) => Math.abs(c.z - slot.z) <= C.postGap)
        .reduce((sum, c) => sum + contactStrength(c), 0);
      const localStrength = defenders.reduce((sum, u) => sum + defenseStrength(u), 0);
      return {
        ...slot,
        occupied: occupants.filter(
          (u) => !u.path?.length && Math.hypot(u.x - slot.x, u.z - slot.z) <= 20,
        ).length,
        reserved: occupants.length,
        pressure: (localEnemy + localContacts) / (localStrength + 1),
        enemy: localEnemy,
        breakthrough: breached.reduce((sum, v) => sum + v.strength * decay(v), 0),
        threatPoint: intrusion ? { id: intrusion.id, x: intrusion.x, z: intrusion.z } : null,
        armor: nearby.reduce((sum, v) => sum + (v.strength >= 2.5 ? v.strength * decay(v) : 0), 0),
        knowledge,
        confidence,
      };
    });
    posts.push(...primary);
    const occupied = primary.filter((p) => p.occupied > 0);
    const zs = occupied.map((p) => Math.abs(p.z)).sort((a, b) => a - b);
    const shore = Math.min(...line.points.map((p) => Math.abs(p.z))),
      edge = Math.max(...line.points.map((p) => Math.abs(p.z)));
    const gaps = zs.length
      ? [zs[0] - shore, edge - zs.at(-1), ...zs.slice(1).map((z, i) => z - zs[i])]
      : [edge - shore];
    const maxGap = Math.max(...gaps);
    const coverage = {
      required: primary.length,
      occupied: occupied.length,
      reserved: primary.filter((p) => p.reserved > 0).length,
      arrived: primary.filter((p) => p.occupied > 0).length,
      maxGap,
      weak: occupied.length < primary.length || maxGap > C.postGap + 1e-6,
    };
    return {
      id: line.id,
      districtId: line.districtId,
      objective: depot?.contested
        ? 'Бой за склад'
        : allied(s, depot?.owner, side)
          ? depot.hp <= 0
            ? 'Восстановление склада'
            : 'Склад под защитой'
          : 'Захват склада',
      layers: {
        outer: assigned.filter((u) => u.defensePost?.row === 0).length,
        inner: assigned.filter((u) => u.defensePost?.row > 0 && u.defensePost.row < 4).length,
        rear: assigned.filter((u) => u.defensePost?.row >= 4).length,
      },
      label: line.id === 'north' ? 'Северный коридор' : 'Южный коридор',
      x: line.x,
      z: line.z,
      confidence,
      knowledge,
      friendly: strength,
      enemy,
      contacts: contacts.length,
      threat: Math.min(100, pressure * 25),
      pressure,
      defenders: assigned.length,
      reserves: assigned.filter(
        (u) => u.autoDefense && !u.defenseTask && !u.defenseCapture && u.defensePost?.row > 0,
      ).length,
      reinforcing: assigned.filter((u) => u.defenseTask && !u.defenseTask.returning).length,
      coverage,
    };
  });
  return {
    updatedAt: s.time,
    sectors,
    posts,
    lines: lines.map((line, i) => ({
      id: line.id,
      points: line.points.map((p) => ({
        ...p,
        sectorId: line.id,
        confidence: sectors[i].confidence,
        knowledge: sectors[i].knowledge,
      })),
    })),
    polyline: lines.flatMap((line, i) =>
      line.points.map((p, j) => ({
        ...p,
        sectorId: line.id,
        breakBefore: i > 0 && j === 0,
        confidence: sectors[i].confidence,
        knowledge: sectors[i].knowledge,
      })),
    ),
    counts: {
      defenders: own.filter((u) => u.guard).length,
      reserves: own.filter(
        (u) =>
          u.guard &&
          u.autoDefense &&
          !u.defenseTask &&
          !u.defenseCapture &&
          (!u.defensePost || u.defensePost.row > 0),
      ).length,
      reinforcing: own.filter((u) => u.defenseTask && !u.defenseTask.returning).length,
      capturing: own.filter((u) => u.autoDefense && u.defenseCapture).length,
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
  if (!validSide(s, side)) return null;
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
        : side % 2 === 0
          ? 1
          : -1;
  const report = calculateFrontline(s, side, seen, visible, direction);
  cacheFrontline(s, side, report);
  return report;
}
