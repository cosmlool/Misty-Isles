import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'fs';
import { isAbsolute, join, resolve } from 'path';
import { Server, Room, Client } from '@colyseus/core';
import { WebSocketTransport } from '@colyseus/ws-transport';
import { Schema, type } from '@colyseus/schema';
import { Player } from './PlayerSchema.js';
import { normalizeProfession, PROFESSIONS } from './professionProfiles.js';
import { calculatePvpCombatStats, resolvePvpSetBonuses } from './pvpCombat.js';
import { calculateCombatSpeed } from './monsterBattle.js';
import { calculatePlayerMonsterCombatStats, parseMonsterCombatEffectClauses, resolveEquipmentSetCombatEffects, resolveEquipmentSetTierDescriptions, resolveGoldEquipmentStatProfile, resolveMonsterCombatProperty, resolvePlayerMonsterLifestealRate, resolveMonsterPendantCombatEffect } from './monsterCombatStats.js';
import { applyPlayerSave, createPlayerSaveStore } from './playerSaves.js';
import { startPlayerAutosave } from './playerAutosave.js';
import { canSaveRoomPlayerSnapshot, isCurrentRoomSession } from './playerSessionOwnership.js';
import { readJsonFile as readPersistentJson } from './jsonPersistence.js';
import { filterAvailableUniqueItems, isLastEquippedCopy, ownsItemCopy, removeInventoryCopy } from './inventoryOperations.js';
import { purchaseResurrectionScroll, RESURRECTION_SCROLL_ID } from './resurrectionScrolls.js';
import { readPlayerArray as readArray, readPlayerObject as readObject } from './playerJson.js';
import { createAuctionTransactionStore } from './auctionTransactions.js';
import { createClanTransactionStore } from './clanTransactions.js';
import { createSharedStateTransactionStore } from './sharedStateTransactions.js';
import { createSharedStateRuntime } from './sharedStateRuntime.js';
import { validateDungeonRunStore, type DungeonRunRecord } from './dungeonRunState.js';
import { assertNoOverlappingActiveDungeonRuns, createDungeonRunRecoveryView, findActiveDungeonRunForParticipant, findActiveDungeonRunForParticipants } from './dungeonRunRecovery.js';
import { markDungeonResultEventDelivered, type DungeonResultOutbox } from './dungeonRunFinalizationRuntime.js';
import { dispatchPendingDungeonResultEvents, enqueueDungeonResultEvents } from './dungeonResultOutboxDelivery.js';
import { calculateDungeonCombatPlan } from './dungeonCombatMath.js';
import { allocateDungeonDropRecipients, rollDungeonDropIds } from './dungeonDropPreparation.js';
import { buildDungeonMemberCombatReport } from './dungeonMemberCombatReport.js';
import { buildDungeonGroupCombatReport } from './dungeonGroupCombatReport.js';
import { consumeDungeonAttemptForDay, getDungeonRunsForDay } from './dungeonAttemptPreparation.js';
import { prepareDungeonRequestResult } from './dungeonRequestResultPreparation.js';
import { prepareDungeonMemberQuestSettlement } from './dungeonMemberQuestSettlement.js';
import { buyAuctionItem, cancelAuctionItem, listAuctionItem } from './auctionOperations.js';
import { cancelCraftJob, claimCraftJob, startCraftJob } from './craftingQueue.js';
import { calculateClanWarDamage, clanWarCooldownRemaining, disbandClanState, recordClanWarDamage, settleExpiredClanWars } from './clanWarOperations.js';
import { calculatePvpGoldTransfer, resolvePvpOutcome, isPvpTargetOffered, pvpCooldownRemaining, pvpImmunityRemaining, selectPvpOpponents, PVP_ATTACK_COOLDOWN_MS, PVP_IMMUNITY_MS, readPvpState as readPvpStateSafe } from './pvpOperations.js';
import { resetWeeklyHuntProgress, utcIsoWeekKey } from './calendarOperations.js';
import { checkExpeditionTravelConsistency, checkExpeditionTravelReadiness, checkExpeditionTravelStartReadiness, canInviteToHuntGroup, countHuntGroupInvites, expireHuntGroupInvites, invalidateHuntGroupInvites, isHuntGroupLevelRangeValid } from './expeditionOperations.js';
import { parseAdminPlayerIds } from './adminAuthorization.js';
import { isCharacterGender } from './characterIdentity.js';
import { parseMonsterWeakness, resolveLegacyMonsterAttackMultiplier, resolveLegacyMonsterDefenseMultiplier, resolveLegacyMonsterProfessionDamageMultiplier, resolveLegacyMonsterHitMultiplier, resolveLegacyMonsterResistance, resolveLegacyPlayerHitMultiplier, resolveLegacyHealingMultiplier, resolveLegacyMonsterWeaknessMultiplier, resolveMonsterPassive } from './monsterCombat.js';

const ONLINE_PLAYERS = new Map<string, Player>();
const ONLINE_CLIENTS = new Map<string, Client>();
const ONLINE_SESSION_HASHES = new Map<string, string>();
type HuntGroup = { id:string; leader:string; members:string[] };
const HUNT_GROUPS = new Map<string, HuntGroup>();
const PLAYER_GROUP = new Map<string,string>();
const GROUP_INVITES = new Map<string,string>();
const GROUP_INVITE_EXPIRES = new Map<string,number>();
const HUNT_GROUP_INVITE_TTL_MS = 5 * 60 * 1000;
const FRIEND_REQUESTS = new Map<string,Set<string>>();
const ADMIN_PLAYER_IDS = parseAdminPlayerIds(process.env.MISTY_ADMIN_PLAYER_IDS);
// Administrative commands are disabled unless the server operator explicitly allowlists player IDs.
// Tests may point the server at an isolated directory. The default remains the
// existing ./data directory so normal deployments keep their current behavior.
const configuredDataDir = process.env.MISTY_DATA_DIR?.trim();
if (configuredDataDir && !isAbsolute(configuredDataDir)) {
  throw new Error('MISTY_DATA_DIR must be an absolute path.');
}
const DATA_DIR = resolve(configuredDataDir || join(process.cwd(), 'data'));
const SAVE_FILE = join(DATA_DIR, 'players.json');
const CLAN_FILE = join(DATA_DIR, 'clans.json');
const AUCTION_FILE = join(DATA_DIR, 'auction.json');
const AUCTION_HISTORY_FILE = join(DATA_DIR, 'auction_history.json');
const WAR_FILE = join(DATA_DIR, 'clan_wars.json');
const TERRITORY_FILE = join(DATA_DIR, 'clan_territories.json');
const HUNT_GROUP_FILE = join(DATA_DIR, 'hunt_groups.json');
const DUNGEON_RUN_FILE = join(DATA_DIR, 'dungeon_runs.json');
const DUNGEON_OUTBOX_FILE = join(DATA_DIR, 'dungeon_outbox.json');
const ACCOUNT_FILE = join(DATA_DIR, 'accounts.json');
const SESSION_FILE = join(DATA_DIR, 'sessions.json');
const GUEST_CREDENTIAL_FILE = join(DATA_DIR, 'guest_credentials.json');
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
const { loadPlayers } = createPlayerSaveStore(SAVE_FILE, DATA_DIR);
const auctionTransactions = createAuctionTransactionStore({ dataDir: DATA_DIR, playersFile: SAVE_FILE, auctionFile: AUCTION_FILE, historyFile: AUCTION_HISTORY_FILE });
const clanTransactions = createClanTransactionStore({ dataDir: DATA_DIR, playersFile: SAVE_FILE, clansFile: CLAN_FILE, warsFile: WAR_FILE, territoriesFile: TERRITORY_FILE });
const sharedStateTransactions = createSharedStateTransactionStore({
  dataDir: DATA_DIR,
  files: {
    players: SAVE_FILE,
    auction: AUCTION_FILE,
    auctionHistory: AUCTION_HISTORY_FILE,
    clans: CLAN_FILE,
    wars: WAR_FILE,
    territories: TERRITORY_FILE,
    huntGroups: HUNT_GROUP_FILE,
    dungeonRuns: DUNGEON_RUN_FILE,
    dungeonOutbox: DUNGEON_OUTBOX_FILE,
  },
});
// One recovery gate handles legacy migration and the shared WAL. If both legacy
// journals exist, the coordinator refuses to guess which full players snapshot is newer.
const sharedStateRuntime = createSharedStateRuntime({ shared: sharedStateTransactions, auction: auctionTransactions, clans: clanTransactions });
sharedStateRuntime.recoverPendingState();
// Active dungeon records are restored only after the shared WAL has replayed.
// Invalid snapshots fail closed instead of silently resetting a paid attempt.
const restoredDungeonRuns = validateDungeonRunStore(existsSync(DUNGEON_RUN_FILE) ? JSON.parse(readFileSync(DUNGEON_RUN_FILE, 'utf8')) : {});
assertNoOverlappingActiveDungeonRuns(restoredDungeonRuns);
const ACTIVE_DUNGEON_RUNS = new Map<string, DungeonRunRecord>(Object.entries(restoredDungeonRuns));
function restoreHuntGroupsFromDisk(){
  HUNT_GROUPS.clear();
  PLAYER_GROUP.clear();
  if(!existsSync(HUNT_GROUP_FILE))return;
  const raw=JSON.parse(readFileSync(HUNT_GROUP_FILE,'utf8'));
  if(!Array.isArray(raw))throw new Error('hunt_groups.json must contain an array; refusing to start with ambiguous group membership.');
  for(const entry of raw){
    const id=String(entry?.id||''),leader=String(entry?.leader||'');
    const members=Array.isArray(entry?.members)?entry.members.map((value:any)=>String(value||'')):[];
    if(!id||!leader||members.length<1||members.length>3||members.some((member:string)=>!member)||new Set(members).size!==members.length||!members.includes(leader)){
      throw new Error('hunt_groups.json contains an invalid group; refusing to start with ambiguous group membership.');
    }
    if(members.some((member:string)=>PLAYER_GROUP.has(member))||HUNT_GROUPS.has(id)){
      throw new Error('hunt_groups.json contains duplicate group membership; refusing to start with ambiguous group membership.');
    }
    const group:HuntGroup={id,leader,members};
    HUNT_GROUPS.set(id,group);
    for(const member of members)PLAYER_GROUP.set(member,id);
  }
}
restoreHuntGroupsFromDisk();
function persistHuntGroups(players:Player[]=[],playerQuestOverrides:Record<string,string>={}){
  try{
    sharedStateRuntime.transact((recovered)=>{
      if(recovered)throw new Error('Shared state was recovered during a group mutation; retry the action.');
      for(const online of ONLINE_PLAYERS.values())normalizePlayerProfessionData(online);
      const all=loadPlayers();
      for(const player of Object.values(all))normalizePlayerProfessionData(player);
      for(const [id,online] of ONLINE_PLAYERS)all[id]=online.toJSON();
      for(const player of players)if(player?.id)all[player.id]=player.toJSON();
      for(const [id,quests] of Object.entries(playerQuestOverrides)){
        if(all[id])all[id]={...all[id],quests};
      }
      return {files:{
        players:all,
        huntGroups:Array.from(HUNT_GROUPS.values()).map(group=>({id:group.id,leader:group.leader,members:[...group.members]}))
      },result:undefined};
    });
  }catch(error){
    restoreHuntGroupsFromDisk();
    throw error;
  }
}
const EXPEDITION_DATA:any = JSON.parse(readFileSync(join(DATA_DIR,'forgotten_lands.json'),'utf8'));
const EXPEDITION_BESTIARY:any[] = EXPEDITION_DATA.monsters
  .filter((monster:any)=>['rare','elite','guardian','boss','finalBoss'].includes(monster.rank))
  .map((monster:any)=>{
    const zone=EXPEDITION_DATA.zones.find((entry:any)=>entry.id===monster.zoneId);
    return {id:monster.id,name:monster.name,region:zone?.region||'Забытые земли',boss:monster.name,rare:monster.rank,min:zone?.minLevel??monster.level,max:zone?.maxLevel??monster.level};
  });
const CITY_NPCS:any[] = JSON.parse(readFileSync(join(DATA_DIR,'city_npcs.json'),'utf8'));

type Item = { id:string; name:string; kind:'weapon'|'armor'|'amulet'|'potion'|'material'|'chest'; slot?:string; price:number; currency?:string; level:number; maxLevel?:number; attack?:number; defense?:number; health?:number; heal?:number; effect?:string; value?:number; profession?:string; race?:string; description?:string; legacy?:boolean; attributes?:Record<string,number>; combatStats?:Record<string,number>; primaryAttribute?:string; [key:string]:any };
type Recipe = {id:string;name:string;level:number;seconds:number;output:string;count:number;materials:Record<string,number>;description:string;profession?:string};
const RACES = ['Кот','Собака','Птица','Грызун'];

const CITIES: Record<string,string> = {'Кот':'Сумеречный приют','Собака':'Крепость стаи','Птица':'Высокое гнездо','Грызун':'Подземный рынок'};
const LEGACY_CITY_NAMES:Record<string,string>={'Вольный перекрёсток':'Каменный порт','Гавань семи ветров':'Изумрудная долина','Серебряный бастион':'Золотые дюны','Кристальный двор':'Серебряные руины','Пепельная цитадель':'Северная корона'};
function normalizePlayerProfessionData(p:any){p.profession=normalizeProfession(p.profession);}
function normalizePlayerCityData(p:any){const old=String(p.city||'');if(LEGACY_CITY_NAMES[old])p.city=LEGACY_CITY_NAMES[old];const rep=readObject(p.cityReputation);for(const [before,after] of Object.entries(LEGACY_CITY_NAMES)){if(rep[before]!==undefined){rep[after]=Math.max(Number(rep[after]||0),Number(rep[before]||0));delete rep[before];}}p.cityReputation=JSON.stringify(rep);const col=readObject(p.collections);for(const [before,after] of Object.entries(LEGACY_CITY_NAMES)){if(col[`visited_${before}`]){col[`visited_${after}`]=true;delete col[`visited_${before}`];}}p.collections=JSON.stringify(col);}
const RACE_CITY_INFO: Record<string,{tagline:string;description:string;districts:string[];signatureZone:string;signatureZoneName:string}> = {
 'Кот':{tagline:'Лунные башни и древние тайны',description:'Магические архивы, лунные рынки и тихие переулки ассасинов.',districts:['Лунная площадь','Старый архив','Башня серебряных усов'],signatureZone:'cat_moonpath',signatureZoneName:'Лунная тропа'},
 'Собака':{tagline:'Крепость, выкованная верностью',description:'Кузницы, тренировочные дворы и бастионы защитников дорог.',districts:['Кузни красного железа','Дозорный бастион','Зал громового знамени'],signatureZone:'dog_border',signatureZoneName:'Дозорные поля'},
 'Птица':{tagline:'Причалы над облаками',description:'Воздушные доки, башни разведчиков и рынки редких находок.',districts:['Парящие причалы','Гнездо первых ветров','Обсерватория сокола'],signatureZone:'bird_windroost',signatureZoneName:'Ветровые гнёзда'},
 'Грызун':{tagline:'Базар под корнями мира',description:'Подземные торговые ряды, грибные сады и тайные проходы к шахтам.',districts:['Медный базар','Затопленные катакомбы','Зал последнего факела'],signatureZone:'rodent_mushrooms',signatureZoneName:'Грибные тоннели'}
};
const RACE_DAILY_QUESTS: Record<string,any[]> = {
 'Кот':[
  {id:'cat_hunt_3',title:'Следы под луной',description:'Одержи 3 победы в охоте.',kind:'huntWins',goal:3,gold:150,xp:100},
  {id:'cat_home_2',title:'Тайны лунного архива',description:'Одержи 5 побед в экспедиционной охоте.',kind:'huntWins',goal:5,gold:190,xp:125},
  {id:'cat_mine',title:'Хранитель архива',description:'Одержи 7 побед в экспедиционной охоте.',kind:'huntWins',goal:7,gold:130,xp:90}
 ],
 'Собака':[
  {id:'dog_hunt_3',title:'Дозор у ворот',description:'Одержи 3 победы в охоте.',kind:'huntWins',goal:3,gold:150,xp:100},
  {id:'dog_home_2',title:'Страж внешних рубежей',description:'Одержи 5 побед в экспедиционной охоте.',kind:'huntWins',goal:5,gold:200,xp:130},
  {id:'dog_mine',title:'Трофеи для кузницы',description:'Одержи 7 побед в экспедиционной охоте.',kind:'huntWins',goal:7,gold:130,xp:90}
 ],
 'Птица':[
  {id:'bird_hunt_3',title:'Разведка перед вылетом',description:'Одержи 3 победы в охоте.',kind:'huntWins',goal:3,gold:150,xp:100},
  {id:'bird_home_2',title:'Разведка дальних островов',description:'Одержи 5 побед в экспедиционной охоте.',kind:'huntWins',goal:5,gold:190,xp:125},
  {id:'bird_mine',title:'Трофеи разведчика',description:'Одержи 7 побед в экспедиционной охоте.',kind:'huntWins',goal:7,gold:130,xp:90}
 ],
 'Грызун':[
  {id:'rodent_hunt_3',title:'Безопасные тоннели',description:'Одержи 3 победы в охоте.',kind:'huntWins',goal:3,gold:150,xp:100},
  {id:'rodent_home_2',title:'Следы под корнями',description:'Одержи 5 побед в экспедиционной охоте.',kind:'huntWins',goal:5,gold:190,xp:125},
  {id:'rodent_mine',title:'Трофеи подземелья',description:'Одержи 7 побед в экспедиционной охоте.',kind:'huntWins',goal:7,gold:130,xp:90}
 ]
};
function raceDailyState(p:any, reset=true){
 const quests=readObject(p.quests); const day=new Date().toISOString().slice(0,10);
 if(!quests.raceDaily || quests.raceDaily.day!==day || quests.raceDaily.race!==p.race){
  if(reset) quests.raceDaily={day,race:p.race,progress:{},claimed:[]};
 }
 const state=quests.raceDaily||{day,race:p.race,progress:{},claimed:[]};
 state.progress=state.progress||{}; state.claimed=Array.isArray(state.claimed)?state.claimed:[];
 return {quests,state,day};
}

const TERRITORIES = [
 {id:'crossroads',name:'Вольный перекрёсток',region:'Центральные острова',level:1,desc:'Торговый узел: клан получает больше золота от общих заданий.'},
 {id:'windharbor',name:'Гавань семи ветров',region:'Небесные острова',level:2,desc:'Порт воздушных кораблей: бонус к сезонным очкам.'},
 {id:'silverkeep',name:'Серебряный бастион',region:'Старые земли',level:3,desc:'Старая крепость: укрепляет позиции в клановых войнах.'},
 {id:'crystalcourt',name:'Кристальный двор',region:'Кристальные пещеры',level:4,desc:'Кристаллическая жила: награда за задания содержит кристаллы.'},
 {id:'ashcitadel',name:'Пепельная цитадель',region:'Подземные рубежи',level:5,desc:'Заброшенная цитадель: приносит дополнительный опыт клану.'},
 {id:'mistwatch',name:'Дозор Тумана',region:'Запретные земли',level:6,desc:'Древняя сторожевая башня: престиж и сезонные очки.'}
];
const NEUTRAL_CITIES = ['Каменный порт','Изумрудная долина','Золотые дюны','Серебряные руины','Северная корона'];
const ITEMS: Item[] = [
 {id:RESURRECTION_SCROLL_ID,name:'Свиток воскрешения',kind:'material',price:100,currency:'crystals',level:1,description:'Позволяет воскресить одного павшего союзника в подземелье. Максимум два свитка в инвентаре.'},
 {id:'moon_dust',name:'Лунная пыль',kind:'material',price:45,level:1,description:'Мягко светится в темноте; собирается на тропах у Сумеречного приюта.'},
 {id:'iron_scrap',name:'Железный обломок',kind:'material',price:45,level:1,description:'Прочный лом из тренировочных полей Крепости стаи.'},
 {id:'wind_feather',name:'Перо ветра',kind:'material',price:45,level:1,description:'Лёгкое перо из гнёзд на окраинах Небесной Гавани.'},
 {id:'glow_mushroom',name:'Светящийся гриб',kind:'material',price:45,level:1,description:'Распространённый ресурс из безопасных тоннелей Подкорья.'},
 {id:'mistwarden_blade',name:'Клинок Стража Тумана',kind:'weapon',price:0,level:24,attack:58,description:'Часть комплекта Стража Тумана.'},
 {id:'mistwarden_mail',name:'Доспех Стража Тумана',kind:'armor',price:0,level:24,defense:42,description:'Часть комплекта Стража Тумана.'},
 {id:'mistwarden_charm',name:'Знак Стража Тумана',kind:'amulet',price:0,level:24,defense:4,effect:'defense',value:0.04,description:'Часть комплекта Стража Тумана.'},
 {id:'shadowstalker_blades',name:'Клинки Теневого Следопыта',kind:'weapon',price:0,level:32,attack:76,description:'Часть комплекта Теневого Следопыта.',profession:'Ассасин',weaponStyle:'dual-daggers'},
 {id:'shadowstalker_armor',name:'Плащ Теневого Следопыта',kind:'armor',price:0,level:32,defense:34,description:'Часть комплекта Теневого Следопыта.'},
 {id:'arcanist_staff',name:'Посох Архивариуса',kind:'weapon',price:0,level:32,attack:79,description:'Часть комплекта Архивариуса.',profession:'Боевой маг'},
 {id:'arcanist_robe',name:'Мантия Архивариуса',kind:'armor',price:0,level:32,defense:31,description:'Часть комплекта Архивариуса.'},
 {id:'wood_sword',name:'Учебный меч',kind:'weapon',price:100,level:1,attack:5,description:'Надёжное оружие новичка.'},
 // Расовые товары продаются только представителям своей расы в родной столице. После покупки их можно свободно перепродавать через общий аукцион.
 {id:'cat_moonstaff',name:'Посох лунного резонанса',kind:'weapon',price:1850,level:20,attack:39,profession:'Боевой маг',race:'Кот',description:'Посох, настроенный на лунные кристаллы. Расовый товар Лунного Предела.'},
 {id:'cat_nightfang',name:'Клинок тихой луны',kind:'weapon',price:1900,level:20,attack:38,profession:'Ассасин',weaponStyle:'dual-daggers',race:'Кот',description:'Лёгкий клинок для точных ударов из тени.'},
 {id:'cat_silversilk',name:'Мантия серебряного архива',kind:'armor',price:1450,level:18,defense:25,race:'Кот',description:'Ткань, сотканная с тонкими защитными рунами.'},
 {id:'cat_mooncrystal',name:'Лунный кристалл',kind:'material',price:125,level:1,race:'Кот',description:'Материал для рецептов и улучшений магического снаряжения.'},
 {id:'dog_oathaxe',name:'Топор клятвы',kind:'weapon',price:1950,level:20,attack:41,profession:'Воин',race:'Собака',description:'Тяжёлое оружие защитников Железного Оплота.'},
 {id:'dog_guardmace',name:'Булава знаменосца',kind:'weapon',price:1750,level:20,attack:29,defense:8,profession:'Баффер',race:'Собака',description:'Оружие наставников, укрепляющих союзников.'},
 {id:'dog_fortressmail',name:'Панцирь дозорного',kind:'armor',price:1550,level:18,defense:29,race:'Собака',description:'Надёжная броня стражей крепостных ворот.'},
 {id:'dog_ironmark',name:'Железная печать',kind:'material',price:115,level:1,race:'Собака',description:'Кузнечный материал для военного снаряжения.'},
 {id:'bird_stormbow',name:'Лук грозового ветра',kind:'weapon',price:1900,level:20,attack:40,profession:'Лучник',race:'Птица',description:'Лёгкий лук, усиливающий натяжение тетивы потоками воздуха.'},
 {id:'bird_cloudcloak',name:'Плащ облачного дозора',kind:'armor',price:1400,level:18,defense:23,race:'Птица',description:'Не стесняет движения на узких воздушных мостах.'},
 {id:'bird_windfeather',name:'Перья высотного ветра',kind:'material',price:120,level:1,race:'Птица',description:'Редкий материал для стрел и лёгкого снаряжения.'},
 {id:'rodent_bloodfang',name:'Клык глубин',kind:'weapon',price:1900,level:20,attack:39,profession:'Вампир',race:'Грызун',description:'Реликвия вампирских кругов Подкорья.'},
 {id:'rodent_relicpick',name:'Кирка древней жилы',kind:'weapon',price:1650,level:20,attack:31,profession:'Добытчик',race:'Грызун',description:'Укреплённая кирка, пригодная и для защиты в тоннелях.'},
 {id:'rodent_sporemail',name:'Панцирь грибного стража',kind:'armor',price:1500,level:18,defense:27,race:'Грызун',description:'Плотные пластины с защитным покрытием из спор.'},
 {id:'rodent_glowspore',name:'Светящиеся споры',kind:'material',price:110,level:1,race:'Грызун',description:'Подземный материал для редких рецептов.'},
 {id:'dawn_charm',name:'Кольцо Рассветного дозора',kind:'amulet',price:1800,level:8,defense:5,effect:'defense',value:0.08,description:'Уникальная награда Союза Рассвета.'},
 {id:'freeblade',name:'Клинок Вольных караванов',kind:'weapon',price:2600,level:12,attack:25,description:'Оружие торговцев-первопроходцев.'},
 {id:'archive_tonic',name:'Тоник архивариуса',kind:'potion',price:0,level:5,heal:0.35,description:'Награда Хранителей летописи; не продаётся в общем магазине.'},
 {id:'apprentice_staff',name:'Посох ученика',kind:'weapon',price:140,level:1,attack:7,description:'Простой посох для начинающего мага.',profession:'Боевой маг'},
 {id:'bronze_sword',name:'Бронзовый меч',kind:'weapon',price:420,level:5,attack:13},
 {id:'hunter_spear',name:'Копьё охотника',kind:'weapon',price:1800,level:15,attack:29},
 {id:'mage_rod',name:'Жезл искр',kind:'weapon',price:850,level:20,attack:32,profession:'Боевой маг'},
 {id:'assassin_blades',name:'Парные клинки',kind:'weapon',price:900,level:20,attack:35,profession:'Ассасин',weaponStyle:'dual-daggers'},
 {id:'warrior_axe',name:'Топор стража',kind:'weapon',price:900,level:20,attack:37,profession:'Воин'},
 {id:'buffer_mace',name:'Булава наставника',kind:'weapon',price:850,level:20,attack:25,defense:12,profession:'Баффер'},
 {id:'bird_bow',name:'Длинный лук',kind:'weapon',price:900,level:20,attack:34,profession:'Лучник'},
 {id:'vampire_fang',name:'Кровавый клык',kind:'weapon',price:900,level:20,attack:33,profession:'Вампир'},
 {id:'spoiler_pick',name:'Реликтовая кирка',kind:'weapon',price:800,level:20,attack:28,profession:'Добытчик'},
 {id:'steel_blade',name:'Стальной клинок',kind:'weapon',price:6500,level:35,attack:85,profession:'Воин'},
 {id:'arcane_staff',name:'Посох архимага',kind:'weapon',price:7000,level:35,attack:90,profession:'Боевой маг'},
 {id:'ranger_bow',name:'Лук следопыта',kind:'weapon',price:6800,level:35,attack:86,profession:'Лучник'},
 {id:'shadow_blades',name:'Теневые ножи',kind:'weapon',price:6900,level:35,attack:88,profession:'Ассасин',weaponStyle:'dual-daggers'},
 {id:'vampire_scythe',name:'Коса ночи',kind:'weapon',price:6900,level:35,attack:84,profession:'Вампир'},
 {id:'spoiler_hammer',name:'Молот сборщика',kind:'weapon',price:6200,level:35,attack:78,profession:'Добытчик'},
 {id:'leather_armor',name:'Кожаный доспех',kind:'armor',price:120,level:1,defense:5},
 {id:'reinforced_leather',name:'Усиленная кожа',kind:'armor',price:650,level:5,defense:10},
 {id:'iron_armor',name:'Кольчуга',kind:'armor',price:900,level:10,defense:18},
 {id:'scale_mail',name:'Чешуйчатая броня',kind:'armor',price:2400,level:15,defense:28},
 {id:'steel_armor',name:'Стальной панцирь',kind:'armor',price:5200,level:25,defense:48},
 {id:'runic_plate',name:'Рунный панцирь',kind:'armor',price:15500,level:40,defense:72},
 {id:'abyss_armor',name:'Доспех Бездны',kind:'armor',price:48000,level:65,defense:125},
 {id:'amulet_health',name:'Кольцо стойкости',kind:'amulet',price:300,level:1,effect:'health',value:0.08,description:'+8% к максимальному здоровью.'},
 {id:'amulet_power',name:'Кольцо силы',kind:'amulet',price:550,level:5,effect:'attack',value:0.06,description:'+6% к атаке.'},
 {id:'amulet_guard',name:'Кольцо стража',kind:'amulet',price:650,level:8,effect:'defense',value:0.08,description:'+8% к защите.'},
 {id:'amulet_hunt',name:'Кольцо охотника',kind:'amulet',price:1200,level:15,effect:'xp',value:0.08,description:'+8% к опыту.'},
 {id:'amulet_gold',name:'Кольцо удачи',kind:'amulet',price:1600,level:18,effect:'gold',value:0.10,description:'+10% к золоту с охоты.'},
 {id:'amulet_crit',name:'Кольцо точности',kind:'amulet',price:3000,level:25,effect:'crit',value:0.05,description:'+5% к шансу критического удара.'},
 {id:'amulet_vamp',name:'Кольцо жажды',kind:'amulet',price:4200,level:30,effect:'lifesteal',value:0.04,description:'Восстанавливает здоровье при победе.'},
 {id:'amulet_stamina',name:'Кольцо выносливости',kind:'amulet',price:850,level:10,effect:'defense',value:0.10,description:'+10% к защите. Старое кольцо наконец-то вспомнило, зачем его носить.'},
 {id:'amulet_luck',name:'Кольцо удачи',kind:'amulet',price:1900,level:20,effect:'crit',value:0.03,description:'+3% к шансу критического удара. Иногда удача — это просто хорошо заточенный план.'},
 {id:'amulet_accuracy',name:'Кольцо меткости',kind:'amulet',price:2600,level:22,effect:'attack',value:0.04,description:'+4% к атаке. Попасть по врагу проще, чем найти нужную вкладку в старом меню.'},
 {id:'amulet_mining',name:'Кольцо шахтёра',kind:'amulet',price:3200,level:25,effect:'gold',value:0.08,description:'+8% золота с охоты. Спина не лечится, зато кошелёк крепнет.'},
 {id:'amulet_treasure',name:'Кольцо кладоискателя',kind:'amulet',price:6500,level:35,effect:'gold',value:0.12,description:'+12% золота с охоты. Не спрашивай, почему сундук стоял посреди дороги.'},
 // Дополнение магазина: новые предметы используют существующие расчёты боя и наград.
 {id:'weapon_fogfang',name:'Клык Мглистого берега',kind:'weapon',price:1250,level:12,attack:24,description:'Изогнутый клинок с солёным блеском. +24 к атаке.'},
 {id:'weapon_tidebreaker',name:'Разломщик приливов',kind:'weapon',price:3900,level:24,attack:57,description:'Тяжёлый меч, выкованный у старого маяка. +57 к атаке.'},
 {id:'weapon_emberstaff',name:'Посох тлеющей звезды',kind:'weapon',price:4300,level:26,attack:61,profession:'Боевой маг',description:'Внутри посоха тлеет искра давно погасшего созвездия.'},
 {id:'weapon_gale_needles',name:'Иглы шквального ветра',kind:'weapon',price:4100,level:25,attack:59,profession:'Ассасин',weaponStyle:'dual-daggers',description:'Лёгкие парные клинки. Противник слышит ветер, а не тебя.'},
 {id:'weapon_stormstring',name:'Тетива громового раската',kind:'weapon',price:4200,level:25,attack:60,profession:'Лучник',description:'Лук натягивается с тихим треском перед бурей.'},
 {id:'weapon_oathbreaker',name:'Крушитель клятв',kind:'weapon',price:4400,level:26,attack:64,profession:'Воин',description:'Слишком тяжёлый для понтов, зато отлично убеждает.'},
 {id:'weapon_bellmace',name:'Булава последнего звонаря',kind:'weapon',price:3600,level:23,attack:45,defense:10,profession:'Баффер',description:'Каждый удар звучит как напоминание закрыть ежедневные задания.'},
 {id:'weapon_bloodmoon',name:'Серп Кровавой луны',kind:'weapon',price:4500,level:27,attack:62,profession:'Вампир',description:'Лунный металл, который предпочитает ночные вылазки.'},
 {id:'weapon_deepdelver',name:'Бур древних жил',kind:'weapon',price:3500,level:22,attack:43,profession:'Добытчик',description:'Инструмент добытчика. Гарантия на камни не распространяется.'},
 {id:'weapon_ruinbreaker',name:'Молот руинолома',kind:'weapon',price:7900,level:38,attack:96,description:'Создан, чтобы открывать двери. Иногда — вместе со стеной.'},
 {id:'weapon_moonedge',name:'Полумесяц Безмолвия',kind:'weapon',price:9800,level:45,attack:112,description:'Редкий клинок, почти не отражающий свет.'},
 {id:'weapon_frostcall',name:'Ледозов',kind:'weapon',price:14800,level:55,attack:138,description:'Оружие северных перевалов, холодное даже в кузнице.'},
 {id:'armor_wayfarer',name:'Куртка дальнего пути',kind:'armor',price:950,level:8,defense:13,description:'Лёгкая защита для тех, кто снова забыл купить зелья.'},
 {id:'armor_harborplate',name:'Панцирь портового дозора',kind:'armor',price:2100,level:16,defense:31,description:'Укреплённые пластины, устойчивые к морскому туману.'},
 {id:'armor_ashweave',name:'Пепельное плетение',kind:'armor',price:3600,level:23,defense:39,description:'Ткань с вплетёнными металлическими нитями.'},
 {id:'armor_windguard',name:'Доспех ветрового дозора',kind:'armor',price:4700,level:28,defense:51,description:'Не делает тебя быстрее. Просто не мешает пытаться.'},
 {id:'armor_mossiron',name:'Моховая кираса',kind:'armor',price:7200,level:36,defense:69,description:'Старые руны говорят, что мох приносит удачу. Кузнец просто молчит.'},
 {id:'armor_starforged',name:'Звёздная латная рубаха',kind:'armor',price:10500,level:45,defense:91,description:'В её швах мерцает пыль упавших звёзд.'},
 {id:'armor_glacier',name:'Ледниковый панцирь',kind:'armor',price:15500,level:55,defense:118,description:'Северная броня: прохладная на ощупь и в ремонте дорогая.'},
 {id:'armor_abysswalker',name:'Облачение ходока Бездны',kind:'armor',price:26000,level:65,defense:145,description:'Поглощает свет и часть плохих решений.'},
 {id:'armor_bastion',name:'Крепость на плечах',kind:'armor',price:34500,level:72,defense:168,description:'Тяжёлая броня для тех, кто привык стоять на своём.'},
 {id:'armor_lastdawn',name:'Плащ последнего рассвета',kind:'armor',price:42000,level:78,defense:190,description:'Редкая защита странников, переживших слишком много ночей.'},
 {id:'amulet_miststep',name:'Кольцо Туманного шага',kind:'amulet',price:1450,level:12,effect:'xp',value:0.05,description:'+5% к опыту с охоты. Туман скрывает тебя, но не дедлайны.'},
 {id:'amulet_cinderheart',name:'Сердце угольной звезды',kind:'amulet',price:2750,level:21,effect:'attack',value:0.07,description:'+7% к атаке. Греет душу, а врагу — нет.'},
 {id:'amulet_saltward',name:'Оберег солёной гавани',kind:'amulet',price:2900,level:22,effect:'defense',value:0.09,description:'+9% к защите. Проверен штормами и одним очень злым крабом.'},
 {id:'amulet_wayfinder',name:'Компас кладоходца',kind:'amulet',price:3900,level:28,effect:'gold',value:0.09,description:'+9% золота с охоты. На север показывает, где торговец.'},
 {id:'amulet_nightglass',name:'Ночное стекло',kind:'amulet',price:5200,level:32,effect:'crit',value:0.045,description:'+4.5% к шансу критического удара. Не смотреть в него после полуночи.'},
 {id:'amulet_bloodtide',name:'Прилив живой крови',kind:'amulet',price:6800,level:38,effect:'lifesteal',value:0.06,description:'После победы восстанавливает 6% максимального здоровья.'},
 {id:'amulet_scholar',name:'Печать терпеливого летописца',kind:'amulet',price:7200,level:40,effect:'xp',value:0.12,description:'+12% к опыту с охоты. Да, читать журнал тоже полезно.'},
 {id:'amulet_goldvein',name:'Жила золотого сна',kind:'amulet',price:8500,level:42,effect:'gold',value:0.15,description:'+15% золота с охоты. Дракон одобряет финансовую грамотность.'},
 {id:'amulet_stormcore',name:'Ядро тихой грозы',kind:'amulet',price:9800,level:46,effect:'attack',value:0.11,description:'+11% к атаке. Громко выглядит, работает без лишнего шума.'},
 {id:'amulet_oathstone',name:'Камень нерушимой клятвы',kind:'amulet',price:11200,level:50,effect:'defense',value:0.14,description:'+14% к защите. Клятва не отменяет необходимость чинить броню.'},
 {id:'amulet_farseer',name:'Глаз дальнего провидца',kind:'amulet',price:13500,level:55,effect:'crit',value:0.06,description:'+6% к шансу критического удара. Видит промахи за секунду до них.'},
 {id:'amulet_phoenix',name:'Пепел второго дыхания',kind:'amulet',price:16500,level:60,effect:'lifesteal',value:0.08,description:'После победы восстанавливает 8% максимального здоровья.'},
 {id:'amulet_fogcrown',name:'Венец живого тумана',kind:'amulet',price:22000,level:68,effect:'xp',value:0.16,description:'+16% к опыту с охоты. Мудрость приходит с уровнями и иногда с опозданием.'},
 {id:'amulet_oldcompass',name:'Старый компас удачи',kind:'amulet',price:0,level:10,effect:'gold',value:0.05,description:'+5% золота с охоты. Стрелка крутится, но монеты идут.'},
 {id:'mystery_chest',name:'Загадочный сундук',kind:'chest',price:0,level:1,description:'Открой сундук: внутри предмет или временный эффект.'},
 {id:'health_potion',name:'Зелье здоровья',kind:'potion',price:180,level:1,heal:0.5,description:'Восстанавливает 50% максимального здоровья.'},
 {id:'greater_potion',name:'Большое зелье здоровья',kind:'potion',price:500,level:5,heal:1,description:'Полностью восстанавливает здоровье.'},
 {id:'herb_bundle',name:'Пучок лечебных трав',kind:'material',price:40,level:1,description:'Материал для ремесла.'},
 {id:'wood_material',name:'Древесина',kind:'material',price:35,level:1,description:'Ресурс из Туманного леса.'},
 {id:'herb_material',name:'Лесные травы',kind:'material',price:55,level:1,description:'Ресурс из Леса шёпота.'},
 {id:'rune_shard',name:'Осколки рун',kind:'material',price:120,level:1,description:'Ресурс из Забытых руин.'},
 {id:'venom_gland',name:'Ядовитые железы',kind:'material',price:180,level:1,description:'Ресурс из Чёрных топей.'},
 {id:'crystal_shard',name:'Кристальный осколок',kind:'material',price:260,level:1,description:'Ресурс из Кристальных пещер.'},
 {id:'ash_ore',name:'Пепельная руда',kind:'material',price:450,level:1,description:'Ресурс Пепельного рубежа.'},
 {id:'abyss_shard',name:'Осколок Бездны',kind:'material',price:900,level:1,description:'Редкий ресурс с Края Бездны.'},
 {id:'relic_fragment',name:'Фрагмент реликвии',kind:'material',price:1500,level:1,description:'Реликвия из забытого святилища.'},
 {id:'protection_seal',name:'Печать сохранения',kind:'material',price:0,level:1,description:'Защищает заточку от потери уровня при неудачной попытке.'},
 {id:'mist_bloom',name:'Цветок серебряного тумана',kind:'material',price:160,level:1,description:'Редкий ресурс Туманного леса.'},
 {id:'rune_heart',name:'Сердце древней руны',kind:'material',price:300,level:10,description:'Редкий ресурс Забытых руин.'},
 {id:'marsh_amber',name:'Топяной янтарь',kind:'material',price:520,level:17,description:'Редкий ресурс Чёрных топей.'},
 {id:'ash_core',name:'Пепельное ядро',kind:'material',price:760,level:40,description:'Редкий ресурс Пепельного рубежа.'},
 {id:'sun_pearl',name:'Жемчужина затонувших садов',kind:'material',price:420,level:8,description:'Редкий ресурс Затонувших островов.'},
 {id:'storm_feather',name:'Перо грозового грифона',kind:'material',price:680,level:20,description:'Редкий ресурс Небесных островов.'},
 {id:'moon_silver',name:'Лунное серебро',kind:'material',price:980,level:50,description:'Редкая руда Серых пустошей.'},
 {id:'eclipse_lens',name:'Линза затмения',kind:'material',price:1750,level:68,description:'Редкий компонент Обсерватории затмения.'},
 {id:'tempered_sword',name:'Закалённый клинок',kind:'weapon',price:0,level:12,attack:27,description:'Оружие, созданное ремесленником.'},
 {id:'rune_armor',name:'Рунная броня',kind:'armor',price:0,level:22,defense:39,description:'Броня, усиленная осколками рун.'},
 {id:'field_potion',name:'Походное зелье',kind:'potion',price:0,level:1,heal:0.35,description:'Ремесленное зелье, восстанавливает 35% здоровья.'},
 {id:'crystal_amulet',name:'Кристальный талисман',kind:'amulet',price:0,level:30,effect:'attack',value:0.08,description:'Созданный талисман: +8% к атаке.'},
 {id:'reinforced_staff',name:'Посох рунного резчика',kind:'weapon',price:0,level:18,attack:39,profession:'Боевой маг',description:'Посох, созданный из дерева и рун.'},
 {id:'guardian_armor',name:'Броня хранителя',kind:'armor',price:0,level:32,defense:58,description:'Тяжёлая броня ремесленной работы.'},
 {id:'deep_potion',name:'Эликсир глубин',kind:'potion',price:0,level:1,heal:0.7,description:'Восстанавливает 70% максимального здоровья.'},
 {id:'rune_blade',name:'Клинок древней руны',kind:'weapon',price:0,level:45,attack:105,description:'Редкое оружие позднего этапа.'},
 {id:'trophy_mistwood',name:'Клык туманного альфа',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_whisper',name:'Сердце волка-шептуна',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_ruins',name:'Печать древнего стража',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_marsh',name:'Яд топяного владыки',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_crystal',name:'Ядро кристального титана',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_frontier',name:'Знак пепельного генерала',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_abyss',name:'Осколок сердца Бездны',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_sanctum',name:'Корона хранителя',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_sunken',name:'Жемчужина затонувшего короля',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_stormcliffs',name:'Перья грозового короля',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_embermine',name:'Уголь древнего исполина',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_moonfen',name:'Лунный глаз марева',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'trophy_eclipse',name:'Линза затмения',kind:'material',price:0,level:1,description:'Уникальный трофей босса. Нужен для будущих рецептов и коллекций.'},
 {id:'dawn_regalia',name:'Регалия Первого Рассвета',kind:'amulet',price:0,level:40,defense:18,effect:'health',value:0.18,description:'Эксклюзив Почитаемого Союза Рассвета: +18% к максимальному здоровью.'},
 {id:'caravan_cleaver',name:'Рассекающий Горизонт',kind:'weapon',price:0,level:40,attack:145,description:'Эксклюзив Почитаемых Вольных караванов. Оружие первопроходца.'},
 {id:'lore_circlet',name:'Венец Живой Летописи',kind:'amulet',price:0,level:40,defense:12,effect:'xp',value:0.15,description:'Эксклюзив Почитаемых Хранителей летописи: +15% к опыту.'},
 {id:'faction_seal_dawn',name:'Печать Рассвета',kind:'material',price:0,level:1,description:'Сюжетный знак признания Союза Рассвета.'},
 {id:'faction_seal_caravan',name:'Знак Вольного пути',kind:'material',price:0,level:1,description:'Сюжетный знак признания Вольных караванов.'},
 {id:'faction_seal_lore',name:'Печать летописца',kind:'material',price:0,level:1,description:'Сюжетный знак признания Хранителей летописи.'},
];
// Gold-priced shop goods cost at least 30% more; amulets and materials keep their listed prices and use crystals.
for (const item of ITEMS) { if (item.price > 0 && item.kind !== 'amulet' && item.kind !== 'material') item.price = Math.ceil(item.price * 1.3); }

// New catalog is authoritative for new equipment; legacy IDs remain available for existing saves, auctions and recipes.
const NEW_EQUIPMENT_ITEMS:Item[] = JSON.parse(readFileSync(join(DATA_DIR,'equipment_catalog.json'),'utf8'));
const EXPEDITION_DROP_ITEMS:Item[] = EXPEDITION_DATA.dropItems || [];
for (const item of ITEMS) { if (['weapon','armor','amulet'].includes(item.kind)) item.legacy = true; }
for (const item of NEW_EQUIPMENT_ITEMS) { if (item.price > 0 && item.kind !== 'amulet' && item.kind !== 'material') item.price = Math.ceil(item.price * 1.3); }
ITEMS.push(...NEW_EQUIPMENT_ITEMS, ...EXPEDITION_DROP_ITEMS);
for(const item of ITEMS){
 if(!(Number(item.price)>0&&['weapon','armor'].includes(item.kind)))continue;
 if(item.attributes&&item.combatStats)continue;
 const profile=resolveGoldEquipmentStatProfile({kind:item.kind as 'weapon'|'armor',level:Number(item.level||1),profession:item.profession,slot:item.slot});
 item.attributes=item.attributes||profile.attributes;
 item.combatStats=item.combatStats||profile.combatStats;
 if(item.kind==='weapon'&&!item.primaryAttribute)item.primaryAttribute=`+${Math.max(1,Math.round(Number(item.level||1)/10))} к выбранному основному атрибуту`;
}
function pendantEffectValue(item:Item|undefined,level:number):number { if(!item)return 0;const rates:Record<string,number>={xp:.005,defense:.0005,crit:.0005,health:.001,loot:.001,gold:.001,production:.001,regen:.001,reputation:.001,bossDamage:.001,crystalChance:.001};const caps:Record<string,number>={xp:.5,defense:.1,crit:.1,health:.2,loot:.2,gold:.2,production:.2,regen:.2,reputation:.2,bossDamage:.2,crystalChance:.2};const lv=Math.max(1,Math.min(100,level));return lv>=100?(caps[item.effect||'']||0):(rates[item.effect||'']||0)*lv;}
function shopCatalogForPlayer(p:Player){const activeProfession=normalizeProfession((p as any).activeSubclass|| (p as any).subclassProfession || p.profession || '');const currentProfession=normalizeProfession(p.profession);return ITEMS.filter(i=>i.price>0&&!i.legacy&&(!i.race||i.race===p.race)&&(!i.profession||normalizeProfession(i.profession)===currentProfession||normalizeProfession(i.profession)===activeProfession)).sort((a,b)=>Number(a.level||1)-Number(b.level||1)||String(a.name).localeCompare(String(b.name),'ru'));}
function ownsPendant(p:Player,id:string){return readArray(p.inventory).includes(id)||Object.values(readObject(p.equipment)).includes(id);}
function effectiveMaxHealth(p:Player):number {
 const eq=readObject(p.equipment),collections=readObject(p.collections),pendant=ITEMS.find(x=>x.id===eq.amulet);
 const bonus=pendant?.effect==='health'?(pendant.legacy?Number(pendant.value||0):pendantEffectValue(pendant,Number(collections.pendantLevels?.[pendant.id]||1))):0;
 const armorHealth=['armor','helmet','gloves','boots','cloak'].reduce((sum,slot)=>{const item=ITEMS.find(x=>x.id===eq[slot]);return sum+(item&&item.kind==='armor'&&String(item.slot||item.kind)===slot?Number(item.health||0):0);},0);
 const gearHealthBonus=Object.values(eq).reduce((sum,id)=>{const item=ITEMS.find(x=>x.id===id);const value=Number(item?.combatStats?.health||0);return sum+(Number.isFinite(value)?Math.max(0,value):0);},0);
 return Math.floor((p.maxHealth+armorHealth)*(1+bonus+gearHealthBonus));
}
function weaponProfile(p:Player,weapon:Item|undefined){
 const raw=String(weapon?.primaryAttribute||''),match=/\+(\d+)\s+к\s+(.+)/i.exec(raw);
 const bonus=Number(match?.[1]||0),attr=String(match?.[2]||'').toLowerCase();
 let target=attr;
 if(attr.includes('выбранному')){const profession=normalizeProfession(p.profession);target=profession==='Боевой маг'||profession==='Баффер'?'интеллект':profession==='Ассасин'||profession==='Ассасин птицы'||profession==='Лучник'?'ловкость':profession==='Рыцарь'?'сила':profession==='Вампир'?'выносливость':'мудрость';}
 const out:any={strength:0,dexterity:0,intelligence:0,vitality:0,stamina:0,profileBonus:0,lootBonus:0};
 if(target.includes('сил'))out.strength=bonus;else if(target.includes('лов'))out.dexterity=bonus;else if(target.includes('интел')||target.includes('мудр'))out.intelligence=bonus;else if(target.includes('выносл'))out.stamina=bonus;else if(target.includes('живуч'))out.vitality=bonus;
 const attributes=weapon?.attributes&&typeof weapon.attributes==='object'?weapon.attributes:{};
 for(const key of ['strength','dexterity','intelligence','vitality','stamina']){const value=Number(attributes[key]||0);if(Number.isFinite(value))out[key]+=Math.max(0,value);}
 const effect=String(weapon?.effects||''),profile=/(\d+(?:[.,]\d+)?)%\s*к профильной эффективности/i.exec(effect);
 if(profile){const v=Number(profile[1].replace(',','.'))/100;if(p.profession==='Добытчик')out.lootBonus=v;else out.profileBonus=v;}
 return out;
}



const RECIPES: Recipe[] = [
 {id:'field_potion',name:'Походное зелье',level:1,seconds:15,output:'field_potion',count:1,materials:{herb_material:3},description:'Быстрое средство для похода.'},
 {id:'tempered_sword',name:'Закалённый клинок',level:2,seconds:45,output:'tempered_sword',count:1,materials:{wood_material:3,venom_gland:1},description:'Оружие с усиленной кромкой.'},
 {id:'rune_armor',name:'Рунная броня',level:4,seconds:90,output:'rune_armor',count:1,materials:{rune_shard:4,ash_ore:2,wood_material:2},description:'Защита, прошитая древними рунами.'},
 {id:'crystal_amulet',name:'Кристальный талисман',level:6,seconds:150,output:'crystal_amulet',count:1,materials:{crystal_shard:5,abyss_shard:1,relic_fragment:1},description:'Талисман, усиливающий атаку.'},
 {id:'reinforced_staff',name:'Посох рунного резчика',level:3,seconds:60,output:'reinforced_staff',count:1,materials:{wood_material:5,rune_shard:2},description:'Посох для боевого мага.'},
 {id:'guardian_armor',name:'Броня хранителя',level:5,seconds:120,output:'guardian_armor',count:1,materials:{venom_gland:2,ash_ore:3,rune_shard:3},description:'Тяжёлая ремесленная броня.'},
 {id:'deep_potion',name:'Эликсир глубин',level:3,seconds:30,output:'deep_potion',count:1,materials:{herb_material:2,crystal_shard:1},description:'Сильное восстановление здоровья.'},
 {id:'rune_blade',name:'Клинок древней руны',level:8,seconds:240,output:'rune_blade',count:1,materials:{ash_ore:4,abyss_shard:2,relic_fragment:1},description:'Редкое оружие позднего этапа.'},
 {id:'dawn_elixir',name:'Эликсир дозорного',level:3,seconds:75,output:'archive_tonic',count:2,materials:{herb_material:4,crystal_shard:1},description:'Редкий рецепт Союза Рассвета.'},
 {id:'caravan_blade',name:'Клинок караванщика',level:5,seconds:150,output:'freeblade',count:1,materials:{wood_material:4,ash_ore:2,venom_gland:2},description:'Редкий рецепт Вольных караванов.'},
 {id:'lore_charm',name:'Кольцо архивного света',level:6,seconds:180,output:'dawn_charm',count:1,materials:{rune_shard:3,crystal_shard:3,relic_fragment:1},description:'Редкий рецепт Хранителей летописи.'}
 ];
// Retire old gear recipes from the visible crafting catalogue while preserving queued outputs.
for(let i=RECIPES.length-1;i>=0;i--){const output=ITEMS.find(x=>x.id===RECIPES[i].output);if(output?.legacy)RECIPES.splice(i,1);}
for(const legendary of NEW_EQUIPMENT_ITEMS.filter(x=>x.kind==='armor'&&x.rarity==='Легендарная')){const level=Math.max(1,Number(legendary.level||100));RECIPES.push({id:`craft_${legendary.id.toLowerCase()}`,name:`Изготовление: ${legendary.name}`,level,seconds:7200+level*120,output:legendary.id,count:1,profession:legendary.profession,materials:{'FLDROP-10-10-A':1,'FLDROP-10-10-B':1,abyss_shard:20,relic_fragment:25,crystal_shard:35,ash_ore:50},description:`Профессиональное изготовление части легендарного комплекта «${legendary.set}». Нужны трофеи Архонта Забвения.`});}
const GUILD_SKILLS:Record<string,any[]> = {
 'Кот':[{id:'arcane_burst',name:'Чародейский импульс',desc:'+18% атаки на 10 минут',effect:'attack',value:0.18},{id:'shadow_step',name:'Шаг тени',desc:'+12% критического шанса на 10 минут',effect:'crit',value:0.12}],
 'Собака':[{id:'iron_guard',name:'Железный караул',desc:'+20% защиты на 10 минут',effect:'defense',value:0.20},{id:'pack_howl',name:'Боевой вой',desc:'+12% опыта на 10 минут',effect:'xp',value:0.12}],
 'Птица':[{id:'wind_aim',name:'Прицел ветра',desc:'+15% атаки на 10 минут',effect:'attack',value:0.15},{id:'sky_scout',name:'Небесный дозор',desc:'+15% золота с охоты на 10 минут',effect:'gold',value:0.15}],
 'Грызун':[{id:'blood_pact',name:'Кровавый договор',desc:'Восстанавливает 12% здоровья и даёт +10% атаки',effect:'blood',value:0.10},{id:'relic_sense',name:'Чутьё реликвий',desc:'+20% шанс материалов на 10 минут',effect:'loot',value:0.20}]
};
const CITY_LOCS:Record<string,any[]> = {
 'Сумеречный приют':[{id:'cat_old',name:'Старый Кошачий архив',desc:'Заброшенные свитки и рунические карты',type:'Архив'},{id:'cat_new',name:'Новая лунная площадь',desc:'Рынок чар и торговые ряды',type:'Торговля'},{id:'cat_guild',name:'Башня серебряных усов',desc:'Боевая гильдия и испытания магов',type:'Гильдия'}],
 'Крепость стаи':[{id:'dog_old',name:'Древний дозорный бастион',desc:'Каменные стены первых стражей',type:'История'},{id:'dog_new',name:'Кузни красного железа',desc:'Новые мастерские оружейников',type:'Кузня'},{id:'dog_guild',name:'Зал громового знамени',desc:'Воинские клятвы и навыки',type:'Гильдия'}],
 'Высокое гнездо':[{id:'bird_old',name:'Гнездо первых ветров',desc:'Святилище старых небесных кланов',type:'Святилище'},{id:'bird_new',name:'Парящие причалы',desc:'Новые воздушные пути и торговцы',type:'Порт'},{id:'bird_guild',name:'Обсерватория сокола',desc:'Обучение меткости и воздушному бою',type:'Гильдия'}],
 'Подземный рынок':[{id:'rodent_old',name:'Затопленные катакомбы',desc:'Древние ходы под первым рынком',type:'Катакомбы'},{id:'rodent_new',name:'Медный базар',desc:'Новые лавки алхимиков и сборщиков',type:'Базар'},{id:'rodent_guild',name:'Зал последнего факела',desc:'Тайные боевые техники и реликвии',type:'Гильдия'}],
 'Каменный порт':[{id:'cross_old',name:'Пыльный тракт',desc:'Старый караванный путь, где встречались первые торговцы',type:'Исторический тракт'},{id:'cross_new',name:'Площадь ста фонарей',desc:'Новый рынок путешественников',type:'Рынок'}],
 'Изумрудная долина':[{id:'harbor_old',name:'Корабельное кладбище',desc:'Остовы судов древних мореплавателей',type:'Старый порт'},{id:'harbor_new',name:'Маяк перемен',desc:'Новый маяк направляет корабли через туман',type:'Маяк'}],
 'Золотые дюны':[{id:'silver_old',name:'Крипта первых стражей',desc:'Памятные залы павших защитников',type:'Крипта'},{id:'silver_new',name:'Полигон зеркальных щитов',desc:'Новая арена для военных учений',type:'Полигон'}],
 'Серебряные руины':[{id:'crystal_old',name:'Расколотая обсерватория',desc:'Древняя башня изучения небесных кристаллов',type:'Обсерватория'},{id:'crystal_new',name:'Галерея живых граней',desc:'Современные мастерские огранщиков',type:'Мастерские'}],
 'Северная корона':[{id:'ash_old',name:'Пепельный некрополь',desc:'Забытые надгробия старой цитадели',type:'Некрополь'},{id:'ash_new',name:'Чёрная биржа',desc:'Новый рынок редких ресурсов и контрактов',type:'Биржа'}]
};

const FACTIONS = [
 {id:'dawn',name:'Союз Рассвета',desc:'Защитники дорог и мирных поселений.',repKey:'faction_dawn',shop:[{id:'dawn_charm',cost:1800,rep:30},{id:'archive_tonic',cost:650,rep:10}],recipe:'dawn_elixir',recipeRep:20},
 {id:'caravan',name:'Вольные караваны',desc:'Торговцы, разведчики и искатели новых путей.',repKey:'faction_caravan',shop:[{id:'freeblade',cost:2600,rep:30}],recipe:'caravan_blade',recipeRep:40},
 {id:'lore',name:'Хранители летописи',desc:'Архивариусы древних руин и хранители забытых рецептов.',repKey:'faction_lore',shop:[{id:'archive_tonic',cost:650,rep:10},{id:'dawn_charm',cost:1800,rep:50}],recipe:'lore_charm',recipeRep:60}
];
for (const faction of FACTIONS) for (const offer of faction.shop) { const item = ITEMS.find(i => i.id === offer.id); if (item && item.kind !== 'amulet' && item.kind !== 'material') offer.cost = Math.ceil(offer.cost * 1.3); }

function factionRank(rep:number){return rep>=100?'Почитаемый':rep>=60?'Прославленный':rep>=30?'Уважаемый':rep>=10?'Доверенный':'Незнакомец';}
const FACTION_MAX_REWARDS:Record<string,{repKey:string;item:string;title:string;name:string}>={
 dawn:{repKey:'faction_dawn',item:'dawn_regalia',title:'Заступник Первого Рассвета',name:'Регалия Первого Рассвета'},
 caravan:{repKey:'faction_caravan',item:'caravan_cleaver',title:'Легенда Вольного пути',name:'Рассекающий Горизонт'},
 lore:{repKey:'faction_lore',item:'lore_circlet',title:'Голос Живой Летописи',name:'Венец Живой Летописи'}
};

const RARE_PROPERTIES:Record<string,{name:string;desc:string;effect:string;value:number}>= {
  critical:{name:'Точный удар',desc:'+5% к шансу критического удара',effect:'crit',value:.05},
  leech:{name:'Кровопийца',desc:'Восстанавливает 3% максимального здоровья после победы',effect:'lifesteal',value:.03},
  hunter:{name:'Охотничье чутьё',desc:'+12% к золоту и шансам добычи',effect:'loot',value:.12},
  bulwark:{name:'Непоколебимость',desc:'+8% к защите',effect:'defense',value:.08},
  arcane:{name:'Резонанс',desc:'+8% к атаке',effect:'attack',value:.08}
};
const PROFESSION_SKILLS:Record<string,any[]>={
 'Боевой маг':[{id:'mana_surge',name:'Импульс маны',desc:'+18% атаки в следующем бою',effect:'attack',value:.18,cost:1800},{id:'arcane_ward',name:'Арканный щит',desc:'+18% защиты в следующем бою',effect:'defense',value:.18,cost:1600}],
 'Ассасин':[{id:'execution',name:'Точный выпад',desc:'+12% критического шанса в следующем бою',effect:'crit',value:.12,cost:1800},{id:'shadow_hunt',name:'Теневая охота',desc:'+15% добычи в следующем бою',effect:'loot',value:.15,cost:1500}],
 'Рыцарь':[{id:'shield_wall',name:'Стена щитов',desc:'+22% защиты в следующем бою',effect:'defense',value:.22,cost:1800},{id:'heavy_strike',name:'Тяжёлый удар',desc:'+15% атаки в следующем бою',effect:'attack',value:.15,cost:1600}],
 'Ассасин птицы':[{id:'bird_assassin_needle',name:'Одинокий выпад',desc:'+12% критического шанса в следующем бою',effect:'crit',value:.12,cost:1800},{id:'bird_assassin_windstep',name:'Шаг без следа',desc:'+15% добычи в следующем бою',effect:'loot',value:.15,cost:1500}],
 'Баффер':[{id:'battle_hymn',name:'Боевой гимн',desc:'+15% атаки в следующем бою',effect:'attack',value:.15,cost:1600},{id:'renewal',name:'Обновление',desc:'Восстанавливает 20% максимального здоровья',effect:'heal',value:.20,cost:1500}],
 'Лучник':[{id:'eagle_eye',name:'Глаз орла',desc:'+15% критического шанса в следующем бою',effect:'crit',value:.15,cost:1800},{id:'salvage_shot',name:'Меткий трофей',desc:'+18% добычи в следующем бою',effect:'loot',value:.18,cost:1500}],
 'Вампир':[{id:'blood_burst',name:'Кровавый всплеск',desc:'+18% атаки и лечение после победы',effect:'attack',value:.18,secondaryEffect:'lifesteal',secondaryValue:.08,cost:1800},{id:'night_resilience',name:'Ночная стойкость',desc:'+15% защиты в следующем бою',effect:'defense',value:.15,cost:1500}],
 'Добытчик':[{id:'deep_sense',name:'Чутьё глубин',desc:'+25% добычи в следующем бою',effect:'loot',value:.25,cost:1800},{id:'orebreaker',name:'Разрушитель жил',desc:'+12% атаки в следующем бою',effect:'attack',value:.12,cost:1400}]
};
const DUNGEONS:any[] = [...(EXPEDITION_DATA.dungeons||[])];
const EQUIPMENT_SETS:any[]=[
 {id:'mistwarden',name:'Страж Тумана',items:['mistwarden_blade','mistwarden_mail','mistwarden_charm'],two:'2 предмета: +8% к защите',full:'3 предмета: +12% к защите и +5% к здоровью',effect:'defense'},
 {id:'shadowstalker',name:'Теневой Следопыт',items:['shadowstalker_blades','shadowstalker_armor','amulet_crit'],two:'2 предмета: +6% к критическому шансу',full:'3 предмета: +12% к критическому урону',effect:'crit'},
 {id:'arcanist',name:'Архивариус',items:['arcanist_staff','arcanist_robe','amulet_power'],two:'2 предмета: +8% к атаке',full:'3 предмета: +12% к атаке и +5% к опыту',effect:'attack'}
 ];
for(const set of EQUIPMENT_SETS) set.legacy=true;
const groupedArmor=new Map<string,Item[]>();
for(const part of NEW_EQUIPMENT_ITEMS.filter(x=>x.kind==='armor'&&x.set)){const key=String(part.set);const arr=groupedArmor.get(key)||[];arr.push(part);groupedArmor.set(key,arr);}
for(const [name,parts] of groupedArmor){if(parts.length!==5)continue;const first=parts[0];const text=String(first.setBonus||'');const extract=(n:number)=>text.match(new RegExp(`${n}\\/5:\\s*([^;]+)`,'i'))?.[1]||`${n}/5: бонус комплекта`;const profession=String(first.profession||'');const displayName=String(first.setDisplayName||name);const effect=profession==='Добытчик'?'loot':profession==='Боевой маг'||profession==='Маг'?'attack':(profession==='Воин'||profession==='Рыцарь')||profession==='Баффер'?'defense':profession==='Вампир'?'lifesteal':profession==='Ассасин'||profession==='Ассасин птицы'||profession==='Лучник'?'crit':'defense';EQUIPMENT_SETS.push({id:`armor_${name.toLowerCase().replace(/[^a-z0-9а-я]+/gi,'_')}`,name:displayName,items:parts.map(x=>x.id),two:extract(2),three:extract(3),four:extract(4),full:extract(5),effect,value:0.02,profession,legacy:false});}


function applyHealthRegeneration(p: Player) {
  if (!p || !p.race) return;
  const quests = readObject(p.quests);
  const now = Date.now();
  const interval = 5 * 60 * 1000;
  const last = Number(quests.hpRegenAt || now);
  if (!quests.hpRegenAt) { quests.hpRegenAt = now; p.quests = JSON.stringify(quests); return; }
  const ticks = Math.floor((now - last) / interval);
  if (ticks <= 0) return;
  const effectiveMax=effectiveMaxHealth(p);if (p.health < effectiveMax) {
    const eq=readObject(p.equipment),collections=readObject(p.collections),pendant=NEW_EQUIPMENT_ITEMS.find(x=>x.id===eq.amulet);const regenBonus=pendant?.effect==='regen'?pendantEffectValue(pendant,Number(collections.pendantLevels?.[pendant.id]||1)):0;const amount = Math.max(1, Math.floor(effectiveMax * 0.05 * (1+regenBonus))) * ticks;
    p.health = Math.min(effectiveMax, p.health + amount);
  }
  quests.hpRegenAt = last + ticks * interval;
  p.quests = JSON.stringify(quests);
}

function groupSnapshot(playerId:string):any { const gid=PLAYER_GROUP.get(playerId); if(!gid)return null; const g=HUNT_GROUPS.get(gid); if(!g)return null; return {id:g.id,leader:publicPlayerCode(g.leader),members:g.members.map(id=>{const p=ONLINE_PLAYERS.get(id);return {id:publicPlayerCode(id),name:p?.name||'Отключён',level:p?.level||1,profession:p?.profession||'',online:!!p};})}; }
type AccountRecord = { username:string; usernameKey:string; playerId:string; salt:string; passwordHash:string; createdAt:number };
type SessionRecord = { tokenHash:string; playerId:string; accountKey:string|null; expiresAt:number };
const AUTH_SESSION_MS = 30 * 24 * 60 * 60 * 1000;
const AUTH_RATE_WINDOW_MS=15*60*1000;const AUTH_RATE_LIMIT=10;const AUTH_ATTEMPTS=new Map<string,{count:number;resetAt:number}>();let authRateOps=0;
function allowAuthAttempt(ip:string){const now=Date.now();let entry=AUTH_ATTEMPTS.get(ip);if(!entry||entry.resetAt<=now){entry={count:0,resetAt:now+AUTH_RATE_WINDOW_MS};AUTH_ATTEMPTS.set(ip,entry);}entry.count++;if(++authRateOps%100===0){for(const [key,value] of AUTH_ATTEMPTS)if(value.resetAt<=now)AUTH_ATTEMPTS.delete(key);if(AUTH_ATTEMPTS.size>10000){const oldest=Array.from(AUTH_ATTEMPTS.entries()).sort((a,b)=>a[1].resetAt-b[1].resetAt).slice(0,AUTH_ATTEMPTS.size-10000);for(const [key] of oldest)AUTH_ATTEMPTS.delete(key);}}return entry.count<=AUTH_RATE_LIMIT;}
/** Write a complete JSON snapshot to a sibling temp file, then atomically replace the target.
 * This protects existing saves from being truncated if the process stops during serialization/write.
 * It does not remove synchronous-I/O latency; database migration/load testing remain separate work.
 */
function writeJsonAtomic(file:string,value:unknown) { const temp=`${file}.${process.pid}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`; try { writeFileSync(temp,JSON.stringify(value,null,2),{encoding:'utf8',flag:'wx'}); renameSync(temp,file); } catch(error) { try { if(existsSync(temp)) unlinkSync(temp); } catch {} throw error; } }
function isPlainObject(value:any):value is Record<string,any>{return !!value&&typeof value==='object'&&!Array.isArray(value);}
function loadAccounts():AccountRecord[] { return readPersistentJson<AccountRecord[]>(ACCOUNT_FILE,[],value=>Array.isArray(value)&&value.every((x:any)=>isPlainObject(x)&&typeof x.username==='string'&&typeof x.usernameKey==='string'&&typeof x.playerId==='string'&&typeof x.salt==='string'&&typeof x.passwordHash==='string'&&Number.isFinite(x.createdAt))); }
function saveAccounts(value:AccountRecord[]) { writeJsonAtomic(ACCOUNT_FILE,value); }
function loadSessions():SessionRecord[] { return readPersistentJson<SessionRecord[]>(SESSION_FILE,[],value=>Array.isArray(value)&&value.every((x:any)=>isPlainObject(x)&&typeof x.tokenHash==='string'&&typeof x.playerId==='string'&&(x.accountKey===null||typeof x.accountKey==='string')&&Number.isFinite(x.expiresAt))); }
function saveSessions(value:SessionRecord[]) { writeJsonAtomic(SESSION_FILE,value); }
type GuestCredentialRecord = { playerId:string; tokenHash:string; createdAt:number };
function loadGuestCredentials():GuestCredentialRecord[] { return readPersistentJson<GuestCredentialRecord[]>(GUEST_CREDENTIAL_FILE,[],value=>Array.isArray(value)&&value.every((x:any)=>isPlainObject(x)&&typeof x.playerId==='string'&&typeof x.tokenHash==='string'&&Number.isFinite(x.createdAt))); }
function saveGuestCredentials(value:GuestCredentialRecord[]) { writeJsonAtomic(GUEST_CREDENTIAL_FILE,value); }
function tokenDigest(token:string) { return createHash('sha256').update(token).digest('hex'); }
function issueGuestCredential(playerId:string) { const proof=randomBytes(32).toString('hex');const records=loadGuestCredentials().filter(x=>x.playerId!==playerId);records.push({playerId,tokenHash:tokenDigest(proof),createdAt:Date.now()});saveGuestCredentials(records);return proof; }
function verifyGuestCredential(playerId:string,proof:string) { if(!proof||proof.length>256)return false;const record=loadGuestCredentials().find(x=>x.playerId===playerId);if(!record)return false;const actual=Buffer.from(tokenDigest(proof),'hex');const expected=Buffer.from(record.tokenHash,'hex');return actual.length===expected.length&&timingSafeEqual(actual,expected); }
function issueSession(playerId:string, accountKey:string|null) { const token=randomBytes(32).toString('hex'); const sessions=loadSessions().filter(x=>x.expiresAt>Date.now()); sessions.push({tokenHash:tokenDigest(token),playerId,accountKey,expiresAt:Date.now()+AUTH_SESSION_MS}); saveSessions(sessions); return token; }
function verifySession(token:string):SessionRecord|null { if(!token||token.length>256)return null;const hash=tokenDigest(token);const sessions=loadSessions();const session=sessions.find(x=>x.tokenHash===hash&&x.expiresAt>Date.now());if(!session)return null;const account=loadAccounts().find(x=>x.playerId===session.playerId);if(session.accountKey===null?Boolean(account):!account||account.usernameKey!==session.accountKey)return null;return session; }
function publicPlayerCode(id:string) { return createHash('sha256').update(`MistyIslesPublic:${id}`).digest('hex').slice(0,24); }
function resolvePublicPlayerCode(code:string, players:Record<string,any>=loadPlayers()) { for(const [id,online] of ONLINE_PLAYERS)players[id]=online.toJSON();const key=String(code||'');return Object.keys(players).find(id=>publicPlayerCode(id)===key)||''; }
function passwordMatches(password:string,salt:string,expected:string) { try { const actual=scryptSync(password,salt,64);const target=Buffer.from(expected,'hex');return target.length===actual.length&&timingSafeEqual(actual,target); } catch { return false; } }
function sendJson(res:ServerResponse,status:number,data:any) { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type','Access-Control-Allow-Methods':'POST, OPTIONS'});res.end(JSON.stringify(data)); }
function authHttpHandler(req:IncomingMessage,res:ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','Content-Type');res.setHeader('Access-Control-Allow-Methods','POST, OPTIONS');
  if(req.method==='OPTIONS'){res.writeHead(204);res.end();return;}
  const path=String(req.url||'').split('?')[0];if(!path?.startsWith('/auth/')){res.writeHead(404);res.end('Not found');return;}
  if(req.method!=='POST'){sendJson(res,405,{error:'Используй POST.'});return;}
  if(path==='/auth/login'||path==='/auth/register'||path==='/auth/guest'){const ip=req.socket.remoteAddress||'unknown';if(!allowAuthAttempt(ip)){sendJson(res,429,{error:'Слишком много попыток. Попробуй позже.'});return;}}
  let body='';req.on('data',chunk=>{body+=String(chunk);if(body.length>8192){sendJson(res,413,{error:'Слишком большой запрос.'});req.destroy();}});
  req.on('end',()=>{
    try {
      const d=JSON.parse(body||'{}');
      if(path==='/auth/guest'){
        const rawPlayerId=String(d.playerId||'').trim();
        const suppliedProof=String(d.guestProof||'');
        const legacySessionToken=String(d.sessionToken||'');
        if(!rawPlayerId){
          if(suppliedProof||legacySessionToken){sendJson(res,400,{error:'Некорректный запрос гостевого входа.'});return;}
          let playerId='';const players=loadPlayers();const accounts=loadAccounts();
          do { playerId=`guest_${randomBytes(16).toString('hex')}`; } while(players[playerId]||accounts.some(a=>a.playerId===playerId));
          const guestProof=issueGuestCredential(playerId);
          const token=issueSession(playerId,null);
          sendJson(res,200,{ok:true,playerId,token,guestProof,guest:true});return;
        }
        if(!/^[A-Za-z0-9_-]{12,64}$/.test(rawPlayerId)){sendJson(res,400,{error:'Не удалось подтвердить гостевой профиль.'});return;}
        const playerId=rawPlayerId;
        if(loadAccounts().some(a=>a.playerId===playerId)){sendJson(res,409,{error:'Этот персонаж привязан к аккаунту. Войди по логину и паролю.'});return;}
        let guestProof=suppliedProof;
        if(!verifyGuestCredential(playerId,guestProof)){
          const legacySession=legacySessionToken?verifySession(legacySessionToken):null;
          if(!legacySession||legacySession.accountKey!==null||legacySession.playerId!==playerId){
            sendJson(res,401,{error:'Не удалось подтвердить доступ к гостевому персонажу. Нужен действующий гостевой сеанс или секрет восстановления.'});return;
          }
          guestProof=issueGuestCredential(playerId);
        }
        const token=issueSession(playerId,null);
        sendJson(res,200,{ok:true,playerId,token,guestProof,guest:true});return;
      }
      if(path==='/auth/register'){
        const username=String(d.username||'').trim();const usernameKey=username.toLocaleLowerCase('en-US');const password=String(d.password||'');
        if(!/^[A-Za-z0-9_-]{3,20}$/.test(username)){sendJson(res,400,{error:'Логин: 3–20 символов, латинские буквы, цифры, _ или -.'});return;}
        if(password.length<8||password.length>128){sendJson(res,400,{error:'Пароль должен содержать от 8 до 128 символов.'});return;}
        const accounts=loadAccounts();if(accounts.some(a=>a.usernameKey===usernameKey)){sendJson(res,409,{error:'Такой логин уже занят.'});return;}
        const guestId=d.playerId?String(d.playerId):'';const guestProof=String(d.guestProof||'');
        if(guestId&&!verifyGuestCredential(guestId,guestProof)){sendJson(res,401,{error:'Не удалось подтвердить гостевого персонажа. Войди в гостевой режим и повтори.'});return;}
        const existing=accounts.find(a=>a.playerId===guestId);if(existing){sendJson(res,409,{error:'Этот персонаж уже привязан к другому аккаунту.'});return;}
        const playerId=guestId||`acct_${randomBytes(12).toString('hex')}`;const salt=randomBytes(16).toString('hex');const passwordHash=scryptSync(password,salt,64).toString('hex');
        accounts.push({username,usernameKey,playerId,salt,passwordHash,createdAt:Date.now()});saveAccounts(accounts);if(guestId){saveGuestCredentials(loadGuestCredentials().filter(x=>x.playerId!==playerId));saveSessions(loadSessions().filter(x=>x.playerId!==playerId));}const token=issueSession(playerId,usernameKey);sendJson(res,201,{ok:true,playerId,token,username});return;
      }
      if(path==='/auth/login'){
        const usernameKey=String(d.username||'').trim().toLocaleLowerCase('en-US');const password=String(d.password||'');const account=loadAccounts().find(a=>a.usernameKey===usernameKey);
        if(!account||!passwordMatches(password,account.salt,account.passwordHash)){sendJson(res,401,{error:'Неверный логин или пароль.'});return;}
        const token=issueSession(account.playerId,account.usernameKey);sendJson(res,200,{ok:true,playerId:account.playerId,token,username:account.username});return;
      }
      if(path==='/auth/check'){
        const session=verifySession(String(d.token||''));if(!session){sendJson(res,401,{error:'Сессия истекла. Войди снова.'});return;}sendJson(res,200,{ok:true,playerId:session.playerId});return;
      }
      if(path==='/auth/logout'){
        const token=String(d.token||'');const session=verifySession(token);if(!session){sendJson(res,401,{error:'Сессия не найдена или истекла.'});return;}const hash=tokenDigest(token);saveSessions(loadSessions().filter(x=>x.tokenHash!==hash));if(ONLINE_SESSION_HASHES.get(session.playerId)===hash)ONLINE_CLIENTS.get(session.playerId)?.leave(4021);sendJson(res,200,{ok:true});return;
      }
      sendJson(res,404,{error:'Неизвестный запрос.'});
    } catch { sendJson(res,400,{error:'Не удалось обработать запрос.'}); }
  });
}

class RoomState extends Schema { @type(Player) player = new Player(); }
class GameRoom extends Room<RoomState> {
  private playerId = '';
  private sessionToken = '';
  onCreate() { (this as any).maxClients = 1; this.setState(new RoomState()); this.registerHandlers(); this.clock.setInterval(() => applyHealthRegeneration(this.state.player), 1000); }
  onJoin(client: Client, options?: any) {
    const requestedPlayerId=safeId(options?.playerId);const session=verifySession(String(options?.sessionToken||''));
    if(!session||session.playerId!==requestedPlayerId) throw new Error('Требуется войти в аккаунт.');
    if (ONLINE_PLAYERS.has(session.playerId)) throw new Error('Этот персонаж уже находится в игре.');
    recoverPlayerStateBeforeMutation();
    this.playerId = session.playerId;
    this.sessionToken = String(options?.sessionToken||'');
    const saved = loadPlayers()[this.playerId];
    if (saved) { applySaved(this.state.player, saved); this.state.player.id = this.playerId; }
    else { this.state.player.id = this.playerId; this.state.player.name = 'Путник'; }
    const player=this.state.player; normalizePlayerProfessionData(player); normalizePlayerCityData(player); applyHealthRegeneration(player); const regenState=readObject(player.quests); if(!regenState.hpRegenAt){regenState.hpRegenAt=Date.now();player.quests=JSON.stringify(regenState);} const now=Date.now(); if(player.lastSeenAt>0 && now-player.lastSeenAt>=3*24*60*60*1000) player.returnBonusAvailable=1; player.lastSeenAt=now;
    ONLINE_PLAYERS.set(this.playerId, this.state.player);
    ONLINE_CLIENTS.set(this.playerId, client);
    ONLINE_SESSION_HASHES.set(this.playerId, tokenDigest(this.sessionToken));
    const initialQuests=readObject(player.quests); if(!initialQuests.expedition) initialQuests.expedition={branchId:'forgotten_lands',currentZoneId:'el1',opened:1,cleared:[],seen:{},state:'idle'};const persistedGroupId=PLAYER_GROUP.get(this.playerId)||'';if(initialQuests.expedition.groupId!==persistedGroupId){initialQuests.expedition.groupId=persistedGroupId;if(!persistedGroupId&&['searching','moving'].includes(initialQuests.expedition.state)){initialQuests.expedition.state='idle';initialQuests.expedition.endsAt=0;delete initialQuests.expedition.targetZoneId;}} player.quests=JSON.stringify(initialQuests); const normalizedEquipment=readObject(player.equipment); for(const slot of ['weapon','helmet','armor','gloves','boots','cloak','amulet']) if(normalizedEquipment[slot]===undefined) normalizedEquipment[slot]=''; player.equipment=JSON.stringify(normalizedEquipment);
    client.send('hello', { message: 'Соединение установлено.' });
    try { dispatchDungeonResultsToClient(this.playerId,client); } catch (error) { console.error('Dungeon result outbox delivery deferred:', error); }
    const recoveredRun=findActiveDungeonRunForParticipant(Object.fromEntries(ACTIVE_DUNGEON_RUNS),this.playerId);
    client.send('dungeonRunRecovery',{run:createDungeonRunRecoveryView(recoveredRun,this.playerId)});
    client.send('combatHistory', { history: (readObject(player.quests).combatHistory || []).slice(0, 20) });
    client.send('expeditionState',{state:readObject(player.quests).expedition,branch:EXPEDITION_DATA});
    client.send('huntGroupState',{group:groupSnapshot(this.playerId)});
    this.sendHuntGroupPlayers(client,player);
    client.send('catalog', { items: ITEMS, shopItems:shopCatalogForPlayer(player), zones: EXPEDITION_DATA.zones, expedition:EXPEDITION_DATA, neutralCities: NEUTRAL_CITIES, professions: PROFESSIONS, recipes: RECIPES, guildSkills: GUILD_SKILLS, cityLocations: CITY_LOCS, cityNpcs:CITY_NPCS, bossCatalog: EXPEDITION_BESTIARY, raceCityInfo: RACE_CITY_INFO, raceDailyQuests: RACE_DAILY_QUESTS, rareProperties: RARE_PROPERTIES, professionSkills: PROFESSION_SKILLS, dungeons: DUNGEONS, equipmentSets: EQUIPMENT_SETS });
    client.send('notice', { text: this.state.player.race ? `С возвращением, ${this.state.player.name}!` : 'Выбери расу, чтобы начать приключение.' });
  }
  onLeave(client: Client) {
    if (!isCurrentRoomSession({player:ONLINE_PLAYERS.get(this.playerId),client:ONLINE_CLIENTS.get(this.playerId),sessionHash:ONLINE_SESSION_HASHES.get(this.playerId)}, {player:this.state.player,client,sessionHash:tokenDigest(this.sessionToken)})) return;
    recoverPlayerStateBeforeMutation();
    applyHealthRegeneration(this.state.player);
    const groupId=PLAYER_GROUP.get(this.playerId);
    const group=groupId?HUNT_GROUPS.get(groupId):undefined;
    const affectedPlayers=(group?.members||[this.playerId]).map(id=>ONLINE_PLAYERS.get(id)).filter((player):player is Player=>!!player);
    const hasActiveGroupAction=affectedPlayers.some(player=>['searching','moving'].includes(String(readObject(player.quests).expedition?.state||'')));
    const previousQuests=new Map(affectedPlayers.map(player=>[player.id,player.quests]));
    for(const player of affectedPlayers){
      const quests=readObject(player.quests);
      if(!quests.expedition)continue;
      const expedition=quests.expedition;
      if(hasActiveGroupAction){
        expedition.state='idle';
        expedition.endsAt=0;
        delete expedition.targetZoneId;
      }
      expedition.groupId=player.id===this.playerId?'':(group?.id||'');
      quests.expedition=expedition;
      player.quests=JSON.stringify(quests);
    }
    this.state.player.lastSeenAt=Date.now();
    try{
      persistPlayers(affectedPlayers.length?affectedPlayers:[this.state.player]);
    }catch(error){
      for(const player of affectedPlayers){
        const previous=previousQuests.get(player.id);
        if(previous!==undefined)player.quests=previous;
      }
      throw error;
    }
    ONLINE_PLAYERS.delete(this.playerId);
    ONLINE_CLIENTS.delete(this.playerId);
    ONLINE_SESSION_HASHES.delete(this.playerId);
    GROUP_INVITES.delete(this.playerId);
    GROUP_INVITE_EXPIRES.delete(this.playerId);
    if(group){
      for(const id of group.members){
        const target=ONLINE_CLIENTS.get(id);
        if(!target)continue;
        const member=ONLINE_PLAYERS.get(id);
        if(member)target.send('expeditionState',{state:readObject(member.quests).expedition});
        target.send('huntGroupState',{group:groupSnapshot(id)});
      }
    }
  }
  onDispose() { recoverPlayerStateBeforeMutation(); applyHealthRegeneration(this.state.player); this.save(); }
  private save() { if (!this.playerId || !canSaveRoomPlayerSnapshot(ONLINE_PLAYERS.get(this.playerId), this.state.player)) return; this.state.player.lastSeenAt=Date.now(); persistPlayers([this.state.player]); }
  private notice(c: Client, text: string) { c.send('notice', { text }); this.save(); }
  private requireCharacter(c: Client) { if(ONLINE_CLIENTS.get(this.playerId)!==c){c.leave(4021);return false;}const p=this.state.player; if(!p.race){this.notice(c,'Сначала создай персонажа.');return false;} return true; }
  private addXp(p: Player, amount: number) { p.experience += amount; while(p.experience>=xpNeed(p.level)){p.experience-=xpNeed(p.level);p.level++;p.statPoints+=3;p.experienceToNext=xpNeed(p.level);const healthIncrease=18+p.vitality*0.5;p.maxHealth+=healthIncrease;p.health=Math.min(effectiveMaxHealth(p),p.health+healthIncrease);} }
  private finishCraftJobs(p: Player) { /* completed jobs stay claimable until the player collects them */ }
  private runExpeditionDungeon(c:Client,dungeon:any,requestIdRaw:unknown) {
    const groupId=PLAYER_GROUP.get(this.playerId),group=groupId?HUNT_GROUPS.get(groupId):undefined;if(group&&group.leader!==this.playerId)return this.notice(c,'Подземелье запускает лидер группы.');const ids=group?group.members:[this.playerId];const players=ids.map(id=>ONLINE_PLAYERS.get(id));if(players.some(x=>!x))return this.notice(c,'Все участники группы должны быть в сети.');const requestId=String(requestIdRaw||'').trim();if(!/^[A-Za-z0-9_-]{8,100}$/.test(requestId))return this.notice(c,'Не удалось подтвердить запрос подземелья. Обнови страницу и попробуй снова.');const cachedByPlayer=players.map(pl=>{const saved=readObject(pl!.quests),history=Array.isArray(saved.dungeonRequestHistory)?saved.dungeonRequestHistory:[];return {player:pl!,cached:history.find((entry:any)=>entry?.id===requestId)||saved.dungeonLastRequest};});if(cachedByPlayer.some(entry=>entry.cached?.id===requestId)){for(const entry of cachedByPlayer){const saved=entry.cached;if(saved?.id===requestId&&saved.report)ONLINE_CLIENTS.get(entry.player.id)?.send('combatResult',{eventId:`dungeon:legacy_${requestId}:${entry.player.id}:combatResult`,report:saved.report,text:String(saved.text||'Результат этого входа уже сохранён.'),requestId});}return;}const activeRun=findActiveDungeonRunForParticipants(Object.fromEntries(ACTIVE_DUNGEON_RUNS),ids);if(activeRun)return this.notice(c,`${activeRun.playerId}: у участника уже есть сохранённый забег. Сначала завершите его восстановление; новый вход недоступен.`);const dungeonLeader=ONLINE_PLAYERS.get(group?.leader||this.playerId);if(!dungeonLeader||Number(dungeonLeader.level)<dungeon.min)return this.notice(c,`Лидеру нужен минимум ${dungeon.min} уровень для этого подземелья.`);if(group&&!isHuntGroupLevelRangeValid(dungeonLeader.level,players.map(pl=>Number(pl!.level))))return this.notice(c,'Состав группы не соответствует ограничению ±5 уровней от лидера.');const day=new Date().toISOString().slice(0,10);for(const pl of players){const q=readObject(pl!.quests);if(getDungeonRunsForDay(q,day)>=3)return this.notice(c,`${pl!.name}: на сегодня закончились попытки в подземельях.`);}
    const boss=EXPEDITION_DATA.monsters.find((m:any)=>m.id===dungeon.bossId);if(!boss)return this.notice(c,'Страж подземелья не найден в бестиарии.');const stats=players.map(pl=>{const resolved=resolvePlayerMonsterStats(pl!,boss,{applyFivePieceSetBonus:false,includeLifestealBuff:true,isBoss:true});return {attack:resolved.attack,defense:resolved.defense,speed:resolved.speed,profession:resolved.profession,accuracyBonus:Number(resolved.combatModifiers?.accuracyBonus||0),evasionBonus:Number(resolved.combatModifiers?.evasionBonus||0),healingBonus:Number(resolved.combatModifiers?.healingBonus||0),lootBonus:resolved.lootBonus,lifestealBonus:resolved.lifestealBonus};});const passive=String(boss.passiveDescription||'');const passiveEffect=resolveMonsterPassive(passive);const bossWeakness=parseMonsterWeakness(String(boss.weakness||''));const effectiveBossDefense=Math.max(0,Number(boss.defense||0))*resolveLegacyMonsterDefenseMultiplier(passiveEffect, Number(boss.allies||0));const groupGuard=stats.some(x=>normalizeProfession(x.profession)==='Рыцарь')?0.08:0;const bossAttack=Number(boss.attack||0)*resolveLegacyMonsterAttackMultiplier(passiveEffect, Number(boss.allies||0));const combatPlan=calculateDungeonCombatPlan({dungeonPower:Number(dungeon.power),partySize:ids.length,bossDefense:effectiveBossDefense,bossAttack,bossAccuracy:Number(boss.accuracy??100),groupGuard,participants:stats.map((x,i)=>({attack:x.attack,defense:x.defense,health:players[i]!.health,outgoingResistanceMultiplier:(1-resolveLegacyMonsterResistance(passiveEffect,x.profession)),weaknessMultiplier:resolveLegacyMonsterWeaknessMultiplier(bossWeakness,x.profession),hitMultiplier:resolveLegacyMonsterHitMultiplier(passiveEffect,x.accuracyBonus),incomingProfessionMultiplier:resolveLegacyMonsterProfessionDamageMultiplier(passiveEffect,x.profession),incomingHitMultiplier:resolveLegacyPlayerHitMultiplier(x.evasionBonus,Number(boss.accuracy??100))}))});const {rounds,incoming,win}=combatPlan;const playerHpBefore=players.map(pl=>pl!.health);const goldShare=Math.floor(dungeon.gold/ids.length);const actualRewards=players.map(()=>({xp:0,gold:0}));const dungeonActivityAt:number[]=[];const dropBonus=Math.max(Math.max(stats.some(x=>x.profession==='Добытчик')?0.15:0,...stats.map(x=>Number((x as any).lootBonus||0))),...players.map(pl=>{const eq=readObject(pl!.equipment),col=readObject(pl!.collections),pend=NEW_EQUIPMENT_ITEMS.find(x=>x.id===eq.amulet);const pendantLoot=pend?.effect==='loot'?pendantEffectValue(pend,Number(col.pendantLevels?.[pend.id]||1)):0;const mastery=col.setMastery||{};const setLoot=Math.max(0,...EQUIPMENT_SETS.filter((set:any)=>!set.legacy&&set.effect==='loot').map((set:any)=>{const count=set.items.filter((id:string)=>Object.values(eq).includes(id)).length;return count>=2?count*.01+Number(mastery[set.id]||0)*.01+(count>=5?.05:0):0;}));return Math.max(pendantLoot,setLoot);}));const drops=rollDungeonDropIds(dungeon.resource,boss.drops||[],dropBonus,()=>Math.random());for(const pl of players){const q=consumeDungeonAttemptForDay(readObject(pl!.quests),day);pl!.quests=JSON.stringify(q);pl!.battles=Number(pl!.battles||0)+1;}
    const deferredSends:Array<()=>void>=[];const dungeonResultEvents:Array<{eventId:string;runId:string;playerId:string;messageType:string;payload:Record<string,unknown>}>=[];if(win){for(let i=0;i<players.length;i++){const pl=players[i]!;pl.health=Math.max(1,pl.health-incoming[i]);const healRate=resolvePlayerMonsterLifestealRate(pl.profession,stats[i].lifestealBonus);const healingMultiplier=resolveLegacyHealingMultiplier(passiveEffect,stats[i].healingBonus);if(healRate>0)pl.health=Math.min(effectiveMaxHealth(pl),pl.health+Math.floor(stats[i].attack*healRate*healingMultiplier));if(stats.some(x=>x.profession==='Баффер'))pl.health=Math.min(effectiveMaxHealth(pl),pl.health+Math.floor(effectiveMaxHealth(pl)*.04*healingMultiplier));pl.mobsKilled++;pl.victories++;pl.bossesKilled++;dungeonActivityAt[i]=Date.now();const col=readObject(pl.collections),pend=NEW_EQUIPMENT_ITEMS.find(x=>x.id===readObject(pl.equipment).amulet),pv=pendantEffectValue(pend,Number(pend?col.pendantLevels?.[pend.id]||1:1));const xpGain=Math.floor(dungeon.xp*(1+(pend?.effect==='xp'?pv:0))*(1+activeBuffValue(pl,'xp'))),goldGain=Math.floor(goldShare*(1+(pend?.effect==='gold'?pv:0))*(1+activeBuffValue(pl,'gold')));actualRewards[i]={xp:xpGain,gold:goldGain};pl.gold+=goldGain;pl.goldEarned+=goldGain;this.addXp(pl,xpGain);}const lootByPlayer:string[][]=players.map(()=>[]);const dropAllocations=allocateDungeonDropRecipients(drops,ids,()=>rand(0,players.length-1));for(const allocation of dropAllocations){const receiverIndex=ids.indexOf(allocation.recipientId),receiver=players[receiverIndex]!;const inv=readArray(receiver.inventory);inv.push(allocation.itemId);receiver.inventory=JSON.stringify(inv);lootByPlayer[receiverIndex].push(allocation.itemId);}const report=buildDungeonGroupCombatReport({at:Date.now(),dungeonName:dungeon.name,bossName:boss.name,bossRank:boss.rank,result:'win',passiveName:boss.passiveName,passiveDescription:boss.passiveDescription,weakness:boss.weakness,partySize:ids.length,rounds,xp:dungeon.xp,gold:goldShare,loot:drops.map(id=>ITEMS.find(x=>x.id===id)?.name||id).join(', ')});for(let i=0;i<players.length;i++){const member=players[i]!;const memberLoot=lootByPlayer[i].map(id=>ITEMS.find(x=>x.id===id)?.name||id).join(', ');const memberReport=buildDungeonMemberCombatReport({baseReport:report,profession:member.profession,level:member.level,attack:stats[i].attack,defense:stats[i].defense,damage:combatPlan.damageByParticipant[i],received:incoming[i],hpBefore:playerHpBefore[i],hpAfter:member.health,maxHealth:effectiveMaxHealth(member),rewards:{xp:actualRewards[i].xp,gold:actualRewards[i].gold,loot:memberLoot}});const target=ONLINE_CLIENTS.get(ids[i]);const remainingAttempts=Math.max(0,3-Number(readObject(member.quests).dungeonRuns||0));const memberResultText=`ПОДЗЕМЕЛЬЕ ПРОЙДЕНО: ${dungeon.name}. ${actualRewards[i].xp} опыта, ${actualRewards[i].gold} золота. Добыча распределена между участниками. Осталось входов сегодня: ${remainingAttempts}.`;const settlement=prepareDungeonMemberQuestSettlement({quests:readObject(member.quests),now:dungeonActivityAt[i],activity:{type:'dungeon',outcome:'win',title:'Подземелье Забытых земель пройдено',place:dungeon.name,enemy:boss.name,gold:goldGain,xp:xpGain,detail:`Победа над ${boss.name}; группа ${ids.length}/3; раундов ${rounds}.`},report:memberReport,requestId,playerId:member.id,text:memberResultText});const history=settlement.history;member.quests=JSON.stringify(settlement.quests);dungeonResultEvents.push(settlement.event);deferredSends.push(()=>target?.send('combatHistory',{history}));deferredSends.push(()=>target?.send('notice',{text:`Группа прошла подземелье «${dungeon.name}».`}));}persistDungeonResultPlayers(players as Player[],dungeonResultEvents);}else{for(let i=0;i<players.length;i++){const pl=players[i]!;pl.health=Math.max(1,pl.health-incoming[i]);dungeonActivityAt[i]=Date.now();}const report=buildDungeonGroupCombatReport({at:Date.now(),dungeonName:dungeon.name,bossName:boss.name,bossRank:boss.rank,result:'loss',passiveName:boss.passiveName,passiveDescription:boss.passiveDescription,weakness:boss.weakness,partySize:ids.length,rounds,xp:0,gold:0,loot:''});const resultText=`ПОДЗЕМЕЛЬЕ НЕ ПРОЙДЕНО: ${dungeon.name}. Попытка израсходована.`;for(let i=0;i<players.length;i++){const member=players[i]!;const memberReport=buildDungeonMemberCombatReport({baseReport:report,profession:member.profession,level:member.level,attack:stats[i].attack,defense:stats[i].defense,damage:combatPlan.damageByParticipant[i],received:incoming[i],hpBefore:playerHpBefore[i],hpAfter:member.health,maxHealth:effectiveMaxHealth(member)});const target=ONLINE_CLIENTS.get(ids[i]);const remainingAttempts=Math.max(0,3-Number(readObject(member.quests).dungeonRuns||0));const memberResultText=`${resultText} Осталось входов сегодня: ${remainingAttempts}.`;const settlement=prepareDungeonMemberQuestSettlement({quests:readObject(member.quests),now:dungeonActivityAt[i],activity:{type:'dungeon',outcome:'loss',title:'Подземелье не пройдено',place:dungeon.name,enemy:boss.name,gold:0,xp:0,detail:`Потеряно ${incoming[i]} здоровья; группа ${ids.length}/3.`},report:memberReport,requestId,playerId:member.id,text:memberResultText});const history=settlement.history;member.quests=JSON.stringify(settlement.quests);dungeonResultEvents.push(settlement.event);deferredSends.push(()=>target?.send('combatHistory',{history}));deferredSends.push(()=>target?.send('notice',{text:'Группа не справилась со стражем подземелья.'}));}persistDungeonResultPlayers(players as Player[],dungeonResultEvents);}deferredSends.forEach(send=>send());for(const playerId of ids){const target=ONLINE_CLIENTS.get(playerId);if(target)try{dispatchDungeonResultsToClient(playerId,target);}catch(error){console.error('Dungeon result outbox delivery deferred:',error);}}
  }
  private sendHuntGroupPlayers(c:Client,p:Player) {
    const own=readObject(p.collections); const friends=Array.isArray(own.friends)?own.friends:[];
    const players=Array.from(ONLINE_PLAYERS.entries()).filter(([id])=>id!==this.playerId).map(([id,v])=>{const vc=readObject(v.collections);const mutual=friends.includes(id)&&Array.isArray(vc.friends)&&vc.friends.includes(this.playerId);const sameClan=!!p.clan&&p.clan===v.clan;return {id:publicPlayerCode(id),name:v.name||'Путник',level:v.level||1,profession:v.profession||'',clan:v.clan||'',sameClan,friend:mutual,canInvite:sameClan||mutual};});
    c.send('huntGroupPlayers',{players}); c.send('huntGroupState',{group:groupSnapshot(this.playerId)});
  }
  private onAuthenticatedMessage(type:string,handler:(client:Client,payload:any)=>void) { this.onMessage(type,(client,payload)=>{const session=verifySession(this.sessionToken);if(!session||session.playerId!==this.playerId||ONLINE_CLIENTS.get(this.playerId)!==client){client.leave(4021);return;}recoverPlayerStateBeforeMutation();handler(client,payload);}); }
  private registerHandlers() {
    this.onAuthenticatedMessage('huntGroupList',(c)=>this.sendHuntGroupPlayers(c,this.state.player));
    this.onAuthenticatedMessage('friendRequest',(c,d:any)=>{if(!this.requireCharacter(c))return;const targetId=resolvePublicPlayerCode(String(d?.targetId||''));if(!targetId||targetId===this.playerId)return this.notice(c,'Укажи другого игрока.');const target=ONLINE_CLIENTS.get(targetId);if(!target)return this.notice(c,'Игрок должен быть в сети, чтобы принять запрос.');const requests=FRIEND_REQUESTS.get(targetId)||new Set<string>();requests.add(this.playerId);FRIEND_REQUESTS.set(targetId,requests);target.send('friendInvite',{fromId:publicPlayerCode(this.playerId),fromName:this.state.player.name||'Путник'});this.notice(c,'Запрос в друзья отправлен.');});
    this.onAuthenticatedMessage('friendAccept',(c,d:any)=>{if(!this.requireCharacter(c))return;const fromId=resolvePublicPlayerCode(String(d?.fromId||''));const requests=FRIEND_REQUESTS.get(this.playerId);if(!requests?.has(fromId))return this.notice(c,'Запрос в друзья не найден.');const own=readObject(this.state.player.collections),other=ONLINE_PLAYERS.get(fromId);if(!other)return this.notice(c,'Игрок уже не в сети.');const theirs=readObject(other.collections);own.friends=Array.from(new Set([...(own.friends||[]),fromId]));theirs.friends=Array.from(new Set([...(theirs.friends||[]),this.playerId]));this.state.player.collections=JSON.stringify(own);other.collections=JSON.stringify(theirs);persistPlayer(other);requests.delete(fromId);FRIEND_REQUESTS.set(this.playerId,requests);ONLINE_CLIENTS.get(fromId)?.send('friendAccepted',{id:publicPlayerCode(this.playerId),name:this.state.player.name});this.notice(c,`Вы с ${other.name} теперь друзья.`);this.sendHuntGroupPlayers(c,this.state.player);});
    this.onAuthenticatedMessage('huntGroupInvite',(c,d:any)=>{if(!this.requireCharacter(c))return;const targetId=resolvePublicPlayerCode(String(d?.targetId||''));const target=ONLINE_PLAYERS.get(targetId),targetClient=ONLINE_CLIENTS.get(targetId);if(!target||!targetClient)return this.notice(c,'Игрок должен быть в сети.');const own=readObject(this.state.player.collections),other=readObject(target.collections);const friend=Array.isArray(own.friends)&&own.friends.includes(targetId)&&Array.isArray(other.friends)&&other.friends.includes(this.playerId);const sameClan=!!this.state.player.clan&&this.state.player.clan===target.clan;if(!friend&&!sameClan)return this.notice(c,'Приглашать можно только друзей или соклановцев.');let groupId=PLAYER_GROUP.get(this.playerId);let group=groupId?HUNT_GROUPS.get(groupId):undefined;const hasActiveExpedition=(player:Player|undefined)=>{if(!player)return true;const state=readObject(player.quests).expedition;return ['searching','moving'].includes(String(state?.state||''));};if(hasActiveExpedition(this.state.player)||hasActiveExpedition(target)||(group?.members||[]).some(id=>hasActiveExpedition(ONLINE_PLAYERS.get(id))))return this.notice(c,'Нельзя менять состав группы во время поиска или перехода.');if(group&&group.leader!==this.playerId)return this.notice(c,'Приглашение может отправить только лидер группы.');if(!isHuntGroupLevelRangeValid(this.state.player.level,[...(group?.members||[]).map(id=>ONLINE_PLAYERS.get(id)?.level??Number.NaN),target.level]))return this.notice(c,'Все участники группы должны отличаться от уровня лидера не более чем на 5 уровней.');expireHuntGroupInvites(GROUP_INVITES,GROUP_INVITE_EXPIRES,Date.now());if(PLAYER_GROUP.has(targetId))return this.notice(c,'Игрок уже состоит в группе.');if(GROUP_INVITES.has(targetId))return this.notice(c,'У игрока уже есть ожидающее приглашение в группу.');const currentMemberCount=group?.members.length??1;const pendingInviteCount=group?countHuntGroupInvites(GROUP_INVITES,group.id):0;if(!canInviteToHuntGroup(currentMemberCount,pendingInviteCount))return this.notice(c,'В группе уже заняты или зарезервированы все 3 места.');if(!group){groupId=`hunt_${Date.now()}_${rand(100,999)}`;group={id:groupId,leader:this.playerId,members:[this.playerId]};HUNT_GROUPS.set(groupId,group);PLAYER_GROUP.set(this.playerId,groupId);persistHuntGroups();}const inviteExpiresAt=Date.now()+HUNT_GROUP_INVITE_TTL_MS;GROUP_INVITES.set(targetId,group.id);GROUP_INVITE_EXPIRES.set(targetId,inviteExpiresAt);const inviteExpiryTimer=setTimeout(()=>{if(GROUP_INVITE_EXPIRES.get(targetId)!==inviteExpiresAt)return;GROUP_INVITES.delete(targetId);GROUP_INVITE_EXPIRES.delete(targetId);},HUNT_GROUP_INVITE_TTL_MS);inviteExpiryTimer.unref?.();targetClient.send('huntGroupInvite',{groupId:group.id,fromId:publicPlayerCode(this.playerId),fromName:this.state.player.name||'Путник',expiresAt:inviteExpiresAt,expiresInMs:HUNT_GROUP_INVITE_TTL_MS});this.notice(c,`Приглашение отправлено игроку ${target.name}.`);c.send('huntGroupState',{group:groupSnapshot(this.playerId)});});
    this.onAuthenticatedMessage('huntGroupAccept',(c,d:any)=>{if(!this.requireCharacter(c))return;expireHuntGroupInvites(GROUP_INVITES,GROUP_INVITE_EXPIRES,Date.now());const groupId=String(d?.groupId||GROUP_INVITES.get(this.playerId)||'');const group=HUNT_GROUPS.get(groupId);if(!group||GROUP_INVITES.get(this.playerId)!==groupId)return this.notice(c,'Приглашение больше не действует.');const hasActiveExpedition=(player:Player|undefined)=>{if(!player)return true;const state=readObject(player.quests).expedition;return ['searching','moving'].includes(String(state?.state||''));};if(hasActiveExpedition(this.state.player)||group.members.some(id=>hasActiveExpedition(ONLINE_PLAYERS.get(id))))return this.notice(c,'Нельзя вступить в группу во время поиска или перехода.');if(group.members.length>=3)return this.notice(c,'В группе уже 3 участника.');if(PLAYER_GROUP.has(this.playerId))return this.notice(c,'Сначала покинь текущую группу.');const leader=ONLINE_PLAYERS.get(group.leader);if(!leader||!isHuntGroupLevelRangeValid(leader.level,[...group.members.map(id=>ONLINE_PLAYERS.get(id)?.level??Number.NaN),this.state.player.level]))return this.notice(c,'Уровень не подходит: все участники должны отличаться от уровня лидера не более чем на 5 уровней.');group.members.push(this.playerId);PLAYER_GROUP.set(this.playerId,groupId);GROUP_INVITES.delete(this.playerId);const acceptedInviteExpiresAt=GROUP_INVITE_EXPIRES.get(this.playerId);GROUP_INVITE_EXPIRES.delete(this.playerId);try{persistHuntGroups();}catch(error){if(HUNT_GROUPS.has(groupId)&&!PLAYER_GROUP.has(this.playerId)){GROUP_INVITES.set(this.playerId,groupId);if(acceptedInviteExpiresAt!==undefined)GROUP_INVITE_EXPIRES.set(this.playerId,acceptedInviteExpiresAt);}throw error;}for(const id of group.members)ONLINE_CLIENTS.get(id)?.send('huntGroupState',{group:groupSnapshot(id)});this.notice(c,'Ты присоединился к охотничьей группе.');});
    this.onAuthenticatedMessage('huntGroupLeave',(c)=>{
      if(!this.requireCharacter(c))return;
      const groupId=PLAYER_GROUP.get(this.playerId);
      const group=groupId?HUNT_GROUPS.get(groupId):undefined;
      if(!group)return this.notice(c,'Ты не состоишь в группе.');
      const persistedPlayers=loadPlayers();
      const activeGroupAction=group.members.some(id=>{
        const member=ONLINE_PLAYERS.get(id);
        const saved=member?null:persistedPlayers[id];
        if(!member&&!saved)return true;
        const state=readObject(member?.quests??saved?.quests).expedition;
        return ['searching','moving'].includes(String(state?.state||''));
      });
      if(activeGroupAction)return this.notice(c,'Нельзя покидать группу во время поиска или перехода.');
      const wasLeader=group.leader===this.playerId;
      const affectedIds=wasLeader?[...group.members]:[this.playerId];
      if(affectedIds.some(id=>!ONLINE_PLAYERS.has(id)&&!persistedPlayers[id])){
        return this.notice(c,'Не удалось изменить группу: сохранение участника не найдено.');
      }
      const previousQuests=new Map<string,string>();
      const affectedPlayers:Player[]=[];
      const playerQuestOverrides:Record<string,string>={};
      for(const id of affectedIds){
        const member=ONLINE_PLAYERS.get(id);
        const saved=member?null:persistedPlayers[id];
        const previous=member?member.quests:String(saved?.quests||'{}');
        const quests=readObject(previous);
        const expedition=quests.expedition||{};
        expedition.groupId='';
        quests.expedition=expedition;
        const nextQuests=JSON.stringify(quests);
        if(member){
          previousQuests.set(id,member.quests);
          member.quests=nextQuests;
          affectedPlayers.push(member);
        }else{
          playerQuestOverrides[id]=nextQuests;
        }
      }
      if(wasLeader){
        for(const id of group.members)PLAYER_GROUP.delete(id);
        HUNT_GROUPS.delete(group.id);
      }else{
        group.members=group.members.filter(id=>id!==this.playerId);
        PLAYER_GROUP.delete(this.playerId);
        if(!group.members.length)HUNT_GROUPS.delete(group.id);
      }
      try{
        persistHuntGroups(affectedPlayers,playerQuestOverrides);
      }catch(error){
        for(const [id,quests] of previousQuests){
          const member=ONLINE_PLAYERS.get(id);
          if(member)member.quests=quests;
        }
        throw error;
      }
      if(wasLeader){
        invalidateHuntGroupInvites(GROUP_INVITES,group.id,GROUP_INVITE_EXPIRES);
        for(const id of affectedIds){
          if(id===this.playerId)continue;
          const target=ONLINE_CLIENTS.get(id);
          const member=ONLINE_PLAYERS.get(id);
          if(member)target?.send('expeditionState',{state:readObject(member.quests).expedition});
          target?.send('huntGroupState',{group:null});
          target?.send('notice',{text:'Лидер покинул группу. Группа распущена.'});
        }
      }else if(group.members.length){
        for(const id of group.members)ONLINE_CLIENTS.get(id)?.send('huntGroupState',{group:groupSnapshot(id)});
      }
      c.send('huntGroupState',{group:null});
      this.notice(c,'Ты покинул охотничью группу.');
    });
    this.onAuthenticatedMessage('expeditionState',(c)=>{const q=readObject(this.state.player.quests);c.send('expeditionState',{state:q.expedition||{branchId:'forgotten_lands',currentZoneId:'el1',opened:1,cleared:[],seen:{},state:'idle'},branch:EXPEDITION_DATA});});
    this.onAuthenticatedMessage('expeditionSearchStart',(c)=>{if(!this.requireCharacter(c))return;const groupId=PLAYER_GROUP.get(this.playerId),group=groupId?HUNT_GROUPS.get(groupId):undefined;if(group&&group.leader!==this.playerId)return this.notice(c,'Начать поиск может лидер группы.');const ids=group?group.members:[this.playerId];if(ids.length>3)return this.notice(c,'Максимум 3 участника.');const players=ids.map(id=>ONLINE_PLAYERS.get(id));if(players.some(x=>!x))return this.notice(c,'Все участники группы должны быть в сети.');const states=players.map(pl=>readObject(pl!.quests).expedition||{branchId:'forgotten_lands',currentZoneId:'el1',opened:1,cleared:[],seen:{},state:'idle'});const current=states[0].currentZoneId||'el1';if(states.some(st=>st.currentZoneId!==current))return this.notice(c,'Все участники должны находиться в одной локации.');if(states.some(st=>st.state==='searching'||st.state==='moving'))return this.notice(c,'У группы уже идёт поиск или переход.');const zone=EXPEDITION_DATA.zones.find((z:any)=>z.id===current);if(!zone)return this.notice(c,'Локация экспедиции не найдена.');if(players.some(pl=>Number(pl!.level)<zone.minLevel))return this.notice(c,`Каждому участнику нужен минимум ${zone.minLevel} уровень для этой локации.`);const endsAt=Date.now()+EXPEDITION_DATA.searchSeconds*1000;for(const pl of players){const q=readObject(pl!.quests),st=q.expedition||{branchId:'forgotten_lands',currentZoneId:'el1',opened:1,cleared:[],seen:{},state:'idle'};st.state='searching';st.startedAt=Date.now();st.endsAt=endsAt;st.groupId=group?.id||'';q.expedition=st;pl!.quests=JSON.stringify(q);const id=pl!.id;ONLINE_CLIENTS.get(id)?.send('expeditionState',{state:st});}persistPlayers(players as Player[]);this.notice(c,`Поиск монстра начался. Результат будет через 15 минут. ${ids.length>1?`Участников: ${ids.length}.`:''}`);});
    this.onAuthenticatedMessage('expeditionSearchClaim',(c)=>{if(!this.requireCharacter(c))return;const deferredSends:Array<()=>void>=[];const groupId=PLAYER_GROUP.get(this.playerId),group=groupId?HUNT_GROUPS.get(groupId):undefined;if(group&&group.leader!==this.playerId)return this.notice(c,'Результат поиска забирает лидер группы.');const ids=group?group.members:[this.playerId];const players=ids.map(id=>ONLINE_PLAYERS.get(id));if(players.some(x=>!x))return this.notice(c,'Все участники должны быть в сети для завершения группового боя.');const firstQ=readObject(players[0]!.quests),st=firstQ.expedition;if(!st||st.state!=='searching')return this.notice(c,'Активного поиска нет.');const expectedGroupId=group?.id||'';const participantStates=players.map(pl=>readObject(pl!.quests).expedition);if(participantStates.some(es=>!es||es.state!=='searching'||String(es.groupId||'')!==expectedGroupId||es.currentZoneId!==st.currentZoneId||Number(es.endsAt||0)!==Number(st.endsAt||0)))return this.notice(c,'Состав группы или состояние поиска изменились. Перезапусти поиск.');if(Date.now()<Number(st.endsAt||0))return this.notice(c,`Поиск завершится через ${Math.ceil((Number(st.endsAt)-Date.now())/60000)} мин.`);const zone=EXPEDITION_DATA.zones.find((z:any)=>z.id===st.currentZoneId);const pool=EXPEDITION_DATA.monsters.filter((m:any)=>m.zoneId===st.currentZoneId);if(!zone||!pool.length){for(const pl of players){const q=readObject(pl!.quests),es=q.expedition||{};es.state='idle';es.endsAt=0;es.groupId=expectedGroupId;q.expedition=es;pl!.quests=JSON.stringify(q);}persistPlayers(players as Player[]);return this.notice(c,'Локация или список монстров экспедиции недоступны. Поиск сброшен.');}const seen=Array.isArray(st.seen?.[st.currentZoneId])?st.seen[st.currentZoneId]:[];const gate=pool.find((m:any)=>m.gatekeeper);const candidates=pool.filter((m:any)=>!m.gatekeeper);const zoneCleared=(st.cleared||[]).includes(st.currentZoneId);const monster=!zoneCleared&&candidates.length>0&&seen.length>=candidates.length&&gate?gate:zoneCleared&&gate&&Math.random()<.05?gate:candidates[rand(0,candidates.length-1)];if(!monster){for(const pl of players){const q=readObject(pl!.quests),es=q.expedition||{};es.state='idle';es.endsAt=0;es.groupId=expectedGroupId;q.expedition=es;pl!.quests=JSON.stringify(q);}persistPlayers(players as Player[]);return this.notice(c,'Для этой локации не настроен монстр. Поиск сброшен.');}const stats=players.map(pl=>{const resolved=resolvePlayerMonsterStats(pl!,monster,{applyFivePieceSetBonus:true,includeLifestealBuff:true});return {atk:resolved.attack,def:resolved.defense,speed:resolved.speed,profession:resolved.profession,accuracyBonus:Number(resolved.combatModifiers?.accuracyBonus||0),evasionBonus:Number(resolved.combatModifiers?.evasionBonus||0),healingBonus:Number(resolved.combatModifiers?.healingBonus||0),lootBonus:resolved.lootBonus,lifestealBonus:resolved.lifestealBonus};});const groupHp=monster.hp*(1+.55*(ids.length-1));const passiveText=String(monster.passiveDescription||'');const passiveEffect=resolveMonsterPassive(passiveText);const monsterWeakness=parseMonsterWeakness(String(monster.weakness||''));const effectiveMonsterDefense=Math.max(0,Number(monster.defense||0))*resolveLegacyMonsterDefenseMultiplier(passiveEffect, Number(monster.allies||0));const totalDps=stats.reduce((sum,x)=>{const weaknessMultiplier=resolveLegacyMonsterWeaknessMultiplier(monsterWeakness,x.profession);const resist=resolveLegacyMonsterResistance(passiveEffect,x.profession);return sum+x.atk*7*(100/(100+effectiveMonsterDefense))*(1-resist)*weaknessMultiplier*resolveLegacyMonsterHitMultiplier(passiveEffect,x.accuracyBonus);},0);const rounds=Math.max(1,Math.ceil(groupHp/Math.max(1,totalDps)));const groupGuard=stats.some(x=>normalizeProfession(x.profession)==='Рыцарь')?.08:0;const monsterAttack=Number(monster.attack||0)*resolveLegacyMonsterAttackMultiplier(passiveEffect, Number(monster.allies||0));const incoming=stats.map(x=>{const targetMultiplier=resolveLegacyMonsterProfessionDamageMultiplier(passiveEffect,x.profession);return Math.max(1,Math.floor((monsterAttack*.20-x.def*.12)*rounds*targetMultiplier*(1-groupGuard)*resolveLegacyPlayerHitMultiplier(x.evasionBonus,Number(monster.accuracy??100))));});const playerHpBefore=players.map(pl=>pl!.health);const win=rounds<=8&&players.every((pl,i)=>pl!.health>incoming[i]);const goldShare=Math.floor(monster.gold/ids.length);const actualRewards=players.map(()=>({xp:0,gold:0}));let assignedDrops:string[]=[];const lootByPlayer:string[][]=players.map(()=>[]);if(win){const lootBonus=Math.max(stats.some(x=>x.profession==='Добытчик')?0.15:0,...stats.map(x=>Number((x as any).lootBonus||0)),...players.map(pl=>{const eq=readObject(pl!.equipment),col=readObject(pl!.collections),pend=NEW_EQUIPMENT_ITEMS.find(x=>x.id===eq.amulet);const pendantLoot=pend?.effect==='loot'?pendantEffectValue(pend,Number(col.pendantLevels?.[pend.id]||1)):0;const mastery=col.setMastery||{};const setLoot=Math.max(0,...EQUIPMENT_SETS.filter((set:any)=>!set.legacy&&set.effect==='loot').map((set:any)=>{const count=set.items.filter((id:string)=>Object.values(eq).includes(id)).length;return count>=2?count*.01+Number(mastery[set.id]||0)*.01+(count>=5?.05:0):0;}));return Math.max(pendantLoot,setLoot);}));for(const drop of monster.drops||[])if(Math.random()<Math.min(.95,Number(drop.chance||0)*(1+lootBonus)))assignedDrops.push(drop.id);if(monster.gatekeeper&&!assignedDrops.length&&monster.drops?.[0])assignedDrops.push(monster.drops[0].id);for(let i=0;i<players.length;i++){const pl=players[i]!;pl.health=Math.max(1,pl.health-incoming[i]);const healRate=resolvePlayerMonsterLifestealRate(pl.profession,stats[i].lifestealBonus);const healingMultiplier=resolveLegacyHealingMultiplier(passiveEffect,stats[i].healingBonus);if(healRate>0)pl.health=Math.min(effectiveMaxHealth(pl),pl.health+Math.floor(stats[i].atk*healRate*healingMultiplier));if(stats.some(x=>x.profession==='Баффер'))pl.health=Math.min(effectiveMaxHealth(pl),pl.health+Math.floor(effectiveMaxHealth(pl)*.04*healingMultiplier));pl.battles=Number(pl.battles||0)+1;pl.mobsKilled++;pl.victories++;if(monster.rank==='rare')pl.rareMonstersKilled++;if(['boss','finalBoss'].includes(monster.rank))pl.bossesKilled++;const q=readObject(pl.quests),es=q.expedition||st;const dailyDay=new Date().toISOString().slice(0,10);if(!q.raceDaily||q.raceDaily.day!==dailyDay||q.raceDaily.race!==pl.race)q.raceDaily={day:dailyDay,race:pl.race,progress:{},claimed:[]};q.raceDaily.progress=q.raceDaily.progress||{};for(const dailyQuest of (RACE_DAILY_QUESTS[pl.race]||[])){if(dailyQuest.kind==='huntWins')q.raceDaily.progress[dailyQuest.id]=Number(q.raceDaily.progress[dailyQuest.id]||0)+1;}es.state='idle';es.endsAt=0;es.seen=es.seen||{};es.seen[zone.id]=Array.from(new Set([...(es.seen[zone.id]||[]),monster.id]));if(monster.gatekeeper){es.cleared=Array.from(new Set([...(es.cleared||[]),zone.id]));es.opened=Math.max(Number(es.opened||1),Math.min(10,zone.index+1));es.branchCompleted=zone.index===10;}q.expedition=es;pl.quests=JSON.stringify(q);const collections=readObject(pl.collections),pendantLevels=collections.pendantLevels||{},pendant=NEW_EQUIPMENT_ITEMS.find(x=>x.id===readObject(pl.equipment).amulet);const pendantLevel=pendant?Math.max(1,Math.min(100,Number(pendantLevels[pendant.id]||1))):0;const pendantValue=pendantEffectValue(pendant,pendantLevel);const xp=Math.floor(monster.xp*(1+(pendant?.effect==='xp'?pendantValue:0))*(1+activeBuffValue(pl,'xp')));const goldGain=Math.floor(goldShare*(1+(pendant?.effect==='gold'?pendantValue:0))*(1+activeBuffValue(pl,'gold')));actualRewards[i]={xp,gold:goldGain};this.addXp(pl,xp);pl.gold+=goldGain;pl.goldEarned+=goldGain;recordActivity(pl,{type:'hunt',outcome:'win',title:monster.rank==='finalBoss'?'Архонт побеждён':monster.rank==='boss'?'Промежуточный босс побеждён':'Экспедиционная охота',place:zone.name,enemy:monster.name,gold:goldGain,xp,detail:`Победа над ${monster.name}; раундов: ${rounds}; пассивный навык: ${monster.passiveName}.`});deferredSends.push(()=>ONLINE_CLIENTS.get(pl.id)?.send('expeditionState',{state:es}));}for(const itemId of assignedDrops){const receiverIndex=rand(0,players.length-1);const receiver=players[receiverIndex]!;const inv=readArray(receiver.inventory);inv.push(itemId);receiver.inventory=JSON.stringify(inv);lootByPlayer[receiverIndex].push(itemId);}const report={at:Date.now(),mode:'Экспедиция',zone:zone.name,enemy:monster.name,rank:monster.rank,result:'win',profession:'',level:0,attack:0,defense:0,damage:0,received:0,hpBefore:0,hpAfter:0,maxHealth:0,rewards:{xp:monster.xp,gold:goldShare,loot:''},lines:[`Локация: ${zone.name}. Противник: ${monster.name} (${monster.rank}).`,`Уровень монстра: ${monster.level}; HP: ${monster.hp}; атака: ${monster.attack}; защита: ${monster.defense}; скорость: ${monster.speed}.`,`Пассивный навык: ${monster.passiveName} — ${monster.passiveDescription}. Слабость: ${monster.weakness}.`,`Группа: ${ids.length}/3. Суммарная атака: ${Math.floor(stats.reduce((n,x)=>n+x.atk,0))}. Раундов: ${rounds}.`,`Награды: каждому ${monster.xp} опыта; золото разделено между участниками; предметы распределены случайно.`]};for(let i=0;i<players.length;i++){const member=players[i]!;const memberDamage=Math.floor(stats[i].atk*7*(100/(100+effectiveMonsterDefense))*(1-resolveLegacyMonsterResistance(passiveEffect,stats[i].profession))*resolveLegacyMonsterWeaknessMultiplier(monsterWeakness,stats[i].profession)*resolveLegacyMonsterHitMultiplier(passiveEffect,stats[i].accuracyBonus)*rounds);const memberLoot=lootByPlayer[i].map(id=>ITEMS.find(x=>x.id===id)?.name||id).join(', ');const memberReport={...report,profession:member.profession||'Без профессии',level:member.level,attack:Math.floor(stats[i].atk),defense:Math.floor(stats[i].def),damage:memberDamage,received:incoming[i],hpBefore:playerHpBefore[i],hpAfter:member.health,maxHealth:effectiveMaxHealth(member),rewards:{xp:actualRewards[i].xp,gold:actualRewards[i].gold,loot:memberLoot}};const history=saveCombatReport(member,memberReport);const target=ONLINE_CLIENTS.get(ids[i]);deferredSends.push(()=>target?.send('combatHistory',{history}));deferredSends.push(()=>target?.send('combatResult',{report:memberReport,text:`ПОБЕДА: ${monster.name}. Получено ${actualRewards[i].xp} опыта и ${actualRewards[i].gold} золота. Твоя добыча: ${memberLoot||'ничего не выпало'}.`}));deferredSends.push(()=>target?.send('notice',{text:`Победа над ${monster.name}. ${monster.gatekeeper?'Локация пройдена — следующая открыта.':''}`}));}persistPlayers(players as Player[]);deferredSends.forEach(send=>send());}else{for(let i=0;i<players.length;i++){const pl=players[i]!;pl.battles=Number(pl.battles||0)+1;pl.health=Math.max(1,pl.health-incoming[i]);recordActivity(pl,{type:'hunt',outcome:'loss',title:'Экспедиция: отступление',place:zone.name,enemy:monster.name,gold:0,xp:0,detail:`Потеряно ${incoming[i]} здоровья; раундов: ${rounds}.`});const q=readObject(pl.quests),es=q.expedition||st;es.state='idle';es.endsAt=0;q.expedition=es;pl.quests=JSON.stringify(q);deferredSends.push(()=>ONLINE_CLIENTS.get(pl.id)?.send('expeditionState',{state:es}));}const report={at:Date.now(),mode:'Экспедиция',zone:zone.name,enemy:monster.name,rank:monster.rank,result:'loss',profession:'',level:0,attack:0,defense:0,damage:0,received:0,hpBefore:0,hpAfter:0,maxHealth:0,rewards:{xp:0,gold:0,loot:''},lines:[`Группа не справилась с противником ${monster.name}.`,`Пассивный навык: ${monster.passiveName}. Слабость: ${monster.weakness}.`,`Все участники получили урон; добыча не выпала.`]};for(let i=0;i<players.length;i++){const member=players[i]!;const memberReport={...report,profession:member.profession||'Без профессии',level:member.level,attack:Math.floor(stats[i].atk),defense:Math.floor(stats[i].def),received:incoming[i],hpBefore:playerHpBefore[i],hpAfter:member.health,maxHealth:effectiveMaxHealth(member)};const history=saveCombatReport(member,memberReport);const target=ONLINE_CLIENTS.get(ids[i]);deferredSends.push(()=>target?.send('combatHistory',{history}));deferredSends.push(()=>target?.send('combatResult',{report:memberReport,text:`ОТСТУПЛЕНИЕ: ${monster.name}. Твоя попытка завершилась без награды.`}));deferredSends.push(()=>target?.send('notice',{text:'Экспедиция завершилась отступлением. Можно остаться и попробовать снова.'}));}persistPlayers(players as Player[]);deferredSends.forEach(send=>send());}});
    this.onAuthenticatedMessage('expeditionTravelStart',(c,d:any)=>{if(!this.requireCharacter(c))return;const q=readObject(this.state.player.quests),st=q.expedition||{currentZoneId:'el1',opened:1,cleared:[],seen:{},state:'idle'};if(st.state==='searching'||st.state==='moving')return this.notice(c,'Сначала заверши текущее действие.');const target=EXPEDITION_DATA.zones.find((z:any)=>z.id===String(d?.zoneId||''));if(!target||target.index>Number(st.opened||1))return this.notice(c,'Эта локация ещё не открыта.');if(target.id===st.currentZoneId)return this.notice(c,'Ты уже находишься в этой локации.');const groupId=PLAYER_GROUP.get(this.playerId),group=groupId?HUNT_GROUPS.get(groupId):undefined;if(group&&group.leader!==this.playerId)return this.notice(c,'Переход запускает лидер группы.');const ids=group?group.members:[this.playerId];const travelStates=ids.map(id=>{const participant=ONLINE_PLAYERS.get(id);return participant?(readObject(participant.quests).expedition||st):null;});if(travelStates.some(state=>!state))return this.notice(c,'Все участники должны быть в сети.');const startReadiness=checkExpeditionTravelStartReadiness(travelStates as any[]);if(!startReadiness.ready)return this.notice(c,'Все участники должны завершить поиск или переход перед новым переходом.');for(const id of ids){const pl=ONLINE_PLAYERS.get(id);if(!pl)return this.notice(c,'Все участники должны быть в сети.');const pq=readObject(pl.quests),es=pq.expedition||st;if(es.currentZoneId!==st.currentZoneId||target.index>Number(es.opened||1))return this.notice(c,'У всех участников должен быть открыт этот маршрут и совпадать текущая локация.');}for(const id of ids){const pl=ONLINE_PLAYERS.get(id)!;const pq=readObject(pl.quests),es=pq.expedition||st;es.state='moving';es.targetZoneId=target.id;es.endsAt=Date.now()+EXPEDITION_DATA.travelSeconds*1000;es.groupId=group?.id||'';pq.expedition=es;pl.quests=JSON.stringify(pq);ONLINE_CLIENTS.get(id)?.send('expeditionState',{state:es});}persistPlayers(ids.map(id=>ONLINE_PLAYERS.get(id)!).filter(Boolean));this.notice(c,'Переход начат. Прибытие через 25 минут.');});
    this.onAuthenticatedMessage('expeditionTravelClaim',(c)=>{if(!this.requireCharacter(c))return;const groupId=PLAYER_GROUP.get(this.playerId),group=groupId?HUNT_GROUPS.get(groupId):undefined;if(group&&group.leader!==this.playerId)return this.notice(c,'Переход завершает лидер группы.');const ids=group?group.members:[this.playerId];const participants=ids.map(id=>({id,player:ONLINE_PLAYERS.get(id)}));if(participants.some(x=>!x.player))return this.notice(c,'Все участники должны быть в сети.');const states=participants.map(({id,player})=>{const q=readObject(player!.quests);return {id,player:player!,q,es:q.expedition};});const consistency=checkExpeditionTravelConsistency(states.map(x=>x.es||{}),group?.id||'');if(!consistency.consistent)return this.notice(c,consistency.reason==='not-moving'?'Активного перехода нет.':'Состояние перехода участников не совпадает. Перезапусти переход.');const readiness=checkExpeditionTravelReadiness(states.map(x=>x.es||{}),Date.now());if(!readiness.ready){if(readiness.reason==='not-moving')return this.notice(c,'Активного перехода нет.');return this.notice(c,`Переход завершится через ${Math.ceil(readiness.remainingMs/60000)} мин.`);}for(const item of states){const es=item.es;es.currentZoneId=es.targetZoneId;delete es.targetZoneId;es.state='idle';es.endsAt=0;item.q.expedition=es;item.player.quests=JSON.stringify(item.q);ONLINE_CLIENTS.get(item.id)?.send('expeditionState',{state:es});}persistPlayers(states.map(x=>x.player));this.notice(c,'Группа прибыла в новую локацию.');});
    this.onAuthenticatedMessage('combatHistory',(c)=>{const history=readObject(this.state.player.quests).combatHistory||[];c.send('combatHistory',{history:history.slice(0,20)});});
    this.onAuthenticatedMessage('getCatalog',(c)=>c.send('catalog',{items:ITEMS,shopItems:shopCatalogForPlayer(this.state.player),zones:EXPEDITION_DATA.zones,neutralCities:NEUTRAL_CITIES,professions:PROFESSIONS,recipes:RECIPES,guildSkills:GUILD_SKILLS,cityLocations:CITY_LOCS,cityNpcs:CITY_NPCS,bossCatalog:EXPEDITION_BESTIARY,expedition:EXPEDITION_DATA,raceCityInfo:RACE_CITY_INFO,raceDailyQuests:RACE_DAILY_QUESTS,rareProperties:RARE_PROPERTIES,professionSkills:PROFESSION_SKILLS,dungeons:DUNGEONS,equipmentSets:EQUIPMENT_SETS}));
    this.onAuthenticatedMessage('upgradePendant',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player,id=String(d?.id||''),pendant=NEW_EQUIPMENT_ITEMS.find(x=>x.id===id&&x.kind==='amulet');if(!pendant)return this.notice(c,'Кольцо не найдено.');const inv=readArray(p.inventory),eq=readObject(p.equipment);if(!inv.includes(id)&&eq.amulet!==id)return this.notice(c,'Сначала получи и экипируй это кольцо.');const collections=readObject(p.collections),levels=collections.pendantLevels||{};const level=Math.max(1,Math.min(100,Number(levels[id]||1)));if(level>=100)return this.notice(c,'Кольцо уже улучшено до максимального уровня 100.');const next=level+1,baseCost=Math.max(0,Number(pendant.price||0)),cost=next===100?baseCost*100:baseCost;if(p.crystals<cost)return this.notice(c,`Улучшение до уровня ${next} стоит ${cost} кристаллов.`);const oldMax=effectiveMaxHealth(p),healthRatio=p.health/Math.max(1,oldMax);p.crystals-=cost;levels[id]=next;collections.pendantLevels=levels;p.collections=JSON.stringify(collections);p.health=Math.min(effectiveMaxHealth(p),Math.floor(effectiveMaxHealth(p)*healthRatio));this.notice(c,`Кольцо «${pendant.name}» улучшено до уровня ${next}. Потрачено ${cost} кристаллов.`);});
    this.onAuthenticatedMessage('upgradeSetMastery',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const set=EQUIPMENT_SETS.find((x:any)=>x.id===String(d?.setId||'')&&!x.legacy);if(!set)return this.notice(c,'Комплект не найден.');const eq=readObject(p.equipment),equipped=Object.values(eq);if(set.items.filter((id:string)=>equipped.includes(id)).length<5)return this.notice(c,'Для развития мастерства надень все 5 частей одного комплекта.');const collections=readObject(p.collections),mastery=collections.setMastery||{};const level=Math.max(0,Math.min(10,Number(mastery[set.id]||0)));if(level>=10)return this.notice(c,'Мастерство комплекта уже достигло максимума +10.');const next=level+1,goldCost=50000*next,mats:Record<string,number>={ash_ore:next*5,rune_shard:next*3,crystal_shard:next*2};if(next>=5)mats.abyss_shard=next-3;const inv=readArray(p.inventory),missing=Object.entries(mats).filter(([id,n])=>inv.filter(x=>x===id).length<n);if(p.gold<goldCost)return this.notice(c,`Для мастерства +${next} нужно ${goldCost} золота.`);if(missing.length)return this.notice(c,`Не хватает материалов: ${missing.map(([id,n])=>`${ITEMS.find(x=>x.id===id)?.name||id} ×${n}`).join(', ')}.`);p.gold-=goldCost;p.goldSpent+=goldCost;for(const [id,n] of Object.entries(mats))for(let i=0;i<n;i++)inv.splice(inv.indexOf(id),1);mastery[set.id]=next;collections.setMastery=mastery;p.collections=JSON.stringify(collections);p.inventory=JSON.stringify(inv);this.notice(c,`Мастерство комплекта «${set.name}» повышено до +${next}. Бонус комплекта усилен.`);});
    this.onAuthenticatedMessage('identifyEquipment',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const slot=String(d?.slot||'');if(!['weapon','armor','helmet','gloves','boots','cloak','amulet'].includes(slot))return this.notice(c,'Выбери слот экипировки.');const eq=readObject(p.equipment);const id=String(eq[slot]||'');const it=ITEMS.find(x=>x.id===id);if(!it)return this.notice(c,'Сначала экипируй предмет.');const collections=readObject(p.collections);const props=collections.equipmentProperties||{};if(props[id])return this.notice(c,'У этого предмета уже есть редкое свойство.');const cost=Math.max(1,Math.floor((500+it.level*100)/10));const inv=readArray(p.inventory);if(p.crystals<cost)return this.notice(c,`Идентификация стоит ${cost} кристаллов.`);if(inv.filter(x=>x==='rune_shard').length<2||inv.filter(x=>x==='crystal_shard').length<1)return this.notice(c,'Нужно 2 осколка руны и 1 кристальный осколок.');p.crystals-=cost;for(const id2 of ['rune_shard','rune_shard','crystal_shard'])inv.splice(inv.indexOf(id2),1);const keys=Object.keys(RARE_PROPERTIES);const prop=RARE_PROPERTIES[keys[rand(0,keys.length-1)]];props[id]={...prop,key:keys.find(k=>RARE_PROPERTIES[k]===prop)||'arcane'};collections.equipmentProperties=props;p.inventory=JSON.stringify(inv);p.collections=JSON.stringify(collections);this.notice(c,`Открыто редкое свойство «${prop.name}» для предмета «${it.name}»: ${prop.desc}.`);});
    this.onAuthenticatedMessage('professionSkill',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;if(!p.profession)return this.notice(c,'Сначала выбери профессию в боевой гильдии.');const skill=(PROFESSION_SKILLS[p.profession]||[]).find(x=>x.id===String(d?.id||''));if(!skill)return this.notice(c,'Навык недоступен твоей профессии.');const data=readObject(p.guildSkills);const unlocked=Array.isArray(data.professionUnlocked)?data.professionUnlocked:[];if(!unlocked.includes(skill.id)){if(p.gold<skill.cost)return this.notice(c,`Изучение навыка стоит ${skill.cost} золота.`);p.gold-=skill.cost;p.goldSpent+=skill.cost;data.professionUnlocked=[...unlocked,skill.id];p.guildSkills=JSON.stringify(data);return this.notice(c,`Навык «${skill.name}» изучен. Нажми ещё раз, чтобы применить его.`);}const last=Number(data[`prof_${skill.id}`]||0);if(Date.now()-last<60000)return this.notice(c,`Навык восстановится через ${Math.ceil((60000-(Date.now()-last))/1000)} сек.`);data[`prof_${skill.id}`]=Date.now();if(skill.effect==='heal'){const maxHp=effectiveMaxHealth(p);p.health=Math.min(maxHp,p.health+Math.floor(maxHp*skill.value));}else{p.buff=skill.effect;p.buffValue=Number(skill.value||0);p.buffSecondaryEffect=String(skill.secondaryEffect||'');p.buffSecondaryValue=Number(skill.secondaryValue||0);p.buffUntil=Date.now()+5*60*1000;}p.guildSkills=JSON.stringify(data);this.notice(c,`Применён навык «${skill.name}»: ${skill.desc}.`);});
    this.onAuthenticatedMessage('dungeonList',(c)=>c.send('dungeonList',{dungeons:DUNGEONS}));
    this.onAuthenticatedMessage('dungeonRun',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const dungeon=DUNGEONS.find(x=>x.id===String(d?.id||''));if(!dungeon)return this.notice(c,'Подземелье не найдено.');if(!dungeon.bossId)return this.notice(c,'Это подземелье больше недоступно.');if(p.level<dungeon.min)return this.notice(c,`Для входа нужен ${dungeon.min} уровень.`);return this.runExpeditionDungeon(c,dungeon,d?.requestId);});
        this.onAuthenticatedMessage('salvageItem',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const index=Number(d?.index);const inv=readArray(p.inventory);if(!Number.isInteger(index)||index<0||index>=inv.length)return this.notice(c,'Предмет не найден. Обнови инвентарь.');const expectedId=String(d?.itemId||'');const expectedCount=Number(d?.expectedCount);if(expectedId&&String(inv[index])!==expectedId)return this.notice(c,'Инвентарь изменился: предмет в этой ячейке уже другой. Обнови страницу.');if(expectedId&&Number.isInteger(expectedCount)&&inv.filter(x=>x===expectedId).length!==expectedCount)return this.notice(c,'Количество предметов изменилось: действие отменено во избежание повторной разборки. Обнови инвентарь.');const id=String(inv[index]);const it=ITEMS.find(x=>x.id===id);if(!it||!['weapon','armor','amulet'].includes(it.kind))return this.notice(c,'Разбирать можно только оружие, броню и кольца.');const eq=readObject(p.equipment);if(isLastEquippedCopy(inv,eq,id))return this.notice(c,'Нельзя разобрать последний экипированный экземпляр. Сначала экипируй другой предмет.');const removal=removeInventoryCopy(inv,eq,index);const reward=it.level>=40?'crystal_shard':it.level>=20?'rune_shard':'ash_ore';removal.inventory.push(reward);if(it.level>=35)removal.inventory.push(reward);p.inventory=JSON.stringify(removal.inventory);p.equipment=JSON.stringify(removal.equipment);const collections=readObject(p.collections);if(collections.equipmentProperties&&!ownsItemCopy(removal.inventory,removal.equipment,id)){delete collections.equipmentProperties[id];p.collections=JSON.stringify(collections);}this.notice(c,`Предмет разобран: ${it.name}. Получено ${ITEMS.find(x=>x.id===reward)?.name||reward}${it.level>=35?' ×2':''}.`);});
    this.onAuthenticatedMessage('createCharacter',(c,d:any)=>{const p=this.state.player;if(p.race)return this.notice(c,'Персонаж уже создан.');const race=String(d?.race||'');if(!RACES.includes(race))return this.notice(c,'Неизвестная раса.');const gender=d?.gender;if(!isCharacterGender(gender))return this.notice(c,'Выбери мужской или женский пол персонажа.');p.id=this.playerId;p.name=String(d?.name||`Путник-${race}`).slice(0,24);p.race=race;p.collections=JSON.stringify({...readObject(p.collections),characterGender:gender});p.city=CITIES[race];p.profession='';p.level=1;p.experience=0;p.experienceToNext=xpNeed(1);p.gold=250;p.health=p.maxHealth=100;p.strength=10;p.defense=8;p.vitality=10;p.dexterity=10;p.intelligence=10;p.luck=5;p.stamina=10;p.accuracy=10;p.inventory=JSON.stringify(['wood_sword','health_potion']);p.equipment=JSON.stringify({weapon:'wood_sword',helmet:'',armor:'',gloves:'',boots:'',cloak:'',amulet:''});p.zone='';this.notice(c,`Персонаж создан! Добро пожаловать в ${p.city}. Получено учебное оружие и зелье.`);c.send('catalog',{items:ITEMS,shopItems:shopCatalogForPlayer(p),zones:EXPEDITION_DATA.zones,expedition:EXPEDITION_DATA,neutralCities:NEUTRAL_CITIES,professions:PROFESSIONS,recipes:RECIPES,guildSkills:GUILD_SKILLS,cityLocations:CITY_LOCS,cityNpcs:CITY_NPCS,bossCatalog:EXPEDITION_BESTIARY,raceCityInfo:RACE_CITY_INFO,raceDailyQuests:RACE_DAILY_QUESTS,rareProperties:RARE_PROPERTIES,professionSkills:PROFESSION_SKILLS,dungeons:DUNGEONS,equipmentSets:EQUIPMENT_SETS});});
    this.onAuthenticatedMessage('chooseProfession',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const profession=normalizeProfession(d?.profession);if(p.level<20)return this.notice(c,'Профессии открываются на 20 уровне.');if(p.profession)return this.notice(c,'Профессия уже выбрана и не меняется.');if(!(PROFESSIONS[p.race]||[]).includes(profession))return this.notice(c,'Эта профессия недоступна выбранной расе.');p.profession=profession;this.notice(c,`Ты вступил в боевую гильдию: ${profession}.`);c.send('catalog',{items:ITEMS,shopItems:shopCatalogForPlayer(p),zones:EXPEDITION_DATA.zones,expedition:EXPEDITION_DATA,neutralCities:NEUTRAL_CITIES,professions:PROFESSIONS,recipes:RECIPES,guildSkills:GUILD_SKILLS,cityLocations:CITY_LOCS,cityNpcs:CITY_NPCS,bossCatalog:EXPEDITION_BESTIARY,raceCityInfo:RACE_CITY_INFO,raceDailyQuests:RACE_DAILY_QUESTS,rareProperties:RARE_PROPERTIES,professionSkills:PROFESSION_SKILLS,dungeons:DUNGEONS,equipmentSets:EQUIPMENT_SETS});});
    this.onAuthenticatedMessage('travel',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const city=String(d?.city||'');if(![...Object.values(CITIES),...NEUTRAL_CITIES].includes(city))return this.notice(c,'Такого города нет на карте.');p.city=city;const rep=readObject(p.cityReputation);const collections=readObject(p.collections);const firstVisit=!collections[`visited_${city}`];if(firstVisit){rep[city]=Number(rep[city]||0)+1;collections[`visited_${city}`]=true;}p.cityReputation=JSON.stringify(rep);p.collections=JSON.stringify(collections);this.notice(c,`Ты прибыл в город: ${city}.${firstVisit?' Репутация города +1 за первое посещение.':''}`);});
    this.onAuthenticatedMessage('upgradeStat',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const stat=String(d?.stat||'');const costs:Record<string,number>={strength:100+Math.floor(p.strength*7),defense:90+Math.floor(p.defense*6),vitality:100+Math.floor(p.vitality*7),dexterity:100+Math.floor(p.dexterity*7),intelligence:100+Math.floor(p.intelligence*7)};if(!Object.prototype.hasOwnProperty.call(costs,stat))return this.notice(c,'Такой характеристики нет.');if(p.gold<costs[stat])return this.notice(c,`Улучшение стоит ${costs[stat]} золота.`);p.gold-=costs[stat];p.goldSpent+=costs[stat];(p as any)[stat]++;if(stat==='vitality'){p.maxHealth+=8;p.health=Math.min(effectiveMaxHealth(p),p.health+8);}this.notice(c,`${statName(stat)} повышена. Потрачено ${costs[stat]} золота.`);});
    this.onAuthenticatedMessage('buyItem',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const item=ITEMS.find(i=>i.id===String(d?.id||''));if(!item||item.price<=0||item.legacy)return this.notice(c,'Предмет нельзя купить в магазине. Старые предметы доступны только в уже существующих сохранениях и сделках; новые создаются через актуальный каталог.');if(item.id===RESURRECTION_SCROLL_ID){try{const inCity=[...Object.values(CITIES),...NEUTRAL_CITIES].includes(String(p.city||''));const inActiveDungeon=Array.from(ACTIVE_DUNGEON_RUNS.values()).some(run=>run.status==='active'&&run.participantIds.includes(this.playerId));const purchased=purchaseResurrectionScroll({inventory:readArray(p.inventory),crystals:Number(p.crystals||0),inCity,inActiveDungeon});p.inventory=JSON.stringify(purchased.inventory);p.crystals=purchased.crystals;return this.notice(c,'Куплен свиток воскрешения за 100 кристаллов. В инвентаре может быть не более двух.');}catch(error){return this.notice(c,error instanceof Error?error.message:'Не удалось купить свиток воскрешения.');}}if(item.kind==='amulet'&&ownsPendant(p,item.id))return this.notice(c,'У тебя уже есть это кольцо. Одновременно можно иметь только один экземпляр каждого вида.');if(p.level<item.level)return this.notice(c,`Для покупки нужен ${item.level} уровень.`);if(item.race&&(p.race!==item.race||p.city!==CITIES[p.race]))return this.notice(c,`Товар «${item.name}» продаётся только расе «${item.race}» в родном городе ${CITIES[item.race]}.`);const activeProfession=String((p as any).activeSubclass||(p as any).subclassProfession||p.profession||'');if(item.profession&&normalizeProfession(p.profession)!==normalizeProfession(item.profession)&&normalizeProfession(activeProfession)!==normalizeProfession(item.profession))return this.notice(c,`Предмет предназначен для профессии «${normalizeProfession(item.profession)}».`);const currency=item.currency==='crystals'||item.kind==='amulet'||item.kind==='material'?'crystals':'gold';if(Number(p[currency]||0)<item.price)return this.notice(c,`Не хватает ${currency==='crystals'?'кристаллов':'золота'}. Цена: ${item.price}.`);p[currency]-=item.price;if(currency==='gold')p.goldSpent+=item.price;const inv=readArray(p.inventory);inv.push(item.id);p.inventory=JSON.stringify(inv);this.notice(c,`Куплено: ${item.name} за ${item.price} ${currency==='crystals'?'кристаллов':'золота'}. Предмет добавлен в инвентарь.`);});
    this.onAuthenticatedMessage('equipItem',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const id=String(d?.id||'');const inv=readArray(p.inventory);if(!inv.includes(id))return this.notice(c,'Предмет отсутствует в инвентаре.');const item=ITEMS.find(i=>i.id===id);if(!item||!['weapon','armor','amulet'].includes(item.kind))return this.notice(c,'Этот предмет нельзя экипировать.');if(item.race&&item.race!==p.race)return this.notice(c,`Этот предмет доступен только расе «${item.race}».`);if(p.level<item.level)return this.notice(c,`Нужен ${item.level} уровень.`);const activeProfession=String((p as any).activeSubclass||(p as any).subclassProfession||p.profession||'');if(item.profession&&normalizeProfession(item.profession)!==normalizeProfession(p.profession)&&normalizeProfession(item.profession)!==normalizeProfession(activeProfession))return this.notice(c,`Нужна профессия «${normalizeProfession(item.profession)}».`);const oldMax=effectiveMaxHealth(p),healthRatio=p.health/Math.max(1,oldMax);const eq=readObject(p.equipment);const slot=String(item.slot||item.kind);eq[slot]=id;p.equipment=JSON.stringify(eq);p.health=Math.min(effectiveMaxHealth(p),Math.floor(effectiveMaxHealth(p)*healthRatio));this.notice(c,`Экипировано: ${item.name}.`);});
    this.onAuthenticatedMessage('unequipItem',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const slot=String(d?.slot||'');if(!['weapon','armor','helmet','gloves','boots','cloak','amulet'].includes(slot))return this.notice(c,'Неизвестный слот экипировки.');const oldMax=effectiveMaxHealth(p),healthRatio=p.health/Math.max(1,oldMax);const eq=readObject(p.equipment);const id=String(eq[slot]||'');if(!id)return this.notice(c,'Этот слот уже пуст.');eq[slot]='';p.equipment=JSON.stringify(eq);p.health=Math.min(effectiveMaxHealth(p),Math.floor(effectiveMaxHealth(p)*healthRatio));this.notice(c,`Предмет снят: ${ITEMS.find(i=>i.id===id)?.name||id}. Он остался в инвентаре.`);});
    this.onAuthenticatedMessage('enhanceEquipment',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const slot=String(d?.slot||'');if(!['weapon','armor','helmet','gloves','boots','cloak'].includes(slot))return this.notice(c,'Заточить можно только оружие или одну из пяти частей брони.');const eq=readObject(p.equipment);const itemId=String(eq[slot]||'');const item=ITEMS.find(i=>i.id===itemId&&(i.kind===slot||(i.kind==='armor'&&i.slot===slot)));if(!item)return this.notice(c,slot==='weapon'?'Сначала экипируй оружие.':'Сначала экипируй броню.');const upgrades=readObject(p.equipmentEnhancements);const key=`${slot}:${itemId}`;const level=Math.max(0,Math.min(10,Number(upgrades[key]||0)));if(level>=10)return this.notice(c,'Предмет уже заточен до максимального уровня +10.');const next=level+1;const goldCost=250*next*next;const mats:Record<string,number>={};if(next>=3)mats.ash_ore=next>=7?3:1;if(next>=5)mats.rune_shard=next>=8?3:1;if(next>=8)mats.crystal_shard=next>=10?3:1;if(next>=10)mats.abyss_shard=1;const inv=readArray(p.inventory);const missing=Object.entries(mats).filter(([id,n])=>inv.filter(x=>x===id).length<n);if(p.gold<goldCost)return this.notice(c,`Нужно ${goldCost} золота для заточки +${next}.`);if(missing.length)return this.notice(c,`Не хватает материалов: ${missing.map(([id,n])=>`${ITEMS.find(i=>i.id===id)?.name||id} ×${n}`).join(', ')}.`);const protect=Boolean(d?.protect);const sealIndex=inv.indexOf('protection_seal');if(protect&&sealIndex<0)return this.notice(c,'Для защиты нужна Печать сохранения. Её можно купить здесь за 1 000 кристаллов.');p.gold-=goldCost;p.goldSpent+=goldCost;for(const [id,n] of Object.entries(mats)){for(let i=0;i<n;i++)inv.splice(inv.indexOf(id),1);}if(protect)inv.splice(inv.indexOf('protection_seal'),1);const chances:Record<number,number>={1:.95,2:.9,3:.85,4:.75,5:.65,6:.55,7:.45,8:.38,9:.3,10:.25};const success=Math.random()<chances[next];let result='';if(success){upgrades[key]=next;result=`Успех! ${item.name} улучшен до +${next}.`;}else if(protect){result=`Неудача на +${next}, но Печать сохранения защитила текущий уровень +${level}.`; }else{upgrades[key]=Math.max(0,level-1);result=`Неудача! Уровень заточки снизился: +${level} → +${Math.max(0,level-1)}. Используй Печать сохранения, чтобы избежать потери.`;}p.equipmentEnhancements=JSON.stringify(upgrades);p.inventory=JSON.stringify(inv);this.notice(c,`${result} Потрачено ${goldCost} золота.${Object.keys(mats).length?` Материалы: ${Object.entries(mats).map(([id,n])=>`${ITEMS.find(i=>i.id===id)?.name||id} ×${n}`).join(', ')}.`:''}`);});
    this.onAuthenticatedMessage('buyProtectionSeal',(c)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const cost=1000;if(p.crystals<cost)return this.notice(c,`Печать сохранения стоит ${cost} кристаллов.`);p.crystals-=cost;p.inventory=JSON.stringify([...readArray(p.inventory),'protection_seal']);this.notice(c,'Куплена Печать сохранения за 1 000 кристаллов. При заточке отметь защиту, чтобы не потерять уровень при неудаче.');});
    this.onAuthenticatedMessage('exchangeGem',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const amount=Math.max(1,Math.min(100000,Math.floor(Number(d?.amount)||1)));if(p.gems<amount)return this.notice(c,`Не хватает самоцветов: нужно ${amount}, есть ${p.gems}.`);p.gems-=amount;p.crystals+=amount*10;this.notice(c,`Обмен выполнен: ${amount} самоцвет(ов) → ${amount*10} кристаллов. Обратный обмен недоступен.`);});
    this.onAuthenticatedMessage('discardItem',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const healthRatio=p.health/Math.max(1,effectiveMaxHealth(p));const inv=readArray(p.inventory);const index=Number(d?.index);if(!Number.isInteger(index)||index<0||index>=inv.length)return this.notice(c,'Предмет уже отсутствует в инвентаре.');const expectedId=String(d?.itemId||'');const expectedCount=Number(d?.expectedCount);if(expectedId&&String(inv[index])!==expectedId)return this.notice(c,'Инвентарь изменился: предмет в этой ячейке уже другой. Обнови страницу.');if(expectedId&&Number.isInteger(expectedCount)&&inv.filter(x=>x===expectedId).length!==expectedCount)return this.notice(c,'Количество предметов изменилось: действие отменено во избежание повторного удаления. Обнови инвентарь.');const eq=readObject(p.equipment);const removal=removeInventoryCopy(inv,eq,index);const removed=removal.itemId;p.inventory=JSON.stringify(removal.inventory);p.equipment=JSON.stringify(removal.equipment);const newMax=effectiveMaxHealth(p);p.health=Math.min(newMax,Math.floor(newMax*healthRatio));const collections=readObject(p.collections);if(collections.equipmentProperties&&!ownsItemCopy(removal.inventory,removal.equipment,removed)){delete collections.equipmentProperties[removed];p.collections=JSON.stringify(collections);}this.notice(c,`Предмет ${ITEMS.find(i=>i.id===removed)?.name||removed} удалён из инвентаря.`);});
    this.onAuthenticatedMessage('usePotion',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const id=String(d?.id||'');const item=ITEMS.find(i=>i.id===id&&i.kind==='potion');const inv=readArray(p.inventory);if(!item||!inv.includes(id))return this.notice(c,'Такого зелья нет в инвентаре.');const maxHp=effectiveMaxHealth(p);if(p.health>=maxHp)return this.notice(c,'Здоровье уже полное.');p.health=Math.min(maxHp,p.health+Math.floor(maxHp*(item.heal||.5)));inv.splice(inv.indexOf(id),1);p.inventory=JSON.stringify(inv);this.notice(c,`${item.name} использовано. Здоровье: ${p.health}/${effectiveMaxHealth(p)}.`);});
    this.onAuthenticatedMessage('daily',(c)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const day=new Date().toISOString().slice(0,10);const daily=readObject(p.daily);if(daily.day===day)return this.notice(c,'Ежедневная награда уже получена.');const previousDay=new Date(Date.now()-24*60*60*1000).toISOString().slice(0,10);daily.streak=daily.day===previousDay?Math.max(0,Number(daily.streak)||0)+1:1;daily.day=day;p.daily=JSON.stringify(daily);const gold=75+p.level*12;p.gold+=gold;p.goldEarned+=gold;p.inventory=JSON.stringify([...readArray(p.inventory),'health_potion']);this.addXp(p,100+p.level*15);this.notice(c,`Ежедневная награда: ${gold} золота, опыт и зелье здоровья. Серия: ${daily.streak} дн.`);});
    this.onAuthenticatedMessage('fountain',(c)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const day=new Date().toISOString().slice(0,10);if(p.lastFountainAt&&new Date(p.lastFountainAt).toISOString().slice(0,10)===day)return this.notice(c,'Фонтан уже одарил тебя сегодня.');p.lastFountainAt=Date.now();const roll=rand(1,3);if(roll===1){p.gold+=100;p.goldEarned+=100;this.notice(c,'Фонтан подарил 100 золота.');}else if(roll===2){p.health=effectiveMaxHealth(p);this.notice(c,'Магическая вода полностью восстановила здоровье.');}else{p.inventory=JSON.stringify([...readArray(p.inventory),'health_potion']);this.notice(c,'В воде нашлось зелье здоровья.');}});
    this.onAuthenticatedMessage('buff',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const kind=String(d?.kind||'attack');if(!['attack','defense','xp'].includes(kind))return this.notice(c,'Неизвестное благословение.');const cost=500+p.level*80;if(p.gold<cost)return this.notice(c,`Благословение стоит ${cost} золота.`);p.gold-=cost;p.goldSpent+=cost;p.buff=kind;p.buffValue=.15;p.buffSecondaryEffect='';p.buffSecondaryValue=0;p.buffUntil=Date.now()+30*60*1000;this.notice(c,`Благословение ${kind} действует 30 минут.`);});
    this.onAuthenticatedMessage('mine',(c)=>{if(!this.requireCharacter(c))return;this.notice(c,'Ресурсы добываются в экспедиционной охоте и выдаются за задания.');});
    this.onAuthenticatedMessage('upgradeBuilding',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const key=String(d?.building||'');const allowed=['training','garden','library','workshop','warehouse'];if(!allowed.includes(key))return this.notice(c,'Постройка не найдена.');const b=readObject(p.buildings);const lvl=Number(b[key]||0);if(lvl>=10)return this.notice(c,'Постройка максимального уровня.');const cost=Math.floor(650*Math.pow(lvl+1,1.85));if(p.gold<cost)return this.notice(c,`Улучшение стоит ${cost} золота.`);p.gold-=cost;p.goldSpent+=cost;b[key]=lvl+1;p.buildings=JSON.stringify(b);if(key==='training')p.strength+=2;if(key==='garden'){p.vitality+=2;p.maxHealth+=10;p.health+=10;}if(key==='library')p.intelligence+=2;if(key==='workshop')p.crafting++;if(key==='warehouse')p.luck++;this.notice(c,`Постройка улучшена до ${lvl+1} уровня. Бонус применён.`);});
    this.onAuthenticatedMessage('factionChoice',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const q=readObject(p.quests);if(q.factionChoice)return this.notice(c,'Сюжетный выбор уже сделан и повлиял на отношения фракций.');const choice=String(d?.choice||'');if(!['dawn','caravan','lore'].includes(choice))return this.notice(c,'Неизвестная фракция.');q.factionChoice=choice;p.quests=JSON.stringify(q);const rep=readObject(p.cityReputation);const eq=readObject(p.equipment),collections=readObject(p.collections),pendant=NEW_EQUIPMENT_ITEMS.find(x=>x.id===eq.amulet);const reputationBonus=pendant?.effect==='reputation'?pendantEffectValue(pendant,Number(collections.pendantLevels?.[pendant.id]||1)):0;const reputationGain=Math.floor(15*(1+reputationBonus));rep[`faction_${choice}`]=Number(rep[`faction_${choice}`]||0)+reputationGain;for(const f of ['dawn','caravan','lore'])if(f!==choice)rep[`faction_${f}`]=Math.max(0,Number(rep[`faction_${f}`]||0)-5);p.cityReputation=JSON.stringify(rep);const label=FACTIONS.find(f=>f.id===choice)?.name||choice;this.notice(c,`Ты поддержал фракцию «${label}»: +${reputationGain} репутации. Две другие фракции насторожились (-5). Выбор влияет на доступ к магазинам и рецептам.`);});
    this.onAuthenticatedMessage('factionBuy',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const faction=FACTIONS.find(f=>f.id===String(d?.faction||''));const offer=faction?.shop.find(x=>x.id===String(d?.item||''));if(!faction||!offer)return this.notice(c,'Такого товара у фракции нет.');const rep=Number(readObject(p.cityReputation)[faction.repKey]||0);if(rep<offer.rep)return this.notice(c,`Нужна репутация ${offer.rep}. Текущая: ${rep}.`);const item=ITEMS.find(i=>i.id===offer.id);if(!item)return this.notice(c,'Предмет временно недоступен.');if(item.kind==='amulet'&&ownsPendant(p,item.id))return this.notice(c,'У тебя уже есть это кольцо. Одновременно можно иметь только один экземпляр каждого вида.');if(p.level<item.level)return this.notice(c,`Нужен ${item.level} уровень.`);const currency=item.currency==='crystals'||item.kind==='amulet'||item.kind==='material'?'crystals':'gold';if(Number(p[currency]||0)<offer.cost)return this.notice(c,`Не хватает ${currency==='crystals'?'кристаллов':'золота'}. Цена: ${offer.cost}.`);p[currency]-=offer.cost;if(currency==='gold')p.goldSpent+=offer.cost;p.inventory=JSON.stringify([...readArray(p.inventory),item.id]);this.notice(c,`Куплено у фракции «${faction.name}»: ${item.name} за ${offer.cost} ${currency==='crystals'?'кристаллов':'золота'}.`);});
    this.onAuthenticatedMessage('raceDailyClaim',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const id=String(d?.id||'');const defs=RACE_DAILY_QUESTS[p.race]||[];const def=defs.find((q:any)=>q.id===id);if(!def)return this.notice(c,'Это поручение не относится к твоей расе.');const {quests,state}=raceDailyState(p);if(state.claimed.includes(id))return this.notice(c,'Награда за это поручение уже получена сегодня.');if(p.level<Number(def.minLevel||1))return this.notice(c,`Для поручения «${def.title}» нужен ${def.minLevel} уровень.`);const progress=Number(state.progress[id]||0);if(progress<def.goal)return this.notice(c,`Поручение «${def.title}»: прогресс ${progress}/${def.goal}.`);state.claimed.push(id);quests.raceDaily=state;p.quests=JSON.stringify(quests);const gold=Math.floor(def.gold+p.level*8);const xp=Math.floor(def.xp+p.level*5);p.gold+=gold;p.goldEarned+=gold;this.addXp(p,xp);const rep=readObject(p.cityReputation);rep[`race_${p.race}`]=Number(rep[`race_${p.race}`]||0)+2;p.cityReputation=JSON.stringify(rep);this.notice(c,`Поручение «${def.title}» выполнено: +${gold} золота, +${xp} опыта и +2 репутации народа.`);});
    this.onAuthenticatedMessage('quest',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const id=String(d?.id||'');const quests=readObject(p.quests);if(id.startsWith('branch_'))return this.notice(c,'Используй отдельный выбор фракции, чтобы зафиксировать сюжетную ветку.');const today=new Date().toISOString().slice(0,10);const story:[string,string,string,()=>boolean,number,number,string][]=[['story_1','Следы в тумане','Одержи 3 победы и узнай, кто оставляет руны на тропах.',()=>p.victories>=3,180,120,'Сумеречный приют'],['story_2','Письмо из старых земель','Одержи 3 победы в экспедиционной охоте и достигни 5 уровня.',()=>p.mobsKilled>=3&&p.level>=5,320,220,'Золотые дюны'],['story_3','Голос обсерватории','Победи 15 монстров и достигни 10 уровня.',()=>p.mobsKilled>=15&&p.level>=10,650,450,'Изумрудная долина']];const factionChoice=String(quests.factionChoice||'');
      const factionStories:Record<string,{faction:string;title:string;desc:string;check:(p:any,q:any)=>boolean;gold:number;xp:number;rep:number;item:string}[]>={
        dawn:[{faction:'dawn',title:'Глава I — Огни на тракте',desc:'Одержи 5 побед на окраине островов.',check:(_pl,q)=>Number(q.factionDawnKills||0)>=5,gold:450,xp:260,rep:15,item:'faction_seal_dawn'},{faction:'dawn',title:'Глава II — Солнечный пожиратель',desc:'Победи фракционного босса Союза Рассвета.',check:(_pl,q)=>Number(q.factionBoss_dawn||0)>=1,gold:900,xp:650,rep:15,item:'faction_seal_dawn'},{faction:'dawn',title:'Глава III — Клятва дозорного',desc:'Помоги региональному событию Союза Рассвета 3 раза.',check:(_pl,q)=>Number(q.factionEvent_dawn||0)>=3,gold:1500,xp:1000,rep:15,item:'faction_seal_dawn'}],
        caravan:[{faction:'caravan',title:'Глава I — Плата за путь',desc:'Одержи 8 побед в любых регионах.',check:(pl)=>pl.victories>=8,gold:500,xp:300,rep:15,item:'faction_seal_caravan'},{faction:'caravan',title:'Глава II — Караванный разоритель',desc:'Победи фракционного босса Вольных караванов.',check:(_pl,q)=>Number(q.factionBoss_caravan||0)>=1,gold:1000,xp:700,rep:15,item:'faction_seal_caravan'},{faction:'caravan',title:'Глава III — Маршрут без конца',desc:'Участвуй в региональном событии караванов 3 раза.',check:(_pl,q)=>Number(q.factionEvent_caravan||0)>=3,gold:1700,xp:1100,rep:15,item:'faction_seal_caravan'}],
        lore:[{faction:'lore',title:'Глава I — Чернила в камне',desc:'Одержи 5 побед в Забытых руинах.',check:(pl,q)=>Number(q.factionRuinsKills||0)>=5,gold:480,xp:320,rep:15,item:'faction_seal_lore'},{faction:'lore',title:'Глава II — Редактор судеб',desc:'Победи фракционного босса Хранителей летописи.',check:(_pl,q)=>Number(q.factionBoss_lore||0)>=1,gold:1050,xp:760,rep:15,item:'faction_seal_lore'},{faction:'lore',title:'Глава III — Последняя запись',desc:'Участвуй в региональном событии Хранителей 3 раза.',check:(_pl,q)=>Number(q.factionEvent_lore||0)>=3,gold:1800,xp:1200,rep:15,item:'faction_seal_lore'}]
      };
      if(id.startsWith('faction_story_')){if(!factionChoice)return this.notice(c,'Сначала выбери фракцию в разделе сюжетных заданий.');const chapters=factionStories[factionChoice]||[];const chapterIndex=Number(id.slice('faction_story_'.length))-1;const chapter=chapters[chapterIndex];if(!chapter)return this.notice(c,'Такой фракционной главы нет.');if(chapterIndex>0&&!quests[`faction_story_${chapterIndex}`])return this.notice(c,'Сначала заверши предыдущую фракционную главу.');if(quests[id])return this.notice(c,'Эта фракционная глава уже завершена.');if(!chapter.check(p,quests))return this.notice(c,`Условия не выполнены: ${chapter.desc}`);quests[id]=true;const rep=readObject(p.cityReputation);rep[`faction_${factionChoice}`]=Number(rep[`faction_${factionChoice}`]||0)+chapter.rep;p.cityReputation=JSON.stringify(rep);p.inventory=JSON.stringify([...readArray(p.inventory),chapter.item]);p.gold+=chapter.gold;p.goldEarned+=chapter.gold;this.addXp(p,chapter.xp);p.quests=JSON.stringify(quests);return this.notice(c,`Фракционная глава «${chapter.title}» завершена: +${chapter.rep} репутации, +${chapter.gold} золота, +${chapter.xp} опыта и сюжетная печать.`);}
      if(id.startsWith('faction_reward_')){const faction=id.slice('faction_reward_'.length);const reward=FACTION_MAX_REWARDS[faction];if(!reward)return this.notice(c,'Награда неизвестна.');const rep=Number(readObject(p.cityReputation)[reward.repKey]||0);if(rep<100)return this.notice(c,`Максимальный ранг требует 100 репутации. Сейчас: ${rep}.`);if(quests[id])return this.notice(c,'Эксклюзивная награда уже получена.');if(!readArray(p.inventory).includes(reward.item)){p.inventory=JSON.stringify([...readArray(p.inventory),reward.item]);}const coll=readObject(p.collections);coll[`title_${faction}`]=reward.title;p.collections=JSON.stringify(coll);quests[id]=true;p.quests=JSON.stringify(quests);return this.notice(c,`Максимальный ранг достигнут! Получено: ${reward.name}. Титул «${reward.title}» записан в коллекцию.`);}
      const sIndex=story.findIndex(x=>x[0]===id);if(sIndex>=0){const [key,title,_desc,check,gold,xp,city]=story[sIndex];if(sIndex>0&&!quests[story[sIndex-1][0]])return this.notice(c,'Сначала заверши предыдущую главу сюжетной цепочки.');if(quests[key])return this.notice(c,'Эта глава уже завершена.');if(!check())return this.notice(c,'Условия главы ещё не выполнены.');quests[key]=true;const rep=readObject(p.cityReputation);rep[city]=Number(rep[city]||0)+10;if(quests.factionChoice)rep[`faction_${String(quests.factionChoice)}`]=Number(rep[`faction_${String(quests.factionChoice)}`]||0)+10;p.cityReputation=JSON.stringify(rep);const coll=readObject(p.collections);coll[`lore_${key}`]=true;p.collections=JSON.stringify(coll);p.quests=JSON.stringify(quests);p.gold+=gold;p.goldEarned+=gold;this.addXp(p,xp);return this.notice(c,`Глава «${title}» завершена: +${gold} золота, +${xp} опыта и +10 репутации города «${city}».`);}if(id==='daily_challenge'||id==='weekly_challenge'){if(quests.challengeDay!==today){quests.challengeDay=today;quests.dailyHunts=0;}if(id==='weekly_challenge'&&resetWeeklyHuntProgress(quests,utcIsoWeekKey())){p.quests=JSON.stringify(quests);return this.notice(c,'Началась новая неделя: прогресс еженедельного испытания сброшен до 0/15.');}p.quests=JSON.stringify(quests);const dayDone=Number(quests.dailyHunts||0)>=3;const weekDone=Number(quests.weeklyHunts||0)>=15;const key=id==='daily_challenge'?`challenge_daily_${today}`:`challenge_week_${utcIsoWeekKey()}`;if(quests[key])return this.notice(c,'Награда за это испытание уже получена.');if(id==='daily_challenge'&&!dayDone)return this.notice(c,`Ежедневное испытание: охоты ${Number(quests.dailyHunts||0)}/3.`);if(id==='weekly_challenge'&&!weekDone)return this.notice(c,`Еженедельное испытание: охоты ${Number(quests.weeklyHunts||0)}/15.`);const gold=id==='daily_challenge'?180:700;quests[key]=true;p.quests=JSON.stringify(quests);p.gold+=gold;p.goldEarned+=gold;this.addXp(p,id==='daily_challenge'?90:300);return this.notice(c,`Испытание завершено: +${gold} золота и умеренная награда опыта.`);}const dailyKey=`daily_hunt_${today}`;const definitions:Record<string,{title:string;done:boolean;gold:number;xp:number;claimKey?:string}>={first:{title:'Первая победа',done:p.victories>=1,gold:250,xp:120},hunter:{title:'Охотник',done:p.victories>=10,gold:900,xp:600},slayer:{title:'Истребитель',done:p.victories>=50,gold:3000,xp:1800},mine:{title:'Первый кристалл',done:p.mining>=1,gold:200,xp:100},level5:{title:'Путь героя',done:p.level>=5,gold:600,xp:500},daily_hunt:{title:'Ежедневная охота',done:p.lastHuntAt>0&&new Date(p.lastHuntAt).toISOString().slice(0,10)===today,gold:300,xp:180,claimKey:dailyKey}};const q=definitions[id];if(!q)return this.notice(c,'Задание не найдено.');const claimKey=q.claimKey||id;if(quests[claimKey])return this.notice(c,'Награда за это задание уже получена.');if(!q.done)return this.notice(c,'Условие ещё не выполнено.');quests[claimKey]=true;p.quests=JSON.stringify(quests);p.gold+=q.gold;p.goldEarned+=q.gold;this.addXp(p,q.xp);this.notice(c,`Задание «${q.title}» выполнено: +${q.gold} золота и +${q.xp} опыта.`);});
    this.onAuthenticatedMessage('returnReward',(c)=>{if(!this.requireCharacter(c))return;const p=this.state.player;if(!p.returnBonusAvailable)return this.notice(c,'Награда возвращения доступна после перерыва от 3 дней.');if(Date.now()-Number(p.returnRewardAt||0)<7*24*60*60*1000)return this.notice(c,'Награда возвращения доступна раз в неделю.');p.returnBonusAvailable=0;p.returnRewardAt=Date.now();const gold=100+Math.min(200,p.level*3);p.gold+=gold;p.goldEarned+=gold;p.inventory=JSON.stringify([...readArray(p.inventory),'health_potion']);this.notice(c,`Рады возвращению! Получено ${gold} золота и зелье здоровья. Бонус не ускоряет прокачку опытом.`);});
    this.onAuthenticatedMessage('achievements',(c)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const a=readObject(p.achievements);const defs:[string,string,number,number,string,number][]=[['battles_50','Боец',p.battles,50,'battles',500],['battles_250','Ветеран',p.battles,250,'battles',1800],['battles_1000','Легенда арены',p.battles,1000,'battles',6000],['kills_25','Следопыт',p.mobsKilled,25,'kills',400],['kills_250','Истребитель тумана',p.mobsKilled,250,'kills',2500],['rare_10','Охотник за редкостями',p.rareMonstersKilled,10,'rare',1800],['boss_1','Покоритель боссов',p.bossesKilled,1,'boss',1000],['boss_10','Разрушитель легенд',p.bossesKilled,10,'boss',6500],['level_10','Опытный искатель',p.level,10,'level',1000],['level_30','Герой островов',p.level,30,'level',4000],['mining_10','Полевой следопыт',p.mobsKilled,10,'kills',700],['craft_10','Мастер ремесла',p.itemsCrafted,10,'craft',1200],['sell_10','Торговец',p.itemsSold,10,'sell',1500],['gold_10000','Капиталист',p.goldEarned,10000,'gold',1000],['gold_100000','Золотая рука',p.goldEarned,100000,'gold',5000]];const rewards:string[]=[];for(const [key,label,value,need,_kind,gold] of defs){if(Number(value)>=need&&!a[key]){a[key]=true;p.gold+=gold;p.goldEarned+=gold;rewards.push(`${label}: +${gold} золота`);}}p.achievements=JSON.stringify(a);this.notice(c,rewards.length?`Получены достижения: ${rewards.join('; ')}`:'Новых достижений пока нет.');});
    this.onAuthenticatedMessage('tavernGame',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const stake=String(d?.game||'dice')==='cards'?250:100;if(p.gold<stake)return this.notice(c,`Для игры нужно ${stake} золота.`);p.gold-=stake;p.goldSpent+=stake;if(Math.random()<.47){p.gold+=stake*2;p.goldEarned+=stake*2;this.notice(c,`Удача! Вы выиграли ${stake*2} золота.`);}else this.notice(c,`Не повезло: ставка ${stake} золота потеряна.`);});
    this.onAuthenticatedMessage('craftSpecialty',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const specialty=String(d?.specialty||'');if(!['smith','alchemist','relic'].includes(specialty))return this.notice(c,'Неизвестная специализация.');if(p.craftingSpecialty)return this.notice(c,'Производственная специализация уже выбрана и не меняется.');if(p.crafting<2)return this.notice(c,'Нужен навык ремесла 2, улучши мастерскую.');p.craftingSpecialty=specialty;this.notice(c,`Выбрана специализация: ${({smith:'Оружейник',alchemist:'Алхимик',relic:'Реликварий'} as Record<string,string>)[specialty]}. Бонус применяется к подходящим рецептам.`);});
    this.onAuthenticatedMessage('craftQueue',(c)=>{const p=this.state.player;this.finishCraftJobs(p);c.send('craftQueue',{jobs:readArray(p.craftQueue)});});
    this.onAuthenticatedMessage('craft',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const recipe=RECIPES.find(r=>r.id===String(d?.recipe||''));if(!recipe)return this.notice(c,'Рецепт не найден.');const outputItem=ITEMS.find(x=>x.id===recipe.output);if(!outputItem)return this.notice(c,'Результат рецепта отсутствует в каталоге.');if(outputItem.kind==='amulet'&&ownsPendant(p,recipe.output))return this.notice(c,'Такое кольцо уже есть у персонажа. Сначала используй или продай имеющийся экземпляр.');const requiredProfession=recipe.profession==='Маг'?'Боевой маг':recipe.profession==='Поддержка'?'Баффер':recipe.profession;if(requiredProfession&&normalizeProfession(p.profession)!==normalizeProfession(requiredProfession))return this.notice(c,`Этот комплект предназначен для профессии «${requiredProfession}».`);const factionRecipe:Record<string,{faction:string;rep:number}>={dawn_elixir:{faction:'dawn',rep:20},caravan_blade:{faction:'caravan',rep:40},lore_charm:{faction:'lore',rep:60}};const gate=factionRecipe[recipe.id];if(gate&&Number(readObject(p.cityReputation)[`faction_${gate.faction}`]||0)<gate.rep)return this.notice(c,`Этот редкий рецепт требует ${gate.rep} репутации у фракции ${FACTIONS.find(f=>f.id===gate.faction)?.name||gate.faction}.`);if(p.crafting<recipe.level)return this.notice(c,`Нужен навык ремесла ${recipe.level}. Улучши мастерскую.`);const inv=readArray(p.inventory);const specialty=p.craftingSpecialty;const recipeKind=recipe.output.includes('potion')||requiredProfession==='Баффер'?'alchemist':(['tempered_sword','reinforced_staff','rune_blade'].includes(recipe.output)||['Ассасин','Ассасин птицы','Воин','Рыцарь','Лучник'].includes(normalizeProfession(requiredProfession||''))?'smith':'relic');if(specialty&&specialty!==recipeKind&&p.crafting<recipe.level+2)return this.notice(c,'Для чужой специализации нужен навык ремесла на 2 уровня выше.');for(const [id,qty] of Object.entries(recipe.materials)){const have=inv.filter(x=>x===id).length;if(have<qty)return this.notice(c,`Не хватает материала «${ITEMS.find(i=>i.id===id)?.name||id}»: нужно ${qty}, есть ${have}.`);}const queue=readArray(p.craftQueue);if(queue.length>=3)return this.notice(c,'Очередь производства заполнена (максимум 3 заказа).');const eq=readObject(p.equipment),collections=readObject(p.collections),pendant=NEW_EQUIPMENT_ITEMS.find(x=>x.id===eq.amulet);const speedBonus=pendant?.effect==='production'?pendantEffectValue(pendant,Number(collections.pendantLevels?.[pendant.id]||1)):0;const craftSeconds=Math.max(1,Math.floor(recipe.seconds/(1+speedBonus)));const job={id:`job_${this.playerId}_${Date.now()}_${rand(100,999)}`,recipe:recipe.id,name:recipe.name,output:recipe.output,count:recipe.count,finishAt:Date.now()+craftSeconds*1000,seconds:craftSeconds,specialtyBonus:specialty===recipeKind};let started;try{started=startCraftJob({inventory:inv,queue,materials:recipe.materials,job});}catch(error){return this.notice(c,error instanceof Error?error.message:'Не удалось запустить производство.');}p.inventory=JSON.stringify(started.inventory);p.craftQueue=JSON.stringify(started.queue);recordActivity(p,{type:'craft',outcome:'started',title:'Производство запущено',place:recipe.name,detail:`Готовность через ${craftSeconds} сек.`});c.send('craftQueue',{jobs:started.queue});this.notice(c,`Заказ «${recipe.name}» поставлен в очередь. Готовность через ${craftSeconds} сек.`);});
    this.onAuthenticatedMessage('craftCancel',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const queue=readArray(p.craftQueue);const id=String(d?.id||'');const recipeForJob=RECIPES.find(r=>r.id===queue.find((j:any)=>j.id===id)?.recipe);let cancelled;try{cancelled=cancelCraftJob({inventory:readArray(p.inventory),queue,jobId:id,now:Date.now(),fallbackMaterials:recipeForJob?.materials});}catch(error){return this.notice(c,error instanceof Error?error.message:'Не удалось отменить заказ.');}p.inventory=JSON.stringify(cancelled.inventory);p.craftQueue=JSON.stringify(cancelled.queue);recordActivity(p,{type:'craft',outcome:'cancelled',title:'Производство отменено',place:queue.find((j:any)=>j.id===id)?.name||'Заказ',detail:'Материалы возвращены в инвентарь.'});c.send('craftQueue',{jobs:cancelled.queue});this.notice(c,'Заказ отменён. Материалы возвращены в инвентарь.');});
    this.onAuthenticatedMessage('craftClaim',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;this.finishCraftJobs(p);const queue=readArray(p.craftQueue);const id=String(d?.id||'');const job=queue.find((j:any)=>j.id===id);if(!job)return this.notice(c,'Заказ не найден.');if(Date.now()<Number(job.finishAt))return this.notice(c,`Производство ещё идёт: ${Math.ceil((Number(job.finishAt)-Date.now())/1000)} сек.`);const inv=readArray(p.inventory);const outputItem=ITEMS.find((x:any)=>x.id===job.output);const uniqueConflict=outputItem?.kind==='amulet'&&ownsPendant(p,job.output);const recipeForJob=RECIPES.find(r=>r.id===job.recipe);let outputCount=Number(job.count||1);if(job.specialtyBonus&&Math.random()<0.20)outputCount++;let claimed;try{claimed=claimCraftJob({inventory:inv,queue,jobId:id,now:Date.now(),outputCount,uniqueConflict,fallbackMaterials:recipeForJob?.materials});}catch(error){return this.notice(c,error instanceof Error?error.message:'Не удалось забрать готовый предмет.');}p.inventory=JSON.stringify(claimed.inventory);p.craftQueue=JSON.stringify(claimed.queue);if(claimed.refunded){c.send('craftQueue',{jobs:readArray(p.craftQueue)});return this.notice(c,'У тебя уже есть такое кольцо. Заказ отменён, материалы возвращены в инвентарь.');}p.itemsCrafted+=claimed.outputCount;p.crafting+=1;recordActivity(p,{type:'craft',outcome:'complete',title:'Производство завершено',place:job.name,detail:`Получено предметов: ${outputCount}`});this.notice(c,`Производство завершено: ${job.name} добавлен в инвентарь.`);c.send('craftQueue',{jobs:readArray(p.craftQueue)});});
    this.onAuthenticatedMessage('openChest',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const inv=readArray(p.inventory);const index=Number(d?.index);if(!Number.isInteger(index)||index<0||inv[index]!=='mystery_chest')return this.notice(c,'Загадочный сундук не найден в этой ячейке.');const expectedCount=Number(d?.expectedCount);if(d?.itemId&&d.itemId!=='mystery_chest')return this.notice(c,'Тип предмета не совпадает: сундук не открыт.');if(Number.isInteger(expectedCount)&&inv.filter(x=>x==='mystery_chest').length!==expectedCount)return this.notice(c,'Количество сундуков изменилось: действие отменено. Обнови инвентарь.');inv.splice(index,1);const roll=Math.random();let result='';if(roll<.30){const pool=['health_potion','greater_potion','herb_material','rune_shard'];const id=pool[rand(0,pool.length-1)];inv.push(id);result=`Предмет: ${ITEMS.find(i=>i.id===id)?.name||id}.`;}else if(roll<.48){const id='crystal_shard';inv.push(id);p.crystals+=rand(3,12);result='Кристаллические осколки и немного кристаллов.';}else if(roll<.65){const found=rand(100,700);p.gold+=found;p.goldEarned+=found;result=`Старая монета: получено ${found} золота.`;}else if(roll<.82){p.buff='attack';p.buffValue=.15;p.buffSecondaryEffect='';p.buffSecondaryValue=0;p.buffUntil=Date.now()+10*60*1000;result='Эффект: +15% атаки на 10 минут.';}else if(roll<.93){p.buff='defense';p.buffValue=.15;p.buffSecondaryEffect='';p.buffSecondaryValue=0;p.buffUntil=Date.now()+10*60*1000;result='Эффект: +15% защиты на 10 минут.';}else{const rare=filterAvailableUniqueItems(['amulet_power','amulet_guard','tempered_sword','mystery_chest'],new Set(ITEMS.filter(i=>i.kind==='amulet').map(i=>i.id)),inv,readObject(p.equipment));const id=rare.length?rare[rand(0,rare.length-1)]:'rune_shard';inv.push(id);result=`Редкая находка: ${ITEMS.find(i=>i.id===id)?.name||id}.`;}p.inventory=JSON.stringify(inv);this.notice(c,`Загадочный сундук открыт! ${result}`);});
    this.onAuthenticatedMessage('guildSkill',(c,d:any)=>{if(!this.requireCharacter(c))return;const p=this.state.player;const skill=(GUILD_SKILLS[p.race]||[]).find(x=>x.id===String(d?.id||''));if(!skill)return this.notice(c,'Это умение не принадлежит твоей расе.');if(p.level<10)return this.notice(c,'Навыки расовой гильдии открываются с 10 уровня.');const skills=readObject(p.guildSkills);const last=Number(skills[skill.id]||0);if(Date.now()-last<30*60*1000)return this.notice(c,`Умение восстановится через ${Math.ceil((30*60*1000-(Date.now()-last))/60000)} мин.`);skills[skill.id]=Date.now();p.guildSkills=JSON.stringify(skills);if(skill.effect==='blood'){p.health=Math.min(effectiveMaxHealth(p),p.health+Math.floor(effectiveMaxHealth(p)*.12));p.buff='attack';p.buffValue=Number(skill.value||0);p.buffSecondaryEffect='';p.buffSecondaryValue=0;p.buffUntil=Date.now()+10*60*1000;}else{p.buff=skill.effect;p.buffValue=Number(skill.value||0);p.buffSecondaryEffect='';p.buffSecondaryValue=0;p.buffUntil=Date.now()+10*60*1000;}this.notice(c,`Расовый навык «${skill.name}» активирован на 10 минут. ${skill.desc}`);});
    this.onAuthenticatedMessage('auctionList',(c)=>{c.send('auctionList',{list:loadAuction().filter((x:any)=>x.status==='active')});});
    this.onAuthenticatedMessage('auctionHistory',(c)=>{const history=loadAuctionHistory().filter((x:any)=>x.sellerId===this.playerId||x.buyerId===this.playerId).slice(-50).reverse();c.send('auctionHistory',{history});});
    this.onAuthenticatedMessage('marketHistory',(c)=>{const history=loadAuctionHistory().filter((x:any)=>x.type==='sold'||x.status==='completed').slice(-200).reverse();c.send('marketHistory',{history});});
    this.onAuthenticatedMessage('auctionSell',(c,d:any)=>{if(!this.requireCharacter(c))return;try{const prepared=sharedStateRuntime.commitAuction((hadRecovery)=>{if(hadRecovery)syncOnlinePlayersAfterRecovery();const p=this.state.player;const healthRatio=p.health/Math.max(1,effectiveMaxHealth(p));const now=Date.now();const lotId=`lot_${this.playerId}_${now}_${rand(100,999)}`;const all=loadPlayersForAuction();all[this.playerId]=p.toJSON();const result=listAuctionItem({snapshot:{players:all,auction:loadAuctionForTransaction(),history:loadAuctionHistoryForTransaction()},sellerId:this.playerId,index:Number(d?.index),expectedItemId:d?.itemId?String(d.itemId):undefined,expectedCount:Number(d?.expectedCount),price:Math.floor(Number(d?.price)||0),currency:String(d?.currency||'gold'),validItemIds:new Set(ITEMS.map(i=>i.id)),itemName:ITEMS.find(i=>i.id===String(readArray(p.inventory)[Number(d?.index)]))?.name||String(readArray(p.inventory)[Number(d?.index)]||''),now,lotId});const nextSeller={...p.toJSON(),equipment:result.snapshot.players[this.playerId].equipment} as Player;const nextMax=effectiveMaxHealth(nextSeller);result.snapshot.players[this.playerId].health=Math.min(nextMax,Math.floor(nextMax*healthRatio));return {snapshot:result.snapshot,result};});applySaved(this.state.player,prepared.snapshot.players[this.playerId]);c.send('auctionList',{list:prepared.snapshot.auction});this.notice(c,`Лот выставлен за ${prepared.lot.price} ${prepared.lot.currency==='gold'?'золота':'кристаллов'}. Комиссия размещения: ${prepared.fee} ${prepared.lot.currency==='gold'?'золота':'кристаллов'}.`);}catch(error){this.notice(c,error instanceof Error?error.message:'Не удалось выставить лот.');}});
    this.onAuthenticatedMessage('auctionCancel',(c,d:any)=>{if(!this.requireCharacter(c))return;try{const prepared=sharedStateRuntime.commitAuction((hadRecovery)=>{if(hadRecovery)syncOnlinePlayersAfterRecovery();const p=this.state.player;const all=loadPlayersForAuction();all[this.playerId]=p.toJSON();const snapshot=cancelAuctionItem({snapshot:{players:all,auction:loadAuctionForTransaction(),history:loadAuctionHistoryForTransaction()},sellerId:this.playerId,lotId:String(d?.id||''),validItemIds:new Set(ITEMS.map(i=>i.id)),uniqueItemIds:new Set(ITEMS.filter(i=>i.kind==='amulet').map(i=>i.id)),now:Date.now()});return {snapshot,result:snapshot};});const snapshot=prepared as any;applySaved(this.state.player,snapshot.players[this.playerId]);c.send('auctionList',{list:snapshot.auction});c.send('auctionHistory',{history:snapshot.history.filter((x:any)=>x.sellerId===this.playerId||x.buyerId===this.playerId).slice(-50).reverse()});this.notice(c,'Лот снят. Предмет возвращён в инвентарь; комиссия размещения не возвращается.');}catch(error){this.notice(c,error instanceof Error?error.message:'Не удалось снять лот.');}});
    this.onAuthenticatedMessage('auctionBuy',(c,d:any)=>{if(!this.requireCharacter(c))return;try{const prepared=sharedStateRuntime.commitAuction((hadRecovery)=>{if(hadRecovery)syncOnlinePlayersAfterRecovery();const p=this.state.player;const auction=loadAuctionForTransaction();const lot=auction.find((x:any)=>x.id===String(d?.id||''));const onlineSeller=ONLINE_PLAYERS.get(String(lot?.sellerId||''));const all=loadPlayersForAuction();all[this.playerId]=p.toJSON();const result=buyAuctionItem({snapshot:{players:all,auction,history:loadAuctionHistoryForTransaction()},buyerId:this.playerId,lotId:String(d?.id||''),validItemIds:new Set(ITEMS.map(i=>i.id)),uniqueItemIds:new Set(ITEMS.filter(i=>i.kind==='amulet').map(i=>i.id)),now:Date.now()});const lotItem=ITEMS.find(i=>i.id===result.lot.itemId);if(lotItem?.kind==='amulet'&&ownsPendant(p,result.lot.itemId))throw new Error('У тебя уже есть такое кольцо. Сначала продай или убери имеющийся экземпляр.');return {snapshot:result.snapshot,result:{snapshot:result.snapshot,lot:result.lot,fee:result.fee,net:result.net,buyerId:this.playerId,sellerId:onlineSeller?.id||''}};});const snapshot=prepared.snapshot as any;applySaved(this.state.player,snapshot.players[this.playerId]);const onlineSeller=ONLINE_PLAYERS.get(String(prepared.sellerId||''));if(onlineSeller)applySaved(onlineSeller,snapshot.players[onlineSeller.id]);c.send('auctionList',{list:snapshot.auction});this.notice(c,`Куплено: ${prepared.lot.itemName}. ${prepared.fee?`Комиссия аукциона: ${prepared.fee} золота; продавец получил ${prepared.net}.`:''}`);}catch(error){this.notice(c,error instanceof Error?error.message:'Не удалось купить лот.');}});
    this.onAuthenticatedMessage('clanList',(c)=>{const clans=loadClans();c.send('clanList',{clans:Object.values(clans).map((x:any)=>({id:x.id,name:x.name,level:x.level,members:x.members.length,vault:x.vault,leader:x.leader,seasonPoints:x.seasonPoints||0,upgrades:x.upgrades||{barracks:0,treasury:0,banner:0}}))});});
    this.onAuthenticatedMessage('clanCreate',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const name=String(d?.name||'').trim().replace(/[<>]/g,'').slice(0,24);
      const result=transactClanMutation(this.playerId,({p,clans})=>{
        if(p.level<20)return {error:'Создать клан можно с 20 уровня.'};
        if(p.clan)return {error:'Ты уже состоишь в клане.'};
        if(name.length<3)return {error:'Название клана должно содержать 3–24 символа.'};
        if(Object.values(clans).some((x:any)=>String(x.name||'').toLowerCase()===name.toLowerCase()))return {error:'Клан с таким названием уже существует.'};
        const cost=5000;
        if(p.gold<cost)return {error:`Создание клана стоит ${cost} золота.`};
        const id=`clan_${Date.now()}_${rand(100,999)}`;
        clans[id]={id,name,leader:this.playerId,level:1,xp:0,vault:0,upgrades:{barracks:0,treasury:0,banner:0},seasonPoints:0,members:[{id:this.playerId,name:p.name,role:'Лидер',contribution:0,joinedAt:Date.now()}],createdAt:Date.now()};
        p.gold-=cost;p.goldSpent+=cost;p.clan=id;
        return {clanName:name};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans();
      broadcastClanOverview(clans);broadcastClanQuests(clans);
      this.notice(c,`Клан «${result.clanName}» создан. В казну внесено 0 золота; создание стоило 5000.`);
    });
    this.onAuthenticatedMessage('clanJoin',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const clanId=String(d?.id||'');
      const result=transactClanMutation(this.playerId,({p,clans})=>{
        if(p.level<20)return {error:'Вступить в клан можно с 20 уровня.'};
        if(p.clan)return {error:'Сначала выйди из текущего клана.'};
        const clan=clans[clanId];
        if(!clan)return {error:'Клан не найден. Обнови список.'};
        if(!Array.isArray(clan.members))clan.members=[];
        if(clan.members.some((m:any)=>m.id===this.playerId))return {error:'Ты уже в этом клане.'};
        clan.members.push({id:this.playerId,name:p.name,role:'Участник',contribution:0,joinedAt:Date.now()});
        p.clan=clan.id;
        return {clanName:clan.name};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans();
      broadcastClanOverview(clans);broadcastClanQuests(clans);
      this.notice(c,`Ты вступил в клан «${result.clanName}».`);
    });
    this.onAuthenticatedMessage('clanLeave',(c)=>{
      if(!this.requireCharacter(c))return;
      const result=transactClanMutation(this.playerId,({p,clans,wars,territories})=>{
        if(!p.clan)return {error:'Ты не состоишь в клане.'};
        const clan=clans[p.clan];
        if(!clan){p.clan='';return {kind:'orphan'};}
        if(clan.leader===this.playerId&&Array.isArray(clan.members)&&clan.members.length>1){
          return {error:'Перед выходом передай лидерство или попроси участников выйти.'};
        }
        clan.members=(Array.isArray(clan.members)?clan.members:[]).filter((member:any)=>member.id!==this.playerId);
        p.clan='';
        if(!clan.members.length){
          const now=Date.now();
          ensureAllClanQuests(clans);
          const settled=settleExpiredClanWars(wars,clans,now);
          const disbanded=disbandClanState(settled.clans,settled.wars,territories,clan.id,now);
          for(const id of Object.keys(clans))delete clans[id];
          Object.assign(clans,disbanded.clans);
          wars.splice(0,wars.length,...disbanded.wars);
          territories.splice(0,territories.length,...disbanded.territories);
          return {kind:'disbanded'};
        }
        return {kind:'left'};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans(),wars=loadWars(),territories=loadTerritories();
      if(result.kind==='disbanded'){
        const clanPayload=broadcastClanOverview(clans);
        const warPayload=broadcastClanWarList(wars,clans);
        c.send('clanList',clanPayload);
        c.send('clanWarList',warPayload);
        broadcastClanTerritories(clans,territories);c.send('clanTerritories',{territories});
      }else if(result.kind==='left'){
        const clanPayload=broadcastClanOverview(clans);
        broadcastClanQuests(clans);
        c.send('clanList',clanPayload);
      }
      this.notice(c,'Ты покинул клан.');
    });
    this.onAuthenticatedMessage('clanDonate',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const amount=Math.floor(Number(d?.amount)||0);
      const result=transactClanMutation(this.playerId,({p,clans})=>{
        if(!p.clan)return {error:'Сначала вступи в клан.'};
        if(amount<100||amount>1000000)return {error:'Вклад должен быть от 100 до 1 000 000 золота.'};
        if(p.gold<amount)return {error:'Не хватает золота для взноса.'};
        const clan=clans[p.clan];
        if(!clan)return {error:'Клан не найден.'};
        if(!isClanMember(clan,this.playerId))return {error:'Персонаж не состоит в этом клане.'};
        p.gold-=amount;p.goldSpent+=amount;clan.vault+=amount;clan.xp+=Math.floor(amount/100);
        ensureClanQuests(clan);clan.questProgress=clan.questProgress||{};
        clan.questProgress.donate=(clan.questProgress.donate||0)+amount;
        clan.seasonPoints=Number(clan.seasonPoints||0)+Math.floor(amount/1000);
        const member=clan.members.find((m:any)=>m.id===this.playerId);if(member)member.contribution+=amount;
        while(clan.level<10&&clan.xp>=clan.level*100){clan.xp-=clan.level*100;clan.level++;}
        return {clanLevel:clan.level};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans();broadcastClanOverview(clans);broadcastClanQuests(clans);
      this.notice(c,`Вклад в клан: ${amount} золота. Уровень клана: ${result.clanLevel}.`);
    });
    this.onAuthenticatedMessage('clanRaid',(c)=>{
      if(!this.requireCharacter(c))return;
      const now=Date.now();
      const result=transactClanMutation(this.playerId,({p,clans,territories})=>{
        if(!p.clan)return {error:'Для кланового похода нужен клан.'};
        const clan=clans[p.clan];if(!clan)return {error:'Клан не найден.'};
        if(!isClanMember(clan,this.playerId))return {error:'Персонаж не состоит в этом клане.'};
        if(now-Number(clan.lastRaidAt||0)<30*60*1000)return {error:`Клановый поход доступен через ${Math.ceil((30*60*1000-(now-Number(clan.lastRaidAt||0)))/60000)} мин.`};
        clan.lastRaidAt=now;
        const power=(p.level+p.strength*.15*(1+activeBuffValue(p,'attack',now))+p.defense*.1*(1+activeBuffValue(p,'defense',now))+clan.level*5)*(1+activeBuffValue(p,'crit',now)*.5)*(1+Number((clan.upgrades||{}).barracks||0)*.02);
        const threat=rand(20,55);
        if(power>=threat){
          const gold=500+clan.level*250+p.level*15;
          const ownedTerritories=territories.filter((t:any)=>t.owner===clan.id);
          const territoryBonus=1+ownedTerritories.length*.03;
          const treasuryBonus=1+Number((clan.upgrades||{}).treasury||0)*.03;
          const finalGold=Math.floor(gold*territoryBonus*treasuryBonus);
          clan.vault+=finalGold;
          const receivedCrystals=ownedTerritories.some((t:any)=>t.id==='crystalcourt');
          if(receivedCrystals)p.crystals+=2;
          clan.xp+=10+clan.level*3;ensureClanQuests(clan);
          clan.questProgress=clan.questProgress||{};
          clan.questProgress.raid=(clan.questProgress.raid||0)+1;
          clan.seasonPoints=Number(clan.seasonPoints||0)+10;
          this.addXp(p,Math.floor((80+p.level*12)*(1+activeBuffValue(p,'xp',now))));
          while(clan.level<10&&clan.xp>=clan.level*100){clan.xp-=clan.level*100;clan.level++;}
          return {success:true,finalGold,receivedCrystals,clanLevel:clan.level};
        }
        return {success:false};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans();
      if(result.success){
        broadcastClanOverview(clans);broadcastClanQuests(clans);
        this.notice(c,`Клановый поход успешен! В казну добавлено ${result.finalGold} золота${result.receivedCrystals?' и ты получил 2 кристалла':''}, ты получил опыт. Уровень клана: ${result.clanLevel}.`);
      }else this.notice(c,'Клановый поход не удался. Улучшайте экипировку и уровень клана; повторная попытка через 30 минут.');
    });
    this.onAuthenticatedMessage('clanQuests',(c)=>{
      const response=transactClanStateMutation(({clans})=>{
        const p=ONLINE_PLAYERS.get(this.playerId);
        const clan=p?.clan?clans[p.clan]:null;
        if(!clan||!isClanMember(clan,this.playerId)){
          return {quests:[],upgrades:{barracks:0,treasury:0,banner:0},clans,changed:false};
        }
        clan.upgrades=clan.upgrades||{barracks:0,treasury:0,banner:0};
        const before=JSON.stringify(clan);
        const quests=ensureClanQuests(clan);
        return {quests,upgrades:clan.upgrades,clans,changed:JSON.stringify(clan)!==before};
      },result=>result.changed);
      c.send('clanQuests',{quests:response.quests,upgrades:response.upgrades,season:clanSeasonBoard(response.clans)});
    });
    this.onAuthenticatedMessage('clanTerritories',(c)=>{const clans=loadClans();const names=new Map(Object.values(clans).map((x:any)=>[x.id,x.name]));c.send('clanTerritories',{territories:loadTerritories().map((t:any)=>({...t,ownerName:names.get(t.owner)||t.ownerName||''}))});});
    this.onAuthenticatedMessage('clanUpgrade',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const id=String(d?.upgrade||'');
      const result=transactClanMutation(this.playerId,({p,clans})=>{
        if(!p?.clan)return {error:'Сначала вступи в клан.'};
        const clan=clans[p.clan];if(!clan)return {error:'Клан не найден.'};
        if(!isClanMember(clan,this.playerId))return {error:'Персонаж не состоит в этом клане.'};
        if(clan.leader!==this.playerId)return {error:'Улучшения может оплачивать только лидер клана.'};
        const specs:any={barracks:{name:'Военная школа',base:2500,step:2},treasury:{name:'Клановая казна',base:2000,step:3},banner:{name:'Знамя первопроходцев',base:3000,step:5}};
        const spec=Object.prototype.hasOwnProperty.call(specs,id)?specs[id]:undefined;
        if(!spec)return {error:'Неизвестная ветка улучшения.'};
        clan.upgrades=clan.upgrades||{barracks:0,treasury:0,banner:0};
        const level=Math.max(0,Math.min(5,Number(clan.upgrades[id])||0));
        if(level>=5)return {error:`${spec.name} уже достигла 5 уровня.`};
        const cost=spec.base*(level+1);
        if(Number(clan.vault||0)<cost)return {error:`В казне недостаточно золота. Нужно ${cost}.`};
        clan.vault-=cost;clan.upgrades[id]=level+1;
        return {name:spec.name,level:level+1,cost};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans();broadcastClanOverview(clans);broadcastClanQuests(clans);
      this.notice(c,`${result.name} улучшена до ${result.level}/5 уровня. Потрачено ${result.cost} золота.`);
    });
    this.onAuthenticatedMessage('clanTerritoryCapture',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const territoryId=String(d?.id||''),now=Date.now();
      const result=transactClanMutation(this.playerId,({p,clans,territories})=>{
        if(!p?.clan)return {error:'Сначала вступи в клан.'};
        const clan=clans[p.clan];if(!clan)return {error:'Клан не найден.'};
        if(!isClanMember(clan,this.playerId))return {error:'Персонаж не состоит в этом клане.'};
        const t=territories.find((x:any)=>x.id===territoryId);
        if(!t)return {error:'Территория не найдена.'};
        if(t.owner===clan.id)return {error:'Эта территория уже принадлежит твоему клану.'};
        if(now-Number(clan.lastTerritoryCaptureAt||0)<6*60*60*1000)return {error:`Новая экспедиция доступна через ${Math.ceil((6*60*60*1000-(now-Number(clan.lastTerritoryCaptureAt||0)))/3600000)} ч.`};
        const cost=1000+Number(t.level||1)*750;
        if(Number(clan.vault||0)<cost)return {error:`В клановой казне нужно ${cost} золота.`};
        clan.vault-=cost;clan.lastTerritoryCaptureAt=now;
        const upgrades=clan.upgrades||{};
        const strength=Number(clan.level||1)*5+clan.members.length*3+Number(p.level||1)*(1+activeBuffValue(p,'attack',now)+activeBuffValue(p,'crit',now)*.5)+Number(p.defense||0)*.1*activeBuffValue(p,'defense',now)+rand(0,20)+Number(upgrades.barracks||0)*2;
        const defense=Number(t.defense||0)||Number(t.level||1)*12+rand(0,20);
        if(strength<defense)return {success:false,strength,defense,cost};
        t.owner=clan.id;t.ownerName=clan.name;t.capturedAt=now;t.defense=defense;
        const seasonPoints=25+Number(upgrades.banner||0)*5;
        clan.seasonPoints=Number(clan.seasonPoints||0)+seasonPoints;
        ensureClanQuests(clan);clan.questProgress=clan.questProgress||{};
        clan.questProgress.territory=(clan.questProgress.territory||0)+1;
        return {success:true,territoryName:t.name,seasonPoints};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans(),territories=loadTerritories();
      broadcastClanOverview(clans);
      if(result.success){
        broadcastClanTerritories(clans,territories);broadcastClanQuests(clans);
        this.notice(c,`Территория «${result.territoryName}» захвачена! +${result.seasonPoints} сезонных очков.`);
      }else this.notice(c,`Экспедиция проиграла: сила ${result.strength}, защита ${result.defense}. Казна потратила ${result.cost} золота; повтор через 6 часов.`);
    });
    this.onAuthenticatedMessage('clanQuestClaim',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const questId=String(d?.id||'');
      const result=transactClanMutation(this.playerId,({p,clans})=>{
        if(!p?.clan)return {error:'Сначала вступи в клан.'};
        const clan=clans[p.clan];if(!clan)return {error:'Клан не найден.'};
        if(!isClanMember(clan,this.playerId))return {error:'Персонаж не состоит в этом клане.'};
        const quests=ensureClanQuests(clan),q=quests.find((x:any)=>x.id===questId);
        if(!q)return {error:'Задание не найдено.'};
        if(q.claimed)return {error:'Награда за это задание уже получена.'};
        if(q.progress<q.goal)return {error:'Общая цель клана ещё не выполнена.'};
        const upgrades=clan.upgrades||{};
        const reward=Math.floor((1000+Number(clan.level||1)*250)*(1+Number(upgrades.treasury||0)*.03));
        q.claimed=true;clan.vault=Number(clan.vault||0)+reward;
        clan.xp=Number(clan.xp||0)+20;clan.seasonPoints=Number(clan.seasonPoints||0)+15;
        return {reward};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans();broadcastClanOverview(clans);broadcastClanQuests(clans);
      this.notice(c,`Клан получил ${result.reward} золота, 20 опыта клана и 15 сезонных очков.`);
    });
    this.onAuthenticatedMessage('clanSeasonReward',(c)=>{
      if(!this.requireCharacter(c))return;
      const result=transactClanMutation(this.playerId,({p,clans,territories})=>{
        if(!p?.clan)return {error:'Сначала вступи в клан.'};
        const clan=clans[p.clan];if(!clan)return {error:'Клан не найден.'};
        if(!isClanMember(clan,this.playerId))return {error:'Персонаж не состоит в этом клане.'};
        const week=Math.floor(Date.now()/(7*24*60*60*1000));
        if(clan.lastSeasonRewardWeek===week)return {error:'Недельная награда уже получена.'};
        const board=Object.values(clans).map((x:any)=>({id:x.id,seasonPoints:Number(x.seasonPoints||0),territories:territories.filter((t:any)=>t.owner===x.id).length}))
          .sort((a:any,b:any)=>b.seasonPoints-a.seasonPoints||b.territories-a.territories);
        const rank=board.findIndex((x:any)=>x.id===clan.id)+1;
        const reward=rank===1?5000:rank<=3?2500:1000;
        clan.vault=Number(clan.vault||0)+reward;clan.lastSeasonRewardWeek=week;
        return {rank,reward};
      });
      if(typeof result.error==='string')return this.notice(c,result.error);
      const clans=loadClans();broadcastClanOverview(clans);broadcastClanQuests(clans);
      this.notice(c,`Клан занял ${result.rank||'—'} место и получил ${result.reward} золота в казну.`);
    });
    this.onAuthenticatedMessage('clanWarList',(c)=>{
      const changed=transactClanStateMutation(({clans,wars})=>{
        const questsChanged=ensureAllClanQuests(clans);
        const settled=settleExpiredClanWars(wars,clans,Date.now());
        for(const id of Object.keys(clans))delete clans[id];
        Object.assign(clans,settled.clans);
        wars.splice(0,wars.length,...settled.wars);
        return settled.changed||questsChanged;
      },changed=>changed);
      const clans=loadClans(),currentWars=loadWars();
      if(changed){broadcastClanOverview(clans);broadcastClanQuests(clans);}
      const payload=broadcastClanWarList(currentWars,clans);
      c.send('clanWarList',payload);
    });
    this.onAuthenticatedMessage('clanWarChallenge',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const result=transactClanMutation(this.playerId,({p,clans,wars})=>{
        if(!p?.clan)return {error:'Сначала вступи в клан.'};
        const own=clans[p.clan],target=clans[String(d?.clanId||'')];
        if(!own||!target||own.id===target.id)return {error:'Выбери другой существующий клан.'};
        if(!isClanMember(own,this.playerId))return {error:'Персонаж не состоит в этом клане.'};
        if(own.leader!==this.playerId)return {error:'Объявить войну может только лидер клана.'};

        const now=Date.now();
        const questsChanged=ensureAllClanQuests(clans);
        const settled=settleExpiredClanWars(wars,clans,now);
        const refresh=settled.changed||questsChanged;
        for(const id of Object.keys(clans))delete clans[id];
        Object.assign(clans,settled.clans);
        wars.splice(0,wars.length,...settled.wars);
        if(wars.some((war:any)=>war.status==='active'&&(war.a===own.id||war.b===own.id||war.a===target.id||war.b===target.id))){
          return {error:'Один из кланов уже участвует в активной войне.',refresh};
        }
        wars.push({
          id:`war_${now}_${rand(100,999)}`,
          a:own.id,b:target.id,aName:own.name,bName:target.name,
          aDamage:0,bDamage:0,lastAttackAtByPlayer:{},status:'active',
          createdAt:now,endsAt:now+24*60*60*1000,
        });
        return {targetName:target.name,refresh};
      });
      const clans=loadClans(),wars=loadWars();
      if('refresh' in result&&result.refresh){broadcastClanOverview(clans);broadcastClanQuests(clans);}
      if(typeof result.error==='string')return this.notice(c,result.error);
      const payload=broadcastClanWarList(wars,clans);
      c.send('clanWarList',payload);
      this.notice(c,`Клану «${result.targetName}» объявлена война на 24 часа.`);
    });
    this.onAuthenticatedMessage('clanWarAttack',(c,d:any)=>{
      if(!this.requireCharacter(c))return;
      const result=transactClanMutation(this.playerId,({p,clans,wars})=>{
        if(!p?.clan)return {error:'Сначала вступи в клан.'};
        const clan=clans[p.clan];
        if(!clan||!Array.isArray(clan.members)||!clan.members.some((member:any)=>member?.id===this.playerId)){
          return {error:'Персонаж не состоит в этом клане.'};
        }
        const selectedId=String(d?.id||'');
        const selected=wars.find((war:any)=>war.id===selectedId&&(war.a===clan.id||war.b===clan.id));
        if(!selected)return {error:'Активная война не найдена.'};
        const questsChanged=ensureAllClanQuests(clans);
        const now=Date.now();
        const settled=settleExpiredClanWars(wars,clans,now);
        const refresh=settled.changed||questsChanged;
        for(const id of Object.keys(clans))delete clans[id];
        Object.assign(clans,settled.clans);
        wars.splice(0,wars.length,...settled.wars);
        const war=wars.find((entry:any)=>entry.id===selectedId);
        if(!war||war.status!=='active'){
          const winner=war?.winnerId?String(war.winnerId===war.a?war.aName:war.bName):'ничья';
          return {error:`Война завершена. Итог: ${winner}.`,refresh};
        }
        const remaining=clanWarCooldownRemaining(war,this.playerId,now);
        if(remaining>0)return {error:`Следующая атака через ${Math.ceil(remaining/1000)} сек.`,refresh};
        const enemyId=war.a===clan.id?war.b:war.a;
        const enemy=clans[enemyId];
        if(!enemy)return {error:'Клан-соперник не найден.',refresh};

        // Clan wars use an abstract damage score, not a full arena duel. Attacker
        // character power and clan barracks are compared with the enemy clan baseline.
        const eq=readObject(p.equipment);
        const weapon=ITEMS.find(item=>item.id===eq.weapon),armor=ITEMS.find(item=>item.id===eq.armor);
        const equipmentUpgrades=readObject(p.equipmentEnhancements);
        const weaponLevel=Number(equipmentUpgrades[`weapon:${eq.weapon}`]||0);
        const armorLevel=Number(equipmentUpgrades[`armor:${eq.armor}`]||0);
        const ownProps=readObject(p.collections).equipmentProperties||{};
        const ownSets=EQUIPMENT_SETS.filter((set:any)=>set.items.filter((id:string)=>[eq.weapon,eq.armor,eq.amulet].includes(id)).length>=2);
        const ownMagic=p.profession==='Боевой маг';
        const ownAgile=['Ассасин','Ассасин птицы','Лучник','Вампир'].includes(normalizeProfession(p.profession));
        const attack=(p.strength*(ownMagic?.35:1.25)+p.dexterity*(ownAgile?.65:.35)+p.intelligence*(ownMagic?.85:.2)+(weapon?.attack||0)*(1+weaponLevel*.04))*(1+(ownProps[eq.weapon]?.effect==='attack'?ownProps[eq.weapon].value:0))*(ownSets.some((set:any)=>set.effect==='attack')?1.08:1)*(p.profession==='Боевой маг'?1.05:1)*(1+activeBuffValue(p,'attack',now))+rand(0,10);
        const defense=(p.defense+p.vitality*.45+(armor?.defense||0)*(1+armorLevel*.04))*(1+(ownProps[eq.armor]?.effect==='defense'?ownProps[eq.armor].value:0))*(ownSets.some((set:any)=>set.effect==='defense')?1.08:1)*(normalizeProfession(p.profession)==='Рыцарь'?1.10:p.profession==='Баффер'?1.06:1)*(1+activeBuffValue(p,'defense',now));
        const critBonus=(ownProps[eq.weapon]?.effect==='crit'?ownProps[eq.weapon].value:0)+(ownProps[eq.armor]?.effect==='crit'?ownProps[eq.armor].value:0)+(ownSets.some((set:any)=>set.effect==='crit')?.06:0)+((p.profession==='Ассасин'||p.profession==='Ассасин птицы')?.07:p.profession==='Лучник'?.03:0)+activeBuffValue(p,'crit',now);
        const upgrades=clan.upgrades||{};
        const barracks=Math.max(0,Number(upgrades.barracks)||0);
        const arenaCombatPower=(attack*(1+critBonus)+defense*.4+rand(0,20))*(1+barracks*.02);
        const enemyPower=Number(enemy.level||1)*4+(Array.isArray(enemy.members)?enemy.members.length:1)*3+rand(0,30);
        const damage=calculateClanWarDamage(arenaCombatPower,enemyPower);
        const updated=recordClanWarDamage(war,clan.id,this.playerId,damage,now);
        const index=wars.findIndex((entry:any)=>entry.id===war.id);
        wars[index]=updated;
        p.battles=Number(p.battles||0)+1;
        return {damage,updated,refresh};
      });
      const clans=loadClans(),wars=loadWars();
      if('refresh' in result&&result.refresh){broadcastClanOverview(clans);broadcastClanQuests(clans);}
      if(typeof result.error==='string')return this.notice(c,result.error);
      const payload=broadcastClanWarList(wars,clans);
      this.notice(c,`Атака нанесла ${result.damage} урона. Суммарный урон: ${result.updated.aName||result.updated.a} — ${result.updated.aDamage||0}, ${result.updated.bName||result.updated.b} — ${result.updated.bDamage||0}. Следующая атака через 1 сек.`);
      c.send('clanWarList',payload);
    });
    this.onAuthenticatedMessage('pvpList',(c)=>{if(!this.requireCharacter(c))return;
      const response=sharedStateRuntime.transact((hadRecovery)=>{
        if(hadRecovery)syncOnlinePlayersAfterRecovery();
        const p=this.state.player;
        const now=Date.now();
        const all=loadPlayers();
        for(const [id,online] of ONLINE_PLAYERS) all[id]=online.toJSON();
        all[this.playerId]=p.toJSON();
        const questData=readObject(p.quests);
        const state=questData.pvp&&typeof questData.pvp==='object'?questData.pvp:{};
        const cooldown=pvpCooldownRemaining(p.lastPvpAt,now);
        let offeredIds=Array.isArray(state.offeredIds)?state.offeredIds.filter((id:any)=>typeof id==='string'):[];
        const offersExpireAt=Number(state.offersExpireAt||0);
        if(cooldown===0&&(!offersExpireAt||offersExpireAt<=now||!offeredIds.length)){
          const previousOfferedIds=Array.isArray(state.previousOfferedIds)?state.previousOfferedIds.filter((id:any)=>typeof id==='string'):[];
          const selected=selectPvpOpponents(all,this.playerId,Number(p.level||1),now,Math.random,previousOfferedIds);
          offeredIds=selected.map((candidate:any)=>String(candidate.id||'')).filter(Boolean);
          state.offeredIds=offeredIds;
          state.offersExpireAt=now+PVP_ATTACK_COOLDOWN_MS;
          questData.pvp=state;
          p.quests=JSON.stringify(questData);
          all[this.playerId]=p.toJSON();
        }
        const players=cooldown>0?[]:offeredIds.map((id:string)=>({id,player:all[id]}))
          .filter((entry:any)=>entry.player&&entry.player.race
            &&pvpImmunityRemaining(entry.player,now)===0)
          .map(({id,player}:any)=>({id:publicPlayerCode(id),name:player.name||'Путник',race:player.race||'?',profession:player.profession||'',level:Number(player.level||1),strength:Number(player.strength||10),defense:Number(player.defense||8),health:Number(player.health||100),maxHealth:Number(player.maxHealth||100),clan:player.clan||'',isBot:false}));
        return {files:{players:all},result:{players,cooldownUntil:cooldown>0?now+cooldown:0,offersExpireAt:Number(state.offersExpireAt||0),immunityUntil:Number(readPvpStateSafe(p).immunityUntil||0)}};
      });
      c.send('pvpList',response);
    });
    this.onAuthenticatedMessage('pvpChallenge',(c,d:any)=>{if(!this.requireCharacter(c))return;
      let rollbackAttacker:any; let rollbackTarget:any; let rollbackTargetId='';
      let committedTarget:any; let committedTargetId=''; let onlineTargetClient:any;
      let result:any;
      try {
        result=sharedStateRuntime.transact<any>((hadRecovery)=>{
          if(hadRecovery)syncOnlinePlayersAfterRecovery();
          const p=this.state.player;
          rollbackAttacker=p.toJSON();
          const all=loadPlayersWithOnline(); all[this.playerId]=p.toJSON();
          const requestedTargetId=String(d?.targetId||'');
          const targetId=resolvePublicPlayerCode(requestedTargetId,all);
          if(!targetId||targetId===this.playerId)return {files:{players:all},result:{notice:'Выбери другого соперника.'}};
          const onlineTarget=ONLINE_PLAYERS.get(targetId);
          let target=onlineTarget?onlineTarget.toJSON():all[targetId];
          if(!target||!target.race)return {files:{players:all},result:{notice:'Соперник не найден или ещё не сохранён.'}};
          if(onlineTarget){rollbackTarget=onlineTarget.toJSON();rollbackTargetId=targetId;}
          const isBot=false;
const now=Date.now();const attackerQuestData=readObject(p.quests);const attackerPvpState=attackerQuestData.pvp&&typeof attackerQuestData.pvp==='object'?attackerQuestData.pvp:{};const cooldown=pvpCooldownRemaining(p.lastPvpAt,now);if(!isBot&&cooldown>0)return {files:{players:all},result:{notice:`Следующая атака через ${Math.ceil(cooldown/60000)} мин.`}};if(!isBot&&(!Number(attackerPvpState.offersExpireAt)||Number(attackerPvpState.offersExpireAt)<=now))return {files:{players:all},result:{notice:'Список соперников устарел. Обнови его перед атакой.'}};if(!isBot&&!isPvpTargetOffered(attackerPvpState.offeredIds,targetId))return {files:{players:all},result:{notice:'Этот соперник не входит в твой текущий список. Обнови список соперников.'}};const targetQuestData=readObject(target.quests||'{}');const targetPvpState=targetQuestData.pvp&&typeof targetQuestData.pvp==='object'?targetQuestData.pvp:{};if(!isBot&&Number(targetPvpState.immunityUntil||0)>now)return {files:{players:all},result:{notice:`Персонаж под защитой ещё ${Math.ceil((Number(targetPvpState.immunityUntil)-now)/60000)} мин.`}};if(!isBot){p.lastPvpAt=now;p.battles++;}const eq=readObject(p.equipment);const w=ITEMS.find(i=>i.id===eq.weapon),a=ITEMS.find(i=>i.id===eq.armor);const upgrades=readObject(p.equipmentEnhancements);const wl=Number(upgrades[`weapon:${eq.weapon}`]||0),al=Number(upgrades[`armor:${eq.armor}`]||0);const teq=readObject(target.equipment||'{}');const tu=readObject(target.equipmentEnhancements||'{}');const twl=Number(tu[`weapon:${teq.weapon}`]||0),tal=Number(tu[`armor:${teq.armor}`]||0);const tw=ITEMS.find(i=>i.id===teq.weapon),ta=ITEMS.find(i=>i.id===teq.armor);const ownProps=readObject(p.collections).equipmentProperties||{};const targetProps=readObject(target.collections||'{}').equipmentProperties||{};const ownSets=resolvePvpSetBonuses([eq.weapon,eq.armor,eq.amulet],EQUIPMENT_SETS);const targetSets=resolvePvpSetBonuses([teq.weapon,teq.armor,teq.amulet],EQUIPMENT_SETS);const ownAttackRoll=rand(0,10),targetAttackRoll=rand(0,10),ownScoreRoll=rand(0,20),targetScoreRoll=rand(0,20);
      const ownCombat=calculatePvpCombatStats({
        profession:p.profession,strength:p.strength,dexterity:p.dexterity,intelligence:p.intelligence,defense:p.defense,vitality:p.vitality,
        weaponAttack:Number(w?.attack||0),weaponEnhancementLevel:wl,armorDefense:Number(a?.defense||0),armorEnhancementLevel:al,
        weaponProperty:ownProps[eq.weapon],armorProperty:ownProps[eq.armor],
        hasAttackSet:ownSets.hasAttackSet,hasDefenseSet:ownSets.hasDefenseSet,hasCritSet:ownSets.hasCritSet,
        attackBuff:activeBuffValue(p,'attack',now),defenseBuff:activeBuffValue(p,'defense',now),critBuff:activeBuffValue(p,'crit',now),
        attackRoll:ownAttackRoll,scoreRoll:ownScoreRoll,
      });
      const targetCombat=calculatePvpCombatStats({
        profession:target.profession,strength:Number(target.strength||10),dexterity:Number(target.dexterity||10),intelligence:Number(target.intelligence||10),defense:Number(target.defense||8),vitality:Number(target.vitality||10),
        weaponAttack:Number(tw?.attack||0),weaponEnhancementLevel:twl,armorDefense:Number(ta?.defense||0),armorEnhancementLevel:tal,
        weaponProperty:targetProps[teq.weapon],armorProperty:targetProps[teq.armor],
        hasAttackSet:targetSets.hasAttackSet,hasDefenseSet:targetSets.hasDefenseSet,hasCritSet:targetSets.hasCritSet,
        attackBuff:activeBuffValue(target,'attack',now),defenseBuff:activeBuffValue(target,'defense',now),critBuff:activeBuffValue(target,'crit',now),
        attackRoll:targetAttackRoll,scoreRoll:targetScoreRoll,
      });
      const atk=ownCombat.attack,def=ownCombat.defense,score=ownCombat.score;
      const tatk=targetCombat.attack,tdef=targetCombat.defense,targetScore=targetCombat.score;
      const win=score>=targetScore;let stolenGold=0;p.lastPvpResult=win?`Победа над ${target.name}`:`Поражение от ${target.name}`;if(!isBot){const outcome=resolvePvpOutcome(Number(p.gold||0),Number(target.gold||0),win,now);stolenGold=outcome.stolenGold;p.gold=outcome.attackerGold;target.gold=outcome.targetGold;if(win){p.pvpWins++;this.addXp(p,Math.floor(30+p.level*8));target.pvpLosses=Number(target.pvpLosses||0)+1;targetPvpState.immunityUntil=outcome.immunityUntil;}else{p.pvpLosses++;target.pvpWins=Number(target.pvpWins||0)+1;attackerPvpState.immunityUntil=outcome.immunityUntil;}targetQuestData.pvp=targetPvpState;target.quests=JSON.stringify(targetQuestData);attackerPvpState.previousOfferedIds=Array.isArray(attackerPvpState.offeredIds)?[...attackerPvpState.offeredIds]:[];attackerPvpState.offeredIds=[];attackerPvpState.offersExpireAt=0;attackerQuestData.pvp=attackerPvpState;p.quests=JSON.stringify(attackerQuestData);}const pvpReport={at:Date.now(),mode:'Арена',zone:'PvP-арена',enemy:target.name,rank:'duel',result:win?'win':'loss',profession:p.profession||'Без профессии',level:p.level,attack:Math.floor(atk),defense:Math.floor(def),damage:0,received:0,hpBefore:p.health,hpAfter:p.health,maxHealth:effectiveMaxHealth(p),equipment:{weapon:w?.name||'Нет',weaponLevel:wl,armor:a?.name||'Нет',armorLevel:al,amulet:ITEMS.find(x=>x.id===eq.amulet)?.name||'Нет'},scores:{player:Math.floor(score),opponent:Math.floor(targetScore)},rewards:{xp:win&&!isBot?Math.floor(30+p.level*8):0,gold:win&&!isBot?stolenGold:0},lines:[`Соперник: ${target.name} — ${target.race}, уровень ${target.level}.`,`Твоя профессия: ${p.profession||'не выбрана'}.`,`Боевые параметры: атака ${Math.floor(atk)}, защита ${Math.floor(def)}.`,`Экипировка: ${w?.name||'без оружия'}${wl?` +${wl}`:''}; ${a?.name||'без брони'}${al?` +${al}`:''}; ${ITEMS.find(x=>x.id===eq.amulet)?.name||'без кольца'}.`,`Боевой рейтинг: ${Math.floor(score)} против ${Math.floor(targetScore)}.`,win?(isBot?'Победа над тренировочным манекеном. Награды нет.':`Победа. Забрано ${stolenGold} золота — 20% баланса соперника.`):(isBot?'Тренировочный бой завершён. Награды нет.':'Поражение. Награды нет; на персонажа наложена защита на 1 час.')]};const savedCombatHistory=saveCombatReport(p,pvpReport);
if(!isBot){all[targetId]=target;committedTarget=target;committedTargetId=targetId;onlineTargetClient=ONLINE_CLIENTS.get(targetId);}
all[this.playerId]=p.toJSON();
const resultPayload={report:pvpReport,text:`${win?'ПОБЕДА':'ПОРАЖЕНИЕ'} в дуэли против ${target.name} (${target.race}, ур. ${target.level}).
Твой расчётный боевой рейтинг: ${Math.floor(score)}. Рейтинг соперника: ${Math.floor(targetScore)}.
${win?(isBot?'Тренировочный манекен: наград нет.':`Ты забрал ${stolenGold} золота (20% баланса) и получил опыт.`):(isBot?'Тренировочный манекен: наград нет.':'Награды нет. На соперника действует иммунитет 1 час.')}`};
return {files:{players:all},result:{history:savedCombatHistory,resultPayload,win,targetName:target.name,now,immunityUntil:Number(readPvpStateSafe(p).immunityUntil||0),isBot}};
        });
      } catch(error) {
        if(rollbackAttacker)applyPlayerSave(this.state.player as any,rollbackAttacker);
        if(rollbackTarget&&rollbackTargetId){const online=ONLINE_PLAYERS.get(rollbackTargetId);if(online)applyPlayerSave(online as any,rollbackTarget);}
        throw error;
      }
      if(result.notice)return this.notice(c,result.notice);
      if(committedTarget&&committedTargetId){const online=ONLINE_PLAYERS.get(committedTargetId);if(online)applyPlayerSave(online as any,committedTarget);}
      c.send('combatHistory',{history:result.history});
      if(!result.isBot){if(onlineTargetClient)onlineTargetClient.send('notice',{text:'На тебя напали. Защита от новых нападений действует 1 час.'});c.send('pvpList',{players:[],cooldownUntil:result.now+PVP_ATTACK_COOLDOWN_MS,offersExpireAt:0,immunityUntil:result.immunityUntil});}
      c.send('pvpResult',result.resultPayload);
      this.notice(c,result.win?`Ты победил ${result.targetName} в PvP.`:`В этот раз ${result.targetName} оказался сильнее.`);
    });
    this.onAuthenticatedMessage('admin',(c,d:any)=>{if(!ADMIN_PLAYER_IDS.has(this.playerId))return this.notice(c,'Нет прав для выполнения этой команды.');if(!this.requireCharacter(c))return;const p=this.state.player;const action=String(d?.action||'');const amount=Math.max(1,Math.min(100000000,Math.floor(Number(d?.amount)||1)));if(action==='gold'){p.gold+=amount;p.goldEarned+=amount;}else if(action==='crystals')p.crystals+=amount;else if(action==='gems')p.gems+=amount;else if(action==='xp')this.addXp(p,amount);else if(action==='level'){p.level=amount;p.experience=0;p.experienceToNext=xpNeed(p.level);p.maxHealth=100+p.level*18+p.vitality*2;p.health=effectiveMaxHealth(p);}else if(action==='heal')p.health=effectiveMaxHealth(p);else if(action==='stats'){p.strength+=100;p.defense+=100;p.vitality+=100;p.dexterity+=100;p.intelligence+=100;p.luck+=100;p.stamina+=100;p.accuracy+=100;}else if(action==='materials'){const inv=readArray(p.inventory);inv.push('wood_material','wood_material','herb_material','herb_material','herb_bundle','rune_shard','venom_gland','crystal_shard','ash_ore','abyss_shard','relic_fragment');p.inventory=JSON.stringify(inv);}else if(action==='profession'){if(p.level<20)p.level=20;const available=PROFESSIONS[p.race]||[];p.profession=available[0]||'';}else if(action==='resetDaily'){p.lastDailyAt=0;p.lastFountainAt=0;p.daily='{}';}else if(action==='resetCharacter'){p.level=1;p.experience=0;p.experienceToNext=xpNeed(1);p.strength=10;p.defense=8;p.vitality=10;p.dexterity=10;p.intelligence=10;p.luck=5;p.stamina=10;p.accuracy=10;p.statPoints=0;p.health=p.maxHealth=100;p.gold=250;p.crystals=0;p.gems=0;p.inventory=JSON.stringify(['wood_sword','health_potion']);p.equipment=JSON.stringify({weapon:'wood_sword',helmet:'',armor:'',gloves:'',boots:'',cloak:'',amulet:''});p.equipmentEnhancements='{}';p.profession='';}else return this.notice(c,'Неизвестная команда.');this.notice(c,`Админ-команда выполнена: ${action}.`);});
    this.onAuthenticatedMessage('rename',(c,d:any)=>{if(!this.requireCharacter(c))return;const name=String(d?.name||'').trim().slice(0,24);if(name.length<2)return this.notice(c,'Имя должно содержать минимум 2 символа.');this.state.player.name=name;this.notice(c,`Имя изменено на ${name}.`);});
  }
}

function loadDungeonResultOutbox():DungeonResultOutbox {
  if(!existsSync(DUNGEON_OUTBOX_FILE))return {};
  const parsed:unknown=JSON.parse(readFileSync(DUNGEON_OUTBOX_FILE,'utf8'));
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('dungeon_outbox.json must contain an object keyed by event ID.');
  return parsed as DungeonResultOutbox;
}
function dispatchDungeonResultsToClient(playerId:string,client:Client){
  return dispatchPendingDungeonResultEvents({playerId,outbox:loadDungeonResultOutbox(),send:(type,payload)=>client.send(type,payload),acknowledge:(eventId)=>markDungeonResultEventDelivered({runtime:sharedStateRuntime,outbox:loadDungeonResultOutbox(),eventId,now:Date.now()})});
}
function persistDungeonResultPlayers(players:Player[],events:Array<{eventId:string;runId:string;playerId:string;messageType:string;payload:Record<string,unknown>}>){
  sharedStateRuntime.transact(recovered=>{
    if(recovered)throw new Error('Shared state was recovered during dungeon result persistence; reload players before retrying.');
    for(const online of ONLINE_PLAYERS.values())normalizePlayerProfessionData(online);
    const all=loadPlayers();
    for(const saved of Object.values(all))normalizePlayerProfessionData(saved);
    for(const [id,online] of ONLINE_PLAYERS)all[id]=online.toJSON();
    for(const player of players)if(player?.id)all[player.id]=player.toJSON();
    const outbox=enqueueDungeonResultEvents({outbox:loadDungeonResultOutbox(),events,now:Date.now()});
    return {files:{players:all,dungeonOutbox:outbox},result:undefined};
  });
}
function safeId(v:any){return String(v||'').replace(/[^a-zA-Z0-9_-]/g,'').slice(0,64)||`guest_${Date.now()}`;}

function loadPlayersWithOnline():Record<string,any>{const all=loadPlayers();for(const player of Object.values(all))normalizePlayerProfessionData(player);for(const [id,online] of ONLINE_PLAYERS){normalizePlayerProfessionData(online);all[id]=online.toJSON();}return all;}
function syncOnlinePlayersAfterRecovery(){const recovered=loadPlayers();for(const [id,online] of ONLINE_PLAYERS){const saved=recovered[id];if(saved)applyPlayerSave(online as any,saved);}}
function loadPlayersForAuction():Record<string,any>{return loadPlayersWithOnline();}
function recoverPlayerStateBeforeMutation(){const recovered=sharedStateRuntime.recoverPendingState();if(recovered)syncOnlinePlayersAfterRecovery();return recovered;}
function persistPlayers(players:Player[]){sharedStateRuntime.transact((hadRecovery)=>{if(hadRecovery)throw new Error('Player state was recovered during a mutation; retry the action after state synchronization.');for(const online of ONLINE_PLAYERS.values())normalizePlayerProfessionData(online);const all=loadPlayers();for(const player of Object.values(all))normalizePlayerProfessionData(player);for(const [id,online] of ONLINE_PLAYERS)all[id]=online.toJSON();for(const p of players)if(p?.id)all[p.id]=p.toJSON();return {files:{players:all},result:undefined};});}
function persistPlayer(p:Player){if(!p?.id)return;persistPlayers([p]);}
function loadClans():Record<string,any>{return readPersistentJson<Record<string,any>>(CLAN_FILE,{},value=>isPlainObject(value)&&Object.values(value).every(isPlainObject));}
function loadTerritories():any[]{const defaults=TERRITORIES.map(t=>({...t,owner:'',ownerName:'',capturedAt:0,defense:0}));return readPersistentJson<any[]>(TERRITORY_FILE,defaults,value=>Array.isArray(value)&&value.every(isPlainObject));}
function isClanMember(clan:any,playerId:string):boolean{return !!clan&&Array.isArray(clan.members)&&clan.members.some((member:any)=>member?.id===playerId);}
function transactClanStateMutation<T>(prepare:(state:{clans:Record<string,any>;wars:any[];territories:any[]})=>T,shouldCommit:(result:T)=>boolean=()=>true):T{
  return sharedStateRuntime.commitClan((hadRecovery)=>{
    if(hadRecovery)syncOnlinePlayersAfterRecovery();
    const clans=loadClans(),wars=loadWars(),territories=loadTerritories();
    const result=prepare({clans,wars,territories});
    return {snapshot:{players:loadPlayersWithOnline(),clans,wars,territories},result,skipWrite:!shouldCommit(result)};
  });
}
function transactClanMutation<T>(playerId:string,prepare:(state:{p:Player;clans:Record<string,any>;wars:any[];territories:any[]})=>T):T{
  return sharedStateRuntime.commitClan((hadRecovery)=>{
    if(hadRecovery)syncOnlinePlayersAfterRecovery();
    const player=ONLINE_PLAYERS.get(playerId);
    if(!player)throw new Error('Authenticated player is not online.');
    const clans=loadClans(),wars=loadWars(),territories=loadTerritories();
    const result=prepare({p:player,clans,wars,territories});
    return {snapshot:{players:loadPlayersWithOnline(),clans,wars,territories},result};
  });
}
function ensureAllClanQuests(clans:Record<string,any>):boolean{const before=JSON.stringify(clans);for(const clan of Object.values(clans))ensureClanQuests(clan);return JSON.stringify(clans)!==before;}
function ensureClanQuests(clan:any):any[]{const day=Math.floor(Date.now()/(24*60*60*1000));if(!clan.questDay||clan.questDay!==day){clan.questDay=day;clan.questProgress={donate:0,raid:0,war:0,territory:0};clan.quests=[{id:'donate',name:'Общая казна',desc:'Внесите вместе 2 000 золота в казну клана',goal:2000,progress:0,claimed:false},{id:'raid',name:'Экспедиция гильдии',desc:'Успешно завершите 2 клановых похода',goal:2,progress:0,claimed:false},{id:'war',name:'Защитники знамени',desc:'Выиграйте 3 клановые войны',goal:3,progress:0,claimed:false},{id:'territory',name:'Расширение владений',desc:'Захватите 1 новую территорию',goal:1,progress:0,claimed:false}];}const progress=clan.questProgress||{};for(const q of clan.quests||[]){q.progress=Math.min(q.goal,Number(progress[q.id]||0));}return clan.quests||[];}
function clanSeasonBoard(clans:Record<string,any>,limit=10):any[]{return Object.values(clans).map((x:any)=>({id:x.id,name:x.name,level:x.level||1,seasonPoints:Number(x.seasonPoints||0),territories:loadTerritories().filter((t:any)=>t.owner===x.id).length})).sort((a:any,b:any)=>b.seasonPoints-a.seasonPoints||b.territories-a.territories).slice(0,limit);}
function loadAuction():any[]{const list=readPersistentJson<any[]>(AUCTION_FILE,[],value=>Array.isArray(value)&&value.every(isPlainObject));return list.map((x:any)=>({...x,status:x.status||'active'}));}
function loadAuctionHistory():any[]{return readPersistentJson<any[]>(AUCTION_HISTORY_FILE,[],value=>Array.isArray(value)&&value.every(isPlainObject));}
function loadAuctionForTransaction():any[]{if(!existsSync(AUCTION_FILE))return [];const list=JSON.parse(readFileSync(AUCTION_FILE,'utf8'));if(!Array.isArray(list)||list.some((x:any)=>!x||typeof x!=='object'||Array.isArray(x)))throw new Error('Auction listing data is invalid; transaction cancelled.');return list.map((x:any)=>({...x,status:x.status||'active'}));}
function loadAuctionHistoryForTransaction():any[]{if(!existsSync(AUCTION_HISTORY_FILE))return [];const history=JSON.parse(readFileSync(AUCTION_HISTORY_FILE,'utf8'));if(!Array.isArray(history)||history.some((x:any)=>!x||typeof x!=='object'||Array.isArray(x)))throw new Error('Auction history data is invalid; transaction cancelled.');return history;}
function loadWars():any[]{return readPersistentJson<any[]>(WAR_FILE,[],value=>Array.isArray(value)&&value.every(isPlainObject));}
function broadcastClanOverview(clans:Record<string,any>){
  const payload={clans:Object.values(clans).map((x:any)=>({id:x.id,name:x.name,level:x.level,members:Array.isArray(x.members)?x.members.length:0,vault:x.vault,leader:x.leader,seasonPoints:x.seasonPoints||0,upgrades:x.upgrades||{barracks:0,treasury:0,banner:0}}))};
  const sent=new Set<string>();
  for(const clan of Object.values(clans)){
    for(const member of Array.isArray(clan.members)?clan.members:[]){
      const id=String(member?.id||'');
      if(!id||sent.has(id))continue;
      sent.add(id);
      ONLINE_CLIENTS.get(id)?.send('clanList',payload);
    }
  }
  return payload;
}
function broadcastClanQuests(clans:Record<string,any>){
  const season=clanSeasonBoard(clans);
  const sent=new Set<string>();
  for(const clan of Object.values(clans)){
    // Build a read-only presentation snapshot: quest initialization belongs to
    // the state-changing handler/transaction, never to a broadcast side effect.
    const questView=JSON.parse(JSON.stringify(clan));
    const payload={quests:ensureClanQuests(questView),upgrades:questView.upgrades||{barracks:0,treasury:0,banner:0},season};
    for(const member of Array.isArray(clan.members)?clan.members:[]){
      const id=String(member?.id||'');
      if(!id||sent.has(id))continue;
      sent.add(id);
      ONLINE_CLIENTS.get(id)?.send('clanQuests',payload);
    }
  }
}
function broadcastClanTerritories(clans:Record<string,any>,territories:any[]=loadTerritories()){
  const names=new Map(Object.values(clans).map((clan:any)=>[clan.id,clan.name]));
  const payload={territories:territories.map((territory:any)=>({...territory,ownerName:names.get(territory.owner)||territory.ownerName||''}))};
  const sent=new Set<string>();
  for(const clan of Object.values(clans)){
    for(const member of Array.isArray(clan.members)?clan.members:[]){
      const id=String(member?.id||'');
      if(!id||sent.has(id))continue;
      sent.add(id);
      ONLINE_CLIENTS.get(id)?.send('clanTerritories',payload);
    }
  }
  return payload;
}
function broadcastClanWarList(wars:any[],clans:Record<string,any>){
  const payload={wars:wars.filter((war:any)=>war.status==='active')};
  const sent=new Set<string>();
  for(const clan of Object.values(clans)){
    for(const member of Array.isArray(clan.members)?clan.members:[]){
      const id=String(member?.id||'');
      if(!id||sent.has(id))continue;
      sent.add(id);
      ONLINE_CLIENTS.get(id)?.send('clanWarList',payload);
    }
  }
  return payload;
}

function applySaved(p:Player,s:any){applyPlayerSave(p as any,s);p.level=Math.max(1,Math.floor(Number(p.level)||1));p.experienceToNext=xpNeed(p.level);}


function recordActivity(p:Player,entry:Record<string,any>){const q=readObject(p.quests);const now=Date.now();const day=new Date(now).toISOString().slice(0,10);if(q.activityDay!==day){q.activityDay=day;q.activityToday={hunts:0,wins:0,losses:0,gold:0,xp:0,dungeons:0,crafts:0};}const stats=q.activityToday||{hunts:0,wins:0,losses:0,gold:0,xp:0,dungeons:0,crafts:0};if(entry.type==='hunt'){p.lastHuntAt=now;stats.hunts++;if(entry.outcome==='win'){stats.wins++;if(q.challengeDay!==day){q.challengeDay=day;q.dailyHunts=0;}q.dailyHunts=Number(q.dailyHunts||0)+1;resetWeeklyHuntProgress(q,utcIsoWeekKey(new Date(now)));q.weeklyHunts=Number(q.weeklyHunts||0)+1;}else stats.losses++;stats.gold+=Number(entry.gold||0);stats.xp+=Number(entry.xp||0);}if(entry.type==='dungeon')stats.dungeons++;if(entry.type==='craft'&&entry.outcome==='complete')stats.crafts++;q.activityToday=stats;q.activityLog=Array.isArray(q.activityLog)?q.activityLog:[];q.activityLog.unshift({at:now,...entry});q.activityLog=q.activityLog.slice(0,30);p.quests=JSON.stringify(q);}
function saveCombatReport(p:Player,report:Record<string,any>){const q=readObject(p.quests);q.combatHistory=Array.isArray(q.combatHistory)?q.combatHistory:[];q.combatHistory.unshift(report);q.combatHistory=q.combatHistory.slice(0,20);p.quests=JSON.stringify(q);return q.combatHistory;}


function xpNeed(level:number){return Math.floor(100*Math.pow(level,1.85));}
const DEFAULT_BUFF_VALUES:Record<string,number>={attack:.15,defense:.15,xp:.15,gold:.15,crit:.12,loot:.15,lifesteal:.08};
function activeBuffValue(player:any,effect:string,now=Date.now()):number{if(!player||Number(player.buffUntil||0)<=now)return 0;const primary=String(player.buff||'')===effect,secondary=String(player.buffSecondaryEffect||'')===effect;if(!primary&&!secondary)return 0;const stored=Number(primary?player.buffValue:player.buffSecondaryValue);return Number.isFinite(stored)&&stored>0?Math.min(1,stored):Number(DEFAULT_BUFF_VALUES[effect]||0);}
function resolvePlayerMonsterStats(p:Player,monster:any,options:{applyFivePieceSetBonus:boolean;includeLifestealBuff:boolean;isBoss?:boolean}){
 const eq=readObject(p.equipment),up=readObject(p.equipmentEnhancements),collections=readObject(p.collections);
 const weapon=ITEMS.find(item=>item.id===eq.weapon),wp=weaponProfile(p,weapon);
 const armorItems=['armor','helmet','gloves','boots','cloak'].map(slot=>({slot,item:ITEMS.find(item=>item.id===eq[slot])})).filter(entry=>entry.item).map(entry=>{const attributes=entry.item?.attributes&&typeof entry.item.attributes==='object'?entry.item.attributes:{};return {item:entry.item,attack:Number(entry.item?.attack||0),defense:Number(entry.item?.defense||0),strength:Number(attributes.strength||0),dexterity:Number(attributes.dexterity||0),intelligence:Number(attributes.intelligence||0),vitality:Number(attributes.vitality||0),stamina:Number(attributes.stamina||0),enhancementLevel:Number(up[`${entry.slot}:${eq[entry.slot]}`]||0)};});
 const catalogArmorEffects=['armor','helmet','gloves','boots','cloak']
  .map(slot=>ITEMS.find(item=>item.id===eq[slot]))
  .filter((item:any)=>item&&typeof item.effects==='string')
  .flatMap((item:any)=>parseMonsterCombatEffectClauses(String(item.effects)));
 const catalogCombatTargets:Record<string,string>={accuracy:'accuracy',evasion:'evasion',critChance:'critChance',critDamage:'critDamage',resistance:'resistance',controlResistance:'controlResistance',attackSpeed:'attackSpeed',physicalDamage:'physicalDamage',magicDamage:'magicDamage',bossDamage:'bossDamage',lifesteal:'lifesteal',healing:'healing',health:'health',loot:'loot'};
 const catalogCombatEffects:any[]=[weapon,...armorItems.map((entry:any)=>entry.item)].filter(Boolean).flatMap((item:any)=>Object.entries(item.combatStats&&typeof item.combatStats==='object'?item.combatStats:{}).flatMap(([key,raw])=>{const target=catalogCombatTargets[key],value=Number(raw);return target&&Number.isFinite(value)&&value>0?[{target,value}]:[];}));
 const mastery=collections.setMastery||{};
 // Legacy sets are excluded from legacy multiplier processing, but their explicit
 // tier descriptions still contribute typed modifiers to the new combat engine.
 const legacySetCombatEffects=EQUIPMENT_SETS.filter((set:any)=>set.legacy).flatMap((set:any)=>{
  const itemCount=set.items.filter((id:string)=>Object.values(eq).includes(id)).length;
  return resolveEquipmentSetCombatEffects({
   itemCount,
   two:typeof set.two==='string'?set.two:undefined,
   three:typeof set.three==='string'?set.three:undefined,
   four:typeof set.four==='string'?set.four:undefined,
   full:typeof set.full==='string'?set.full:undefined,
   fullAt:set.items.length,
  });
 });
 const setBonuses=EQUIPMENT_SETS.filter((set:any)=>!set.legacy).map((set:any)=>{
  const itemCount=set.items.filter((id:string)=>Object.values(eq).includes(id)).length;
  const descriptions=resolveEquipmentSetTierDescriptions({
   itemCount,
   two:typeof set.two==='string'?set.two:undefined,
   three:typeof set.three==='string'?set.three:undefined,
   four:typeof set.four==='string'?set.four:undefined,
   full:typeof set.full==='string'?set.full:undefined,
   fullAt:set.items.length,
  });
  return {effect:String(set.effect||''),itemCount,mastery:Number(mastery[set.id]||0),descriptions};
});
 const pendant=NEW_EQUIPMENT_ITEMS.find(item=>item.id===eq.amulet),now=Date.now();
 const equipmentProperties=collections.equipmentProperties||{};
 const equipmentEffects=Array.from(new Set(Object.values(eq).filter((id:any)=>typeof id==='string'&&id)))
  .map((id:any)=>equipmentProperties[id])
  .filter((property:any)=>property&&typeof property.effect==='string')
  .map((property:any)=>resolveMonsterCombatProperty(String(property.effect),Number(property.value)))
  .filter((effect:any)=>Boolean(effect));
 const pendantCombatEffect=pendant
  ?resolveMonsterPendantCombatEffect(String(pendant.effect||''),pendantEffectValue(pendant,Number(collections.pendantLevels?.[pendant.id||'']||1)))
  :undefined;
 return calculatePlayerMonsterCombatStats({profession:p.profession,strength:p.strength,dexterity:p.dexterity,intelligence:p.intelligence,vitality:p.vitality,stamina:p.stamina,baseDefense:p.defense,
  weaponStrength:wp.strength,weaponDexterity:wp.dexterity,weaponIntelligence:wp.intelligence,weaponVitality:wp.vitality,weaponStamina:wp.stamina,
  weaponAttack:Number(weapon?.attack||0),weaponEnhancementLevel:Number(up[`weapon:${eq.weapon}`]||0),armorItems,
  weaponDexterityBonus:wp.dexterity,weaponProfileBonus:wp.profileBonus,weaponLootBonus:wp.lootBonus,
  pendantEffect:pendant?.effect,pendantValue:pendantEffectValue(pendant,Number(collections.pendantLevels?.[pendant?.id||'']||1)),isBoss:options.isBoss??['boss','finalBoss'].includes(String(monster?.rank||'')),setBonuses,
  buffs:{attack:activeBuffValue(p,'attack',now),crit:activeBuffValue(p,'crit',now),defense:activeBuffValue(p,'defense',now),loot:activeBuffValue(p,'loot',now),lifesteal:options.includeLifestealBuff?activeBuffValue(p,'lifesteal',now):0},
  equipmentEffects:[...equipmentEffects,...catalogArmorEffects,...catalogCombatEffects,...legacySetCombatEffects],pendantCombatEffect,
  now,buffUntil:Number(p.buffUntil||0),applyFivePieceSetBonus:options.applyFivePieceSetBonus});
}
function rand(a:number,b:number){return Math.floor(Math.random()*(b-a+1))+a;}
function statName(k:string){return ({strength:'Сила',defense:'Защита',vitality:'Живучесть',dexterity:'Ловкость',intelligence:'Интеллект',luck:'Удача',stamina:'Выносливость',accuracy:'Меткость'} as Record<string,string>)[k]||k;}
function labelForActivity(encounter:string){return encounter==='boss'?'Победа над боссом':encounter==='rare'?'Победа над редким монстром':'Победа в охоте';}
const httpServer=createServer(authHttpHandler);const gameServer=new Server({transport:new WebSocketTransport({server:httpServer})});gameServer.define('my_room',GameRoom);
startPlayerAutosave({
  intervalMs: 30_000,
  save: () => {
    if (ONLINE_PLAYERS.size) {
      recoverPlayerStateBeforeMutation();
      for (const player of ONLINE_PLAYERS.values()) applyHealthRegeneration(player);
      persistPlayers(Array.from(ONLINE_PLAYERS.values()));
    }
  },
  onError: error => console.error('Periodic player autosave failed:', error),
});
const PORT = Number(process.env.MISTY_PORT || 2567);
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) throw new Error('MISTY_PORT must be a valid TCP port.');
gameServer.listen(PORT).then(()=>console.log('RPG server listening on :' + PORT));
