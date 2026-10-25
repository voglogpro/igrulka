// Resolve passengers to their carrier once, then validate ownership against the
// same snapshot. A large selection does not search the whole army for every ID.
export function resolveArmySelection(state, ids) {
  const byId = new Map(state.groundUnits.map((unit) => [unit.id, unit]));
  const result = [],
    seen = new Set();
  for (const id of ids) {
    const resolved = byId.get(id)?.carrierId || id;
    const unit = byId.get(resolved);
    if (!unit || unit.side !== 0 || unit.hp <= 0 || seen.has(resolved)) continue;
    seen.add(resolved);
    result.push(resolved);
  }
  return result;
}
