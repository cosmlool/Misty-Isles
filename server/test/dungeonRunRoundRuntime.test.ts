import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';
import { createSharedStateRuntime } from '../src/sharedStateRuntime.js';
import { createDungeonRunRecord, createDungeonRoundPlan } from '../src/dungeonRunState.js';
import { commitDungeonRunRound } from '../src/dungeonRunRoundRuntime.js';

function readJson(file: string) { return JSON.parse(readFileSync(file, 'utf8')); }
function createRun() {
  const base = createDungeonRunRecord({
    runId: 'run_round_wal', requestId: 'request_round_wal', dungeonId: 'dungeon_20',
    groupId: 'group_1', leaderId: 'p1',
    participants: [
      { playerId: 'p1', health: 100, maxHealth: 100 },
      { playerId: 'p2', health: 80, maxHealth: 100 },
    ],
    bossId: 'boss_20', bossHealth: 500, seed: 'seed_round_wal', now: 100,
  });
  return {
    ...base,
    roundPlan: createDungeonRoundPlan({
      totalRounds: 2,
      totalBossDamage: 200,
      totalIncomingDamageByParticipant: { p1: 40, p2: 20 },
    }),
  };
}
function playerSnapshots(run = createRun()) { return Object.fromEntries(run.participantIds.map(id => [id, { id, health: run.participants[id].health, maxHealth: run.participants[id].maxHealth }])); }
function runtimeFor(store: ReturnType<typeof createSharedStateTransactionStore>) {
  return createSharedStateRuntime({
    shared: store,
    auction: { recover: () => false },
    clans: { recover: () => false },
  });
}

test('one dungeon round is committed atomically and stale retry cannot apply damage twice', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-round-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const store = createSharedStateTransactionStore({ dataDir, files });
    const runtime = runtimeFor(store);
    const first = commitDungeonRunRound({
      runtime, runId: 'run_round_wal', expectedRoundIndex: 0,
      runs: { run_round_wal: createRun() }, players: playerSnapshots(), now: 200,
    });
    assert.equal(first.run.roundIndex, 1);
    assert.equal(first.run.roundPlan?.nextRoundIndex, 1);
    assert.equal(first.run.encounter.bossHealth, 400);
    assert.equal(first.run.participants.p1.health, 80);
    assert.equal(first.run.participants.p2.health, 70);
    assert.equal(readJson(files.dungeonRuns).run_round_wal.roundIndex, 1);
    assert.equal(readJson(files.players).p1.health, 80);
    assert.throws(() => commitDungeonRunRound({
      runtime, runId: 'run_round_wal', expectedRoundIndex: 0,
      runs: { run_round_wal: first.run }, players: first.players, now: 300,
    }), /stale/);
    assert.equal(readJson(files.dungeonRuns).run_round_wal.roundIndex, 1);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('round slices preserve the legacy minimum-one-HP loss outcome instead of creating a spectator', () => {
  const base = createRun();
  const lowHealthRun = {
    ...base,
    participants: {
      ...base.participants,
      p1: { ...base.participants.p1, health: 10 },
    },
    roundPlan: createDungeonRoundPlan({
      totalRounds: 2,
      totalBossDamage: 200,
      totalIncomingDamageByParticipant: { p1: 20, p2: 0 },
    }),
  };
  const storeDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-round-floor-'));
  const files = { players: join(storeDir, 'players.json'), dungeonRuns: join(storeDir, 'dungeon_runs.json') };
  try {
    const runtime = runtimeFor(createSharedStateTransactionStore({ dataDir: storeDir, files }));
    const first = commitDungeonRunRound({
      runtime, runId: lowHealthRun.runId, expectedRoundIndex: 0,
      runs: { [lowHealthRun.runId]: lowHealthRun }, players: playerSnapshots(lowHealthRun), now: 200,
    });
    assert.equal(first.run.participants.p1.health, 1);
    assert.equal(first.run.participants.p1.status, 'alive');
    const second = commitDungeonRunRound({
      runtime, runId: lowHealthRun.runId, expectedRoundIndex: 1,
      runs: { [lowHealthRun.runId]: first.run }, players: first.players, now: 300,
    });
    assert.equal(second.run.participants.p1.health, 1);
    assert.equal(second.run.participants.p1.status, 'alive');
  } finally {
    rmSync(storeDir, { recursive: true, force: true });
  }
});

test('a round journal recovers the whole committed round after process interruption', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-round-crash-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const transactionModule = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
    const runtimeModule = new URL('../src/sharedStateRuntime.ts', import.meta.url).href;
    const stateModule = new URL('../src/dungeonRunState.ts', import.meta.url).href;
    const roundModule = new URL('../src/dungeonRunRoundRuntime.ts', import.meta.url).href;
    const childScript = `
      import { createSharedStateTransactionStore } from ${JSON.stringify(transactionModule)};
      import { createSharedStateRuntime } from ${JSON.stringify(runtimeModule)};
      import { createDungeonRunRecord, createDungeonRoundPlan } from ${JSON.stringify(stateModule)};
      import { commitDungeonRunRound } from ${JSON.stringify(roundModule)};
      const dataDir = ${JSON.stringify(dataDir)};
      const files = ${JSON.stringify(files)};
      const base = createDungeonRunRecord({
        runId: 'run_round_wal', requestId: 'request_round_wal', dungeonId: 'dungeon_20',
        groupId: 'group_1', leaderId: 'p1',
        participants: [
          { playerId: 'p1', health: 100, maxHealth: 100 },
          { playerId: 'p2', health: 80, maxHealth: 100 },
        ],
        bossId: 'boss_20', bossHealth: 500, seed: 'seed_round_wal', now: 100,
      });
      const run = { ...base, roundPlan: createDungeonRoundPlan({
        totalRounds: 2, totalBossDamage: 200, totalIncomingDamageByParticipant: { p1: 40, p2: 20 },
      }) };
      const playerSnapshots = Object.fromEntries(run.participantIds.map(id => [id, { id, health: run.participants[id].health, maxHealth: run.participants[id].maxHealth }]));
      const store = createSharedStateTransactionStore({
        dataDir, files,
        testHooks: { afterTargetWrite(key) { if (key === 'dungeonRuns') process.exit(74); } },
      });
      const runtime = createSharedStateRuntime({
        shared: store, auction: { recover: () => false }, clans: { recover: () => false },
      });
      commitDungeonRunRound({ runtime, runId: run.runId, expectedRoundIndex: 0, runs: { [run.runId]: run }, players: playerSnapshots, now: 200 });
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.status, 74, child.stderr || child.stdout);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), true);
    const restarted = createSharedStateTransactionStore({ dataDir, files });
    assert.equal(restarted.recover(), true);
    const recovered = readJson(files.dungeonRuns).run_round_wal;
    assert.equal(recovered.roundIndex, 1);
    assert.equal(recovered.roundPlan.nextRoundIndex, 1);
    assert.equal(recovered.encounter.bossHealth, 400);
    assert.equal(recovered.participants.p1.health, 80);
    assert.equal(readJson(files.players).p1.health, 80);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test('round commit fails closed when shared-state recovery occurred before preparation', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-round-recovery-'));
  const files = { players: join(dataDir, 'players.json'), dungeonRuns: join(dataDir, 'dungeon_runs.json') };
  try {
    const store = createSharedStateTransactionStore({ dataDir, files });
    store.transact(() => ({ files: { players: {}, dungeonRuns: {} }, result: null }));
    writeFileSync(store.journalFile, JSON.stringify({
      version: 1,
      files: { players: {}, dungeonRuns: {} },
    }));
    const runtime = runtimeFor(createSharedStateTransactionStore({ dataDir, files }));
    assert.throws(() => commitDungeonRunRound({
      runtime, runId: 'run_round_wal', expectedRoundIndex: 0,
      runs: { run_round_wal: createRun() }, players: playerSnapshots(), now: 200,
    }), /reload player and dungeon run/);
    assert.deepEqual(readJson(files.dungeonRuns), {});
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
