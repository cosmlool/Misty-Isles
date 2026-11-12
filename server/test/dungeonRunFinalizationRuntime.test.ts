import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';
import { createDungeonRunRecord, createDungeonRoundPlan, type DungeonRunRecord } from '../src/dungeonRunState.js';
import { commitDungeonRunFinalization } from '../src/dungeonRunFinalizationRuntime.js';

function readJson(file: string) { return JSON.parse(readFileSync(file, 'utf8')); }
function createRun(): DungeonRunRecord {
  const base = createDungeonRunRecord({
    runId: 'run_finalize_wal', requestId: 'request_finalize_wal', dungeonId: 'dungeon_20',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 80, maxHealth: 100 },
      { playerId: 'p2', health: 60, maxHealth: 100 },
    ],
    bossId: 'boss_20', bossHealth: 500, seed: 'seed_finalize_wal', now: 100,
  });
  return {
    ...base,
    roundIndex: 2,
    updatedAt: 200,
    roundPlan: createDungeonRoundPlan({
      totalRounds: 2,
      totalBossDamage: 500,
      totalIncomingDamageByParticipant: { p1: 20, p2: 30 },
    }),
  };
}
function players() {
  return {
    p1: { id: 'p1', health: 80, gold: 100, inventory: '[]', quests: '{}' },
    p2: { id: 'p2', health: 60, gold: 200, inventory: '[]', quests: '{}' },
  };
}
function runtimeFor(store: ReturnType<typeof createSharedStateTransactionStore>) {
  return createSharedStateRuntime({
    shared: store,
    auction: { recover: () => false },
    clans: { recover: () => false },
  });
}

test('finalization commits terminal result and every post-reward player snapshot atomically', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-finalize-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const run = createRun();
    const nextPlayers = players();
    nextPlayers.p1.gold += 500;
    nextPlayers.p1.inventory = JSON.stringify(['dungeon_resource']);
    nextPlayers.p2.gold += 250;
    const runtime = runtimeFor(createSharedStateTransactionStore({ dataDir, files }));
    const result = commitDungeonRunFinalization({
      runtime, runId: run.runId, expectedRoundIndex: 2, expectedUpdatedAt: 200,
      outcome: 'win', players: nextPlayers, runs: { [run.runId]: run }, now: 300,
    });
    assert.equal(result.alreadyFinalized, false);
    assert.equal(result.run.status, 'completed');
    assert.equal(result.run.terminalResult?.outcome, 'win');
    assert.equal(result.claimId, 'dungeon:run_finalize_wal:request_finalize_wal:win');
    assert.equal(readJson(files.dungeonRuns)[run.runId].status, 'completed');
    assert.equal(readJson(files.players).p1.gold, 600);
    assert.deepEqual(readJson(files.players).p1.inventory, ['dungeon_resource']);
    assert.equal(readJson(files.players).p2.gold, 450);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('duplicate finalization is a no-op and cannot apply a second reward payload', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-finalize-retry-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const run = createRun();
    const runtime = runtimeFor(createSharedStateTransactionStore({ dataDir, files }));
    const firstPlayers = players();
    firstPlayers.p1.gold += 100;
    const first = commitDungeonRunFinalization({
      runtime, runId: run.runId, expectedRoundIndex: 2, expectedUpdatedAt: 200,
      outcome: 'win', players: firstPlayers, runs: { [run.runId]: run }, now: 300,
    });
    const retryPlayers = players();
    retryPlayers.p1.gold += 999999;
    const retry = commitDungeonRunFinalization({
      runtime, runId: run.runId, expectedRoundIndex: 2, expectedUpdatedAt: 200,
      outcome: 'win', players: retryPlayers, runs: { [run.runId]: first.run }, now: 400,
    });
    assert.equal(retry.alreadyFinalized, true);
    assert.equal(readJson(files.players).p1.gold, 200);
    assert.equal(readJson(files.dungeonRuns)[run.runId].terminalResult.claimId, first.claimId);
    assert.throws(() => commitDungeonRunFinalization({
      runtime, runId: run.runId, expectedRoundIndex: 2, expectedUpdatedAt: 200,
      outcome: 'loss', players: retryPlayers, runs: { [run.runId]: first.run }, now: 500,
    }), /different outcome/);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('finalization rejects stale run snapshots and unresolved planned rounds', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-finalize-stale-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const run = createRun();
    const runtime = runtimeFor(createSharedStateTransactionStore({ dataDir, files }));
    assert.throws(() => commitDungeonRunFinalization({
      runtime, runId: run.runId, expectedRoundIndex: 1, expectedUpdatedAt: 200,
      outcome: 'win', players: players(), runs: { [run.runId]: run }, now: 300,
    }), /stale/);
    const unfinished = { ...run, roundPlan: { ...run.roundPlan!, nextRoundIndex: 1 } };
    assert.throws(() => commitDungeonRunFinalization({
      runtime, runId: run.runId, expectedRoundIndex: 2, expectedUpdatedAt: 200,
      outcome: 'win', players: players(), runs: { [run.runId]: unfinished }, now: 300,
    }), /unresolved/);
    assert.deepEqual(readJson(files.dungeonRuns), {});
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('a finalization journal recovers terminal state and all player rewards after interruption', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-finalize-crash-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const transactionModule = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
    const runtimeModule = new URL('../src/sharedStateRuntime.ts', import.meta.url).href;
    const stateModule = new URL('../src/dungeonRunState.ts', import.meta.url).href;
    const finalizationModule = new URL('../src/dungeonRunFinalizationRuntime.ts', import.meta.url).href;
    const childScript = `
      import { createSharedStateTransactionStore } from ${JSON.stringify(transactionModule)};
      import { createSharedStateRuntime } from ${JSON.stringify(runtimeModule)};
      import { createDungeonRunRecord, createDungeonRoundPlan } from ${JSON.stringify(stateModule)};
      import { commitDungeonRunFinalization } from ${JSON.stringify(finalizationModule)};
      const dataDir = ${JSON.stringify(dataDir)};
      const files = ${JSON.stringify(files)};
      const base = createDungeonRunRecord({
        runId: 'run_finalize_wal', requestId: 'request_finalize_wal', dungeonId: 'dungeon_20',
        groupId: 'group_1', leaderId: 'p1',
        participants: [
          { playerId: 'p1', health: 80, maxHealth: 100 },
          { playerId: 'p2', health: 60, maxHealth: 100 },
        ],
        bossId: 'boss_20', bossHealth: 500, seed: 'seed_finalize_wal', now: 100,
      });
      const run = { ...base, roundIndex: 2, updatedAt: 200, roundPlan: createDungeonRoundPlan({
        totalRounds: 2, totalBossDamage: 500, totalIncomingDamageByParticipant: { p1: 20, p2: 30 },
      }) };
      const players = {
        p1: { id: 'p1', health: 80, gold: 600, inventory: '["dungeon_resource"]', quests: '{}' },
        p2: { id: 'p2', health: 60, gold: 450, inventory: '[]', quests: '{}' },
      };
      const store = createSharedStateTransactionStore({
        dataDir, files,
        testHooks: { afterTargetWrite(key) { if (key === 'players') process.exit(75); } },
      });
      const runtime = createSharedStateRuntime({
        shared: store, auction: { recover: () => false }, clans: { recover: () => false },
      });
      commitDungeonRunFinalization({
        runtime, runId: run.runId, expectedRoundIndex: 2, expectedUpdatedAt: 200,
        outcome: 'win', players, runs: { [run.runId]: run }, now: 300,
      });
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.status, 75, child.stderr || child.stdout);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), true);
    const restarted = createSharedStateTransactionStore({ dataDir, files });
    assert.equal(restarted.recover(), true);
    const recoveredRun = readJson(files.dungeonRuns).run_finalize_wal;
    assert.equal(recoveredRun.status, 'completed');
    assert.equal(recoveredRun.terminalResult.outcome, 'win');
    assert.equal(readJson(files.players).p1.gold, 600);
    assert.deepEqual(readJson(files.players).p1.inventory, ['dungeon_resource']);
    assert.equal(readJson(files.players).p2.gold, 450);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('finalization fails closed when shared-state recovery occurred before preparation', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-finalize-recovery-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const store = createSharedStateTransactionStore({ dataDir, files });
    store.transact(() => ({ files: { players: {}, dungeonRuns: {} }, result: null }));
    writeFileSync(store.journalFile, JSON.stringify({ version: 1, files: { players: {}, dungeonRuns: {} } }));
    const runtime = runtimeFor(createSharedStateTransactionStore({ dataDir, files }));
    const run = createRun();
    assert.throws(() => commitDungeonRunFinalization({
      runtime, runId: run.runId, expectedRoundIndex: 2, expectedUpdatedAt: 200,
      outcome: 'win', players: players(), runs: { [run.runId]: run }, now: 300,
    }), /reload player and dungeon run/);
    assert.deepEqual(readJson(files.dungeonRuns), {});
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
