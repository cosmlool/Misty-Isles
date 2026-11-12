/**
 * Coordinates the transition period between legacy auction/clan journals and
 * the shared-state WAL. All callbacks that build snapshots run only after
 * every older journal has been replayed.
 *
 * Keep this adapter until every runtime writer uses the shared WAL directly.
 * The server is single-process and these operations are synchronous.
 */
type Recoverable = { recover(): boolean };
type SharedStore = Recoverable & {
  transact<T>(prepareAfterRecovery: () => { files: Record<string, unknown>; result: T }): T;
};
type AuctionStore = Recoverable & { commit(snapshot: unknown): void };
type ClanStore = Recoverable & { commit(snapshot: unknown): void };

type Options = {
  shared: SharedStore;
  auction: AuctionStore;
  clans: ClanStore;
};

export function createSharedStateRuntime(options: Options) {
  function recoverLegacyJournals() {
    options.auction.recover();
    options.clans.recover();
  }

  function transact<T>(prepareAfterRecovery: () => { files: Record<string, unknown>; result: T }): T {
    recoverLegacyJournals();
    return options.shared.transact(prepareAfterRecovery);
  }

  function commitAuction<T>(prepareAfterRecovery: () => { snapshot: unknown; result: T }): T {
    recoverLegacyJournals();
    options.shared.recover();
    const prepared = prepareAfterRecovery();
    options.auction.commit(prepared.snapshot);
    return prepared.result;
  }

  function commitClan<T>(prepareAfterRecovery: () => { snapshot: unknown; result: T }): T {
    recoverLegacyJournals();
    options.shared.recover();
    const prepared = prepareAfterRecovery();
    options.clans.commit(prepared.snapshot);
    return prepared.result;
  }

  return { transact, commitAuction, commitClan, recoverLegacyJournals };
}
