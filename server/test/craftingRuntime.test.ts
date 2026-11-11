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


test('starting a craft job sends the updated queue to the connected client', { timeout: 45_000 }, async () => {
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
        inventory: JSON.stringify(['herb_material', 'herb_material', 'herb_material']),
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
    assert.deepEqual(JSON.parse(saved.inventory), []);
    assert.equal(saved.crafting, 2);
  } finally {
    await leaveRoomSafely(room);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
