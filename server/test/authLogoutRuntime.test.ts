import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';
import { Client, type Room } from 'colyseus.js';

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

async function waitFor<T>(read: () => T | undefined, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = read(); if (value !== undefined) return value; await delay(25); }
  throw new Error(label + ' timed out.');
}

async function post(port: number, path: string, body: any) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
}

test('logout revokes a valid session, closes its active WebSocket and rejects further gameplay', { timeout: 30_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-auth-logout-'));
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  let leaveCode: number | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);

    const guest = await post(port, '/auth/guest', {});
    assert.equal(guest.status, 200);
    const { playerId, token, guestProof } = await guest.json() as { playerId: string; token: string; guestProof: string };
    const client = new Client(`ws://127.0.0.1:${port}`);
    room = await client.joinOrCreate('my_room', { playerId, sessionToken: token });
    const notices: string[] = [];
    let groupListResponses = 0;
    room.onMessage('notice', payload => notices.push(String(payload?.text || '')));
    room.onMessage('huntGroupPlayers', () => { groupListResponses++; });
    room.send('createCharacter', { race: 'Кот', gender: 'male', name: 'LogoutTestHero' });
    await waitFor(() => notices.find(message => message.includes('Персонаж создан')), 'character creation before logout');
    const left = new Promise<number>(resolve => room!.onLeave(code => { leaveCode = code; resolve(code); }));

    room.send('huntGroupList', {});
    await waitFor(() => groupListResponses > 0 ? groupListResponses : undefined, 'gameplay command before invalid logout');
    const invalidLogout = await post(port, '/auth/logout', { token: 'not-a-session-token' });
    assert.equal(invalidLogout.status, 401);
    const stillValid = await post(port, '/auth/check', { token });
    assert.equal(stillValid.status, 200);
    room.send('huntGroupList', {});
    await waitFor(() => groupListResponses > 1 ? groupListResponses : undefined, 'active socket after invalid logout');

    const validLogout = await post(port, '/auth/logout', { token });
    assert.equal(validLogout.status, 200);
    await Promise.race([
      left,
      delay(5_000).then(() => { throw new Error('The active gameplay WebSocket was not closed after logout.'); }),
    ]);
    assert.equal(typeof leaveCode, 'number', 'the active gameplay socket must be closed after logout');
    const revoked = await post(port, '/auth/check', { token });
    assert.equal(revoked.status, 401);
    // The active socket is already closed and /auth/check rejects the revoked token.
    // Colyseus joinOrCreate can remain pending after an onJoin rejection, so do not await that client promise here.

    const repeatedLogout = await post(port, '/auth/logout', { token });
    assert.equal(repeatedLogout.status, 401);

    const recovered = await post(port, '/auth/guest', { playerId, guestProof });
    assert.equal(recovered.status, 200, 'logout must not destroy the persistent guest recovery credential');
    const renewed = await recovered.json() as { token: string; playerId: string };
    assert.equal(renewed.playerId, playerId);
    assert.equal((await post(port, '/auth/check', { token: renewed.token })).status, 200);
  } finally {
    try {
      if (room && leaveCode === undefined) {
        await Promise.race([room.leave().catch(() => undefined), delay(1_000)]);
      }
    } finally {
      if (child) await stopServer(child);
      rmSync(dataDir, { recursive: true, force: true });
    }
  }
});
