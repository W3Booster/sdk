import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLocalRecorderUpdates } from '../src/internal/recorder.js';

test('resource updates preserve self-play ownership, conversion, scope and match identity', () => {
  const state = { capabilities:['resources'], gameContext:{hudScale:1}, match:{id:'match',status:'running',gameTime:10,mode:'1v1',broadcasterPlayerId:'1',realBroadcasterPlayerId:'0'}, players:[{id:'0'},{id:'1'}] };
  const updates = [0,1].flatMap(slotId => [
    {class:'W3Resource',matchId:'match',slotId,type:1,value:1250},
    {class:'W3Resource',matchId:'match',slotId,type:2,value:0},
    {class:'W3Resource',matchId:'match',slotId,type:5,value:34},
    {class:'W3Resource',matchId:'match',slotId,type:4,value:50}
  ]);
  const applied = applyLocalRecorderUpdates(state,updates);
  assert.deepEqual(applied.players[0].resources,{gold:125,lumber:0,supply:34,supplyCap:50,workerSupply:0});
  assert.equal(applied.players[1].resources,undefined);
  assert.equal(state.players[0].resources,undefined);
  assert.equal(applyLocalRecorderUpdates({...state,capabilities:[]},updates).players[0].resources,undefined);
  assert.equal(applyLocalRecorderUpdates({...state,match:{...state.match,id:'next'}},updates).players[0].resources,undefined);
  for(const flag of ['isObserver','isReplay']) {
    assert.equal(applyLocalRecorderUpdates({...state,match:{...state.match,[flag]:true}},updates).players[1].resources.gold,125);
  }
  assert.equal(applyLocalRecorderUpdates({...state,match:{...state.match,realBroadcasterPlayerId:undefined}},updates).players[0].resources,undefined);
});
