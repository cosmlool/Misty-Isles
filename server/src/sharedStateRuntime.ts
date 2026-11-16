/**
 * Routes production player, auction and clan mutations through the shared-state
 * WAL while recovering legacy auction/clan journals before snapshot preparation.
 * All callbacks that build snapshots run only after pending recovery is resolved.
 *
 * Recovery reports separately whether player snapshots were replayed. Auth-only
 * journals must not cause live Player objects to be refreshed from older disk saves.
 * Legacy stores remain recovery-only; the server is single-process and synchronous.
 */
import type { SharedStateSnapshot } from './sharedStateTransactions.js';

type Recoverable = { recover(): boolean; hasPending?(): boolean };
type SharedStore = Recoverable & {
  hasPendingPlayers?(): boolean;
  transact<T>(prepareAfterRecovery: () => { files: SharedStateSnapshot; result: T; skipWrite?: boolean }): T;
};
type AuctionStore = Recoverable;
type ClanStore = Recoverable;

type Options = {
  shared: SharedStore;
  auction: AuctionStore;
  clans: ClanStore;
};

export function createSharedStateRuntime(options: Options) {
  function recoverPendingStateDetails(): { recovered: boolean; playersRecovered: boolean } {
    // Legacy auction and clan journals both contain a complete players.json snapshot.
    // If both survived, their relative commit order is unknowable; replaying either
    // first could silently overwrite newer player data from the other transaction.
    const auctionPending = options.auction.hasPending?.() ?? false;
    const clansPending = options.clans.hasPending?.() ?? false;
    if (auctionPending && clansPending) {
      throw new Error('Legacy auction and clan transaction journals are both pending; recovery order is ambiguous. Refusing to replay either journal or write state.');
    }
    // Inspect the shared journal before replay so callers can distinguish auth-only
    // recovery from a transaction that replaced the player snapshot.
    const sharedPlayersPending = options.shared.hasPendingPlayers?.();
    const auctionRecovered = options.auction.recover();
    const clansRecovered = options.clans.recover();
    const sharedRecovered = options.shared.recover();
    const recovered = auctionRecovered || clansRecovered || sharedRecovered;
    const playersRecovered = auctionRecovered || clansRecovered
      || (sharedRecovered && (sharedPlayersPending ?? true));
    return { recovered, playersRecovered };
  }

  function recoverPendingState(): boolean {
    return recoverPendingStateDetails().recovered;
  }

  function recoverPendingPlayerState(): boolean {
    return recoverPendingStateDetails().playersRecovered;
  }

  function transactWithRecovery<T>(prepareAfterRecovery: (recovery: { recovered: boolean; playersRecovered: boolean }) => { files: SharedStateSnapshot; result: T; skipWrite?: boolean }): T {
    const recovery = recoverPendingStateDetails();
    return options.shared.transact(() => prepareAfterRecovery(recovery));
  }

  // Existing player-mutation callers need only know whether players.json was
  // replayed; dungeon lifecycle callers must also see journals that only
  // touched dungeonRuns or dungeonOutbox.
  function transact<T>(prepareAfterRecovery: (playersRecovered: boolean) => { files: SharedStateSnapshot; result: T; skipWrite?: boolean }): T {
    return transactWithRecovery(recovery => prepareAfterRecovery(recovery.playersRecovered));
  }

  function commitAuction<T>(prepareAfterRecovery: (playersRecovered: boolean) => { snapshot: unknown; result: T }): T {
    const { playersRecovered } = recoverPendingStateDetails();
    return options.shared.transact(() => {
      const prepared = prepareAfterRecovery(playersRecovered);
      const snapshot = prepared.snapshot as { players: unknown; auction: unknown[]; history: unknown[] };
      return {
        files: { players: snapshot.players, auction: snapshot.auction, auctionHistory: snapshot.history },
        result: prepared.result
      };
    });
  }

  function commitClan<T>(prepareAfterRecovery: (playersRecovered: boolean) => { snapshot: unknown; result: T; skipWrite?: boolean }): T {
    const { playersRecovered } = recoverPendingStateDetails();
    return options.shared.transact(() => {
      const prepared = prepareAfterRecovery(playersRecovered);
      if (prepared.skipWrite) return { files: {}, result: prepared.result, skipWrite: true };
      const snapshot = prepared.snapshot as { players: unknown; clans: unknown; wars: unknown[]; territories: unknown[] };
      return {
        files: { players: snapshot.players, clans: snapshot.clans, wars: snapshot.wars, territories: snapshot.territories },
        result: prepared.result
      };
    });
  }

  return { transact, transactWithRecovery, commitAuction, commitClan, recoverPendingState, recoverPendingPlayerState };
}
