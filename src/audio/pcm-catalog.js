import {
  GUNS,
  gunshot,
  explosion,
  whoosh,
  clicks,
  dieselLoop,
  impulseResponse,
  sirenLoop,
  mopedLoop,
} from './synth.js';
import { recordedEngineLoop } from './engines.js';
import { recordedGroundSample } from './footsteps.js';
import { recordedOrdnanceSample } from './ordnance.js';

// Existing rifle/ambience presets and variants stay intact; ordnance uses the
// recordings below. Worker and idle fallback execute this same catalog.
export function pcmCatalog(rate) {
  const jobs = [],
    counts = new Map();
  const add = (name, make, loop = false) => {
    const variant = counts.get(name) || 0;
    counts.set(name, variant + 1);
    jobs.push({ name, variant, loop, make });
  };
  add('impulse', () => impulseResponse(rate), true);
  add('diesel', () => dieselLoop(rate), true);
  add('truck', () => recordedGroundSample(rate, 'truck'), true);
  add('rotor', () => recordedEngineLoop(rate, 'rotor'), true);
  add('jet', () => recordedOrdnanceSample(rate, 'jet'), true);
  add('moped', () => recordedEngineLoop(rate, 'prop', mopedLoop(rate)), true);
  add('siren', () => sirenLoop(rate), true);
  for (let i = 0; i < 3; i++) add('footstep', () => recordedGroundSample(rate, 'footstep', i));
  for (const key of ['rifle', 'mg', 'hmg', 'shilka', 'autocannon', 'blast', 'tank'])
    if (GUNS[key]) add(key, () => gunshot(rate, GUNS[key]));
  add('blast', () => explosion(rate, 1.2));
  add('blastSmall', () => explosion(rate, 0.75));
  add('whoosh', () => whoosh(rate, 1.4));
  for (const key of Object.keys(GUNS))
    if (key !== 'artillery') add(key, () => gunshot(rate, GUNS[key]));
  for (const key of ['rifle', 'mg', 'hmg', 'shilka']) add(key, () => gunshot(rate, GUNS[key]));
  add('blastLarge', () => explosion(rate, 2.2));
  add('blastSmall', () => explosion(rate, 0.85));
  add('blast', () => explosion(rate, 1.35));
  add('atgm', () => recordedOrdnanceSample(rate, 'rocketLaunch'));
  add('whistle', () => recordedOrdnanceSample(rate, 'missileDive'));
  add('reload', () => clicks(rate));
  for (const name of [
    'artillery',
    'rocketLaunch',
    'cruiseLaunch',
    'ballisticLaunch',
    'missileDive',
  ])
    add(name, () => recordedOrdnanceSample(rate, name));
  return jobs;
}
