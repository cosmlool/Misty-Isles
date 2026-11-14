import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function runCrashChild(script: string, expectedStatus: number) {
  const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
  });
  assert.equal(child.status, expectedStatus, child.stderr || child.stdout);
}

const boundaries = [
  { name: 'after journal persistence', hook: 'journal', status: 91 },
  { name: 'after players target write', hook: 'players', status: 92 },
  { name: 'after dungeonRuns target write', hook: 'dungeonRuns', status: 92 },
] as const;

test('dungeon start WAL crash matrix recovers either the complete attempt charge and active run', async () => {
  for (const boundary of boundaries) {
    const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-start-matrix-'));
    const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
    try {
      const transactionModule = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
      const runtimeModule = new URL('../src/sharedStateRuntime.ts', import.meta.url).href;
      const stateModule = new URL('../src/dungeonRunState.ts', import.meta.url).href;
      const startModule = new URL('../src/dungeonRunStartRuntime.ts', import.meta.url).href;
      const childScript = `
        import { createSharedStateTransactionStore } from ${JSON.stringify(transactionModule)};
        import { createSharedStateRuntime } from ${JSON.stringify(runtimeModule)};
        import { createDungeonRunRecord } from ${JSON.stringify(stateModule)};
        import { commitDungeonRunStart } from ${JSON.stringify(startModule)};
        const dataDir = ${JSON.stringify(dataDir)};
        const files = ${JSON.stringify(files)};
        const boundary = ${JSON.stringify(boundary.hook)};
        const store = createSharedStateTransactionStore({
          dataDir, files,
          testHooks: {
            afterJournalPersisted() { if (boundary === 'journal') process.exit(91); },
            afterTargetWrite(key) { if (boundary === key) process.exit(92); },
          },
        });
        const runtime = createSharedStateRuntime({ shared: store, auction: { recover: () => false }, clans: { recover: () => false } });
        const run = createDungeonRunRecord({
          runId: 'run_crash_matrix', requestId: 'req_crash_matrix', dungeonId: 'dungeon_1',
          groupId: 'group_1', leaderId: 'p1',
          participants: [{ playerId: 'p1', health: 100, maxHealth: 100 }, { playerId: 'p2', health: 90, maxHealth: 100 }],
          bossId: 'boss_1', bossHealth: 500, seed: 'seed_1', now: 100,
        });
        const players = {
          p1: { id: 'p1', quests: JSON.stringify({ dungeonDay: '2026-11-14', dungeonRuns: 1 }), battles: 4 },
          p2: { id: 'p2', quests: JSON.stringify({ dungeonDay: '2026-11-14', dungeonRuns: 2 }), battles: 8 },
        };
        commitDungeonRunStart({ runtime, run, players, runs: {}, day: '2026-11-14' });
        process.exit(0);
      `;
      runCrashChild(childScript, boundary.status);
      assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), true, boundary.name);
      const { createSharedStateTransactionStore } = await import('../src/sharedStateTransactions.js');
      const restarted = createSharedStateTransactionStore({ dataDir, files });
      assert.equal(restarted.recover(), true, boundary.name);
      const recoveredPlayers = readJson(files.players);
      const recoveredRuns = readJson(files.dungeonRuns);
      assert.equal(JSON.parse(recoveredPlayers.p1.quests).dungeonRuns, 2, boundary.name);
      assert.equal(JSON.parse(recoveredPlayers.p2.quests).dungeonRuns, 3, boundary.name);
      assert.equal(recoveredPlayers.p1.battles, 5, boundary.name);
      assert.equal(recoveredPlayers.p2.battles, 9, boundary.name);
      assert.equal(recoveredRuns.run_crash_matrix.status, 'active', boundary.name);
      assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), false, boundary.name);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});

test('prepared encounter WAL crash matrix restores the exact immutable encounter snapshot', async () => {
  for (const boundary of boundaries) {
    const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-prepare-matrix-'));
    const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
    try {
      const transactionModule = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
      const runtimeModule = new URL('../src/sharedStateRuntime.ts', import.meta.url).href;
      const stateModule = new URL('../src/dungeonRunState.ts', import.meta.url).href;
      const preparationModule = new URL('../src/dungeonEncounterPreparation.ts', import.meta.url).href;
      const commitModule = new URL('../src/dungeonEncounterCommitRuntime.ts', import.meta.url).href;
      const childScript = `
        import { createSharedStateTransactionStore } from ${JSON.stringify(transactionModule)};
        import { createSharedStateRuntime } from ${JSON.stringify(runtimeModule)};
        import { createDungeonRunRecord } from ${JSON.stringify(stateModule)};
        import { createPreparedDungeonEncounter } from ${JSON.stringify(preparationModule)};
        import { commitPreparedDungeonEncounter } from ${JSON.stringify(commitModule)};
        const dataDir = ${JSON.stringify(dataDir)};
        const files = ${JSON.stringify(files)};
        const baseStore = createSharedStateTransactionStore({ dataDir, files });
        const base = createDungeonRunRecord({
          runId: 'run_prepare_matrix', requestId: 'req_prepare_matrix', dungeonId: 'dungeon_1',
          groupId: 'group_1', leaderId: 'p1',
          participants: [{ playerId: 'p1', health: 100, maxHealth: 100 }, { playerId: 'p2', health: 90, maxHealth: 100 }],
          bossId: 'boss_1', bossHealth: 500, seed: 'seed_1', now: 100,
        });
        const players = { p1: { id: 'p1', health: 100 }, p2: { id: 'p2', health: 90 } };
        baseStore.transact(() => ({ files: { players, dungeonRuns: { [base.runId]: base } }, result: null }));
        const boundary = ${JSON.stringify(boundary.hook)};
        const store = createSharedStateTransactionStore({
          dataDir, files,
          testHooks: {
            afterJournalPersisted() { if (boundary === 'journal') process.exit(91); },
            afterTargetWrite(key) { if (boundary === key) process.exit(92); },
          },
        });
        const runtime = createSharedStateRuntime({ shared: store, auction: { recover: () => false }, clans: { recover: () => false } });
        const encounter = createPreparedDungeonEncounter({
          version: 1, runId: base.runId, requestId: base.requestId, dungeonId: base.dungeonId,
          bossId: base.encounter.bossId, preparedAt: 150, participantIds: ['p1', 'p2'],
          combat: { rounds: 2, incoming: [10, 20], win: true, damageByParticipant: [50, 40] },
          drops: [{ itemId: 'trophy_1', recipientId: 'p2' }],
          participants: {
            p1: { playerId: 'p1', hpBefore: 100, hpAfter: 95, incomingDamage: 10, outgoingDamage: 50, xp: 100, gold: 20, lootIds: [], report: { rounds: 2 }, resultText: 'Victory' },
            p2: { playerId: 'p2', hpBefore: 90, hpAfter: 80, incomingDamage: 20, outgoingDamage: 40, xp: 100, gold: 20, lootIds: ['trophy_1'], report: { rounds: 2 }, resultText: 'Victory' },
          },
          playerSnapshots: { p1: { id: 'p1', health: 95 }, p2: { id: 'p2', health: 80 } },
        });
        commitPreparedDungeonEncounter({ runtime, runId: base.runId, runs: { [base.runId]: base }, players, encounter });
        process.exit(0);
      `;
      runCrashChild(childScript, boundary.status);
      assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), true, boundary.name);
      const { createSharedStateTransactionStore } = await import('../src/sharedStateTransactions.js');
      const restarted = createSharedStateTransactionStore({ dataDir, files });
      assert.equal(restarted.recover(), true, boundary.name);
      const recoveredRun = readJson(files.dungeonRuns).run_prepare_matrix;
      assert.equal(recoveredRun.status, 'active', boundary.name);
      assert.equal(recoveredRun.preparedEncounter.runId, 'run_prepare_matrix', boundary.name);
      assert.equal(recoveredRun.preparedEncounter.preparedAt, 150, boundary.name);
      assert.equal(recoveredRun.preparedEncounter.participants.p1.gold, 20, boundary.name);
      assert.deepEqual(recoveredRun.preparedEncounter.drops, [{ itemId: 'trophy_1', recipientId: 'p2' }], boundary.name);
      assert.deepEqual(readJson(files.players), { p1: { id: 'p1', health: 100 }, p2: { id: 'p2', health: 90 } }, boundary.name);
      assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), false, boundary.name);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});
