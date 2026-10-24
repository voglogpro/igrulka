import { clamp } from '../shared/math.js';
import {
  defenseStats,
  BUILDINGS,
  GROUND_UNITS,
  WEAPONS,
  canEngageAir,
  isInfantry,
} from '../config.js';
import { event } from '../shared/events.js';
import { sensorSources, unitVisible } from '../visibility.js';
import { random } from '../shared/random.js';
import { COMBAT } from './config.js';
import { recordFire } from '../units/infantry/cover.js';
import { weatherSpread } from '../weather.js';
export function interceptPoint(origin, u, speed) {
  const rx = u.x - origin.x,
    ry = u.y - origin.y,
    rz = u.z - origin.z,
    vx = u.vx || 0,
    vy = u.vy || 0,
    vz = u.vz || 0,
    a = vx * vx + vy * vy + vz * vz - speed * speed,
    b = 2 * (rx * vx + ry * vy + rz * vz),
    c = rx * rx + ry * ry + rz * rz,
    disc = b * b - 4 * a * c;
  let t = Math.sqrt(c) / speed;
  if (disc >= 0 && Math.abs(a) > 1e-6) {
    const roots = [(-b + Math.sqrt(disc)) / (2 * a), (-b - Math.sqrt(disc)) / (2 * a)].filter(
      (n) => n > 0,
    );
    if (roots.length) t = Math.min(...roots);
  }
  t = clamp(t, 0, 2);
  return { x: u.x + vx * t, y: u.y + vy * t, z: u.z + vz * t, time: t };
}

export function defenseCycle(s, b, dt) {
  const f = s.sides[b.side],
    d = defenseStats(f, b);
  b.heat = Math.max(0, (b.heat || 0) - d.cooling * dt);
  b.cooldown = Math.max(0, (b.cooldown || 0) - dt);
  b.ammo ??= d.magazine;
  if (b.reloadLeft > 0) {
    b.reloadLeft = Math.max(0, b.reloadLeft - dt);
    if (!b.reloadLeft) b.ammo = d.magazine;
  } else if (b.ammo <= 0) {
    b.reloadLeft = d.reload;
    event(s, 'reload', { x: b.x, z: b.z, side: b.side, key: b.key });
  }
  return d;
}

// Remaining seconds before an aircraft reaches its target; the most urgent threat comes first.
const timeToImpact = (u) => (u.total - u.travelled) / (u.speed || WEAPONS[u.key]?.speed || 40);

export function fireDefenses(s, rates, dt) {
  const sensors = [sensorSources(s, 0), sensorSources(s, 1)];
  // Shared fire control: each battery sees how many others already track a target and spreads out.
  const tracked = new Map();
  for (const b of [...s.buildings, ...(s.groundUnits || [])])
    if (b.trackId != null && b.hp > 0) tracked.set(b.trackId, (tracked.get(b.trackId) || 0) + 1);
  for (const b of [...s.buildings, ...(s.groundUnits || [])]) {
    const base = BUILDINGS[b.key] || GROUND_UNITS[b.key];
    if (!base?.range || b.hp <= 0 || b.progress < 1) continue;
    const d = defenseCycle(s, b, dt);
    if (
      b.carrierId ||
      b.holdFire ||
      b.digging ||
      b.order?.mode === 'retreat' ||
      (b.key === 'mog' && (b.setup || 0) < 1)
    )
      continue;
    const missile = b.key === 'sam',
      f = s.sides[b.side],
      radar = sensors[b.side].some(
        (r) => r.kind === 'radar' && Math.hypot(r.x - b.x, r.z - b.z) < 320,
      ),
      range = d.range * (radar ? 1.2 : 1),
      abm = f.tech.includes('abm'),
      targets = s.units.filter(
        (u) =>
          u.side !== b.side &&
          u.hp > 0 &&
          u.launched &&
          unitVisible(s, b.side, u, sensors[b.side]) &&
          Math.hypot(u.x - b.x, u.z - b.z) < range &&
          canEngageAir(b.key, u.key, abm),
      );
    const score = (u) => {
      const others = (tracked.get(u.id) || 0) - (b.trackId === u.id ? 1 : 0);
      const toughness = missile ? 0 : Math.min(3, u.hp / Math.max(1, d.damage * 6));
      return (
        timeToImpact(u) +
        others * 3.5 * (u.hp / (u.maxHp || u.hp || 1)) +
        toughness +
        (Math.hypot(u.x - b.x, u.z - b.z) / range) * 2 -
        (b.trackId === u.id ? 1.5 : 0)
      );
    };
    const scored = targets.map((u) => ({ u, score: score(u) }));
    scored.sort((a, c) => a.score - c.score || a.u.id - c.u.id);
    const u = scored[0]?.u;
    if (!u) {
      if (b.trackId != null) tracked.set(b.trackId, (tracked.get(b.trackId) || 1) - 1);
      b.tracking = 0;
      b.trackId = null;
      continue;
    }
    if (b.trackId !== u.id) {
      if (b.trackId != null) tracked.set(b.trackId, (tracked.get(b.trackId) || 1) - 1);
      tracked.set(u.id, (tracked.get(u.id) || 0) + 1);
      b.trackId = u.id;
      b.tracking = 0;
    }
    u.threatAt = s.time;
    b.tracking = (b.tracking || 0) + dt;
    b.targetX = u.x;
    b.targetZ = u.z;
    b.targetY = u.y;
    if ((isInfantry(b.key) || b.key === 'gun') && (b.groundReload > 0 || b.groundAmmo <= 0))
      continue;
    if (
      b.cooldown > 0 ||
      b.reloadLeft > 0 ||
      b.ammo <= 0 ||
      f.credits < d.shotCost ||
      f.materials < d.shotMetal
    )
      continue;
    const infantry = isInfantry(b.key),
      fast = ['gun', 'shilka'].includes(b.key) || infantry,
      speed = missile ? 190 : fast ? 390 : 330,
      oy = infantry
        ? b.key === 'mog'
          ? 3.2
          : 2.4
        : b.key === 'gun'
          ? 2.5
          : GROUND_UNITS[b.key]
            ? 5
            : 8,
      origin = { x: b.x, y: oy, z: b.z },
      aim = interceptPoint(origin, u, speed),
      spread = missile
        ? 0
        : (fast ? 5 + Math.hypot(u.x - b.x, u.z - b.z) * 0.025 : 2.5) *
          (radar ? 0.75 : 1) *
          (b.tracking < 1.2 ? 1.5 : 1) *
          d.accuracy *
          weatherSpread(s) *
          (1 + Math.pow(b.heat, 2) * 3) *
          (infantry && b.key !== 'mog' ? 1.7 : 1);
    aim.x += (random(s) - 0.5) * spread * 2;
    aim.y += (random(s) - 0.5) * spread * 1.2;
    aim.z += (random(s) - 0.5) * spread * 2;
    if (!missile) aim.y += 0.5 * COMBAT.gravity * aim.time * aim.time;
    b.targetX = aim.x;
    b.targetZ = aim.z;
    b.targetY = aim.y;
    const dx = aim.x - b.x,
      dy = aim.y - oy,
      dz = aim.z - b.z,
      length = Math.hypot(dx, dy, dz) || 1;
    f.credits -= d.shotCost;
    f.materials -= d.shotMetal;
    f.spentAmmo += d.shotCost;
    b.cooldown =
      (d.cooldown * (b.heat > 0.9 ? 1.6 : 1)) /
      (GROUND_UNITS[b.key] ? 1 : rates[b.side].productivity);
    if (isInfantry(b.key) || b.key === 'gun') b.groundAmmo--;
    else b.ammo--;
    b.heat = Math.min(1.5, b.heat + d.heatPerShot);
    b.lastSpread = spread;
    const muzzleLength =
        infantry && b.key !== 'mog'
          ? 2
          : ['gun', 'mog'].includes(b.key)
            ? 6
            : missile
              ? 7
              : fast
                ? 9
                : 14,
      sideOffset = ((b.rounds || 0) % 2 ? 1 : -1) * (fast ? 0.8 : 1.2),
      horizontal = Math.hypot(dx, dz) || 1,
      mx = b.x + (dx / length) * muzzleLength - (dz / horizontal) * sideOffset,
      my = oy + (dy / length) * muzzleLength,
      mz = b.z + (dz / length) * muzzleLength + (dx / horizontal) * sideOffset;
    b.rounds = (b.rounds || 0) + 1;
    if (infantry) recordFire(s, b, random);
    s.projectiles.push({
      sourceId: b.id,
      abm,
      gravity: missile ? 0 : COMBAT.gravity,
      tracer: missile || !fast || b.rounds % 3 === 0,
      id: s.nextId++,
      side: b.side,
      source: b.id,
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
      damage: d.damage * (abm ? 1.15 : 1),
      kind: missile ? 'interceptor' : fast ? 'bullet' : 'shell',
      life: 0,
      maxLife: missile ? 5 : Math.min(2, range / speed + 0.6),
    });
    s.stats.shots++;
    event(s, 'shot', {
      x: b.x,
      y: oy,
      z: b.z,
      side: b.side,
      key: missile ? 'sam' : fast ? 'gun' : 'cannon',
      shooter: b.key,
      buildingId: b.id,
      mx,
      my,
      mz,
      tx: aim.x,
      ty: aim.y,
      tz: aim.z,
    });
  }
}
