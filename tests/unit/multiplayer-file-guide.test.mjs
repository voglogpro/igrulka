import test from 'node:test';
import assert from 'node:assert/strict';
import { MultiplayerUI } from '../../src/ui/multiplayer.js';

function fixture(t, href = 'file:///C:/game/play/Skyfront.html') {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'location');
  Object.defineProperty(globalThis, 'location', { configurable: true, value: { href } });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'location', original);
    else delete globalThis.location;
  });
  const ui = Object.create(MultiplayerUI.prototype);
  ui.host = {
    dataset: {},
    innerHTML: '',
    querySelector: () => ({ focus() {} }),
    querySelectorAll: () => [],
  };
  ui.pauseLocal = () => {};
  return ui;
}

test('file entry puts exact server-launch guidance before the form and outside collapsed connection details', (t) => {
  const ui = fixture(t);
  ui.open();
  const html = ui.host.innerHTML;
  assert.match(html, /id="net-file-guide"/);
  assert.match(html, /Небесный рубеж — по сети/);
  assert.match(html, /Играть через интернет\.cmd/);
  assert.match(html, /Оставьте окно сервера включённым/);
  assert.match(html, /Другу нужна только ссылка/);
  assert.ok(html.indexOf('id="net-file-guide"') < html.indexOf('<details'));
  assert.ok(html.indexOf('id="net-file-guide"') < html.indexOf('net-create-block'));
  assert.doesNotMatch(html.match(/<section id="net-file-guide".*?<\/section>/s)[0], /hidden/);
  assert.match(html, /data-net="create"/);
});

test('file entry still connects to an explicit server and a pasted friend invitation', async (t) => {
  const ui = fixture(t),
    connected = [];
  ui.renderRoom = () => {};
  ui.resolvePublicInvite = () => {};
  ui.status = () => {};
  ui.createSession = () => ({
    disconnect() {},
    async connect(address, request) {
      connected.push({ address, request });
      this.token = 'seat';
      this.room = { code: 'ABC234' };
    },
  });
  ui.open({ address: 'https://working.example' });
  ui.rememberDraft = () => {
    ui.draft = { name: 'Commander', address: ui.address, code: '' };
  };
  await ui.connect('create');
  assert.equal(connected[0].address, 'wss://working.example/match');
  assert.equal(connected[0].request.type, 'create');
  ui.rememberDraft = () => {
    ui.draft = {
      name: 'Friend',
      address: 'http://127.0.0.1:8788',
      code: 'https://friends.example/?room=ABC234',
    };
  };
  await ui.connect('join');
  assert.equal(connected[1].address, 'wss://friends.example/match');
  assert.equal(connected[1].request.code, 'ABC234');
});

test('hosted entry does not tell a friend opening HTTPS to launch another local server', (t) => {
  const ui = fixture(t, 'https://friends.example/?room=ABC234');
  ui.open({ invite: { code: 'ABC234', address: 'wss://friends.example/match' } });
  assert.doesNotMatch(ui.host.innerHTML, /id="net-file-guide"/);
  assert.match(ui.host.innerHTML, /data-net="join"/);
});

test('saved seat recovery uses the refreshed invitation endpoint only for the same room', async (t) => {
  const ui = fixture(t, 'https://voglogpro.github.io/igrulka/'),
    old = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', {
    configurable: true,
    value: {
      getItem: () =>
        JSON.stringify({
          code: 'ABC234',
          token: 'private-seat',
          address: 'wss://old.example/match',
        }),
    },
  });
  t.after(() => {
    if (old) Object.defineProperty(globalThis, 'sessionStorage', old);
    else delete globalThis.sessionStorage;
  });
  const attempts = [];
  ui.status = () => {};
  ui.renderRoom = () => {};
  ui.resolvePublicInvite = () => {};
  ui.createSession = () => ({
    disconnect() {},
    async connect(address, request) {
      attempts.push({ address, request });
    },
  });
  ui.rememberDraft = () => {
    ui.draft = { name: 'Friend', address: 'wss://new.example/match', code: 'ABC234' };
  };
  ui.invite = { code: 'ABC234', address: 'wss://new.example/match' };
  await ui.connect('resume');
  assert.equal(attempts[0].address, 'wss://new.example/match');
  assert.equal(attempts[0].request.token, 'private-seat');
  ui.invite = { code: 'XYZ789', address: 'wss://unrelated.example/match' };
  await ui.connect('resume');
  assert.equal(attempts[1].address, 'wss://old.example/match');
});

test('a visible room refreshes a recovered invitation without recreating the room or exposing a local link', async (t) => {
  const ui = fixture(t),
    session = { address: 'ws://127.0.0.1:1234/match' };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const answers = [
    { publicUrl: null, status: 'recovering', clientUrl: 'https://voglogpro.github.io/igrulka/' },
    {
      publicUrl: 'https://new.example',
      status: 'ready',
      clientUrl: 'https://voglogpro.github.io/igrulka/',
    },
  ];
  let reads = 0;
  ui.session = session;
  ui.host.hidden = false;
  ui.renderRoom = () => {};
  ui.serverInfo = async () => {
    reads++;
    return answers.shift();
  };
  await ui.resolvePublicInvite(session);
  assert.equal(ui.publicStatus, 'recovering');
  assert.equal(ui.publicURL, null);
  t.mock.timers.tick(2000);
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(ui.publicURL, 'https://new.example');
  assert.equal(ui.publicStatus, 'ready');
  ui.host.hidden = true;
  t.mock.timers.tick(5000);
  await Promise.resolve();
  assert.equal(reads, 2);
});
