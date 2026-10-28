// Readiness is a one-time world boundary, independent of campaigns and network rooms.
export function prepareStartupAudio(
  prepare,
  {
    schedule = (callback) =>
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame(() => requestAnimationFrame(callback))
        : setTimeout(callback, 0),
    timeout = 5000,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {},
) {
  return new Promise((resolve) => {
    let settled = false,
      timer;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimer(timer);
      resolve();
    };
    timer = setTimer(finish, timeout);
    try {
      schedule(() => {
        if (settled) return;
        try {
          Promise.resolve(prepare()).then(finish, finish);
        } catch {
          finish();
        }
      });
    } catch {
      finish();
    }
  });
}

export function bindStartupReadiness({ button, status, warmup }) {
  const label = button.textContent;
  let ready = false;
  button.disabled = true;
  button.textContent = 'Подготовка города…';
  status.hidden = false;
  const settle = () => {
    ready = true;
    button.textContent = label;
    button.disabled = false;
    status.hidden = true;
  };
  // The renderer owns its bounded fallback. A rejected warmup must also release
  // this UI boundary, so a failed optional preparation cannot trap the start menu.
  const done = Promise.resolve(warmup).then(settle, settle);
  return {
    get ready() {
      return ready;
    },
    done,
  };
}
