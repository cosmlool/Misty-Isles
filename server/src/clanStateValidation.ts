export type ClanStore = Record<string, any>;

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isOptionalCounter(value: unknown): boolean {
  return value === undefined || (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0);
}

/** Reject ambiguous clan records rather than silently hiding or repairing member/leader state. */
export function validateClanStore(value: unknown): value is ClanStore {
  if (!isRecord(value)) return false;
  const membership = new Set<string>();
  for (const [key, clan] of Object.entries(value)) {
    if (!isRecord(clan) || typeof clan.id !== 'string' || !clan.id || clan.id !== key
      || typeof clan.name !== 'string' || clan.name.trim().length < 3
      || (clan.leader !== undefined && (typeof clan.leader !== 'string' || !clan.leader))
      || !Number.isSafeInteger(clan.level) || clan.level < 1 || clan.level > 10
      || !isOptionalCounter(clan.xp) || !isOptionalCounter(clan.vault)
      || !isOptionalCounter(clan.seasonPoints) || !Array.isArray(clan.members) || clan.members.length === 0) {
      return false;
    }
    const memberIds = new Set<string>();
    for (const member of clan.members) {
      if (!isRecord(member) || typeof member.id !== 'string' || !member.id || memberIds.has(member.id)
        || (member.contribution !== undefined && !isOptionalCounter(member.contribution))
        || (member.joinedAt !== undefined && (!Number.isSafeInteger(member.joinedAt) || member.joinedAt < 0))) return false;
      if (membership.has(member.id)) return false;
      membership.add(member.id);
      memberIds.add(member.id);
    }
    if (clan.leader !== undefined && !memberIds.has(clan.leader)) return false;
    if (clan.upgrades !== undefined) {
      if (!isRecord(clan.upgrades)) return false;
      for (const name of ['barracks', 'treasury', 'banner']) {
        const level = clan.upgrades[name];
        if (level !== undefined && (!Number.isSafeInteger(level) || level < 0 || level > 5)) return false;
      }
    }
  }
  return true;
}

const TERRITORY_IDS = new Set(['crossroads', 'windharbor', 'silverkeep', 'crystalcourt', 'ashcitadel', 'mistwatch']);

/** Preserve territory ownership; malformed, duplicated or orphaned records fail closed. */
export function validateTerritoryStore(value: unknown, clans: ClanStore): value is any[] {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const territory of value) {
    if (!isRecord(territory) || typeof territory.id !== 'string' || !TERRITORY_IDS.has(territory.id)
      || ids.has(territory.id) || typeof territory.owner !== 'string'
      || (territory.owner !== '' && !Object.values(clans).some(clan => clan.id === territory.owner))
      || !isOptionalCounter(territory.capturedAt) || !isOptionalCounter(territory.defense)) return false;
    ids.add(territory.id);
  }
  return true;
}


/** Validate persisted war identity and active-clan references before any mutation or settlement. */
export function validateClanWarStore(value: unknown, clans: ClanStore): value is Array<Record<string, any>> {
  if (!Array.isArray(value)) return false;
  const ids = new Set<string>();
  for (const war of value) {
    if (!isRecord(war) || typeof war.id !== 'string' || !war.id.trim() || ids.has(war.id)
      || typeof war.a !== 'string' || !war.a || typeof war.b !== 'string' || !war.b || war.a === war.b
      || !['active', 'finished', 'cancelled'].includes(war.status)
      || !Number.isSafeInteger(war.endsAt) || war.endsAt < 0
      || !isOptionalCounter(war.aDamage) || !isOptionalCounter(war.bDamage)
      || (war.createdAt !== undefined && !isOptionalCounter(war.createdAt))
      || (war.finishedAt !== undefined && !isOptionalCounter(war.finishedAt))
      || (war.reward !== undefined && !isOptionalCounter(war.reward))
      || (war.winnerId !== undefined && war.winnerId !== '' && war.winnerId !== war.a && war.winnerId !== war.b)
      || (war.aName !== undefined && typeof war.aName !== 'string')
      || (war.bName !== undefined && typeof war.bName !== 'string')) return false;

    // Historical finished/cancelled wars intentionally outlive a disbanded clan.
    // Only active wars must still point to two extant, distinct clan records.
    if (war.status === 'active' && (!clans[war.a] || !clans[war.b])) return false;

    if (war.lastAttackAtByPlayer !== undefined) {
      if (!isRecord(war.lastAttackAtByPlayer)) return false;
      for (const [playerId, timestamp] of Object.entries(war.lastAttackAtByPlayer)) {
        if (!playerId || !Number.isSafeInteger(timestamp) || (timestamp as number) <= 0) return false;
      }
    }
    ids.add(war.id);
  }
  return true;
}


/** Return the clan roster that currently contains a player, if any. */
export function findPlayerClanMembership(clans: ClanStore, playerId: string): string | null {
  if (!playerId) return null;
  for (const [clanId, clan] of Object.entries(clans)) {
    if (Array.isArray(clan.members) && clan.members.some((member: any) => member?.id === playerId)) return clanId;
  }
  return null;
}


/** Resolve the roster as authoritative when a legacy player.clan field is stale. */
export function resolvePlayerClanForLeave(clans: ClanStore, savedClanId: string, playerId: string): string {
  return findPlayerClanMembership(clans, playerId) ?? savedClanId;
}
