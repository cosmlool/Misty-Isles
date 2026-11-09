const PVP_BOT_IDS = new Set(['bot_ember', 'bot_bastion', 'bot_gale', 'bot_relic']);

export const PVP_ATTACK_COOLDOWN_MS = 15 * 60 * 1000;
export const PVP_IMMUNITY_MS = 60 * 60 * 1000;
export const PVP_GOLD_STEAL_RATE = 0.20;
export const PVP_OPPONENT_COUNT = 4;

export type PvpPlayerLike = {
  id?: string;
  race?: string;
  level?: number;
  gold?: number;
  quests?: string | Record<string, any>;
};

export function isKnownPvpBotId(id: string): boolean {
  return PVP_BOT_IDS.has(String(id || ''));
}

export function readPvpState(player: PvpPlayerLike): Record<string, any> {
  let quests: any = player?.quests ?? {};
  if (typeof quests === 'string') {
    try { quests = JSON.parse(quests); } catch { quests = {}; }
  }
  if (!quests || typeof quests !== 'object' || Array.isArray(quests)) return {};
  const state = quests.pvp;
  return state && typeof state === 'object' && !Array.isArray(state) ? state : {};
}

export function pvpCooldownRemaining(lastAttackAt: number, now: number): number {
  const last = Number(lastAttackAt) || 0;
  return Math.max(0, last + PVP_ATTACK_COOLDOWN_MS - now);
}

export function pvpImmunityRemaining(player: PvpPlayerLike, now: number): number {
  return Math.max(0, (Number(readPvpState(player).immunityUntil) || 0) - now);
}

export function selectPvpOpponents<T extends PvpPlayerLike>(
  players: Record<string, T>,
  attackerId: string,
  attackerLevel: number,
  now: number,
  random: () => number = Math.random,
): T[] {
  const eligible = Object.entries(players)
    .filter(([id, player]) => id !== attackerId
      && Boolean(player?.race)
      && Number.isFinite(Number(player?.level))
      && Math.abs(Number(player.level) - attackerLevel) <= 2
      && pvpImmunityRemaining(player, now) === 0)
    .map(([, player]) => player);

  // Fisher–Yates keeps the four offered opponents random without sorting the full player list.
  for (let i = eligible.length - 1; i > 0; i -= 1) {
    const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, PVP_OPPONENT_COUNT);
}

export function isPvpTargetOffered(offeredIds: unknown, targetId: string): boolean {
  return Array.isArray(offeredIds) && offeredIds.includes(targetId);
}

export function calculatePvpGoldTransfer(loserGold: number): number {
  const balance = Number(loserGold);
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  return Math.floor(balance * PVP_GOLD_STEAL_RATE);
}
