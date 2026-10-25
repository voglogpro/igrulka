import { CORRIDORS } from '../map.js';

// Fictional strategic sites in the land corridors; pairs are mirrored through the centre.
export const DISTRICT_TYPES = {
  depot: {
    name: 'Склад снабжения',
    income: 0.5,
    materials: 0.1,
    science: 0,
    outputBonus: 0.15,
    hp: 360,
  },
};
export const DISTRICTS = [
  { id: 'north-depot', name: 'Север · склад', type: 'depot', x: 0, z: CORRIDORS[0] },
  { id: 'south-depot', name: 'Юг · склад', type: 'depot', x: 0, z: CORRIDORS[1] },
].map((d) => ({ ...DISTRICT_TYPES[d.type], ...d, radius: 64 }));
export const DISTRICT_BY_ID = Object.fromEntries(DISTRICTS.map((d) => [d.id, d]));
export const DISTRICT_RULES = {
  captureSeconds: 22,
  neutralizeSeconds: 12,
  maxCaptureStrength: 3,
  extraCaptureSpeed: 0.25,
  suppressionLimit: 0.8,
  decayPerSecond: 0.035,
  repairPerSecond: 16,
  repairCreditsPerHp: 0.4,
  repairMaterialsPerHp: 0.02,
};
