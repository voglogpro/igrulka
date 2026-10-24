import http from 'node:http';
import https from 'node:https';
import { pathToFileURL } from 'node:url';
import { internetProxy } from './proxy.mjs';

// This helper has one destination. Proxy configuration never appears in argv or diagnostics.
export async function bridgeSshProxy({
  input = process.stdin,
  output = process.stdout,
  proxyLookup = internetProxy,
  target = 'localhost.run:22',
  timeoutMs = 15_000,
} = {}) {
  if (target !== 'localhost.run:22') throw Error('Unsupported SSH bridge destination');
  const proxy = await proxyLookup('https://localhost.run:22');
  if (!proxy || !['http:', 'https:'].includes(proxy.protocol)) throw Error('SSH proxy unavailable');
  const headers = { Host: target };
  if (proxy.username || proxy.password)
    headers['Proxy-Authorization'] =
      `Basic ${Buffer.from(`${decodeURIComponent(proxy.username)}:${decodeURIComponent(proxy.password)}`).toString('base64')}`;
  await new Promise((resolve, reject) => {
    let socket,
      timer,
      done = false;
    const finish = (failed = false) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      input.off('error', fail);
      output.off('error', fail);
      if (socket) {
        input.unpipe(socket);
        socket.unpipe(output);
        socket.destroy();
      }
      request.destroy();
      input.pause();
      if (failed) reject(Error('SSH proxy connection failed'));
      else resolve();
    };
    const fail = () => finish(true);
    const request = (proxy.protocol === 'https:' ? https : http).request({
      hostname: proxy.hostname,
      port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
      method: 'CONNECT',
      path: target,
      headers,
      agent: false,
      rejectUnauthorized: true,
    });
    timer = setTimeout(fail, timeoutMs);
    request.on('error', fail);
    input.once('error', fail);
    output.once('error', fail);
    request.on('connect', (response, connected, head) => {
      socket = connected;
      if (done || response.statusCode !== 200) {
        fail();
        connected.destroy();
        return;
      }
      clearTimeout(timer);
      socket.on('error', fail);
      socket.once('close', () => finish());
      // pipe manages backpressure in both directions, including CONNECT head bytes.
      if (head.length) socket.unshift(head);
      socket.pipe(output);
      input.pipe(socket);
    });
    request.end();
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    if (process.argv.length !== 2) throw Error('Unsupported arguments');
    await bridgeSshProxy();
  } catch {
    process.stderr.write('SSH proxy connection failed.\n');
    process.exitCode = 1;
  } finally {
    process.stdin.destroy();
  }
}
