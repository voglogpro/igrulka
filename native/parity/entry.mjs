import './bootstrap.mjs';
import { NativeTransport } from './godot-renderer.mjs';
import { showNativeFailure } from './native-failure.mjs';

// The source world seeds model pools synchronously. Learn the chosen renderer
// mode before those caches are created, including --baseline-graphics.
const startupTransport = new NativeTransport();
globalThis.__SKYFRONT_STARTUP_TRANSPORT__ = startupTransport;
startupTransport
  .waitReady()
  .then(() => import('../../src/main.js'))
  .catch((error) => showNativeFailure(error.message));
