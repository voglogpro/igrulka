import { BUILDINGS, ISLAND, seaDistance } from '../config.js';
import { hostile } from '../factions.js';
import { random } from '../shared/random.js';
import { applyBlast } from '../combat/damage.js';
import { event } from '../shared/events.js';
import { berthOf, quayOf } from './ports.js';

// A naval base keeps one missile ship. The ship takes cruise missiles aboard at its berth, sails
// out to a firing station in open water once it carries any, launches from there and returns to
// the berth when its magazine is empty. The base's launch store is the ship's magazine.
const cfg = (key = 'navalbase') => BUILDINGS[key].naval;
const NAVAL_BASES = new Set(['navalbase', 'patrolbase']);
const live = (b) => NAVAL_BASES.has(b.key) && b.hp > 0 && b.progress >= 1 && !b.demolished;
export const shipClassOf = (base) => (base?.key === 'patrolbase' ? 'patrol' : 'missile');
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

function move(ship, goal, step) {
  const dx = goal.x - ship.x,
    dz = goal.z - ship.z,
    l = Math.hypot(dx, dz);
  if (l <= step) {
    ship.x = goal.x;
    ship.z = goal.z;
    ship.state = 'docked';
    return true;
  }
  ship.yaw = Math.atan2(dx, dz);
  ship.x += (dx / l) * step;
  ship.z += (dz / l) * step;
  ship.state = 'sailing';
  return false;
}

const magazine = (base) => Object.values(base.launchStore || {}).reduce((n, v) => n + v, 0);

function sink(s, ship, base) {
  ship.hp = 0;
  if (base) {
    for (const key of Object.keys(base.launchStore || {})) base.launchStore[key] = 0;
    base.shipReplaceAt = s.time + cfg(base.key).replaceDelay;
    base.shipLost = true;
  }
  event(s, 'shipSunk', { side: ship.side, x: ship.x, z: ship.z, shipId: ship.id });
}

export function damageShip(s, ship, amount) {
  if (ship.hp <= 0 || !(amount > 0)) return;
  ship.hp = Math.max(0, ship.hp - amount);
  if (!ship.hp)
    sink(
      s,
      ship,
      s.buildings.find((b) => b.id === ship.baseId),
    );
}
export function damageWarships(s, x, z, at) {
  for (const ship of s.warships || []) {
    if (ship.hp <= 0) continue;
    damageShip(s, ship, at(Math.max(0, Math.hypot(ship.x - x, ship.z - z) - SHIP_RADIUS)));
  }
}

// Ships keep to open water: a leg that would cross the island is bent around it.
function steer(ship, goal) {
  const dx = goal.x - ship.x,
    dz = goal.z - ship.z,
    l2 = dx * dx + dz * dz || 1,
    t = Math.max(0, Math.min(1, -((ship.x - ISLAND.x) * dx + (ship.z - ISLAND.z) * dz) / l2)),
    cx = ship.x + dx * t - ISLAND.x,
    cz = ship.z + dz * t - ISLAND.z;
  if (Math.hypot(cx, cz) > ISLAND.quay + 40) return goal;
  const side = Math.sign(ship.z || cz || 1);
  return { x: ISLAND.x, z: ISLAND.z + side * (ISLAND.quay + 90) };
}
// A firing point in deep water off a shore target: walk from it toward the island.
function offshore(target) {
  let { x, z } = target;
  const dx = ISLAND.x - x,
    dz = ISLAND.z - z,
    l = Math.hypot(dx, dz) || 1;
  for (let i = 0; i < 400 && seaDistance(x, z) > -40; i++) {
    x += (dx / l) * 4;
    z += (dz / l) * 4;
  }
  return { x, z };
}
const shoreTarget = (b) => seaDistance(b.x, b.z) < 260;

function shell(s, ship, target, gun) {
  ship.cooldown = gun.cooldown;
  event(s, 'navalShot', { side: ship.side, x: ship.x, z: ship.z, tx: target.x, tz: target.z });
  if (random(s) > 0.8) return;
  event(s, 'impact', { x: target.x, y: 2, z: target.z, key: 'tank', side: ship.side });
  if (target.baseId != null) damageShip(s, target, gun.damage);
  else applyBlast(s, target.x, target.z, gun.damage, 8);
}

// Patrol boats hunt enemy ships first, then shell buildings near the enemy shore, and go home
// for repairs when badly damaged. Every decision reads public positions only.
function patrolGoal(s, ship, base, dt) {
  const c = cfg(base.key),
    gun = c.gun;
  ship.cooldown = Math.max(0, (ship.cooldown || 0) - dt);
  if (ship.hp < c.hp * 0.4 || (ship.mode === 'repair' && ship.hp < c.hp)) {
    ship.mode = 'repair';
    const berth = berthOf(base);
    if (Math.hypot(ship.x - berth.x, ship.z - berth.z) < 2)
      ship.hp = Math.min(c.hp, ship.hp + 6 * dt);
    return berth;
  }
  // Enemy batteries are public; a boat never steams into a battery's reach to fight.
  const batteries = s.buildings.filter(
    (b) => b.key === 'coastgun' && b.hp > 0 && b.progress >= 1 && hostile(s, ship.side, b.side),
  );
  const covered = (p) =>
    batteries.some(
      (b) => Math.hypot(b.x - p.x, b.z - p.z) < BUILDINGS.coastgun.coastal.range + gun.range * 0.5,
    );
  let enemy = null,
    best = Infinity;
  for (const other of s.warships)
    if (other.hp > 0 && hostile(s, ship.side, other.side) && !covered(other)) {
      const d = Math.hypot(other.x - ship.x, other.z - ship.z);
      if (d < best && d < 1100) {
        enemy = other;
        best = d;
      }
    }
  if (enemy) {
    ship.mode = 'hunt';
    if (best <= gun.range && !ship.cooldown) shell(s, ship, enemy, gun);
    const k = best > gun.range * 0.8 ? (best - gun.range * 0.75) / best : 0;
    return { x: ship.x + (enemy.x - ship.x) * k, z: ship.z + (enemy.z - ship.z) * k };
  }
  let target = null;
  best = Infinity;
  for (const b of s.buildings)
    if (
      b.hp > 0 &&
      !b.demolished &&
      hostile(s, ship.side, b.side) &&
      shoreTarget(b) &&
      !covered(offshore(b))
    ) {
      const d = Math.hypot(b.x - base.x, b.z - base.z);
      if (d < best) {
        target = b;
        best = d;
      }
    }
  if (target) {
    ship.mode = 'raid';
    const d = Math.hypot(target.x - ship.x, target.z - ship.z);
    if (d <= gun.range && !ship.cooldown) shell(s, ship, target, gun);
    return offshore(target);
  }
  ship.mode = 'patrol';
  return navalStation(base);
}

// Coastal batteries fire at the nearest enemy ship within reach.
function updateCoastGuns(s, dt) {
  for (const b of s.buildings) {
    if (b.key !== 'coastgun' || b.hp <= 0 || b.demolished || b.progress < 1) continue;
    const c = BUILDINGS.coastgun.coastal;
    b.navalCooldown = Math.max(0, (b.navalCooldown || 0) - dt);
    if (b.navalCooldown) continue;
    let target = null,
      best = c.range;
    for (const ship of s.warships || [])
      if (ship.hp > 0 && hostile(s, b.side, ship.side)) {
        const d = Math.hypot(ship.x - b.x, ship.z - b.z);
        if (d <= best) {
          target = ship;
          best = d;
        }
      }
    if (!target) continue;
    b.navalCooldown = c.cooldown;
    event(s, 'navalShot', { side: b.side, x: b.x, z: b.z, tx: target.x, tz: target.z });
    if (random(s) > c.accuracy) continue;
    event(s, 'impact', { x: target.x, y: 2, z: target.z, key: 'tank', side: b.side });
    damageShip(s, target, c.damage);
  }
}

export function updateWarships(s, dt) {
  s.warships ||= [];
  updateCoastGuns(s, dt);
  const c = cfg(),
    bases = new Map(s.buildings.filter(live).map((b) => [b.id, b]));
  // A ship whose base is lost goes with it.
  s.warships = s.warships.filter((ship) => ship.hp > 0 && bases.has(ship.baseId));
  for (const base of bases.values()) {
    if (warshipOf(s, base) || (base.shipReplaceAt || 0) > s.time) continue;
    const f = s.sides[base.side],
      c = cfg(base.key);
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
      class: shipClassOf(base),
      state: 'docked',
      loaded: 0,
      loadedAt: s.time,
    });
    event(s, 'shipLaunched', { side: base.side, x: berth.x, z: berth.z });
  }
  for (const ship of s.warships) {
    const base = bases.get(ship.baseId);
    if (ship.hp <= 0) continue;
    if (ship.class === 'patrol') {
      move(
        ship,
        steer(ship, patrolGoal(s, ship, base, dt)),
        cfg(base.key).speed * (s.weather?.speed ?? 1) * dt,
      );
      continue;
    }
    const loaded = magazine(base),
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
      !NAVAL_BASES.has(base.key) ||
      base.side !== ship.side ||
      (ship.class ?? 'missile') !== shipClassOf(base) ||
      (ship.cooldown != null && !finite(ship.cooldown, 0, 60)) ||
      (ship.mode != null && !['repair', 'hunt', 'raid', 'patrol'].includes(ship.mode)) ||
      !finite(ship.x) ||
      !finite(ship.z) ||
      !finite(ship.yaw) ||
      !finite(ship.hp, 0, cfg(base.key).hp) ||
      ship.maxHp !== cfg(base.key).hp ||
      !['docked', 'sailing', 'station'].includes(ship.state) ||
      (ship.loaded != null && !finite(ship.loaded, 0, 4)) ||
      (ship.loadedAt != null && !finite(ship.loadedAt, 0))
    )
      throw Error('Повреждён военный флот');
    ids.add(ship.id);
  }
  for (const ship of s.warships) ship.class ??= 'missile';
  for (const b of s.buildings) {
    if (!NAVAL_BASES.has(b.key)) continue;
    if (b.shipReplaceAt != null && !finite(b.shipReplaceAt, 0))
      throw Error('Повреждена база флота');
    if (b.shipLost != null && typeof b.shipLost !== 'boolean') throw Error('Повреждена база флота');
  }
}
