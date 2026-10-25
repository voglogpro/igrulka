import { hostile } from '../../factions.js';
import { GROUND_UNITS, BUILDINGS, isInfantry } from '../../config.js';
import { groundVisible, lineOfSight } from '../infantry/cover.js';
import { equipmentModifiers } from '../../combat/upgrade-tiers.js';

export const ENGAGEMENT_CADENCE = 0.3;
export const ENGAGEMENT_LOS_BUDGET = 8;
export const ENGAGEMENT_CELL = 96;
const states = new WeakMap();
const profiles = {
  rifle: {
    id: 'rifle',
    kind: 'bullet',
    speed: 270,
    cost: 0.025,
    spread: 3,
    canBlind: true,
    stationary: false,
    suppressionLimit: Infinity,
  },
  machinegun: {
    id: 'machinegun',
    kind: 'bullet',
    speed: 270,
    cost: 0.025,
    spread: 3,
    canBlind: true,
    stationary: false,
    suppressionLimit: Infinity,
  },
  sniper: {
    id: 'sniper',
    kind: 'bullet',
    speed: 300,
    cost: 0.08,
    spread: 1,
    canBlind: false,
    stationary: false,
    suppressionLimit: Infinity,
  },
  cannon: {
    id: 'cannon',
    kind: 'shell',
    speed: 180,
    cost: 0.8,
    spread: 3,
    canBlind: true,
    stationary: false,
    suppressionLimit: Infinity,
  },
  autocannon: {
    id: 'autocannon',
    kind: 'bullet',
    speed: 240,
    cost: 0.12,
    spread: 2.6,
    canBlind: true,
    stationary: false,
    suppressionLimit: Infinity,
  },
  rocket: {
    id: 'rocket',
    kind: 'shell',
    speed: 125,
    cost: 2.5,
    spread: 17,
    canBlind: true,
    stationary: true,
    suppressionLimit: Infinity,
    indirect: true,
  },
  artillery: {
    id: 'artillery',
    kind: 'shell',
    speed: 140,
    cost: 3,
    spread: 14,
    canBlind: true,
    stationary: true,
    suppressionLimit: Infinity,
    // Indirect fire: needs a spotted target, not a clear line from the gun.
    indirect: true,
  },
  antiArmor: {
    id: 'antiArmor',
    kind: 'shell',
    speed: 150,
    cost: 2,
    spread: 1.3,
    canBlind: false,
    stationary: true,
    suppressionLimit: 0.8,
  },
  antiTankRifle: {
    id: 'antiTankRifle',
    kind: 'bullet',
    speed: 360,
    cost: 0.35,
    spread: 1.5,
    canBlind: false,
    stationary: true,
    suppressionLimit: 0.8,
  },
};

export function groundWeaponProfile(key) {
  const configured = GROUND_UNITS[key]?.groundWeapon;
  if (Object.hasOwn(profiles, configured)) return profiles[configured];
  if (key === 'leopard') return profiles.cannon;
  if (key === 'sniper') return profiles.sniper;
  if (['machinegunner', 'mog', 'apc', 'gun'].includes(key)) return profiles.machinegun;
  return profiles.rifle;
}

export function canGroundFire(u) {
  const profile = groundWeaponProfile(u.key);
  return (!profile.stationary || !u.moving) && (u.suppression || 0) < profile.suppressionLimit;
}

export function groundAimPoint(shooter, target, projectileSpeed, s = null) {
  let next = target.path?.[0];
  const d = GROUND_UNITS[target.key];
  if (!next || !d) return { x: target.x, z: target.z };
  if (!target.holdFire && ['attack', 'attackmove'].includes(target.order?.mode)) {
    const id = target.enemyId ?? target.order.targetId;
    const enemy = id === shooter.id ? shooter : s ? prepareGroundEngagement(s).ids.get(id) : null;
    if (enemy?.hp > 0 && Math.hypot(enemy.x - target.x, enemy.z - target.z) <= (d.groundRange || 0))
      next = null;
  }
  if (!next) return { x: target.x, z: target.z };
  const length = Math.hypot(next.x - target.x, next.z - target.z);
  const slow =
    target.order?.mode === 'retreat'
      ? 1.3
      : target.suppression > 0.8
        ? 0.3
        : target.suppression > 0.45
          ? 0.65
          : 1;
  const speed = d.speed * slow * (target.hp / target.maxHp < 0.3 ? 0.75 : 1);
  let time = Math.hypot(target.x - shooter.x, target.z - shooter.z) / projectileSpeed;
  let point = { x: target.x, z: target.z };
  for (let i = 0; i < 3; i++) {
    const travel = Math.min(length, speed * time);
    point = {
      x: target.x + ((next.x - target.x) / (length || 1)) * travel,
      z: target.z + ((next.z - target.z) / (length || 1)) * travel,
    };
    time = Math.hypot(point.x - shooter.x, point.z - shooter.z) / projectileSpeed;
  }
  return point;
}

export function groundArmorClass(u) {
  if (isInfantry(u.key)) return 'infantry';
  if (!GROUND_UNITS[u.key]) return 'building';
  return GROUND_UNITS[u.key].groundArmor || (u.key === 'leopard' ? 'heavy' : 'light');
}

export function groundDamageMultiplier(shooterKey, target, kind = 'bullet') {
  const profile =
    GROUND_UNITS[shooterKey] || shooterKey === 'gun'
      ? groundWeaponProfile(shooterKey).id
      : kind === 'shell'
        ? 'cannon'
        : 'rifle';
  const armor = groundArmorClass(target);
  const values = {
    rifle: { infantry: 1, light: 0.3, heavy: 0.025, building: isInfantry(shooterKey) ? 1.2 : 1 },
    machinegun: {
      infantry: 1,
      light: 0.34,
      heavy: 0.035,
      building: isInfantry(shooterKey) ? 1.2 : 1,
    },
    sniper: { infantry: 1, light: 0.08, heavy: 0.01, building: 0.45 },
    cannon: { infantry: 1, light: 1.1, heavy: 1, building: 1 },
    antiArmor: { infantry: 0.045, light: 1.1, heavy: 1.25, building: 0.18 },
    antiTankRifle: { infantry: 0.22, light: 1.05, heavy: 0.5, building: 0.12 },
    artillery: { infantry: 0.9, light: 0.6, heavy: 0.3, building: 1.1 },
    autocannon: { infantry: 1, light: 0.85, heavy: 0.1, building: 0.7 },
    rocket: { infantry: 0.85, light: 0.6, heavy: 0.25, building: 1 },
  };
  return values[profile][armor];
}

function stateCache(s) {
  let cache = states.get(s);
  if (!cache) {
    cache = {
      time: -1,
      revision: -1,
      unitCount: -1,
      buildingCount: -1,
      los: new Map(),
      metrics: {
        indexBuilds: 0,
        searches: 0,
        candidates: 0,
        lineTests: 0,
        visibilityTests: 0,
        lineCacheHits: 0,
      },
    };
    states.set(s, cache);
  }
  return cache;
}

export function groundEngagementMetrics(s) {
  return { ...stateCache(s).metrics };
}

export function prepareGroundEngagement(s) {
  const cache = stateCache(s);
  if (
    !s.groundUnits.length &&
    !s.buildings.some((b) => b.key === 'gun' && b.hp > 0 && b.progress >= 1)
  )
    return cache;
  if (
    cache.time === s.time &&
    cache.revision === s.networkRevision &&
    cache.unitCount === s.groundUnits.length &&
    cache.buildingCount === s.buildings.length
  )
    return cache;
  cache.time = s.time;
  cache.revision = s.networkRevision;
  cache.unitCount = s.groundUnits.length;
  cache.buildingCount = s.buildings.length;
  cache.buckets = new Map();
  cache.ids = new Map();
  cache.visible = new Map();
  cache.pending = new Map();
  cache.metrics.indexBuilds++;
  for (const u of [...s.groundUnits, ...s.buildings]) {
    if (u.hp <= 0 || u.carrierId || u.demolished || u.progress < 1) continue;
    cache.ids.set(u.id, u);
    const cell = `${Math.floor(u.x / ENGAGEMENT_CELL)},${Math.floor(u.z / ENGAGEMENT_CELL)}`;
    if (!cache.buckets.has(cell)) cache.buckets.set(cell, []);
    cache.buckets.get(cell).push(u);
  }
  // Damage already in flight lets slow, expensive weapons avoid overkill on a doomed target.
  for (const p of s.projectiles || []) {
    if (p.domain !== 'ground' || p.dead || p.targetId == null) continue;
    const target = cache.ids.get(p.targetId);
    if (target)
      cache.pending.set(
        p.targetId,
        (cache.pending.get(p.targetId) || 0) +
          p.damage * groundDamageMultiplier(p.shooterKey, target, p.kind),
      );
  }
  // Retain only a bounded recent set instead of keeping pairs for destroyed armies forever.
  if (cache.los.size > 4096) cache.los.clear();
  return cache;
}

function visible(s, cache, side, target) {
  const key = `${side}:${target.id}`;
  if (!cache.visible.has(key)) {
    cache.metrics.visibilityTests++;
    cache.visible.set(key, groundVisible(s, side, target));
  }
  return cache.visible.get(key);
}

function clearLine(s, cache, u, target) {
  const key = `${u.id}:${target.id}`;
  const previous = cache.los.get(key);
  if (
    previous &&
    previous.revision === s.networkRevision &&
    s.time - previous.time < ENGAGEMENT_CADENCE &&
    Math.hypot(previous.ax - u.x, previous.az - u.z) < 3 &&
    Math.hypot(previous.bx - target.x, previous.bz - target.z) < 3
  ) {
    cache.metrics.lineCacheHits++;
    return previous.value;
  }
  cache.metrics.lineTests++;
  const value = lineOfSight(s, u, target);
  cache.los.set(key, {
    time: s.time,
    revision: s.networkRevision,
    ax: u.x,
    az: u.z,
    bx: target.x,
    bz: target.z,
    value,
  });
  return value;
}

function inRange(s, u, target, range, minRange = 0) {
  return (
    target &&
    (target.x - u.x) ** 2 + (target.z - u.z) ** 2 >= minRange * minRange &&
    hostile(s, target.side, u.side) &&
    target.hp > 0 &&
    !target.carrierId &&
    !target.downed &&
    (!target.civil || u.order?.targetId === target.id) &&
    !target.demolished &&
    target.progress >= 1 &&
    (target.x - u.x) ** 2 + (target.z - u.z) ** 2 <= range * range
  );
}

function rank(u, target, range, cache) {
  if (target.id === u.order?.targetId) return 10000;
  if (target.id === u.guardTargetId) return 5000;
  const armor = groundArmorClass(target);
  const profile = groundWeaponProfile(u.key).id;
  let priority;
  if (profile === 'artillery' || profile === 'rocket') {
    priority = armor === 'heavy' ? 95 : armor === 'light' ? 115 : armor === 'infantry' ? 110 : 105;
    // Shells are area weapons: prefer targets standing among other enemies.
    const cell = cache?.buckets?.get(
      `${Math.floor(target.x / ENGAGEMENT_CELL)},${Math.floor(target.z / ENGAGEMENT_CELL)}`,
    );
    for (const other of cell || [])
      if (
        other !== target &&
        other.side === target.side &&
        (other.x - target.x) ** 2 + (other.z - target.z) ** 2 < 400
      )
        priority += 12;
  } else if (profile === 'antiArmor' || profile === 'antiTankRifle')
    priority = armor === 'heavy' ? 300 : armor === 'light' ? 260 : armor === 'infantry' ? 20 : 10;
  else if (profile === 'autocannon')
    priority =
      armor === 'light'
        ? 140
        : armor === 'infantry'
          ? target.key === 'atgm'
            ? 150
            : 125
          : armor === 'heavy'
            ? 15
            : 40;
  else if (profile === 'cannon')
    priority =
      armor === 'heavy'
        ? 150
        : armor === 'light'
          ? 130
          : armor === 'infantry'
            ? target.key === 'atgm'
              ? 165
              : 90
            : 50;
  else
    priority =
      armor === 'infantry'
        ? target.key === 'atgm'
          ? 150
          : 130
        : armor === 'light'
          ? 45
          : armor === 'heavy'
            ? 5
            : 20;
  const health = target.maxHp > 0 ? Math.max(0, target.hp / target.maxHp) : 1;
  const pending = cache?.pending?.get(target.id) || 0;
  return (
    priority -
    (Math.hypot(target.x - u.x, target.z - u.z) / range) * 35 +
    (target.id === u.enemyId ? 8 : 0) +
    // Finish wounded enemies, answer whoever is shooting at us, skip targets already doomed.
    (1 - health) * 28 +
    (target.enemyId === u.id ? 14 : 0) -
    (pending >= target.hp ? 70 : 0)
  );
}

export function groundEngagement(s, u) {
  const config = GROUND_UNITS[u.key] || BUILDINGS[u.key],
    range = (config?.groundRange || 0) * equipmentModifiers(u).range,
    minRange = config?.groundMinRange || 0,
    indirect = groundWeaponProfile(u.key).indirect;
  if (!range || u.holdFire || u.digging || u.order?.mode === 'retreat' || u.carrierId) {
    u.enemyId = null;
    u.nextThink = 0;
    return { target: null, stopToFight: false };
  }
  const cache = prepareGroundEngagement(s);
  let target = cache.ids.get(u.enemyId);
  const valid =
    inRange(s, u, target, range, minRange) &&
    visible(s, cache, u.side, target) &&
    (indirect || clearLine(s, cache, u, target));
  if (!valid) target = null;
  if ((u.nextThink || 0) <= s.time) {
    cache.metrics.searches++;
    const candidates = [];
    const margin = range + 4;
    for (
      let z = Math.floor((u.z - margin) / ENGAGEMENT_CELL);
      z <= Math.floor((u.z + margin) / ENGAGEMENT_CELL);
      z++
    )
      for (
        let x = Math.floor((u.x - margin) / ENGAGEMENT_CELL);
        x <= Math.floor((u.x + margin) / ENGAGEMENT_CELL);
        x++
      )
        for (const t of cache.buckets.get(`${x},${z}`) || [])
          if (inRange(s, u, t, range, minRange))
            candidates.push({ unit: t, score: rank(u, t, range, cache) });
    cache.metrics.candidates += candidates.length;
    candidates.sort((a, b) => b.score - a.score || a.unit.id - b.unit.id);
    const head = candidates.slice(0, 2);
    const tail = candidates.slice(2);
    const width = ENGAGEMENT_LOS_BUDGET - head.length;
    const batches = Math.max(1, Math.ceil(tail.length / width));
    const offset = (Math.floor(s.time / ENGAGEMENT_CADENCE) % batches) * width;
    for (const entry of [...head, ...tail.slice(offset, offset + width)]) {
      const candidate = entry.unit;
      if (
        !visible(s, cache, u.side, candidate) ||
        (!indirect && !clearLine(s, cache, u, candidate))
      )
        continue;
      if (!target || rank(u, candidate, range, cache) > rank(u, target, range, cache))
        target = candidate;
      break;
    }
    u.enemyId = target?.id ?? null;
    u.nextThink = s.time + ENGAGEMENT_CADENCE + (u.id % 7) * 0.009;
  }
  return { target, stopToFight: !!target && ['attack', 'attackmove'].includes(u.order?.mode) };
}
