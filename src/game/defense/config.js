import { CORRIDORS } from '../map.js';

// A position keeps growing while it is manned: a scrape becomes a trench, a revetted trench,
// a checkpoint, a covered strongpoint with a log roof, and finally a concrete fort.
// Work thresholds are cumulative builder-seconds; the last two stages cost more per second.
export const FORTIFICATION = Object.freeze({
  baseSeconds: 12,
  engineerSpeed: 2,
  secondLevel: 30,
  thresholds: [30, 90, 210, 390],
  maxWork: 390,
  cover: [0, 0.72, 0.78, 0.82, 0.86, 0.9],
  concealment: [0, 0.55, 0.6, 0.65, 0.7, 0.74],
  creditsPerWork: 0.2,
  materialsPerWork: 0.015,
  // Timber and concrete for the strongpoint and fort stages, from 90 work onward.
  heavyFrom: 90,
  heavyCreditsPerWork: 0.4,
  heavyMaterialsPerWork: 0.035,
  postRadius: 4,
  coverRadius: 5,
  suppressionLimit: 0.3,
  maxPositions: 240,
});

export const FRONTLINE = Object.freeze({
  cadence: 1,
  memorySeconds: 45,
  maxSeen: 120,
  contactStrength: 0.65,
  maxReinforcing: 6,
  maxNewAssignments: 2,
  reserveShare: 1 / 3,
  donorMinimum: 2,
  donorShare: 0.5,
  pressureThreshold: 1.15,
  maxTransferDistance: 620,
  rearTransferDistance: 2200,
  crossTransferDistance: 3600,
  minDuty: 12,
  maxDuty: 24,
  calmSeconds: 6,
  cooldown: 12,
  // The unsecured home line holds the inner tree line in front of each bank.
  homeLineX: 330,
  treeSnap: 20,
  territoryAdvance: 40,
  postGap: 80,
  edgeCoverage: 48,
  shoreClearance: 94,
  edgeMargin: 8,
  supportOffset: 40,
  rowSpacing: 40,
  maxRows: 20,
  maxPathAttempts: 6,
  captureLimit: 8,
  capturePerSite: 4,
  reinforcementCadence: 3,
});

// Only the two connected land corridors form the ground front.
// Older coastal tasks are cleared by the state-14 migration before validation.
export const FRONT_SECTORS = Object.freeze([
  { id: 'north', label: 'Северный коридор', z: CORRIDORS[0] },
  { id: 'south', label: 'Южный коридор', z: CORRIDORS[1] },
]);

export function sectorAt(z) {
  return FRONT_SECTORS.reduce((best, sector) =>
    Math.abs(z - sector.z) < Math.abs(z - best.z) ? sector : best,
  );
}
