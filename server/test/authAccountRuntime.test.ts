import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
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

async function post(port: number, path: string, body: any) {
  return fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  });
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

test('account registration securely links a guest save, revokes the guest token and supports case-insensitive login', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-auth-link-'));
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);

    const playerId = 'runtime_auth_link_01';
    const guestResponse = await post(port, '/auth/guest', { playerId });
    assert.equal(guestResponse.status, 200);
    const guest = await guestResponse.json() as { token: string };

    const registration = await post(port, '/auth/register', {
      username: 'MistyTester', password: 'StrongPass123', playerId, guestToken: guest.token,
    });
    assert.equal(registration.status, 201);
    const account = await registration.json() as { playerId: string; token: string; username: string };
    assert.equal(account.playerId, playerId);
    assert.equal(account.username, 'MistyTester');

    assert.equal((await post(port, '/auth/check', { token: account.token })).status, 200);
    assert.equal((await post(port, '/auth/check', { token: guest.token })).status, 401);

    const login = await post(port, '/auth/login', { username: 'mistytester', password: 'StrongPass123' });
    assert.equal(login.status, 200);
    const loggedIn = await login.json() as { playerId: string; token: string };
    assert.equal(loggedIn.playerId, playerId);
    assert.equal((await post(port, '/auth/check', { token: loggedIn.token })).status, 200);

    assert.equal((await post(port, '/auth/login', { username: 'MistyTester', password: 'wrong-password' })).status, 401);
    assert.equal((await post(port, '/auth/register', { username: 'MISTYTESTER', password: 'AnotherPass123' })).status, 409);

    const secondGuest = await post(port, '/auth/guest', { playerId: 'runtime_auth_unlinked_02' });
    assert.equal(secondGuest.status, 200);
    assert.equal((await post(port, '/auth/register', {
      username: 'UnverifiedGuest', password: 'StrongPass123', playerId: 'runtime_auth_unlinked_02',
    })).status, 401);
  } finally {
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
