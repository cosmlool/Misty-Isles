import assert from 'node:assert/strict';
import test from 'node:test';
import { dispatchPendingDungeonResultEvents, enqueueDungeonResultEvents } from '../src/dungeonResultOutboxDelivery.js';

function event(eventId:string,playerId:string,status:'pending'|'delivered'='pending',createdAt=1){return {eventId,playerId,messageType:'combatResult',payload:{requestId:eventId,text:'done'},status,createdAt};}

test("dispatches only this player's pending events in stable order and acknowledges after send',()=>{
  const outbox={e2:event('e2','p1','pending',2),e1:event('e1','p1','pending',1),other:event('other','p2'),done:event('done','p1','delivered')};
  const calls:string[]=[];
  const count=dispatchPendingDungeonResultEvents({playerId:'p1',outbox,send:(type,payload)=>{calls.push('send:'+String(payload.requestId));},acknowledge:id=>calls.push('ack:'+id)});
  assert.equal(count,2);
  assert.deepEqual(calls,['send:e1','ack:e1','send:e2','ack:e2']);
});

test('does not acknowledge an event when transport send fails',()=>{
  const calls:string[]=[];
  assert.throws(()=>dispatchPendingDungeonResultEvents({playerId:'p1',outbox:{e1:event('e1','p1'),e2:event('e2','p1')},send:()=>{calls.push('send');throw new Error('socket unavailable');},acknowledge:()=>calls.push('ack')}),/socket unavailable/);
  assert.deepEqual(calls,['send']);
});

test('does not acknowledge when persistence acknowledgement fails',()=>{
  const calls:string[]=[];
  assert.throws(()=>dispatchPendingDungeonResultEvents({playerId:'p1',outbox:{e1:event('e1','p1')},send:()=>calls.push('send'),acknowledge:()=>{calls.push('ack');throw new Error('wal unavailable');}}),/wal unavailable/);
  assert.deepEqual(calls,['send','ack']);
});

test('ignores malformed event IDs and events belonging to another recipient',()=>{
  const calls:string[]=[];
  const outbox:any={wrong:event('different','p1'),other:event('other','p2')};
  const count=dispatchPendingDungeonResultEvents({playerId:'p1',outbox,send:()=>calls.push('send'),acknowledge:()=>calls.push('ack')});
  assert.equal(count,0);
  assert.deepEqual(calls,[]);
});


test('enqueue creates durable pending events and preserves identical retries',()=>{
  const event={eventId:'dungeon:run_1:p1:combatResult',runId:'run_1',playerId:'p1',messageType:'combatResult',payload:{requestId:'req1'}};
  const first=enqueueDungeonResultEvents({outbox:{},events:[event],now:10});
  assert.equal(first[event.eventId].status,'pending');
  assert.equal(first[event.eventId].createdAt,10);
  const retry=enqueueDungeonResultEvents({outbox:first,events:[event],now:20});
  assert.deepEqual(retry,first);
});

test('enqueue rejects an event ID reused for a different payload',()=>{
  const event={eventId:'dungeon:run_1:p1:combatResult',runId:'run_1',playerId:'p1',messageType:'combatResult',payload:{requestId:'req1'}};
  const first=enqueueDungeonResultEvents({outbox:{},events:[event],now:10});
  assert.throws(()=>enqueueDungeonResultEvents({outbox:first,events:[{...event,payload:{requestId:'other'}}],now:20}),/already bound/);
});
