import { groundVisible } from '../../game/units/infantry/cover.js';

// Presentation snapshot only. Combat continues to use exact simulation visibility.
export class GroundVisibility {
  constructor() {
    this.ids = new Set();
    this.lastTime = -Infinity;
  }
  sync(s) {
    const units = s.groundUnits || [];
    let flags = 0;
    for (const u of units)
      flags +=
        u.id *
          (1 +
            (u.hp > 0 ? 1 : 0) +
            (u.carrierId ? 2 : 0) +
            (u.moving ? 4 : 0) +
            (u.camouflaged ? 8 : 0)) +
        (u.lastFire || 0);
    if (
      this.units === units &&
      this.flags === flags &&
      this.revision === s.networkRevision &&
      s.time >= this.lastTime &&
      s.time - this.lastTime < 0.1
    )
      return this.ids;
    this.units = units;
    this.flags = flags;
    this.revision = s.networkRevision;
    this.lastTime = s.time;
    this.ids.clear();
    for (const u of units) if (groundVisible(s, 0, u)) this.ids.add(u.id);
    return this.ids;
  }
}
