import { aiState } from './state.js';
import { hqOf, pairedEnemy, validSide } from '../factions.js';
import { BUILDINGS, WEAPONS, HQ_X, SEA, CORRIDORS } from '../config.js';
import { demolish, repair, canPlace, build } from '../city/construction.js';
import { passable, overlappingRoad } from '../city/road-network.js';
import { economy } from '../city/economy.js';
import { buildRoad } from '../city/roads.js';
import { difficultyOf } from './difficulty.config.js';
import { random } from '../shared/random.js';
import { produce } from '../units/aviation/production.js';
import { knownTargets } from '../visibility.js';
import { launch } from '../units/aviation/launch.js';
import { oilPlan } from './oil-ai.js';
import { settlementRoadPlan } from './settlement-ai.js';
import { weaponStock } from '../units/aviation/launch-supply.js';
import { armyProductionReserve, infrastructureReserve } from './depot-doctrine.js';
import { launchAIAssault } from './army-ai.js';
import { componentCost, hasComponents } from '../city/electronics.js';
import { hasOil } from '../city/oil.js';

// Rebuild once per second and persist the decision window, so loading midway
// through it cannot spend a different budget or consume different random draws.
function groundBudget(s, side) {
  const plan = aiState(s, side);
  let value = plan.aiGroundReserve;
  if (s.time >= value.nextAt) {
    const facilities = new Set(
      s.buildings
        .filter((b) => b.side === side && b.hp > 0 && b.progress >= 1 && !b.demolished)
        .map((b) => b.key),
    );
    value = { nextAt: s.time + 1, amount: armyProductionReserve(s, side, facilities) };
    plan.aiGroundReserve = value;
  }
  return value.amount;
}
export function ai(s, side = 1) {
  if (!validSide(s, side)) return;
  const memory = aiState(s, side);
  const level = difficultyOf(s),
    f = s.sides[side],
    hq = hqOf(s, side),
    active = (key) => s.buildings.filter((b) => b.side === side && b.key === key && b.hp > 0),
    ready = (key) => active(key).filter((b) => b.progress >= 1);
  if (!hq || hq.hp <= 0) return;
  if (s.time >= memory.nextBuild) {
    memory.nextBuild = s.time + 7;
    const ruin = s.buildings.find(
      (b) => b.side === side && b.hp <= 0 && !b.demolished && b.key !== 'hq',
    );
    if (ruin) demolish(s, ruin.id, side);
    for (const r of s.roads)
      if (r.side === side && !r.removed && !passable(r) && !r.repairing) {
        repair(s, r.id, side);
        break;
      }
    const e = economy(s, side),
      planned = s.buildings
        .filter((b) => b.side === side && b.hp > 0 && b.progress < 1)
        .reduce((n, b) => n - (BUILDINGS[b.key]?.power || 0), 0);
    // Oil comes before everything except power: without it no machine leaves the factory.
    const oilBusy = e.power - e.demand + planned >= 7 && oilPlan(s, side, hq, active);
    let key = oilBusy
      ? null
      : e.power - e.demand + planned < 7
        ? 'power'
        : active('housing').length < 3
          ? 'housing'
          : active('industry').length < 2
            ? 'industry'
            : s.time > level.armyFrom - 90 && !active('barracks').length
              ? 'barracks'
              : !active('electronics').length
                ? 'electronics'
                : !active('factory').length
                  ? 'factory'
                  : !active('launcher').length
                    ? 'launcher'
                    : active('gun').length < 3
                      ? 'gun'
                      : null;
    if (!key && !oilBusy) {
      const goals = [
        ['barracks', s.time > level.armyFrom - 90 ? 1 : 0],
        ['ammofactory', s.time > level.armyFrom - 40 ? 1 : 0],
        ['vehiclebase', s.time > level.armyFrom + 20 ? 1 : 0],
        ['housing', Math.min(9, 3 + Math.floor(s.time / 130))],
        ['industry', Math.min(5, 2 + Math.floor(s.time / 250))],
        ['electronics', s.time > 600 ? 2 : 1],
        ['radar', s.time > 220 ? 1 : 0],
        ['sam', s.time > 220 ? 2 : 0],
        ['launcher', s.time > 600 ? 2 : 1],
        ['factory', s.time > 580 ? 2 : 1],
        ['silo', s.time > 360 ? 1 : 0],
        ['training', s.time > 640 ? 1 : 0],
        ['market', s.time > 420 ? 1 : 0],
        ['gun', Math.min(6, 3 + Math.floor(s.time / 240))],
      ];
      key = goals.find(([k, n]) => active(k).length < n)?.[0] || null;
    }
    if (!key && !oilBusy) settlementRoadPlan(s, side);
    memory.plannedBuild = key;
    if (key) {
      let placed = false,
        hasSite = false;
      const xs = [-110, -55, 55, 110, -165, 0, 165],
        zs = [-80, -10, 90, 20, 190, 120, -180, -110, 290, 220];
      for (const dz of zs) {
        for (const dx of xs) {
          const x = hq.x + dx,
            z = hq.z + dz;
          if (canPlace(s, key, x, z, side)) continue;
          hasSite = true;
          const b = build(s, side, key, x, z);
          if (typeof b !== 'string') {
            placed = true;
            memory.plannedBuild = null;
            break;
          }
        }
        if (placed) break;
      }
      if (!placed && !hasSite && f.credits > 350) {
        const plans = [
            [-90, -45, -200, -45],
            [90, -45, 200, -45],
            [-200, -45, -200, 255],
            [-200, 55, 200, 55],
            [-200, 155, 200, 155],
            [-200, -45, -200, -245],
            [-200, -145, 200, -145],
            [-200, 255, 200, 255],
          ],
          index = memory.roadPlan || 0;
        if (index < plans.length) {
          const [ax, az, bx, bz] = plans[index],
            r = buildRoad(s, side, hq.x + ax, hq.z + az, hq.x + bx, hq.z + bz);
          if (
            typeof r !== 'string' ||
            overlappingRoad(s, hq.x + ax, hq.z + az, hq.x + bx, hq.z + bz)
          )
            memory.roadPlan = index + 1;
        }
      }
    }
  }
  if (ready('factory').length) {
    const queued = ready('factory').reduce((n, b) => n + (b.queue?.length || 0), 0),
      stock = Object.keys(WEAPONS).reduce((n, key) => n + weaponStock(s, side, key), 0),
      reserve = Math.max(
        infrastructureReserve(s, side, memory.plannedBuild) || 150,
        groundBudget(s, side),
      );
    if (
      queued < 3 &&
      stock < 7 &&
      f.credits > reserve + 90 &&
      f.materials > 30 &&
      hasComponents(s, side, componentCost(s, WEAPONS.drone))
    ) {
      let key = random(s) > 0.5 ? 'cruise' : random(s) > 0.5 ? 'heavy' : 'drone';
      if (random(s) > 0.75) key = 'ballistic';
      const affordable = (key) =>
        f.credits >= reserve + WEAPONS[key].cost &&
        f.materials >= WEAPONS[key].metal &&
        hasOil(s, side, WEAPONS[key].oil) &&
        hasComponents(s, side, componentCost(s, WEAPONS[key]));
      if (!affordable(key)) key = 'drone';
      if (affordable(key)) produce(s, side, key);
    }
  }
  if (s.time >= memory.nextAttack) {
    memory.nextAttack =
      s.time + difficultyOf(s).attackEvery + random(s) * difficultyOf(s).attackJitter;
    launchAIAssault(s, side);
    const enemies = knownTargets(s, side);
    const local = enemies.filter((b) => b.side === pairedEnemy(s, side));
    const front = local.length ? local : enemies;
    let targets = front.filter((b) => b.key !== 'road');
    if (random(s) < 0.28) {
      const roads = front.filter((r) => r.key === 'road' && passable(r));
      if (roads.length) targets = roads;
    }
    const weighted = targets.flatMap((b) =>
        Array(['hq', 'power', 'factory', 'launcher'].includes(b.key) ? 3 : 1).fill(b),
      ),
      target = weighted[Math.floor(random(s) * weighted.length)] ||
        hqOf(s, pairedEnemy(s, side)) || { x: -HQ_X, z: hq.z };
    if (target)
      for (const key of Object.keys(WEAPONS))
        if (weaponStock(s, side, key)) {
          const flank = ['drone', 'heavy', 'cruise'].includes(key) && random(s) < 0.45,
            z =
              s.sides.length > 2
                ? hq.z < 0
                  ? CORRIDORS[0]
                  : CORRIDORS[1]
                : random(s) < 0.5
                  ? CORRIDORS[0]
                  : CORRIDORS[1],
            aim = flank
              ? {
                  x: target.x,
                  z: target.z,
                  waypoints: [
                    { x: SEA.halfX + 90, z },
                    { x: -SEA.halfX - 90, z },
                  ],
                }
              : (target.id ?? target);
          const r = launch(s, side, key, aim, 6);
          if (typeof r === 'number') break;
        }
  }
}
