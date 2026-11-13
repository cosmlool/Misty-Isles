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

function readPlayers(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('daily reward streak increments only on consecutive UTC days and resets after a missed day', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-daily-streak-'));
  const consecutiveId = 'runtime_daily_consecutive_01';
  const missedId = 'runtime_daily_missed_0001';
  const today = new Date().toISOString().slice(0, 10);
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  const rooms: Room[] = [];
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [consecutiveId]: {
        id: consecutiveId, name: 'Consecutive Hero', race: 'Кот', level: 1, gold: 500,
        inventory: '[]', equipment: '{}', quests: '{}',
        daily: JSON.stringify({ day: yesterday, streak: 4 }),
      },
      [missedId]: {
        id: missedId, name: 'Returning Hero', race: 'Собака', level: 1, gold: 500,
        inventory: '[]', equipment: '{}', quests: '{}',
        daily: JSON.stringify({ day: threeDaysAgo, streak: 7 }),
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

    for (const playerId of [consecutiveId, missedId]) {
      const token = await guestToken(port, playerId);
      rooms.push(await client.joinOrCreate('my_room', { playerId, sessionToken: token }));
    }
    const notices: string[][] = [[], []];
    rooms.forEach((room, index) => room.onMessage('notice', payload => notices[index].push(String(payload?.text || ''))));
    rooms[0].send('daily');
    rooms[1].send('daily');

    await waitFor(() => {
      const players = readPlayers(join(dataDir, 'players.json'));
      const first = JSON.parse(players[consecutiveId].daily);
      const second = JSON.parse(players[missedId].daily);
      return first.day === today && second.day === today ? true : undefined;
    }, 'both daily rewards to persist');

    const saved = readPlayers(join(dataDir, 'players.json'));
    assert.deepEqual(JSON.parse(saved[consecutiveId].daily), { day: today, streak: 5 });
    assert.deepEqual(JSON.parse(saved[missedId].daily), { day: today, streak: 1 });
    assert.equal(saved[consecutiveId].gold, 587);
    assert.equal(saved[missedId].gold, 587);
    assert.deepEqual(JSON.parse(saved[consecutiveId].inventory), ['health_potion']);
    assert.deepEqual(JSON.parse(saved[missedId].inventory), ['health_potion']);

    rooms[0].send('daily');
    await waitFor(() => notices[0].find(message => message === 'Ежедневная награда уже получена.'), 'same-day reward rejection');
    assert.deepEqual(JSON.parse(readPlayers(join(dataDir, 'players.json'))[consecutiveId].daily), { day: today, streak: 5 });
  } finally {
    for (const room of rooms) await leaveRoomSafely(room);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
