import assert from 'node:assert/strict';
import test from 'node:test';
import { isMiningActivityLocked, MINING_CYCLE_MS, prepareMiningSettlement, readMiningJob, startMiningJob } from '../src/miningOperations.js';

test('a mining cycle is persisted as an absolute five-minute job', () => {
  const started = startMiningJob({ expedition: { state: 'idle' }, other: 7 }, 10_000);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  assert.deepEqual(started.job, { startedAt: 10_000, endsAt: 10_000 + MINING_CYCLE_MS });
  assert.deepEqual(readMiningJob(started.quests), started.job);
  assert.equal(isMiningActivityLocked(started.quests, 10_001), true);
  assert.equal(isMiningActivityLocked(started.quests, started.job.endsAt), false);
  assert.equal(startMiningJob(started.quests, 20_000).ok, false);
});

test('a job remains pending until its absolute end time, including after an offline interval', () => {
  const started = startMiningJob({}, 1_000);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const pending = prepareMiningSettlement(started.quests, 0, started.job.endsAt - 1, 0, 0.5);
  assert.equal(pending.status, 'pending');
  if (pending.status === 'pending') assert.equal(pending.remainingMs, 1);
  const completed = prepareMiningSettlement(started.quests, 0, started.job.endsAt + 8 * 60 * 60 * 1000, 0, 0.5);
  assert.equal(completed.status, 'completed');
  if (completed.status === 'completed') {
    assert.equal(completed.rolledReward, 1);
    assert.equal(completed.crystals, 1);
    assert.equal('miningJob' in completed.quests, false);
  }
});

test('the approved crystalChance effect can add one crystal above the base reward', () => {
  const started = startMiningJob({}, 5_000);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const success = prepareMiningSettlement(started.quests, 0, started.job.endsAt, 0.2, 0.199999);
  assert.equal(success.status, 'completed');
  if (success.status === 'completed') {
    assert.equal(success.baseReward, 1);
    assert.equal(success.bonusReward, 1);
    assert.equal(success.rolledReward, 2);
    assert.equal(success.crystals, 2);
  }
  const miss = prepareMiningSettlement(started.quests, 0, started.job.endsAt, 0.2, 0.2);
  assert.equal(miss.status, 'completed');
  if (miss.status === 'completed') assert.equal(miss.rolledReward, 1);
});

test('crystal cap burns overflow without exceeding 50,000', () => {
  const started = startMiningJob({}, 7_000);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const result = prepareMiningSettlement(started.quests, 49_999, started.job.endsAt, 0.2, 0);
  assert.equal(result.status, 'completed');
  if (result.status === 'completed') {
    assert.equal(result.rolledReward, 2);
    assert.equal(result.crystals, 50_000);
    assert.equal(result.credited, 1);
    assert.equal(result.burned, 1);
  }
});

test('a settled mining job cannot be claimed twice', () => {
  const started = startMiningJob({}, 9_000);
  assert.equal(started.ok, true);
  if (!started.ok) return;
  const result = prepareMiningSettlement(started.quests, 0, started.job.endsAt, 0, 0.9);
  assert.equal(result.status, 'completed');
  if (result.status === 'completed') assert.equal(prepareMiningSettlement(result.quests, result.crystals, started.job.endsAt, 0, 0.9).status, 'none');
});
