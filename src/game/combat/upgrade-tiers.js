// Equipment levels never alter damage, hit points or earned veterancy.
export const UPGRADE_TIERS = {
  range: [1, 1.08, 1.16],
  spread: [1, 0.84, 0.68],
  rate: [1, 1.12, 1.25],
  production: [1, 1.25, 1.5],
  fleet: [2, 3, 4],
};
const modifiersByLevel = [0, 1, 2].map((level) =>
  Object.freeze(
    Object.fromEntries(Object.entries(UPGRADE_TIERS).map(([key, values]) => [key, values[level]])),
  ),
);
// A faster belt-fed gun needs cooling and barrel control as well as a faster
// trigger. Keep both existing upgrades; health, damage and ammo stay unchanged.
export const MOG_UPGRADE_TIERS = {
  range: [1, 1.12, 1.24],
  spread: [0.9, 0.67, 0.45],
  cooling: [1, 1.25, 1.5],
  heat: [1, 0.84, 0.67],
};
const mogModifiersByLevel = modifiersByLevel.map((modifiers, level) =>
  Object.freeze({
    ...modifiers,
    ...Object.fromEntries(
      Object.entries(MOG_UPGRADE_TIERS).map(([key, values]) => [key, values[level]]),
    ),
  }),
);
export const isMogDefense = (entity) => entity?.key === 'mog' || entity?.key === 'gun';
export const MOG_FINAL_UPGRADE_COST = 500;
export function equipmentModifiers(entity) {
  const level = Number.isInteger(entity?.level) ? Math.max(0, Math.min(2, entity.level)) : 0;
  return (isMogDefense(entity) ? mogModifiersByLevel : modifiersByLevel)[level];
}
