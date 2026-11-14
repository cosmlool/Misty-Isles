import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';
import test from 'node:test';
import { createPreparedDungeonEncounter, validatePreparedDungeonEncounter } from '../src/dungeonEncounterPreparation.js';
import { commitPreparedDungeonEncounter, prepareDungeonEncounterCommit } from '../src/dungeonEncounterCommitRuntime.js';
import { createDungeonRunRecord, validateDungeonRunStore } from '../src/dungeonRunState.js';

function runStore() {
  const run = createDungeonRunRecord({
    runId: 'run_1', requestId: 'req_1', dungeonId: 'dungeon_1', groupId: 'group_1',
    leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 100 },
      { playerId: 'p2', health: 90, maxHealth: 100 },
    ],
    bossId: 'boss_1', bossHealth: 500, seed: 'seed_1', now: 100,
  });
  return { run_1: run };
}

function encounter() {
  return createPreparedDungeonEncounter({
    version: 1, runId: 'run_1', requestId: 'req_1', dungeonId: 'dungeon_1',
    bossId: 'boss_1', preparedAt: 150, participantIds: ['p1', 'p2'],
    combat: { rounds: 2, incoming: [10, 20], win: true, damageByParticipant: [50, 40] },
    drops: [{ itemId: 'trophy_1', recipientId: 'p2' }],
    participants: {
      p1: { playerId: 'p1', hpBefore: 100, hpAfter: 95, incomingDamage: 10, outgoingDamage: 50,
        xp: 100, gold: 20, lootIds: [], report: { rounds: 2 }, resultText: 'Victory' },
      p2: { playerId: 'p2', hpBefore: 90, hpAfter: 80, incomingDamage: 20, outgoingDamage: 40,
        xp: 100, gold: 20, lootIds: ['trophy_1'], report: { rounds: 2 }, resultText: 'Victory' },
    },
    playerSnapshots: { p1: { id: 'p1', health: 95 }, p2: { id: 'p2', health: 80 } },
  });
}

test('prepared encounter is attached to the matching durable run and survives JSON restore', () => {
  const prepared = prepareDungeonEncounterCommit({ runId: 'run_1', runs: runStore(), encounter: encounter() });
  assert.equal(prepared.alreadyPrepared, false);
  const restored = validateDungeonRunStore(JSON.parse(JSON.stringify(prepared.runs)));
  assert.deepEqual(validatePreparedDungeonEncounter(restored.run_1.preparedEncounter), encounter());
});

test('same prepared encounter retry is idempotent; conflicting retry is rejected', () => {
  const first = prepareDungeonEncounterCommit({ runId: 'run_1', runs: runStore(), encounter: encounter() });
  const retry = prepareDungeonEncounterCommit({ runId: 'run_1', runs: first.runs, encounter: encounter() });
  assert.equal(retry.alreadyPrepared, true);
  const changed = JSON.parse(JSON.stringify(encounter()));
  changed.participants.p1.gold = 21;
  assert.throws(() => prepareDungeonEncounterCommit({
    runId: 'run_1', runs: first.runs, encounter: createPreparedDungeonEncounter(changed),
  }), /different prepared encounter/);
});

test('prepared encounter cannot be attached to another run, roster, boss, or terminal run', () => {
  const wrongRun = { ...runStore(), run_2: { ...runStore().run_1, runId: 'run_2' } };
  assert.throws(() => prepareDungeonEncounterCommit({
    runId: 'run_2', runs: wrongRun, encounter: encounter(),
  }), /identity does not match/);
  const terminal = { run_1: { ...runStore().run_1, status: 'completed' as const,
    terminalResult: { outcome: 'win' as const, committedAt: 120, requestId: 'req_1' } } };
  assert.throws(() => prepareDungeonEncounterCommit({
    runId: 'run_1', runs: terminal, encounter: encounter(),
  }), /terminal dungeon run/);
});

test('WAL recovery requires reloading snapshots and does not write stale encounter data', () => {
  let writes = 0;
  const runtime = { transact<T>(prepare: (recovered: boolean) => {
    files: { players: Record<string, Record<string, unknown>>; dungeonRuns: ReturnType<typeof runStore> };
    result: T; skipWrite?: boolean;
  }): T {
    const plan = prepare(true);
    if (!plan.skipWrite) writes++;
    return plan.result;
  }};
  assert.throws(() => commitPreparedDungeonEncounter({
    runtime, runId: 'run_1', runs: runStore(), players: { p1: { health: 100 }, p2: { health: 90 } },
    encounter: encounter(),
  }), /recovered during encounter preparation/);
  assert.equal(writes, 0);
});


test('prepared encounter commit recovers the immutable snapshot across WAL crash boundaries', () => {
  const boundaries = [
    { name: 'after journal persistence', hook: 'journal', status: 91 },
    { name: 'after players target write', hook: 'players', status: 92 },
    { name: 'after dungeonRuns target write', hook: 'dungeonRuns', status: 92 },
  ] as const;
  for (const boundary of boundaries) {
    const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-encounter-wal-'));
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
          runId: 'run_encounter_wal', requestId: 'request_encounter_wal', dungeonId: 'dungeon_20',
          groupId: 'group_1', leaderId: 'p1',
          participants: [
            { playerId: 'p1', health: 100, maxHealth: 100 },
            { playerId: 'p2', health: 90, maxHealth: 100 },
          ],
          bossId: 'boss_20', bossHealth: 500, seed: 'seed_encounter_wal', now: 100,
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
        const runtime = createSharedStateRuntime({
          shared: store, auction: { recover: () => false }, clans: { recover: () => false },
        });
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
      const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
        cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
      });
      assert.equal(child.status, boundary.status, child.stderr || child.stdout);
      assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), true, boundary.name);
      const restarted = createSharedStateTransactionStore({ dataDir, files });
      assert.equal(restarted.recover(), true, boundary.name);
      const recoveredRun = JSON.parse(readFileSync(files.dungeonRuns, 'utf8')).run_encounter_wal;
      assert.equal(recoveredRun.status, 'active', boundary.name);
      assert.equal(recoveredRun.preparedEncounter.runId, 'run_encounter_wal', boundary.name);
      assert.equal(recoveredRun.preparedEncounter.preparedAt, 150, boundary.name);
      assert.equal(recoveredRun.preparedEncounter.participants.p1.gold, 20, boundary.name);
      assert.deepEqual(recoveredRun.preparedEncounter.drops, [{ itemId: 'trophy_1', recipientId: 'p2' }], boundary.name);
      assert.deepEqual(JSON.parse(readFileSync(files.players, 'utf8')), {
        p1: { id: 'p1', health: 100 }, p2: { id: 'p2', health: 90 },
      }, boundary.name);
      assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), false, boundary.name);
    } finally {
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});
