import { network, projectPoint, segmentDistance } from '../city/road-network.js';
import { BUILDINGS } from '../city/buildings.config.js';
import { expandLegacyX, expandLegacyZ } from '../map.js';
import { allied, hostile, hqOf, sideIds, teamOf, validSide } from '../factions.js';
import { GROUND_UNITS, isInfantry } from '../units/ground/types.js';
import { event } from '../shared/events.js';
import {
  SETTLEMENTS,
  SETTLEMENT_BY_ID,
  SETTLEMENT_FOOTPRINTS,
  SETTLEMENT_RULES as R,
} from './settlements.config.js';

export { SETTLEMENTS, SETTLEMENT_RULES } from './settlements.config.js';
const fields = ['id', 'owner', 'capturing', 'control', 'contested', 'blocked'];
const canonical = (value) => Object.fromEntries(fields.map((key) => [key, value[key]]));
const cache = new WeakMap();
export const createSettlementClock = () => ({ next: 0, elapsed: 0 });
export const createSettlements = () =>
  SETTLEMENTS.map((d) => ({
    id: d.id,
    owner: null,
    capturing: null,
    control: 0,
    contested: false,
    blocked: false,
  }));
function legacyHouseMask(s, sourceVersion) {
  const point = (p) =>
    p && Number.isFinite(p.x) && Number.isFinite(p.z)
      ? {
          x: sourceVersion < 15 ? expandLegacyX(p.x) : p.x,
          z: sourceVersion < 14 ? expandLegacyZ(p.z) : p.z,
        }
      : null;
  const positions = [];
  for (const u of s.groundUnits || []) {
    positions.push(u, u.guard, u.order, ...(u.path || []), ...(u.routeQueue || []));
  }
  for (const vehicle of [...(s.serviceVehicles || []), ...(s.ammoVehicles || [])])
    positions.push(vehicle, vehicle.goal, vehicle.home, ...(vehicle.path || []));
  positions.push(...(s.trenches || []));
  for (const b of s.buildings || []) {
    positions.push(b.rally);
    for (const queued of b.armyQueue || []) positions.push(queued.destination);
  }
  const projected = positions.map(point).filter(Boolean);
  let mask = 65535;
  for (let index = 0; index < SETTLEMENT_FOOTPRINTS.length; index++) {
    const house = SETTLEMENT_FOOTPRINTS[index];
    const unitOverlap = projected.some(
      (p) => Math.hypot(p.x - house.x, p.z - house.z) < house.r + 5,
    );
    const buildingOverlap = s.buildings.some((b) => {
      if (b.demolished) return false;
      const p = point(b);
      return (
        p &&
        Math.hypot(p.x - house.x, p.z - house.z) <
          (BUILDINGS[b.key]?.size || 30) * 0.6 + house.r + 3
      );
    });
    const roadOverlap = s.roads.some((r) => {
      if (r.removed) return false;
      const a = point({ x: r.ax, z: r.az }),
        b = point({ x: r.bx, z: r.bz });
      return a && b && segmentDistance(house.x, house.z, a.x, a.z, b.x, b.z) < house.r + 6;
    });
    if (unitOverlap || buildingOverlap || roadOverlap) mask &= ~(1 << index);
  }
  return mask;
}
export function restoreSettlements(s, sourceVersion = s.version) {
  if (sourceVersion < 17) s.settlementHouseMask = legacyHouseMask(s, sourceVersion);
  if (
    !Number.isInteger(s.settlementHouseMask) ||
    s.settlementHouseMask < 0 ||
    s.settlementHouseMask > 65535
  )
    throw Error('Повреждена геометрия поселений');
  if (sourceVersion < 17 && s.settlements == null) s.settlements = createSettlements();
  if (sourceVersion < 17 && s.settlementClock == null) s.settlementClock = createSettlementClock();
  const clock = s.settlementClock;
  if (
    !clock ||
    Array.isArray(clock) ||
    !Number.isFinite(clock.next) ||
    clock.next < 0 ||
    clock.next > s.time + R.cadence + 1e-6 ||
    !Number.isFinite(clock.elapsed) ||
    clock.elapsed < 0 ||
    clock.elapsed > R.cadence + 1e-6
  )
    throw Error('Повреждено время поселений');
  s.settlementClock = { next: clock.next, elapsed: clock.elapsed };
  if (!Array.isArray(s.settlements) || s.settlements.length !== SETTLEMENTS.length)
    throw Error('Повреждены поселения');
  const ids = new Set();
  for (const d of s.settlements) {
    if (
      !d ||
      typeof d.id !== 'string' ||
      !Object.hasOwn(SETTLEMENT_BY_ID, d.id) ||
      ids.has(d.id) ||
      (d.owner !== null && !validSide(s, d.owner)) ||
      (d.capturing !== null && !validSide(s, d.capturing)) ||
      !Number.isFinite(d.control) ||
      d.control < 0 ||
      d.control > 1 ||
      typeof d.contested !== 'boolean' ||
      typeof d.blocked !== 'boolean' ||
      (d.owner === null && d.blocked) ||
      (d.owner === null && d.capturing === null && d.control !== 0) ||
      (d.owner !== null && d.control === 0)
    )
      throw Error('Повреждено поселение');
    ids.add(d.id);
  }
  s.settlements = SETTLEMENTS.map((d) =>
    canonical(s.settlements.find((value) => value.id === d.id)),
  );
  cache.delete(s);
}
export function settlementHomeSide(s, site) {
  // Network views reorder factions so the viewing city is always side 0. Actual
  // HQ positions stay fixed, so derive the nearest home from geography, not ids.
  let side = null;
  let best = Infinity;
  for (const candidate of sideIds(s)) {
    const hq = hqOf(s, candidate);
    if (!hq || Math.sign(hq.x) !== Math.sign(site.x)) continue;
    const distance = (hq.x - site.x) ** 2 + (hq.z - site.z) ** 2;
    if (distance < best) {
      best = distance;
      side = candidate;
    }
  }
  return side;
}
const liveHQ = (s, side) => {
  const hq = hqOf(s, side);
  return hq && hq.hp > 0 && hq.progress >= 1 ? hq : null;
};
function connected(s, side, site) {
  return (
    validSide(s, side) &&
    !!liveHQ(s, side) &&
    network(s, side).connected.some(
      (road) => projectPoint(site.x, site.z, road).distance <= R.roadReach,
    )
  );
}
export function settlementStatus(s, id) {
  const config =
    typeof id === 'string' && Object.hasOwn(SETTLEMENT_BY_ID, id) ? SETTLEMENT_BY_ID[id] : null;
  const value = config && s.settlements?.find((site) => site.id === id);
  if (!value) return null;
  const linked = value.owner !== null && connected(s, value.owner, config);
  const active = !!linked && !value.blocked && !value.contested;
  return {
    ...config,
    ...canonical(value),
    homeSide: settlementHomeSide(s, config),
    connected: !!linked,
    active,
    income: active ? R.income : 0,
    materials: active ? R.materials : 0,
    reason: value.contested
      ? 'contested'
      : value.blocked
        ? 'hostile'
        : value.owner === null
          ? 'neutral'
          : !linked
            ? 'road'
            : 'active',
  };
}
export function settlementIncome(s, side) {
  const result = { income: 0, materials: 0, owned: 0, active: 0, isolated: 0, blocked: 0 };
  for (const value of s.settlements || []) {
    if (value.owner !== side) continue;
    const d = settlementStatus(s, value.id);
    if (!d) continue;
    result.owned++;
    if (d.blocked || d.contested) result.blocked++;
    if (!d.connected) result.isolated++;
    if (d.active) {
      result.active++;
      result.income += R.income;
      result.materials += R.materials;
    }
  }
  return result;
}
function presence(s, d) {
  const teams = [0, 0],
    foot = s.sides.map(() => 0);
  for (const u of s.groundUnits || []) {
    if (
      !validSide(s, u.side) ||
      u.hp <= 0 ||
      u.civil ||
      u.carrierId ||
      u.progress < 1 ||
      (u.x - d.x) ** 2 + (u.z - d.z) ** 2 > R.radius ** 2
    )
      continue;
    teams[teamOf(s, u.side)]++;
    if (
      isInfantry(u.key) &&
      !GROUND_UNITS[u.key].support &&
      !u.downed &&
      (u.suppression || 0) < 0.8 &&
      u.order?.mode !== 'retreat'
    )
      foot[u.side]++;
  }
  return { teams, foot };
}
function claim(s, value, side, d) {
  value.owner = side;
  value.control = 1;
  value.capturing = null;
  value.blocked = false;
  event(s, 'settlementConnected', { side, settlementId: d.id, x: d.x, z: d.z });
}
function updateOne(s, value, d, dt) {
  const { teams, foot } = presence(s, d);
  value.contested = teams[0] > 0 && teams[1] > 0;
  value.blocked = value.owner !== null && teams[1 - teamOf(s, value.owner)] > 0;
  if (value.contested) return;
  const hostileFoot = sideIds(s).filter(
    (side) =>
      foot[side] > 0 &&
      (value.owner !== null ? hostile(s, side, value.owner) : side === value.capturing),
  );
  const attacker = value.contested
    ? null
    : hostileFoot.includes(value.capturing)
      ? value.capturing
      : (hostileFoot[0] ?? null);
  if (attacker !== null) {
    value.capturing = attacker;
    const strength =
      1 +
      (Math.min(
        3,
        foot.filter((_, side) => allied(s, side, attacker)).reduce((a, b) => a + b, 0),
      ) -
        1) *
        0.25;
    if (value.owner !== null) {
      value.control = Math.max(0, value.control - (dt * strength) / R.neutralizeSeconds);
      if (value.control <= 1e-8) {
        event(s, 'settlementLost', { side: value.owner, settlementId: d.id, x: d.x, z: d.z });
        value.owner = null;
        value.control = 0;
        value.blocked = false;
      }
    } else {
      value.control = Math.min(1, value.control + (dt * strength) / R.captureSeconds);
      if (value.control >= 1 - 1e-8) claim(s, value, attacker, d);
    }
    return;
  }
  if (value.owner !== null) {
    value.capturing = null;
    value.control = Math.min(1, value.control + dt * R.decayPerSecond);
    if (liveHQ(s, value.owner) || value.contested) return;
    const replacement = sideIds(s).find(
      (side) =>
        allied(s, side, value.owner) && connected(s, side, d) && !teams[1 - teamOf(s, side)],
    );
    if (replacement !== undefined) claim(s, value, replacement, d);
    return;
  }
  if (value.contested) return;
  const home = settlementHomeSide(s, d);
  const claimant = sideIds(s).find(
    (side) =>
      (side === home || (!liveHQ(s, home) && allied(s, side, home))) &&
      !teams[1 - teamOf(s, side)] &&
      connected(s, side, d),
  );
  if (claimant !== undefined) {
    claim(s, value, claimant, d);
    return;
  }
  value.control = Math.max(0, value.control - dt * R.decayPerSecond);
  if (!value.control) value.capturing = null;
}
export function updateSettlements(s, dt) {
  if (s.result || s.paused || !Number.isFinite(dt) || dt <= 0) return;
  let entry = cache.get(s);
  if (!entry) {
    entry = { revision: s.networkRevision };
    cache.set(s, entry);
  }
  const clock = (s.settlementClock ??= createSettlementClock());
  clock.elapsed += dt;
  const due = s.time >= clock.next;
  if (!due && entry.revision === s.networkRevision) return;
  const elapsed = due ? clock.elapsed : 0;
  if (due) {
    clock.elapsed = 0;
    clock.next = s.time + R.cadence;
  }
  entry.revision = s.networkRevision;
  for (const value of s.settlements || []) {
    const d = SETTLEMENT_BY_ID[value.id];
    if (d) updateOne(s, value, d, elapsed);
  }
}
