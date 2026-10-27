// Preserve the legacy side-one save shape, with an independent planner for each extra bot.
export function aiState(s, side = 1) {
  let plan;
  if (side === 1) plan = s.ai;
  else {
    s.aiBySide ||= {};
    plan = s.aiBySide[side] ||= { nextBuild: 7, nextAttack: 170, roadPlan: 0 };
  }
  plan.aiDefenseAt ??= 0;
  plan.aiGroundReserve ??= { amount: 0, nextAt: 0 };
  return plan;
}
