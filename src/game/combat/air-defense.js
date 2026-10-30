import { hostile, sideIds } from '../factions.js';
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
import { radarFireSupport } from './radar-support.js';
import { weatherSpread } from '../weather.js';
import {
  initializeAmmunition,
  reloadFromReserve,
  ammunitionProfile,
} from '../units/ground/ammunition.js';
import { isMogDefense } from './upgrade-tiers.js';
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
  // Preserve the fractional part of the MOG's firing interval. Clamping it
  // away made .06 and .0536 both fire every .10 s, then .048 jump to .05 s.
  d.cadenceRemainder = b.cooldown > 0 ? b.cooldown - dt : 0;
  b.cooldown = Math.max(0, (b.cooldown || 0) - dt);
  initializeAmmunition(b);
  if (ammunitionProfile(b)?.shared) {
    b.ammo = b.groundAmmo;
    return d;
  }
  b.ammo ??= d.magazine;
  if (b.reloadLeft > 0) {
    b.reloadLeft = Math.max(0, b.reloadLeft - dt);
    if (!b.reloadLeft) b.ammo = reloadFromReserve(b);
  } else if (b.ammo <= 0 && b.ammoReserve > 0) {
    b.reloadLeft = d.reload;
    event(s, 'reload', { x: b.x, z: b.z, side: b.side, key: b.key });
  }
  return d;
}

// Remaining seconds before an aircraft reaches its target; the most urgent threat comes first.
const timeToImpact = (u) => (u.total - u.travelled) / (u.speed || WEAPONS[u.key]?.speed || 40);

export function fireDefenses(s, rates, dt) {
  const owners = sideIds(s),
    sensors = owners.map((side) => sensorSources(s, side)),
    defenders = [...s.buildings, ...(s.groundUnits || [])],
    threats = owners.map((side) =>
      s.units.filter(
        (u) =>
          hostile(s, u.side, side) &&
          u.hp > 0 &&
          u.launched &&
          unitVisible(s, side, u, sensors[side]),
      ),
    );
  // Shared fire control: each battery sees how many others already track a target and spreads out.
  const tracked = new Map();
  for (const b of defenders)
    if (b.trackId != null && b.hp > 0) tracked.set(b.trackId, (tracked.get(b.trackId) || 0) + 1);
  for (const b of defenders) {
    const base = BUILDINGS[b.key] || GROUND_UNITS[b.key];
    if (!base?.range || b.hp <= 0 || b.progress < 1) continue;
    const d = defenseCycle(s, b, dt);
    if (b.carrierId || b.holdFire || b.digging || b.order?.mode === 'retreat') continue;
    const missile = b.key === 'sam',
      f = s.sides[b.side],
      radar = radarFireSupport(s, b.side, b.x, b.z, sensors[b.side]),
      range = d.range * radar.rangeMultiplier,
      abm = missile;
    let u = null,
      bestScore = Infinity;
    for (const candidate of threats[b.side]) {
      // Most aircraft are far from this city. Avoid allocating/sorting a target
      // array for every rifleman and reuse the exact original distance score.
      if (
        Math.abs(candidate.x - b.x) >= range ||
        Math.abs(candidate.z - b.z) >= range ||
        !canEngageAir(b.key, candidate.key, abm)
      )
        continue;
      const distance = Math.hypot(candidate.x - b.x, candidate.z - b.z);
      // A low-signature missile is noticed only at a fraction of the battery's reach.
      if (distance >= range * (WEAPONS[candidate.key]?.signature ?? 1)) continue;
      const others = (tracked.get(candidate.id) || 0) - (b.trackId === candidate.id ? 1 : 0),
        toughness = missile ? 0 : Math.min(3, candidate.hp / Math.max(1, d.damage * 6)),
        score =
          timeToImpact(candidate) +
          others * 3.5 * (candidate.hp / (candidate.maxHp || candidate.hp || 1)) +
          toughness +
          (distance / range) * 2 -
          (b.trackId === candidate.id ? 1.5 : 0);
      if (!u || score < bestScore || (!(score - bestScore) && candidate.id < u.id)) {
        u = candidate;
        bestScore = score;
      }
    }
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
    b.airThreatAt = s.time;
    if (b.key === 'mog' && (b.setup || 0) < 1) continue;
    b.tracking = (b.tracking || 0) + dt;
    b.targetX = u.x;
    b.targetZ = u.z;
    b.targetY = u.y;
    if ((isInfantry(b.key) || b.key === 'gun') && (b.groundReload > 0 || b.groundAmmo <= 0))
      continue;
    if (b.cooldown > 0 || b.reloadLeft > 0 || b.ammo <= 0) continue;
    const sustained = isMogDefense(b);
    let cadence = sustained ? d.cadenceRemainder : 0;
    // At the bounded .1 s simulation step even the final tier needs at most
    // three real rounds. Never create a catch-up storm after an idle period.
    for (let shot = 0; shot < (sustained ? 3 : 1) && cadence <= 0; shot++) {
      if (sustained && b.groundAmmo <= 0) break;
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
            radar.spreadMultiplier *
            (b.tracking < 1.2 ? 1.5 : 1) *
            d.accuracy *
            weatherSpread(s) *
            (1 + Math.pow(b.heat, 2) * 3) *
            (infantry && !['mog', 'machinegunner'].includes(b.key) ? 1.7 : 1);
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
      f.spentAmmo += d.shotCost;
      cadence +=
        (d.cooldown * (b.heat > 0.9 ? 1.6 : 1)) /
        (GROUND_UNITS[b.key] ? 1 : rates[b.side].productivity);
      b.cooldown = Math.max(0, cadence);
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
        damage: d.damage,
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
}
