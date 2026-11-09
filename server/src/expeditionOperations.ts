export type ExpeditionTravelState = {
  state?: string;
  endsAt?: number;
  groupId?: string;
  currentZoneId?: string;
  targetZoneId?: string;
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

export type ExpeditionTravelConsistency =
  | { consistent: true }
  | { consistent: false; reason: 'not-moving' | 'mismatch' };

export function checkExpeditionTravelConsistency(
  states: ExpeditionTravelState[],
  expectedGroupId: string,
): ExpeditionTravelConsistency {
  if (!states.length || states.some(state => state.state !== 'moving')) {
    return { consistent: false, reason: 'not-moving' };
  }
  const first = states[0]!;
  if (typeof first.currentZoneId !== 'string' || !first.currentZoneId
    || typeof first.targetZoneId !== 'string' || !first.targetZoneId) {
    return { consistent: false, reason: 'mismatch' };
  }
  if (states.some(state => String(state.groupId || '') !== expectedGroupId
    || state.currentZoneId !== first.currentZoneId
    || state.targetZoneId !== first.targetZoneId)) {
    return { consistent: false, reason: 'mismatch' };
  }
  return { consistent: true };
}
