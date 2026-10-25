import {
  GUNS,
  gunshot,
  explosion,
  whoosh,
  whistle,
  clicks,
  dieselLoop,
  jetLoop,
  impulseResponse,
  sirenLoop,
  mopedLoop,
  rainLoop,
} from './synth.js';
import { recordedEngineLoop } from './engines.js';
import { recordedGroundSample } from './footsteps.js';
import { rocketIgnition, missileDive } from './missiles.js';

// Same presets and number of random variants as the original unlock bank.
// Both worker and idle fallback execute this one catalog; no second DSP implementation.
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
  add('jet', () => jetLoop(rate), true);
  add('moped', () => recordedEngineLoop(rate, 'prop', mopedLoop(rate)), true);
  add('siren', () => sirenLoop(rate), true);
  add('rain', () => rainLoop(rate), true);
  for (let i = 0; i < 3; i++) add('footstep', () => recordedGroundSample(rate, 'footstep', i));
  for (const key of ['rifle', 'mg', 'hmg', 'shilka', 'autocannon', 'blast', 'tank'])
    if (GUNS[key]) add(key, () => gunshot(rate, GUNS[key]));
  add('blast', () => explosion(rate, 1.2));
  add('blastSmall', () => explosion(rate, 0.75));
  add('whoosh', () => whoosh(rate, 1.4));
  for (const key of Object.keys(GUNS)) add(key, () => gunshot(rate, GUNS[key]));
  for (const key of ['rifle', 'mg', 'hmg', 'shilka']) add(key, () => gunshot(rate, GUNS[key]));
  add('blastLarge', () => explosion(rate, 2.2));
  add('blastSmall', () => explosion(rate, 0.85));
  add('blast', () => explosion(rate, 1.35));
  add('atgm', () => whoosh(rate, 0.9));
  add('whistle', () => whistle(rate, 1.3));
  add('reload', () => clicks(rate));
  add('rocketLaunch', () => rocketIgnition(rate));
  add('ballisticLaunch', () => rocketIgnition(rate, true));
  add('missileDive', () => missileDive(rate));
  return jobs;
}
