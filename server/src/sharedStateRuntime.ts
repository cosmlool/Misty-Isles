/**
 * Coordinates the transition period between legacy auction/clan journals and
 * the shared-state WAL. All callbacks that build snapshots run only after
 * every older journal has been replayed.
 *
 * Keep this adapter until every runtime writer uses the shared WAL directly.
 * The server is single-process and these operations are synchronous.
 */
import type { SharedStateSnapshot } from './sharedStateTransactions.js';

type Recoverable = { recover(): boolean };
type SharedStore = Recoverable & {
  transact<T>(prepareAfterRecovery: () => { files: SharedStateSnapshot; result: T }): T;
};
type AuctionStore = Recoverable;
type ClanStore = Recoverable;

type Options = {
  shared: SharedStore;
  auction: AuctionStore;
  clans: ClanStore;
};

export function createSharedStateRuntime(options: Options) {
  function recoverPendingState(): boolean {
    const auctionRecovered = options.auction.recover();
    const clansRecovered = options.clans.recover();
    const sharedRecovered = options.shared.recover();
    return auctionRecovered || clansRecovered || sharedRecovered;
  }

  function transact<T>(prepareAfterRecovery: (recovered: boolean) => { files: SharedStateSnapshot; result: T }): T {
    const recovered = recoverPendingState();
    return options.shared.transact(() => prepareAfterRecovery(recovered));
  }

  function commitAuction<T>(prepareAfterRecovery: (recovered: boolean) => { snapshot: unknown; result: T }): T {
    const recovered = recoverPendingState();
    return options.shared.transact(() => {
      const prepared = prepareAfterRecovery(recovered);
      const snapshot = prepared.snapshot as { players: unknown; auction: unknown[]; history: unknown[] };
      return {
        files: { players: snapshot.players, auction: snapshot.auction, auctionHistory: snapshot.history },
        result: prepared.result
      };
    });
  }

  function commitClan<T>(prepareAfterRecovery: (recovered: boolean) => { snapshot: unknown; result: T; skipWrite?: boolean }): T {
    const recovered = recoverPendingState();
    return options.shared.transact(() => {
      const prepared = prepareAfterRecovery(recovered);
      if (prepared.skipWrite) return { files: {}, result: prepared.result, skipWrite: true };
      const snapshot = prepared.snapshot as { players: unknown; clans: unknown; wars: unknown[]; territories: unknown[] };
      return {
        files: { players: snapshot.players, clans: snapshot.clans, wars: snapshot.wars, territories: snapshot.territories },
        result: prepared.result
      };
    });
  }

  return { transact, commitAuction, commitClan, recoverPendingState };
}
