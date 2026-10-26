import { recordedOrdnanceSample } from './ordnance.js';

// Retain the former helper API for callers; its weapon sounds now come from
// downloaded field recordings rather than generated noise or oscillator tones.
export function rocketIgnition(sampleRate, large = false) {
  return recordedOrdnanceSample(sampleRate, large ? 'ballisticLaunch' : 'rocketLaunch');
}

export function missileDive(sampleRate) {
  return recordedOrdnanceSample(sampleRate, 'missileDive');
}
