const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const DataCoordinator = require('../backend/data_coordinator.js');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('async function calculatePlacements(){'), html.indexOf('\nfunction dbg(', html.indexOf('async function calculatePlacements(){')));
const tick = () => new Promise(resolve => setImmediate(resolve));
function mountDetails(context,detail){
  context.DAMAGE_WORKERS=2;
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('const DETAIL_TIMELINE_FIELDS='),html.indexOf('const DAMAGE_BATCH_SIZE=')),context);
  vm.runInContext(html.slice(html.indexOf('const PLACEMENT_TIMELINE_FIELDS='),html.indexOf('const PLACEMENT_METADATA_OPTIONS=')),context);
  vm.runInContext(html.slice(html.indexOf('function placementFinalStats('),html.indexOf('function applyBulkMatchDetails(')),context);
  vm.runInContext(detail,context);
}

test('placement starts with the first ready history and extends without cancelling in-flight batches',()=>{
  const schedule=html.slice(html.indexOf('function schedulePlacements('),html.indexOf('function placementFinalStats('));
  const context={players:[{loading:false,error:null,matches:[{match_id:1,start_time:20}]},
    {loading:true,error:null,matches:null}],placementTargets:[],placementLoading:false,
    placementRetryTimer:null,placementNextTimer:null,placementStoppedReason:'',bulkPlayersLoading:false,
    window:{BreadlockPlacement:true},visibleMatches:p=>p.matches,
    gn:(m,key)=>m[key],calculatePlacements:()=>{context.started++;},
    cancelPlacements:()=>{context.cancelled++;},started:0,cancelled:0};
  vm.createContext(context);vm.runInContext(schedule,context);
  context.schedulePlacements(true);
  assert.equal(context.started,1);
  assert.deepEqual([...context.placementTargets],['1']);
  context.placementLoading=true;
  context.players[1].loading=false;
  context.players[1].matches=[{match_id:2,start_time:10},{match_id:1,start_time:5}];
  context.schedulePlacements(true);
  assert.equal(context.cancelled,0);
  assert.equal(context.started,1);
  assert.deepEqual([...context.placementTargets],['1','2']);
  context.placementLoading=false;
  context.schedulePlacements(true);
  assert.equal(context.started,2);
  context.schedulePlacements();
  assert.equal(context.cancelled,1);
});

test('bulk example loading waits to request the union of all histories',()=>{
  const schedule=html.slice(html.indexOf('function schedulePlacements('),html.indexOf('function placementFinalStats('));
  const context={players:[{loading:false,error:null,matches:[{match_id:1,start_time:20}]},
    {loading:true,error:null,matches:null}],placementTargets:[],placementLoading:false,
    placementRetryTimer:null,placementNextTimer:null,placementStoppedReason:'',bulkPlayersLoading:true,
    window:{BreadlockPlacement:true},visibleMatches:p=>p.matches,
    gn:(m,key)=>m[key],calculatePlacements:()=>{context.started++;},started:0};
  vm.createContext(context);vm.runInContext(schedule,context);
  context.schedulePlacements(true);
  assert.equal(context.started,0);
  context.players[1].loading=false;
  context.players[1].matches=[{match_id:2,start_time:10},{match_id:1,start_time:5}];
  context.schedulePlacements(true);
  assert.equal(context.started,0);
  context.bulkPlayersLoading=false;
  context.schedulePlacements(true);
  assert.equal(context.started,1);
  assert.deepEqual([...context.placementTargets],['1','2']);
});

test('cached details wait for histories and share metadata across players',async()=>{
  const detail=html.slice(html.indexOf('function startMatchDetails(){'),html.indexOf('// Accessors — gf'));
  const players=[1,2].map(n=>({id:String(n),label:'P'+n,loading:n===2,detailsLoading:true,
    matches:[{match_id:42,account_id:n,hero_id:n}]}));
  let requests=0;
  const coordinator=new DataCoordinator({spacingMs:0,fetchImpl:async url=>{
    requests++;
    const query=new URL(url).searchParams;
    assert.equal(query.get('account_ids'),'1,2');
    assert.equal(query.get('only_filtered_players'),'true');
    return {ok:true,json:async()=>[{match_id:42,players:[1,2].map(n=>({account_id:n,hero_id:n,
      final_stats:{player_damage:100+n}}))}]};
  }});
  const context={players,BreadlockData:coordinator,window:{BreadlockPlacement:true},URLSearchParams,
    placementRanks:new Map([['42',{}]]),DAMAGE_BATCH_SIZE:512,loadGeneration:0,
    placementLoading:false,placementNextTimer:null,
    renderLoadStatus:()=>{},renderChips:()=>{},renderMain:()=>{},dbg:()=>{},
    activeTab:'overview',gn:(obj,key)=>obj?.[key]??null};
  mountDetails(context,detail);
  context.startMatchDetails();
  assert.equal(requests,0);
  players[1].loading=false;
  await context.startMatchDetails();
  assert.equal(requests,1);
  assert.equal(players[0].matches[0].player_damage,101);
  assert.equal(players[1].matches[0].player_damage,102);
  assert.equal(players[0].detailsLoading,false);
  assert.equal(players[1].detailsLoading,false);
});

test('a failed filtered detail batch does not discard later damage data',async()=>{
  const detail=html.slice(html.indexOf('function startMatchDetails(){'),html.indexOf('// Accessors — gf'));
  const player={id:'1',label:'P1',loading:false,detailsLoading:true,
    matches:[1,2,3].map(match_id=>({match_id,account_id:1,hero_id:1}))};
  let requests=0;
  const context={players:[player],placementLoading:false,placementNextTimer:null,
    BreadlockData:{metadata:async ids=>{
      requests++;
      if(requests===1)throw new TypeError('Failed to fetch');
      return ids.map(match_id=>({match_id,players:[{account_id:1,final_stats:{player_damage:150}}]}));
    }},window:{BreadlockPlacement:true},URLSearchParams,
    placementRanks:new Map([1,2,3].map(id=>[String(id),{}])),
    DAMAGE_BATCH_SIZE:2,loadGeneration:0,renderLoadStatus:()=>{},renderChips:()=>{},
    renderMain:()=>{},dbg:()=>{},activeTab:'overview',gn:(obj,key)=>obj?.[key]??null};
  mountDetails(context,detail);
  await context.startMatchDetails();
  assert.equal(requests,2);
  assert.deepEqual([player.detailCoverage.found,player.detailCoverage.total],[1,3]);
  assert.equal(player.matches[2].player_damage,150);
});

test('early detail batches cover different players instead of exhausting one history first',async()=>{
  const detail=html.slice(html.indexOf('function startMatchDetails(){'),html.indexOf('// Accessors — gf'));
  const players=[1,2].map(n=>({id:String(n),label:'P'+n,loading:false,detailsLoading:true,
    matches:Array.from({length:3},(_,i)=>({match_id:i*2+n,account_id:n,hero_id:n,start_time:100-i}))}));
  const batches=[];
  const context={players,placementLoading:false,placementNextTimer:null,
    BreadlockData:{metadata:async ids=>{batches.push([...ids]);return ids.map(match_id=>({match_id,
      players:[{account_id:match_id%2?1:2,stats_time_stamp_s:[600],stats_player_damage:[100]}]}));}},
    window:{BreadlockPlacement:true},URLSearchParams,
    placementRanks:new Map(Array.from({length:6},(_,i)=>[String(i+1),{}])),
    DAMAGE_BATCH_SIZE:2,loadGeneration:0,renderLoadStatus:()=>{},renderChips:()=>{},
    renderMain:()=>{},dbg:()=>{},activeTab:'overview',gn:(obj,key)=>obj?.[key]??null};
  mountDetails(context,detail);
  await context.startMatchDetails();
  assert.deepEqual(batches[0],['1','2']);
  assert.deepEqual(players.map(p=>[p.detailCoverage.found,p.detailCoverage.total]),[[3,3],[3,3]]);
});

test('failed projected batch splits and preserves full damage and support coverage',async()=>{
  const detail=html.slice(html.indexOf('function startMatchDetails(){'),html.indexOf('// Accessors — gf'));
  const player={id:'1',label:'P1',loading:false,detailsLoading:true,
    matches:Array.from({length:64},(_,i)=>({match_id:i+1,account_id:1,hero_id:1}))};
  const sizes=[];
  const context={players:[player],placementLoading:false,placementNextTimer:null,
    BreadlockData:{metadata:async(ids,options)=>{
      sizes.push(ids.length);
      assert.match(options.extra_player_columns,/stats\.player_damage/);
      assert.equal(options.include_player_final_stats,undefined);
      if(ids.length>32)throw Object.assign(new Error('HTTP 504'),{status:504});
      return ids.map(match_id=>({match_id,players:[{account_id:1,hero_id:1,
        stats_time_stamp_s:[300,600],stats_player_damage:[50,150],
        stats_teammate_healing:[5,25],stats_shots_hit:[10,30]}]}));
    }},window:{BreadlockPlacement:true},URLSearchParams,
    placementRanks:new Map(player.matches.map(m=>[String(m.match_id),{}])),
    DAMAGE_BATCH_SIZE:64,loadGeneration:0,renderLoadStatus:()=>{},renderChips:()=>{},
    renderMain:()=>{},dbg:()=>{},activeTab:'overview',gn:(obj,key)=>obj?.[key]??null};
  mountDetails(context,detail);
  await context.startMatchDetails();
  assert.deepEqual(sizes,[64,32,32]);
  assert.deepEqual([player.detailCoverage.found,player.detailCoverage.total],[64,64]);
  assert.equal(player.matches[0]._detail.final_stats.teammate_healing,25);
  assert.equal(player.matches[0].player_damage,150);
});

test('optional details wait for placement projection and only fetch remaining matches',async()=>{
  const detail=html.slice(html.indexOf('function startMatchDetails(){'),html.indexOf('// Accessors — gf'));
  const players=[1,2].map(n=>({id:String(n),label:'P'+n,loading:false,detailsLoading:true,
    matches:[{match_id:42,account_id:n,hero_id:n},{match_id:43,account_id:n,hero_id:n}]}));
  let requests=0;
  const context={players,placementLoading:true,placementNextTimer:null,
    BreadlockData:{metadata:async ids=>{requests++;assert.deepEqual([...ids],['43']);
      return [{match_id:43,players:[1,2].map(n=>({account_id:n,final_stats:{player_damage:200+n}}))}];}},
    window:{BreadlockPlacement:true},URLSearchParams,placementRanks:new Map([['42',{}],['43',{}]]),
    DAMAGE_BATCH_SIZE:512,loadGeneration:0,renderLoadStatus:()=>{},renderChips:()=>{},
    renderMain:()=>{},dbg:()=>{},activeTab:'overview',gn:(obj,key)=>obj?.[key]??null};
  mountDetails(context,detail);
  context.startMatchDetails();
  assert.equal(requests,0);
  // Simulate the projected full-roster response being applied to both players.
  for(const p of players){p.matches[0]._detail={final_stats:{player_damage:101}};p.matches[0].player_damage=101;}
  context.placementLoading=false;
  await context.startMatchDetails();
  assert.equal(requests,1);
  assert.deepEqual(players.map(p=>[p.detailCoverage.found,p.detailCoverage.total]),[[2,2],[2,2]]);
});

test('example-sized projected histories avoid four redundant final-stat batches',async()=>{
  const detail=html.slice(html.indexOf('function startMatchDetails(){'),html.indexOf('// Accessors — gf'));
  const players=Array.from({length:10},(_,n)=>({id:String(n+1),label:'P'+n,
    loading:false,detailsLoading:true,matches:Array.from({length:313},(_,i)=>({
      match_id:1000+(n*313+i)%1672,account_id:n+1,hero_id:n+1,
      _detail:{final_stats:{player_damage:100}},player_damage:100}))}));
  let requests=0;
  const context={players,placementLoading:false,placementNextTimer:null,
    BreadlockData:{metadata:async()=>{requests++;return [];}},window:{BreadlockPlacement:true},
    URLSearchParams,placementRanks:new Map(Array.from({length:1672},(_,i)=>[String(1000+i),{}])),
    DAMAGE_BATCH_SIZE:512,loadGeneration:0,renderLoadStatus:()=>{},renderChips:()=>{},
    renderMain:()=>{},dbg:()=>{},activeTab:'overview',gn:(obj,key)=>obj?.[key]??null};
  mountDetails(context,detail);
  await context.startMatchDetails();
  assert.equal(requests,0);
  assert.ok(players.every(p=>p.detailCoverage.found===313&&p.detailCoverage.total===313));
  // 1672 unique games would otherwise need ceil(1672/512) = 4 extra paced requests.
  assert.equal(Math.ceil(1672/context.DAMAGE_BATCH_SIZE),4);
});

test('shared 600-match histories take two requests, not one set per player',async()=>{
  const detail=html.slice(html.indexOf('function startMatchDetails(){'),html.indexOf('// Accessors — gf'));
  const players=[1,2].map(n=>({id:String(n),label:'P'+n,loading:false,detailsLoading:true,
    matches:Array.from({length:600},(_,i)=>({match_id:1000+i,account_id:n,hero_id:n}))}));
  const requested=[];
  const coordinator=new DataCoordinator({spacingMs:0,fetchImpl:async url=>{
    const q=new URL(url).searchParams,ids=q.get('match_ids').split(',');
    requested.push(...ids);
    assert.equal(q.get('account_ids'),'1,2');
    return {ok:true,json:async()=>ids.map(match_id=>({match_id,
      players:[1,2].map(n=>({account_id:n,hero_id:n,final_stats:{player_damage:100+n}}))}))};
  }});
  const context={players,BreadlockData:coordinator,window:{BreadlockPlacement:true},URLSearchParams,
    placementRanks:new Map(players[0].matches.map(m=>[String(m.match_id),{}])),
    DAMAGE_BATCH_SIZE:512,loadGeneration:0,placementLoading:false,placementNextTimer:null,
    renderLoadStatus:()=>{},renderChips:()=>{},renderMain:()=>{},dbg:()=>{},
    activeTab:'overview',gn:(obj,key)=>obj?.[key]??null};
  mountDetails(context,detail);
  await context.startMatchDetails();
  assert.equal(requested.length,600);
  assert.equal(new Set(requested).size,600);
  assert.deepEqual(players.map(p=>[p.detailCoverage.found,p.detailCoverage.total]),[[600,600],[600,600]]);
});

test('filtered projected details use 256-ID batches and scoring-only placement uses 64-ID batches',()=>{
  assert.match(html,/DAMAGE_BATCH_SIZE=256,DAMAGE_WORKERS=2,STAGE_MATCH_LIMIT=25,PLACEMENT_BATCH_SIZE=64,PLACEMENT_WORKERS=2/);
  assert.match(html,/extra_player_columns:DETAIL_TIMELINE_FIELDS\.map/);
});

function setup(total){
  const calls=[],pending=[],timers=[],ids=Array.from({length:total},(_,i)=>String(i+1));
  const ranks=new Map(),failures=new Set();
  let renders=0;
  const context={placementLoading:false,placementTargets:ids,placementRanks:ranks,
    placementFailures:failures,placementRun:0,PLACEMENT_BATCH_SIZE:512,PLACEMENT_WORKERS:2,
    PLACEMENT_METADATA_OPTIONS:{},placementProgress:{done:0,total:0},
    placementFailureAttempts:0,PLACEMENT_MAX_FAILURE_ATTEMPTS:3,
    placementBackoffMs:15000,placementRetryDelay:0,placementRetryTimer:null,
    placementNextTimer:null,placementStoppedReason:'',placementUnsaved:0,
    heroMeta:{},activeTab:'overview',window:{BreadlockPlacement:true},
    BreadlockPlacement:{fromBulkMetadata:row=>({...row,players:Array.from({length:12},(_,i)=>({heroId:i+1,team:i<6?0:1}))}),scoreMatch:()=>Array.from({length:12},(_,i)=>({heroId:i+1,rank:i+1}))},
    BreadlockData:{metadata(batch){calls.push([...batch]);return new Promise((resolve,reject)=>pending.push({resolve,reject,batch}));}},
    renderMain:()=>{renders++;},renderPlacementStatus:()=>{},flushPlacementRanks:()=>{context.placementUnsaved=0;},
    rememberMatchBreakdown:()=>{},applyBulkMatchDetails:()=>{},startMatchDetails:()=>{},dbg:()=>{},
    setTimeout:(fn,ms)=>{timers.push({fn,ms});return timers.length;}
  };
  vm.createContext(context);vm.runInContext(source,context);
  return {context,calls,pending,timers,ranks,failures,get renders(){return renders;}};
}

test('two placement batches overlap and continue as soon as a slot frees',async()=>{
  const x=setup(512*4);
  const run=x.context.calculatePlacements();
  await tick();
  assert.deepEqual(x.calls.map(c=>c.length),[512,512]);
  x.pending[0].resolve(x.pending[0].batch.map(match_id=>({match_id})));
  await tick();
  assert.deepEqual(x.calls.map(c=>c.length),[512,512,512]);
  assert.equal(x.ranks.size,512);
  assert.equal(x.context.placementProgress.done,512);
  x.pending[1].resolve(x.pending[1].batch.map(match_id=>({match_id})));
  await tick();
  assert.deepEqual(x.calls.map(c=>c.length),[512,512,512,512]);
  for(const p of x.pending.slice(2))p.resolve(p.batch.map(match_id=>({match_id})));
  await run;
  assert.equal(x.ranks.size,2048);
  assert.equal(x.context.placementProgress.done,2048);
  assert.equal(x.context.placementLoading,false);
  assert.ok(x.renders>=4);
});

test('rate limit pauses new batches and leaves failures eligible for retry',async()=>{
  const x=setup(512*4);
  const run=x.context.calculatePlacements();
  await tick();
  x.pending[0].reject(Object.assign(new Error('429'),{status:429,retryMs:4000}));
  await tick();
  x.pending[1].resolve(x.pending[1].batch.map(match_id=>({match_id})));
  await run;
  assert.equal(x.calls.length,2);
  assert.equal(x.ranks.size,512);
  assert.equal(x.failures.size,0);
  assert.equal(x.context.placementLoading,false);
  assert.equal(x.timers.length,1);
  assert.equal(x.timers[0].ms,15000);
});

test('a rejected oversized batch is split without dropping or duplicating matches',async()=>{
  const x=setup(1024);
  const run=x.context.calculatePlacements();
  await tick();
  x.pending[0].reject(Object.assign(new Error('URL too long'),{status:414}));
  await tick();
  assert.deepEqual(x.calls.map(c=>c.length),[512,512,256]);
  x.pending[2].resolve(x.pending[2].batch.map(match_id=>({match_id})));
  await tick();
  assert.deepEqual(x.calls.map(c=>c.length),[512,512,256,256]);
  x.pending[3].resolve(x.pending[3].batch.map(match_id=>({match_id})));
  x.pending[1].resolve(x.pending[1].batch.map(match_id=>({match_id})));
  await run;
  assert.equal(x.ranks.size,1024);
  assert.equal(x.failures.size,0);
  assert.equal(x.context.placementProgress.done,1024);
});

test('a transient oversized placement batch splits before retrying all matches',async()=>{
  const x=setup(128);
  x.context.PLACEMENT_BATCH_SIZE=64;
  const run=x.context.calculatePlacements();
  await tick();
  x.pending[0].reject(new TypeError('Failed to fetch'));
  await tick();
  assert.deepEqual(x.calls.map(c=>c.length),[64,64,32]);
  x.pending[1].resolve(x.pending[1].batch.map(match_id=>({match_id})));
  x.pending[2].resolve(x.pending[2].batch.map(match_id=>({match_id})));
  await tick();
  assert.deepEqual(x.calls.map(c=>c.length),[64,64,32,32]);
  x.pending[3].resolve(x.pending[3].batch.map(match_id=>({match_id})));
  await run;
  assert.equal(x.ranks.size,128);
  assert.equal(x.failures.size,0);
});

test('selection changes ignore old responses and stop launching work',async()=>{
  const x=setup(512*3);
  const run=x.context.calculatePlacements();
  await tick();
  x.context.placementRun++;
  for(const p of x.pending)p.resolve(p.batch.map(match_id=>({match_id})));
  await run;
  assert.equal(x.calls.length,2);
  assert.equal(x.ranks.size,0);
});
