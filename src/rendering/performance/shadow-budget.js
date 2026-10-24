// Ground units have frame-synchronous contact shadows; this budget is for static scenery.
// Camera coverage and scene mutations still invalidate immediately in lighting/sync.
export class ShadowBudget {
  constructor() {
    this.interval = 0.75;
    this.mapSize = 4096;
    this.lastWasShadow = false;
    this.slow = 0;
  }
  observeFrame(seconds) {
    if (!this.lastWasShadow || seconds <= 0 || seconds >= 3) return false;
    if (seconds > 0.065) this.slow++;
    else this.slow = Math.max(0, this.slow - 1);
    this.interval = seconds > 0.12 ? 2 : seconds > 0.04 ? 1.25 : 0.75;
    if (this.mapSize > 1024 && this.slow >= 2) {
      this.mapSize /= 2;
      this.slow = 0;
      return true;
    }
    return false;
  }
}
