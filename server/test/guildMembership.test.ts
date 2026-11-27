import assert from 'node:assert/strict';
import test from 'node:test';
import { canJoinCombatGuild, joinWorkGuild, WORK_GUILDS } from '../src/guildMembership.js';

test('only the four approved work guilds can be joined from level 20', () => {
  assert.deepEqual(Object.keys(WORK_GUILDS), ['blacksmith', 'miner', 'enchanter', 'trader']);
  assert.equal(joinWorkGuild('', 19, 'blacksmith').ok, false);
  for (const id of Object.keys(WORK_GUILDS)) {
    const result = joinWorkGuild('', 20, id);
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.workGuild, id);
  }
  assert.equal(joinWorkGuild('', 20, 'alchemist').ok, false);
});

test('a character can join only one work guild', () => {
  const result = joinWorkGuild('blacksmith', 80, 'miner');
  assert.equal(result.ok, false);
  assert.equal(result.workGuild, 'blacksmith');
});

test('combat guild access begins at level 40', () => {
  assert.equal(canJoinCombatGuild(39), false);
  assert.equal(canJoinCombatGuild(40), true);
  assert.equal(canJoinCombatGuild(100), true);
});
