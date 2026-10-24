import { recruit } from '../units/ground/recruitment.js';
import { COVER_PATCHES } from '../units/infantry/cover.js';
import { walkable } from '../units/ground/navigation.js';
import { GROUND_UNITS, isInfantry } from '../config.js';
import { orderGround, commandUnits } from '../units/ground/orders.js';
import { unloadGround, boardGround } from '../units/vehicles/transport.js';
import { launchFPV } from '../units/infantry/fpv.js';
import { updateDistrictAI } from './district-ai.js';
import { difficultyOf } from './difficulty.config.js';
export function updateArmyAI(s, hooks) {
  if (s.mode === 'multiplayer') return;
  const { random } = hooks;
  const level = difficultyOf(s);
  if (s.time > level.armyFrom && (s.ai.nextArmy || 0) < s.time) {
    s.ai.nextArmy = s.time + level.armyEvery;
    const ready = s.buildings.some(
        (b) => b.side === 1 && b.key === 'barracks' && b.hp > 0 && b.progress >= 1,
      ),
      f = s.sides[1];
    if (ready && f.credits > 700) {
      const choices = [
        'infantry',
        'machinegunner',
        'engineer',
        'mog',
        'sniper',
        'assault',
        'apc',
        ...(f.tech.includes('mobileAA') ? ['gepard'] : []),
        'armoredcar',
        ...(f.tech.includes('lightArmor') ? ['lighttank', 'ifv'] : []),
        ...(f.tech.includes('armor') ? ['leopard', 'atgm', 'tankdestroyer'] : []),
        ...(f.tech.includes('heavyArmor') ? ['heavytank'] : []),
        ...(f.tech.includes('artillery') ? ['howitzer'] : []),
        ...(f.tech.includes('rocketArtillery') ? ['mlrs'] : []),
        ...(f.tech.includes('fpvTeams') ? ['operator'] : []),
      ];
      const armorThreat = s.groundUnits.some(
        (u) => u.side === 0 && u.hp > 0 && u.key === 'leopard',
      );
      const antiArmor = s.groundUnits.filter(
        (u) => u.side === 1 && u.hp > 0 && ['atgm', 'tankdestroyer'].includes(u.key),
      ).length;
      const key =
        armorThreat && f.tech.includes('armor') && antiArmor < 2
          ? antiArmor
            ? 'tankdestroyer'
            : 'atgm'
          : choices[Math.floor(random(s) * choices.length)];
      recruit(s, 1, key, null, 1);
    }
    updateDistrictAI(s);
    const hq = s.buildings.find((b) => b.side === 0 && b.key === 'hq' && b.hp > 0);
    for (const u of s.groundUnits)
      if (
        u.side === 1 &&
        !u.carrierId &&
        !u.boardingId &&
        hq &&
        !GROUND_UNITS[u.key].support &&
        !u.downed
      ) {
        if (u.guard) continue;
        if (u.delivery) continue;
        if (u.routeState) continue;
        if (u.aiDefender && u.hp / u.maxHp > 0.35) {
          const own = s.buildings.find((b) => b.side === 1 && b.key === 'hq');
          u.defensePoint ||= COVER_PATCHES.filter(
            (p) =>
              p.forest &&
              walkable(s, p.x, p.z, GROUND_UNITS[u.key].size * 0.42) &&
              p.x > 150 &&
              p.x < own.x &&
              Math.hypot(p.x - own.x, p.z - own.z) < 420,
          ).sort(
            (a, b) => Math.hypot(a.x - u.x, a.z - u.z) - Math.hypot(b.x - u.x, b.z - u.z),
          )[0] || { x: own.x - 100, z: 100 };
          if (Math.hypot(u.x - u.defensePoint.x, u.z - u.defensePoint.z) > 8) {
            if (!u.path?.length) orderGround(s, 1, [u.id], u.defensePoint);
          } else {
            if (!u.trenchId) commandUnits(s, 1, [u.id], 'dig');
            u.camouflaged = true;
          }
          continue;
        }
        if (GROUND_UNITS[u.key].capacity) {
          const passengers = s.groundUnits.filter((p) => p.carrierId === u.id);
          if (
            passengers.length &&
            (Math.hypot(u.x - hq.x, u.z - hq.z) < 260 || u.hp / u.maxHp < 0.5)
          )
            unloadGround(s, 1, u.id);
          if (!u.order && !u.waitUntil) {
            const nearby = s.groundUnits
              .filter(
                (p) =>
                  p.side === 1 &&
                  isInfantry(p.key) &&
                  !p.carrierId &&
                  !p.boardingId &&
                  !p.aiDefender &&
                  Math.hypot(p.x - u.x, p.z - u.z) < 110,
              )
              .map((p) => p.id);
            if (nearby.length && typeof boardGround(s, 1, nearby, u.id) === 'number')
              u.waitUntil = s.time + 5;
          }
          if ((u.waitUntil || 0) > s.time) continue;
        }
        if (u.hp / u.maxHp < 0.25 && !u.order?.mode?.includes('retreat'))
          commandUnits(s, 1, [u.id], 'retreat');
        else if (
          !u.order ||
          (!u.path.length && Math.hypot(u.x - hq.x, u.z - hq.z) > GROUND_UNITS[u.key].groundRange)
        )
          orderGround(s, 1, [u.id], { x: hq.x, z: hq.z, targetId: hq.id, mode: 'attackmove' });
        if (u.key === 'operator') launchFPV(s, 1, [u.id], hq);
      }
  }
}
