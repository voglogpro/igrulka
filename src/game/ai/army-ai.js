import { DISTRICTS } from '../territory/districts.config.js';
import { aiState } from './state.js';
import { hqOf, pairedEnemy, hostile, allied } from '../factions.js';
import { recruit, recruitmentFacility } from '../units/ground/recruitment.js';
import { COVER_PATCHES } from '../units/infantry/cover.js';
import { walkable } from '../units/ground/navigation.js';
import { GROUND_UNITS, isInfantry } from '../config.js';
import { orderGround, commandUnits } from '../units/ground/orders.js';
import { unloadGround, boardGround } from '../units/vehicles/transport.js';
import { launchFPV } from '../units/infantry/fpv.js';
import { updateDistrictAI, AI_DISTRICT_GARRISON_LIMIT } from './district-ai.js';
import { difficultyOf } from './difficulty.config.js';
import { guardGround } from '../units/ground/guard.js';

export function needsCaptureInfantry(s, side = 1) {
  if (
    !s.districts?.some(
      (d) =>
        !allied(s, d.owner, side) &&
        (s.sides.length <= 2 ||
          Math.sign(DISTRICTS.find((site) => site.id === d.id)?.z) === Math.sign(hqOf(s, side)?.z)),
    )
  )
    return false;
  const eligible = (key) => isInfantry(key) && !GROUND_UNITS[key].support && key !== 'atgm';
  const present = s.groundUnits.filter(
    (u) =>
      u.side === side &&
      u.hp > 0 &&
      !u.downed &&
      !u.aiDefender &&
      !u.carrierId &&
      !u.boardingId &&
      eligible(u.key) &&
      (!u.guard || u.aiDistrict),
  ).length;
  // These three classes may become the separate headquarters defense detail on spawn.
  // Do not promise them to district capture before that assignment actually happens.
  const queued = s.buildings
    .filter((b) => b.side === side && b.hp > 0 && !b.demolished)
    .reduce(
      (count, b) =>
        count +
        (b.armyQueue || []).filter(
          (q) => eligible(q.key) && !['mog', 'sniper', 'machinegunner'].includes(q.key),
        ).length,
      0,
    );
  return present + queued < AI_DISTRICT_GARRISON_LIMIT;
}

export function updateArmyAI(s, hooks, side = 1) {
  if (s.mode === 'multiplayer') return;
  const { random } = hooks;
  const level = difficultyOf(s);
  if (s.time > level.armyFrom && (aiState(s, side).nextArmy || 0) < s.time) {
    aiState(s, side).nextArmy = s.time + level.armyEvery;
    const facilities = new Set(
        s.buildings
          .filter((b) => b.side === side && b.hp > 0 && b.progress >= 1 && !b.demolished)
          .map((b) => b.key),
      ),
      ready = facilities.has('barracks') || facilities.has('vehiclebase'),
      f = s.sides[side];
    const captureNeeded = facilities.has('barracks') && needsCaptureInfantry(s, side);
    // New logistics infrastructure must not starve the small paid capture detail.
    // The rest of the army retains its existing cash threshold.
    if (
      ready &&
      (captureNeeded ? f.credits >= GROUND_UNITS.infantry.cost + 250 : f.credits > 700)
    ) {
      const choices = [
        'infantry',
        'machinegunner',
        'engineer',
        'mog',
        'sniper',
        'assault',
        'apc',
        'gepard',
        'armoredcar',
        'lighttank',
        'ifv',
        'leopard',
        'atgm',
        'tankdestroyer',
        'heavytank',
        'howitzer',
        'mlrs',
        'operator',
      ].filter((key) => facilities.has(recruitmentFacility(key)));
      const armorThreat = s.groundUnits.some(
        (u) => hostile(s, u.side, side) && u.hp > 0 && u.key === 'leopard',
      );
      const antiArmor = s.groundUnits.filter(
        (u) => u.side === side && u.hp > 0 && ['atgm', 'tankdestroyer'].includes(u.key),
      ).length;
      const key = captureNeeded
        ? 'infantry'
        : facilities.has('barracks') && armorThreat && antiArmor < 2
          ? antiArmor && facilities.has('vehiclebase')
            ? 'tankdestroyer'
            : 'atgm'
          : choices[Math.floor(random(s) * choices.length)];
      recruit(s, side, key, null, 1);
    }
    updateDistrictAI(s, side);
    const pairedHQ = hqOf(s, pairedEnemy(s, side));
    const hq =
      pairedHQ?.hp > 0
        ? pairedHQ
        : s.buildings.find((b) => b.key === 'hq' && b.hp > 0 && hostile(s, b.side, side));
    for (const u of s.groundUnits)
      if (
        u.side === side &&
        !u.carrierId &&
        !u.boardingId &&
        hq &&
        !GROUND_UNITS[u.key].support &&
        !u.downed
      ) {
        // Preserve the old emergency retreat of the bot's own defense detail.
        // Pinned or manually assigned guards keep their explicit post.
        if (u.guard && u.aiDefender && u.autoDefense && u.hp / u.maxHp < 0.25) {
          commandUnits(s, side, [u.id], 'retreat');
          continue;
        }
        if (u.guard) continue;
        if (u.delivery) continue;
        if (u.supplyTrip) continue;
        if (u.routeState) continue;
        if (u.aiDefender && u.hp / u.maxHp > 0.35 && !u.order && !u.path?.length) {
          const own = hqOf(s, side);
          u.defensePoint ||= COVER_PATCHES.filter(
            (p) =>
              p.forest &&
              walkable(s, p.x, p.z, GROUND_UNITS[u.key].size * 0.42) &&
              p.x > 150 &&
              p.x < own.x &&
              Math.hypot(p.x - own.x, p.z - own.z) < 420,
          ).sort(
            (a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z),
          )[0] || { x: own.x - 100, z: own.z + 100 };
          // If this local point has become inaccessible, the existing idle defender can
          // use the bounded front planner instead of waiting here forever.
          const assigned = guardGround(s, side, [u.id], u.defensePoint);
          if (typeof assigned === 'number' || (!u.order && !u.path?.length)) u.autoDefense = true;
          u.camouflaged = true;
          continue;
        }
        if (GROUND_UNITS[u.key].capacity) {
          const passengers = s.groundUnits.filter((p) => p.carrierId === u.id);
          if (
            passengers.length &&
            (Math.hypot(u.x - hq.x, u.z - hq.z) < 260 || u.hp / u.maxHp < 0.5)
          )
            unloadGround(s, side, u.id);
          if (!u.order && !u.waitUntil) {
            const nearby = s.groundUnits
              .filter(
                (p) =>
                  p.side === side &&
                  isInfantry(p.key) &&
                  !p.carrierId &&
                  !p.boardingId &&
                  !p.aiDefender &&
                  Math.hypot(p.x - u.x, p.z - u.z) < 110,
              )
              .map((p) => p.id);
            if (nearby.length && typeof boardGround(s, side, nearby, u.id) === 'number')
              u.waitUntil = s.time + 5;
          }
          if ((u.waitUntil || 0) > s.time) continue;
        }
        if (u.hp / u.maxHp < 0.25 && !u.order?.mode?.includes('retreat'))
          commandUnits(s, side, [u.id], 'retreat');
        else if (
          !u.order ||
          (!u.path.length && Math.hypot(u.x - hq.x, u.z - hq.z) > GROUND_UNITS[u.key].groundRange)
        )
          orderGround(s, side, [u.id], { x: hq.x, z: hq.z, targetId: hq.id, mode: 'attackmove' });
        if (u.key === 'operator') launchFPV(s, side, [u.id], hq);
      }
  }
}
