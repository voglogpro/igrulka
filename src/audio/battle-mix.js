// Processing of existing battlefield recordings/presets only; no sound generation.
export function heavyMix(distance, loudness = 1) {
  const d = Math.max(0, distance),
    far = Math.min(1, d / 1400),
    reach = 650 / (650 + d);
  return {
    dry: loudness * reach * 0.78,
    wet: loudness * reach * (0.08 + 0.12 * far),
    echo: loudness * reach * (0.08 + 0.32 * far),
    cutoff: Math.max(480, Math.min(7000, 9000 * Math.exp(-d / 1450))),
    delay: Math.min(1.8, d / 620),
  };
}

export function distantLoopMix(distance, gain, cutoff = 2000) {
  const d = Math.max(0, distance),
    fade = Math.max(0, Math.min(1, (5200 - d) / 1400)),
    far = Math.min(1, d / 1200);
  return {
    gain: (gain + 0.022 * far * (700 / (700 + d))) * fade,
    cutoff: Math.max(450, Math.min(cutoff, 6000 * Math.exp(-d / 1700))),
  };
}

// A mass volley cannot schedule an unbounded queue of delayed sources.
export class BurstBudget {
  constructor() {
    this.reset();
  }
  reset() {
    this.since = -Infinity;
    this.total = 0;
    this.ordinary = 0;
  }
  take(now, priority = false) {
    if (now - this.since >= 0.1 || now < this.since) {
      this.since = now;
      this.total = 0;
      this.ordinary = 0;
    }
    if (this.total >= 12 || (!priority && this.ordinary >= 8)) return false;
    this.total++;
    if (!priority) this.ordinary++;
    return true;
  }
}
