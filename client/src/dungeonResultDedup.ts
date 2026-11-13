export type DungeonResultEventStorage = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
};

const MAX_REMEMBERED_DUNGEON_RESULT_EVENTS = 500;
const claimedInSession = new Set<string>();

/** Claims a durable result event before applying UI side effects. */
export function claimDungeonResultEvent(
  playerId: string,
  eventId: unknown,
  storage?: DungeonResultEventStorage,
): boolean {
  if (typeof eventId !== 'string' || !eventId.trim()) return true;
  const normalizedPlayerId = String(playerId || '').trim();
  if (!normalizedPlayerId) return true;

  const memoryKey = `${normalizedPlayerId}:${eventId}`;
  if (claimedInSession.has(memoryKey)) return false;

  const storageKey = `misty_dungeon_result_events_${normalizedPlayerId}`;
  let remembered: string[] = [];
  if (storage) {
    try {
      const parsed: unknown = JSON.parse(storage.getItem(storageKey) || '[]');
      if (Array.isArray(parsed)) remembered = parsed.filter((value): value is string => typeof value === 'string');
    } catch {
      remembered = [];
    }
  }

  if (remembered.includes(eventId)) {
    claimedInSession.add(memoryKey);
    return false;
  }

  claimedInSession.add(memoryKey);
  if (storage) {
    try {
      const next = [...remembered.filter(value => value !== eventId), eventId]
        .slice(-MAX_REMEMBERED_DUNGEON_RESULT_EVENTS);
      storage.setItem(storageKey, JSON.stringify(next));
    } catch {
      // Session-level dedup remains active when persistent browser storage is unavailable.
    }
  }
  return true;
}
