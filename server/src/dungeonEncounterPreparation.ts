import type { DungeonCombatMathResult } from './dungeonCombatMath.js';

export type PreparedDungeonParticipantResult = {
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
};

export type PreparedDungeonDrop = {
  itemId: string;
  recipientId: string;
};

export type PreparedDungeonEncounter = {
  version: 1;
  runId: string;
  requestId: string;
  dungeonId: string;
  bossId: string;
  preparedAt: number;
  participantIds: string[];
  combat: DungeonCombatMathResult;
  drops: PreparedDungeonDrop[];
  participants: Record<string, PreparedDungeonParticipantResult>;
  playerSnapshots: Record<string, Record<string, unknown>>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Validates and detaches a fully prepared legacy encounter settlement from
 * mutable live Player objects. Random drop rolls and recipients must already
 * have been selected by the caller; this function never rolls or rerolls.
 *
 * The returned value is immutable in memory and JSON-serializable for a
 * durable run snapshot. It is a preparation boundary, not a persistence
 * transaction: callers still have to commit it with the run/player WAL.
 */
export function createPreparedDungeonEncounter(input: PreparedDungeonEncounter): PreparedDungeonEncounter {
  if (!input || input.version !== 1 ||
      !input.runId || !input.requestId || !input.dungeonId || !input.bossId ||
      !Number.isFinite(input.preparedAt) ||
      !Array.isArray(input.participantIds) || input.participantIds.length < 1 ||
      input.participantIds.length > 3 ||
      new Set(input.participantIds).size !== input.participantIds.length ||
      input.participantIds.some(id => typeof id !== 'string' || !id) ||
      !isRecord(input.combat) ||
      !Number.isInteger(input.combat.rounds) || Number(input.combat.rounds) < 1 ||
      typeof input.combat.win !== 'boolean' ||
      !Array.isArray(input.combat.incoming) ||
      !Array.isArray(input.combat.damageByParticipant) ||
      input.combat.incoming.length !== input.participantIds.length ||
      input.combat.damageByParticipant.length !== input.participantIds.length ||
      input.combat.incoming.some(value => !Number.isFinite(value) || value < 0) ||
      input.combat.damageByParticipant.some(value => !Number.isFinite(value) || value < 0) ||
      !Array.isArray(input.drops) ||
      !isRecord(input.participants) || !isRecord(input.playerSnapshots)) {
    throw new Error('Invalid prepared dungeon encounter header or combat result.');
  }

  const ids = input.participantIds;
  if (Object.keys(input.participants).length !== ids.length ||
      Object.keys(input.playerSnapshots).length !== ids.length ||
      ids.some(id => !isRecord(input.participants[id]) || !isRecord(input.playerSnapshots[id]))) {
    throw new Error('Prepared dungeon encounter must contain one result and player snapshot per participant.');
  }

  if (!input.combat.win && input.drops.length > 0) {
    throw new Error('A losing dungeon encounter cannot contain victory drops.');
  }

  const drops = input.drops.map(drop => {
    if (!isRecord(drop) || typeof drop.itemId !== 'string' || !drop.itemId ||
        typeof drop.recipientId !== 'string' || !ids.includes(drop.recipientId)) {
      throw new Error('Prepared dungeon encounter contains an invalid drop allocation.');
    }
    return { itemId: drop.itemId, recipientId: drop.recipientId };
  });

  const participants: Record<string, PreparedDungeonParticipantResult> = {};
  const playerSnapshots: Record<string, Record<string, unknown>> = {};
  for (const [index, playerId] of ids.entries()) {
    const raw = input.participants[playerId] as Record<string, unknown>;
    const snapshot = input.playerSnapshots[playerId] as Record<string, unknown>;
    if (raw.playerId !== playerId ||
        !Number.isFinite(raw.hpBefore) || Number(raw.hpBefore) <= 0 ||
        !Number.isFinite(raw.hpAfter) || Number(raw.hpAfter) < 1 ||
        !Number.isFinite(raw.incomingDamage) || Number(raw.incomingDamage) < 0 ||
        !Number.isFinite(raw.outgoingDamage) || Number(raw.outgoingDamage) < 0 ||
        !Number.isInteger(raw.xp) || Number(raw.xp) < 0 ||
        !Number.isInteger(raw.gold) || Number(raw.gold) < 0 ||
        !Array.isArray(raw.lootIds) || raw.lootIds.some(id => typeof id !== 'string' || !id) ||
        !isRecord(raw.report) || typeof raw.resultText !== 'string' ||
        raw.incomingDamage !== input.combat.incoming[index] ||
        raw.outgoingDamage !== input.combat.damageByParticipant[index] ||
        snapshot.health !== raw.hpAfter) {
      throw new Error(`Prepared dungeon settlement is invalid for participant ${playerId}.`);
    }
    const allocatedLoot = drops.filter(drop => drop.recipientId === playerId).map(drop => drop.itemId);
    if (JSON.stringify(raw.lootIds) !== JSON.stringify(allocatedLoot)) {
      throw new Error(`Prepared dungeon loot allocation does not match participant ${playerId}.`);
    }
    participants[playerId] = {
      playerId,
      hpBefore: Number(raw.hpBefore),
      hpAfter: Number(raw.hpAfter),
      incomingDamage: Number(raw.incomingDamage),
      outgoingDamage: Number(raw.outgoingDamage),
      xp: Number(raw.xp),
      gold: Number(raw.gold),
      lootIds: [...raw.lootIds] as string[],
      report: cloneJson(raw.report),
      resultText: raw.resultText,
    };
    playerSnapshots[playerId] = cloneJson(snapshot);
  }

  const prepared: PreparedDungeonEncounter = {
    version: 1,
    runId: input.runId,
    requestId: input.requestId,
    dungeonId: input.dungeonId,
    bossId: input.bossId,
    preparedAt: input.preparedAt,
    participantIds: [...ids],
    combat: {
      rounds: input.combat.rounds,
      incoming: [...input.combat.incoming],
      win: input.combat.win,
      damageByParticipant: [...input.combat.damageByParticipant],
    },
    drops,
    participants,
    playerSnapshots,
  };
  return deepFreeze(prepared);
}

/** Revalidates an encounter snapshot loaded from JSON after process restart. */
export function validatePreparedDungeonEncounter(value: unknown): PreparedDungeonEncounter {
  if (!isRecord(value)) throw new Error('Prepared dungeon encounter snapshot must be an object.');
  return createPreparedDungeonEncounter(value as unknown as PreparedDungeonEncounter);
}
