import { CORRIDORS, DISTRICT_X } from '../map.js';

// Fictional strategic sites in the land corridors; pairs are mirrored through the centre.
export const DISTRICT_TYPES = {
  depot: { name: 'Склад снабжения', income: 0.4, materials: 0.6, science: 0, hp: 360 },
  relay: { name: 'Узел связи', income: 1.25, materials: 0, science: 0.35, hp: 300 },
};
export const DISTRICTS = [
  { id: 'north-depot', name: 'Север · склад', type: 'depot', x: -DISTRICT_X, z: CORRIDORS[0] },
  { id: 'north-relay', name: 'Север · связь', type: 'relay', x: DISTRICT_X, z: CORRIDORS[0] },
  { id: 'south-relay', name: 'Юг · связь', type: 'relay', x: -DISTRICT_X, z: CORRIDORS[1] },
  { id: 'south-depot', name: 'Юг · склад', type: 'depot', x: DISTRICT_X, z: CORRIDORS[1] },
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
