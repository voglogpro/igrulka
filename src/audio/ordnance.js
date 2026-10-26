import { pcm as rocket, sampleRate as rocketRate } from './samples/rocket-launch.js';
import { pcm as cruise, sampleRate as cruiseRate } from './samples/cruise-launch.js';
import { pcm as ballistic, sampleRate as ballisticRate } from './samples/ballistic-launch.js';
import { pcm as artillery, sampleRate as artilleryRate } from './samples/artillery-shot.js';
import { pcm as flight, sampleRate as flightRate } from './samples/missile-flight.js';
import { pcm as approach, sampleRate as approachRate } from './samples/missile-approach.js';

// Actual field recordings, cropped/filtered/normalised offline. No oscillators,
// generated noise or invented weapon layers are added to these samples.
// See assets/audio/LICENSE.md and ordnance-sources.json for exact provenance.
const recordings = {
    rocketLaunch: [rocket, rocketRate],
    cruiseLaunch: [cruise, cruiseRate],
    ballisticLaunch: [ballistic, ballisticRate],
    artillery: [artillery, artilleryRate],
    jet: [flight, flightRate],
    missileDive: [approach, approachRate],
  },
  decoded = new Map();

export function recordedOrdnanceSample(rate, name) {
  const recording = recordings[name];
  if (!recording || !Number.isFinite(rate) || rate <= 0) throw Error('Invalid recorded ordnance');
  const [pcm, nativeRate] = recording;
  if (!decoded.has(name)) {
    const bytes = atob(pcm),
      data = new Float32Array(bytes.length / 2);
    for (let i = 0; i < data.length; i++) {
      const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      data[i] = (value >= 32768 ? value - 65536 : value) / 32768;
    }
    decoded.set(name, data);
  }
  const source = decoded.get(name),
    output = new Float32Array(Math.max(1, Math.round((source.length * rate) / nativeRate)));
  for (let i = 0; i < output.length; i++) {
    const at = (i * nativeRate) / rate,
      index = Math.min(source.length - 1, Math.floor(at)),
      fraction = at - index,
      next = name === 'jet' ? (index + 1) % source.length : Math.min(index + 1, source.length - 1);
    output[i] = source[index] * (1 - fraction) + source[next] * fraction;
  }
  if (name !== 'jet') output[0] = output[output.length - 1] = 0;
  return output;
}

// Doppler changes playback of the recorded engine; it does not generate a tone.
export function recordedJetMix(unit, distance, listener) {
  const d = Math.max(0, distance),
    approach =
      d > 1
        ? ((listener.x - unit.x) * (unit.vx || 0) +
            (listener.y - (unit.y ?? 2)) * (unit.vy || 0) +
            (listener.z - unit.z) * (unit.vz || 0)) /
          d
        : 0,
    doppler = Math.max(0.84, Math.min(1.18, 343 / Math.max(240, 343 - approach)));
  return {
    rate: (unit.key === 'ballistic' ? 0.92 : 1.04) * doppler,
    gain: 0.27 * (260 / (260 + d)),
    cutoff: Math.max(900, Math.min(6000, 10000 * Math.exp(-d / 1100))),
  };
}
