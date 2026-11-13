import assert from 'node:assert/strict';
import test from 'node:test';
import { createDungeonRunRecord, type DungeonRunStore } from '../src/dungeonRunState.js';
import { assertNoOverlappingActiveDungeonRuns, createDungeonRunRecoveryView, findActiveDungeonRunForParticipant, findActiveDungeonRunForParticipants } from '../src/dungeonRunRecovery.js';

function activeRun(runId='run-1', participantIds=['p1','p2']) {
  return createDungeonRunRecord({ runId, requestId:'request_'+runId, dungeonId:'dungeon-20', groupId:'group-1', leaderId:participantIds[0], participants:participantIds.map(playerId=>({playerId,health:80,maxHealth:100})), bossId:'boss-1', bossHealth:500, seed:'seed-1', now:100 });
}

test('finds the active run for a participant and ignores terminal runs',()=>{
  const active=activeRun();
  const old=activeRun('old');
  const terminal={...old,status:'completed' as const,terminalResult:{outcome:'win' as const,committedAt:200,requestId:old.requestId}};
  const store:DungeonRunStore={[active.runId]:active,[old.runId]:terminal};
  assert.equal(findActiveDungeonRunForParticipant(store,'p2')?.runId,'run-1');
  assert.equal(findActiveDungeonRunForParticipant(store,'unknown'),null);
});

test('recovery view includes durable progress but excludes the private encounter seed',()=>{
  const view=createDungeonRunRecoveryView(activeRun(),'p2');
  assert.equal(view?.roundIndex,0); assert.equal(view?.dungeonId,'dungeon-20'); assert.equal(view?.isLeader,false);
  assert.equal(view?.participants.length,2); assert.equal(JSON.stringify(view).includes('seed-1'),false);
});

test('rejects multiple active runs instead of choosing one arbitrarily',()=>{
  const first=activeRun('run-1',['p1']); const second=activeRun('run-2',['p1']);
  assert.throws(()=>findActiveDungeonRunForParticipant({[first.runId]:first,[second.runId]:second},'p1'),/multiple active dungeon runs/);
});

test('does not expose a run to a non-participant',()=>{
  assert.throws(()=>createDungeonRunRecoveryView(activeRun(),'outsider'),/only available to an active run participant/);
});

test('party entry is blocked when a non-leader member already belongs to an active run',()=>{
  const existing=activeRun('existing-run',['p2','p3']);
  const candidate=activeRun('candidate-run',['p1','p2']);
  const match=findActiveDungeonRunForParticipants({[existing.runId]:existing},candidate.participantIds);
  assert.equal(match?.playerId,'p2');
  assert.equal(match?.run.runId,'existing-run');
  assert.equal(findActiveDungeonRunForParticipants({[existing.runId]:existing},['p1']),null);
});

test('party entry validation rejects duplicate or empty participant IDs',()=>{
  const store:DungeonRunStore={};
  assert.throws(()=>findActiveDungeonRunForParticipants(store,['p1','p1']),/unique non-empty/);
  assert.throws(()=>findActiveDungeonRunForParticipants(store,['p1','']),/unique non-empty/);
});


test('startup rejects a durable store with overlapping active participant rosters',()=>{
  const first=activeRun('run-1',['p1','p2']);
  const second=activeRun('run-2',['p2','p3']);
  assert.throws(
    ()=>assertNoOverlappingActiveDungeonRuns({[first.runId]:first,[second.runId]:second}),
    /p2 belongs to overlapping active dungeon runs/
  );
});

test('startup accepts disjoint active runs and ignores terminal history',()=>{
  const first=activeRun('run-1',['p1','p2']);
  const second=activeRun('run-2',['p3']);
  const terminal=activeRun('old',['p2']);
  const completed={...terminal,status:'completed' as const,terminalResult:{outcome:'win' as const,committedAt:200,requestId:terminal.requestId}};
  assert.doesNotThrow(()=>assertNoOverlappingActiveDungeonRuns({
    [first.runId]:first,[second.runId]:second,[completed.runId]:completed
  }));
});
