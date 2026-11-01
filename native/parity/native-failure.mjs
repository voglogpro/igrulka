const reported = new Set();
export function reportNativeStatus(phase, detail = {}) {
  if (reported.has(phase)) return;
  reported.add(phase);
  try {
    globalThis.chrome?.webview?.postMessage({ kind: 'web-status', phase, ...detail });
  } catch {
    /* host may be closing */
  }
}
export function showNativeFailure(message) {
  if (!reported.has('error')) {
    reported.add('error');
    try {
      globalThis.chrome?.webview?.postMessage({
        kind: 'web-error',
        message: String(message || 'Native renderer failed').slice(0, 4000),
      });
    } catch {
      /* keep local error UI */
    }
  }
  const document = globalThis.document;
  if (!document) return;
  // Pause through the existing keyboard controller before blocking further input.
  if (globalThis.skyfront && !globalThis.skyfront.isPaused() && globalThis.KeyboardEvent)
    globalThis.dispatchEvent(
      new globalThis.KeyboardEvent('keydown', { code: 'Space', key: ' ', bubbles: true }),
    );
  globalThis.__SKYFRONT_NATIVE_FAILED__ = true;
  const show = () => {
    let panel = document.getElementById('native-error');
    if (!panel) {
      panel = document.createElement('section');
      panel.id = 'native-error';
      panel.setAttribute('role', 'alert');
      panel.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:40px;background:#14231ff5;color:#e1e9df;font:16px system-ui;gap:16px;text-align:center';
      const heading = document.createElement('h2');
      heading.textContent = 'Нативный движок не смог отобразить игру';
      const detail = document.createElement('p');
      detail.id = 'native-error-detail';
      detail.style.cssText = 'max-width:900px;white-space:pre-wrap;overflow-wrap:anywhere';
      const retry = document.createElement('button');
      retry.textContent = 'Повторить загрузку';
      retry.style.cssText =
        'padding:12px 24px;background:#45644e;border:1px solid #a3b99a;color:white;border-radius:5px;cursor:pointer';
      retry.onclick = () => globalThis.location.reload();
      panel.append(heading, detail, retry);
      document.body.append(panel);
    }
    document.getElementById('native-error-detail').textContent = String(
      message || 'Нет подтверждения от Godot',
    );
    const game = document.getElementById('game');
    if (game) game.inert = true;
  };
  if (document.body) show();
  else document.addEventListener('DOMContentLoaded', show, { once: true });
}
