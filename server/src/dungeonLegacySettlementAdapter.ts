import {
  createPreparedDungeonEncounter,
  type PreparedDungeonDrop,
  type PreparedDungeonEncounter,
} from './dungeonEncounterPreparation.js';
import type { DungeonCombatMathResult } from './dungeonCombatMath.js';
import type { DungeonRequestResultEvent } from './dungeonRequestResultPreparation.js';

export type LegacyDungeonSettlementPlayer = {
  playerId: string;
  hpBefore: number;
  hpAfter: number;
  incomingDamage: number;
  outgoingDamage: number;
  xp: number;
  gold: number;
  lootIds: string[];
  report: Record<string, unknown>;
  resultText: string;
  playerSnapshot: Record<string, unknown>;
  outboxEvent: DungeonRequestResultEvent;
};

/**
 * Adapts the already-calculated synchronous legacy settlement into the
 * immutable durable encounter format. This function performs no combat,
 * reward, healing, RNG, persistence, or notification work.
 */
export function prepareLegacyDungeonSettlement(input: {
  runId: string;
  requestId: string;
  dungeonId: string;
  bossId: string;
  preparedAt: number;
  participantIds: string[];
  combat: DungeonCombatMathResult;
  drops: PreparedDungeonDrop[];
  players: LegacyDungeonSettlementPlayer[];
}): PreparedDungeonEncounter {
  if (!input.runId || !input.requestId || !Array.isArray(input.participantIds) ||
      !Array.isArray(input.players) || input.players.length !== input.participantIds.length ||
      input.players.some((player, index) => player.playerId !== input.participantIds[index])) {
    throw new Error('Legacy dungeon settlement participants must match the frozen ordered roster.');
  }

  const participants: PreparedDungeonEncounter['participants'] = {};
  const playerSnapshots: PreparedDungeonEncounter['playerSnapshots'] = {};
  const outboxEvents: DungeonRequestResultEvent[] = [];

  for (const player of input.players) {
    const { playerId, hpBefore, hpAfter, incomingDamage, outgoingDamage, xp, gold,
      lootIds, report, resultText, playerSnapshot, outboxEvent } = player;
    if (!playerId || !playerSnapshot || playerSnapshot.id !== playerId ||
        playerSnapshot.health !== hpAfter || !outboxEvent ||
        outboxEvent.playerId !== playerId ||
        outboxEvent.runId !== input.runId ||
        outboxEvent.eventId !== `dungeon:${input.runId}:${playerId}:combatResult` ||
        outboxEvent.messageType !== 'combatResult' ||
        outboxEvent.payload?.eventId !== outboxEvent.eventId ||
        outboxEvent.payload?.requestId !== input.requestId ||
        outboxEvent.payload?.text !== resultText ||
        JSON.stringify(outboxEvent.payload?.report) !== JSON.stringify(report)) {
      throw new Error(`Legacy dungeon settlement payload is inconsistent for participant ${playerId}.`);
    }

    let quests: unknown;
    try {
      quests = JSON.parse(String(playerSnapshot.quests || '{}'));
    } catch {
      throw new Error(`Legacy dungeon player snapshot has invalid quests for participant ${playerId}.`);
    }
    if (!quests || typeof quests !== 'object' || Array.isArray(quests)) {
      throw new Error(`Legacy dungeon player snapshot has invalid quests for participant ${playerId}.`);
    }
    const state = quests as Record<string, unknown>;
    const last = state.dungeonLastRequest as Record<string, unknown> | undefined;
    if (last?.id !== input.requestId ||
        JSON.stringify(last.report) !== JSON.stringify(report) ||
        last.text !== resultText) {
      throw new Error(`Legacy dungeon request history does not match participant ${playerId}.`);
    }

    participants[playerId] = {
      playerId,
      hpBefore,
      hpAfter,
      incomingDamage,
      outgoingDamage,
      xp,
      gold,
      lootIds: [...lootIds],
      report: { ...report },
      resultText,
    };
    playerSnapshots[playerId] = playerSnapshot;
    outboxEvents.push(outboxEvent);
  }

  return createPreparedDungeonEncounter({
    version: 1,
    runId: input.runId,
    requestId: input.requestId,
    dungeonId: input.dungeonId,
    bossId: input.bossId,
    preparedAt: input.preparedAt,
    participantIds: input.participantIds,
    combat: input.combat,
    drops: input.drops,
    participants,
    playerSnapshots,
    outboxEvents,
  });
}
