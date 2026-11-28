import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';
import { createDungeonRunRecord } from '../src/dungeonRunState.js';
import { createPreparedDungeonEncounter } from '../src/dungeonEncounterPreparation.js';
import { commitDungeonRunStart } from '../src/dungeonRunStartRuntime.js';

function fixture() {
  const run = createDungeonRunRecord({
    runId: 'run_prepared_start',
    requestId: 'request_prepared_start',
    dungeonId: 'dungeon_40',
    groupId: 'group_1',
    leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 80, maxHealth: 110 },
    ],
    bossId: 'boss_40',
    bossHealth: 500,
    seed: 'request_prepared_start',
    now: 100,
  });
  const encounter = createPreparedDungeonEncounter({
    version: 1,
    runId: run.runId,
    requestId: run.requestId,
    dungeonId: run.dungeonId,
    bossId: run.encounter.bossId,
    preparedAt: 150,
    participantIds: ['p1', 'p2'],
    combat: { rounds: 2, incoming: [10, 20], win: true, damageByParticipant: [50, 40] },
    drops: [],
    participants: {
      p1: { playerId: 'p1', hpBefore: 100, hpAfter: 95, incomingDamage: 10, outgoingDamage: 50, xp: 100, gold: 20, lootIds: [], report: { result: 'win' }, resultText: 'Victory p1' },
      p2: { playerId: 'p2', hpBefore: 80, hpAfter: 70, incomingDamage: 20, outgoingDamage: 40, xp: 110, gold: 25, lootIds: [], report: { result: 'win' }, resultText: 'Victory p2' },
    },
    playerSnapshots: {
      p1: { id: 'p1', health: 95, gold: 120 },
      p2: { id: 'p2', health: 70, gold: 225 },
    },
  });
  const players = {
    p1: { id: 'p1', health: 100, quests: JSON.stringify({ dungeonDay: '2026-11-28', dungeonRuns: 1 }), battles: 3 },
    p2: { id: 'p2', health: 80, quests: JSON.stringify({ dungeonDay: '2026-11-28', dungeonRuns: 2 }), battles: 7 },
  };
  return { run, encounter, players };
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('prepared encounter, deterministic round plan, daily attempts and battle counters commit together', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-prepared-dungeon-start-'));
  const files = {
    players: join(dataDir, 'players.json'),
    dungeonRuns: join(dataDir, 'dungeon_runs.json'),
  };
  try {
    const store = createSharedStateTransactionStore({ dataDir, files });
    const runtime = createSharedStateRuntime({
      shared: store,
      auction: { recover: () => false },
      clans: { recover: () => false },
    });
    const { run, encounter, players } = fixture();
    const committed = commitDungeonRunStart({
      runtime, run, encounter, players, runs: {}, day: '2026-11-28',
    });
    const savedPlayers = readJson(files.players);
    const savedRuns = readJson(files.dungeonRuns);
    const savedRun = savedRuns[run.runId];

    assert.equal(committed.alreadyStarted, false);
    assert.equal(savedRun.status, 'active');
    assert.deepEqual(savedRun.participantIds, ['p1', 'p2']);
    assert.deepEqual(savedRun.preparedEncounter, encounter);
    assert.equal(savedRun.roundPlan.totalRounds, 2);
    assert.equal(savedRun.roundPlan.nextRoundIndex, 0);
    assert.deepEqual(savedRun.roundPlan.bossDamageByRound, [25, 25]);
    assert.deepEqual(savedRun.roundPlan.incomingDamageByRound.p1, [5, 5]);
    assert.deepEqual(savedRun.roundPlan.incomingDamageByRound.p2, [10, 10]);
    assert.equal(JSON.parse(savedPlayers.p1.quests).dungeonRuns, 2);
    assert.equal(JSON.parse(savedPlayers.p2.quests).dungeonRuns, 3);
    assert.equal(savedPlayers.p1.battles, 4);
    assert.equal(savedPlayers.p2.battles, 8);
    assert.equal(savedPlayers.p1.health, 100, 'entry must not apply future combat damage or rewards');
    assert.equal(savedPlayers.p2.health, 80, 'entry must preserve current participant HP');
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('retrying a prepared entry is idempotent and a conflicting prepared encounter is rejected', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-prepared-dungeon-retry-'));
  const files = {
    players: join(dataDir, 'players.json'),
    dungeonRuns: join(dataDir, 'dungeon_runs.json'),
  };
  try {
    const store = createSharedStateTransactionStore({ dataDir, files });
    const runtime = createSharedStateRuntime({
      shared: store,
      auction: { recover: () => false },
      clans: { recover: () => false },
    });
    const { run, encounter, players } = fixture();
    const first = commitDungeonRunStart({
      runtime, run, encounter, players, runs: {}, day: '2026-11-28',
    });
    const firstPlayers = readJson(files.players);
    const firstRuns = readJson(files.dungeonRuns);
    const retry = commitDungeonRunStart({
      runtime,
      run,
      encounter,
      players: firstPlayers,
      runs: firstRuns,
      day: '2026-11-28',
    });
    assert.equal(retry.alreadyStarted, true);
    assert.deepEqual(readJson(files.players), firstPlayers);
    assert.deepEqual(readJson(files.dungeonRuns), firstRuns);

    const conflictingEncounter = createPreparedDungeonEncounter({
      ...encounter,
      combat: { ...encounter.combat, damageByParticipant: [49, 41] },
      participants: {
        ...encounter.participants,
        p1: { ...encounter.participants.p1, outgoingDamage: 49 },
        p2: { ...encounter.participants.p2, outgoingDamage: 41 },
      },
    });
    assert.throws(() => commitDungeonRunStart({
      runtime,
      run,
      encounter: conflictingEncounter,
      players: firstPlayers,
      runs: firstRuns,
      day: '2026-11-28',
    }), /different or incomplete execution plan/);
    assert.deepEqual(readJson(files.players), firstPlayers);
    assert.deepEqual(readJson(files.dungeonRuns), firstRuns);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
