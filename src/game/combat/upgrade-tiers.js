// Equipment levels never alter damage, hit points or earned veterancy.
export const UPGRADE_TIERS = {
  range: [1, 1.08, 1.16],
  spread: [1, 0.84, 0.68],
  rate: [1, 1.12, 1.25],
  production: [1, 1.25, 1.5],
  fleet: [2, 3, 4],
};
export function equipmentModifiers(entity) {
  const level = Number.isInteger(entity?.level) ? Math.max(0, Math.min(2, entity.level)) : 0;
  return Object.fromEntries(
    Object.entries(UPGRADE_TIERS).map(([key, values]) => [key, values[level]]),
  );
}
