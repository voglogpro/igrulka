import { DISTRICTS, DISTRICT_BY_ID } from './districts.config.js';
import { createDistricts, districtState } from './state.js';

// Only old campaigns receive neutral sites; malformed current data is never silently replaced.
export function restoreDistricts(s) {
  if (s.version < 9 && s.districts == null) s.districts = createDistricts();
  if (!Array.isArray(s.districts) || s.districts.length !== DISTRICTS.length)
    throw Error('Повреждены районы');
  const ids = new Set();
  for (const d of s.districts) {
    const config =
      d && typeof d.id === 'string' && Object.hasOwn(DISTRICT_BY_ID, d.id)
        ? DISTRICT_BY_ID[d.id]
        : null;
    if (
      !config ||
      ids.has(d.id) ||
      ![null, 0, 1].includes(d.owner) ||
      ![null, 0, 1].includes(d.capturing) ||
      !Number.isFinite(d.control) ||
      Math.abs(d.control) > 1 ||
      (d.owner === 0 && d.control <= 0) ||
      (d.owner === 1 && d.control >= 0) ||
      !Number.isFinite(d.hp) ||
      d.hp < 0 ||
      d.hp > config.hp ||
      !['contested', 'blocked', 'repairing'].every((key) => typeof d[key] === 'boolean') ||
      (d.owner == null && (d.blocked || d.repairing))
    )
      throw Error('Повреждён район');
    ids.add(d.id);
  }
  // Canonical order keeps map cards and side projections deterministic.
  s.districts = DISTRICTS.map((config) =>
    districtState(s.districts.find((d) => d.id === config.id)),
  );
}
