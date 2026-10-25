import { aiState } from './state.js';
import { hqOf, pairedEnemy, validSide } from '../factions.js';
import { BUILDINGS, WEAPONS, HQ_X, SEA, CORRIDORS } from '../config.js';
import { demolish, repair, canPlace, build } from '../city/construction.js';
import { passable, overlappingRoad } from '../city/road-network.js';
import { economy } from '../city/economy.js';
import { buildRoad } from '../city/roads.js';
import { purchaseQuote } from '../city/pricing.js';
import { difficultyOf } from './difficulty.config.js';
import { random } from '../shared/random.js';
import { produce } from '../units/aviation/production.js';
import { knownTargets } from '../visibility.js';
import { launch } from '../units/aviation/launch.js';
import { oilPlan } from './oil-ai.js';
import { settlementRoadPlan } from './settlement-ai.js';
import { weaponStock } from '../units/aviation/launch-supply.js';
export function ai(s, side = 1) {
  if (!validSide(s, side)) return;
  const memory = aiState(s, side);
  const f = s.sides[side],
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
            : !active('factory').length
              ? 'factory'
              : !active('launcher').length
                ? 'launcher'
                : active('gun').length < 3
                  ? 'gun'
                  : null;
    if (!key && !oilBusy) {
      const goals = [
        ['housing', Math.min(9, 3 + Math.floor(s.time / 130))],
        ['industry', Math.min(5, 2 + Math.floor(s.time / 250))],
        ['radar', s.time > 220 ? 1 : 0],
        ['sam', s.time > 220 ? 2 : 0],
        ['launcher', s.time > 600 ? 2 : 1],
        ['factory', s.time > 580 ? 2 : 1],
        ['barracks', s.time > 240 ? 1 : 0],
        ['ammofactory', s.time > 280 ? 1 : 0],
        ['silo', s.time > 360 ? 1 : 0],
        ['training', s.time > 640 ? 1 : 0],
        ['market', s.time > 420 ? 1 : 0],
        ['vehiclebase', s.time > 300 ? 1 : 0],
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
      reserve = purchaseQuote(s, side, 'building', memory.plannedBuild)?.cost ?? 150;
    if (queued < 3 && stock < 7 && f.credits > reserve + 90 && f.materials > 30) {
      let key = random(s) > 0.5 ? 'cruise' : random(s) > 0.5 ? 'heavy' : 'drone';
      if (random(s) > 0.75) key = 'ballistic';
      if (f.credits < reserve + WEAPONS[key].cost) key = 'drone';
      if (f.credits >= reserve + WEAPONS[key].cost) produce(s, side, key);
    }
  }
  if (s.time >= memory.nextAttack) {
    memory.nextAttack =
      s.time + difficultyOf(s).attackEvery + random(s) * difficultyOf(s).attackJitter;
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
