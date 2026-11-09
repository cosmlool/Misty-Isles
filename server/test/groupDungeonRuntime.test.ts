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

function publicCode(id: string): string {
  return createHash('sha256').update(`MistyIslesPublic:${id}`).digest('hex').slice(0, 24);
}

test('group boss dungeon persists win rewards and loss costs for every participant', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-group-dungeon-'));
  const ids = ['runtime_dungeon_win_lead', 'runtime_dungeon_win_member', 'runtime_dungeon_loss_lead', 'runtime_dungeon_loss_member'];
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  const rooms: Room[] = [];
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    const today = new Date().toISOString().slice(0, 10);
    const makePlayer = (id: string, name: string, friend: string, strong: boolean) => ({
      id, name, race: 'Кот', profession: '', level: 5,
      strength: strong ? 100_000 : 1, dexterity: strong ? 100_000 : 1,
      intelligence: strong ? 100_000 : 1, defense: strong ? 100_000 : 1,
      vitality: strong ? 100_000 : 1, stamina: strong ? 100_000 : 1,
      health: 1_000, maxHealth: 1_000, gold: 500, experience: 0,
      inventory: '[]', equipment: '{}',
      collections: JSON.stringify({ friends: [friend] }),
      quests: JSON.stringify({ dungeonDay: today, dungeonRuns: strong ? 2 : 0 }),
    });
    writeFileSync(join(dataDir, 'players.json'), JSON.stringify({
      [ids[0]]: makePlayer(ids[0], 'Win Leader', ids[1], true),
      [ids[1]]: makePlayer(ids[1], 'Win Member', ids[0], true),
      [ids[2]]: makePlayer(ids[2], 'Loss Leader', ids[3], false),
      [ids[3]]: makePlayer(ids[3], 'Loss Member', ids[2], false),
    }, null, 2));

    child = spawn(process.execPath, ['--import', 'tsx', 'src/index.ts'], {
      cwd: serverDir,
      env: { ...process.env, MISTY_DATA_DIR: dataDir, MISTY_PORT: String(port) },
      stdio: 'ignore',
    });
    await waitForServer(port, child);
    const client = new Client(`ws://127.0.0.1:${port}`);
    const connected: Record<string, Room> = {};
    for (const id of ids) {
      const token = await guestToken(port, id);
      connected[id] = await client.joinOrCreate('my_room', { playerId: id, sessionToken: token });
      rooms.push(connected[id]);
    }

    const groupStates: Record<string, any[]> = { [ids[0]]: [], [ids[2]]: [] };
    const invites: Record<string, any[]> = { [ids[1]]: [], [ids[3]]: [] };
    connected[ids[0]].onMessage('huntGroupState', payload => groupStates[ids[0]].push(payload));
    connected[ids[2]].onMessage('huntGroupState', payload => groupStates[ids[2]].push(payload));
    connected[ids[1]].onMessage('huntGroupInvite', payload => invites[ids[1]].push(payload));
    connected[ids[3]].onMessage('huntGroupInvite', payload => invites[ids[3]].push(payload));

    for (const [leader, member] of [[ids[0], ids[1]], [ids[2], ids[3]]]) {
      connected[leader].send('huntGroupInvite', { targetId: publicCode(member) });
      const invite = await waitFor(() => invites[member][0], `invite for ${member}`);
      connected[member].send('huntGroupAccept', { groupId: invite.groupId });
      await waitFor(() => groupStates[leader].find(payload => payload.group?.members?.length === 2), `group ${leader} acceptance`);
    }

    const results: Record<string, any[]> = Object.fromEntries(ids.map(id => [id, []]));
    const histories: Record<string, any[]> = Object.fromEntries(ids.map(id => [id, []]));
    for (const id of ids) {
      connected[id].onMessage('combatResult', payload => results[id].push(payload));
      connected[id].onMessage('combatHistory', payload => histories[id].push(payload));
    }
    connected[ids[0]].send('dungeonRun', { id: 'fl_dungeon_03' });
    const win = await waitFor(() => results[ids[0]][0], 'group boss dungeon win');
    const winMember = await waitFor(() => results[ids[1]][0], 'group member boss dungeon win');
    assert.equal(win.report.result, 'win');
    assert.equal(winMember.report.result, 'win');

    connected[ids[2]].send('dungeonRun', { id: 'fl_dungeon_03' });
    const loss = await waitFor(() => results[ids[2]][0], 'group boss dungeon loss');
    const lossMember = await waitFor(() => results[ids[3]][0], 'group member boss dungeon loss');
    assert.equal(loss.report.result, 'loss');
    assert.equal(lossMember.report.result, 'loss');

    const saved = readPlayers(join(dataDir, 'players.json'));
    for (const [id, result] of [[ids[0], win], [ids[1], winMember], [ids[2], loss], [ids[3], lossMember]] as const) {
      assert.equal(result.report.hpBefore, 1_000, 'each participant report must capture their own pre-fight health');
      assert.equal(result.report.hpAfter, saved[id].health, 'each participant report must show their own saved post-fight health');
      assert.equal(result.report.level, saved[id].level, 'each participant report must show their own level');
      assert.ok(histories[id].some(payload => payload.history?.[0]?.result === result.report.result), 'each participant must receive their combat history');
    }
    for (const id of ids.slice(0, 2)) {
      assert.equal(saved[id].battles, 1, 'each successful group dungeon attempt must count for every member');
      assert.equal(saved[id].gold, 610);
      assert.equal(saved[id].experience, 420);
      assert.equal(JSON.parse(saved[id].quests).dungeonRuns, 3);
      assert.equal(saved[id].bossesKilled, 1);
      assert.ok(saved[id].health < 1_000);
      assert.equal(JSON.parse(saved[id].quests).activityToday.dungeons, 1);
      assert.equal(JSON.parse(saved[id].quests).activityLog[0].outcome, 'win');
    }
    for (const id of ids.slice(2)) {
      assert.equal(saved[id].battles, 1, 'each failed group dungeon attempt must count for every member');
      assert.equal(saved[id].gold, 500);
      assert.equal(saved[id].experience, 0);
      assert.equal(JSON.parse(saved[id].quests).dungeonRuns, 1);
      assert.equal(saved[id].bossesKilled || 0, 0);
      assert.ok(saved[id].health < 1_000);
      assert.equal(JSON.parse(saved[id].quests).activityToday.dungeons, 1);
      assert.equal(JSON.parse(saved[id].quests).activityLog[0].outcome, 'loss');
    }
    const capNotices: string[] = [];
    connected[ids[0]].onMessage('notice', payload => capNotices.push(String(payload?.text || '')));
    connected[ids[0]].send('dungeonRun', { id: 'fl_dungeon_03' });
    await waitFor(() => capNotices.find(message => message.includes('на сегодня закончились попытки в подземельях')), 'group dungeon daily attempt cap');
    const afterCap = readPlayers(join(dataDir, 'players.json'));
    assert.equal(afterCap[ids[0]].gold, 610, 'a fourth daily group entry must not award more gold');
    assert.equal(afterCap[ids[1]].gold, 610);
    assert.equal(JSON.parse(afterCap[ids[0]].quests).dungeonRuns, 3);
    assert.equal(results[ids[0]].length, 1, 'a denied extra entry must not produce a second combat result');

    const sharedLootCount = ids.slice(0, 2).reduce((count, id) => count + JSON.parse(saved[id].inventory).filter((item: string) => item === 'FLDROP-03-10-A').length, 0);
    assert.equal(sharedLootCount, 1, 'the guaranteed dungeon resource is awarded once to one group member');
    const lossLootCount = ids.slice(2).reduce((count, id) => count + JSON.parse(saved[id].inventory).filter((item: string) => item === 'FLDROP-03-10-A').length, 0);
    assert.equal(lossLootCount, 0, 'a failed group receives no dungeon loot');
  } finally {
    for (const room of rooms) await room.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
