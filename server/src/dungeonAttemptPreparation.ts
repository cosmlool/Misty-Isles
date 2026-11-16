export type DungeonAttemptQuestState = Record<string, unknown>;

export function getDungeonRunsForDay(quests: DungeonAttemptQuestState, day: string): number {
  return quests.dungeonDay === day ? Number(quests.dungeonRuns || 0) : 0;
}

export function consumeDungeonAttemptForDay(
  quests: DungeonAttemptQuestState,
  day: string,
): DungeonAttemptQuestState {
  return {
    ...quests,
    dungeonDay: day,
    dungeonRuns: getDungeonRunsForDay(quests, day) + 1,
  };
}
