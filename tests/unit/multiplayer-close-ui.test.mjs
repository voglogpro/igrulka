import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerUI } from '../../src/ui/multiplayer.js';

test('peer closure after a resumed game restores solo exactly once and ignores stale callbacks', async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', {
    configurable: true,
    value: { href: 'https://game.example/' },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete globalThis.location;
  });
  const ui = Object.create(MultiplayerUI.prototype);
  const sessions = [];
  let left = 0;
  Object.assign(ui, {
    host: { hidden: false, querySelectorAll: () => [] },
    draft: { address: 'https://game.example', name: 'Commander', code: 'ABC234' },
    rememberDraft() {},
    renderRoom() {},
    resolvePublicInvite() {},
    status() {},
    onLeave: () => left++,
    createSession(handlers) {
      const session = {
        handlers,
        async connect() {
          this.token = 'private-test-token';
          this.room = { phase: 'playing' };
        },
        disconnect() {},
      };
      sessions.push(session);
      return session;
    },
  });
  await ui.connect('join');
  const old = sessions[0];
  await ui.connect('join');
  const resumed = sessions[1];
  resumed.handlers.onState({}, resumed.room);
  old.handlers.onClosed('Old socket closed');
  assert.equal(ui.session, resumed);
  assert.equal(left, 0);
  // NetworkSession.clearCredentials removes persisted credentials, retaining this field.
  resumed.handlers.onClosed('Peer left the room');
  assert.equal(ui.session, null);
  assert.equal(ui.host.hidden, true);
  assert.equal(left, 1);
  resumed.handlers.onClosed('Duplicate close');
  assert.equal(left, 1);
});
