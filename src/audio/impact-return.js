// Parallel processing of the admitted original sound only. No generated source,
// convolution impulse, recording replacement or extra voice is introduced.
export const IMPACT_RETURNS = new Set([
  'blast',
  'blastLarge',
  'rocketLaunch',
  'cruiseLaunch',
  'ballisticLaunch',
  'artillery',
]);

export function impactReturnGain({ dry, wet, echo }) {
  // A distant blast's legacy reflections exceed its attenuated direct sound.
  // Carry some of that existing acoustic energy into the bass/echo return,
  // instead of reducing the entire return to half of an almost-silent dry path.
  // Close transients still get a smaller send than the original half-dry design.
  return Math.max(0, dry) * 0.35 + Math.max(0, wet) * 0.6 + Math.max(0, echo) * 0.25;
}

export class ImpactReturn {
  constructor(context, destination) {
    this.context = context;
    this.input = context.createGain();
    this.output = context.createGain();
    this.output.gain.value = 1;
    this.output.connect(destination);
    this.nodes = [];
    this.clear();
  }
  // Transport boundary only. Disconnecting old delay lines discards their tails.
  clear() {
    this.input.disconnect();
    for (const node of this.nodes) node.disconnect();
    const c = this.context,
      subsonic = c.createBiquadFilter(),
      shelf = c.createBiquadFilter(),
      low = c.createBiquadFilter(),
      body = c.createGain();
    subsonic.type = 'highpass';
    subsonic.frequency.value = 28;
    shelf.type = 'lowshelf';
    shelf.frequency.value = 110;
    if (shelf.gain) shelf.gain.value = 3;
    low.type = 'lowpass';
    low.frequency.value = 900;
    body.gain.value = 0.35;
    this.input.connect(subsonic);
    subsonic.connect(shelf);
    shelf.connect(low);
    low.connect(body);
    body.connect(this.output);
    this.nodes = [subsonic, shelf, low, body];
    for (const [seconds, gain] of [
      [0.38, 0.28],
      [0.83, 0.15],
    ]) {
      const delay = c.createDelay(1),
        level = c.createGain();
      delay.delayTime.value = seconds;
      level.gain.value = gain;
      low.connect(delay);
      delay.connect(level);
      level.connect(this.output);
      this.nodes.push(delay, level);
    }
  }
}
