import { aiState } from './state.js';
import { aiSides } from '../factions.js';
import { recruit } from '../units/ground/recruitment.js';
import { updateDistrictAI } from './district-ai.js';
import { difficultyOf } from './difficulty.config.js';
import { chooseArmyRecruit, needsDepotInfantry, infrastructureReserve } from './depot-doctrine.js';

// The decision clock survives loading: a cold mid-second save must not issue
// fresh orders early. The shared coordinator still owns all actual positions.
export const needsCaptureInfantry = needsDepotInfantry;

export function updateArmyAI(s, _hooks, side = 1) {
  if (s.result || !aiSides(s).includes(side)) return;
  const memory = aiState(s, side);
  if (memory.aiDefenseAt <= s.time) {
    memory.aiDefenseAt = s.time + 1;
    updateDistrictAI(s, side);
  }
  const level = difficultyOf(s);
  if (s.time <= level.armyFrom || (memory.nextArmy || 0) >= s.time) return;
  memory.nextArmy = s.time + level.armyEvery;
  const facilities = new Set(
    s.buildings
      .filter((b) => b.side === side && b.hp > 0 && b.progress >= 1 && !b.demolished)
      .map((b) => b.key),
  );
  const planned = infrastructureReserve(s, side, memory.plannedBuild);
  const key = chooseArmyRecruit(s, side, facilities, { reserve: Math.max(250, planned) });
  if (key) recruit(s, side, key, null, 1);
}
