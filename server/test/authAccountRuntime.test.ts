import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

    const guestResponse = await post(port, '/auth/guest', {});
    assert.equal(guestResponse.status, 200);
    const guest = await guestResponse.json() as { playerId: string; token: string; guestProof: string };
    const playerId = guest.playerId;
    assert.match(playerId, /^guest_[a-f0-9]{32}$/);
    assert.equal(guest.guestProof.length, 64);

    const forgedGuest = await post(port, '/auth/guest', { playerId });
    assert.equal(forgedGuest.status, 401, 'knowing a player ID must not be enough to take over a guest');
    const secondGuestResponse = await post(port, '/auth/guest', { playerId, guestProof: guest.guestProof });
    assert.equal(secondGuestResponse.status, 200);
    const secondGuest = await secondGuestResponse.json() as { token: string; guestProof: string };
    assert.equal(secondGuest.guestProof, guest.guestProof);

    const legacyMigration = await post(port, '/auth/guest', { playerId, sessionToken: secondGuest.token });
    assert.equal(legacyMigration.status, 200, 'a valid legacy guest session can be upgraded once to a recovery proof');
    const migrated = await legacyMigration.json() as { token: string; guestProof: string };
    assert.equal(migrated.guestProof.length, 64);
    assert.notEqual(migrated.guestProof, guest.guestProof);

    const registration = await post(port, '/auth/register', {
      username: 'MistyTester', password: 'StrongPass123', playerId, guestProof: migrated.guestProof,
    });
    assert.equal(registration.status, 201);
    const account = await registration.json() as { playerId: string; token: string; username: string };
    assert.equal(account.playerId, playerId);
    assert.equal(account.username, 'MistyTester');

    assert.equal((await post(port, '/auth/check', { token: account.token })).status, 200);
    assert.equal((await post(port, '/auth/check', { token: guest.token })).status, 401);
    assert.equal((await post(port, '/auth/check', { token: secondGuest.token })).status, 401, 'linking an account must revoke every guest session for that player');
    assert.equal((await post(port, '/auth/check', { token: migrated.token })).status, 401, 'the migrated legacy session must also be revoked');
    assert.equal((await post(port, '/auth/guest', { playerId, guestProof: migrated.guestProof })).status, 409, 'a linked account must not be reopened through guest recovery');

    // Simulate a crash after the account record was written but before stale guest sessions were removed.
    const sessionsPath = join(dataDir, 'sessions.json');
    const sessions = JSON.parse(readFileSync(sessionsPath, 'utf8'));
    for (const token of [guest.token, secondGuest.token, migrated.token]) {
      sessions.push({ tokenHash: createHash('sha256').update(token).digest('hex'), playerId, accountKey: null, expiresAt: Date.now() + 60_000 });
    }
    writeFileSync(sessionsPath, JSON.stringify(sessions, null, 2));
    assert.equal((await post(port, '/auth/check', { token: guest.token })).status, 401, 'stale guest tokens must be invalid even if a crash left them in sessions.json');
    assert.equal((await post(port, '/auth/check', { token: secondGuest.token })).status, 401);

    const login = await post(port, '/auth/login', { username: 'mistytester', password: 'StrongPass123' });
    assert.equal(login.status, 200);
    const loggedIn = await login.json() as { playerId: string; token: string };
    assert.equal(loggedIn.playerId, playerId);
    assert.equal((await post(port, '/auth/check', { token: loggedIn.token })).status, 200);

    assert.equal((await post(port, '/auth/login', { username: 'MistyTester', password: 'wrong-password' })).status, 401);
    assert.equal((await post(port, '/auth/register', { username: 'MISTYTESTER', password: 'AnotherPass123' })).status, 409);

    const unlinkedGuest = await post(port, '/auth/guest', {});
    assert.equal(unlinkedGuest.status, 200);
    const unlinked = await unlinkedGuest.json() as { playerId: string; token: string; guestProof: string };
    assert.equal((await post(port, '/auth/register', {
      username: 'UnverifiedGuest', password: 'StrongPass123', playerId: unlinked.playerId,
    })).status, 401, 'guest save linking must require the persistent recovery proof');
  } finally {
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
