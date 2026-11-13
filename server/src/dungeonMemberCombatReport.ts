export type DungeonMemberCombatRewards = { xp: number; gold: number; loot: string };

export type DungeonMemberCombatReportInput = {
  baseReport: Record<string, any>;
  profession: string | null | undefined;
  level: number;
  attack: number;
  defense: number;
  damage: number;
  received: number;
  hpBefore: number;
  hpAfter: number;
  maxHealth: number;
  rewards?: DungeonMemberCombatRewards;
};

/** Builds the existing per-member report shape without mutating the shared report. */
export function buildDungeonMemberCombatReport(input: DungeonMemberCombatReportInput): Record<string, any> {
  const report: Record<string, any> = {
    ...input.baseReport,
    profession: input.profession || 'Без профессии',
    level: input.level,
    attack: Math.floor(input.attack),
    defense: Math.floor(input.defense),
    damage: Math.floor(input.damage),
    received: input.received,
    hpBefore: input.hpBefore,
    hpAfter: input.hpAfter,
    maxHealth: input.maxHealth,
  };
  if (input.rewards) report.rewards = { ...input.rewards };
  return report;
}
