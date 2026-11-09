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
    body: JSON.stringify({ playerId }),
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

function readPlayers(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('one character cannot open two concurrent gameplay sessions or overwrite its active save', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-duplicate-session-'));
  const playerId = 'runtime_duplicate_session_01';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let firstRoom: Room | undefined;
  let secondRoom: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerId]: {
        id: playerId, name: 'Single Session Hero', race: 'Кот', level: 1,
        strength: 10, defense: 8, vitality: 10, gold: 500,
        inventory: '[]', equipment: '{}', quests: '{}',
      },
    }, null, 2));

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);

    const client = new Client(`ws://127.0.0.1:${port}`);
    const firstToken = await guestToken(port, playerId);
    firstRoom = await client.joinOrCreate('my_room', { playerId, sessionToken: firstToken });

    const secondToken = await guestToken(port, playerId);
    await assert.rejects(
      client.joinOrCreate('my_room', { playerId, sessionToken: secondToken }),
      /already|game|join|seat|room|client/i,
      'the server must reject a second live room for the same player',
    );

    const notices: string[] = [];
    firstRoom.onMessage('notice', payload => notices.push(String(payload?.text || '')));
    firstRoom.send('upgradeStat', { stat: 'strength' });
    await waitFor(() => notices.find(message => message.includes('Сила повышена')), 'first active session remains writable');
    firstRoom.send('upgradeStat', { stat: 'strength' });
    await waitFor(() => {
      const saved = readPlayers(join(dataDir, 'players.json'))[playerId];
      return saved.strength === 12 && saved.gold === 153 ? saved : undefined;
    }, 'active session save after rejected duplicate login');

    const saved = readPlayers(join(dataDir, 'players.json'))[playerId];
    assert.equal(saved.strength, 12);
    assert.equal(saved.gold, 153);
  } finally {
    if (secondRoom) await secondRoom.leave().catch(() => undefined);
    if (firstRoom) await firstRoom.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
