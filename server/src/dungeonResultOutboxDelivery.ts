export type DungeonResultDeliveryEvent = {
  eventId: string;
  runId: string;
  playerId: string;
  messageType: string;
  payload: Record<string, unknown>;
  status: 'pending' | 'delivered';
  createdAt: number;
};

export type DungeonResultDeliveryOutbox = Record<string, DungeonResultDeliveryEvent>;

/** Sends only this player's pending events. Acknowledgement runs strictly after send. */
export function dispatchPendingDungeonResultEvents(input: {
  playerId: string;
  outbox: DungeonResultDeliveryOutbox;
  send: (messageType: string, payload: Record<string, unknown>) => void;
  acknowledge: (eventId: string) => unknown;
}): number {
  if (!input.playerId || !input.outbox || typeof input.outbox !== 'object' || Array.isArray(input.outbox)) {
    throw new Error('Invalid dungeon result delivery request.');
  }
  const pending = Object.entries(input.outbox)
    .filter(([eventId, event]) => event && event.eventId === eventId && event.playerId === input.playerId && event.status === 'pending')
    .sort((a, b) => a[1].createdAt - b[1].createdAt || a[0].localeCompare(b[0]));
  let delivered = 0;
  for (const [eventId, event] of pending) {
    if (!event.messageType || !event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) {
      throw new Error(`Dungeon result outbox event ${eventId} has an invalid message payload.`);
    }
    input.send(event.messageType, event.payload);
    input.acknowledge(eventId);
    delivered += 1;
  }
  return delivered;
}


export function enqueueDungeonResultEvents(input: {
  outbox: DungeonResultDeliveryOutbox;
  events: Array<{eventId:string;runId:string;playerId:string;messageType:string;payload:Record<string,unknown>}>;
  now: number;
}): DungeonResultDeliveryOutbox {
  if (!Number.isFinite(input.now) || !input.outbox || typeof input.outbox !== 'object' || Array.isArray(input.outbox)) {
    throw new Error('Invalid dungeon result enqueue request.');
  }
  const next = { ...input.outbox };
  const seen = new Set<string>();
  for (const event of input.events) {
    if (!event || !event.eventId || !event.runId || !event.playerId || !event.messageType ||
        !event.eventId.startsWith(`dungeon:${event.runId}:`) || !event.payload ||
        typeof event.payload !== 'object' || Array.isArray(event.payload) || seen.has(event.eventId)) {
      throw new Error('Dungeon result event is invalid or duplicated.');
    }
    seen.add(event.eventId);
    const existing = next[event.eventId];
    if (existing) {
      if (existing.runId !== event.runId || existing.playerId !== event.playerId ||
          existing.messageType !== event.messageType || JSON.stringify(existing.payload) !== JSON.stringify(event.payload)) {
        throw new Error('Dungeon result event ID is already bound to a different payload.');
      }
      continue;
    }
    next[event.eventId] = { ...event, status: 'pending', createdAt: input.now };
  }
  return next;
}
