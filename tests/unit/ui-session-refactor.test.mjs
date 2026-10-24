import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SAVE,
  SETTINGS,
  loadCampaign,
  loadSettings,
  createCampaignStore,
} from '../../src/ui/session/campaign-store.js';
import {
  createCampaignActions,
  browserCampaignFiles,
} from '../../src/ui/session/campaign-actions.js';
import { createCommandExecutor } from '../../src/ui/session/command-executor.js';
import { createActionRouter } from '../../src/ui/controllers/action-router.js';
import { createAutoDefenseAction } from '../../src/ui/controllers/army-actions.js';

function memory(entries = []) {
  const values = new Map(entries),
    writes = [];
  return {
    values,
    writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      writes.push([key, value]);
      values.set(key, value);
    },
  };
}
const game = {
  load: JSON.parse,
  save: JSON.stringify,
  createGame: () => ({ time: 0, buildings: [] }),
};
const pending = () => {
  let resolve;
  const promise = new Promise((done) => (resolve = done));
  return { promise, resolve };
};

test('campaign migration preserves raw user saves, backup names and notice precedence', () => {
  const raw = JSON.stringify({ version: 3, time: 120, buildings: [{ id: 1 }] }),
    storage = memory([[SAVE, raw]]);
  const loaded = loadCampaign(storage, game);
  assert.equal(loaded.resumed, true);
  assert.match(loaded.loadNotice, /Дорожная система/);
  assert.equal(storage.values.get(SAVE), raw);
  for (const suffix of ['deployment10', 'districts9', 'infantry8', 'combat6', 'roads'])
    assert.equal(storage.values.get(`${SAVE}-before-${suffix}`), raw);
  storage.setItem(`${SAVE}-before-deployment10`, 'previous-original');
  loadCampaign(storage, game);
  assert.equal(storage.values.get(`${SAVE}-before-deployment10`), 'previous-original');
});

test('unreadable/blocked storage falls back without deleting or overwriting campaign data', () => {
  const storage = memory([[SAVE, 'broken json']]);
  assert.match(loadCampaign(storage, game).loadNotice, /Не удалось прочитать/);
  assert.equal(storage.values.get(SAVE), 'broken json');
  assert.deepEqual(storage.writes, []);
  const denied = {
    getItem() {
      throw Error('blocked');
    },
    setItem() {
      throw Error('blocked');
    },
  };
  assert.deepEqual(loadCampaign(denied, game).state, game.createGame());
  assert.deepEqual(loadSettings(denied), { sound: true, volume: 0.35, shake: 0.45 });
  const settings = loadSettings(
    memory([[SETTINGS, JSON.stringify({ sound: false, volume: 0.1, recruitMode: 'defend' })]]),
  );
  assert.equal(settings.sound, false);
  assert.equal(settings.recruitMode, 'defend');
});

test('replacement stores outgoing backup before new save and prevents all old autosave/unload writes', () => {
  const storage = memory(),
    calls = [];
  const store = createCampaignStore({
    storage,
    game,
    notify: (...args) => calls.push(args),
    reload: () => calls.push('reload'),
  });
  const current = { time: 12 },
    next = { time: 0 };
  store.persist(current, true);
  assert.equal(storage.writes.length, 0, 'network snapshot cannot overwrite solo save');
  store.replace(next, current, false, () => calls.push('stop'));
  assert.deepEqual(storage.writes, [
    [SAVE + '-backup', JSON.stringify(current)],
    [SAVE, JSON.stringify(next)],
  ]);
  assert.deepEqual(calls, ['stop', 'reload']);
  assert.equal(store.replacing, true);
  store.persist(current);
  store.replace(current, next, false, () => assert.fail('duplicate replace'));
  assert.equal(storage.writes.length, 2);
});

test('failed replacement preserves running campaign; settings retain audio application order', () => {
  const storage = memory([[SAVE, 'previous']]),
    calls = [];
  const set = storage.setItem;
  storage.setItem = (key, value) => {
    if (key === SAVE) throw Error('quota');
    set.call(storage, key, value);
  };
  const store = createCampaignStore({
    storage,
    game,
    notify: (...args) => calls.push(args),
    reload: () => assert.fail('reload'),
  });
  store.replace({ time: 0 }, { time: 12 }, false, () => assert.fail('stop'));
  assert.equal(store.replacing, false);
  assert.equal(storage.values.get(SAVE), 'previous');
  assert.equal(calls[0][1], true);
  const applied = [];
  store.saveSettings({ sound: false, volume: 0.2 }, { set: (...args) => applied.push(args) });
  assert.deepEqual(applied, [[false, 0.2]]);
  assert.equal(JSON.parse(storage.values.get(SETTINGS)).volume, 0.2);
});

test('session command boundary rejects late replies on campaign or WebSocket changes', async () => {
  let epoch = 0,
    state = { id: 'solo' },
    session = null;
  const local = [];
  const execute = createCommandExecutor({
    getState: () => state,
    getEpoch: () => epoch,
    getSession: () => session,
    executeLocal: (...args) => {
      local.push(args);
      return true;
    },
  });
  assert.equal(await execute('formation', { value: 'line' }), true);
  assert.deepEqual(local[0], [state, 0, 'formation', { value: 'line' }]);
  for (const changed of ['epoch', 'session']) {
    const reply = pending();
    session = { command: () => reply.promise };
    const result = execute('research', { key: 'radar' });
    if (changed === 'epoch') epoch++;
    else session = { command: () => true };
    reply.resolve(true);
    assert.match(await result, /завершённой сессии/);
  }
  assert.equal(
    local.length,
    1,
    'network commands never run local rules, including cooperative sessions',
  );
});

test('campaign actions route actual file effects and deny solo-only actions during network sessions', async () => {
  let network = false;
  const calls = [];
  const files = {
    download: (...args) => calls.push(['download', ...args]),
    choose: () => calls.push('choose'),
  };
  const actions = createCampaignActions({
    game,
    getState: () => ({ time: 12.9 }),
    isNetwork: () => network,
    getDifficulty: () => 'hard',
    persist: () => calls.push('persist'),
    replaceCampaign: (s) => calls.push(['replace', s]),
    toast: (...args) => calls.push(['toast', ...args]),
    files,
  });
  const router = createActionRouter(actions.actions),
    button = { dataset: { action: 'new-confirm' } };
  router.dispatch('export');
  assert.deepEqual(calls[0], ['download', '{"time":12.9}', 'skyfront-city-12.json']);
  router.dispatch('new-confirm', button);
  assert.equal(button.dataset.action, 'new');
  network = true;
  calls.length = 0;
  for (const action of ['new-confirm', 'new', 'import', 'export']) router.dispatch(action, button);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c[0] === 'toast'));
  router.dispatch('save');
  assert.equal(calls.at(-2), 'persist');
  assert.match(calls.at(-1)[1], /сервере/);
  const event = {
    target: {
      files: [{ size: 5000001, text: () => assert.fail('oversize read') }],
      value: 'selected',
    },
  };
  await actions.importFile(event);
  assert.equal(event.target.value, '');
  assert.match(calls.at(-1)[1], /большой/);
  assert.equal(router.dispatch('__proto__'), undefined);
  assert.throws(() => router.register('save', () => {}), /Повторное/);
});

test('download adapter revokes its own URL only after initiating the correct file download', () => {
  const calls = [],
    link = { click: () => calls.push('click') };
  let revoke;
  const files = browserCampaignFiles({
    document: {
      createElement: (tag) => {
        assert.equal(tag, 'a');
        return link;
      },
    },
    input: { click: () => calls.push('choose') },
    makeBlob: (raw) => ({ raw }),
    url: {
      createObjectURL: (blob) => {
        assert.equal(blob.raw, 'save');
        return 'blob:save';
      },
      revokeObjectURL: (url) => calls.push(url),
    },
    schedule: (callback, ms) => {
      assert.equal(ms, 2000);
      revoke = callback;
    },
  });
  files.download('save', 'campaign.json');
  assert.equal(link.href, 'blob:save');
  assert.equal(link.download, 'campaign.json');
  assert.deepEqual(calls, ['click']);
  revoke();
  assert.deepEqual(calls, ['click', 'blob:save']);
});

test('auto-defense snapshots selection and keeps async campaign/interaction guards', async () => {
  for (const change of ['none', 'revision', 'campaign']) {
    const reply = pending(),
      selection = [3, 4],
      calls = [];
    let epoch = 0,
      revision = 0;
    const action = createAutoDefenseAction({
      getSelection: () => selection,
      getEpoch: () => epoch,
      getRevision: () => revision,
      execute: (name, args) => {
        calls.push([name, args]);
        return reply.promise;
      },
      persist: () => calls.push('persist'),
      renderInspector: () => calls.push('render'),
      toast: () => calls.push('toast'),
    });
    const result = action({ dataset: { enabled: 'true' } });
    selection.push(99);
    if (change === 'revision') revision++;
    if (change === 'campaign') epoch++;
    reply.resolve(2);
    await result;
    assert.deepEqual(calls[0], ['auto-defense', { ids: [3, 4], enabled: true }]);
    assert.equal(calls.includes('persist'), change !== 'campaign');
    assert.equal(calls.includes('render'), change === 'none');
    assert.equal(calls.includes('toast'), false);
  }
});
