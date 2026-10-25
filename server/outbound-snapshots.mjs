// Keep unsent worlds as one lazy producer. TCP write completion is sufficient only
// for legacy peers; negotiated delta peers also acknowledge decoding each world.
const OPEN = 1;
const SOFT_BUFFER = 64 * 1024;
const MAX_CONTROLS = 256;
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));

export class OutboundSnapshots {
  constructor(socket, { now = () => Date.now() } = {}) {
    this.socket = socket;
    this.now = now;
    this.controls = [];
    this.coalesced = new Map();
    this.latest = null;
    this.inFlight = false;
    this.awaiting = null;
    this.requireAck = false;
    this.interval = 100;
    this.lastSnapshotAt = -Infinity;
    this.nextSnapshotAt = 0;
    this.stats = {
      framesSent: 0,
      bytesSent: 0,
      snapshotsSerialized: 0,
      snapshotsCoalesced: 0,
      ackRttMs: null,
      generationMs: 0,
      generationEmaMs: null,
      cpuFloorMs: 100,
    };
    socket.once('close', () => this.dispose());
  }

  control(value, key = null) {
    if (this.disposed || this.socket.readyState !== OPEN) return false;
    if (key) this.coalesced.set(key, value);
    else {
      if (this.controls.length >= MAX_CONTROLS) {
        this.dispose();
        this.socket.close(1013, 'Control queue full');
        return false;
      }
      this.controls.push(value);
    }
    this.flush();
    return true;
  }

  snapshot(produce) {
    if (this.disposed || this.socket.readyState !== OPEN) return;
    if (this.latest) this.stats.snapshotsCoalesced++;
    this.latest = produce;
    this.flush();
  }

  acknowledge(seq) {
    if (!this.awaiting || seq !== this.awaiting.seq) return false;
    const rtt = Math.max(0, this.now() - this.awaiting.sentAt);
    this.stats.ackRttMs = rtt;
    const desired = Math.max(this.stats.cpuFloorMs, clamp(Math.ceil(rtt / 25) * 25, 100, 500));
    this.interval = desired > this.interval ? desired : Math.max(desired, this.interval - 25);
    this.nextSnapshotAt = this.lastSnapshotAt + this.interval;
    this.awaiting = null;
    this.flush();
    return true;
  }

  resetSnapshots() {
    this.latest = null;
    this.awaiting = null;
  }

  schedule(delay) {
    if (this.timer || this.disposed) return;
    this.timer = setTimeout(
      () => {
        this.timer = null;
        this.flush();
      },
      Math.max(1, delay),
    );
    this.timer.unref?.();
  }

  flush() {
    if (this.disposed || this.inFlight || this.socket.readyState !== OPEN) return;
    let value;
    if (this.coalesced.has('pong')) {
      value = this.coalesced.get('pong');
      this.coalesced.delete('pong');
    } else if (this.controls.length) value = this.controls.shift();
    else if (this.coalesced.size) {
      const [key, message] = this.coalesced.entries().next().value;
      value = message;
      this.coalesced.delete(key);
    }
    if (value) {
      this.write(value, false);
      return;
    }
    if (!this.latest || this.awaiting) return;
    if (this.socket.bufferedAmount >= SOFT_BUFFER) {
      if (!this.requireAck) this.interval = Math.min(250, this.interval + 25);
      this.nextSnapshotAt = Math.max(this.nextSnapshotAt, this.lastSnapshotAt + this.interval);
      this.schedule(25);
      return;
    }
    const delay = this.nextSnapshotAt - this.now();
    if (delay > 0) {
      this.schedule(delay);
      return;
    }
    const produce = this.latest;
    this.latest = null;
    this.write(produce, true);
  }

  write(value, snapshot) {
    const started = this.now();
    let message, raw;
    try {
      message = typeof value === 'function' ? value() : value;
      if (snapshot && this.requireAck && !Number.isSafeInteger(message?.sync?.seq))
        throw Error('Missing snapshot sequence');
      raw = JSON.stringify(message);
    } catch {
      this.dispose();
      this.socket.close(1011, 'Snapshot encoding failed');
      return;
    }
    if (snapshot) {
      const generation = Math.max(0, this.now() - started);
      this.stats.generationMs = generation;
      this.stats.generationEmaMs =
        this.stats.generationEmaMs == null
          ? generation
          : this.stats.generationEmaMs * 0.75 + generation * 0.25;
      if (this.requireAck) {
        // At most roughly one sixth of a core per peer for world generation.
        // A cheaper subsequent world recovers gradually through ACK pacing.
        this.stats.cpuFloorMs = clamp(
          Math.ceil((this.stats.generationEmaMs * 6) / 25) * 25,
          100,
          500,
        );
        this.interval = Math.max(this.interval, this.stats.cpuFloorMs);
      }
      this.stats.snapshotsSerialized++;
      this.lastSnapshotAt = started;
      this.nextSnapshotAt = started + this.interval;
      if (this.requireAck) this.awaiting = { seq: message.sync.seq, sentAt: started };
    }
    this.inFlight = true;
    this.stats.framesSent++;
    this.stats.bytesSent += Buffer.byteLength(raw);
    try {
      this.socket.send(raw, (error) => {
        this.inFlight = false;
        if (error) {
          this.dispose();
          this.socket.terminate();
          return;
        }
        if (snapshot && !this.requireAck) {
          const elapsed = this.now() - started;
          this.interval =
            elapsed > 100 ? Math.min(250, this.interval + 25) : Math.max(100, this.interval - 25);
          this.nextSnapshotAt = this.lastSnapshotAt + this.interval;
        }
        this.flush();
      });
    } catch {
      this.inFlight = false;
      this.dispose();
      this.socket.terminate();
    }
  }

  diagnostics() {
    return {
      ...this.stats,
      intervalMs: this.interval,
      awaitingSeq: this.awaiting?.seq ?? null,
      pendingSnapshot: !!this.latest,
      controlsQueued: this.controls.length + this.coalesced.size,
      inFlight: this.inFlight,
      disposed: !!this.disposed,
    };
  }

  dispose() {
    this.disposed = true;
    clearTimeout(this.timer);
    this.timer = null;
    this.controls.length = 0;
    this.coalesced.clear();
    this.resetSnapshots();
  }
}
