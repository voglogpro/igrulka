import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameServer } from '../../scripts/dev-server.mjs';

test('development server serves the entry, modules, styles and local fonts from the new tree', async (t) => {
  const server = createGameServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [route, type] of [
    ['/', 'text/html'],
    ['/src/main.js', 'text/javascript'],
    ['/src/ui/style.css', 'text/css'],
    ['/assets/fonts/font-0.ttf', 'font/ttf'],
    ['/vendor/three/three.module.js', 'text/javascript'],
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 200, route);
    assert.ok(response.headers.get('content-type').startsWith(type), route);
    assert.ok((await response.arrayBuffer()).byteLength > 0);
  }
});

test('development server does not expose Git metadata, reports, or files outside the project', async (t) => {
  const server = createGameServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of [
    '/.git/config',
    '/package.json',
    '/artifacts/report.json',
    '/src/%2e%2e/%2e%2e/package.json',
  ]) {
    const response = await fetch(base + route);
    assert.equal(response.status, 404, route);
  }
});
