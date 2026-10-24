import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import {
  sshTunnelUrl,
  startSshTunnel,
  sshKnownHostsOption,
  sshProxyCommand,
} from '../../server/ssh-tunnel.mjs';

const accepted = (hostname = 'example123.lhr.life') => ({
  specversion: '1.0',
  id: `localhost/${hostname}`,
  source: 'ssh://localhost.run/',
  type: 'v1.tcpip_forward.register.accepted',
  data: `${hostname} tunneled with tls termination, https://${hostname}\r\nhttps://localhost.run/docs/forever-free/`,
});
function childFixture({ autoExit = true } = {}) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kills = [];
  child.kill = (signal = 'SIGTERM') => {
    child.kills.push(signal);
    if (autoExit) child.emit('exit', null, signal);
    return true;
  };
  return child;
}
function launch(
  child,
  action = () => child.stdout.write(JSON.stringify(accepted()) + '\n'),
  extra = {},
) {
  return startSshTunnel({
    localUrl: 'http://127.0.0.1:8788',
    binary: 'ssh-test',
    proxyLookup: async () => null,
    spawnProcess: (binary, args, options) => {
      child.invocation = { binary, args, options };
      queueMicrotask(action);
      return child;
    },
    ...extra,
  });
}

test('SSH endpoint parser accepts only matching HTTPS forwarding events, never banner/docs URLs', () => {
  assert.equal(sshTunnelUrl(accepted()), 'https://example123.lhr.life');
  assert.equal(sshTunnelUrl(accepted('game123.localhost.run')), 'https://game123.localhost.run');
  for (const event of [
    { ...accepted(), type: 'notice' },
    { ...accepted(), source: 'ssh://untrusted.example/' },
    accepted('docs.localhost.run'),
    accepted('admin.localhost.run'),
    accepted('evil.lhr.life.example'),
    { ...accepted(), data: 'https://different.lhr.life' },
    { ...accepted(), data: 'https://user:secret@example123.lhr.life' },
    { ...accepted(), data: 'https://example123.lhr.life/?token=private' },
    { ...accepted(), data: 'http://example123.lhr.life' },
  ])
    assert.equal(sshTunnelUrl(event), null);
});

test('SSH known-hosts option quotes the entire filename for OpenSSH own config parser', () => {
  assert.equal(
    sshKnownHostsOption('C:\\Skyfront Test\\known_hosts'),
    'UserKnownHostsFile="C:/Skyfront Test/known_hosts"',
  );
});

test('SSH conditional proxy command quotes Unicode paths and never includes proxy credentials', async () => {
  const child = childFixture();
  let queried;
  const tunnel = await launch(child, undefined, {
    nodePath: 'C:\\Program Files\\nodejs\\node.exe',
    proxyHelper: 'C:\\Игры Ани\\server\\ssh-proxy.mjs',
    proxyLookup: async (target) => {
      queried = target;
      return new URL('http://user:private@proxy.invalid:8080');
    },
  });
  assert.equal(queried, 'https://localhost.run:22');
  const command = child.invocation.args.find((arg) => arg.startsWith('ProxyCommand='));
  assert.equal(
    command,
    sshProxyCommand('C:\\Program Files\\nodejs\\node.exe', 'C:\\Игры Ани\\server\\ssh-proxy.mjs'),
  );
  assert.equal(
    command,
    'ProxyCommand="C:/Program Files/nodejs/node.exe" "C:/Игры Ани/server/ssh-proxy.mjs"',
  );
  assert.ok(!child.invocation.args.join(' ').includes('private'));
  assert.ok(!child.invocation.args.join(' ').includes('proxy.invalid'));
  tunnel.stop();
});

test('SSH launch uses project-only config/known hosts and no identities or agent; split JSON survives stderr', async () => {
  const child = childFixture(),
    progress = [];
  const tunnel = await launch(
    child,
    () => {
      const line = JSON.stringify(accepted()) + '\n';
      child.stdout.write('Welcome. connection id PRIVATE-PII\n' + line.slice(0, 55));
      child.stderr.write('Unrelated banner https://docs.localhost.run/\n');
      child.stdout.write(line.slice(55));
    },
    { onProgress: (message) => progress.push(message) },
  );
  assert.equal(tunnel.url, 'https://example123.lhr.life');
  assert.equal(tunnel.provider, 'localhost.run');
  const { args, options } = child.invocation;
  for (const option of [
    'BatchMode=yes',
    'IdentitiesOnly=yes',
    'IdentityFile=none',
    'IdentityAgent=none',
    'GlobalKnownHostsFile=none',
    'StrictHostKeyChecking=accept-new',
    'ExitOnForwardFailure=yes',
    'ServerAliveInterval=15',
  ])
    assert.ok(args.includes(option), option);
  assert.ok(
    args
      .find((arg) => arg.startsWith('UserKnownHostsFile='))
      .replaceAll('\\', '/')
      .includes('/.tools/localhost-run/known_hosts'),
  );
  assert.ok(
    args[args.indexOf('-F') + 1]
      .replaceAll('\\', '/')
      .includes('/.tools/localhost-run/isolated-config'),
  );
  assert.ok(args.includes('80:127.0.0.1:8788') && args.includes('nokey@localhost.run'));
  assert.equal(options.windowsHide, true);
  assert.ok(progress.every((message) => !message.includes('PRIVATE-PII')));
  tunnel.stop();
  tunnel.stop();
  assert.deepEqual(child.kills, ['SIGTERM']);
});

test('SSH rejects non-loopback targets and pre-cancelled startup before spawning', async () => {
  let spawns = 0;
  for (const localUrl of [
    'http://localhost:8788',
    'https://127.0.0.1:8788',
    'http://10.0.0.2:8788',
    'http://secret@127.0.0.1:8788',
  ])
    await assert.rejects(startSshTunnel({ localUrl, spawnProcess: () => spawns++ }));
  const controller = new AbortController();
  controller.abort(Error('cancelled'));
  await assert.rejects(
    startSshTunnel({
      localUrl: 'http://127.0.0.1:8788',
      signal: controller.signal,
      spawnProcess: () => spawns++,
    }),
    /cancelled/,
  );
  assert.equal(spawns, 0);
});

test('SSH keeps reading split address rotations, ignores duplicates and invalid events, and stops all notifications on stop', async () => {
  const child = childFixture({ autoExit: false }),
    changes = [];
  const line = (host) => JSON.stringify(accepted(host)) + '\n';
  const tunnel = await launch(child, undefined, { onUrlChange: (url) => changes.push(url) });
  assert.equal(tunnel.url, 'https://example123.lhr.life');
  assert.deepEqual(
    changes,
    [],
    'initial registration resolves startup without a change notification',
  );
  assert.equal(child.stdout.listenerCount('data'), 1);
  assert.equal(child.stderr.listenerCount('data'), 1);
  child.stdout.write(line('example123.lhr.life'));
  const rotated = line('second456.lhr.life');
  child.stderr.write(rotated.slice(0, 71));
  assert.deepEqual(changes, []);
  child.stdout.write(
    JSON.stringify({ ...accepted('fake.localhost.run'), source: 'ssh://untrusted.example/' }) +
      '\n',
  );
  child.stderr.write(rotated.slice(71));
  child.stdout.write(
    line('second456.lhr.life') + line('third789.localhost.run') + line('third789.localhost.run'),
  );
  assert.deepEqual(changes, ['https://second456.lhr.life', 'https://third789.localhost.run']);
  tunnel.stop();
  assert.equal(child.stdout.listenerCount('data'), 0);
  assert.equal(child.stderr.listenerCount('data'), 0);
  child.stdout.write(line('fourth000.lhr.life'));
  child.stderr.write(line('fifth000.lhr.life'));
  assert.equal(changes.length, 2);
  assert.deepEqual(child.kills, ['SIGTERM']);
  child.emit('exit', null);
});

test('SSH address readers are removed after runtime errors or exit, including a stop inside the change callback', async () => {
  for (const termination of ['error', 'exit', 'callback-stop']) {
    const child = childFixture(),
      changes = [];
    let tunnel;
    tunnel = await launch(child, undefined, {
      onUrlChange: (url) => {
        changes.push(url);
        if (termination === 'callback-stop') tunnel.stop();
      },
    });
    if (termination === 'callback-stop') {
      child.stdout.write(
        JSON.stringify(accepted('second456.lhr.life')) +
          '\n' +
          JSON.stringify(accepted('third789.lhr.life')) +
          '\n',
      );
      assert.deepEqual(changes, ['https://second456.lhr.life']);
    } else child.emit(termination, termination === 'error' ? Error('test') : 2);
    assert.equal(child.stdout.listenerCount('data'), 0);
    assert.equal(child.stderr.listenerCount('data'), 0);
    child.stdout.write(JSON.stringify(accepted('last000.lhr.life')) + '\n');
    assert.equal(changes.length, termination === 'callback-stop' ? 1 : 0);
    tunnel.stop();
  }
});

test('SSH timeout, spawn failure and active startup cancellation stop only the owned process', async () => {
  const timed = childFixture();
  await assert.rejects(
    launch(timed, () => {}, { timeoutMs: 15 }),
    /интернет-адрес/,
  );
  assert.deepEqual(timed.kills, ['SIGTERM']);
  const failed = childFixture();
  await assert.rejects(
    launch(failed, () => failed.emit('error', Error('private-path'))),
    /OpenSSH/,
  );
  assert.deepEqual(failed.kills, ['SIGTERM']);
  const aborted = childFixture(),
    controller = new AbortController();
  await assert.rejects(
    launch(aborted, () => controller.abort(Error('cancelled')), { signal: controller.signal }),
    /cancelled/,
  );
  assert.deepEqual(aborted.kills, ['SIGTERM']);
});

test('SSH exit between registration and return rejects startup; later unexpected exit calls onExit once', async () => {
  const early = childFixture(),
    earlyCalls = [];
  await assert.rejects(
    launch(
      early,
      () => {
        early.stdout.write(JSON.stringify(accepted()) + '\n');
        early.emit('exit', 2);
      },
      { onExit: (code) => earlyCalls.push(code) },
    ),
    /во время запуска/,
  );
  assert.deepEqual(earlyCalls, []);
  const live = childFixture(),
    calls = [];
  const tunnel = await launch(live, undefined, { onExit: (code) => calls.push(code) });
  live.emit('exit', 3);
  live.emit('exit', 4);
  assert.deepEqual(calls, [3]);
  tunnel.stop();
  assert.deepEqual(live.kills, []);
});

test('SSH stop escalates a non-exiting child after grace period; lifetime abort also closes a ready tunnel', async (t) => {
  const stubborn = childFixture({ autoExit: false });
  const tunnel = await launch(stubborn);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  tunnel.stop();
  assert.deepEqual(stubborn.kills, ['SIGTERM']);
  t.mock.timers.tick(4000);
  assert.deepEqual(stubborn.kills, ['SIGTERM', 'SIGKILL']);
  stubborn.emit('exit', null);
  t.mock.timers.reset();
  const child = childFixture(),
    controller = new AbortController();
  await launch(child, undefined, { signal: controller.signal });
  controller.abort();
  assert.deepEqual(child.kills, ['SIGTERM']);
});
