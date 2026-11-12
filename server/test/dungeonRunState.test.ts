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

test('another participant may revive the same ally after a separate death', () => {
  const dead = markDungeonParticipantDead(run(), 'p2', 2);
  const first = reviveDungeonParticipant(dead, {
    rescuerId: 'p1', targetId: 'p2', availableScrolls: 1, reviveHealth: 10, now: 3,
  }).run;
  const secondDeath = markDungeonParticipantDead(first, 'p2', 4);
  const second = reviveDungeonParticipant(secondDeath, {
    rescuerId: 'p2', targetId: 'p1', availableScrolls: 1, reviveHealth: 15, now: 5,
  });
  assert.equal(second.run.participants.p1.status, 'revived');
  assert.deepEqual(second.run.participants.p2.resurrectedPlayerIds, ['p1']);
});


test('deterministic round plan preserves aggregate damage exactly and resumes at the next round', () => {
  const plan = createDungeonRoundPlan({
    totalRounds: 3,
    totalBossDamage: 101,
    totalDamageByParticipant: { p1: 10, p2: 5 },
  });
  assert.equal(plan.bossDamageByRound.reduce((sum, value) => sum + value, 0), 101);
  assert.equal(plan.participantDamageByRound.p1.reduce((sum, value) => sum + value, 0), 10);
  assert.equal(plan.participantDamageByRound.p2.reduce((sum, value) => sum + value, 0), 5);

  const withPlan = { ...run(), roundPlan: plan };
  const firstRound = resolveNextDungeonRunRound(withPlan, 2000);
  const restored = validateDungeonRunStore(JSON.parse(JSON.stringify({
    run_001: firstRound,
  }))).run_001;
  assert.equal(restored.roundIndex, 1);
  assert.equal(restored.roundPlan?.nextRoundIndex, 1);
  assert.equal(restored.encounter.bossHealth, 67);
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

test('round plan validation rejects incomplete or non-finite participant schedules', () => {
  const state = {
    ...run(),
    roundPlan: {
      totalRounds: 2,
      nextRoundIndex: 0,
      bossDamageByRound: [5, 5],
      participantDamageByRound: { p1: [1, 1] },
    },
  };
  assert.throws(() => validateDungeonRunStore({ run_001: state }), /incomplete round plan/);
  assert.throws(() => createDungeonRoundPlan({
    totalRounds: 2,
    totalBossDamage: 10,
    totalDamageByParticipant: { p1: 1, p2: Number.NaN },
  }), /Invalid deterministic dungeon round plan/);
});
