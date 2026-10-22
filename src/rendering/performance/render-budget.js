// Bound fill-rate on high DPI displays without changing models, lighting or effects.
export function renderPixelRatio(width, height, dpr = 1, scale = 1) {
  return Math.min(dpr, 1.5, Math.sqrt((1920 * 1080) / Math.max(1, width * height))) * scale;
}

export class RenderBudget {
  constructor() {
    this.scale = 1;
    this.age = 0;
    this.window = 0;
    this.total = 0;
    this.samples = 0;
    this.fast = 0;
    this.slow = 0;
  }
  observe(seconds) {
    // Loading, tab restoration and debugger pauses should not resize the framebuffer.
    if (seconds <= 0 || seconds >= 2) return false;
    const elapsed = Math.min(seconds, 0.25);
    this.age += elapsed;
    if (this.age < 3) return false;
    this.total += elapsed;
    this.samples++;
    this.window += elapsed;
    if (this.window < 2) return false;
    const average = this.total / this.samples;
    this.fast = average < 0.019 ? this.fast + this.window : 0;
    this.slow = average > 0.035 ? this.slow + this.window : 0;
    this.total = this.samples = this.window = 0;
    const before = this.scale;
    if (this.slow >= 2) {
      this.scale = Math.max(0.75, this.scale - 0.1);
      this.slow = this.fast = 0;
    } else if (this.fast >= 6) {
      this.scale = Math.min(1, this.scale + 0.05);
      this.slow = this.fast = 0;
    }
    return Math.abs(before - this.scale) > 0.001;
  }
}
