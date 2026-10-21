import { event } from '../../shared/events.js';
import { random } from '../../shared/random.js';
import { riverDistance, BUILDINGS, WEAPONS } from '../../config.js';
import { COMBAT } from '../../combat/config.js';
import { applyBlast } from '../../combat/damage.js';
import { clamp } from '../../shared/math.js';
import { pointOnRoute } from './routes.js';
export function damageAircraft(s, u, damage, attacker) {
  if (u.hp <= 0) return false;
  u.hp -= damage;
  event(s, 'hit', { x: u.x, y: u.y, z: u.z, side: attacker, key: u.key });
  if (u.hp > 0) return false;
  u.hp = 0;
  s.sides[attacker].kills++;
  s.stats.interceptions++;
  const falling = random(s) < 0.65 && u.y > 6;
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
  let height = riverDistance(x, z) < 65 ? -2.5 : 0;
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
      key === 'ballistic'
        ? 5 + Math.sin(t * Math.PI) * d.altitude
        : Math.min(d.altitude, 5 + travelled * 0.48, 5 + (total - travelled) * 0.48),
  };
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
      s.sides[u.side].inventory[u.key]++;
      u.hp = 0;
      u.status = 'cancelled';
      continue;
    }
    u.delay = Math.max(0, (u.delay || 0) - dt);
    if (u.delay > 0) continue;
    if (!u.launched) {
      u.launched = true;
      event(s, 'launch', {
        side: u.side,
        key: u.key,
        x: u.x,
        y: u.y,
        z: u.z,
        sourceId: u.sourceId,
      });
    }
    u.travelled += (u.speed || WEAPONS[u.key].speed) * (u.hp / u.maxHp < 0.4 ? 0.85 : 1) * dt;
    const pos = routePoint(
      { x: u.startX, z: u.startZ },
      { x: u.tx, z: u.tz },
      u.key,
      clamp(u.travelled / u.total, 0, 1),
      u.phase,
    );
    if (u.route?.length) {
      const p = pointOnRoute(u.route, Math.min(u.travelled, u.total));
      pos.x = p.x;
      pos.z = p.z;
      if (u.key !== 'ballistic')
        pos.y = Math.min(
          u.altitude || WEAPONS[u.key].altitude,
          5 + u.travelled * 0.48,
          5 + Math.max(0, u.total - u.travelled) * 0.48,
        );
    }
    u.vx = (pos.x - u.x) / dt;
    u.vy = (pos.y - u.y) / dt;
    u.vz = (pos.z - u.z) / dt;
    Object.assign(u, pos);
  }
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
