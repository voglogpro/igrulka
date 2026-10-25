import { serverAddress } from './client.js';

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const PAGE_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

function pageAddress(value) {
  const url = new globalThis.URL(value);
  if (!PAGE_PROTOCOLS.has(url.protocol) || url.username || url.password)
    throw Error('Откройте приглашение по адресу http:// или https://');
  return url;
}

function singleParameter(url, name) {
  const values = url.searchParams.getAll(name);
  if (values.length > 1) throw Error('В приглашении повторяется параметр ' + name);
  return values[0] ?? null;
}

export function roomCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  if (!ROOM_CODE.test(code)) throw Error('Код комнаты — 6 букв или цифр без I, O, 0 и 1');
  return code;
}

// Reuse the actual client's endpoint contract: invitations cannot point at a
// different WebSocket path or carry credentials, query tokens or resume tokens.
export function normalizeServerAddress(value, pageURL = null) {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    [...value].some((character) => {
      const code = character.charCodeAt(0);
      return code < 32 || code === 127 || character === '\\';
    })
  )
    throw Error('Укажите адрес http://, https://, ws:// или wss:// сервера');
  const address = serverAddress(value.trim());
  if (pageURL && pageAddress(pageURL).protocol === 'https:' && address.startsWith('ws:'))
    throw Error('Для игры по HTTPS нужен защищённый сервер https:// или wss://');
  return address;
}

export function defaultServerAddress(pageURL, fallback = 'http://127.0.0.1:8788') {
  const page = pageAddress(pageURL);
  return normalizeServerAddress(page.protocol === 'file:' ? fallback : page.origin, pageURL);
}

export function parseRoomInvite(pageURL) {
  const page = pageAddress(pageURL),
    code = singleParameter(page, 'room');
  if (code === null) return null;
  const server = singleParameter(page, 'server');
  return {
    code: roomCode(code),
    address:
      server === null ? defaultServerAddress(pageURL) : normalizeServerAddress(server, pageURL),
  };
}

function httpServerPage(address) {
  const url = new globalThis.URL(address);
  url.protocol = url.protocol === 'wss:' ? 'https:' : 'http:';
  url.pathname = '/';
  return url;
}

function loopback(url) {
  return (
    url.hostname === 'localhost' ||
    url.hostname.endsWith('.localhost') ||
    url.hostname.startsWith('127.') ||
    url.hostname === '[::1]'
  );
}

// publicURL is metadata from the selected game server. For a localhost host using
// a tunnel it replaces BOTH the shareable page and its server endpoint, while the
// actual live session continues using its original address.
export function roomInviteUrl({ pageURL, address, code, publicURL = null, clientURL = null }) {
  const page = pageAddress(pageURL),
    normalizedCode = roomCode(code);
  let server = normalizeServerAddress(address);
  let sharePage;
  if (publicURL) {
    sharePage = pageAddress(publicURL);
    if (sharePage.protocol === 'file:')
      throw Error('Для приглашения нужен публичный HTTP(S) адрес');
    server = defaultServerAddress(sharePage.href);
  } else {
    const serverPage = httpServerPage(server);
    sharePage =
      page.protocol === 'file:' || (loopback(page) && !loopback(serverPage))
        ? serverPage
        : new globalThis.URL(page.href);
  }
  if (clientURL) {
    sharePage = pageAddress(clientURL);
    if (sharePage.protocol !== 'https:') throw Error('Страница игры должна использовать HTTPS');
  }
  normalizeServerAddress(server, sharePage.href);
  sharePage.search = '';
  sharePage.hash = '';
  sharePage.searchParams.set('room', normalizedCode);
  if (server !== defaultServerAddress(sharePage.href)) sharePage.searchParams.set('server', server);
  return sharePage.href;
}

export function multiplayerEntry(pageURL) {
  const page = pageAddress(pageURL),
    invite = parseRoomInvite(pageURL);
  if (invite) return { kind: 'join', invite };
  if (singleParameter(page, 'multiplayer') !== '1') return null;
  const server = singleParameter(page, 'server');
  return {
    kind: 'create',
    address:
      server === null ? defaultServerAddress(pageURL) : normalizeServerAddress(server, pageURL),
  };
}
