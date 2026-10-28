// Mutations are detected without allocating per-road strings/arrays every frame.
const padding = 3;
const bounds = (road) => {
  const radius = (road.connectorTo ? 5 : 10) / 2 + padding;
  return {
    minX: Math.min(road.ax, road.bx) - radius,
    maxX: Math.max(road.ax, road.bx) + radius,
    minZ: Math.min(road.az, road.bz) - radius,
    maxZ: Math.max(road.az, road.bz) + radius,
  };
};
const intersects = (a, b) =>
  a.minX <= b.maxX && a.maxX >= b.minX && a.minZ <= b.maxZ && a.maxZ >= b.minZ;
export class RoadVisualCache {
  constructor() {
    this.records = new Map();
    this.roads = [];
    this.changed = [];
    this.removed = [];
    this.footprints = [];
    this.dirty = new Set();
    this.layoutChanged = false;
    this.generation = 0;
  }
  update(roads, passable) {
    const generation = ++this.generation;
    this.roads.length = this.changed.length = this.removed.length = this.footprints.length = 0;
    this.dirty.clear();
    this.layoutChanged = false;
    for (const road of roads) {
      if (road.removed) continue;
      this.roads.push(road);
      let record = this.records.get(road.id);
      const stage = Math.ceil((road.hp / road.maxHp) * 3),
        open = passable(road),
        intact = road.hp >= road.maxHp;
      if (!record) {
        record = {};
        this.records.set(road.id, record);
      }
      if (
        record.side !== road.side ||
        record.ax !== road.ax ||
        record.az !== road.az ||
        record.bx !== road.bx ||
        record.bz !== road.bz ||
        record.connector !== road.connectorTo
      ) {
        if (record.bounds) this.footprints.push(record.bounds);
        record.bounds = bounds(road);
        this.footprints.push(record.bounds);
        record.side = road.side;
        record.ax = road.ax;
        record.az = road.az;
        record.bx = road.bx;
        record.bz = road.bz;
        record.connector = road.connectorTo;
        this.layoutChanged = true;
        this.dirty.add(road.id);
      }
      if (record.open !== open || !Object.is(record.stage, stage) || record.intact !== intact)
        this.dirty.add(road.id);
      record.stage = stage;
      record.open = open;
      record.intact = intact;
      record.generation = generation;
    }
    for (const [id, record] of this.records) {
      if (record.generation === generation) continue;
      this.records.delete(id);
      this.removed.push(id);
      this.footprints.push(record.bounds);
      this.layoutChanged = true;
    }
    // Clipping depends on both streets. Moving/removing a footprint also restores
    // old neighbours' curbs/paint; new neighbours need the new footprint instead.
    if (this.layoutChanged)
      for (const [id, record] of this.records) {
        if (this.dirty.has(id)) continue;
        for (const footprint of this.footprints)
          if (intersects(record.bounds, footprint)) {
            this.dirty.add(id);
            break;
          }
      }
    for (const road of this.roads) if (this.dirty.has(road.id)) this.changed.push(road);
    return this;
  }
}
