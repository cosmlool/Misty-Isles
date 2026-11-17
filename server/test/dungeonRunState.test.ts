import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceDungeonRunRound,
  createDungeonRoundPlan,
  resolveNextDungeonRunRound,
  createDungeonRunRecord,
  finishDungeonRun,
  markDungeonParticipantDead,
  reviveDungeonParticipant,
  validateDungeonRunStore,
} from '../src/dungeonRunState.js';

function run() {
  return createDungeonRunRecord({
    runId: 'run_001', requestId: 'dungeon_req_001', dungeonId: 'fl_dungeon_03',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 90, maxHealth: 110 },
    ],
    bossId: 'boss_03', bossHealth: 500, seed: 'deterministic-seed', now: 1000,
  });
}

test('durable dungeon run freezes the party roster and captures independent participant state', () => {
  const state = run();
  assert.deepEqual(state.participantIds, ['p1', 'p2']);
  assert.equal(state.leaderId, 'p1');
  assert.equal(state.participants.p1.health, 100);
  assert.equal(state.participants.p2.health, 90);
  assert.equal(state.status, 'active');
  assert.equal(validateDungeonRunStore({ run_001: state }).run_001.requestId, 'dungeon_req_001');
});

test('dungeon run creation rejects empty, whitespace-only and non-string participant IDs', () => {
  for (const playerId of ['', '   ', 42, null]) {
    assert.throws(() => createDungeonRunRecord({
      runId: 'bad_roster', requestId: 'bad_roster_request', dungeonId: 'dungeon',
      leaderId: 'p1',
      participants: [{ playerId, health: 100, maxHealth: 100 }] as unknown as Array<{ playerId: string; health: number; maxHealth: number }>,
      bossId: 'boss', bossHealth: 10, seed: 'seed', now: 1,
    }), /unique non-empty string participants/);
  }
});

test('dungeon run creation rejects malformed required identifiers and group IDs', () => {
  const valid = {
    runId: 'bad_identity', requestId: 'bad_identity_request', dungeonId: 'dungeon',
    groupId: 'group_1', leaderId: 'p1',
    participants: [{ playerId: 'p1', health: 100, maxHealth: 100 }],
    bossId: 'boss', bossHealth: 10, seed: 'seed', now: 1,
  };
  const malformed: Array<Partial<typeof valid>> = [
    { runId: 42 as unknown as string },
    { requestId: '   ' },
    { dungeonId: null as unknown as string },
    { leaderId: '' },
    { groupId: 42 as unknown as string },
    { groupId: '   ' },
    { bossId: false as unknown as string },
    { seed: ' ' },
  ];
  for (const override of malformed) {
    assert.throws(() => createDungeonRunRecord({ ...valid, ...override }));
  }
});

test('a saved round restores its exact HP, boss HP, round index and activity snapshot', () => {
  const afterRound = advanceDungeonRunRound(run(), {
    now: 2000, bossHealth: 320, participantHealth: { p1: 75, p2: 62 },
  });
  const restored = validateDungeonRunStore(JSON.parse(JSON.stringify({ run_001: afterRound }))).run_001;
  assert.equal(restored.roundIndex, 1);
  assert.equal(restored.encounter.bossHealth, 320);
  assert.equal(restored.participants.p1.health, 75);
  assert.equal(restored.participants.p2.health, 62);
  assert.equal(restored.updatedAt, 2000);
});

test('terminal result is durable and duplicate same-result completion is idempotent', () => {
  const completed = finishDungeonRun(run(), 'win', 3000);
  assert.equal(finishDungeonRun(completed, 'win', 4000), completed);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.terminalResult?.requestId, 'dungeon_req_001');
  assert.throws(() => finishDungeonRun(completed, 'loss', 4000), /different terminal result/);
});

test('manual round snapshots reject invalid HP and cannot bypass a deterministic round plan', () => {
  const base = run();
  assert.throws(() => advanceDungeonRunRound(base, {
    now: 2000, bossHealth: 400, participantHealth: { p1: 0, p2: 60 },
  }), /invalid health snapshot/);
  assert.throws(() => advanceDungeonRunRound(base, {
    now: 2000, bossHealth: 501, participantHealth: { p1: 80, p2: 60 },
  }), /Invalid dungeon round snapshot/);
  assert.throws(() => advanceDungeonRunRound(base, {
    now: 2000, bossHealth: 400, participantHealth: { p1: 80, p2: 60, rogue: 10 },
  }), /exactly one health value/);
  const planned = {
    ...base,
    roundPlan: createDungeonRoundPlan({
      totalRounds: 2, totalBossDamage: 100,
      totalIncomingDamageByParticipant: { p1: 10, p2: 10 },
    }),
  };
  assert.throws(() => advanceDungeonRunRound(planned, {
    now: 2000, bossHealth: 450, participantHealth: { p1: 90, p2: 80 },
  }), /deterministic round resolver/);
});

test('direct terminal transition cannot bypass unresolved planned combat rounds', () => {
  const base = run();
  const planned = {
    ...base,
    roundPlan: createDungeonRoundPlan({
      totalRounds: 2, totalBossDamage: 100,
      totalIncomingDamageByParticipant: { p1: 10, p2: 10 },
    }),
  };
  assert.throws(() => finishDungeonRun(planned, 'win', 2000), /planned combat rounds remain unresolved/);
  assert.throws(() => finishDungeonRun(planned, 'loss', 2000), /planned combat rounds remain unresolved/);
});

test('invalid roster, leader and terminal snapshots fail closed on startup recovery', () => {
  const state = run();
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...state, participantIds: ['p2'] },
  }), /invalid run record/);
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...finishDungeonRun(state, 'win', 3000), terminalResult: undefined },
  }), /terminal run without a durable terminal result/);
});


test('death moves a participant to spectator without changing the party roster', () => {
  const dead = markDungeonParticipantDead(run(), 'p2', 2500);
  assert.deepEqual(dead.participantIds, ['p1', 'p2']);
  assert.equal(dead.participants.p2.status, 'spectator');
  assert.equal(dead.participants.p2.health, 0);
  assert.equal(dead.participants.p2.lastActivityAt, 2500);
  assert.equal(markDungeonParticipantDead(dead, 'p2', 2600), dead);
});

test('one scroll revives one different ally and records per-rescuer history', () => {
  const dead = markDungeonParticipantDead(run(), 'p2', 2500);
  const revived = reviveDungeonParticipant(dead, {
    rescuerId: 'p1', targetId: 'p2', availableScrolls: 2, reviveHealth: 30, now: 3000,
  });
  assert.equal(revived.scrollsRemaining, 1);
  assert.equal(revived.run.participants.p2.status, 'revived');
  assert.equal(revived.run.participants.p2.health, 30);
  assert.deepEqual(revived.run.participants.p1.resurrectedPlayerIds, ['p2']);
  assert.equal(validateDungeonRunStore({ run_001: revived.run }).run_001.participants.p2.status, 'revived');
});

test('resurrection rejects self, duplicate rescuer-target pairs, living targets and missing scrolls', () => {
  const base = run();
  assert.throws(() => reviveDungeonParticipant(base, {
    rescuerId: 'p1', targetId: 'p1', availableScrolls: 1, reviveHealth: 10, now: 1,
  }), /cannot revive themselves/);
  assert.throws(() => reviveDungeonParticipant(base, {
    rescuerId: 'p1', targetId: 'p2', availableScrolls: 1, reviveHealth: 10, now: 1,
  }), /fallen spectator/);
  const dead = markDungeonParticipantDead(base, 'p2', 2);
  const first = reviveDungeonParticipant(dead, {
    rescuerId: 'p1', targetId: 'p2', availableScrolls: 2, reviveHealth: 10, now: 3,
  }).run;
  const secondDeath = markDungeonParticipantDead(first, 'p2', 4);
  assert.throws(() => reviveDungeonParticipant(secondDeath, {
    rescuerId: 'p1', targetId: 'p2', availableScrolls: 1, reviveHealth: 10, now: 5,
  }), /already revived/);
  assert.throws(() => reviveDungeonParticipant(dead, {
    rescuerId: 'p1', targetId: 'p2', availableScrolls: 0, reviveHealth: 10, now: 3,
  }), /scroll is required/);
});

test('another active participant may revive the same ally after a separate death', () => {
  const threePlayerRun = createDungeonRunRecord({
    runId: 'run_003', requestId: 'dungeon_req_003', dungeonId: 'fl_dungeon_03',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 90, maxHealth: 110 },
      { playerId: 'p3', health: 95, maxHealth: 115 },
    ],
    bossId: 'boss_03', bossHealth: 500, seed: 'deterministic-seed', now: 1,
  });
  const dead = markDungeonParticipantDead(threePlayerRun, 'p2', 2);
  const first = reviveDungeonParticipant(dead, {
    rescuerId: 'p1', targetId: 'p2', availableScrolls: 1, reviveHealth: 10, now: 3,
  }).run;
  const secondDeath = markDungeonParticipantDead(first, 'p2', 4);
  const second = reviveDungeonParticipant(secondDeath, {
    rescuerId: 'p3', targetId: 'p2', availableScrolls: 1, reviveHealth: 15, now: 5,
  });
  assert.equal(second.run.participants.p2.status, 'revived');
  assert.equal(second.run.participants.p2.health, 15);
  assert.deepEqual(second.run.participants.p1.resurrectedPlayerIds, ['p2']);
  assert.deepEqual(second.run.participants.p3.resurrectedPlayerIds, ['p2']);
});


test('deterministic round plan preserves aggregate damage exactly and resumes at the next round', () => {
  const plan = createDungeonRoundPlan({
    totalRounds: 3,
    totalBossDamage: 101,
    totalIncomingDamageByParticipant: { p1: 10, p2: 5 },
  });
  assert.equal(plan.bossDamageByRound.reduce((sum, value) => sum + value, 0), 101);
  assert.equal(plan.incomingDamageByRound.p1.reduce((sum, value) => sum + value, 0), 10);
  assert.equal(plan.incomingDamageByRound.p2.reduce((sum, value) => sum + value, 0), 5);

  const base = run();
  const withPlan = { ...base, encounter: { ...base.encounter, bossHealth: 101, bossMaxHealth: 101 }, roundPlan: plan };
  const firstRound = resolveNextDungeonRunRound(withPlan, 2000);
  const restored = validateDungeonRunStore(JSON.parse(JSON.stringify({
    run_001: firstRound,
  }))).run_001;
  assert.equal(restored.roundIndex, 1);
  assert.equal(restored.roundPlan?.nextRoundIndex, 1);
  assert.equal(restored.encounter.bossHealth, 68);
  assert.equal(restored.participants.p1.health, 97);
  assert.equal(restored.participants.p2.health, 89);

  const secondRound = resolveNextDungeonRunRound(restored, 3000);
  const finalRound = resolveNextDungeonRunRound(secondRound, 4000);
  assert.equal(finalRound.encounter.bossHealth, 0);
  assert.equal(finalRound.roundPlan?.nextRoundIndex, 3);
  assert.equal(finalRound.participants.p1.health, 90);
  assert.equal(finalRound.participants.p2.health, 85);
  assert.throws(() => resolveNextDungeonRunRound(finalRound, 5000), /No unresolved dungeon round/);
});

test('startup validation rejects round cursor drift, impossible health and malformed encounter snapshots', () => {
  const state = run();
  const plan = createDungeonRoundPlan({
    totalRounds: 2,
    totalBossDamage: 100,
    totalIncomingDamageByParticipant: { p1: 10, p2: 10 },
  });
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...state, roundPlan: { ...plan, nextRoundIndex: 1 }, roundIndex: 0 },
  }), /misaligned round plan/);
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...state, participants: { ...state.participants, p1: { ...state.participants.p1, health: 121 } } },
  }), /invalid participant state/);
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...state, participants: { ...state.participants, p1: { ...state.participants.p1, health: 0 } } },
  }), /invalid participant state/);
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...state, encounter: { ...state.encounter, bossHealth: 501 } },
  }), /invalid boss snapshot/);
  assert.throws(() => validateDungeonRunStore({
    run_001: { ...state, participants: { ...state.participants, rogue: { ...state.participants.p1, playerId: 'rogue' } } },
  }), /incomplete participant map/);
  assert.throws(() => createDungeonRunRecord({
    runId: 'bad_hp', requestId: 'bad_hp_request', dungeonId: 'dungeon', leaderId: 'p1',
    participants: [{ playerId: 'p1', health: 121, maxHealth: 120 }],
    bossId: 'boss', bossHealth: 10, seed: 'seed', now: 1,
  }), /Invalid health snapshot/);
});

test('round plan validation rejects incomplete or non-finite participant schedules', () => {
  const state = {
    ...run(),
    roundPlan: {
      totalRounds: 2,
      nextRoundIndex: 0,
      bossDamageByRound: [5, 5],
      incomingDamageByRound: { p1: [1, 1] },
    },
  };
  assert.throws(() => validateDungeonRunStore({ run_001: state }), /incomplete or misaligned round plan/);
  assert.throws(() => createDungeonRoundPlan({
    totalRounds: 2,
    totalBossDamage: 10,
    totalIncomingDamageByParticipant: { p1: 1, p2: Number.NaN },
  }), /Invalid deterministic dungeon round plan/);
});


test('startup recovery rejects prepared encounter snapshots detached from durable participant HP', () => {
  const state = run();
  const prepared = {
    version: 1, runId: state.runId, requestId: state.requestId, dungeonId: state.dungeonId,
    bossId: state.encounter.bossId, preparedAt: 1100, participantIds: ['p1', 'p2'],
    combat: { rounds: 1, incoming: [1, 1], win: true, damageByParticipant: [10, 10] },
    drops: [],
    participants: {
      p1: { playerId: 'p1', hpBefore: 99, hpAfter: 98, incomingDamage: 1, outgoingDamage: 10, xp: 1, gold: 1, lootIds: [], report: {}, resultText: 'Win' },
      p2: { playerId: 'p2', hpBefore: 90, hpAfter: 89, incomingDamage: 1, outgoingDamage: 10, xp: 1, gold: 1, lootIds: [], report: {}, resultText: 'Win' },
    },
    playerSnapshots: { p1: { id: 'p1', health: 98 }, p2: { id: 'p2', health: 89 } },
  };
  assert.throws(() => validateDungeonRunStore({
    [state.runId]: { ...state, preparedEncounter: prepared },
  }), /prepared encounter that does not match run/);
});
