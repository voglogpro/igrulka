import { BUILDINGS } from '../config.js';
import { event } from '../shared/events.js';
import { berthOf, quayOf } from './ports.js';

// A naval base keeps one missile ship. The ship takes cruise missiles aboard at its berth, sails
// out to a firing station in open water once it carries any, launches from there and returns to
// the berth when its magazine is empty. The base's launch store is the ship's magazine.
const cfg = () => BUILDINGS.navalbase.naval;
const live = (b) => b.key === 'navalbase' && b.hp > 0 && b.progress >= 1 && !b.demolished;
export const SHIP_RADIUS = 10;

export const warshipOf = (s, base) =>
  (s.warships || []).find((ship) => ship.baseId === base?.id && ship.hp > 0) || null;

export function navalStation(base) {
  const berth = berthOf(base),
    quay = quayOf(base),
    k = cfg().station;
  return { x: berth.x + (quay.x - berth.x) * k, z: berth.z + (quay.z - berth.z) * k };
}

// Missiles are loaded only alongside the quay.
export function warshipDocked(s, base) {
  const ship = warshipOf(s, base);
  return !!ship && ship.state === 'docked';
}

const magazine = (base) => Object.values(base.launchStore || {}).reduce((n, v) => n + v, 0);

function sink(s, ship, base) {
  ship.hp = 0;
  if (base) {
    for (const key of Object.keys(base.launchStore || {})) base.launchStore[key] = 0;
    base.shipReplaceAt = s.time + cfg().replaceDelay;
    base.shipLost = true;
  }
  event(s, 'shipSunk', { side: ship.side, x: ship.x, z: ship.z, shipId: ship.id });
}

export function damageWarships(s, x, z, at) {
  for (const ship of s.warships || []) {
    if (ship.hp <= 0) continue;
    const amount = at(Math.max(0, Math.hypot(ship.x - x, ship.z - z) - SHIP_RADIUS));
    if (!amount) continue;
    ship.hp = Math.max(0, ship.hp - amount);
    if (!ship.hp)
      sink(
        s,
        ship,
        s.buildings.find((b) => b.id === ship.baseId),
      );
  }
}

export function updateWarships(s, dt) {
  s.warships ||= [];
  const c = cfg(),
    bases = new Map(s.buildings.filter(live).map((b) => [b.id, b]));
  // A ship whose base is lost goes with it.
  s.warships = s.warships.filter((ship) => ship.hp > 0 && bases.has(ship.baseId));
  for (const base of bases.values()) {
    if (warshipOf(s, base) || (base.shipReplaceAt || 0) > s.time) continue;
    const f = s.sides[base.side];
    // The first ship comes with the base; a replacement for a sunk one is paid for.
    if (base.shipLost) {
      if (f.credits < c.replaceCost + 250 || f.materials < c.replaceMetal) continue;
      f.credits -= c.replaceCost;
      f.materials -= c.replaceMetal;
      base.shipLost = false;
    }
    const berth = berthOf(base);
    s.warships.push({
      id: s.nextId++,
      side: base.side,
      baseId: base.id,
      x: berth.x,
      z: berth.z,
      yaw: 0,
      hp: c.hp,
      maxHp: c.hp,
      state: 'docked',
      loaded: 0,
      loadedAt: s.time,
    });
    event(s, 'shipLaunched', { side: base.side, x: berth.x, z: berth.z });
  }
  for (const ship of s.warships) {
    const base = bases.get(ship.baseId),
      loaded = magazine(base),
      incoming = (s.ammoVehicles || []).some(
        (v) =>
          v.hp > 0 &&
          v.targetId === base.id &&
          v.cargo?.kind === 'weapon' &&
          !['returning', 'destroyed'].includes(v.status),
      );
    if (loaded !== ship.loaded) {
      ship.loaded = loaded;
      ship.loadedAt = s.time;
    }
    // Leave with a full magazine, or once nothing more is on its way for a while.
    const sail =
      loaded > 0 &&
      (ship.state !== 'docked' ||
        loaded >= 4 ||
        (!incoming && s.time - (ship.loadedAt || 0) >= c.loadWait));
    const goal = sail ? navalStation(base) : berthOf(base),
      dx = goal.x - ship.x,
      dz = goal.z - ship.z,
      l = Math.hypot(dx, dz),
      step = c.speed * (s.weather?.speed ?? 1) * dt;
    if (l <= step) {
      ship.x = goal.x;
      ship.z = goal.z;
      ship.state = sail ? 'station' : 'docked';
      continue;
    }
    ship.yaw = Math.atan2(dx, dz);
    ship.x += (dx / l) * step;
    ship.z += (dz / l) * step;
    ship.state = 'sailing';
  }
}

const finite = (v, min = -Infinity, max = Infinity) => Number.isFinite(v) && v >= min && v <= max;
export function restoreWarships(s) {
  s.warships ??= [];
  if (!Array.isArray(s.warships) || s.warships.length > 64) throw Error('Повреждён военный флот');
  const ids = new Set();
  for (const ship of s.warships) {
    const base = s.buildings.find((b) => b.id === ship?.baseId);
    if (
      !ship ||
      !Number.isSafeInteger(ship.id) ||
      ids.has(ship.id) ||
      !base ||
      base.key !== 'navalbase' ||
      base.side !== ship.side ||
      !finite(ship.x) ||
      !finite(ship.z) ||
      !finite(ship.yaw) ||
      !finite(ship.hp, 0, cfg().hp) ||
      ship.maxHp !== cfg().hp ||
      !['docked', 'sailing', 'station'].includes(ship.state) ||
      (ship.loaded != null && !finite(ship.loaded, 0, 4)) ||
      (ship.loadedAt != null && !finite(ship.loadedAt, 0))
    )
      throw Error('Повреждён военный флот');
    ids.add(ship.id);
  }
  for (const b of s.buildings) {
    if (b.key !== 'navalbase') continue;
    if (b.shipReplaceAt != null && !finite(b.shipReplaceAt, 0))
      throw Error('Повреждена база флота');
    if (b.shipLost != null && typeof b.shipLost !== 'boolean') throw Error('Повреждена база флота');
  }
}
