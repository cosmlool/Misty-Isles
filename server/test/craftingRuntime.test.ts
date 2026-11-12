import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type Room } from 'colyseus.js';
import test from 'node:test';

import { seedGuestCredentials, testGuestProof, leaveRoomSafely } from './guestAuthTestHelpers.js';

const serverDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const staticDataFiles = ['city_npcs.json', 'equipment_catalog.json', 'forgotten_lands.json'];

async function unusedPort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const address = probe.address();
  assert.ok(address && typeof address !== 'string');
  const port = address.port;
  await new Promise<void>((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}

async function waitForServer(port: number, child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Isolated test server exited during startup.');
    try {
      const response = await fetch(`http://127.0.0.1:${port}/auth/check`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: 'not-a-real-token' }),
      });
      if (response.status === 401) return;
    } catch {}
    await delay(100);
  }
  throw new Error('Isolated test server did not become ready.');
}

async function guestToken(port: number, playerId: string): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/auth/guest`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, guestProof: testGuestProof(playerId) }),
  });
  assert.equal(response.status, 200);
  const payload = await response.json() as { token: string };
  return payload.token;
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise<void>(resolve => child.once('exit', () => resolve()));
  child.kill('SIGTERM');
  await Promise.race([exited, delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) {
    child.kill('SIGKILL');
    await Promise.race([exited, delay(5_000)]);
  }
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(label + ' timed out after ' + ms + 'ms')), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}


test('crafting skill and daily craft progress increase only after a successful claim', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-crafting-runtime-'));
  const playerId = 'runtime_crafter_0001';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerId]: {
        id: playerId,
        name: 'Runtime Crafter',
        race: 'Кот',
        profession: '',
        level: 1,
        crafting: 1,
        gold: 250,
        inventory: JSON.stringify(['herb_material', 'herb_material', 'herb_material', 'herb_material', 'herb_material', 'herb_material']),
        craftQueue: '[]',
        equipment: JSON.stringify({ weapon: '', helmet: '', armor: '', gloves: '', boots: '', cloak: '', amulet: '' }),
      },
    }, null, 2));

    seedGuestCredentials(dataDir);


    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const token = await guestToken(port, playerId);
    const client = new Client(`ws://127.0.0.1:${port}`);
    room = await client.joinOrCreate('my_room', { playerId, sessionToken: token });

    const queueMessage = new Promise<any>(resolve => room!.onMessage('craftQueue', resolve));
    room.send('craft', { recipe: 'field_potion' });
    const payload = await withTimeout(queueMessage, 10_000, 'craftQueue response');
    assert.equal(payload.jobs.length, 1, 'client must receive the newly queued job immediately');
    assert.equal(payload.jobs[0].recipe, 'field_potion');
    assert.equal(payload.jobs[0].output, 'field_potion');

    const deadline = Date.now() + 8_000;
    let saved: any;
    while (Date.now() < deadline) {
      saved = readJson(join(dataDir, 'players.json'))[playerId];
      if (JSON.parse(saved.craftQueue || '[]').length === 1) break;
      await delay(50);
    }
    assert.equal(JSON.parse(saved.craftQueue).length, 1);
    assert.deepEqual(JSON.parse(saved.inventory), ['herb_material', 'herb_material', 'herb_material']);
    assert.equal(saved.crafting, 1, 'starting production must not grant crafting progression');
    assert.equal(saved.itemsCrafted, 0, 'starting production must not count a crafted item');
    const startedQuests = JSON.parse(saved.quests || '{}');
    assert.equal(startedQuests.activityToday?.crafts || 0, 0, 'daily craft count tracks completed orders only');

    const finishAt = payload.jobs[0].finishAt;
    await delay(Math.max(0, finishAt - Date.now() + 100));
    const claimedQueue = new Promise<any>(resolve => room!.onMessage('craftQueue', resolve));
    room.send('craftClaim', { id: payload.jobs[0].id });
    const claimedPayload = await withTimeout(claimedQueue, 10_000, 'craft claim response');
    assert.equal(claimedPayload.jobs.length, 0, 'successful claim must remove the completed job');

    const claimDeadline = Date.now() + 8_000;
    while (Date.now() < claimDeadline) {
      saved = readJson(join(dataDir, 'players.json'))[playerId];
      if (saved.itemsCrafted === 1 && saved.crafting === 2) break;
      await delay(50);
    }
    assert.equal(saved.crafting, 2, 'successful claim grants one crafting progression point');
    assert.equal(saved.itemsCrafted, 1);
    assert.deepEqual(JSON.parse(saved.inventory), ['herb_material', 'herb_material', 'herb_material', 'field_potion']);

    const secondQueue = new Promise<any>(resolve => room!.onMessage('craftQueue', resolve));
    room.send('craft', { recipe: 'field_potion' });
    const secondPayload = await withTimeout(secondQueue, 10_000, 'second craft queue response');
    assert.equal(secondPayload.jobs.length, 1);

    const cancelledQueue = new Promise<any>(resolve => room!.onMessage('craftQueue', resolve));
    room.send('craftCancel', { id: secondPayload.jobs[0].id });
    const cancelledPayload = await withTimeout(cancelledQueue, 10_000, 'craft cancellation response');
    assert.equal(cancelledPayload.jobs.length, 0);

    const cancelDeadline = Date.now() + 8_000;
    while (Date.now() < cancelDeadline) {
      saved = readJson(join(dataDir, 'players.json'))[playerId];
      const inventory = JSON.parse(saved.inventory || '[]');
      if (JSON.parse(saved.craftQueue || '[]').length === 0 && inventory.filter((id: string) => id === 'herb_material').length === 3) break;
      await delay(50);
    }
    assert.equal(saved.crafting, 2, 'cancelling an order must not grant crafting progression');
    assert.equal(saved.itemsCrafted, 1, 'cancelling an order must not count a crafted item');
    assert.deepEqual(JSON.parse(saved.inventory), ['field_potion', 'herb_material', 'herb_material', 'herb_material']);
    const afterCancelQuests = JSON.parse(saved.quests || '{}');
    assert.equal(afterCancelQuests.activityToday?.crafts, 1, 'cancelled orders do not increment completed craft count');
    assert.equal(afterCancelQuests.activityLog.filter((entry: any) => entry.type === 'craft').length, 4, 'start, completion, second start, and cancellation are logged separately');
  } finally {
    await leaveRoomSafely(room);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
