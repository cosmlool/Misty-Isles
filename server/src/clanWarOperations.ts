export const CLAN_WAR_ATTACK_COOLDOWN_MS = 1_000;

export type ClanWarRecord = {
  id: string;
  a: string;
  b: string;
  aDamage?: number;
  bDamage?: number;
  status: string;
  endsAt: number;
  lastAttackAtByPlayer?: Record<string, number>;
  [key: string]: unknown;
};

export type ClanWarClan = {
  id?: string;
  level?: number;
  vault?: number;
  seasonPoints?: number;
  questProgress?: Record<string, number>;
  [key: string]: unknown;
};

export function clanWarCooldownRemaining(
  war: ClanWarRecord,
  playerId: string,
  now: number,
  cooldownMs = CLAN_WAR_ATTACK_COOLDOWN_MS,
): number {
  const lastAttackAt = Number(war.lastAttackAtByPlayer?.[playerId] || 0);
  if (!Number.isFinite(lastAttackAt) || lastAttackAt <= 0) return 0;
  return Math.max(0, cooldownMs - (now - lastAttackAt));
}

export function calculateClanWarDamage(
  attackerPower: number,
  defenderPower: number,
  variance = 0,
): number {
  if (![attackerPower, defenderPower, variance].every(Number.isFinite)) {
    throw new Error('Clan war combat power must be finite.');
  }
  return Math.max(1, Math.floor(attackerPower + variance - defenderPower));
}

export function recordClanWarDamage(
  war: ClanWarRecord,
  clanId: string,
  playerId: string,
  damage: number,
  now: number,
): ClanWarRecord {
  if (war.status !== 'active' || ![war.a, war.b].includes(clanId)) {
    throw new Error('Clan is not participating in an active war.');
  }
  if (!playerId || !Number.isInteger(damage) || damage < 1 || !Number.isFinite(now)) {
    throw new Error('Clan war attack is invalid.');
  }
  const lastAttackAtByPlayer = { ...(war.lastAttackAtByPlayer || {}) };
  lastAttackAtByPlayer[playerId] = now;
  return {
    ...war,
    aDamage: Math.max(0, Number(war.aDamage) || 0) + (war.a === clanId ? damage : 0),
    bDamage: Math.max(0, Number(war.bDamage) || 0) + (war.b === clanId ? damage : 0),
    lastAttackAtByPlayer,
  };
}

export function settleExpiredClanWars(
  wars: ClanWarRecord[],
  clans: Record<string, ClanWarClan>,
  now: number,
): { wars: ClanWarRecord[]; clans: Record<string, ClanWarClan>; changed: boolean } {
  const nextWars = wars.map(war => ({ ...war, lastAttackAtByPlayer: { ...(war.lastAttackAtByPlayer || {}) } }));
  const nextClans: Record<string, ClanWarClan> = Object.fromEntries(
    Object.entries(clans).map(([id, clan]) => [
      id,
      { ...clan, questProgress: { ...(clan.questProgress || {}) } },
    ]),
  );
  let changed = false;

  for (const war of nextWars) {
    if (war.status !== 'active' || now < Number(war.endsAt || 0)) continue;
    war.status = 'finished';
    war.finishedAt = now;
    const aDamage = Math.max(0, Number(war.aDamage) || 0);
    const bDamage = Math.max(0, Number(war.bDamage) || 0);
    const winnerId = aDamage === bDamage ? '' : aDamage > bDamage ? war.a : war.b;
    war.winnerId = winnerId;
    if (winnerId) {
      const winner = nextClans[winnerId];
      if (winner) {
        const reward = 100 + Math.max(1, Number(winner.level) || 1) * 50;
        winner.vault = Math.max(0, Number(winner.vault) || 0) + reward;
        winner.seasonPoints = Math.max(0, Number(winner.seasonPoints) || 0) + 20;
        winner.questProgress = winner.questProgress || {};
        winner.questProgress.war = Math.max(0, Number(winner.questProgress.war) || 0) + 1;
        war.reward = reward;
      }
    } else {
      war.reward = 0;
    }
    changed = true;
  }

  return { wars: nextWars, clans: nextClans, changed };
}
