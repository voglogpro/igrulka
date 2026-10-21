import { GROUND_UNITS, BUILDINGS, isInfantry, defenseStats, riverDistance } from '../../config.js';
import { groundPath, walkable, GROUND_LIMIT } from './navigation.js';
import { groundVisible, lineOfSight, recordFire } from '../infantry/cover.js';
import { updateInfantrySupport } from '../infantry/support.js';
import { buildingConnected } from '../../city/road-network.js';
import { freeSpot } from '../vehicles/transport.js';
import { makeGround, defaultRallyMode } from './recruitment.js';
import { orderGround } from './orders.js';
import { updateArmyAI } from '../../ai/army-ai.js';
import { updateGuard, guardGround } from './guard.js';
import { updateRecruitRepeat } from './repeat.js';
import { veteranAccuracy, veteranSuppression } from './veterancy.js';
export function tickUnit(s, u, dt, rates, hooks) {
  const { event, random } = hooks,
    d = GROUND_UNITS[u.key] || BUILDINGS[u.key],
    foot = isInfantry(u.key),
    mobile = !!GROUND_UNITS[u.key];
  if (u.hp <= 0 || u.progress < 1) return;
  if (u.carrierId) {
    const v = s.groundUnits.find((v) => v.id === u.carrierId && v.hp > 0);
    if (v) {
      u.x = v.x;
      u.z = v.z;
      u.moving = false;
      return;
    }
    u.carrierId = null;
  }
  u.prevX = u.x;
  u.prevY = u.y;
  u.prevZ = u.z;
  u.suppression = Math.max(0, (u.suppression || 0) - dt * 0.09 * (2 - veteranSuppression(u)));
  if (!d.range)
    u.heat = Math.max(
      0,
      (u.heat || 0) -
        (d.cooling || 0.12) * (s.sides[u.side].tech.includes('cooling') ? 1.5 : 1) * dt,
    );
  u.groundCooldown = Math.max(0, (u.groundCooldown || 0) - dt);
  const aaMagazine = (foot || u.key === 'gun') && d.range ? defenseStats(s.sides[u.side], u) : null,
    maxMagazine = aaMagazine?.magazine || d.groundMagazine || 30;
  u.groundAmmo ??= maxMagazine;
  if (u.groundReload > 0) {
    u.groundReload = Math.max(0, u.groundReload - dt);
    if (!u.groundReload) u.groundAmmo = maxMagazine;
  } else if (!u.groundAmmo) u.groundReload = aaMagazine?.reload || d.groundReload || 3;
  if (u.boardingId) {
    const v = s.groundUnits.find((v) => v.id === u.boardingId && v.hp > 0);
    if (!v) {
      u.boardingId = null;
      u.order = null;
      u.path = [];
    } else if (Math.hypot(v.x - u.x, v.z - u.z) < 15) {
      u.carrierId = v.id;
      u.boardingId = null;
      u.path = [];
      u.order = null;
      return;
    } else if (
      (u.boardRepath || 0) < s.time &&
      (!u.path?.length || Math.hypot(v.x - (u.order?.x ?? v.x), v.z - (u.order?.z ?? v.z)) > 8)
    ) {
      u.path = groundPath(s, u, v, d.size * 0.42);
      u.order = { x: v.x, z: v.z, mode: 'board' };
      u.boardRepath = s.time + 1;
    }
  }
  updateGuard(s, u);
  const findTarget = () => {
    const enemies = s.groundUnits.filter(
      (t) =>
        t.side !== u.side &&
        t.hp > 0 &&
        !t.carrierId &&
        groundVisible(s, u.side, t) &&
        Math.hypot(t.x - u.x, t.z - u.z) < (d.groundRange || 0) &&
        lineOfSight(s, u, t),
    );
    enemies.sort((a, b) =>
      a.id === (u.guardTargetId || u.order?.targetId)
        ? -1
        : b.id === (u.guardTargetId || u.order?.targetId)
          ? 1
          : Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z),
    );
    return (
      enemies[0] ||
      s.buildings.find(
        (t) =>
          t.side !== u.side &&
          t.hp > 0 &&
          Math.hypot(t.x - u.x, t.z - u.z) < (d.groundRange || 0) &&
          lineOfSight(s, u, t),
      )
    );
  };
  if ((u.nextThink || 0) <= s.time) {
    const t = findTarget();
    u.enemyId = t?.id ?? null;
    u.nextThink = s.time + 0.25;
  }
  const target =
      s.groundUnits.find(
        (t) => t.id === u.enemyId && t.hp > 0 && !t.carrierId && groundVisible(s, u.side, t),
      ) || s.buildings.find((t) => t.id === u.enemyId && t.hp > 0),
    retreat = u.order?.mode === 'retreat',
    stopToFight = !!target && ['attack', 'attackmove'].includes(u.order?.mode);
  u.moving = false;
  if (mobile && u.path?.length && !stopToFight) {
    const p = u.path[0],
      dx = p.x - u.x,
      dz = p.z - u.z,
      len = Math.hypot(dx, dz),
      slow = retreat ? 1.3 : u.suppression > 0.8 ? 0.3 : u.suppression > 0.45 ? 0.65 : 1,
      speed = d.speed * (u.hp / u.maxHp < 0.3 ? 0.75 : 1) * slow,
      dist = Math.min(len, speed * dt);
    u.yaw = Math.atan2(dx, dz);
    if (
      walkable(s, u.x + (dx / (len || 1)) * dist, u.z + (dz / (len || 1)) * dist, d.size * 0.42)
    ) {
      u.x += (dx / (len || 1)) * dist;
      u.z += (dz / (len || 1)) * dist;
      if (len < 1 + speed * dt) u.path.shift();
    } else if ((u.repathAt || 0) < s.time) {
      u.repathAt = s.time + 2;
      u.path = groundPath(s, u, u.order || p, d.size * 0.42);
    }
    u.moving = !!u.path.length;
  }
  if (mobile) u.y = riverDistance(u.x, u.z) < 82 ? 2 : 1;
  if (u.key === 'mog') u.setup = u.moving ? 0 : Math.min(1, (u.setup || 0) + dt / 3);
  updateInfantrySupport(s, u, dt);

  if (
    !d.groundRange ||
    u.holdFire ||
    u.digging ||
    retreat ||
    (u.key === 'mog' && u.setup < 1) ||
    u.groundCooldown > 0 ||
    u.groundReload > 0 ||
    u.groundAmmo <= 0
  )
    return;
  let aim = target;
  if (aim && (!lineOfSight(s, u, aim) || Math.hypot(aim.x - u.x, aim.z - u.z) > d.groundRange))
    aim = null;
  const blind = !aim;
  if (!aim)
    aim = s.contacts?.[u.side]?.find(
      (c) =>
        c.expires > s.time &&
        Math.hypot(c.x - u.x, c.z - u.z) < d.groundRange &&
        lineOfSight(s, u, c),
    );
  if (!aim) return;
  const spread =
      (blind ? 18 : u.key === 'sniper' ? 1 : 3) *
      (u.moving ? 2 : 1) *
      (1 + u.suppression * 2) *
      (1 + Math.pow(u.heat || 0, 2) * 2) *
      veteranAccuracy(u),
    tx = aim.x + (random(s) - 0.5) * spread,
    tz = aim.z + (random(s) - 0.5) * spread,
    tank = u.key === 'leopard',
    speed = tank ? 180 : 270,
    length = Math.hypot(tx - u.x, tz - u.z) || 1,
    cost = tank ? 0.8 : 0.025,
    f = s.sides[u.side];
  if (f.credits < cost) return;
  f.credits -= cost;
  f.spentAmmo += cost;
  u.groundCooldown = d.groundCooldown * (1 + u.suppression);
  u.groundAmmo--;
  if (d.heatPerShot) u.heat = Math.min(1.5, (u.heat || 0) + d.heatPerShot);
  u.targetX = tx;
  u.targetY = 2.5;
  u.targetZ = tz;
  u.targetId = aim.id ?? null;
  recordFire(s, u, random);
  s.projectiles.push({
    id: s.nextId++,
    side: u.side,
    source: u.id,
    shooterKey: u.key,
    targetId: blind ? null : aim.id,
    domain: 'ground',
    kind: tank ? 'shell' : 'bullet',
    tracer: tank || u.key === 'machinegunner' || u.groundAmmo % 3 === 0,
    x: u.x,
    y: foot ? 2.6 : 4,
    z: u.z,
    px: u.x,
    py: foot ? 2.6 : 4,
    pz: u.z,
    vx: ((tx - u.x) / length) * speed,
    vy: 0,
    vz: ((tz - u.z) / length) * speed,
    speed,
    damage: d.groundDamage,
    life: 0,
    maxLife: 2,
    tx,
    tz,
    flight: length / speed,
    suppression: d.suppression || 0.06,
  });
  event(s, 'shot', {
    side: u.side,
    key: tank ? 'cannon' : 'gun',
    buildingId: u.id,
    x: u.x,
    y: foot ? 2.6 : 4,
    z: u.z,
    mx: u.x,
    my: foot ? 2.6 : 4,
    mz: u.z,
    tx,
    ty: 2,
    tz,
    ground: true,
  });
}

export function updateGround(s, rates, dt, hooks) {
  const { event, random } = hooks;
  s.groundUnits ||= [];
  s.trenches ||= [];
  s.contacts ||= [[], []];
  for (let side = 0; side < 2; side++)
    s.contacts[side] = s.contacts[side].filter((c) => c.expires > s.time);
  updateRecruitRepeat(s);
  for (const b of s.buildings)
    if (b.key === 'barracks' && b.hp > 0 && b.progress >= 1 && b.armyQueue?.length) {
      const q = b.armyQueue[0],
        d = GROUND_UNITS[q.key];
      q.progress +=
        (dt *
          rates[b.side].productivity *
          (buildingConnected(s, b, BUILDINGS.barracks.size) ? 1 : 0.2)) /
        d.time;
      if (
        q.progress >= 1 &&
        s.groundUnits.filter((u) => u.side === b.side && u.hp > 0).length < GROUND_LIMIT
      ) {
        const p = freeSpot(s, b, d.size * 0.5);
        if (p) {
          b.armyQueue.shift();
          const u = makeGround(s, b.side, q.key, p.x, p.z);
          s.groundUnits.push(u);
          event(s, 'recruited', { ...p, side: b.side, key: q.key, unitId: u.id });
          const rallyMode = defaultRallyMode(s, b);
          if (rallyMode === 'guard') guardGround(s, b.side, [u.id], b.rally || p);
          else if (rallyMode === 'attackmove' && b.rally)
            orderGround(s, b.side, [u.id], { ...b.rally, mode: 'attackmove' });
        }
      }
    }
  for (const u of s.groundUnits) tickUnit(s, u, dt, rates, hooks);
  for (const b of s.buildings)
    if (b.key === 'gun' && b.hp > 0 && b.progress >= 1) tickUnit(s, b, dt, rates, hooks);
  s.groundUnits = s.groundUnits.filter((u) => u.hp > 0);
  updateArmyAI(s, hooks);
}
