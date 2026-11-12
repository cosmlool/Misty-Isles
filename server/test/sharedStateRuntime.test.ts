import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';
import type { SharedStateSnapshot } from '../src/sharedStateTransactions.js';

function fixture() {
  const events: string[] = [];
  let sharedPending = false;
  let auctionPending = false;
  let clansPending = false;
  const shared = {
    recover() {
      events.push('shared.recover');
      const recovered = sharedPending;
      if (recovered) { events.push('shared.replay'); sharedPending = false; }
      return recovered;
    },
    transact<T>(prepare: () => { files: SharedStateSnapshot; result: T; skipWrite?: boolean }): T {
      events.push('shared.transact');
      this.recover();
      const prepared = prepare();
      if (prepared.skipWrite) { events.push('shared.skip'); return prepared.result; }
      events.push('shared.commit');
      return prepared.result;
    },
  };
  const auction = {
    recover() { events.push('auction.recover'); const recovered = auctionPending; auctionPending = false; return recovered; },
    commit(snapshot: unknown) { events.push('auction.commit:' + JSON.stringify(snapshot)); },
  };
  const clans = {
    recover() { events.push('clans.recover'); const recovered = clansPending; clansPending = false; return recovered; },
    commit(snapshot: unknown) { events.push('clans.commit:' + JSON.stringify(snapshot)); },
  };
  return {
    events, shared, auction, clans,
    setPending(values: { shared?: boolean; auction?: boolean; clans?: boolean }) {
      sharedPending = Boolean(values.shared); auctionPending = Boolean(values.auction); clansPending = Boolean(values.clans);
    },
    runtime: createSharedStateRuntime({ shared, auction, clans }),
  };
}

test('shared transaction recovers legacy and shared journals before preparing its snapshot', () => {
  const f = fixture();
  f.setPending({ auction: true, shared: true });
  let recoveredDuringPrepare = false;
  const result = f.runtime.transact(recovered => {
    recoveredDuringPrepare = recovered;
    f.events.push('prepare');
    return { files: { players: { p1: { gold: 90 } } }, result: 'ok' };
  });
  assert.equal(result, 'ok');
  assert.equal(recoveredDuringPrepare, true);
  assert.deepEqual(f.events, [
    'auction.recover', 'clans.recover', 'shared.recover', 'shared.replay',
    'shared.transact', 'shared.recover', 'prepare', 'shared.commit',
  ]);
});

test('ordinary shared transaction reports no recovery so live in-memory changes are preserved', () => {
  const f = fixture();
  let recoveredDuringPrepare = true;
  f.runtime.transact(recovered => {
    recoveredDuringPrepare = recovered;
    return { files: { players: { p1: { gold: 90 } } }, result: undefined };
  });
  assert.equal(recoveredDuringPrepare, false);
});

test('auction commits prepare and persist all auction files through the shared WAL', () => {
  const f = fixture();
  const result = f.runtime.commitAuction(() => {
    f.events.push('prepare');
    return { snapshot: { players: { p1: { gold: 80 } }, auction: [], history: [] }, result: 7 };
  });
  assert.equal(result, 7);
  assert.deepEqual(f.events, [
    'auction.recover', 'clans.recover', 'shared.recover',
    'shared.transact', 'shared.recover', 'prepare', 'shared.commit',
  ]);
});

test('clan commits prepare and persist all clan files through the shared WAL', () => {
  const f = fixture();
  const result = f.runtime.commitClan(() => {
    f.events.push('prepare');
    return { snapshot: { players: {}, clans: {}, wars: [], territories: [] }, result: 'saved' };
  });
  assert.equal(result, 'saved');
  assert.deepEqual(f.events, [
    'auction.recover', 'clans.recover', 'shared.recover',
    'shared.transact', 'shared.recover', 'prepare', 'shared.commit',
  ]);
});

test('clan no-op commits still recover journals but skip shared WAL writes', () => {
  const f = fixture();
  f.setPending({ clans: true });
  const result = f.runtime.commitClan(() => ({
    snapshot: { players: {}, clans: {}, wars: [], territories: [] },
    result: 'unchanged',
    skipWrite: true,
  }));
  assert.equal(result, 'unchanged');
  assert.deepEqual(f.events, [
    'auction.recover', 'clans.recover', 'shared.recover',
    'shared.transact', 'shared.recover', 'shared.skip',
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
