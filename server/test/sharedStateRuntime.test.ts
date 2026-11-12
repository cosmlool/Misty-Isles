import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';

function fixture() {
  const events: string[] = [];
  let sharedPending = false;
  const shared = {
    recover() { events.push('shared.recover'); if (sharedPending) { events.push('shared.replay'); sharedPending = false; } return true; },
    transact<T>(prepare: () => { files: Record<string, unknown>; result: T }): T {
      events.push('shared.transact');
      this.recover();
      const prepared = prepare();
      events.push('shared.commit');
      return prepared.result;
    },
  };
  const auction = {
    recover() { events.push('auction.recover'); return true; },
    commit(snapshot: unknown) { events.push('auction.commit:' + JSON.stringify(snapshot)); },
  };
  const clans = {
    recover() { events.push('clans.recover'); return true; },
    commit(snapshot: unknown) { events.push('clans.commit:' + JSON.stringify(snapshot)); },
  };
  return { events, shared, auction, clans, runtime: createSharedStateRuntime({ shared, auction, clans }) };
}

test('shared transactions recover both legacy journals before preparing a fresh snapshot', () => {
  const f = fixture();
  const result = f.runtime.transact(() => {
    f.events.push('prepare');
    return { files: { players: { p1: { gold: 90 } } }, result: 'ok' };
  });
  assert.equal(result, 'ok');
  assert.deepEqual(f.events, [
    'auction.recover', 'clans.recover', 'shared.transact',
    'shared.recover', 'prepare', 'shared.commit',
  ]);
});

test('legacy auction writes recover every journal before building their snapshot', () => {
  const f = fixture();
  const result = f.runtime.commitAuction(() => {
    f.events.push('prepare');
    return { snapshot: { players: { p1: { gold: 80 } }, auction: [] }, result: 7 };
  });
  assert.equal(result, 7);
  assert.deepEqual(f.events, [
    'auction.recover', 'clans.recover', 'shared.recover', 'prepare',
    'auction.commit:{"players":{"p1":{"gold":80}},"auction":[]}',
  ]);
});

test('legacy clan writes recover every journal before building their snapshot', () => {
  const f = fixture();
  const result = f.runtime.commitClan(() => {
    f.events.push('prepare');
    return { snapshot: { players: {}, clans: {}, wars: [], territories: [] }, result: 'saved' };
  });
  assert.equal(result, 'saved');
  assert.deepEqual(f.events, [
    'auction.recover', 'clans.recover', 'shared.recover', 'prepare',
    'clans.commit:{"players":{},"clans":{},"wars":[],"territories":[]}',
  ]);
});

test('a failed recovery blocks snapshot preparation and every subsequent write', () => {
  const f = fixture();
  f.clans.recover = () => { f.events.push('clans.recover'); throw new Error('legacy journal is corrupt'); };
  assert.throws(() => f.runtime.transact(() => {
    f.events.push('prepare');
    return { files: { players: {} }, result: undefined };
  }), /legacy journal is corrupt/);
  assert.deepEqual(f.events, ['auction.recover', 'clans.recover']);
});
