import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';

function readJson(file: string) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

test('crash recovery replays the consumed scroll and revived dungeon state from one WAL entry', () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-revive-wal-'));
  const files = {
    players: join(dataDir, 'players.json'),
    dungeonRuns: join(dataDir, 'dungeon_runs.json'),
  };
  try {
    const transactionModule = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
    const revivalModule = new URL('../src/dungeonRevivalTransaction.ts', import.meta.url).href;
    const runModule = new URL('../src/dungeonRunState.ts', import.meta.url).href;
    const scrollModule = new URL('../src/resurrectionScrolls.ts', import.meta.url).href;
    const childScript = `
      import { createSharedStateTransactionStore } from ${JSON.stringify(transactionModule)};
      import { prepareDungeonRevival } from ${JSON.stringify(revivalModule)};
      import { createDungeonRunRecord, markDungeonParticipantDead } from ${JSON.stringify(runModule)};
      import { RESURRECTION_SCROLL_ID } from ${JSON.stringify(scrollModule)};
      const dataDir = ${JSON.stringify(dataDir)};
      const files = ${JSON.stringify(files)};
      const store = createSharedStateTransactionStore({
        dataDir, files,
        testHooks: { afterTargetWrite(key) { if (key === 'players') process.exit(73); } },
      });
      const run = markDungeonParticipantDead(createDungeonRunRecord({
        runId: 'run_wal', requestId: 'request_wal_01', dungeonId: 'dungeon_20',
        groupId: 'group_1', leaderId: 'p1',
        participants: [
          { playerId: 'p1', health: 100, maxHealth: 100 },
          { playerId: 'p2', health: 80, maxHealth: 100 },
        ],
        bossId: 'boss_20', bossHealth: 500, seed: 'seed_wal', now: 100,
      }), 'p2', 150);
      const players = {
        p1: { id: 'p1', inventory: JSON.stringify([RESURRECTION_SCROLL_ID, RESURRECTION_SCROLL_ID]) },
        p2: { id: 'p2', inventory: JSON.stringify([]) },
      };
      const prepared = prepareDungeonRevival({
        run, players, rescuerId: 'p1', targetId: 'p2', reviveHealth: 25, now: 200,
      });
      store.transact(() => ({
        files: { players: prepared.players, dungeonRuns: { [prepared.run.runId]: prepared.run } },
        result: null,
      }));
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.status, 73, child.stderr || child.stdout);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), true);

    const restarted = createSharedStateTransactionStore({ dataDir, files });
    assert.equal(restarted.recover(), true);
    const players = readJson(files.players);
    const runs = readJson(files.dungeonRuns);
    assert.equal(JSON.parse(players.p1.inventory).filter((id: string) => id === 'resurrection_scroll').length, 1);
    assert.equal(runs.run_wal.participants.p2.status, 'revived');
    assert.equal(runs.run_wal.participants.p2.health, 25);
    assert.equal(existsSync(join(dataDir, 'shared_state_transaction.json')), false);
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
