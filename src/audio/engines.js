import { pcm as rotorPCM, sampleRate as rotorRate } from './samples/fpv-rotor.js';
import { pcm as propPCM, sampleRate as propRate } from './samples/prop-engine.js';

const decoded = new Map();
function recording(kind) {
  if (!decoded.has(kind)) {
    const bytes = atob(kind === 'rotor' ? rotorPCM : propPCM);
    const data = new Float32Array(bytes.length / 2);
    for (let i = 0; i < data.length; i++) {
      const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      data[i] = (value >= 32768 ? value - 65536 : value) / 32768;
    }
    decoded.set(kind, data);
  }
  return decoded.get(kind);
}

// PCM is bundled deliberately: file:// and the portable HTML need no fetch or decoder task.
export function recordedEngineLoop(sampleRate, kind, piston = null) {
  const source = recording(kind),
    nativeRate = kind === 'rotor' ? rotorRate : propRate;
  const data = new Float32Array(Math.round((source.length * sampleRate) / nativeRate));
  for (let i = 0; i < data.length; i++) {
    const at = (i * nativeRate) / sampleRate,
      index = Math.floor(at),
      fraction = at - index;
    const sample = source[index] * (1 - fraction) + source[(index + 1) % source.length] * fraction;
    // Fixed-wing UAVs keep the characteristic piston pulses under the real propeller recording.
    data[i] = piston ? sample * 0.86 + piston[i % piston.length] * 0.14 : sample;
  }
  return data;
}

export function uavEngineMix(unit, distance, listener) {
  const fpv = unit.subtype === 'fpv',
    heavy = unit.key === 'heavy';
  const d = Math.max(0, distance);
  const approach =
    d > 1
      ? ((listener.x - unit.x) * (unit.vx || 0) +
          (listener.y - (unit.y ?? 2)) * (unit.vy || 0) +
          (listener.z - unit.z) * (unit.vz || 0)) /
        d
      : 0;
  const doppler = Math.max(0.85, Math.min(1.18, 343 / Math.max(240, 343 - approach)));
  return {
    rate: (fpv ? 1.2 : heavy ? 0.76 : 1.04) * doppler,
    gain: (fpv ? 0.19 : heavy ? 0.3 : 0.26) * Math.min(1, (70 / (70 + d)) * 1.6),
    cutoff: Math.max(650, Math.min(fpv ? 6000 : 4500, 12000 * Math.exp(-d / 330))),
  };
}
