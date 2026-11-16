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
  return onlinePlayer === undefined || onlinePlayer === roomPlayer;
}
