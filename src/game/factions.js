// Ownership stays per city. Teams only decide friendship, targeting and victory.
export const sideIds = (s) => Array.from({ length: s.sides.length }, (_, i) => i);
export const validSide = (s, side) => Number.isInteger(side) && side >= 0 && side < s.sides.length;
export const teamOf = (s, side) =>
  validSide(s, side) ? (s.sides.length === 4 ? side % 2 : side) : null;
export const allied = (s, a, b) =>
  validSide(s, a) && validSide(s, b) && teamOf(s, a) === teamOf(s, b);
export const hostile = (s, a, b) =>
  validSide(s, a) && validSide(s, b) && teamOf(s, a) !== teamOf(s, b);
export const pairedEnemy = (s, side) => (validSide(s, side) ? side ^ 1 : null);
export const hqOf = (s, side) => s.buildings.find((b) => b.side === side && b.key === 'hq') || null;
export const aiSides = (s) =>
  s.mode === 'multiplayer' ? [] : sideIds(s).filter((side) => side % 2 === 1);
