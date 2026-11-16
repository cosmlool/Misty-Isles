export type DungeonRequestBinding = {
  dungeonId: string;
  groupId: string;
  leaderId: string;
  participantIds: string[];
};
export type LegacyDungeonRequestEntry = { id: string; report?: Record<string, unknown>; text?: string; binding?: DungeonRequestBinding };
export type LegacyDungeonReplayParticipant = { playerId: string; entries: LegacyDungeonRequestEntry[] };
export type LegacyDungeonReplayResolution =
  | { kind: 'not-found' }
  | { kind: 'replay'; entries: Array<{ playerId: string; entry: LegacyDungeonRequestEntry }> }
  | { kind: 'conflict'; reason: 'partial' | 'identity' | 'invalid' };

/** Replay only when every frozen participant has a matching, fully bound result. */
export function resolveLegacyDungeonRequestReplay(input: {
  requestId: string; binding: DungeonRequestBinding; participants: LegacyDungeonReplayParticipant[];
}): LegacyDungeonReplayResolution {
  const { requestId, binding, participants } = input;
  if (!requestId || !binding.dungeonId || !binding.leaderId ||
      typeof binding.groupId !== 'string' || !Array.isArray(binding.participantIds) ||
      binding.participantIds.length < 1 || binding.participantIds.length > 3 ||
      new Set(binding.participantIds).size !== binding.participantIds.length ||
      !binding.participantIds.includes(binding.leaderId) ||
      binding.participantIds.some(id => typeof id !== 'string' || !id) ||
      participants.length !== binding.participantIds.length ||
      participants.some((participant, index) => participant.playerId !== binding.participantIds[index])) {
    return { kind: 'conflict', reason: 'invalid' };
  }
  const matched = participants.map(participant => ({
    playerId: participant.playerId, entry: participant.entries.find(entry => entry?.id === requestId),
  }));
  const found = matched.filter(item => item.entry);
  if (found.length === 0) return { kind: 'not-found' };
  if (found.length !== participants.length) return { kind: 'conflict', reason: 'partial' };
  const sameBinding = (value: unknown): value is DungeonRequestBinding => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const saved = value as DungeonRequestBinding;
    return saved.dungeonId === binding.dungeonId && saved.groupId === binding.groupId &&
      saved.leaderId === binding.leaderId && Array.isArray(saved.participantIds) &&
      saved.participantIds.length === binding.participantIds.length &&
      saved.participantIds.every((id, index) => id === binding.participantIds[index]);
  };
  if (matched.some(({ entry }) => !entry || !sameBinding(entry.binding) ||
      !entry.report || typeof entry.report !== 'object' || typeof entry.text !== 'string')) {
    return { kind: 'conflict', reason: 'identity' };
  }
  return { kind: 'replay', entries: matched.map(item => ({ playerId: item.playerId, entry: item.entry! })) };
}
