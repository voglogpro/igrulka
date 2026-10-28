import { pcm, sampleRate as nativeRate } from './samples/explosion-field.js';

// One actual field recording, cropped/resampled only. No invented blast layers.
// Source and exact preparation: assets/audio/explosion-sources.json and LICENSE.md.
const durations = { blastSmall: 1.55, blast: 3.1, blastLarge: 4.4 };
let decoded;
export function recordedExplosionSample(rate, name) {
  if (!Number.isFinite(rate) || rate <= 0 || !Object.hasOwn(durations, name))
    throw Error('Invalid recorded explosion');
  if (!decoded) {
    const bytes = atob(pcm);
    decoded = new Float32Array(bytes.length / 2);
    for (let i = 0; i < decoded.length; i++) {
      const value = bytes.charCodeAt(i * 2) | (bytes.charCodeAt(i * 2 + 1) << 8);
      decoded[i] = (value >= 32768 ? value - 65536 : value) / 32768;
    }
  }
  const seconds = durations[name],
    output = new Float32Array(Math.round(seconds * rate)),
    fade = Math.round(Math.min(0.35, seconds * 0.15) * rate);
  for (let i = 0; i < output.length; i++) {
    const at = (i * nativeRate) / rate,
      index = Math.min(decoded.length - 1, Math.floor(at)),
      next = Math.min(decoded.length - 1, index + 1),
      fraction = at - index,
      envelope = Math.min(1, i / Math.max(1, rate * 0.003), (output.length - 1 - i) / fade);
    output[i] = (decoded[index] * (1 - fraction) + decoded[next] * fraction) * envelope;
  }
  return output;
}
