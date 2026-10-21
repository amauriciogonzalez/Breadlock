const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const stages = html.slice(html.indexOf('const STAGE_KEYS='),html.indexOf('function tabStages('));
const timeline = times => ({account_id:123,stats_time_stamp_s:times,
  ...Object.fromEntries(['net_worth','creep_kills','denies','player_damage','kills','deaths']
    .map(key=>['stats_'+key,times.map(t=>t/60)]))});

function harness(metadata){
  const match={match_id:42,match_duration_s:1500,start_time:100,account_id:123};
  const player={id:'76561198000000123',label:'Example',loading:false,matches:[match]};
  let renders=0;
  const ctx=vm.createContext({players:[player],STAGE_MATCH_LIMIT:25,scopeKey:()=> 'normal:0:matches',
    visibleMatches:p=>p.matches,gn:(obj,key)=>obj?.[key]??null,
    BreadlockData:{metadata},renderMain:()=>{renders++;},dbg:()=>{},activeTab:'stages',dataNotice:'',
    placementLoading:false,placementRetryTimer:null,placementNextTimer:null});
  vm.runInContext(stages,ctx);
  return {ctx,player,match,get renders(){return renders;}};
}

test('match stages on demand use a compact timeline projection and account32',async()=>{
  const calls=[];
  const h=harness(async(ids,options,settings)=>{
    calls.push({ids,options,settings});
    return [{match_id:42,players:[timeline([540,720,1200,1500])]}];
  });
  await Promise.all([h.ctx.refreshStages(),h.ctx.refreshStages()]);
  assert.equal(calls.length,1);
  assert.equal(calls[0].options.account_ids,'123');
  assert.equal(calls[0].options.include_player_stats,undefined);
  assert.equal(calls[0].options.extra_player_columns,
    'stats.time_stamp_s,stats.net_worth,stats.creep_kills,stats.denies,stats.player_damage,stats.kills,stats.deaths');
  assert.equal(calls[0].settings.priority,2);
  const bucket=h.player.stages['normal:0:matches'];
  assert.equal(bucket.loading,false);
  assert.equal(bucket.done,1);
  assert.equal(bucket.values.get('42').early.net_worth,10);
  assert.equal(bucket.values.get('42').late.net_worth,1);
  assert.ok(h.renders>0);
});

test('missing or truncated stage columns remain incomplete, not zero',async()=>{
  const h=harness(async()=>[{match_id:42,players:[{...timeline([540,720]),stats_kills:[3]}]}]);
  await h.ctx.refreshStages();
  assert.equal(h.player.stages['normal:0:matches'].values.size,0);
});

test('stage loading waits for leaderboard data and tab selection',async()=>{
  let calls=0;
  const h=harness(async()=>{calls++;return [];});
  h.ctx.activeTab='overview';
  await h.ctx.refreshStages();
  h.ctx.activeTab='stages';
  h.player.detailsLoading=true;
  await h.ctx.refreshStages();
  h.player.detailsLoading=false;
  h.ctx.placementLoading=true;
  await h.ctx.refreshStages();
  h.ctx.placementLoading=false;
  h.ctx.placementNextTimer=1;
  await h.ctx.refreshStages();
  assert.equal(calls,0);
  h.ctx.placementNextTimer=null;
  await h.ctx.refreshStages();
  assert.equal(calls,1);
  const loaded=html.slice(html.indexOf('async function addPlayer('),html.indexOf('function startMatchDetails('));
  assert.doesNotMatch(loaded,/Prefetch the small stage projection/);
  assert.match(loaded,/if\(activeTab==='stages'\)void refreshStages\(\)/);
});
