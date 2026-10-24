// Mutations are detected without allocating per-road strings/arrays every rendered frame.
// Geometry changes still rebuild junctions; damage alone updates only affected surfaces.
export class RoadVisualCache {
  constructor() {
    this.records = new Map();
    this.roads = [];
    this.changed = [];
    this.layoutChanged = false;
    this.generation = 0;
  }
  update(roads, passable) {
    const generation = ++this.generation;
    this.roads.length = this.changed.length = 0;
    this.layoutChanged = false;
    for (const road of roads) {
      if (road.removed) continue;
      this.roads.push(road);
      let record = this.records.get(road.id);
      const stage = Math.ceil((road.hp / road.maxHp) * 3),
        open = passable(road);
      if (!record) {
        record = {};
        this.records.set(road.id, record);
        this.layoutChanged = true;
      }
      if (
        record.side !== road.side ||
        record.ax !== road.ax ||
        record.az !== road.az ||
        record.bx !== road.bx ||
        record.bz !== road.bz ||
        record.connector !== road.connectorTo
      ) {
        record.side = road.side;
        record.ax = road.ax;
        record.az = road.az;
        record.bx = road.bx;
        record.bz = road.bz;
        record.connector = road.connectorTo;
        this.layoutChanged = true;
      }
      if (record.open !== open || !Object.is(record.stage, stage)) this.changed.push(road);
      record.stage = stage;
      record.open = open;
      record.generation = generation;
    }
    for (const [id, record] of this.records)
      if (record.generation !== generation) {
        this.records.delete(id);
        this.layoutChanged = true;
      }
    return this;
  }
}
