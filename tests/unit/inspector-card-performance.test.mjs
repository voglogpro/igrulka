import test from 'node:test';
import assert from 'node:assert/strict';
import { rememberInspectorCard, restoreInspectorCard } from '../../src/ui/inspector-card.js';

test('closed inspector polling never reads or writes layout-dependent scroll state; visible details still restore their position', () => {
  const state = { seed: 811, time: 10, sides: [{}, {}] };
  let reads = 0,
    writes = 0;
  const details = () => {
    const node = { open: false };
    let position = 0;
    const body = {
      get scrollTop() {
        assert.equal(node.open, true, 'hidden body must not force layout');
        reads++;
        return position;
      },
      set scrollTop(value) {
        assert.equal(node.open, true, 'hidden body must not force layout');
        writes++;
        position = value;
      },
    };
    node.querySelector = () => body;
    return node;
  };
  const host = { details: details(), querySelector: () => host.details };
  restoreInspectorCard(host, state, 'first');
  for (let i = 0; i < 100; i++) rememberInspectorCard(host);
  assert.equal(reads, 0);
  assert.equal(writes, 0);

  host.details.open = true;
  host.details.querySelector().scrollTop = 137;
  rememberInspectorCard(host);
  assert.equal(reads, 1);
  host.details = details();
  restoreInspectorCard(host, state, 'second');
  assert.equal(writes, 1, 'switching to a closed card needs no scroll write');
  host.details = details();
  restoreInspectorCard(host, state, 'first');
  assert.equal(host.details.open, true);
  assert.equal(host.details.querySelector().scrollTop, 137);
  assert.equal(writes, 2);

  host.details.open = false;
  rememberInspectorCard(host);
  const visibleReads = reads;
  for (let i = 0; i < 100; i++) rememberInspectorCard(host);
  assert.equal(reads, visibleReads);
  host.details = details();
  restoreInspectorCard(host, { ...state, seed: 812 }, 'first');
  assert.equal(host.details.open, false, 'a replacement campaign does not inherit old card state');
  assert.equal(writes, 2);
});
