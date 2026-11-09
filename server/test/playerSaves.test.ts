import { strict as assert } from 'node:assert';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createPlayerSaveStore } from '../src/playerSaves.js';

function fixture(){
  const dir=mkdtempSync(join(tmpdir(),'misty-player-saves-'));
  const file=join(dir,'players.json');
  return {dir,file,store:createPlayerSaveStore(file,dir),cleanup:()=>rmSync(dir,{recursive:true,force:true})};
}

test('first launch returns an empty player map when the save file is absent',()=>{
  const f=fixture();
  try{assert.deepEqual(f.store.loadPlayers(),{});assert.equal(readdirSync(f.dir).length,0);}
  finally{f.cleanup();}
});

test('valid player data loads and saves with a backup of the previous file',()=>{
  const f=fixture();
  try{
    const previous={player_a:{id:'player_a',gold:125}};
    writeFileSync(f.file,JSON.stringify(previous));
    assert.deepEqual(f.store.loadPlayers(),previous);
    const next={...previous,player_a:{id:'player_a',gold:200}};
    f.store.savePlayers(next);
    assert.deepEqual(JSON.parse(readFileSync(f.file,'utf8')),next);
    const backups=readdirSync(f.dir).filter(x=>x.endsWith('.bak'));
    assert.equal(backups.length,1);
    assert.deepEqual(JSON.parse(readFileSync(join(f.dir,backups[0]),'utf8')),previous);
  }finally{f.cleanup();}
});

test('malformed JSON is rejected without changing the original file',()=>{
  const f=fixture();
  try{
    const corrupt='{"player_a":';
    writeFileSync(f.file,corrupt);
    assert.throws(()=>f.store.loadPlayers(),/некорректный JSON/);
    assert.equal(readFileSync(f.file,'utf8'),corrupt);
    assert.equal(readdirSync(f.dir).filter(x=>x.endsWith('.bak')).length,0);
  }finally{f.cleanup();}
});

test('invalid root values and invalid player entries are rejected',()=>{
  const f=fixture();
  try{
    for(const value of ['null','[]','42','"text"','{"player_a":null}','{"player_a":[]}']){
      writeFileSync(f.file,value);
      assert.throws(()=>f.store.loadPlayers());
      assert.equal(readFileSync(f.file,'utf8'),value);
    }
  }finally{f.cleanup();}
});

test('backup failure cancels the save and preserves the original data',()=>{
  const f=fixture();
  try{
    writeFileSync(f.file,'{"original":{"id":"original"}}');
    // A directory at the backup-temp path makes the backup copy fail deterministically.
    // Use an existing directory as the save target to force copyFileSync to fail safely.
    const dirTarget=join(f.dir,'directory-save');
    mkdirSync(dirTarget);
    const store=createPlayerSaveStore(dirTarget,f.dir);
    assert.throws(()=>store.savePlayers({new_player:{id:'new_player'}}),/резервную копию/);
    assert.equal(readdirSync(dirTarget).length,0);
    assert.equal(readFileSync(f.file,'utf8'),'{"original":{"id":"original"}}');
  }finally{f.cleanup();}
});


test('retains only the newest five backups after successful saves',()=>{
  const f=fixture();
  try{
    writeFileSync(f.file,JSON.stringify({player_a:{id:'player_a',gold:0}}));
    for(let gold=1;gold<=7;gold++)f.store.savePlayers({player_a:{id:'player_a',gold}});
    const backups=readdirSync(f.dir).filter(name=>/^players\.json\..+\.bak$/.test(name)).sort();
    assert.equal(backups.length,5);
    const savedGold=backups.map(name=>JSON.parse(readFileSync(join(f.dir,name),'utf8')).player_a.gold);
    assert.ok(savedGold.includes(2));
    assert.ok(savedGold.includes(6));
    assert.ok(!savedGold.includes(0));
    assert.ok(!savedGold.includes(1));
  }finally{f.cleanup();}
});
