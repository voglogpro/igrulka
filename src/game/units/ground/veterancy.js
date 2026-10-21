// Fictional progression: earned damage is capped per hit and per unit.
export const VETERAN_XP_CAP = 450;
export const VETERAN_THRESHOLDS = [0, 60, 180, 360];

export function veteranRank(unit) {
  const xp = Number.isFinite(unit?.xp) ? Math.max(0, Math.min(VETERAN_XP_CAP, unit.xp)) : 0;
  for (let rank = VETERAN_THRESHOLDS.length - 1; rank > 0; rank--)
    if (xp >= VETERAN_THRESHOLDS[rank]) return rank;
  return 0;
}

export function gainGroundExperience(s, sourceId, damage, kill = false) {
  if (!Number.isFinite(damage) || damage <= 0) return 0;
  const unit = s.groundUnits?.find((u) => u.id === sourceId && u.hp > 0);
  if (!unit) return 0;
  const before = veteranRank(unit);
  unit.xp = Math.min(
    VETERAN_XP_CAP,
    Math.max(0, unit.xp || 0) + Math.min(24, damage) + (kill ? 16 : 0),
  );
  const after = veteranRank(unit);
  if (after > before) return after;
  return 0;
}

export const veteranAccuracy = (unit) => 1 - veteranRank(unit) * 0.035;
export const veteranSuppression = (unit) => 1 - veteranRank(unit) * 0.04;
