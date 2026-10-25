import test from 'node:test';
import assert from 'node:assert/strict';
import { clientPageUrl, DEFAULT_CLIENT_URL } from '../../server/client-page.mjs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('client distribution URL defaults to stable Pages and preserves an explicit HTTPS path', () => {
  assert.equal(clientPageUrl(), DEFAULT_CLIENT_URL);
  assert.equal(clientPageUrl('https://example.org/game/'), 'https://example.org/game/');
});

test('client page configuration rejects credentials, queries, fragments, controls and oversized values', () => {
  for (const value of [
    '',
    null,
    'http://example.org/',
    'https://user:pass@example.org/',
    'https://example.org/?room=ABC234',
    'https://example.org/#token',
    'https://example.org/?',
    'https://example.org/#',
    'https://example.org/\n',
    'https://example.org/\\game',
    'https://example.org/' + 'a'.repeat(2048),
  ])
    assert.throws(() => clientPageUrl(value));
});

test('real LAN CLI keeps its legacy origin and closes only its own listener', async () => {
  const child = spawn(process.execPath, ['server/index.mjs', '--port=0', '--no-open'], {
    cwd: new URL('../..', import.meta.url),
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  let address;
  try {
    address = await new Promise((resolve, reject) => {
      let output = '';
      // A fresh Node child competes with all other unit workers in the full suite.
      // Readiness is the actual listener announcement, never a fixed startup sleep.
      const timer = setTimeout(() => reject(Error('Local server did not start')), 15000);
      child.once('exit', (code) => {
        clearTimeout(timer);
        reject(Error(`Local server exited before readiness (${code})`));
      });
      child.stdout.on('data', (chunk) => {
        output += chunk;
        const match = output.match(/Skyfront multiplayer: (http:\/\/127\.0\.0\.1:\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    const info = await (await fetch(`${address}/api/server-info`)).json();
    assert.equal(info.clientUrl, null);
    assert.equal(info.publicUrl, null);
    assert.equal(info.status, 'local');
  } finally {
    child.kill('SIGTERM');
    await exited;
  }
  await assert.rejects(fetch(`${address}/api/server-info`));
});
