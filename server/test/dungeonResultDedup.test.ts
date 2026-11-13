import assert from 'node:assert/strict';
import test from 'node:test';
import { claimDungeonResultEvent } from '../../client/src/dungeonResultDedup.js';

function storage(){
  const values=new Map<string,string>();
  return {getItem:(key:string)=>values.get(key)??null,setItem:(key:string,value:string)=>values.set(key,value),values};
}

test('claims a dungeon result once and suppresses same-session replay',()=>{
  const local=storage();
  assert.equal(claimDungeonResultEvent('p1','event-1',local),true);
  assert.equal(claimDungeonResultEvent('p1','event-1',local),false);
});

test('persists event IDs so reconnect or page reload replay is suppressed',()=>{
  const local=storage();
  assert.equal(claimDungeonResultEvent('reload-player','event-reload',local),true);
  // A different player ID represents a separate browser account namespace.
  assert.equal(claimDungeonResultEvent('other-player','event-reload',local),true);
  assert.equal(claimDungeonResultEvent('reload-player','event-reload',local),false);
});

test('accepts distinct events and keeps player namespaces isolated',()=>{
  const local=storage();
  assert.equal(claimDungeonResultEvent('p1','event-a',local),true);
  assert.equal(claimDungeonResultEvent('p1','event-b',local),true);
  assert.equal(claimDungeonResultEvent('p2','event-a',local),true);
});

test('recovers from malformed persisted history and bounds its size',()=>{
  const local=storage();
  local.setItem('misty_dungeon_result_events_p1','not-json');
  assert.equal(claimDungeonResultEvent('p1','recovered-event',local),true);
  const stored=JSON.parse(local.getItem('misty_dungeon_result_events_p1')||'[]');
  assert.deepEqual(stored,['recovered-event']);
});

test('events without stable IDs remain processable for legacy messages',()=>{
  const local=storage();
  assert.equal(claimDungeonResultEvent('p1',undefined,local),true);
  assert.equal(claimDungeonResultEvent('p1','',local),true);
});
