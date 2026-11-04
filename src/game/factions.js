// Ownership stays per city. Teams only decide friendship, targeting and victory.
export const sideIds = (s) => Array.from({ length: s.sides.length }, (_, i) => i);
export const validSide = (s, side) => Number.isInteger(side) && side >= 0 && side < s.sides.length;
// Four cities form two teams of two; three cities (one player against two bots) put the
// player alone on team 0. Two cities are simply one team each.
export const teamOf = (s, side) =>
  validSide(s, side)
    ? s.mode === 'ffa'
      ? side
      : s.sides.length === 4
        ? side % 2
        : s.sides.length === 3
          ? Math.min(side, 1)
          : side
    : null;
// Free-for-all gives every city its own team; all other modes have exactly two teams.
export const teamCount = (s) => (s.mode === 'ffa' ? s.sides.length : 2);
// Presence of every team other than `team`, from per-team counts.
export const opposedPresence = (teams, team) =>
  teams.reduce((n, count, i) => (i === team ? n : n + count), 0);
export const contestedPresence = (teams) => teams.filter((n) => n > 0).length > 1;
export const allied = (s, a, b) =>
  validSide(s, a) && validSide(s, b) && teamOf(s, a) === teamOf(s, b);
export const hostile = (s, a, b) =>
  validSide(s, a) && validSide(s, b) && teamOf(s, a) !== teamOf(s, b);
export const hqOf = (s, side) => s.buildings.find((b) => b.side === side && b.key === 'hq') || null;
// The opposing city on the same front. Against two bots the player faces the first bot that
// still has a headquarters, and both bots face the player.
export const pairedEnemy = (s, side) => {
  if (!validSide(s, side)) return null;
  if (s.mode === 'ffa') {
    // The opposite city across the sea first, then the nearest surviving rival.
    if (hqOf(s, side ^ 1)?.hp > 0) return side ^ 1;
    const own = hqOf(s, side);
    let best = side ^ 1,
      range = Infinity;
    for (const other of sideIds(s)) {
      const hq = hqOf(s, other);
      if (other === side || !(hq?.hp > 0)) continue;
      const d = own ? Math.hypot(hq.x - own.x, hq.z - own.z) : other;
      if (d < range) [best, range] = [other, d];
    }
    return best;
  }
  if (s.sides.length !== 3) return side ^ 1;
  if (side) return 0;
  return hqOf(s, 1)?.hp > 0 || !(hqOf(s, 2)?.hp > 0) ? 1 : 2;
};
// In 'war' the player's allied city on team 0 is a bot as well.
export const aiSides = (s) =>
  s.mode === 'multiplayer'
    ? []
    : sideIds(s).filter(
        (side) => teamOf(s, side) === 1 || ((s.mode === 'war' || s.mode === 'ffa') && side !== 0),
      );
// Ground direction toward the enemy bank: the western team advances along +x.
// In free-for-all the western cities (even sides) advance east and the eastern ones west.
export const frontDirection = (s, side) =>
  s.mode === 'ffa' ? (side % 2 ? -1 : 1) : teamOf(s, side) === 1 ? -1 : 1;
// Land corridors a city holds. A city on the bank's centre line holds both; the northern and
// southern cities of a four- or three-city game hold the corridor on their own side.
export function frontIds(s, side) {
  const hq = hqOf(s, side);
  return s.sides.length <= 2 || !hq || Math.abs(hq.z) < 1
    ? ['north', 'south']
    : [hq.z < 0 ? 'north' : 'south'];
}
// True when a point lies on the half of the map this city defends.
export function onOwnFront(s, side, z) {
  const fronts = frontIds(s, side);
  return fronts.length === 2 || (fronts[0] === 'north' ? z <= 0 : z >= 0);
}
