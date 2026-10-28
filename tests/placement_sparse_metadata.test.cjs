const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const model = require('../backend/statlocker_placement_core.js');

const fields = ['time_stamp_s','net_worth','player_damage','assists','creep_kills',
  'player_damage_taken','damage_mitigated','damage_absorbed','teammate_healing',
  'teammate_barriering','heal_prevented','boss_damage',
  ...['lane_creeps','neutrals','treasure','breakable'].flatMap(name =>
    ['gold','gold_orbs'].map(suffix => 'gold_source_'+name+'_'+suffix))];

// The full and columnar payloads must feed the identical scoring model.
test('sparse timeline preserves match scoring and rejects truncated arrays', () => {
  const row = {match_id:42,duration_s:1800,game_mode:'Normal',objectives:[],players:[]};
  for(let i=0;i<12;i++){
    const snapshot = t => Object.fromEntries(fields.map(key => [key,
      key==='time_stamp_s'?t:key==='net_worth'?t*4+i:key==='player_damage'?t+i:
      key==='assists'?0:key==='creep_kills'?t/180:10]));
    row.players.push({hero_id:i+1,player_slot:i,team:'Team'+(i<6?0:1),kills:0,
      death_details:[],stats:[snapshot(180),snapshot(1800)]});
  }
  const sparse = {...row,players:row.players.map(p => {
    const {stats,...rest}=p;
    return {...rest,...Object.fromEntries(fields.map(key =>
      ['stats_'+key,stats.map(sample => sample[key])]))};
  })};
  const fullScore = model.scoreMatch(model.fromBulkMetadata(row));
  const sparseScore = model.scoreMatch(model.fromBulkMetadata(sparse));
  assert.deepEqual(sparseScore,fullScore);
  sparse.players[0].stats_net_worth.pop();
  assert.throws(() => model.fromBulkMetadata(sparse),/Missing bulk player timeline/);
});

test('placement query projects only scoring fields without bulky final_stats', () => {
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const options=html.slice(html.indexOf('const PLACEMENT_TIMELINE_FIELDS='),html.indexOf('const PLACEMENT_CACHE_LIMIT='));
  for(const field of fields.slice(0,12))assert.ok(options.includes(field),field);
  assert.match(options,/\['lane_creeps','neutrals','treasure','breakable'\]\.flatMap/);
  assert.match(options,/\['gold','gold_orbs'\]\.map/);
  assert.ok(options.includes("'self_healing'"),'match breakdown healing');
  for(const field of ['shots_hit','shots_missed','hero_bullets_hit_crit','hero_bullets_hit',
    'neutral_damage','creep_damage','denies','level','deaths'])
    assert.ok(!options.includes("'"+field+"'"),field);
  assert.doesNotMatch(options,/include_player_final_stats:'true'|include_player_stats:'true'/);
  assert.match(html,/metadata\(batch,PLACEMENT_METADATA_OPTIONS/);
  assert.match(html,/metadata\(\[id\],PLACEMENT_METADATA_OPTIONS/);
  const project=html.slice(html.indexOf('function placementFinalStats('),html.indexOf('function applyBulkMatchDetails('));
  const context=vm.createContext({});
  vm.runInContext(options+'\n'+project,context);
  const list=vm.runInContext('PLACEMENT_TIMELINE_FIELDS',context);
  const player={stats_time_stamp_s:[180,360]};
  for(const field of list)player['stats_'+field]=[10,20];
  assert.equal(context.placementFinalStats(player).player_damage,20);
  assert.equal(context.placementFinalStats(player).hero_bullets_hit_crit,undefined);
  player.stats_hero_bullets_hit_crit=[5,25];
  assert.equal(context.placementFinalStats(player).hero_bullets_hit_crit,25);
  assert.equal(context.placementFinalStats(player).custom_user_stats,undefined);
  assert.equal(context.placementFinalStats({final_stats:{player_damage:42}}).player_damage,42);
});

test('scoring-only batch enriches damage and flags displayed stats for compact detail fetch',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  const options=html.slice(html.indexOf('const PLACEMENT_TIMELINE_FIELDS='),html.indexOf('const PLACEMENT_CACHE_LIMIT='));
  const functions=html.slice(html.indexOf('function placementFinalStats('),html.indexOf('async function calculatePlacements(){'));
  const players=[1,2].map(hero_id=>({matches:[{match_id:42,hero_id}]}));
  const context=vm.createContext({players,gn:(obj,key)=>obj?.[key]??null});
  vm.runInContext(options+'\n'+functions,context);
  const fields=vm.runInContext('PLACEMENT_TIMELINE_FIELDS',context);
  const row={match_id:42,players:Array.from({length:12},(_,i)=>{
    const p={hero_id:i+1,account_id:i+1,team:i<6?'Team0':'Team1',stats_time_stamp_s:[180,360]};
    for(const field of fields)p['stats_'+field]=[1,field==='player_damage'?100+i:20];
    return p;
  })};
  context.applyBulkMatchDetails(row);
  assert.equal(players[0].matches[0].player_damage,100);
  assert.equal(players[1].matches[0].player_damage,101);
  assert.equal(players[0].matches[0]._roster.length,12);
  assert.equal(players[1].matches[0]._detail.final_stats.hero_bullets_hit_crit,undefined);
  assert.equal(players[0].matches[0]._detailPartial,true);
});
