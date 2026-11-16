import assert from 'node:assert/strict';
import test from 'node:test';
import { startPlayerAutosave } from '../src/playerAutosave.js';

test('player autosave schedules one save interval and can be stopped idempotently', () => {
  let callback: (() => void) | undefined;
  let scheduledDelay = 0;
  let saved = 0;
  let unrefCalled = false;
  let cancelCalls = 0;
  const timer = { unref: () => { unrefCalled = true; } } as unknown as ReturnType<typeof setInterval>;

  const stop = startPlayerAutosave({
    intervalMs: 30_000,
    save: () => { saved += 1; },
    onError: error => { throw error; },
    schedule: (next, delay) => { callback = next; scheduledDelay = delay; return timer; },
    cancel: actual => { assert.equal(actual, timer); cancelCalls += 1; },
  });

  assert.equal(scheduledDelay, 30_000);
  assert.equal(unrefCalled, true);
  callback?.();
  callback?.();
  assert.equal(saved, 2);

  stop();
  stop();
  assert.equal(cancelCalls, 1);
});

test('player autosave reports save failures without terminating the scheduled callback', () => {
  let callback: (() => void) | undefined;
  const failure = new Error('disk unavailable');
  const reported: unknown[] = [];

  startPlayerAutosave({
    intervalMs: 1_000,
    save: () => { throw failure; },
    onError: error => { reported.push(error); },
    schedule: next => { callback = next; return { unref() {} } as unknown as ReturnType<typeof setInterval>; },
    cancel: () => {},
  });

  assert.doesNotThrow(() => callback?.());
  assert.deepEqual(reported, [failure]);
});

test('player autosave rejects invalid intervals', () => {
  assert.throws(() => startPlayerAutosave({
    intervalMs: 0,
    save: () => {},
    onError: () => {},
    schedule: () => ({ unref() {} } as unknown as ReturnType<typeof setInterval>),
    cancel: () => {},
  }), /positive integer/);
});
