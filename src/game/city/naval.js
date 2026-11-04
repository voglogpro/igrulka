import {
  BUILDINGS,
  ISLAND,
  seaDistance,
  waterPath,
  RIVER,
  riverCenter,
  riverChannelDistance,
} from '../config.js';
import { COMBAT } from '../combat/config.js';
import { hostile, validSide } from '../factions.js';
import { weaponFamily } from '../units/aviation/weapons.config.js';
import { interceptPoint } from '../combat/air-defense.js';
import { SHIPS, shipClassesFor } from './ships.config.js';
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
// The hull a base builds or last built. A naval base remembers the class the player chose.
export const shipClassOf = (base) =>
  base?.key === 'patrolbase' ? 'patrol' : base?.shipClass === 'destroyer' ? 'destroyer' : 'missile';
const shipCfg = (ship) => SHIPS[ship.class] || SHIPS.missile;
export const SHIP_RADIUS = 10;

export const warshipOf = (s, base) =>
  (s.warships || []).find((ship) => ship.baseId === base?.id && ship.hp > 0) || null;

export function navalStation(base) {
  const berth = berthOf(base),
    quay = quayOf(base),
    k = cfg().station;
  // A river base sends its ship down to open water just off the river mouth.
  if (Math.abs(berth.z) >= RIVER.mouth && riverChannelDistance(berth.x, berth.z) < 20) {
    const z = Math.sign(berth.z) * (RIVER.mouth - 160);
    return { x: riverCenter(z), z };
  }
  return { x: berth.x + (quay.x - berth.x) * k, z: berth.z + (quay.z - berth.z) * k };
}

// Missiles are loaded only alongside the quay.
export function warshipDocked(s, base) {
  const ship = warshipOf(s, base);
  return !!ship && ship.state === 'docked';
}

function move(ship, goal, step, berth) {
  const dx = goal.x - ship.x,
    dz = goal.z - ship.z,
    l = Math.hypot(dx, dz);
  if (l <= step) {
    ship.x = goal.x;
    ship.z = goal.z;
    ship.state =
      !berth || Math.hypot(goal.x - berth.x, goal.z - berth.z) < 1 ? 'docked' : 'station';
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

// Ships keep to open water: rivers are followed along their channel, and a leg that would cross
// the island is bent around it.
function steer(ship, goal) {
  const path = waterPath(ship, goal);
  if (path.length > 1) {
    const next = path.find((p) => Math.hypot(p.x - ship.x, p.z - ship.z) > 6) || path.at(-1);
    if (next !== path.at(-1)) return next;
  }
  return steerIsland(ship, goal);
}
function steerIsland(ship, goal) {
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
  const c = shipCfg(ship),
    gun = c.gun;
  ship.cooldown = Math.max(0, (ship.cooldown || 0) - dt);
  if (ship.hp < c.hp * 0.4 || (ship.mode === 'repair' && ship.hp < c.hp)) {
    ship.mode = 'repair';
    const berth = berthOf(base);
    if (Math.hypot(ship.x - berth.x, ship.z - berth.z) < 2)
      ship.hp = Math.min(c.hp, ship.hp + 6 * dt);
    return berth;
  }
  // A destroyer with an empty launch shaft calls at its berth to take missiles and drones aboard.
  if (c.magazine && ship.class === 'destroyer') {
    const loaded = magazine(base);
    if (ship.mode === 'reload') {
      if (loaded >= c.magazine || s.time >= (ship.reloadUntil || 0)) ship.mode = 'patrol';
      else return berthOf(base);
    } else if (!loaded && s.time >= (ship.reloadUntil || 0) + 90) {
      ship.mode = 'reload';
      ship.reloadUntil = s.time + 150;
      return berthOf(base);
    }
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

// Shipyard order: the chosen hull is paid for in full and launched at the berth at once.
export function shipOrderStatus(s, side, baseId, shipClass) {
  if (!validSide(s, side)) return 'Неизвестная сторона';
  const base = s.buildings.find((b) => b.id === baseId);
  if (!base || base.side !== side) return 'Верфь вам не принадлежит';
  if (!live(base)) return 'Верфь ещё не готова';
  const c = SHIPS[shipClass];
  if (!c || !shipClassesFor(base.key).includes(shipClass))
    return 'Эта верфь не строит такой корабль';
  if (warshipOf(s, base)) return 'У причала уже есть корабль';
  const f = s.sides[side];
  if (f.credits < c.cost) return `Нужно ${c.cost} ₡`;
  if (f.materials < c.metal) return `Нужно ${c.metal} сплавов`;
  return '';
}
export function buyShip(s, side, baseId, shipClass) {
  const reason = shipOrderStatus(s, side, baseId, shipClass);
  if (reason) return reason;
  const base = s.buildings.find((b) => b.id === baseId),
    c = SHIPS[shipClass],
    f = s.sides[side],
    berth = berthOf(base);
  f.credits -= c.cost;
  f.materials -= c.metal;
  // A different hull empties the old magazine rack, whose weapons stay in the shipyard store.
  if (base.key === 'navalbase') base.shipClass = shipClass;
  base.shipLost = false;
  const ship = {
    id: s.nextId++,
    side,
    baseId: base.id,
    x: berth.x,
    z: berth.z,
    yaw: 0,
    hp: c.hp,
    maxHp: c.hp,
    class: shipClass,
    state: 'docked',
    loaded: 0,
    loadedAt: s.time,
  };
  s.warships.push(ship);
  event(s, 'shipLaunched', { side, x: berth.x, z: berth.z, shipId: ship.id, class: shipClass });
  return ship.id;
}

// Machine-gun mounts fire real bullets at drones near the ship; missiles need a SAM.
function updateShipAirDefense(s, dt) {
  for (const ship of s.warships) {
    const aa = shipCfg(ship).aa;
    if (!aa || ship.hp <= 0) continue;
    ship.aaCooldown = Math.max(0, (ship.aaCooldown || 0) - dt);
    if (ship.aaCooldown) continue;
    const threats = [];
    for (const u of s.units)
      if (
        u.hp > 0 &&
        u.launched &&
        weaponFamily(u.key) === 'drone' &&
        hostile(s, ship.side, u.side) &&
        Math.hypot(u.x - ship.x, u.z - ship.z) < aa.range
      )
        threats.push(u);
    if (!threats.length) continue;
    threats.sort(
      (a, b) =>
        Math.hypot(a.x - ship.x, a.z - ship.z) - Math.hypot(b.x - ship.x, b.z - ship.z) ||
        a.id - b.id,
    );
    ship.aaCooldown = aa.cooldown;
    for (let mount = 0; mount < aa.mounts; mount++) {
      const u = threats[mount % threats.length],
        speed = 390,
        origin = { x: ship.x, y: 6, z: ship.z },
        aim = interceptPoint(origin, u, speed),
        spread = 4 + Math.hypot(u.x - ship.x, u.z - ship.z) * 0.03;
      aim.x += (random(s) - 0.5) * spread * 2;
      aim.y += (random(s) - 0.5) * spread * 1.2 + 0.5 * COMBAT.gravity * aim.time * aim.time;
      aim.z += (random(s) - 0.5) * spread * 2;
      const dx = aim.x - origin.x,
        dy = aim.y - origin.y,
        dz = aim.z - origin.z,
        length = Math.hypot(dx, dy, dz) || 1,
        mx = origin.x + (dx / length) * 4 + (mount - 1) * 3,
        my = origin.y,
        mz = origin.z + (dz / length) * 4;
      s.projectiles.push({
        sourceId: ship.id,
        abm: false,
        gravity: COMBAT.gravity,
        tracer: true,
        id: s.nextId++,
        side: ship.side,
        source: ship.id,
        targetId: u.id,
        x: mx,
        y: my,
        z: mz,
        px: mx,
        py: my,
        pz: mz,
        vx: (dx / length) * speed,
        vy: (dy / length) * speed,
        vz: (dz / length) * speed,
        speed,
        damage: aa.damage,
        kind: 'bullet',
        life: 0,
        maxLife: Math.min(2, aa.range / speed + 0.6),
      });
      s.stats.shots++;
      event(s, 'shot', {
        x: ship.x,
        y: 6,
        z: ship.z,
        side: ship.side,
        key: 'gun',
        shooter: 'ship',
        mx,
        my,
        mz,
        tx: aim.x,
        ty: aim.y,
        tz: aim.z,
      });
    }
  }
}

export function updateWarships(s, dt) {
  s.warships ||= [];
  updateCoastGuns(s, dt);
  const c = cfg(),
    bases = new Map(s.buildings.filter(live).map((b) => [b.id, b]));
  // A ship whose base is lost goes with it.
  s.warships = s.warships.filter((ship) => ship.hp > 0 && bases.has(ship.baseId));
  updateShipAirDefense(s, dt);
  for (const ship of s.warships) {
    const base = bases.get(ship.baseId);
    if (ship.hp <= 0) continue;
    if (shipCfg(ship).gun) {
      move(
        ship,
        steer(ship, patrolGoal(s, ship, base, dt)),
        shipCfg(ship).speed * (s.weather?.speed ?? 1) * dt,
        berthOf(base),
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
        loaded >= shipCfg(ship).magazine ||
        (!incoming && s.time - (ship.loadedAt || 0) >= c.loadWait));
    const target = sail ? navalStation(base) : berthOf(base),
      goal = steer(ship, target),
      dx = goal.x - ship.x,
      dz = goal.z - ship.z,
      l = Math.hypot(dx, dz),
      step = shipCfg(ship).speed * (s.weather?.speed ?? 1) * dt;
    if (l <= step) {
      ship.x = goal.x;
      ship.z = goal.z;
      if (goal === target) ship.state = sail ? 'station' : 'docked';
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
      !shipClassesFor(base.key).includes(ship.class ?? 'missile') ||
      (ship.aaCooldown != null && !finite(ship.aaCooldown, 0, 10)) ||
      (ship.reloadUntil != null && !finite(ship.reloadUntil, 0)) ||
      (ship.cooldown != null && !finite(ship.cooldown, 0, 60)) ||
      (ship.mode != null && !['repair', 'hunt', 'raid', 'patrol', 'reload'].includes(ship.mode)) ||
      !finite(ship.x) ||
      !finite(ship.z) ||
      !finite(ship.yaw) ||
      !finite(ship.hp, 0, (SHIPS[ship.class] || SHIPS.missile).hp) ||
      ship.maxHp !== (SHIPS[ship.class] || SHIPS.missile).hp ||
      !['docked', 'sailing', 'station'].includes(ship.state) ||
      (ship.loaded != null && !finite(ship.loaded, 0, 8)) ||
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
    if (b.shipClass != null && !['missile', 'destroyer'].includes(b.shipClass))
      throw Error('Повреждена база флота');
  }
}
