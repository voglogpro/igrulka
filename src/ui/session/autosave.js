// Ordinary input marks the current campaign dirty. Serialization belongs in a
// coalesced idle task; explicit saves and page lifecycle boundaries can flush it.
export function createAutosave({
  getState,
  getEpoch,
  getSession,
  persist,
  isBlocked = () => false,
  now = () => performance.now(),
  schedule = (callback, delay) => setTimeout(callback, delay),
  unschedule = (id) => clearTimeout(id),
  requestIdle = typeof globalThis.requestIdleCallback === 'function'
    ? (callback, options) => globalThis.requestIdleCallback(callback, options)
    : null,
  cancelIdle = (id) => globalThis.cancelIdleCallback?.(id),
  debounce = 200,
  maxDelay = 1500,
}) {
  let pending = null,
    quietTimer = null,
    deadlineTimer = null,
    idleTask = null,
    idleIsTimer = false;
  const blocked = () => !!getSession() || isBlocked();
  function cancel() {
    if (quietTimer != null) unschedule(quietTimer);
    if (deadlineTimer != null) unschedule(deadlineTimer);
    if (idleTask != null) (idleIsTimer ? unschedule : cancelIdle)(idleTask);
    quietTimer = deadlineTimer = idleTask = null;
    pending = null;
  }
  const current = (token) =>
    pending === token &&
    !blocked() &&
    token.state === getState() &&
    token.epoch === getEpoch() &&
    token.session === getSession();
  function commit(token) {
    if (pending !== token) return false;
    const valid = current(token);
    cancel();
    if (!valid) return false;
    persist(getState());
    return true;
  }
  function queueIdle(token) {
    if (pending !== token) return;
    quietTimer = null;
    if (!current(token)) {
      if (pending === token) cancel();
      return;
    }
    idleIsTimer = !requestIdle;
    idleTask = requestIdle
      ? requestIdle(() => commit(token), { timeout: Math.max(1, token.deadline - now()) })
      : schedule(() => commit(token), 0);
  }
  return {
    get pending() {
      return !!pending;
    },
    request() {
      if (blocked()) {
        cancel();
        return;
      }
      if (pending && !current(pending)) cancel();
      if (!pending) {
        const token = (pending = {
          state: getState(),
          epoch: getEpoch(),
          session: getSession(),
          deadline: now() + maxDelay,
        });
        deadlineTimer = schedule(() => commit(token), maxDelay);
      }
      if (quietTimer != null) unschedule(quietTimer);
      if (idleTask != null) (idleIsTimer ? unschedule : cancelIdle)(idleTask);
      idleTask = null;
      const token = pending;
      quietTimer = schedule(() => queueIdle(token), debounce);
    },
    flush() {
      cancel();
      if (blocked()) return false;
      persist(getState());
      return true;
    },
    cancel,
  };
}
