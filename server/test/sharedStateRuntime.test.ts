import assert from 'node:assert/strict';
import test from 'node:test';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';
import type { SharedStateSnapshot } from '../src/sharedStateTransactions.js';

function fixture() {
  const events: string[] = [];
  let sharedPending = false;
  let sharedPlayersPending = false;
  let auctionPending = false;
  let clansPending = false;
  const shared = {
    hasPendingPlayers() { return sharedPending && sharedPlayersPending; },
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
    hasPending() { return auctionPending; },
    recover() { events.push('auction.recover'); const recovered = auctionPending; auctionPending = false; return recovered; },
    commit(snapshot: unknown) { events.push('auction.commit:' + JSON.stringify(snapshot)); },
  };
  const clans = {
    hasPending() { return clansPending; },
    recover() { events.push('clans.recover'); const recovered = clansPending; clansPending = false; return recovered; },
    commit(snapshot: unknown) { events.push('clans.commit:' + JSON.stringify(snapshot)); },
  };
  return {
    events, shared, auction, clans,
    setPending(values: { shared?: boolean; sharedPlayers?: boolean; auction?: boolean; clans?: boolean }) {
      sharedPending = Boolean(values.shared);
      sharedPlayersPending = values.sharedPlayers ?? Boolean(values.shared); auctionPending = Boolean(values.auction); clansPending = Boolean(values.clans);
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


test('simultaneous legacy auction and clan journals fail closed before either replay', () => {
  const f = fixture();
  f.setPending({ auction: true, clans: true, shared: true });
  assert.throws(
    () => f.runtime.transact(() => {
      f.events.push('prepare');
      return { files: { players: { p1: { gold: 999 } } }, result: undefined };
    }),
    /both pending; recovery order is ambiguous/
  );
  assert.deepEqual(f.events, []);
});

test('recovery-aware transactions distinguish outbox-only replay from player snapshot replay', () => {
  const f = fixture();
  f.setPending({ shared: true, sharedPlayers: false });
  let observed: { recovered: boolean; playersRecovered: boolean } | undefined;
  f.runtime.transactWithRecovery(recovery => {
    observed = recovery;
    return { files: { dungeonOutbox: {} }, result: 'recovered' };
  });
  assert.deepEqual(observed, { recovered: true, playersRecovered: false });
});

test('legacy transact keeps its player-snapshot-only callback contract', () => {
  const f = fixture();
  f.setPending({ shared: true, sharedPlayers: false });
  let playersRecovered: boolean | undefined;
  f.runtime.transact(recovered => {
    playersRecovered = recovered;
    return { files: { sessions: [] }, result: undefined };
  });
  assert.equal(playersRecovered, false);
});
