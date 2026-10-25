import { BUILDINGS } from '../config.js';

const object = (value) => value && typeof value === 'object' && !Array.isArray(value);
const timer = (value) => Number.isFinite(value) && value >= 0;
function restorePlan(plan) {
  if (
    !object(plan) ||
    !timer(plan.nextBuild) ||
    !timer(plan.nextAttack) ||
    (plan.nextArmy != null && !timer(plan.nextArmy)) ||
    (plan.roadPlan != null &&
      (!Number.isSafeInteger(plan.roadPlan) || plan.roadPlan < 0 || plan.roadPlan > 10000)) ||
    (plan.plannedBuild != null && !Object.hasOwn(BUILDINGS, plan.plannedBuild))
  )
    throw Error('Повреждён план города бота');
  return Object.fromEntries(
    ['nextBuild', 'nextAttack', 'roadPlan', 'nextArmy', 'plannedBuild']
      .filter((key) => Object.hasOwn(plan, key))
      .map((key) => [key, plan[key]]),
  );
}
export function restoreAI(s) {
  s.ai = restorePlan(s.ai);
  if (s.sides.length === 4) {
    if (!object(s.aiBySide) || Object.keys(s.aiBySide).some((key) => key !== '3'))
      throw Error('Повреждены города ботов');
    s.aiBySide = { 3: restorePlan(s.aiBySide[3]) };
  } else if (s.aiBySide != null) {
    if (!object(s.aiBySide) || Object.keys(s.aiBySide).length) throw Error('Лишний город бота');
    delete s.aiBySide;
  }
}
