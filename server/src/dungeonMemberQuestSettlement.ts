import { prepareDungeonRequestResult, type DungeonRequestQuestState } from './dungeonRequestResultPreparation.js';

export function prepareDungeonMemberQuestSettlement(input: {
  quests: DungeonRequestQuestState;
  now: number;
  activity: Record<string, unknown>;
  report: Record<string, unknown>;
  requestId: string;
  playerId: string;
  text: string;
}): {
  quests: DungeonRequestQuestState;
  history: unknown[];
  event: ReturnType<typeof prepareDungeonRequestResult>['event'];
} {
  const quests = { ...input.quests };
  const day = new Date(input.now).toISOString().slice(0, 10);

  if (quests.activityDay !== day) {
    quests.activityDay = day;
    quests.activityToday = { hunts: 0, wins: 0, losses: 0, gold: 0, xp: 0, dungeons: 0, crafts: 0 };
  }

  const stats = { ...((quests.activityToday || { hunts: 0, wins: 0, losses: 0, gold: 0, xp: 0, dungeons: 0, crafts: 0 }) as Record<string, number>) };
  stats.dungeons += 1;
  quests.activityToday = stats;

  const activityLog = Array.isArray(quests.activityLog) ? [...quests.activityLog] : [];
  activityLog.unshift({ at: input.now, ...input.activity });
  quests.activityLog = activityLog.slice(0, 30);

  const combatHistory = Array.isArray(quests.combatHistory) ? [...quests.combatHistory] : [];
  combatHistory.unshift(input.report);
  quests.combatHistory = combatHistory.slice(0, 20);

  const prepared = prepareDungeonRequestResult(
    quests,
    input.requestId,
    input.playerId,
    input.report,
    input.text,
  );

  return {
    quests: prepared.quests,
    history: prepared.quests.combatHistory as unknown[],
    event: prepared.event,
  };
}
