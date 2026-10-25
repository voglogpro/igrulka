import { DISTRICTS, DISTRICT_BY_ID } from './districts.config.js';
import { createDistricts, districtState } from './state.js';
import { allied, teamOf, validSide } from '../factions.js';

const legacyHp = { 'north-depot': 360, 'north-relay': 300, 'south-relay': 300, 'south-depot': 360 };
const sign = (s, side) => (teamOf(s, side) === 0 ? 1 : -1);

// Only old campaigns receive neutral sites; malformed current data is never silently replaced.
export function restoreDistricts(s, sourceVersion = s.version) {
  if (sourceVersion < 9 && s.districts == null) s.districts = createDistricts();
  if (sourceVersion < 17 && Array.isArray(s.districts) && s.districts.length === 4) {
    const ids = new Set();
    for (const d of s.districts) {
      if (
        !d ||
        !Object.hasOwn(legacyHp, d.id) ||
        ids.has(d.id) ||
        ![null, 0, 1].includes(d.owner) ||
        ![null, 0, 1].includes(d.capturing) ||
        !Number.isFinite(d.control) ||
        Math.abs(d.control) > 1 ||
        (d.owner !== null && d.control * sign(s, d.owner) <= 0) ||
        !Number.isFinite(d.hp) ||
        d.hp < 0 ||
        d.hp > legacyHp[d.id] ||
        !['contested', 'blocked', 'repairing'].every((key) => typeof d[key] === 'boolean') ||
        (d.owner === null && (d.blocked || d.repairing))
      )
        throw Error('Повреждён район');
      ids.add(d.id);
    }
    const old = s.districts;
    s.districts = createDistricts().map((d) => {
      const pair = old.filter((value) =>
        value.id.startsWith(d.id.startsWith('north') ? 'north-' : 'south-'),
      );
      const owners = pair.filter((value) => value.owner !== null).map((value) => value.owner);
      const owner =
        owners.length && owners.every((side) => allied(s, side, owners[0])) ? owners[0] : null;
      const hp =
        (pair.reduce((sum, value) => sum + value.hp / legacyHp[value.id], 0) / pair.length) *
        DISTRICT_BY_ID[d.id].hp;
      return {
        ...d,
        owner,
        control: owner === null ? 0 : sign(s, owner),
        hp,
        repairing:
          owner !== null && hp < DISTRICT_BY_ID[d.id].hp && pair.some((value) => value.repairing),
      };
    });
  }
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
      (d.owner !== null && !validSide(s, d.owner)) ||
      (d.capturing !== null && !validSide(s, d.capturing)) ||
      !Number.isFinite(d.control) ||
      Math.abs(d.control) > 1 ||
      (d.owner !== null && d.control * sign(s, d.owner) <= 0) ||
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
