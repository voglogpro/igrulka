import { fuelFactor } from '../../city/oil.js';
import { GROUND_UNITS, BUILDINGS, isInfantry, defenseStats, groundHeight } from '../../config.js';
import { groundPath, walkable, GROUND_LIMIT } from './navigation.js';
import { lineOfSight, recordFire } from '../infantry/cover.js';
import { updateInfantrySupport } from '../infantry/support.js';
import { buildingConnected } from '../../city/road-network.js';
import { freeSpot } from '../vehicles/transport.js';
import { updateTransportDeliveries } from '../vehicles/transport-orders.js';
import { updateGroundRoutes } from './route-queue.js';
import { makeGround, defaultRallyMode } from './recruitment.js';
import { orderGround } from './orders.js';
import { updateArmyAI } from '../../ai/army-ai.js';
import { updateGuard, guardGround } from './guard.js';
import { updateRecruitRepeat } from './repeat.js';
import { veteranAccuracy, veteranSuppression } from './veterancy.js';
import { squadArrivalPoint } from './squads.js';
import { updateGroundTactics } from './tactics.js';
import { applyStance, updateStance } from './stance.js';
import { weatherSpread, weatherSpeed } from '../../weather.js';
import { tickDowned, updateRear, autoRear } from './rear.js';
import { damageGround } from './combat.js';
import { updateTrade } from './trade.js';
import {
  prepareGroundEngagement,
  groundEngagement,
  groundWeaponProfile,
  canGroundFire,
  groundAimPoint,
} from './engagement.js';
// Belt-fed and vehicle guns show every second round as a tracer, rifles every fourth.
const AUTOMATIC = new Set(['machinegunner', 'apc', 'mog', 'armoredcar', 'lighttank', 'ifv']);
// Bullets are aimed slightly upward and fall onto the target; the rise matches a parabolic drop.
const LOFT_GRAVITY = 42;

// A step that clips a building corner moves along the free axis instead, like sliding on a wall.
function slide(s, u, dx, dz, dist, radius) {
  for (const [sx, sz] of Math.abs(dx) > Math.abs(dz)
    ? [
        [Math.sign(dx), 0],
        [0, Math.sign(dz)],
      ]
    : [
        [0, Math.sign(dz)],
        [Math.sign(dx), 0],
      ])
    if ((sx || sz) && walkable(s, u.x + sx * dist, u.z + sz * dist, radius)) {
      u.x += sx * dist;
      u.z += sz * dist;
      return true;
    }
  return false;
}

export function tickUnit(s, u, dt, rates, hooks) {
  const { event, random } = hooks,
    d = GROUND_UNITS[u.key] || BUILDINGS[u.key],
    foot = isInfantry(u.key),
    mobile = !!GROUND_UNITS[u.key];
  if (u.hp <= 0 || u.progress < 1) return;
  if (u.downed) {
    if (tickDowned(s, u, dt)) damageGround(s, u, 1e9, event, 'bleed');
    return;
  }
  const index = prepareGroundEngagement(s).ids;
  if (u.carrierId) {
    const v = index.get(u.carrierId);
    if (v?.hp > 0) {
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
    const v = index.get(u.boardingId);
    if (!(v?.hp > 0) || !GROUND_UNITS[v.key]) {
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
  const { target, stopToFight } = groundEngagement(s, u);
  if (mobile) {
    updateGroundTactics(s, u, target);
    updateStance(s, u);
  }
  const retreat = u.order?.mode === 'retreat';
  u.moving = false;
  if (mobile && u.path?.length && !stopToFight) {
    const p = u.path[0],
      dx = p.x - u.x,
      dz = p.z - u.z,
      len = Math.hypot(dx, dz),
      slow = retreat ? 1.3 : u.suppression > 0.8 ? 0.3 : u.suppression > 0.45 ? 0.65 : 1,
      speed =
        d.speed * (u.hp / u.maxHp < 0.3 ? 0.75 : 1) * slow * weatherSpeed(s) * fuelFactor(s, u),
      dist = Math.min(len, speed * dt);
    u.yaw = Math.atan2(dx, dz);
    if (
      walkable(s, u.x + (dx / (len || 1)) * dist, u.z + (dz / (len || 1)) * dist, d.size * 0.42)
    ) {
      u.x += (dx / (len || 1)) * dist;
      u.z += (dz / (len || 1)) * dist;
      if (len < 1 + speed * dt) u.path.shift();
    } else if (slide(s, u, dx, dz, dist, d.size * 0.42)) {
      // Grazing a corner: slid along the wall instead of stopping.
    } else if ((u.repathAt || 0) < s.time) {
      u.repathAt = s.time + 2;
      u.path = groundPath(s, u, u.order || p, d.size * 0.42);
    }
    u.moving = !!u.path.length;
  }
  if (mobile) u.y = 1 + groundHeight(u.x, u.z);
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
    u.groundAmmo <= 0 ||
    !canGroundFire(u)
  )
    return;
  let aim = target;
  const shot = groundWeaponProfile(u.key),
    minRange = d.groundMinRange || 0,
    reach = (p) => {
      const range = Math.hypot(p.x - u.x, p.z - u.z);
      return range <= d.groundRange && range >= minRange;
    };
  // Indirect fire lobs shells over buildings, so only direct weapons need a clear line.
  if (aim && ((!shot.indirect && !lineOfSight(s, u, aim)) || !reach(aim))) aim = null;
  const blind = !aim;
  if (!aim && shot.canBlind)
    aim = s.contacts?.[u.side]?.find(
      (c) => c.expires > s.time && reach(c) && (shot.indirect || lineOfSight(s, u, c)),
    );
  if (!aim) return;
  const distanceSpread = shot.indirect ? 1 + Math.hypot(aim.x - u.x, aim.z - u.z) / 220 : 1;
  const spread =
      (blind ? 18 : shot.spread) *
      distanceSpread *
      (u.moving ? 2 : 1) *
      (1 + u.suppression * 2) *
      (1 + Math.pow(u.heat || 0, 2) * 2) *
      veteranAccuracy(u) *
      weatherSpread(s),
    predicted = blind ? aim : groundAimPoint(u, aim, shot.speed, s),
    tx = predicted.x + (random(s) - 0.5) * spread,
    tz = predicted.z + (random(s) - 0.5) * spread,
    tank = shot.kind === 'shell',
    speed = shot.speed,
    length = Math.hypot(tx - u.x, tz - u.z) || 1,
    flight = length / speed,
    // Muzzle and aim heights sit on the ground under the shooter and the target, hills included.
    ground = groundHeight(u.x, u.z),
    originY = ground + (shot.indirect ? 6 : foot ? 2.6 : 4),
    arc = shot.indirect ? Math.min(150, length * 0.33) : 0,
    loft = arc ? 0 : Math.min(14, (LOFT_GRAVITY * flight * flight) / 8),
    endY = groundHeight(tx, tz) + (arc ? 2 : 2.4),
    cost = shot.cost,
    f = s.sides[u.side];
  if (f.credits < cost) return;
  f.credits -= cost;
  f.spentAmmo += cost;
  // Automatic weapons fire in bursts; the pause keeps the configured average rate of fire.
  let cooldown = d.groundCooldown;
  if (d.groundBurst > 1) {
    if (!(u.burstLeft > 0)) u.burstLeft = d.groundBurst;
    u.burstLeft--;
    cooldown = u.burstLeft
      ? d.groundBurstGap
      : d.groundCooldown * d.groundBurst - d.groundBurstGap * (d.groundBurst - 1);
  }
  u.groundCooldown = cooldown * (1 + u.suppression);
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
    originX: u.x,
    originZ: u.z,
    shooterKey: u.key,
    targetId: blind ? null : aim.id,
    domain: 'ground',
    kind: tank ? 'shell' : 'bullet',
    tracer: tank || u.groundAmmo % (AUTOMATIC.has(u.key) ? 2 : 4) === 0,
    originY,
    endY,
    ...(arc ? { arc } : { loft }),
    x: u.x,
    y: originY,
    z: u.z,
    px: u.x,
    py: originY,
    pz: u.z,
    vx: ((tx - u.x) / length) * speed,
    vy: (4 * (arc || loft) + endY - originY) / flight,
    vz: ((tz - u.z) / length) * speed,
    speed,
    damage: d.groundDamage,
    life: 0,
    maxLife: 2,
    tx,
    tz,
    flight,
    suppression: d.suppression || 0.06,
  });
  event(s, 'shot', {
    side: u.side,
    key: tank ? 'cannon' : 'gun',
    shooter: u.key,
    buildingId: u.id,
    x: u.x,
    y: ground + (foot ? 2.6 : 4),
    z: u.z,
    mx: u.x,
    my: ground + (foot ? 2.6 : 4),
    mz: u.z,
    tx,
    ty: endY,
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
          if (q.squadId != null) {
            u.squadId = q.squadId;
            u.squadSlot = q.squadSlot;
            u.squadGoal = q.destination ? { ...q.destination } : null;
          }
          s.groundUnits.push(u);
          event(s, 'recruited', { ...p, side: b.side, key: q.key, unitId: u.id });
          if (d.support) {
            // Rear service units look after themselves; no rally point or stance applies.
          } else if (q.stance) {
            applyStance(s, b.side, [u.id], q.stance);
          } else if (Object.hasOwn(q, 'destination')) {
            const arrival = squadArrivalPoint(q);
            if (arrival) {
              const accepted =
                walkable(s, arrival.x, arrival.z, d.size * 0.42) &&
                typeof orderGround(s, b.side, [u.id], arrival) === 'number';
              if (!accepted) {
                u.path = [];
                u.order = { ...arrival };
              }
              u.routeQueue = [];
              u.routeState = {
                status: accepted ? 'moving' : 'blocked',
                retryAt: s.time + (accepted ? 0 : 1),
              };
            }
          } else {
            const rallyMode = defaultRallyMode(s, b);
            if (rallyMode === 'attack') applyStance(s, b.side, [u.id], { mode: 'attack' });
            else if (rallyMode === 'defend')
              applyStance(s, b.side, [u.id], { mode: 'defend', post: 'auto' });
            else if (rallyMode === 'guard') guardGround(s, b.side, [u.id], b.rally || p);
            else if (rallyMode === 'attackmove' && b.rally)
              orderGround(s, b.side, [u.id], { ...b.rally, mode: 'attackmove' });
          }
        }
      }
    }
  if ((s.rearNext || 0) <= s.time) {
    s.rearNext = s.time + 6;
    autoRear(s);
  }
  updateRear(s, dt);
  updateTrade(s);
  prepareGroundEngagement(s);
  for (const u of s.groundUnits) tickUnit(s, u, dt, rates, hooks);
  for (const b of s.buildings)
    if (b.key === 'gun' && b.hp > 0 && b.progress >= 1) tickUnit(s, b, dt, rates, hooks);
  updateGroundRoutes(s);
  updateTransportDeliveries(s);
  s.groundUnits = s.groundUnits.filter((u) => u.hp > 0);
  updateArmyAI(s, hooks);
}
