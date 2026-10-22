const id = (value) => value == null || (Number.isSafeInteger(value) && value > 0);
const point = (p) =>
  p === null ||
  (p &&
    typeof p === 'object' &&
    !Array.isArray(p) &&
    [p.x, p.z].every(Number.isFinite) &&
    Math.abs(p.x) <= 850 &&
    Math.abs(p.z) <= 560 &&
    ['move', 'attackmove'].includes(p.mode));
export function validateSquadMetadata(value, queued = false) {
  if (
    !id(value.squadId) ||
    (value.squadSlot != null &&
      (!Number.isInteger(value.squadSlot) || value.squadSlot < 0 || value.squadSlot > 4))
  )
    throw Error('Повреждено пополнение отряда');
  const key = queued ? 'destination' : 'squadGoal';
  if (Object.hasOwn(value, key)) {
    if (!point(value[key])) throw Error('Повреждена точка пополнения');
    const p = value[key];
    value[key] = p === null ? null : { x: p.x, z: p.z, mode: p.mode };
  }
}
