import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerUI, resolveJoinTarget } from '../../src/ui/multiplayer.js';

test('pasted invitation selects its own room and server, independently of the manual address', () => {
  const result = resolveJoinTarget(
    ' https://friends.example/?room=ABC234 ',
    'ws://127.0.0.1:8788/match',
    'file:///C:/game/Skyfront.html',
  );
  assert.deepEqual(result, { code: 'ABC234', address: 'wss://friends.example/match' });
});

test('manual room code preserves the selected server and normalizes the code', () => {
  assert.deepEqual(
    resolveJoinTarget(' abc234 ', 'https://friends.example/', 'https://client.example/game'),
    {
      code: 'ABC234',
      address: 'wss://friends.example/match',
    },
  );
});

test('join entry refuses empty, incomplete or credential-bearing invitations before connecting', () => {
  const page = 'https://game.example/';
  assert.throws(() => resolveJoinTarget('', page, page), /приглашение/);
  assert.throws(() => resolveJoinTarget('https://game.example/', page, page), /нет кода/);
  assert.throws(() => resolveJoinTarget('ABC', page, page), /6/);
  assert.throws(() =>
    resolveJoinTarget('https://user:secret@game.example/?room=ABC234', page, page),
  );
});

test('copy invitation refreshes metadata before selecting a rerendered link', async () => {
  const ui = Object.create(MultiplayerUI.prototype);
  const oldInput = { value: 'https://old.example/', isConnected: false };
  const freshInput = {
    value: 'https://fresh.example/?room=ABC234',
    isConnected: true,
    focus() {},
    select() {
      this.selected = true;
    },
  };
  let input = oldInput;
  ui.session = {};
  ui.host = { querySelector: () => input };
  ui.resolvePublicInvite = async () => {
    input = freshInput;
  };
  ui.status = () => {};
  // Node has no clipboard: the supported manual-copy fallback exposes which input was used.
  await ui.copyInvite();
  assert.equal(freshInput.selected, true);
});

test('copy invitation stops if the session changes while metadata is pending', async () => {
  const ui = Object.create(MultiplayerUI.prototype);
  ui.session = {};
  let resolve;
  ui.resolvePublicInvite = () =>
    new Promise((done) => {
      resolve = done;
    });
  ui.host = {
    querySelector() {
      assert.fail('stale invitation accessed');
    },
  };
  const pending = ui.copyInvite();
  ui.session = {};
  resolve();
  await pending;
});
