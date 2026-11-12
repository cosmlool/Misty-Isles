export type DungeonParticipantStatus = 'alive' | 'spectator' | 'revived';

export type DungeonRunParticipant = {
  playerId: string;
  status: DungeonParticipantStatus;
  health: number;
  maxHealth: number;
  lastActivityAt: number;
  resurrectedPlayerIds: string[];
};

export type DungeonRunRecord = {
  version: 1;
  runId: string;
  requestId: string;
  dungeonId: string;
  groupId: string;
  leaderId: string;
  participantIds: string[];
  status: 'active' | 'completed' | 'aborted';
  startedAt: number;
  updatedAt: number;
  roundIndex: number;
  participants: Record<string, DungeonRunParticipant>;
  encounter: {
    bossId: string;
    bossHealth: number;
    bossMaxHealth: number;
    seed: string;
  };
  terminalResult?: {
    outcome: 'win' | 'loss' | 'leader_afk' | 'leader_dead';
    committedAt: number;
    requestId: string;
  };
};

export type DungeonRunStore = Record<string, DungeonRunRecord>;

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function validateDungeonRunStore(value: unknown): DungeonRunStore {
  if (!isRecord(value)) throw new Error('dungeon_runs.json must contain an object keyed by run ID.');
  const result: DungeonRunStore = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!isRecord(raw) || raw.version !== 1 || raw.runId !== key ||
      typeof raw.requestId !== 'string' || !raw.requestId ||
      typeof raw.dungeonId !== 'string' || !raw.dungeonId ||
      typeof raw.leaderId !== 'string' || !raw.leaderId ||
      !Array.isArray(raw.participantIds) || raw.participantIds.length < 1 || raw.participantIds.length > 3 ||
      new Set(raw.participantIds).size !== raw.participantIds.length ||
      !raw.participantIds.includes(raw.leaderId) ||
      !['active', 'completed', 'aborted'].includes(raw.status) ||
      !Number.isFinite(raw.startedAt) || !Number.isFinite(raw.updatedAt) ||
      !Number.isInteger(raw.roundIndex) || raw.roundIndex < 0 ||
      !isRecord(raw.participants) || !isRecord(raw.encounter)) {
      throw new Error(`dungeon_runs.json contains an invalid run record: ${key}.`);
    }
    for (const playerId of raw.participantIds) {
      const participant = raw.participants[playerId];
      if (!isRecord(participant) || participant.playerId !== playerId ||
        !['alive', 'spectator', 'revived'].includes(participant.status) ||
        !Number.isFinite(participant.health) || !Number.isFinite(participant.maxHealth) ||
        !Number.isFinite(participant.lastActivityAt) ||
        !Array.isArray(participant.resurrectedPlayerIds)) {
        throw new Error(`dungeon_runs.json contains invalid participant state for ${playerId} in ${key}.`);
      }
    }
    if (raw.status !== 'active' && (!isRecord(raw.terminalResult) ||
      !['win', 'loss', 'leader_afk', 'leader_dead'].includes(raw.terminalResult.outcome) ||
      !Number.isFinite(raw.terminalResult.committedAt) ||
      raw.terminalResult.requestId !== raw.requestId)) {
      throw new Error(`dungeon_runs.json contains a terminal run without a durable terminal result: ${key}.`);
    }
    result[key] = raw as DungeonRunRecord;
  }
  return result;
}

export function createDungeonRunRecord(input: {
  runId: string;
  requestId: string;
  dungeonId: string;
  groupId?: string;
  leaderId: string;
  participants: Array<{ playerId: string; health: number; maxHealth: number }>;
  bossId: string;
  bossHealth: number;
  seed: string;
  now: number;
}): DungeonRunRecord {
  const participantIds = input.participants.map(p => p.playerId);
  if (participantIds.length < 1 || participantIds.length > 3 ||
    new Set(participantIds).size !== participantIds.length ||
    !participantIds.includes(input.leaderId)) {
    throw new Error('A dungeon run requires 1–3 unique participants including its leader.');
  }
  if (!input.runId || !input.requestId || !input.dungeonId || !input.bossId || !input.seed ||
    !Number.isFinite(input.now) || !Number.isFinite(input.bossHealth) || input.bossHealth <= 0) {
    throw new Error('A dungeon run is missing required durable encounter data.');
  }
  const participants: Record<string, DungeonRunParticipant> = {};
  for (const p of input.participants) {
    if (!Number.isFinite(p.health) || !Number.isFinite(p.maxHealth) || p.maxHealth <= 0) {
      throw new Error(`Invalid health snapshot for ${p.playerId}.`);
    }
    participants[p.playerId] = {
      playerId: p.playerId,
      status: 'alive',
      health: p.health,
      maxHealth: p.maxHealth,
      lastActivityAt: input.now,
      resurrectedPlayerIds: [],
    };
  }
  return {
    version: 1,
    runId: input.runId,
    requestId: input.requestId,
    dungeonId: input.dungeonId,
    groupId: input.groupId || '',
    leaderId: input.leaderId,
    participantIds,
    status: 'active',
    startedAt: input.now,
    updatedAt: input.now,
    roundIndex: 0,
    participants,
    encounter: {
      bossId: input.bossId,
      bossHealth: input.bossHealth,
      bossMaxHealth: input.bossHealth,
      seed: input.seed,
    },
  };
}

export function advanceDungeonRunRound(
  current: DungeonRunRecord,
  update: { now: number; bossHealth: number; participantHealth: Record<string, number> },
): DungeonRunRecord {
  if (current.status !== 'active') throw new Error('Cannot advance a terminal dungeon run.');
  if (!Number.isFinite(update.now) || !Number.isFinite(update.bossHealth) || update.bossHealth < 0) {
    throw new Error('Invalid dungeon round snapshot.');
  }
  const participants = { ...current.participants };
  for (const playerId of current.participantIds) {
    const health = update.participantHealth[playerId];
    if (!Number.isFinite(health) || health < 0) throw new Error(`Missing or invalid health snapshot for ${playerId}.`);
    participants[playerId] = { ...participants[playerId], health };
  }
  return {
    ...current,
    updatedAt: update.now,
    roundIndex: current.roundIndex + 1,
    participants,
    encounter: { ...current.encounter, bossHealth: update.bossHealth },
  };
}

export function finishDungeonRun(
  current: DungeonRunRecord,
  outcome: NonNullable<DungeonRunRecord['terminalResult']>['outcome'],
  now: number,
): DungeonRunRecord {
  if (current.status !== 'active') {
    if (current.terminalResult?.outcome === outcome) return current;
    throw new Error('Dungeon run has already reached a different terminal result.');
  }
  if (!Number.isFinite(now)) throw new Error('Invalid dungeon terminal timestamp.');
  return {
    ...current,
    status: outcome === 'win' || outcome === 'loss' ? 'completed' : 'aborted',
    updatedAt: now,
    terminalResult: { outcome, committedAt: now, requestId: current.requestId },
  };
}
