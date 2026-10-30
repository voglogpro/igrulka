import { compressV23X } from '../../src/game/map.js';

// Writes a current-layout fixture in the state-22 coordinate frame, so tests of older save
// versions can build towns with current helpers and then import them through migration.
const X = new Set([
  'x',
  'ax',
  'bx',
  'tx',
  'startX',
  'prevX',
  'originX',
  'targetX',
  'fromX',
  'threatX',
]);
function compress(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (X.has(key) && Number.isFinite(child)) value[key] = compressV23X(child);
    else if (child && typeof child === 'object') compress(child);
  }
}
export function toV22Layout(s) {
  for (const key of [
    'buildings',
    'roads',
    'groundUnits',
    'units',
    'trenches',
    'serviceVehicles',
    'ammoVehicles',
    'ammoCrates',
    'groundScars',
    'ships',
    'projectiles',
    'contacts',
    'frontlineMemory',
  ])
    compress(s[key]);
  return s;
}
