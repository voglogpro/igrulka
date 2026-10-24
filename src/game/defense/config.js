export const FORTIFICATION = Object.freeze({
  baseSeconds: 12,
  engineerSpeed: 2,
  secondLevel: 30,
  maxWork: 90,
  cover: [0, 0.72, 0.78, 0.82],
  concealment: [0, 0.55, 0.6, 0.65],
  creditsPerWork: 0.2,
  materialsPerWork: 0.015,
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
  maxReinforcing: 3,
  maxNewAssignments: 2,
  reserveShare: 1 / 3,
  donorMinimum: 2,
  donorShare: 0.5,
  pressureThreshold: 1.15,
  maxTransferDistance: 620,
  minDuty: 12,
  maxDuty: 24,
  calmSeconds: 6,
  cooldown: 12,
});

export const FRONT_SECTORS = Object.freeze([
  { id: 'north-rear', label: 'Северный фланг', z: -450 },
  { id: 'north', label: 'Северный мост', z: -270 },
  { id: 'center', label: 'Городской центр', z: 0 },
  { id: 'south', label: 'Южный мост', z: 270 },
  { id: 'south-rear', label: 'Южный фланг', z: 450 },
]);

export function sectorAt(z) {
  return FRONT_SECTORS.reduce((best, sector) =>
    Math.abs(z - sector.z) < Math.abs(z - best.z) ? sector : best,
  );
}
