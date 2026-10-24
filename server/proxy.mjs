import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { HttpsProxyAgent } from 'https-proxy-agent';

const run = promisify(execFile);
async function windowsProxy() {
  try {
    const { stdout } = await run(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
      { windowsHide: true, timeout: 3000, maxBuffer: 65536 },
    );
    const values = {};
    for (const line of stdout.split(/\r?\n/)) {
      const match = line.match(/^\s*(ProxyEnable|ProxyServer|ProxyOverride)\s+REG_\w+\s+(.*)$/);
      if (match) values[match[1]] = match[2].trim();
    }
    return values;
  } catch {
    return {};
  }
}

function proxyURL(value) {
  if (!value || /[\r\n\\]/.test(value)) return null;
  try {
    const url = new URL(value.includes('://') ? value : `http://${value}`);
    return ['http:', 'https:'].includes(url.protocol) &&
      url.hostname &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
      ? url
      : null;
  } catch {
    return null;
  }
}

function bypass(target, rules = '') {
  const host = target.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host))
    return true;
  return rules
    .split(/[;,\s]+/)
    .filter(Boolean)
    .some((rule) => {
      rule = rule.toLowerCase();
      if (rule === '*') return true;
      if (rule === '<local>') return !host.includes('.') && !host.includes(':');
      const match = rule.match(/^(.*?)(?::(\d+))?$/);
      const name = match[1].replace(/^\*?\./, '');
      const port = target.port || (['https:', 'wss:'].includes(target.protocol) ? '443' : '80');
      if (match[2] && match[2] !== port) return false;
      return host === name || host.endsWith(`.${name}`);
    });
}

// Ports keep registry access and process configuration outside unit tests.
export function createInternetProxyResolver({
  env = process.env,
  platform = process.platform,
  readRegistry = windowsProxy,
  now = Date.now,
} = {}) {
  let registry,
    expires = 0;
  const agents = new Map();
  async function internetProxy(targetURL = 'https://internet.invalid') {
    let target;
    try {
      target = new URL(targetURL);
    } catch {
      return null;
    }
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(target.protocol)) return null;
    if (bypass(target, env.NO_PROXY || env.no_proxy || '')) return null;
    const secure = ['https:', 'wss:'].includes(target.protocol);
    const configured = secure
      ? env.HTTPS_PROXY || env.https_proxy
      : env.HTTP_PROXY || env.http_proxy;
    const environmentProxy = configured || env.ALL_PROXY || env.all_proxy;
    if (environmentProxy) return proxyURL(environmentProxy);
    if (platform !== 'win32') return null;
    if (!registry || now() >= expires) {
      try {
        registry = await readRegistry();
      } catch {
        registry = {};
      }
      registry ||= {};
      expires = now() + 30_000;
    }
    if (
      !['1', '0x1'].includes(String(registry.ProxyEnable)) ||
      bypass(target, registry.ProxyOverride)
    )
      return null;
    const configuredServer = String(registry.ProxyServer || '');
    if (!configuredServer.includes('=')) return proxyURL(configuredServer);
    const entries = Object.fromEntries(
      configuredServer.split(';').map((part) => {
        const index = part.indexOf('=');
        return [part.slice(0, index).trim().toLowerCase(), part.slice(index + 1).trim()];
      }),
    );
    return proxyURL(entries[secure ? 'https' : 'http']);
  }
  async function internetAgent(targetURL) {
    const proxy = await internetProxy(targetURL);
    if (!proxy) return undefined;
    const key = proxy.href;
    if (!agents.has(key)) {
      if (agents.size >= 8) {
        const oldest = agents.keys().next().value;
        agents.get(oldest).destroy();
        agents.delete(oldest);
      }
      agents.set(key, new HttpsProxyAgent(proxy, { rejectUnauthorized: true }));
    }
    return agents.get(key);
  }
  return { internetProxy, internetAgent };
}

export const { internetProxy, internetAgent } = createInternetProxyResolver();
