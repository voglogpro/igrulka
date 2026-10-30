import { BUILDINGS } from '../config.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const timer = (value) => Number.isFinite(value) && value >= 0;
function restorePlan(s, plan) {
  if (
    !object(plan) ||
    !timer(plan.nextBuild) ||
    !timer(plan.nextAttack) ||
    (plan.nextArmy != null && !timer(plan.nextArmy)) ||
    (plan.nextStrike != null && !timer(plan.nextStrike)) ||
    (plan.roadPlan != null &&
      (!Number.isSafeInteger(plan.roadPlan) || plan.roadPlan < 0 || plan.roadPlan > 10000)) ||
    (plan.plannedBuild != null && !Object.hasOwn(BUILDINGS, plan.plannedBuild))
  )
    throw Error('Повреждён план города бота');
  const aiDefenseAt = s.version < 20 ? 0 : (plan.aiDefenseAt ?? 0),
    reserve =
      s.version < 20
        ? { amount: 0, nextAt: 0 }
        : (plan.aiGroundReserve ?? { amount: 0, nextAt: 0 });
  if (
    !timer(aiDefenseAt) ||
    aiDefenseAt > s.time + 1 + 1e-6 ||
    !object(reserve) ||
    Object.keys(reserve).length !== 2 ||
    !Object.hasOwn(reserve, 'amount') ||
    !Object.hasOwn(reserve, 'nextAt') ||
    !timer(reserve.amount) ||
    reserve.amount > 700 ||
    !timer(reserve.nextAt) ||
    reserve.nextAt > s.time + 1 + 1e-6
  )
    throw Error('Повреждён такт армии бота');
  const restored = Object.fromEntries(
    ['nextBuild', 'nextAttack', 'roadPlan', 'nextArmy', 'nextStrike', 'plannedBuild']
      .filter((key) => Object.hasOwn(plan, key))
      .map((key) => [key, plan[key]]),
  );
  return {
    ...restored,
    aiDefenseAt,
    aiGroundReserve: { amount: reserve.amount, nextAt: reserve.nextAt },
  };
}
export function restoreAI(s) {
  s.ai = restorePlan(s, s.ai);
  const extra = s.sides.length === 4 ? '3' : s.sides.length === 3 ? '2' : null;
  if (extra) {
    if (
      !object(s.aiBySide) ||
      Object.keys(s.aiBySide).length !== 1 ||
      !Object.hasOwn(s.aiBySide, extra)
    )
      throw Error('Повреждены города ботов');
    s.aiBySide = { [extra]: restorePlan(s, s.aiBySide[extra]) };
  } else if (s.aiBySide != null) {
    if (!object(s.aiBySide) || Object.keys(s.aiBySide).length) throw Error('Лишний город бота');
    delete s.aiBySide;
  }
}
