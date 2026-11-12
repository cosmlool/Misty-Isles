export type DungeonParticipantStatus = 'alive' | 'spectator' | 'revived';

export type DungeonRunParticipant = {
  playerId: string;
  status: DungeonParticipantStatus;
  health: number;
  maxHealth: number;
  lastActivityAt: number;
  resurrectedPlayerIds: string[];
};

export type DungeonRoundPlan = {
  totalRounds: number;
  nextRoundIndex: number;
  bossDamageByRound: number[];
  participantDamageByRound: Record<string, number[]>;
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
  roundPlan?: DungeonRoundPlan;
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
      (raw.roundPlan !== undefined && (!isRecord(raw.roundPlan) ||
        !Number.isInteger(raw.roundPlan.totalRounds) || raw.roundPlan.totalRounds < 1 ||
        !Number.isInteger(raw.roundPlan.nextRoundIndex) || raw.roundPlan.nextRoundIndex < 0 ||
        raw.roundPlan.nextRoundIndex > raw.roundPlan.totalRounds ||
        !Array.isArray(raw.roundPlan.bossDamageByRound) ||
        raw.roundPlan.bossDamageByRound.length !== raw.roundPlan.totalRounds ||
        raw.roundPlan.bossDamageByRound.some((damage: unknown) => !Number.isFinite(damage) || Number(damage) < 0) ||
        !isRecord(raw.roundPlan.participantDamageByRound))) ||
      !isRecord(raw.participants) || !isRecord(raw.encounter)) {
      throw new Error(`dungeon_runs.json contains an invalid run record: ${key}.`);
    }
    if (raw.roundPlan && Object.keys(raw.roundPlan.participantDamageByRound).length !== raw.participantIds.length) {
      throw new Error(`dungeon_runs.json contains an incomplete round plan for ${key}.`);
    }
    if (raw.roundPlan) {
      for (const playerId of raw.participantIds) {
        const schedule = raw.roundPlan.participantDamageByRound[playerId];
        if (!Array.isArray(schedule) || schedule.length !== raw.roundPlan.totalRounds ||
          schedule.some((damage: unknown) => !Number.isFinite(damage) || Number(damage) < 0)) {
          throw new Error(`dungeon_runs.json contains an invalid damage schedule for ${playerId} in ${key}.`);
        }
      }
    }
    for (const playerId of raw.participantIds) {
      const participant = raw.participants[playerId];
      if (!isRecord(participant) || participant.playerId !== playerId ||
        !['alive', 'spectator', 'revived'].includes(participant.status) ||
        !Number.isFinite(participant.health) || !Number.isFinite(participant.maxHealth) ||
        !Number.isFinite(participant.lastActivityAt) ||
        !Array.isArray(participant.resurrectedPlayerIds) ||
        new Set(participant.resurrectedPlayerIds).size !== participant.resurrectedPlayerIds.length ||
        participant.resurrectedPlayerIds.some((id: unknown) => typeof id !== 'string' || id === playerId || !raw.participantIds.includes(id))) {
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

/** Split aggregate combat damage into deterministic integer round slices without changing its total. */
export function createDungeonRoundPlan(input: {
  totalRounds: number;
  totalBossDamage: number;
  totalDamageByParticipant: Record<string, number>;
}): DungeonRoundPlan {
  const ids = Object.keys(input.totalDamageByParticipant);
  if (!Number.isInteger(input.totalRounds) || input.totalRounds < 1 ||
    !Number.isFinite(input.totalBossDamage) || input.totalBossDamage < 0 ||
    ids.length < 1 || ids.some(id => !id || !Number.isFinite(input.totalDamageByParticipant[id]) || input.totalDamageByParticipant[id] < 0)) {
    throw new Error('Invalid deterministic dungeon round plan.');
  }
  const split = (total: number) => Array.from({ length: input.totalRounds }, (_, index) =>
    Math.floor(total * (index + 1) / input.totalRounds) - Math.floor(total * index / input.totalRounds));
  return {
    totalRounds: input.totalRounds,
    nextRoundIndex: 0,
    bossDamageByRound: split(input.totalBossDamage),
    participantDamageByRound: Object.fromEntries(ids.map(id => [id, split(input.totalDamageByParticipant[id])])),
  };
}

export function resolveNextDungeonRunRound(
  current: DungeonRunRecord,
  now: number,
): DungeonRunRecord {
  if (current.status !== 'active') throw new Error('Cannot advance a terminal dungeon run.');
  const plan = current.roundPlan;
  if (!plan || plan.nextRoundIndex >= plan.totalRounds) throw new Error('No unresolved dungeon round remains.');
  if (!Number.isFinite(now)) throw new Error('Invalid dungeon round timestamp.');
  const participantHealth: Record<string, number> = {};
  const participants = { ...current.participants };
  for (const playerId of current.participantIds) {
    const participant = participants[playerId];
    if (participant.status === 'spectator') {
      participantHealth[playerId] = 0;
      continue;
    }
    const damage = plan.participantDamageByRound[playerId][plan.nextRoundIndex];
    participantHealth[playerId] = Math.max(0, participant.health - damage);
    if (participantHealth[playerId] === 0) {
      participants[playerId] = { ...participant, status: 'spectator', health: 0, lastActivityAt: now };
    } else {
      participants[playerId] = { ...participant, health: participantHealth[playerId] };
    }
  }
  const nextBossHealth = Math.max(0, current.encounter.bossHealth - plan.bossDamageByRound[plan.nextRoundIndex]);
  const nextPlan = { ...plan, nextRoundIndex: plan.nextRoundIndex + 1 };
  return {
    ...current,
    updatedAt: now,
    roundIndex: current.roundIndex + 1,
    participants,
    roundPlan: nextPlan,
    encounter: { ...current.encounter, bossHealth: nextBossHealth },
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


/** A death moves the participant to spectator state; the group roster is unchanged. */
export function markDungeonParticipantDead(
  current: DungeonRunRecord,
  playerId: string,
  now: number,
): DungeonRunRecord {
  if (current.status !== 'active') throw new Error('Cannot change participants in a terminal dungeon run.');
  const participant = current.participants[playerId];
  if (!participant) throw new Error(`Unknown dungeon participant: ${playerId}.`);
  if (!Number.isFinite(now)) throw new Error('Invalid participant activity timestamp.');
  if (participant.status === 'spectator') return current;
  return {
    ...current,
    updatedAt: now,
    participants: {
      ...current.participants,
      [playerId]: { ...participant, status: 'spectator', health: 0, lastActivityAt: now },
    },
  };
}

/**
 * One scroll revives one other participant. The caller owns the real inventory
 * mutation; this transition returns the remaining scroll count so both changes
 * can be committed together by the runtime transaction.
 */
export function reviveDungeonParticipant(
  current: DungeonRunRecord,
  input: {
    rescuerId: string;
    targetId: string;
    availableScrolls: number;
    reviveHealth: number;
    now: number;
  },
): { run: DungeonRunRecord; scrollsRemaining: number } {
  if (current.status !== 'active') throw new Error('Cannot revive participants in a terminal dungeon run.');
  const rescuer = current.participants[input.rescuerId];
  const target = current.participants[input.targetId];
  if (!rescuer || !target) throw new Error('Rescuer and target must belong to this dungeon party.');
  if (input.rescuerId === input.targetId) throw new Error('A participant cannot revive themselves.');
  if (rescuer.status === 'spectator') throw new Error('A spectator cannot use a resurrection scroll.');
  if (target.status !== 'spectator') throw new Error('Only a fallen spectator can be revived.');
  if (!Number.isInteger(input.availableScrolls) || input.availableScrolls < 1) {
    throw new Error('A resurrection scroll is required.');
  }
  if (rescuer.resurrectedPlayerIds.includes(input.targetId)) {
    throw new Error('This rescuer has already revived this participant during the expedition.');
  }
  if (!Number.isFinite(input.now) || !Number.isFinite(input.reviveHealth) ||
    input.reviveHealth <= 0 || input.reviveHealth > target.maxHealth) {
    throw new Error('Invalid resurrection health or timestamp.');
  }
  const next: DungeonRunRecord = {
    ...current,
    updatedAt: input.now,
    participants: {
      ...current.participants,
      [input.rescuerId]: {
        ...rescuer,
        lastActivityAt: input.now,
        resurrectedPlayerIds: [...rescuer.resurrectedPlayerIds, input.targetId],
      },
      [input.targetId]: {
        ...target,
        status: 'revived',
        health: input.reviveHealth,
        lastActivityAt: input.now,
      },
    },
  };
  return { run: next, scrollsRemaining: input.availableScrolls - 1 };
}
