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

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, 'utf8'));
}

test('solo Forgotten Lands boss dungeon reports remaining daily entries and enforces the three-entry cap', { timeout: 45_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-dungeon-attempts-'));
  const playerId = 'runtime_dungeon_attempts_01';
  const lossPlayerId = 'runtime_dungeon_loss_01';
  const today = new Date().toISOString().slice(0, 10);
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  let lossRoom: Room | undefined;
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [playerId]: {
        id: playerId, name: 'Dungeon Tester', race: 'Кот', profession: 'Вампир', level: 8,
        strength: 100_000, dexterity: 100_000, intelligence: 100_000,
        defense: 100_000, vitality: 100_000, stamina: 100_000,
        health: 1_089, maxHealth: 1_000, gold: 500,
        inventory: JSON.stringify(['ARM-C-1-001', 'ARM-C-5-001']), equipment: JSON.stringify({ weapon: 'wood_sword', helmet: 'ARM-C-1-001', armor: '', cloak: 'ARM-C-5-001', amulet: 'amulet_health' }), quests: JSON.stringify({ dungeonDay: today, dungeonRuns: 0 }),
      },
      [lossPlayerId]: {
        id: lossPlayerId, name: 'Weak Dungeon Tester', race: 'Кот', profession: '', level: 8,
        strength: 0, dexterity: 0, intelligence: 0, defense: 0, vitality: 0, stamina: 0,
        health: 1_000, maxHealth: 1_000, gold: 500,
        inventory: '[]', equipment: '{}', quests: JSON.stringify({ dungeonDay: today, dungeonRuns: 0 }),
      },
    }, null, 2));

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const token = await guestToken(port, playerId);
    room = await client.joinOrCreate('my_room', { playerId, sessionToken: token });
    const lossToken = await guestToken(port, lossPlayerId);
    lossRoom = await client.joinOrCreate('my_room', { playerId: lossPlayerId, sessionToken: lossToken });

    const results: any[] = [];
    const lossResults: any[] = [];
    lossRoom.onMessage('combatResult', payload => lossResults.push(payload));
    const notices: string[] = [];
    room.onMessage('combatResult', payload => results.push(payload));
    room.onMessage('notice', payload => notices.push(String(payload?.text || '')));

    for (let attempt = 1; attempt <= 3; attempt++) {
      const before = results.length;
      room.send('dungeonRun', { id: 'fl_dungeon_03' });
      const result = await waitFor(() => results[before], `dungeon attempt ${attempt}`);
      assert.equal(result.report.result, 'win');
      assert.equal(result.report.maxHealth, 1_089, 'legacy health amulet must contribute its listed +8% maximum health');
      assert.equal(result.report.hpAfter, 1_089, 'vampire healing must preserve the amulet health bonus');
      assert.ok(result.text.includes(`Осталось входов сегодня: ${3 - attempt}.`));
    }

    const beforeRejectedAttempt = results.length;
    room.send('dungeonRun', { id: 'fl_dungeon_03' });
    await waitFor(() => notices.find(message => message.includes('закончились попытки в подземельях')), 'daily dungeon cap');
    assert.equal(results.length, beforeRejectedAttempt);

    const saved = readJson(join(dataDir, 'players.json'))[playerId];
    const quests = JSON.parse(saved.quests);
    assert.equal(quests.dungeonRuns, 3);
    assert.equal(saved.battles, 3, 'each successful solo dungeon attempt must count as a battle');
    assert.equal(quests.dungeonDay, today);
    assert.equal(saved.gold, 1_160);
    assert.equal(saved.experience, 1_260);
    assert.equal(saved.health, 1_089, 'saved health must remain within the effective maximum, not the legacy base maximum');

    lossRoom.send('dungeonRun', { id: 'fl_dungeon_03' });
    const loss = await waitFor(() => lossResults[0], 'solo dungeon loss');
    assert.equal(loss.report.result, 'loss');
    assert.equal(loss.report.hpBefore, 1_000);
    assert.equal(loss.report.hpAfter < loss.report.hpBefore, true);
    assert.equal(loss.report.rewards.gold, 0);
    assert.equal(loss.report.rewards.xp, 0);
    assert.ok(loss.text.includes('Осталось входов сегодня: 2.'));
    const lossSaved = readJson(join(dataDir, 'players.json'))[lossPlayerId];
    assert.equal(lossSaved.gold, 500, 'failed solo dungeon must not grant gold');
    assert.equal(lossSaved.experience, 0, 'failed solo dungeon must not grant experience');
    assert.equal(lossSaved.inventory, '[]', 'failed solo dungeon must not grant loot');
    assert.equal(JSON.parse(lossSaved.quests).dungeonRuns, 1, 'failed attempt must consume one daily entry');
    assert.equal(lossSaved.battles, 1, 'a failed solo dungeon attempt must also count as a battle');
    assert.equal(lossSaved.health, loss.report.hpAfter, 'failed attempt health must be persisted');

    room.send('discardItem', { index: 0, itemId: 'ARM-C-1-001', expectedCount: 1 });
    await waitFor(() => notices.find(message => message.includes('удалён из инвентаря')), 'discarding equipped HP armor');
    const afterDiscard = readJson(join(dataDir, 'players.json'))[playerId];
    assert.equal(JSON.parse(afterDiscard.equipment).helmet, '');
    assert.equal(afterDiscard.health, 1_085, 'discarding HP armor must preserve health percentage and reduce the cap');

    room.send('auctionSell', { index: 0, itemId: 'ARM-C-5-001', expectedCount: 1, price: 100, currency: 'gold' });
    await waitFor(() => {
      const lots = readJson(join(dataDir, 'auction.json'));
      return Array.isArray(lots) && lots.length === 1 ? true : undefined;
    }, 'listing equipped HP cloak');
    const afterListing = readJson(join(dataDir, 'players.json'))[playerId];
    assert.equal(JSON.parse(afterListing.equipment).cloak, '');
    assert.equal(afterListing.health, 1_080, 'listing equipped HP armor must not leave health above the new maximum');
    assert.equal(afterListing.gold, 1_248, 'listing fee is charged exactly once');
  } finally {
    if (room) await room.leave().catch(() => undefined);
    if (lossRoom) await lossRoom.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
