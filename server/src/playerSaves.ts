import { randomBytes } from 'crypto';
import { copyFileSync, existsSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';

export function createPlayerSaveStore(saveFile:string,dataDir:string){
  function loadPlayers():Record<string,any>{
    if(!existsSync(saveFile))return {};
    let raw:string;
    try{raw=readFileSync(saveFile,'utf8');}
    catch{throw new Error('Файл сохранений players.json существует, но его не удалось прочитать. Запись остановлена, исходный файл сохранён.');}
    let parsed:any;
    try{parsed=JSON.parse(raw);}
    catch{throw new Error('Файл сохранений players.json содержит некорректный JSON. Запись остановлена, исходный файл сохранён.');}
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Файл сохранений players.json имеет неверный формат: ожидался объект игроков. Запись остановлена.');
    for(const [id,player] of Object.entries(parsed)){
      if(!player||typeof player!=='object'||Array.isArray(player))throw new Error('Запись игрока '+id+' в players.json имеет неверный формат. Запись остановлена.');
    }
    return parsed as Record<string,any>;
  }

  function savePlayers(all:Record<string,any>){
    let backupFile:string|undefined;
    if(existsSync(saveFile)){
      const suffix=new Date().toISOString().replace(/[:.]/g,'-')+'.'+process.pid+'.'+randomBytes(4).toString('hex');
      backupFile=saveFile+'.'+suffix+'.bak';
      const backupTemp=backupFile+'.tmp';
      try{
        copyFileSync(saveFile,backupTemp);
        renameSync(backupTemp,backupFile);
      }catch{
        try{if(existsSync(backupTemp))unlinkSync(backupTemp);}catch{}
        throw new Error('Не удалось создать резервную копию players.json. Сохранение отменено; исходный файл не изменён.');
      }
    }

    const temp=saveFile+'.'+process.pid+'.'+Date.now()+'.'+randomBytes(4).toString('hex')+'.tmp';
    try{
      writeFileSync(temp,JSON.stringify(all,null,2),{encoding:'utf8',flag:'wx'});
      renameSync(temp,saveFile);
    }catch(error){
      try{if(existsSync(temp))unlinkSync(temp);}catch{}
      throw error;
    }

    // Prune old backups only after the new save has been committed successfully.
    try{
      const backups=readdirSync(dataDir).filter(name=>/^players\\.json\\..+\\.bak$/.test(name)).sort();
      for(const old of backups.slice(0,Math.max(0,backups.length-5))){
        try{unlinkSync(join(dataDir,old));}catch{}
      }
    }catch{}
  }

  return {loadPlayers,savePlayers};
}
