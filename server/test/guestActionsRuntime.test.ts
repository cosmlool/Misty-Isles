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

async function waitFor<T>(read: () => T | undefined, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) return value;
    await delay(25);
  }
  throw new Error(label + ' timed out.');
}

test('guest gameplay actions cannot consume rewards or alter character state before character creation', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-guest-guard-'));
  const playerId = 'runtime_guest_guard_0001';
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerId]: { id: playerId, name: 'Uncreated Guest' },
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
    const notices: string[] = [];
    room.onMessage('notice', payload => notices.push(String(payload?.text || '')));

    const actions: Array<[string, Record<string, unknown>]> = [
      ['daily', {}],
      ['fountain', {}],
      ['tavernGame', { game: 'dice' }],
      ['buff', { kind: 'attack' }],
      ['upgradeBuilding', { building: 'training' }],
      ['usePotion', { id: 'health_potion' }],
      ['discardItem', { index: 0 }],
      ['quest', { id: 'story_1' }],
      ['achievements', {}],
      ['returnReward', {}],
      ['pvpList', {}],
    ];
    for (const [action, payload] of actions) {
      const before = notices.length;
      room.send(action, payload);
      const notice = await waitFor(() => notices.length > before ? notices[notices.length - 1] : undefined, action + ' guard response');
      assert.equal(notice, 'Сначала создай персонажа.', action + ' must require a created character');
    }

    const saved = readJson(join(dataDir, 'players.json'))[playerId];
    assert.equal(saved.race, '');
    assert.equal(saved.level, 1);
    assert.equal(saved.experience, 0);
    assert.equal(saved.gold, 250);
    assert.equal(saved.goldEarned, 0);
    assert.equal(saved.goldSpent, 0);
    assert.equal(saved.inventory, '[]');
    assert.equal(saved.daily, '{}');
    assert.equal(saved.lastFountainAt, 0);
    assert.equal(saved.buff, '');
    assert.equal(saved.buildings, '{"training":0,"garden":0,"library":0,"workshop":0,"warehouse":0}');
    assert.equal(JSON.parse(saved.quests).story_1, undefined);
    assert.equal(JSON.parse(saved.quests).pvp, undefined, 'PvP offer generation must not mutate an uncreated guest save');
  } finally {
    if (room) await room.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
