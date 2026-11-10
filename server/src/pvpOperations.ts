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
  _attackerLevel: number,
  now: number,
  random: () => number = Math.random,
  previouslyOfferedIds: readonly string[] = [],
): T[] {
  const eligible = Object.entries(players)
    .filter(([id, player]) => id !== attackerId
      && Boolean(player?.race)
      && Number.isFinite(Number(player?.level))
      && pvpImmunityRemaining(player, now) === 0)
    .map(([id, player]) => ({ id, player }));

  const shuffle = <V>(values: V[]): V[] => {
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.min(i, Math.max(0, Math.floor(random() * (i + 1))));
      [values[i], values[j]] = [values[j], values[i]];
    }
    return values;
  };
  const previous = new Set(previouslyOfferedIds);
  const fresh = shuffle(eligible.filter(entry => !previous.has(entry.id)));
  // Prefer a completely new group. If fewer than four alternatives exist,
  // fill remaining slots from the full eligible pool to keep the arena usable.
  const selected = fresh.length >= PVP_OPPONENT_COUNT
    ? fresh.slice(0, PVP_OPPONENT_COUNT)
    : shuffle([...fresh, ...shuffle(eligible.filter(entry => previous.has(entry.id)))])
        .slice(0, PVP_OPPONENT_COUNT);
  return selected.map(entry => entry.player);
}

export function isPvpTargetOffered(offeredIds: unknown, targetId: string): boolean {
  return Array.isArray(offeredIds) && offeredIds.includes(targetId);
}

export function calculatePvpGoldTransfer(loserGold: number): number {
  const balance = Number(loserGold);
  if (!Number.isFinite(balance) || balance <= 0) return 0;
  return Math.floor(balance * PVP_GOLD_STEAL_RATE);
}
