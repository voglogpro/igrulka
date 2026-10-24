import https from 'node:https';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, chmod } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { internetAgent } from './proxy.mjs';

// Official release assets are pinned and checked before every execution.
// No service, account, firewall rule or system-wide installation is created.
export const TUNNEL_VERSION = '2026.10.3';
export const TUNNEL_ASSETS = {
  'win32-x64': [
    'cloudflared-windows-amd64.exe',
    '76b2805253d0d6ffacb092a7acfbee99e7af6917835c0c5410e23f3ef5052da2',
  ],
  'win32-ia32': [
    'cloudflared-windows-386.exe',
    '84be6271133004dc103d71b1a2b6b80cf204685ebf277e2504082793507922cf',
  ],
  'linux-x64': [
    'cloudflared-linux-amd64',
    '053b80b0a23031a038fdbf3c073f59f82b8f1f152aa67971d7383ffafc0dbab0',
  ],
  'linux-arm64': [
    'cloudflared-linux-arm64',
    '89297ebfb9e8c99c0dc013a1140601453cf3798d8306c5591651f4a3f5210be8',
  ],
};
const toolsRoot = fileURLToPath(new URL('../.tools/cloudflared/', import.meta.url));
export function verifiedBinary(bytes, digest) {
  return createHash('sha256').update(bytes).digest('hex') === digest;
}

// Explicit certificate validation also applies when the parent shell has a
// permissive NODE_TLS_REJECT_UNAUTHORIZED setting. Never execute unverified bytes.
async function download(url, remaining = 5, signal) {
  const agent = await internetAgent(url);
  return new Promise((resolve, reject) => {
    const target = new URL(url);
    if (
      target.protocol !== 'https:' ||
      ![
        'github.com',
        'release-assets.githubusercontent.com',
        'objects.githubusercontent.com',
      ].includes(target.hostname)
    ) {
      reject(Error('Неподдерживаемый адрес загрузки Cloudflare.'));
      return;
    }
    const request = https.get(
      target,
      {
        rejectUnauthorized: true,
        signal,
        agent,
        headers: { 'User-Agent': 'Skyfront-multiplayer' },
      },
      (response) => {
        if (
          [301, 302, 303, 307, 308].includes(response.statusCode) &&
          response.headers.location &&
          remaining > 0
        ) {
          response.resume();
          resolve(download(new URL(response.headers.location, target), remaining - 1, signal));
          return;
        }
        if (response.statusCode !== 200) {
          response.resume();
          reject(
            Error(
              `Не удалось загрузить Cloudflare: HTTP ${response.statusCode}. Проверьте доступ к GitHub.`,
            ),
          );
          return;
        }
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 100_000_000) response.destroy(Error('Слишком большой файл Cloudflare.'));
          else chunks.push(chunk);
        });
        response.on('error', reject);
        response.on('end', () => resolve(Buffer.concat(chunks)));
      },
    );
    request.setTimeout(90_000, () =>
      request.destroy(
        Error('Загрузка Cloudflare заняла слишком долго. Проверьте интернет и повторите запуск.'),
      ),
    );
    request.on('error', reject);
  });
}

export async function ensureTunnelBinary({
  platform = process.platform,
  arch = process.arch,
  directory = toolsRoot,
  onProgress = () => {},
  signal,
} = {}) {
  const asset = TUNNEL_ASSETS[`${platform}-${arch}`];
  if (!asset)
    throw Error(
      `Автозагрузка Cloudflare недоступна для ${platform}/${arch}. Используйте свой HTTPS-сервер: docs/MULTIPLAYER.md.`,
    );
  const [name, digest] = asset;
  const destination = path.join(directory, TUNNEL_VERSION, name);
  try {
    if (verifiedBinary(await readFile(destination), digest)) return destination;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  onProgress(
    'Первый запуск: загружаю официальный Cloudflare Tunnel. Обычно это требуется один раз.',
  );
  const bytes = await download(
    `https://github.com/cloudflare/cloudflared/releases/download/${TUNNEL_VERSION}/${name}`,
    5,
    signal,
  );
  if (!verifiedBinary(bytes, digest))
    throw Error(
      'Контрольная сумма Cloudflare не совпала. Файл не будет запущен; повторите загрузку.',
    );
  await mkdir(path.dirname(destination), { recursive: true });
  const temporary = destination + `.${process.pid}.download`;
  await writeFile(temporary, bytes);
  if (platform !== 'win32') await chmod(temporary, 0o755);
  await rename(temporary, destination);
  return destination;
}

export function publicTunnelUrl(text) {
  return (
    String(text).match(/https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.trycloudflare\.com\b/)?.[0] || null
  );
}

async function publicServerResponds(origin, signal) {
  const agent = await internetAgent(origin);
  const metadata = await new Promise((resolve, reject) => {
    const request = https.get(
      new URL('/api/server-info', origin),
      { rejectUnauthorized: true, signal, agent },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(false);
          return;
        }
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
          if (body.length > 4096) response.destroy();
        });
        response.on('error', () => resolve(false));
        response.on('close', () => resolve(false));
        response.on('end', () => {
          try {
            resolve(JSON.parse(body).publicUrl === origin);
          } catch {
            resolve(false);
          }
        });
      },
    );
    request.setTimeout(6000, () => request.destroy(Error('Public server check timeout')));
    request.on('error', (error) => (error.name === 'AbortError' ? reject(error) : resolve(false)));
  });
  if (!metadata) return false;
  // A tiny JSON response can pass through a broken/throttled route while the
  // game and snapshots cannot. Verify a complete larger response as well.
  return new Promise((resolve, reject) => {
    const request = https.get(
      new URL('/api/connection-check', origin),
      { rejectUnauthorized: true, signal, agent },
      (response) => {
        if (response.statusCode !== 200) {
          response.resume();
          resolve(false);
          return;
        }
        let bytes = 0;
        response.on('data', (chunk) => {
          bytes += chunk.length;
          if (bytes > 32768) response.destroy();
        });
        response.on('error', () => resolve(false));
        response.on('close', () => resolve(false));
        response.on('end', () => {
          resolve(bytes === 32768 && response.headers['x-skyfront-probe'] === '32k-v1');
        });
      },
    );
    request.setTimeout(6000, () => request.destroy(Error('Public server check timeout')));
    request.on('error', (error) => (error.name === 'AbortError' ? reject(error) : resolve(false)));
  });
}

// Registration alone can precede DNS/edge availability. Do not hand the player
// an invitation until the public route reaches this exact game server.
export async function waitForPublicServer(
  origin,
  { signal, timeoutMs = 45_000, check = publicServerResponds, retryMs = 1500, successes = 1 } = {},
) {
  const started = Date.now();
  let consecutive = 0;
  do {
    signal?.throwIfAborted();
    consecutive = (await check(origin, signal)) ? consecutive + 1 : 0;
    if (consecutive >= successes) return;
    if (Date.now() - started >= timeoutMs) break;
    await delay(retryMs, undefined, { signal });
  } while (Date.now() - started < timeoutMs);
  throw Error(
    'Интернет-адрес игры недоступен. Проверьте подключение и повторите запуск; локальная игра по-прежнему доступна.',
  );
}

export async function startQuickTunnel({
  localUrl,
  onProgress = () => {},
  onExit = () => {},
  spawnProcess = spawn,
  binary,
  timeoutMs = 90_000,
  signal,
} = {}) {
  const local = new URL(localUrl);
  if (local.protocol !== 'http:' || local.hostname !== '127.0.0.1')
    throw Error('Туннель может публиковать только локальный игровой сервер.');
  signal?.throwIfAborted();
  binary ??= await ensureTunnelBinary({ onProgress, signal });
  const config = path.join(toolsRoot, 'quick-config.yml');
  await mkdir(toolsRoot, { recursive: true });
  await writeFile(config, '{}\n');
  signal?.throwIfAborted();
  const child = spawnProcess(
    binary,
    ['tunnel', '--config', config, '--no-autoupdate', '--protocol', 'http2', '--url', local.origin],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );
  let stopped = false,
    exited = false,
    forceTimer;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    if (!exited) {
      child.kill();
      if (!exited) {
        forceTimer = setTimeout(() => {
          if (!exited) child.kill('SIGKILL');
        }, 4000);
        forceTimer.unref();
      }
    }
  };
  try {
    const url = await new Promise((resolve, reject) => {
      let output = '',
        settled = false,
        ready = false;
      const timer = setTimeout(
        () =>
          finish(
            reject,
            Error(
              'Не удалось получить интернет-адрес. Проверьте доступ к Cloudflare и повторите запуск.',
            ),
          ),
        timeoutMs,
      );
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        child.stdout.off('data', collect);
        child.stderr.off('data', collect);
        signal?.removeEventListener('abort', abort);
        callback(value);
      };
      const abort = () => finish(reject, signal.reason || Error('Запуск отменён.'));
      const collect = (chunk) => {
        const text = chunk.toString();
        output = (output + text).slice(-16_384);
        if (/ERR /.test(text)) onProgress(text.trim().slice(-1200));
        const found = publicTunnelUrl(output);
        if (found && /Registered tunnel connection/.test(output)) {
          ready = true;
          finish(resolve, found);
        }
      };
      child.stdout.on('data', collect);
      child.stderr.on('data', collect);
      child.once('error', (error) => finish(reject, error));
      child.once('exit', (code) => {
        exited = true;
        clearTimeout(forceTimer);
        if (ready) {
          if (!stopped) onExit(code);
        } else
          finish(
            reject,
            Error(
              `Cloudflare завершился (${code ?? 'signal'}). Проверьте интернет и повторите запуск.`,
            ),
          );
      });
      signal?.addEventListener('abort', abort, { once: true });
      if (signal?.aborted) abort();
    });
    if (exited) throw Error('Cloudflare завершился во время запуска. Повторите запуск сервера.');
    // Keep pipes drained without flooding the game server console.
    const reportError = (chunk) => {
      const message = chunk.toString();
      if (/ERR |WRN /.test(message)) onProgress(message.trim().slice(-1800));
    };
    child.stdout.on('data', reportError);
    child.stderr.on('data', reportError);
    child.stdout.resume();
    child.stderr.resume();
    return { url, stop, child };
  } catch (error) {
    stop();
    throw error;
  }
}
