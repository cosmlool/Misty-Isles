import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';
import { createDungeonRunRecord } from '../src/dungeonRunState.js';
import { commitDungeonRunStart } from '../src/dungeonRunStartRuntime.js';

function readJson(file: string) { return JSON.parse(readFileSync(file, 'utf8')); }
function createRun() {
  return createDungeonRunRecord({
    runId: 'run_start_wal', requestId: 'request_start_wal', dungeonId: 'dungeon_20',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 100 },
      { playerId: 'p2', health: 80, maxHealth: 100 },
    ],
    bossId: 'boss_20', bossHealth: 500, seed: 'seed_start_wal', now: 100,
  });
}
function createPlayers() {
  return {
    p1: { id: 'p1', quests: JSON.stringify({ dungeonDay: '2026-11-12', dungeonRuns: 1 }), battles: 3 },
    p2: { id: 'p2', quests: JSON.stringify({ dungeonDay: '2026-11-12', dungeonRuns: 2 }), battles: 7 },
  };
}
function runtimeFor(store: ReturnType<typeof createSharedStateTransactionStore>) {
  return createSharedStateRuntime({
    shared: store,
    auction: { recover: () => false },
    clans: { recover: () => false },
  });
}

test('dungeon entry persists attempt charges and active run in one recoverable WAL transaction', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-start-wal-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const transactionModule = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
    const runtimeModule = new URL('../src/sharedStateRuntime.ts', import.meta.url).href;
    const startStateModule = new URL('../src/dungeonRunState.ts', import.meta.url).href;
    const startRuntimeModule = new URL('../src/dungeonRunStartRuntime.ts', import.meta.url).href;
    const childScript = `
      import { createSharedStateTransactionStore } from ${JSON.stringify(transactionModule)};
      import { createSharedStateRuntime } from ${JSON.stringify(runtimeModule)};
      import { createDungeonRunRecord } from ${JSON.stringify(startStateModule)};
      import { commitDungeonRunStart } from ${JSON.stringify(startRuntimeModule)};
      const dataDir = ${JSON.stringify(dataDir)};
      const files = ${JSON.stringify(files)};
      const store = createSharedStateTransactionStore({
        dataDir, files,
        testHooks: { afterTargetWrite(key) { if (key === 'players') process.exit(73); } },
      });
      const runtime = createSharedStateRuntime({
        shared: store, auction: { recover: () => false }, clans: { recover: () => false },
      });
      const run = createDungeonRunRecord({
        runId: 'run_start_wal', requestId: 'request_start_wal', dungeonId: 'dungeon_20',
        groupId: 'group_1', leaderId: 'p1',
        participants: [
          { playerId: 'p1', health: 100, maxHealth: 100 },
          { playerId: 'p2', health: 80, maxHealth: 100 },
        ],
        bossId: 'boss_20', bossHealth: 500, seed: 'seed_start_wal', now: 100,
      });
      const players = {
        p1: { id: 'p1', quests: JSON.stringify({ dungeonDay: '2026-11-12', dungeonRuns: 1 }), battles: 3 },
        p2: { id: 'p2', quests: JSON.stringify({ dungeonDay: '2026-11-12', dungeonRuns: 2 }), battles: 7 },
      };
      commitDungeonRunStart({ runtime, run, players, runs: {}, day: '2026-11-12' });
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.status, 73, child.stderr || child.stdout);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), true);
    assert.equal(existsSync(files.dungeonRuns), false);

    const restarted = createSharedStateTransactionStore({ dataDir, files });
    assert.equal(restarted.recover(), true);
    const savedPlayers = readJson(files.players);
    const savedRuns = readJson(files.dungeonRuns);
    assert.equal(JSON.parse(savedPlayers.p1.quests).dungeonRuns, 2);
    assert.equal(JSON.parse(savedPlayers.p2.quests).dungeonRuns, 3);
    assert.equal(savedPlayers.p1.battles, 4);
    assert.equal(savedPlayers.p2.battles, 8);
    assert.equal(savedRuns.run_start_wal.status, 'active');
    assert.deepEqual(savedRuns.run_start_wal.participantIds, ['p1', 'p2']);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('dungeon entry refuses to overwrite snapshots when startup recovery occurred', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-start-recovery-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const store = createSharedStateTransactionStore({ dataDir, files });
    store.transact(() => ({
      files: { players: { p1: { id: 'p1', quests: '{}', battles: 0 } } },
      result: null,
    }));
    writeFileSync(store.journalFile, JSON.stringify({
      version: 1,
      files: {
        players: { p1: { id: 'p1', quests: JSON.stringify({ dungeonDay: '2026-11-12', dungeonRuns: 1 }), battles: 1 } },
        dungeonRuns: {},
      },
    }));
    const restartedStore = createSharedStateTransactionStore({ dataDir, files });
    const runtime = runtimeFor(restartedStore);
    assert.throws(() => commitDungeonRunStart({
      runtime, run: createRun(), players: createPlayers(), runs: {}, day: '2026-11-12',
    }), /reload player and run snapshots/);
    assert.equal(readJson(files.players).p1.battles, 1);
    assert.equal(readJson(files.players).p1.quests.includes('"dungeonRuns":1'), true);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
