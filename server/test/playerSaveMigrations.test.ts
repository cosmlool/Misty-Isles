import assert from 'node:assert/strict';
import test from 'node:test';
import { migrateLegacyCityReputation, migrateLegacyVisitedCities } from '../src/playerSaveMigrations.js';

const aliases = {
  'Вольный перекрёсток': 'Каменный порт',
  'Гавань семи ветров': 'Изумрудная долина',
};

test('legacy city reputation migration preserves the highest valid numeric value', () => {
  assert.deepEqual(migrateLegacyCityReputation({
    'Вольный перекрёсток': 40,
    'Каменный порт': 25,
    'Гавань семи ветров': 12,
  }, aliases), {
    'Каменный порт': 40,
    'Изумрудная долина': 12,
  });
});

test('legacy city reputation migration retains malformed and negative values without coercion', () => {
  const source = {
    'Вольный перекрёсток': '40',
    'Каменный порт': 25,
    'Гавань семи ветров': -3,
    'Изумрудная долина': 10,
  };
  assert.deepEqual(migrateLegacyCityReputation(source, aliases), source);
  assert.deepEqual(source, {
    'Вольный перекрёсток': '40',
    'Каменный порт': 25,
    'Гавань семи ветров': -3,
    'Изумрудная долина': 10,
  }, 'migration must not mutate the source snapshot');
});

test('legacy visited-city migration moves only explicit true flags', () => {
  assert.deepEqual(migrateLegacyVisitedCities({
    'visited_Вольный перекрёсток': true,
    'visited_Каменный порт': false,
    'visited_Гавань семи ветров': 'false',
  }, aliases), {
    'visited_Каменный порт': true,
    'visited_Гавань семи ветров': 'false',
  });
});
