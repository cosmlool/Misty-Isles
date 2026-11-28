import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';
import { createDungeonRunRecord, type DungeonRunStore } from '../src/dungeonRunState.js';
import { createPreparedDungeonEncounter } from '../src/dungeonEncounterPreparation.js';
import { commitPreparedLegacyDungeonSettlement } from '../src/dungeonLegacySettlementCommitRuntime.js';

function fixture() {
  const run = createDungeonRunRecord({
    runId: 'legacy_request_123456',
    requestId: 'request_123456',
    dungeonId: 'dungeon_40',
    groupId: 'group_1',
    leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 120 },
      { playerId: 'p2', health: 90, maxHealth: 110 },
    ],
    bossId: 'boss_40',
    bossHealth: 500,
    seed: 'request_123456',
    now: 150,
  });
  const events = ['p1', 'p2'].map((playerId) => {
    const eventId = `dungeon:${run.runId}:${playerId}:combatResult`;
    return {
      eventId,
      runId: run.runId,
      playerId,
      messageType: 'combatResult' as const,
      payload: { eventId, requestId: run.requestId, report: { result: 'win', playerId }, text: `Victory ${playerId}` },
    };
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
    drops: [{ itemId: 'rare_ore', recipientId: 'p2' }],
    participants: {
      p1: { playerId: 'p1', hpBefore: 100, hpAfter: 95, incomingDamage: 10, outgoingDamage: 50, xp: 100, gold: 20, lootIds: [], report: { result: 'win', playerId: 'p1' }, resultText: 'Victory p1' },
      p2: { playerId: 'p2', hpBefore: 90, hpAfter: 80, incomingDamage: 20, outgoingDamage: 40, xp: 110, gold: 25, lootIds: ['rare_ore'], report: { result: 'win', playerId: 'p2' }, resultText: 'Victory p2' },
    },
    playerSnapshots: {
      p1: { id: 'p1', health: 95, gold: 120, inventory: '[]', quests: '{"dungeonRuns":1}' },
      p2: { id: 'p2', health: 80, gold: 225, inventory: '["rare_ore"]', quests: '{"dungeonRuns":1}' },
    },
    outboxEvents: events,
  });
  return { run, encounter, players: {
    p1: { id: 'p1', name: 'One', health: 100 },
    p2: { id: 'p2', name: 'Two', health: 90 },
    p3: { id: 'p3', name: 'Unrelated', gold: 777 },
  } };
}

function memoryRuntime() {
  let writes = 0;
  let saved: any;
  const runtime = {
    transactWithRecovery<T>(prepare: (recovery: { recovered: boolean; playersRecovered: boolean }) => {
      files: { players: Record<string, Record<string, unknown>>; dungeonRuns: DungeonRunStore; dungeonOutbox: Record<string, any> };
      result: T;
      skipWrite?: boolean;
    }): T {
      const plan = prepare({ recovered: false, playersRecovered: false });
      if (!plan.skipWrite) { writes += 1; saved = plan.files; }
      return plan.result;
    },
  };
  return { runtime, get writes() { return writes; }, get saved() { return saved; } };
}

test('legacy settlement writes complete players, terminal run and result outbox in one WAL transaction', () => {
  const { run, encounter, players } = fixture();
  const memory = memoryRuntime();
  const result = commitPreparedLegacyDungeonSettlement({
    runtime: memory.runtime,
    runId: run.runId,
    runs: {},
    players,
    encounter,
    now: 150,
    outbox: {},
  });
  assert.equal(memory.writes, 1);
  assert.deepEqual(Object.keys(memory.saved).sort(), ['dungeonOutbox', 'dungeonRuns', 'players']);
  assert.equal(result.run.status, 'completed');
  assert.equal(result.run.terminalResult?.outcome, 'win');
  assert.deepEqual(memory.saved.players.p1, encounter.playerSnapshots.p1);
  assert.deepEqual(memory.saved.players.p2, encounter.playerSnapshots.p2);
  assert.deepEqual(memory.saved.players.p3, players.p3);
  assert.equal(memory.saved.dungeonOutbox[encounter.outboxEvents![0].eventId].status, 'pending');
});

test('same committed legacy settlement is idempotent and does not write twice', () => {
  const { run, encounter, players } = fixture();
  const memory = memoryRuntime();
  const first = commitPreparedLegacyDungeonSettlement({
    runtime: memory.runtime, runId: run.runId, runs: {}, players, encounter, now: 150, outbox: {},
  });
  const retry = commitPreparedLegacyDungeonSettlement({
    runtime: memory.runtime, runId: run.runId, runs: first.runs, players,
    encounter, now: 250, outbox: first.outbox,
  });
  assert.equal(first.alreadyPrepared, false);
  assert.equal(retry.alreadyPrepared, true);
  assert.equal(retry.alreadyFinalized, true);
  assert.equal(memory.writes, 1);
});

test('WAL recovery completes the entire settlement after an interrupted target write', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-legacy-settlement-wal-'));
  const files = {
    players: join(dataDir, 'players.json'),
    dungeonRuns: join(dataDir, 'dungeon_runs.json'),
    dungeonOutbox: join(dataDir, 'dungeon_outbox.json'),
  };
  try {
    const { run, encounter, players } = fixture();
    const store = createSharedStateTransactionStore({
      dataDir, files,
      testHooks: { afterTargetWrite(key) { if (key === 'players') throw new Error('simulated crash'); } },
    });
    const runtime = createSharedStateRuntime({
      shared: store, auction: { recover: () => false }, clans: { recover: () => false },
    });
    assert.throws(() => commitPreparedLegacyDungeonSettlement({
      runtime, runId: run.runId, runs: {}, players, encounter, now: 150, outbox: {},
    }), /simulated crash/);
    assert.equal(existsSync(store.journalFile), true);
    assert.equal(existsSync(files.dungeonRuns), false);

    const restartedStore = createSharedStateTransactionStore({ dataDir, files });
    assert.equal(restartedStore.recover(), true);
    const savedPlayers = JSON.parse(readFileSync(files.players, 'utf8'));
    const savedRuns = JSON.parse(readFileSync(files.dungeonRuns, 'utf8'));
    const savedOutbox = JSON.parse(readFileSync(files.dungeonOutbox, 'utf8'));
    assert.equal(savedPlayers.p1.gold, 120);
    assert.equal(savedPlayers.p2.inventory, '["rare_ore"]');
    assert.equal(savedPlayers.p3.gold, 777);
    assert.equal(savedRuns[run.runId].status, 'completed');
    assert.equal(savedRuns[run.runId].terminalResult.outcome, 'win');
    assert.equal(Object.values(savedOutbox).filter((event: any) => event.status === 'pending').length, 2);
    assert.equal(existsSync(store.journalFile), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('recovery detected before settlement rejects stale snapshots without writing', () => {
  const { run, encounter, players } = fixture();
  const runtime = {
    transactWithRecovery<T>(prepare: (recovery: { recovered: boolean; playersRecovered: boolean }) => {
      files: { players: Record<string, Record<string, unknown>>; dungeonRuns: DungeonRunStore; dungeonOutbox: Record<string, any> };
      result: T;
      skipWrite?: boolean;
    }): T {
      return prepare({ recovered: true, playersRecovered: true }).result;
    },
  };
  assert.throws(() => commitPreparedLegacyDungeonSettlement({
    runtime, runId: run.runId, runs: {}, players, encounter, now: 150, outbox: {},
  }), /reload player, run and outbox snapshots/);
});
