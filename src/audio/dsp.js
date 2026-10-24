// Shared offline DSP. Transients fade out; circular ambience must keep its seam intact.
export function onePole(cutoff, sampleRate) {
  return 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
}

export function finish(data, drive = 1.4) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] = Math.tanh(data[i] * drive);
    peak = Math.max(peak, Math.abs(data[i]));
  }
  const scale = peak ? 0.95 / peak : 1;
  for (let i = 0; i < data.length; i++) data[i] *= scale;
  const fade = Math.min(data.length, 256);
  for (let i = 0; i < fade; i++) data[data.length - 1 - i] *= i / fade;
  return data;
}

export function normalizeLoop(data, ceiling = 0.95) {
  let sum = 0;
  for (const value of data) sum += value;
  const dc = sum / data.length;
  let peak = 0;
  for (let i = 0; i < data.length; i++) {
    data[i] -= dc;
    peak = Math.max(peak, Math.abs(data[i]));
  }
  if (peak) for (let i = 0; i < data.length; i++) data[i] *= ceiling / peak;
  return data;
}
