import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { internetProxy } from './proxy.mjs';

const toolsRoot = fileURLToPath(new URL('../.tools/localhost-run/', import.meta.url));
const tunnelHost = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:lhr\.life|localhost\.run)$/i;
const reservedHosts = new Set(['docs.localhost.run', 'admin.localhost.run', 'www.localhost.run']);
export const sshKnownHostsOption = (filename) =>
  `UserKnownHostsFile="${filename.replaceAll('\\', '/').replaceAll('"', '\\"')}"`;
export const sshProxyCommand = (nodePath, helperPath) =>
  `ProxyCommand="${nodePath.replaceAll('\\', '/')}" "${helperPath.replaceAll('\\', '/')}"`;

// Only accepted forwarding events count. Banners, documentation links and QR output cannot
// accidentally become the advertised game address.
export function sshTunnelUrl(event) {
  if (
    !event ||
    event.type !== 'v1.tcpip_forward.register.accepted' ||
    event.source !== 'ssh://localhost.run/' ||
    typeof event.id !== 'string' ||
    !event.id.startsWith('localhost/') ||
    typeof event.data !== 'string'
  )
    return null;
  const hostname = event.id.slice('localhost/'.length).toLowerCase();
  if (!tunnelHost.test(hostname) || reservedHosts.has(hostname)) return null;
  for (const candidate of event.data.match(/https:\/\/[^\s<>"']+/g) || []) {
    try {
      const url = new URL(candidate);
      if (
        url.protocol === 'https:' &&
        url.hostname === hostname &&
        !url.username &&
        !url.password &&
        !url.port &&
        url.pathname === '/' &&
        !url.search &&
        !url.hash
      )
        return url.origin;
    } catch {
      /* Ignore non-URL banner fragments. */
    }
  }
  return null;
}

export async function startSshTunnel({
  localUrl,
  onProgress = () => {},
  onExit = () => {},
  onUrlChange = () => {},
  signal,
  spawnProcess = spawn,
  proxyLookup = internetProxy,
  nodePath = process.execPath,
  proxyHelper = fileURLToPath(new URL('./ssh-proxy.mjs', import.meta.url)),
  binary = process.platform === 'win32'
    ? path.join(process.env.SystemRoot || 'C:/Windows', 'System32', 'OpenSSH', 'ssh.exe')
    : 'ssh',
  timeoutMs = 45_000,
} = {}) {
  const local = new URL(localUrl);
  if (
    local.protocol !== 'http:' ||
    local.hostname !== '127.0.0.1' ||
    local.username ||
    local.password
  )
    throw Error('SSH-туннель может публиковать только локальный игровой HTTP-сервер.');
  signal?.throwIfAborted();
  const proxy = await proxyLookup('https://localhost.run:22');
  signal?.throwIfAborted();
  await mkdir(toolsRoot, { recursive: true });
  const config = path.join(toolsRoot, 'isolated-config');
  await writeFile(config, '# Skyfront: no user SSH config or identities.\n');
  signal?.throwIfAborted();
  onProgress('Подключаю интернет-адрес через localhost.run…');
  const child = spawnProcess(
    binary,
    [
      ...(proxy ? ['-o', sshProxyCommand(nodePath, proxyHelper)] : []),
      '-F',
      config,
      '-T',
      '-o',
      'BatchMode=yes',
      '-o',
      'IdentitiesOnly=yes',
      '-o',
      'IdentityFile=none',
      '-o',
      'IdentityAgent=none',
      '-o',
      'ForwardAgent=no',
      '-o',
      'ForwardX11=no',
      '-o',
      sshKnownHostsOption(path.join(toolsRoot, 'known_hosts')),
      '-o',
      'GlobalKnownHostsFile=none',
      '-o',
      'StrictHostKeyChecking=accept-new',
      '-o',
      'ExitOnForwardFailure=yes',
      '-o',
      'ServerAliveInterval=15',
      '-o',
      'ServerAliveCountMax=2',
      '-o',
      'ConnectTimeout=15',
      '-o',
      'ConnectionAttempts=1',
      '-R',
      `80:127.0.0.1:${local.port || 80}`,
      'nokey@localhost.run',
      '--',
      '--output',
      'json',
    ],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  let exited = false,
    stopped = false,
    returned = false,
    settled = false,
    currentUrl = null;
  let startupTimer, forceTimer, resolveStartup, rejectStartup;
  const buffers = ['', ''],
    decoders = [new StringDecoder('utf8'), new StringDecoder('utf8')];
  const startup = new Promise((resolve, reject) => {
    resolveStartup = resolve;
    rejectStartup = reject;
  });
  const cleanRead = () => {
    child.stdout.off('data', stdout);
    child.stderr.off('data', stderr);
    child.stdout.resume();
    child.stderr.resume();
  };
  const settle = (error, url) => {
    if (settled) return;
    settled = true;
    clearTimeout(startupTimer);
    if (error) {
      cleanRead();
      rejectStartup(error);
    } else resolveStartup(url);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    signal?.removeEventListener('abort', abort);
    if (!settled) settle(Error('Запуск SSH-туннеля отменён.'));
    cleanRead();
    if (exited) return;
    child.kill();
    if (!exited) {
      forceTimer = setTimeout(() => {
        if (!exited) child.kill('SIGKILL');
      }, 4000);
      forceTimer.unref();
    }
  };
  const abort = () => {
    settle(signal.reason || Error('Запуск SSH-туннеля отменён.'));
    stop();
  };
  const collect = (channel, chunk) => {
    if (stopped || exited) return;
    buffers[channel] += decoders[channel].write(chunk);
    let newline;
    while (!stopped && !exited && (newline = buffers[channel].indexOf('\n')) >= 0) {
      const line = buffers[channel].slice(0, newline).trim();
      buffers[channel] = buffers[channel].slice(newline + 1);
      if (line.length > 32_768 || !line.startsWith('{')) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      const url = sshTunnelUrl(event);
      if (url) {
        if (!settled) {
          currentUrl = url;
          settle(null, url);
        } else if (currentUrl && currentUrl !== url) {
          currentUrl = url;
          onUrlChange(url);
        }
      }
    }
    if (buffers[channel].length > 65_536) buffers[channel] = '';
  };
  const stdout = (chunk) => collect(0, chunk),
    stderr = (chunk) => collect(1, chunk);
  child.stdout.on('data', stdout);
  child.stderr.on('data', stderr);
  child.on('error', () => {
    cleanRead();
    if (!settled) settle(Error('Не удалось запустить SSH. Проверьте наличие OpenSSH.'));
    else if (returned && !stopped && !exited) {
      onExit(null);
      stop();
    }
  });
  child.once('exit', (code) => {
    exited = true;
    clearTimeout(forceTimer);
    signal?.removeEventListener('abort', abort);
    cleanRead();
    if (!settled) settle(Error('SSH-соединение закрыто. Проверьте доступ к localhost.run.'));
    else if (returned && !stopped) onExit(code);
  });
  startupTimer = setTimeout(
    () =>
      settle(
        Error(
          'Не удалось получить интернет-адрес через SSH. Проверьте подключение и повторите запуск.',
        ),
      ),
    timeoutMs,
  );
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  try {
    const url = await startup;
    signal?.throwIfAborted();
    if (exited) throw Error('SSH-соединение закрылось во время запуска.');
    returned = true;
    return { url, stop, child, provider: 'localhost.run' };
  } catch (error) {
    stop();
    throw error;
  }
}
