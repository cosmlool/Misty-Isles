export type DungeonRequestQuestState = Record<string, unknown>;

export type DungeonRequestResultEvent = {
  eventId: string;
  runId: string;
  playerId: string;
  messageType: 'combatResult';
  payload: {
    eventId: string;
    report: Record<string, unknown>;
    text: string;
    requestId: string;
  };
};

export function prepareDungeonRequestResult(
  quests: DungeonRequestQuestState,
  requestId: string,
  playerId: string,
  report: Record<string, unknown>,
  text: string,
): { quests: DungeonRequestQuestState; event: DungeonRequestResultEvent } {
  const eventId = `dungeon:legacy_${requestId}:${playerId}:combatResult`;
  const requestHistory = Array.isArray(quests.dungeonRequestHistory)
    ? quests.dungeonRequestHistory as Array<Record<string, unknown>>
    : [];
  const entry = { id: requestId, report, text };

  return {
    quests: {
      ...quests,
      dungeonRequestHistory: [
        ...requestHistory.filter((item) => item?.id !== requestId),
        entry,
      ].slice(-5),
      dungeonLastRequest: entry,
    },
    event: {
      eventId,
      runId: `legacy_${requestId}`,
      playerId,
      messageType: 'combatResult',
      payload: { eventId, report, text, requestId },
    },
  };
}
