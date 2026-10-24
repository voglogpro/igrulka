import { clamp } from '../shared/math.js';
import { impactGround, gainGroundExperience } from '../units/ground/index.js';
import { event } from '../shared/events.js';
import { unitVisible } from '../visibility.js';
import { interceptPoint } from './air-defense.js';
import { damageAircraft } from '../units/aviation/flight.js';
export function closestRelativeDistance(p, u) {
  const ax = p.px - u.prevX,
    ay = p.py - u.prevY,
    az = p.pz - u.prevZ,
    bx = p.x - u.x,
    by = p.y - u.y,
    bz = p.z - u.z,
    dx = bx - ax,
    dy = by - ay,
    dz = bz - az,
    t = clamp(-(ax * dx + ay * dy + az * dz) / (dx * dx + dy * dy + dz * dz || 1), 0, 1);
  return Math.hypot(ax + dx * t, ay + dy * t, az + dz * t);
}

export function moveProjectiles(s, dt) {
  for (const p of s.projectiles) {
    p.life += dt;
    p.px = p.x;
    p.py = p.y;
    p.pz = p.z;
    if (p.domain === 'ground') {
      const travel = Math.min(dt, Math.max(0, p.flight - (p.life - dt)));
      p.x += p.vx * travel;
      p.z += p.vz * travel;
      const peak = p.arc || p.loft;
      if (peak) {
        // Height follows a parabola over the flight; vy is kept for tracers. Artillery lobs high
        // (arc); bullets and tank rounds rise a little and drop onto the target (loft).
        const k = Math.min(1, p.life / p.flight),
          from = p.originY ?? 6,
          to = p.endY ?? 2;
        p.y = from * (1 - k) + to * k + 4 * peak * k * (1 - k);
        p.vy = (4 * peak * (1 - 2 * k) + to - from) / p.flight;
      } else if (p.gravity != null) {
        // Rounds saved by 8.5 builds that used plain gravity for direct fire.
        p.y += p.vy * travel - 0.5 * p.gravity * travel * travel;
        p.vy -= p.gravity * travel;
      }
      if (p.life >= p.flight) {
        p.x = p.tx;
        p.z = p.tz;
        p.dead = true;
        impactGround(s, p, event);
      }
      continue;
    }
    if (p.kind === 'interceptor') {
      const u = s.units.find((u) => u.id === p.targetId && u.hp > 0);
      if (u && unitVisible(s, p.side, u)) {
        const a = interceptPoint(p, u, p.speed),
          dx = a.x - p.x,
          dy = a.y - p.y,
          dz = a.z - p.z,
          length = Math.hypot(dx, dy, dz) || 1,
          blend = Math.min(1, dt * 2.4);
        p.vx += ((dx / length) * p.speed - p.vx) * blend;
        p.vy += ((dy / length) * p.speed - p.vy) * blend;
        p.vz += ((dz / length) * p.speed - p.vz) * blend;
        const v = Math.hypot(p.vx, p.vy, p.vz) || 1;
        p.vx = (p.vx / v) * p.speed;
        p.vy = (p.vy / v) * p.speed;
        p.vz = (p.vz / v) * p.speed;
      }
    }
    p.x += p.vx * dt;
    p.y += p.vy * dt - 0.5 * (p.gravity || 0) * dt * dt;
    p.vy -= (p.gravity || 0) * dt;
    p.z += p.vz * dt;
    const radius = p.kind === 'bullet' ? 2.6 : p.kind === 'shell' ? 5 : 4;
    for (const u of s.units)
      if (
        u.side !== p.side &&
        u.hp > 0 &&
        u.delay <= 0 &&
        ((p.kind === 'interceptor' &&
          (u.key !== 'ballistic' || (p.abm ?? s.sides[p.side].tech.includes('abm')))) ||
          u.key === 'drone' ||
          u.key === 'heavy') &&
        closestRelativeDistance(p, u) < radius
      ) {
        p.dead = true;
        s.stats.hits++;
        const before = u.hp;
        damageAircraft(s, u, p.damage, p.side);
        gainGroundExperience(s, p.sourceId, Math.max(0, before - u.hp), u.hp <= 0);
        break;
      }
    if (!p.dead && (p.life > p.maxLife || p.y < 0)) {
      p.dead = true;
      s.stats.misses++;
    }
  }
}
