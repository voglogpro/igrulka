// Browser event ownership is explicit. Each binder returns a disposer so a future
// app remount can detach its listeners without changing camera or game state.
export function bindPointerActivity({ document, window, setBusy, unlockAudio }) {
  const down = () => {
    setBusy(true);
    unlockAudio();
  };
  const release = () => setBusy(false);
  document.addEventListener('pointerdown', down);
  for (const type of ['pointerup', 'pointercancel']) document.addEventListener(type, release);
  window.addEventListener('blur', release);
  return () => {
    document.removeEventListener('pointerdown', down);
    for (const type of ['pointerup', 'pointercancel']) document.removeEventListener(type, release);
    window.removeEventListener('blur', release);
  };
}

export function bindMinimap(minimap, { focusInput, focus, map }) {
  const click = (event) => {
    focusInput();
    const rect = event.currentTarget.getBoundingClientRect();
    focus(
      ((event.clientX - rect.left) / rect.width - 0.5) * map.width,
      ((event.clientY - rect.top) / rect.height - 0.5) * map.depth,
    );
  };
  minimap.addEventListener('click', click);
  return () => minimap.removeEventListener('click', click);
}

export function bindPageLifecycle({
  document,
  window,
  resetAccumulator,
  focusAudio,
  hasStarted,
  persist,
}) {
  const visibility = () => {
    resetAccumulator();
    focusAudio(!document.hidden);
    if (document.hidden && hasStarted()) persist();
  };
  const unload = () => {
    if (hasStarted()) persist();
  };
  document.addEventListener('visibilitychange', visibility);
  window.addEventListener('beforeunload', unload);
  return () => {
    document.removeEventListener('visibilitychange', visibility);
    window.removeEventListener('beforeunload', unload);
  };
}
