import { onePole, finish } from './dsp.js';

// Igniter crack, low combustion pressure and a bright, decaying exhaust jet.
// Separate from UAV motors and gunfire: a missile burns, rather than revving or firing a gun.
export function rocketIgnition(sampleRate, large = false) {
  const seconds = large ? 2.1 : 1.15;
  const data = new Float32Array(Math.ceil(sampleRate * seconds));
  let body = 0,
    exhaust = 0,
    phase = 0,
    previous = 0;
  const low = onePole(large ? 180 : 300, sampleRate),
    high = onePole(4200, sampleRate);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      white = Math.random() * 2 - 1;
    body += low * (white - body);
    exhaust += high * (white - exhaust);
    phase += (2 * Math.PI * ((large ? 48 : 82) + 28 * Math.exp(-t / 0.09))) / sampleRate;
    const attack = Math.min(1, t / 0.004),
      burn = (1 - Math.exp(-t / 0.025)) * Math.exp(-t / (large ? 0.6 : 0.25));
    const crack = (white - previous) * Math.exp(-t / 0.009) * 0.3;
    previous = white;
    data[i] =
      attack *
      (crack +
        body * 4.5 * burn +
        exhaust * 0.65 * burn +
        Math.sin(phase) * 0.28 * Math.exp(-t / 0.18));
  }
  return finish(data, 1.1);
}

export function missileDive(sampleRate) {
  const data = new Float32Array(Math.ceil(sampleRate * 1.5));
  let filtered = 0,
    phase = 0;
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate,
      k = t / 1.5;
    const frequency = 350 + 1100 * k * k;
    filtered += onePole(1000 + k * 2600, sampleRate) * (Math.random() * 2 - 1 - filtered);
    phase += (2 * Math.PI * frequency) / sampleRate;
    const envelope = Math.sin(Math.PI * k) * k;
    data[i] = (filtered * 1.4 + Math.sin(phase) * 0.1) * envelope;
  }
  return finish(data, 0.9);
}
