import { aiState } from './state.js';
import { aiSides } from '../factions.js';
import { recruit } from '../units/ground/recruitment.js';
import { updateDistrictAI } from './district-ai.js';
import { difficultyOf } from './difficulty.config.js';
import { chooseArmyRecruit, needsDepotInfantry, infrastructureReserve } from './depot-doctrine.js';
import { defenseAttackStatus, launchDefenseAttack } from '../units/ground/defense-attack.js';

// The decision clock survives loading: a cold mid-second save must not issue
// fresh orders early. The shared coordinator still owns all actual positions.
export const needsCaptureInfantry = needsDepotInfantry;

// Called only by city AI's existing attack clock. One shared operation leaves
// the majority at their posts and cannot be duplicated by repeated air attacks.
export function launchAIAssault(s, side) {
  if (s.result || !aiSides(s).includes(side) || s.time <= difficultyOf(s).armyFrom + 180) return 0;
  const status = defenseAttackStatus(s, side);
  if (!status.ok || status.eligible < 8 || status.active || status.returning) return 0;
  let established = 0;
  for (const u of s.groundUnits)
    if (
      u.side === side &&
      u.hp > 0 &&
      u.autoDefense &&
      u.guard &&
      u.defensePost &&
      u.stance?.mode === 'defend'
    )
      established++;
  return established >= 8 ? launchDefenseAttack(s, side) : 0;
}

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
  // The minimum three paid capture infantry are a bounded early investment.
  // Waiting for an entire future escalated building quote can postpone both
  // depot captures indefinitely; ordinary mixed reinforcements still protect it.
  const reserve = needsDepotInfantry(s, side) ? 250 : Math.max(250, planned);
  const key = chooseArmyRecruit(s, side, facilities, { reserve });
  if (key) recruit(s, side, key, null, 1);
}
