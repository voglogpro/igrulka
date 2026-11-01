import { showNativeFailure, reportNativeStatus } from './native-failure.mjs';
reportNativeStatus('bootstrap', {
  hidden: globalThis.document.hidden,
  visibility: globalThis.document.visibilityState,
});

// Keep original game exceptions visible in a native host as well as in its console.
globalThis.addEventListener('error', (event) =>
  showNativeFailure(event.error?.message || event.message),
);
globalThis.addEventListener('unhandledrejection', (event) =>
  showNativeFailure(event.reason?.message || String(event.reason)),
);
for (const type of [
  'keydown',
  'keyup',
  'pointerdown',
  'pointerup',
  'pointermove',
  'wheel',
  'contextmenu',
])
  globalThis.addEventListener(
    type,
    (event) => {
      if (globalThis.__SKYFRONT_NATIVE_FAILED__ && !event.target.closest?.('#native-error')) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    },
    { capture: true, passive: false },
  );
