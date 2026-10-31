import { weaponFamily } from './weapons.config.js';
import { hostile, sideIds } from '../../factions.js';
import { event } from '../../shared/events.js';
import { random } from '../../shared/random.js';
import { riverDistance, BUILDINGS, WEAPONS, MAP, groundHeight } from '../../config.js';
import { COMBAT } from '../../combat/config.js';
import { applyBlast } from '../../combat/damage.js';
import { clamp } from '../../shared/math.js';
import { pointOnRoute } from './routes.js';
import { fogVisible } from '../../vision-grid.js';
import { guidedFPVPosition } from './guided-fpv.js';
export function damageAircraft(s, u, damage, attacker) {
  if (u.hp <= 0) return false;
  u.hp -= damage;
  event(s, 'hit', { x: u.x, y: u.y, z: u.z, side: attacker, key: u.key });
  if (u.hp > 0) return false;
  u.hp = 0;
  s.sides[attacker].kills++;
  s.stats.interceptions++;
  // A drone hit by fire can tumble down and burst on the ground. A missile hit by an interceptor
  // breaks up in the air: its warhead never reaches the ground as lethal debris.
  const falling = WEAPONS[u.key]?.family === 'drone' && random(s) < 0.65 && u.y > 6;
  u.status = falling ? 'falling' : 'airburst';
  u.missingWing = random(s) < 0.5 ? -1 : 1;
  u.fallAge = 0;
  u.spin = (random(s) * 2 + 1) * u.missingWing;
  u.vx = (u.vx || 0) * 0.75;
  u.vy = Math.min(2, u.vy || 0) - 4;
  u.vz = (u.vz || 0) * 0.75;
  if (!falling) s.stats.airbursts++;
  event(s, 'intercept', {
    x: u.x,
    y: u.y,
    z: u.z,
    key: u.key,
    side: attacker,
    unitId: u.id,
    mode: falling ? 'fall' : 'burst',
    vx: u.vx,
    vy: u.vy,
    vz: u.vz,
  });
  return true;
}

export function collisionHeight(s, x, z) {
  let height = riverDistance(x, z) < MAP.riverWidth ? -2.5 : groundHeight(x, z);
  for (const b of s.buildings)
    if (
      !b.demolished &&
      Math.abs(x - b.x) < (BUILDINGS[b.key]?.size || 30) * 0.55 &&
      Math.abs(z - b.z) < (BUILDINGS[b.key]?.size || 30) * 0.55
    )
      height = Math.max(height, b.hp > 0 ? (BUILDINGS[b.key]?.height || 13) * b.progress : 2);
  return height;
}

export function routePoint(origin, target, key, t, phase = 0, landing = false) {
  const d = WEAPONS[key],
    dx = target.x - origin.x,
    dz = target.z - origin.z,
    total = Math.max(1, Math.hypot(dx, dz)),
    travelled = total * t;
  const wave =
    Math.sin(phase + travelled * 0.031) *
    Math.sin(Math.PI * t) *
    (key === 'heavy' ? 5 : key === 'drone' ? 8 : 1.5);
  return {
    x: origin.x + dx * t - (dz / total) * wave,
    z: origin.z + dz * t + (dx / total) * wave,
    y:
      weaponFamily(key) === 'ballistic'
        ? 5 + Math.sin(t * Math.PI) * d.altitude
        : Math.min(d.altitude, 5 + travelled * 0.48, 5 + (total - travelled) * 0.48),
  };
}

export function basePosition(u, travelled) {
  const pos = routePoint(
    { x: u.startX, z: u.startZ },
    { x: u.tx, z: u.tz },
    u.key,
    clamp(travelled / u.total, 0, 1),
    u.phase,
  );
  if (u.route?.length) {
    const p = pointOnRoute(u.route, Math.min(travelled, u.total));
    pos.x = p.x;
    pos.z = p.z;
    if (weaponFamily(u.key) !== 'ballistic')
      pos.y = Math.min(
        u.altitude || WEAPONS[u.key].altitude,
        5 + travelled * 0.48,
        5 + Math.max(0, u.total - travelled) * 0.48,
      );
  }
  return pos;
}

// A launch is heard across the valley even when the enemy cannot see it: a contact marks the area.
function hearLaunch(s, u) {
  s.contacts ||= sideIds(s).map(() => []);
  for (const other of sideIds(s)) {
    if (!hostile(s, other, u.side) || fogVisible(s, other, u.x, u.z)) continue;
    s.contacts[other] ||= [];
    s.contacts[other].push({
      unitId: -u.id,
      x: u.x + (random(s) - 0.5) * 90,
      z: u.z + (random(s) - 0.5) * 90,
      radius: 55,
      expires: s.time + 9,
      time: s.time,
    });
    if (s.contacts[other].length > 80) s.contacts[other].shift();
  }
}

export function moveUnits(s, dt) {
  for (const u of s.units) {
    u.prevX = u.x;
    u.prevY = u.y;
    u.prevZ = u.z;
    if (u.status === 'falling') {
      u.fallAge += dt;
      const drag = Math.exp(-0.3 * dt);
      u.vx *= drag;
      u.vz *= drag;
      u.vy -= COMBAT.fallGravity * dt;
      u.x += u.vx * dt;
      u.y += u.vy * dt;
      u.z += u.vz * dt;
      const ground = collisionHeight(s, u.x, u.z);
      if (u.y <= ground || u.fallAge > 10) {
        u.y = ground;
        u.status = 'crashed';
        const d = WEAPONS[u.key],
          blast = u.blast || d.blast;
        applyBlast(s, u.x, u.z, (u.damage || d.damage) * 0.65, blast * 0.8);
        s.stats.crashes++;
        event(s, 'crash', {
          x: u.x,
          y: ground,
          z: u.z,
          key: u.key,
          side: u.side,
          radius: blast * 0.8,
        });
      }
      continue;
    }
    if (u.hp <= 0) continue;
    if (
      !u.launched &&
      u.sourceId &&
      !s.buildings.some((b) => b.id === u.sourceId && b.hp > 0 && !b.demolished)
    ) {
      // Locally reserved craft are lost with their destroyed rack; old global
      // reservations keep their historical refund path during migration.
      if (!u.localLaunch) s.sides[u.side].inventory[u.key]++;
      u.hp = 0;
      u.status = 'cancelled';
      continue;
    }
    u.delay = Math.max(0, (u.delay || 0) - dt);
    if (u.delay > 0) continue;
    if (!u.launched) {
      u.launched = true;
      hearLaunch(s, u);
      event(s, 'launch', {
        side: u.side,
        key: u.key,
        x: u.x,
        y: u.y,
        z: u.z,
        sourceId: u.sourceId,
      });
    }
    let pos = guidedFPVPosition(s, u, dt);
    if (!pos) {
      u.travelled += (u.speed || WEAPONS[u.key].speed) * (u.hp / u.maxHp < 0.4 ? 0.85 : 1) * dt;
      pos = basePosition(u, u.travelled);
      evade(s, u, pos, basePosition(u, Math.max(0, u.travelled - 2)), dt);
    }
    if (u.flightHeightOffset) {
      pos.y += u.flightHeightOffset;
      u.flightHeightOffset *= Math.exp(-1.5 * dt);
      if (Math.abs(u.flightHeightOffset) < 0.001) u.flightHeightOffset = 0;
    }
    u.vx = (pos.x - u.x) / dt;
    u.vy = (pos.y - u.y) / dt;
    u.vz = (pos.z - u.z) / dt;
    Object.assign(u, pos);
  }
}

// Drones locked by air defence weave and change altitude, so lead computed from the current
// velocity misses more often. The weave fades out near the target to keep the strike point.
export const EVASION = { drone: { side: 9, lift: 4 }, heavy: { side: 5, lift: 2.5 } };
function evade(s, u, pos, behind, dt) {
  const profile = EVASION[u.key];
  if (!profile) return;
  const threatened = s.time - (u.threatAt ?? -Infinity) < 1.5;
  u.evade = clamp((u.evade || 0) + (threatened ? 1.4 : -0.7) * dt, 0, 1);
  if (!u.evade) return;
  const remaining = Math.max(0, u.total - u.travelled),
    fade = clamp((remaining - 25) / 70, 0, 1) * clamp(u.travelled / 50, 0, 1),
    weight = u.evade * fade * (u.subtype === 'fpv' ? 0.5 : 1);
  if (!weight) return;
  const hx = pos.x - behind.x,
    hz = pos.z - behind.z,
    heading = Math.hypot(hx, hz) || 1,
    phase = u.phase || 0,
    swing = Math.sin(s.time * 1.9 + phase * 3.1) + 0.45 * Math.sin(s.time * 4.3 + phase),
    lateral = swing * profile.side * weight;
  pos.x += (-hz / heading) * lateral;
  pos.z += (hx / heading) * lateral;
  pos.y = Math.max(6, pos.y + Math.sin(s.time * 2.6 + phase * 1.7) * profile.lift * weight);
}

export function impacts(s) {
  for (const u of s.units)
    if (u.hp > 0 && u.status !== 'falling' && u.delay <= 0 && u.travelled >= u.total) {
      u.hp = 0;
      s.stats.impacts++;
      const d = WEAPONS[u.key],
        blast = u.blast || d.blast;
      applyBlast(s, u.tx, u.tz, u.damage || d.damage, blast);
      event(s, 'impact', {
        x: u.tx,
        z: u.tz,
        y: 2,
        key: u.subtype || u.key,
        side: u.side,
        radius: blast,
      });
    }
}
