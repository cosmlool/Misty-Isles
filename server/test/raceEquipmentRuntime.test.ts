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

import { seedGuestCredentials, testGuestProof } from './guestAuthTestHelpers.js';

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
        method: 'POST', headers: { 'content-type': 'application/json' },
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
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ playerId, guestProof: testGuestProof(playerId) }),
  });
  assert.equal(response.status, 200);
  return (await response.json() as { token: string }).token;
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

async function waitFor<T>(read: () => T | undefined, label: string): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(25);
  }
  throw new Error(label + ' timed out.');
}

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('server rejects equipping another race equipment even when it is in inventory', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-race-equipment-'));
  const playerId = 'runtime_race_equipment_01';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerId]: {
        id: playerId, name: 'Race Gear Tester', race: 'Кот', profession: 'Воин', level: 30,
        gold: 500, inventory: JSON.stringify(['dog_oathaxe', 'cat_silversilk']),
        equipment: JSON.stringify({ weapon: '', armor: '', helmet: '', gloves: '', boots: '', cloak: '', amulet: '' }),
        quests: '{}',
      },
    }, null, 2));

    seedGuestCredentials(dataDir);


    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const token = await guestToken(port, playerId);
    room = await client.joinOrCreate('my_room', { playerId, sessionToken: token });
    const notices: string[] = [];
    room.onMessage('notice', payload => notices.push(String(payload?.text || '')));

    room.send('equipItem', { id: 'dog_oathaxe' });
    await waitFor(() => notices.find(message => message === 'Этот предмет доступен только расе «Собака».'), 'cross-race equipment rejection');
    const afterRejected = readJson(join(dataDir, 'players.json'))[playerId];
    assert.equal(JSON.parse(afterRejected.equipment).weapon, '');
    assert.ok(JSON.parse(afterRejected.inventory).includes('dog_oathaxe'));

    room.send('equipItem', { id: 'cat_silversilk' });
    await waitFor(() => notices.find(message => message.includes('Экипировано: Мантия серебряного архива')), 'own-race equipment remains usable');
    const afterAllowed = readJson(join(dataDir, 'players.json'))[playerId];
    assert.equal(JSON.parse(afterAllowed.equipment).armor, 'cat_silversilk');
  } finally {
    if (room) await room.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
