import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { dispatchPendingDungeonResultEvents, enqueueDungeonResultEvents } from '../src/dungeonResultOutboxDelivery.js';
import { createSharedStateTransactionStore } from '../src/sharedStateTransactions.js';

function fixture() {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-outbox-'));
  const files = {
    players: join(dataDir, 'players.json'),
    dungeonOutbox: join(dataDir, 'dungeon_outbox.json'),
  };
  return {
    dataDir,
    files,
    createStore: () => createSharedStateTransactionStore({ dataDir, files }),
    cleanup: () => rmSync(dataDir, { recursive: true, force: true }),
  };
}
function readJson(file: string) { return JSON.parse(readFileSync(file, 'utf8')); }
function resultEvent() {
  return {
    eventId: 'dungeon:run_1:p1:combatResult',
    runId: 'run_1',
    playerId: 'p1',
    messageType: 'combatResult',
    payload: { eventId: 'dungeon:run_1:p1:combatResult', requestId: 'request_1', text: 'Victory' },
  };
}

test('a process crash between player and outbox target writes restores the pending event on restart', () => {
  const f = fixture();
  try {
    const moduleUrl = new URL('../src/sharedStateTransactions.ts', import.meta.url).href;
    const enqueueUrl = new URL('../src/dungeonResultOutboxDelivery.ts', import.meta.url).href;
    const childScript = `
      import { createSharedStateTransactionStore } from ${JSON.stringify(moduleUrl)};
      import { enqueueDungeonResultEvents } from ${JSON.stringify(enqueueUrl)};
      const store = createSharedStateTransactionStore({
        dataDir: ${JSON.stringify(f.dataDir)},
        files: ${JSON.stringify(f.files)},
        testHooks: { afterTargetWrite(key) { if (key === 'players') process.exit(73); } },
      });
      const event = ${JSON.stringify(resultEvent())};
      store.transact(() => ({
        files: {
          players: { p1: { health: 80, dungeonRuns: 1 } },
          dungeonOutbox: enqueueDungeonResultEvents({ outbox: {}, events: [event], now: 100 }),
        },
        result: null,
      }));
      process.exit(0);
    `;
    const child = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', childScript], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(child.status, 73, child.stderr);
    const firstBoot = f.createStore();
    assert.equal(existsSync(firstBoot.journalFile), true);
    assert.equal(firstBoot.recover(), true);
    assert.deepEqual(readJson(f.files.players), { p1: { health: 80, dungeonRuns: 1 } });
    assert.deepEqual(readJson(f.files.dungeonOutbox), {
      [resultEvent().eventId]: { ...resultEvent(), status: 'pending', createdAt: 100 },
    });
    assert.equal(existsSync(firstBoot.journalFile), false);
  } finally { f.cleanup(); }
});

test('restart replays an unacknowledged send, then never resends an acknowledged event', () => {
  const f = fixture();
  try {
    const initial = f.createStore();
    const event = resultEvent();
    initial.transact(() => ({
      files: {
        players: { p1: { health: 80 } },
        dungeonOutbox: enqueueDungeonResultEvents({ outbox: {}, events: [event], now: 100 }),
      },
      result: null,
    }));

    let sends = 0;
    const beforeCrash = f.createStore();
    assert.throws(() => dispatchPendingDungeonResultEvents({
      playerId: 'p1',
      outbox: readJson(f.files.dungeonOutbox),
      send: () => { sends += 1; throw new Error('simulated process interruption after transport accepted'); },
      acknowledge: () => {
        beforeCrash.transact(() => ({ files: { dungeonOutbox: {} }, result: null }));
      },
    }), /simulated process interruption/);
    assert.equal(sends, 1);
    assert.equal(readJson(f.files.dungeonOutbox)[event.eventId].status, 'pending');

    // A fresh store instance models a server restart: the unacknowledged event is still pending.
    const restarted = f.createStore();
    const replayed = dispatchPendingDungeonResultEvents({
      playerId: 'p1',
      outbox: readJson(f.files.dungeonOutbox),
      send: () => { sends += 1; },
      acknowledge: (eventId) => {
        const current = readJson(f.files.dungeonOutbox);
        const next = { ...current, [eventId]: { ...current[eventId], status: 'delivered', deliveredAt: 200 } };
        restarted.transact(() => ({ files: { dungeonOutbox: next }, result: null }));
      },
    });
    assert.equal(replayed, 1);
    assert.equal(sends, 2);
    assert.equal(readJson(f.files.dungeonOutbox)[event.eventId].status, 'delivered');

    const afterAckRestart = f.createStore();
    const replayAfterAck = dispatchPendingDungeonResultEvents({
      playerId: 'p1',
      outbox: readJson(f.files.dungeonOutbox),
      send: () => { sends += 1; },
      acknowledge: () => assert.fail('delivered event must not be acknowledged again'),
    });
    assert.equal(replayAfterAck, 0);
    assert.equal(sends, 2);
    assert.equal(afterAckRestart.recover(), false);
  } finally { f.cleanup(); }
});
