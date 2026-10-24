import test from 'node:test';
import assert from 'node:assert/strict';
import { createInternetProxyResolver } from '../../server/proxy.mjs';

test('environment precedence, protocol split and explicit proxy credentials remain intact', async () => {
  const resolver = createInternetProxyResolver({
    platform: 'linux',
    env: {
      HTTPS_PROXY: 'http://user:secret@proxy.test:8080',
      HTTP_PROXY: 'http://plain.test:80',
      ALL_PROXY: 'https://fallback.test',
    },
  });
  assert.equal((await resolver.internetProxy('wss://game.test/match')).hostname, 'proxy.test');
  assert.equal((await resolver.internetProxy('https://game.test')).password, 'secret');
  assert.equal((await resolver.internetProxy('http://game.test')).hostname, 'plain.test');
});

test('loopback and no_proxy exact, suffix and port rules bypass proxy', async () => {
  const resolver = createInternetProxyResolver({
    platform: 'linux',
    env: { ALL_PROXY: 'http://proxy.test', NO_PROXY: '.private.test,only.test:8443' },
  });
  for (const target of [
    'https://localhost',
    'http://127.0.0.2',
    'http://[::1]',
    'https://a.private.test',
    'https://private.test',
    'https://only.test:8443',
  ])
    assert.equal(await resolver.internetProxy(target), null);
  assert.ok(await resolver.internetProxy('https://only.test'));
  assert.ok(await resolver.internetProxy('https://notprivate.test'));
});

test('Windows enabled split proxy, override and cache expiration', async () => {
  let reads = 0,
    clock = 0;
  const resolver = createInternetProxyResolver({
    env: {},
    platform: 'win32',
    now: () => clock,
    readRegistry: async () => {
      reads++;
      return {
        ProxyEnable: '0x1',
        ProxyServer: 'http=plain.test:8080;https=secure.test:8081;socks=unsupported.test',
        ProxyOverride: '*.internal.test;<local>',
      };
    },
  });
  assert.equal((await resolver.internetProxy('https://game.test')).host, 'secure.test:8081');
  assert.equal((await resolver.internetProxy('http://game.test')).host, 'plain.test:8080');
  assert.equal(await resolver.internetProxy('https://a.internal.test'), null);
  assert.equal(await resolver.internetProxy('http://printer'), null);
  assert.equal(reads, 1);
  clock = 30001;
  await resolver.internetProxy('https://game.test');
  assert.equal(reads, 2);
});

test('disabled, malformed, unsupported and failed settings safely return direct', async () => {
  for (const value of [
    'socks5://proxy.test',
    'http://proxy.test/path',
    'http://proxy.test/?secret=x',
    'http://proxy.test\nsecret',
    'http://[invalid',
  ]) {
    const resolver = createInternetProxyResolver({
      env: { HTTPS_PROXY: value },
      platform: 'linux',
    });
    assert.equal(await resolver.internetProxy(), null);
  }
  const disabled = createInternetProxyResolver({
    env: {},
    platform: 'win32',
    readRegistry: async () => ({ ProxyEnable: 0, ProxyServer: 'proxy.test:80' }),
  });
  assert.equal(await disabled.internetProxy(), null);
  const failed = createInternetProxyResolver({
    env: {},
    platform: 'win32',
    readRegistry: async () => {
      throw Error('private settings');
    },
  });
  assert.equal(await failed.internetProxy(), null);
});

test('agent reuse is bounded and TLS verification stays enabled', async () => {
  const resolver = createInternetProxyResolver({
    env: {},
    platform: 'win32',
    readRegistry: async () => ({ ProxyEnable: 1, ProxyServer: 'proxy.test:8080' }),
  });
  const first = await resolver.internetAgent('https://game.test');
  assert.equal(first, await resolver.internetAgent('wss://other.test'));
  assert.equal(first.connectOpts.rejectUnauthorized, true);
  assert.equal(await resolver.internetAgent('http://localhost'), undefined);
  first.destroy();
});
