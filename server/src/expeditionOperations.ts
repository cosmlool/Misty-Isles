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
  const endsAt = states.map(state => Number(state.endsAt));
  if (endsAt.some(value => !Number.isFinite(value) || value <= 0)) {
    return { ready: false, reason: 'not-moving', remainingMs: 0 };
  }
  const remainingMs = Math.max(0, ...endsAt.map(value => value - now));
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

export type ExpeditionTravelStartReadiness =
  | { ready: true }
  | { ready: false; reason: 'empty' | 'busy' };

export function checkExpeditionTravelStartReadiness(states: ExpeditionTravelState[]): ExpeditionTravelStartReadiness {
  if (!states.length) return { ready: false, reason: 'empty' };
  if (states.some(state => state.state === 'searching' || state.state === 'moving')) {
    return { ready: false, reason: 'busy' };
  }
  return { ready: true };
}


/** A hunt group is valid only when every member is within the leader's level window. */
export function isHuntGroupLevelRangeValid(leaderLevel: number, memberLevels: number[], maxDifference = 5): boolean {
  if (!Number.isFinite(leaderLevel) || !Number.isFinite(maxDifference) || maxDifference < 0 || !memberLevels.length) return false;
  return memberLevels.every(level => Number.isFinite(level) && Math.abs(level - leaderLevel) <= maxDifference);
}


export function invalidateHuntGroupInvites(invites:Map<string,string>,groupId:string,expiries?:Map<string,number>):number{
  if(!groupId)return 0;
  let removed=0;
  for(const [playerId,invitedGroupId] of invites){
    if(invitedGroupId!==groupId)continue;
    invites.delete(playerId);
    expiries?.delete(playerId);
    removed++;
  }
  return removed;
}


/** Counts outstanding invitations that reserve slots in a specific group. */
export function countHuntGroupInvites(invites:Map<string,string>,groupId:string):number{
  if(!groupId)return 0;
  let count=0;
  for(const invitedGroupId of invites.values())if(invitedGroupId===groupId)count++;
  return count;
}

/** Pending invitations reserve capacity so a leader cannot over-invite a group. */
export function canInviteToHuntGroup(memberCount:number,pendingInviteCount:number,maxMembers=3):boolean{
  return Number.isInteger(memberCount)&&Number.isInteger(pendingInviteCount)&&Number.isInteger(maxMembers)
    &&memberCount>=1&&pendingInviteCount>=0&&maxMembers>=1
    &&memberCount+pendingInviteCount<maxMembers;
}


/** Removes expired invitations and their matching expiry records. */
export function expireHuntGroupInvites(
  invites:Map<string,string>,
  expiries:Map<string,number>,
  now:number,
):number{
  let removed=0;
  for(const [playerId,expiresAt] of expiries){
    if(!Number.isFinite(expiresAt)||expiresAt<=now){
      expiries.delete(playerId);
      invites.delete(playerId);
      removed++;
    }
  }
  return removed;
}
