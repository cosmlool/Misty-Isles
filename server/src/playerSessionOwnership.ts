export function isCurrentRoomSession<TPlayer extends object, TClient extends object>(
  current: { player: TPlayer | undefined; client: TClient | undefined; sessionHash: string | undefined },
  candidate: { player: TPlayer; client: TClient; sessionHash: string },
): boolean {
  return current.player === candidate.player
    && current.client === candidate.client
    && current.sessionHash === candidate.sessionHash;
}

export function canSaveRoomPlayerSnapshot<TPlayer extends object>(
  onlinePlayer: TPlayer | undefined,
  roomPlayer: TPlayer,
): boolean {
  // A room may persist only while it is still the registered owner. onLeave
  // already commits the final snapshot before removing that ownership; allowing
  // onDispose to save after removal can overwrite newer offline transactions.
  return onlinePlayer === roomPlayer;
}
