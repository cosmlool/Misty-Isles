import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { claimCraftJob, refundCraftMaterials, startCraftJob } from '../src/craftingQueue.js';

test('refunds the exact materials stored on a craft job', () => {
  const inventory = ['herb_material', 'wood_material'];
  const result = refundCraftMaterials(inventory, { materials: { crystal_shard: 2, ash_ore: 1 } });
  assert.equal(result.refunded, true);
  assert.deepEqual(result.inventory, ['herb_material', 'wood_material', 'crystal_shard', 'crystal_shard', 'ash_ore']);
  assert.deepEqual(inventory, ['herb_material', 'wood_material']);
});

test('uses the current recipe as a fallback for older queued jobs', () => {
  const result = refundCraftMaterials(['wood_material'], {}, { wood_material: 3, rune_shard: 1 });
  assert.equal(result.refunded, true);
  assert.deepEqual(result.inventory, ['wood_material', 'wood_material', 'wood_material', 'wood_material', 'rune_shard']);
});

test('refuses to invent a refund when neither job nor recipe has valid materials', () => {
  const inventory = ['ash_ore'];
  const result = refundCraftMaterials(inventory, { materials: { ash_ore: -5 } });
  assert.equal(result.refunded, false);
  assert.deepEqual(result.inventory, inventory);
});

test('rejects malformed material quantities and oversized refunds', () => {
  assert.equal(refundCraftMaterials([], { materials: { ash_ore: 1001 } }).refunded, false);
  assert.equal(refundCraftMaterials([], { materials: ['ash_ore'] }).refunded, false);
});


test('starting a craft job consumes the exact recipe materials and stores a refund snapshot', () => {
  const started = startCraftJob({
    inventory: ['herb', 'herb', 'ore', 'wood'],
    queue: [],
    materials: { herb: 2, ore: 1 },
    job: { id: 'job-1', output: 'potion', count: 2, finishAt: 500 },
  });
  assert.deepEqual(started.inventory, ['wood']);
  assert.deepEqual(started.queue[0].materials, { herb: 2, ore: 1 });
  assert.deepEqual(startCraftJob({ ...started, materials: { wood: 1 }, job: { id: 'job-2', output: 'ring', count: 1, finishAt: 600 } }).inventory, []);
});

test('craft start refuses missing materials and a full queue without changing input arrays', () => {
  const inventory = ['herb'];
  const queue = [{ id: 'existing-1', output: 'potion', count: 1, finishAt: 100 }];
  assert.throws(() => startCraftJob({ inventory, queue, materials: { herb: 2 }, job: { id: 'job', output: 'potion', count: 1, finishAt: 200 } }), /Missing craft material/);
  assert.throws(() => startCraftJob({ inventory, queue: [ ...queue, ...queue, ...queue ], materials: { herb: 1 }, job: { id: 'job', output: 'potion', count: 1, finishAt: 200 } }), /queue is full/);
  assert.deepEqual(inventory, ['herb']);
  assert.equal(queue.length, 1);
});

test('claiming a completed job grants its output once and removes the job', () => {
  const queue = [{ id: 'job-1', output: 'potion', count: 2, finishAt: 100 }];
  const result = claimCraftJob({ inventory: ['ore'], queue, jobId: 'job-1', now: 100 });
  assert.deepEqual(result.inventory, ['ore', 'potion', 'potion']);
  assert.equal(result.queue.length, 0);
  assert.equal(result.outputCount, 2);
  assert.throws(() => claimCraftJob({ inventory: result.inventory, queue: result.queue, jobId: 'job-1', now: 101 }), /not found/);
});

test('claiming a blocked unique output refunds exact stored materials instead of losing them', () => {
  const queue = [{ id: 'job-1', output: 'unique_amulet', count: 1, finishAt: 100, materials: { ore: 2, gem: 1 } }];
  const result = claimCraftJob({ inventory: ['wood'], queue, jobId: 'job-1', now: 100, uniqueConflict: true });
  assert.deepEqual(result.inventory, ['wood', 'ore', 'ore', 'gem']);
  assert.equal(result.queue.length, 0);
  assert.equal(result.refunded, true);
});

test('blocked unique output with unknown legacy materials remains queued for manual review', () => {
  const queue = [{ id: 'job-1', output: 'unique_amulet', count: 1, finishAt: 100 }];
  assert.throws(() => claimCraftJob({ inventory: ['wood'], queue, jobId: 'job-1', now: 100, uniqueConflict: true }), /job retained/);
  assert.equal(queue.length, 1);
});

test('an in-progress craft job and its reserved materials survive save and reconnect round-trip', () => {
  const f = mkdtempSync(join(tmpdir(), 'misty-craft-reconnect-'));
  try {
    const started = startCraftJob({ inventory: ['ore', 'ore', 'herb'], queue: [],
      materials: { ore: 2, herb: 1 },
      job: { id: 'job-reconnect', output: 'iron_sword', count: 1, finishAt: 500 } });
    const savedPlayer = { id: 'test-player', inventory: JSON.stringify(started.inventory), craftQueue: JSON.stringify(started.queue) };
    const savePath = join(f, 'players.json');
    writeFileSync(savePath, JSON.stringify({ 'test-player': savedPlayer }));
    const reloaded = JSON.parse(readFileSync(savePath, 'utf8'))['test-player'];
    assert.deepEqual(JSON.parse(reloaded.inventory), []);
    const restoredQueue = JSON.parse(reloaded.craftQueue);
    assert.equal(restoredQueue[0].id, 'job-reconnect');
    assert.deepEqual(restoredQueue[0].materials, { ore: 2, herb: 1 });
    const claimed = claimCraftJob({ inventory: JSON.parse(reloaded.inventory), queue: restoredQueue, jobId: 'job-reconnect', now: 500 });
    assert.deepEqual(claimed.inventory, ['iron_sword']);
    assert.equal(claimed.queue.length, 0);
  } finally { rmSync(f, { recursive: true, force: true }); }
});
