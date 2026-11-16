export type DungeonGroupCombatReportInput = {
  at: number;
  dungeonName: string;
  bossName: string;
  bossRank: string;
  result: 'win' | 'loss';
  passiveName: string;
  passiveDescription: string;
  weakness: string;
  partySize: number;
  rounds: number;
  xp: number;
  gold: number;
  loot: string;
};

export type DungeonGroupCombatReport = {
  at: number;
  mode: 'Подземелье';
  zone: string;
  enemy: string;
  rank: string;
  result: 'win' | 'loss';
  profession: '';
  level: 0;
  attack: 0;
  defense: 0;
  damage: 0;
  received: 0;
  hpBefore: 0;
  hpAfter: 0;
  maxHealth: 0;
  rewards: { xp: number; gold: number; loot: string };
  lines: string[];
};

/** Builds the legacy shared dungeon report without reading or mutating runtime state. */
export function buildDungeonGroupCombatReport(input: DungeonGroupCombatReportInput): DungeonGroupCombatReport {
  const won = input.result === 'win';
  return {
    at: input.at,
    mode: 'Подземелье',
    zone: input.dungeonName,
    enemy: input.bossName,
    rank: input.bossRank,
    result: input.result,
    profession: '',
    level: 0,
    attack: 0,
    defense: 0,
    damage: 0,
    received: 0,
    hpBefore: 0,
    hpAfter: 0,
    maxHealth: 0,
    rewards: won
      ? { xp: input.xp, gold: input.gold, loot: input.loot }
      : { xp: 0, gold: 0, loot: '' },
    lines: won
      ? [
          `Подземелье: ${input.dungeonName}. Финальный страж: ${input.bossName}.`,
          `Пассивный навык стража: ${input.passiveName} — ${input.passiveDescription}. Слабость: ${input.weakness}.`,
          `Группа: ${input.partySize}/3. Раундов: ${input.rounds}.`,
          'Опыт начислен каждому участнику; золото разделено; предметы распределены между участниками.',
        ]
      : [
          `Группа не прошла подземелье «${input.dungeonName}».`,
          `Страж: ${input.bossName}. Пассивный навык: ${input.passiveName}.`,
          'Попытка израсходована; награды не получены.',
        ],
  };
}
