import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { NetworkSession, serverAddress } from '../../src/network/client.js';
import { createRoomServer } from '../../server/rooms.mjs';
import {
  defaultServerAddress,
  normalizeServerAddress,
  roomCode,
  parseRoomInvite,
  roomInviteUrl,
  multiplayerEntry,
} from '../../src/network/invite.js';
import { openMultiplayerEntry } from '../../src/ui/session/multiplayer-entry.js';

test('hosted games select their own server and secure scheme; file games preserve the local fallback', () => {
  assert.equal(
    defaultServerAddress('https://friends.example/play/?other=1'),
    'wss://friends.example/match',
  );
  assert.equal(defaultServerAddress('http://127.0.0.1:8788/'), 'ws://127.0.0.1:8788/match');
  assert.equal(defaultServerAddress('file:///C:/game/Skyfront.html'), 'ws://127.0.0.1:8788/match');
  assert.equal(
    defaultServerAddress('file:///C:/game/Skyfront.html', 'https://friends.example'),
    'wss://friends.example/match',
  );
  for (const value of [
    'https://friends.example/path?token=private#secret',
    'ws://192.168.1.3:8788',
    'http://[::1]:8788/a',
  ])
    assert.equal(normalizeServerAddress(value), serverAddress(value));
  assert.throws(
    () => normalizeServerAddress('http://friends.example', 'https://game.example'),
    /HTTPS/,
  );
});

test('same-origin invites roundtrip the actual room while excluding passwords, resume tokens and unrelated URL state', () => {
  const invite = roomInviteUrl({
    pageURL: 'https://friends.example/play/?token=resume-secret&server=old.example#private',
    address: 'wss://friends.example/match?token=another-secret',
    code: ' abc234 ',
  });
  assert.equal(invite, 'https://friends.example/play/?room=ABC234');
  assert.deepEqual(parseRoomInvite(invite), {
    code: 'ABC234',
    address: 'wss://friends.example/match',
  });
  assert.equal(roomCode(' xyz789 '), 'XYZ789');
  assert.equal(parseRoomInvite('https://friends.example/?other=1'), null);
});

test('static and file clients create actionable links and explicit servers remain scoped to that invitation', () => {
  const staticLink = roomInviteUrl({
    pageURL: 'https://game.example/Skyfront.html',
    address: 'wss://friends.example:9443/match',
    code: 'ABC234',
  });
  assert.deepEqual(parseRoomInvite(staticLink), {
    code: 'ABC234',
    address: 'wss://friends.example:9443/match',
  });
  const fileLink = roomInviteUrl({
    pageURL: 'file:///C:/Users/owner/Skyfront.html',
    address: 'ws://192.168.1.3:8788/match',
    code: 'ABC234',
  });
  assert.equal(fileLink, 'http://192.168.1.3:8788/?room=ABC234');
  assert.ok(!fileLink.includes('owner'));
  assert.deepEqual(parseRoomInvite(fileLink), {
    code: 'ABC234',
    address: 'ws://192.168.1.3:8788/match',
  });
  assert.throws(
    () =>
      roomInviteUrl({
        pageURL: 'https://game.example/',
        address: 'ws://friends.example',
        code: 'ABC234',
      }),
    /HTTPS/,
  );
});

test('a tunnel public URL replaces the invite origin and endpoint without changing the live local session address', () => {
  const address = 'ws://127.0.0.1:8788/match';
  const link = roomInviteUrl({
    pageURL: 'http://127.0.0.1:8788/?multiplayer=1',
    address,
    code: 'ABC234',
    publicURL: 'https://quiet-cloud.trycloudflare.com/?old=private#secret',
  });
  assert.equal(link, 'https://quiet-cloud.trycloudflare.com/?room=ABC234');
  assert.deepEqual(parseRoomInvite(link), {
    code: 'ABC234',
    address: 'wss://quiet-cloud.trycloudflare.com/match',
  });
  assert.equal(address, 'ws://127.0.0.1:8788/match');
  for (const publicURL of [
    'file:///C:/private.html',
    'https://user:password@friends.example',
    'javascript:alert(1)',
  ])
    assert.throws(() =>
      roomInviteUrl({ pageURL: 'http://localhost/', address, code: 'ABC234', publicURL }),
    );
});

test('a local development page shares the selected remote game server rather than an unreachable localhost frontend', () => {
  for (const pageURL of [
    'http://localhost:8787/',
    'http://127.0.0.1:8787/',
    'http://[::1]:8787/',
  ]) {
    const link = roomInviteUrl({ pageURL, address: 'wss://friends.example/match', code: 'ABC234' });
    assert.equal(link, 'https://friends.example/?room=ABC234');
    assert.deepEqual(parseRoomInvite(link), {
      code: 'ABC234',
      address: 'wss://friends.example/match',
    });
  }
});

test('invalid codes, ambiguous invites, credentials and unsafe server schemes are rejected before opening a socket', () => {
  for (const value of ['', 'ABC23', 'ABC2345', 'ABC012', 'ABCIO2', '<svg/>', '__proto__', null])
    assert.throws(() => roomCode(value));
  for (const suffix of [
    'room=',
    'room=ABC234&room=XYZ789',
    'room=ABC234&server=https://one.example&server=https://two.example',
    ...[
      'javascript:alert(1)',
      'file:///C:/private',
      'data:text/plain,hello',
      'ftp://friends.example',
      'https://user:secret@friends.example',
      'https://friends.example/\nsecret',
      'https://friends.example\\private',
      'ws://friends.example',
    ].map((server) => 'room=ABC234&server=' + encodeURIComponent(server)),
  ])
    assert.throws(() => parseRoomInvite('https://game.example/?' + suffix), suffix);
});

test('URL entry opens a prefilled join or create form once and never silently joins or changes readiness', () => {
  const calls = [],
    lobby = {
      open: (...args) => calls.push(['create', ...args]),
      openInvite: (...args) => calls.push(['join', ...args]),
    };
  const enter = (pageURL) =>
    openMultiplayerEntry({ pageURL, lobby, onError: (message) => calls.push(['error', message]) });
  assert.equal(enter('https://friends.example/'), null);
  assert.deepEqual(calls, []);
  enter('https://friends.example/?multiplayer=1');
  assert.deepEqual(calls.pop(), ['create', { address: 'wss://friends.example/match' }]);
  enter('https://friends.example/?multiplayer=1&room=abc234');
  assert.deepEqual(calls.pop(), [
    'join',
    { code: 'ABC234', address: 'wss://friends.example/match' },
    { autoJoin: false },
  ]);
  enter('https://friends.example/?room=INVALID');
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'error');
  assert.deepEqual(
    multiplayerEntry('https://game.example/?multiplayer=1&server=https%3A%2F%2Ffriends.example'),
    { kind: 'create', address: 'wss://friends.example/match' },
  );
});

test('a generated invitation joins the same real WebSocket room without readying or starting the match', async (t) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
  Object.defineProperty(globalThis, 'WebSocket', { configurable: true, value: WebSocket });
  const server = createRoomServer({ autoTick: false }),
    host = new NetworkSession({}),
    guest = new NetworkSession({});
  t.after(async () => {
    host.disconnect();
    guest.disconnect();
    await server.close();
    if (descriptor) Object.defineProperty(globalThis, 'WebSocket', descriptor);
    else delete globalThis.WebSocket;
  });
  await new Promise((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  const pageURL = `http://127.0.0.1:${server.http.address().port}/`;
  await host.connect(defaultServerAddress(pageURL), { type: 'create', name: 'Host' });
  const link = roomInviteUrl({ pageURL, address: host.address, code: host.room.code });
  const invite = parseRoomInvite(link);
  await guest.connect(invite.address, { type: 'join', code: invite.code, name: 'Guest' });
  assert.equal(guest.room.code, host.room.code);
  assert.equal(guest.room.phase, 'waiting');
  assert.equal(guest.room.players.length, 2);
  assert.ok(guest.room.players.every((player) => player.connected && !player.ready));
  assert.equal(server.rooms.size, 1);
  assert.equal(host.latest, undefined);
  assert.equal(guest.latest, undefined);
});
