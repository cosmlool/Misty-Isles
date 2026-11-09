export type ExpeditionTravelState = {
  state?: string;
  endsAt?: number;
};

export type ExpeditionTravelReadiness =
  | { ready: true; remainingMs: 0 }
  | { ready: false; reason: 'not-moving'; remainingMs: 0 }
  | { ready: false; reason: 'waiting'; remainingMs: number };

export function checkExpeditionTravelReadiness(
  states: ExpeditionTravelState[],
  now: number,
): ExpeditionTravelReadiness {
  if (!states.length || states.some(state => state.state !== 'moving')) {
    return { ready: false, reason: 'not-moving', remainingMs: 0 };
  }
  const remainingMs = Math.max(0, ...states.map(state => Number(state.endsAt || 0) - now));
  if (remainingMs > 0) return { ready: false, reason: 'waiting', remainingMs };
  return { ready: true, remainingMs: 0 };
}
