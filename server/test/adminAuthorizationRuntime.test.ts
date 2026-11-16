import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { Client, type Room } from 'colyseus.js';
import test from 'node:test';

import { leaveRoomSafely } from './guestAuthTestHelpers.js';

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

test('admin WebSocket commands require the server allowlist and ignore client-supplied role fields', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-admin-auth-'));
  const port = await unusedPort();
  const adminId = 'admin_test_player';
  const regularId = 'regular_test_player';
  const adminToken = 'admin-session-token-for-test';
  const regularToken = 'regular-session-token-for-test';
  let child: ChildProcess | undefined;
  let adminRoom: Room | undefined;
  let regularRoom: Room | undefined;

  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));

    const player = (id: string, name: string) => ({
      id, name, race: 'Кот', level: 1, strength: 10, defense: 8, vitality: 10,
      dexterity: 10, intelligence: 10, luck: 5, stamina: 10, accuracy: 10,
      health: 100, maxHealth: 100, gold: 100, crystals: 0, gems: 0,
      inventory: '[]', equipment: '{}', quests: '{}', collections: '{}',
    });
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [adminId]: player(adminId, 'Admin Test'),
      [regularId]: player(regularId, 'Regular Test'),
    }, null, 2));
    writeFileSync(join(dataDir, 'sessions.json'), JSON.stringify([
      { tokenHash: createHash('sha256').update(adminToken).digest('hex'), playerId: adminId, accountKey: null, expiresAt: Date.now() + 60_000 },
      { tokenHash: createHash('sha256').update(regularToken).digest('hex'), playerId: regularId, accountKey: null, expiresAt: Date.now() + 60_000 },
    ], null, 2));

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: {
        ...process.env,
        MISTY_DATA_DIR: dataDir,
        MISTY_PORT: String(port),
        MISTY_ADMIN_PLAYER_IDS: adminId,
      },
      stdio: 'ignore',
    });
    await waitForServer(port, child);

    const adminClient = new Client(`ws://127.0.0.1:${port}`);
    const regularClient = new Client(`ws://127.0.0.1:${port}`);
    adminRoom = await adminClient.joinOrCreate('my_room', { playerId: adminId, sessionToken: adminToken });
    regularRoom = await regularClient.joinOrCreate('my_room', { playerId: regularId, sessionToken: regularToken });

    const adminNotices: string[] = [];
    const regularNotices: string[] = [];
    adminRoom.onMessage('notice', payload => adminNotices.push(String(payload?.text || '')));
    regularRoom.onMessage('notice', payload => regularNotices.push(String(payload?.text || '')));

    regularRoom.send('admin', {
      action: 'gold', amount: 500, playerId: adminId, isAdmin: true, role: 'admin',
    });
    await waitFor(
      () => regularNotices.find(message => message.includes('Нет прав')),
      'non-admin denial',
    );

    adminRoom.send('admin', {
      action: 'gold', amount: 25, playerId: regularId, isAdmin: false, role: 'player',
    });
    await waitFor(
      () => adminNotices.find(message => message.includes('Админ-команда выполнена: gold')),
      'allowlisted admin action',
    );

    await leaveRoomSafely(regularRoom);
    regularRoom = undefined;
    await leaveRoomSafely(adminRoom);
    adminRoom = undefined;

    const saved = await waitFor(() => {
      try {
        const players = JSON.parse(readFileSync(join(dataDir, 'players.json'), 'utf8'));
        return players[adminId]?.gold === 125 && players[regularId]?.gold === 100 ? players : undefined;
      } catch {
        return undefined;
      }
    }, 'admin-only gold mutation persistence');
    assert.equal(saved[adminId].gold, 125);
    assert.equal(saved[regularId].gold, 100, 'forged admin role fields must not mutate a regular player');
  } finally {
    await leaveRoomSafely(regularRoom);
    await leaveRoomSafely(adminRoom);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
