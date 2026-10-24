import { onePole, normalizeLoop } from '../dsp.js';

// Discrete soft impacts instead of a continuous high-frequency white-noise bed.
// Write through the loop boundary and warm the filter: no cut or fade gap at the seam.
export function rainLoop(sampleRate) {
  const data = new Float32Array(sampleRate * 5);
  for (let drop = 0; drop < 480; drop++) {
    const start = Math.floor(Math.random() * data.length),
      duration = Math.floor(sampleRate * (0.018 + Math.random() * 0.025)),
      frequency = 420 + Math.random() * 760,
      gain = 0.08 + Math.random() ** 2 * 0.22;
    for (let i = 0; i < duration; i++) {
      const envelope = Math.sin((Math.PI * i) / duration) ** 2;
      data[(start + i) % data.length] +=
        gain *
        envelope *
        (Math.sin((2 * Math.PI * frequency * i) / sampleRate) + (Math.random() - 0.5) * 0.08);
    }
  }
  const alpha = onePole(1500, sampleRate);
  let low = 0,
    smooth = 0;
  const filter = (value) => {
    low += alpha * (value - low);
    smooth += alpha * (low - smooth);
    return smooth;
  };
  for (let i = Math.max(0, data.length - 1024); i < data.length; i++) filter(data[i]);
  for (let i = 0; i < data.length; i++) data[i] = filter(data[i]);
  return normalizeLoop(data);
}
