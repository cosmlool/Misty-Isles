export const WORK_GUILDS = {
  blacksmith: 'Кузнец',
  miner: 'Шахтёр',
  enchanter: 'Зачарователь',
  trader: 'Торговец',
} as const;

export type WorkGuildId = keyof typeof WORK_GUILDS;

export type WorkGuildJoinResult =
  | { ok: true; workGuild: WorkGuildId }
  | { ok: false; workGuild: string; error: string };

export function joinWorkGuild(currentGuild: unknown, level: unknown, requestedGuild: unknown): WorkGuildJoinResult {
  const current = String(currentGuild ?? '');
  const requested = String(requestedGuild ?? '');
  if (!Object.prototype.hasOwnProperty.call(WORK_GUILDS, requested)) {
    return { ok: false, workGuild: current, error: 'Такой рабочей гильдии нет.' };
  }
  if (Number(level) < 20) {
    return { ok: false, workGuild: current, error: 'Рабочие гильдии доступны с 20 уровня.' };
  }
  if (current) {
    return { ok: false, workGuild: current, error: 'Рабочая гильдия уже выбрана и не меняется.' };
  }
  return { ok: true, workGuild: requested as WorkGuildId };
}

export function canJoinCombatGuild(level: unknown): boolean {
  return Number(level) >= 40;
}
