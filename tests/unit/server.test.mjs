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

test('internet entry bundles game modules and loads fonts separately without blocking startup', async (t) => {
  const server = createGameServer({ standalone: true });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const response = await fetch(base + '/?multiplayer=1', {
    headers: { 'Accept-Encoding': 'gzip' },
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-encoding'), 'gzip');
  assert.equal(response.headers.get('vary'), 'Accept-Encoding');
  const html = await response.text();
  const styles = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
  assert.ok(
    styles && !styles.includes('\uFEFF'),
    'concatenated CSS must not turn a BOM into a non-matching selector',
  );
  assert.match(html, /name="skyfront-distribution" content="standalone"/);
  assert.ok(!html.includes('<script type="module" src="src/main.js">'));
  assert.ok(!html.includes('<link rel="stylesheet" href="src/'));
  assert.ok(!html.includes('data:font/'));
  assert.ok(html.includes('href="/src/ui/fonts.css"'));
  assert.ok(html.includes('Загружаем город'));
  const fonts = await fetch(base + '/src/ui/fonts.css');
  assert.equal(fonts.headers.get('content-encoding'), 'gzip');
  assert.match(await fonts.text(), /font-display: swap/);
  const unchanged = await fetch(base + '/src/ui/fonts.css', {
    headers: { 'If-None-Match': fonts.headers.get('etag') },
  });
  assert.equal(unchanged.status, 304);
  assert.equal((await unchanged.arrayBuffer()).byteLength, 0);
  assert.equal((await fetch(base + '/.tools/cloudflared/quick-config.yml')).status, 404);
});
