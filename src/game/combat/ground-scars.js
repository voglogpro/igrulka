import { validSide } from '../factions.js';
import { FIELD, seaDistance } from '../map.js';

export const GROUND_SCARS = { capacity: 96, life: 1200 };
const radii = {
  tank: 1.6,
  rocket: 3.2,
  artillery: 4.8,
  fpv: 1.2,
  drone: 2.1,
  heavy: 3.1,
  cruise: 4,
  ballistic: 6.5,
};
const known = (kind) => typeof kind === 'string' && Object.hasOwn(radii, kind);

export function recordGroundScar(s, e) {
  if (
    !['impact', 'crash'].includes(e.type) ||
    !known(e.key) ||
    !validSide(s, e.side) ||
    !Number.isSafeInteger(e.id) ||
    e.id <= 0 ||
    ![e.x, e.z, e.time].every(Number.isFinite) ||
    e.time < 0 ||
    e.time > s.time ||
    Math.abs(e.x) > FIELD.x ||
    Math.abs(e.z) > FIELD.z ||
    seaDistance(e.x, e.z) < 0
  )
    return;
  const scars = (s.groundScars ||= []);
  if (scars.some((scar) => scar.id === e.id)) return;
  const base = radii[e.key];
  const radius = Math.max(
    0.8,
    Math.min(base * 1.25, Math.max(base * 0.8, (e.radius || base) * 0.25)),
  );
  s.groundScars = scars.filter((scar) => s.time - scar.time < GROUND_SCARS.life);
  s.groundScars.push({ id: e.id, x: e.x, z: e.z, radius, kind: e.key, time: e.time, side: e.side });
  if (s.groundScars.length > GROUND_SCARS.capacity)
    s.groundScars.splice(0, s.groundScars.length - GROUND_SCARS.capacity);
}

export function restoreGroundScars(s, sourceVersion = s.version) {
  if (sourceVersion < 15) s.groundScars = [];
  if (!Array.isArray(s.groundScars) || s.groundScars.length > GROUND_SCARS.capacity)
    throw Error('Повреждены следы боя');
  const ids = new Set();
  s.groundScars = s.groundScars.map((scar) => {
    if (
      !scar ||
      !Number.isSafeInteger(scar.id) ||
      scar.id <= 0 ||
      ids.has(scar.id) ||
      !known(scar.kind) ||
      !validSide(s, scar.side) ||
      ![scar.x, scar.z, scar.radius, scar.time].every(Number.isFinite) ||
      Math.abs(scar.x) > FIELD.x ||
      Math.abs(scar.z) > FIELD.z ||
      scar.radius < 0.8 ||
      scar.radius > 12 ||
      scar.time < 0 ||
      scar.time > s.time
    )
      throw Error('Повреждены следы боя');
    ids.add(scar.id);
    return {
      id: scar.id,
      x: scar.x,
      z: scar.z,
      radius: scar.radius,
      kind: scar.kind,
      time: scar.time,
      side: scar.side,
    };
  });
}
