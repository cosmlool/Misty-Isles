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

function readPlayer(path: string, id: string): any {
  return JSON.parse(readFileSync(path, 'utf8'))[id];
}

test('story, faction, daily challenge and achievement rewards cannot be claimed twice', { timeout: 60_000 }, async () => {
  const dataDir = mkdtempSync(join(tmpdir(), 'misty-quest-rewards-'));
  const playerId = 'runtime_quest_rewards_01';
  const today = new Date().toISOString().slice(0, 10);
  const port = await unusedPort();
  let child: ChildProcess | undefined;
  let room: Room | undefined;
  const savePath = join(dataDir, 'players.json');
  try {
    for (const file of staticDataFiles) copyFileSync(join(serverDir, 'data', file), join(dataDir, file));
    writeFileSync(savePath, JSON.stringify({
      [playerId]: {
        id: playerId, name: 'Quest Tester', race: 'Кот', profession: '', level: 10,
        victories: 8, mobsKilled: 25, bossesKilled: 1, battles: 50, mining: 10,
        itemsCrafted: 10, itemsSold: 10, gold: 1_000, goldEarned: 100_000, experience: 0,
        inventory: '[]', equipment: '{}', collections: '{}', achievements: '{}',
        cityReputation: JSON.stringify({ faction_dawn: 100 }),
        quests: JSON.stringify({
          factionDawnKills: 5, challengeDay: today, dailyHunts: 3,
        }),
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
    const sendAndWait = async (type: string, data: Record<string, unknown>, label: string) => {
      const before = notices.length;
      room!.send(type, data);
      return waitFor(() => notices.length > before ? notices[before] : undefined, label);
    };

    await sendAndWait('quest', { id: 'story_1' }, 'story chapter one');
    const afterStoryOne = readPlayer(savePath, playerId);
    assert.equal(afterStoryOne.gold, 1_180);
    assert.equal(JSON.parse(afterStoryOne.quests).story_1, true);
    const duplicateStory = await sendAndWait('quest', { id: 'story_1' }, 'duplicate story claim');
    assert.equal(duplicateStory, 'Эта глава уже завершена.');
    assert.equal(readPlayer(savePath, playerId).gold, 1_180, 'story reward must not be duplicated');

    await sendAndWait('quest', { id: 'story_2' }, 'story chapter two');
    const afterStoryTwo = readPlayer(savePath, playerId);
    const storyTwoReputation = JSON.parse(afterStoryTwo.cityReputation);
    assert.equal(storyTwoReputation['Золотые дюны'], 10, 'chapter two reputation must use the current city name');
    assert.equal(storyTwoReputation['Серебряный бастион'], undefined, 'chapter two must not create legacy city reputation');
    await sendAndWait('quest', { id: 'story_3' }, 'story chapter three');
    const afterStoryThree = readPlayer(savePath, playerId);
    const storyThreeReputation = JSON.parse(afterStoryThree.cityReputation);
    assert.equal(storyThreeReputation['Изумрудная долина'], 10, 'chapter three reputation must use the current city name');
    assert.equal(storyThreeReputation['Гавань семи ветров'], undefined, 'chapter three must not create legacy city reputation');
    await sendAndWait('factionChoice', { choice: 'dawn' }, 'faction choice');
    const lockedChoice = await sendAndWait('factionChoice', { choice: 'caravan' }, 'second faction choice');
    assert.equal(lockedChoice, 'Сюжетный выбор уже сделан и повлиял на отношения фракций.');
    await sendAndWait('quest', { id: 'faction_story_1' }, 'faction story chapter');
    const duplicateFaction = await sendAndWait('quest', { id: 'faction_story_1' }, 'duplicate faction story');
    assert.equal(duplicateFaction, 'Эта фракционная глава уже завершена.');
    const afterFaction = readPlayer(savePath, playerId);
    assert.equal(JSON.parse(afterFaction.quests).faction_story_1, true);
    assert.equal(JSON.parse(afterFaction.inventory).filter((id: string) => id === 'faction_seal_dawn').length, 1);

    await sendAndWait('quest', { id: 'faction_reward_dawn' }, 'faction maximum reward');
    const afterFactionReward = readPlayer(savePath, playerId);
    assert.equal(JSON.parse(afterFactionReward.quests).faction_reward_dawn, true);
    assert.equal(JSON.parse(afterFactionReward.collections).title_dawn, 'Заступник Первого Рассвета');
    const factionGold = afterFactionReward.gold;
    const duplicateMaxReward = await sendAndWait('quest', { id: 'faction_reward_dawn' }, 'duplicate faction maximum reward');
    assert.equal(duplicateMaxReward, 'Эксклюзивная награда уже получена.');
    assert.equal(readPlayer(savePath, playerId).gold, factionGold);

    await sendAndWait('quest', { id: 'daily_challenge' }, 'daily challenge reward');
    const afterDaily = readPlayer(savePath, playerId);
    const dailyGold = afterDaily.gold;
    const duplicateDaily = await sendAndWait('quest', { id: 'daily_challenge' }, 'duplicate daily challenge');
    assert.equal(duplicateDaily, 'Награда за это испытание уже получена.');
    assert.equal(readPlayer(savePath, playerId).gold, dailyGold);

    await sendAndWait('achievements', {}, 'achievement rewards');
    const afterAchievements = readPlayer(savePath, playerId);
    assert.equal(JSON.parse(afterAchievements.achievements).battles_50, true);
    assert.equal(JSON.parse(afterAchievements.achievements).kills_25, true);
    const achievementGold = afterAchievements.gold;
    await sendAndWait('achievements', {}, 'repeat achievement request');
    assert.equal(readPlayer(savePath, playerId).gold, achievementGold, 'achievement rewards must be one-time');
  } finally {
    if (room) await room.leave().catch(() => undefined);
    if (child) await stopServer(child);
    rmSync(dataDir, { recursive: true, force: true });
  }
});
