// Scratch storage for synchronous target searches. It never enters game state
// or exposes a mutable candidate record to another unit's search.
export class CandidateBuffer {
  constructor(descending = false) {
    this.units = [];
    this.scores = [];
    this.order = [];
    this.count = 0;
    this.compare = (a, b) =>
      (descending ? this.scores[b] - this.scores[a] : this.scores[a] - this.scores[b]) ||
      this.units[a].id - this.units[b].id ||
      a - b;
  }

  reset() {
    this.count = 0;
  }

  add(unit, score) {
    const index = this.count++;
    this.units[index] = unit;
    this.scores[index] = score;
    this.order[index] = index;
  }

  trim() {
    this.units.length = this.count;
    this.scores.length = this.count;
    this.order.length = this.count;
  }

  sortedOrder() {
    this.trim();
    this.order.sort(this.compare);
    return this.order;
  }

  siftDown(index) {
    const order = this.order,
      value = order[index];
    for (let child = index * 2 + 1; child < order.length; child = index * 2 + 1) {
      if (child + 1 < order.length && this.compare(order[child + 1], order[child]) < 0) child++;
      if (this.compare(value, order[child]) <= 0) break;
      order[index] = order[child];
      index = child;
    }
    order[index] = value;
  }

  heapify() {
    this.trim();
    for (let index = Math.floor(this.order.length / 2) - 1; index >= 0; index--)
      this.siftDown(index);
  }

  pop() {
    if (!this.order.length) return null;
    const first = this.order[0],
      last = this.order.pop();
    if (this.order.length) {
      this.order[0] = last;
      this.siftDown(0);
    }
    return this.units[first];
  }
}
