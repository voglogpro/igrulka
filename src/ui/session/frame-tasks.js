// Spread periodic read-only UI refreshes across frames. Repeated polling replaces
// a pending callback in place, so slow frames neither build a backlog nor starve
// the last panels. Callbacks must read the current campaign when they run.
export function createFrameTasks() {
  const pending = new Map();
  return {
    get pending() {
      return pending.size;
    },
    request(tasks) {
      for (const [key, callback] of Object.entries(tasks)) {
        if (typeof callback === 'function') pending.set(key, callback);
        else pending.delete(key);
      }
    },
    runNext() {
      const first = pending.entries().next();
      if (first.done) return false;
      const [key, callback] = first.value;
      pending.delete(key);
      callback();
      return true;
    },
    clear() {
      pending.clear();
    },
  };
}
