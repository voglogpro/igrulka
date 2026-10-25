// Preserve the legacy side-one save shape, with an independent planner for each extra bot.
export function aiState(s, side = 1) {
  if (side === 1) return s.ai;
  s.aiBySide ||= {};
  return (s.aiBySide[side] ||= { nextBuild: 7, nextAttack: 170, roadPlan: 0 });
}
