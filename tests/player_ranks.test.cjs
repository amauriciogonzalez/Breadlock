const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function rankAccount('), html.indexOf('async function addPlayer('));
const requests = [];
const context = {
  playerRanks:new Map(), rankPending:new Set(), rankAssets:[], rankAssetsPromise:null,
  matchAvgBadges:new Map(), matchAvgPending:new Set(), normalMatchRanks:new Map(), normalMatchRankPending:new Set(), MATCHES_PAGE_SIZE:20,
  loadGeneration:0,activeTab:'overview',players:[],matchHistoryFilters:{rank:'all'},renders:0,
  renderMain(){this.renders++;}, dbg(){},
  visibleMatches:p=>p.matches, matchHistoryBaseMatches:p=>p.matches, matchPageFor:()=>0,
  BreadlockData:{metadata:async(ids,options)=>{
    requests.push({ids,options});
    if(options.include_player_info==='true')return [{match_id:'2',players:Array.from({length:12},(_,i)=>({account_id:1000+i}))}];
    return [{match_id:'1',average_badge:43},{match_id:'3',average_badge:null}];
  }},
  chemText: x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  gn: (obj,key) => obj?.[key] == null || obj[key] === '' ? null : Number(obj[key]),
  apiFetch: async path => {
    requests.push(path);
    if(path==='/assets/ranks')return [{tier:1,name:'Initiate',images:{small:'https://example.com/tier.png',large_subrank2:'https://example.com/division.png'}}];
    return [{account_id:123,rank:1,subrank:2},{account_id:456,rank:0,subrank:0}];
  }, URLSearchParams
};
vm.createContext(context);
vm.runInContext(source,context);

test('batches tracked accounts, skips protected or invalid IDs, and shows current rank symbols',async()=>{
  assert.equal(context.rankAccount({id:'7656119',matches:[{account_id:123}]}),'123');
  await context.loadRanks(['123','123','456','0','not-an-id','789']);
  assert.equal(requests.filter(p=>p.startsWith('/players/rank?')).length,1);
  assert.match(requests[0],/123%2C456%2C789/);
  assert.equal(requests.filter(p=>p==='/assets/ranks').length,1);
  assert.match(context.rankBadgeHtml('123'),/division\.png/);
  assert.match(context.rankBadgeHtml('123'),/Initiate II/);
  assert.match(context.rankBadgeHtml('456'),/Unranked/);
  assert.match(context.rankBadgeHtml('789'),/Current rank unavailable/);
  await context.loadRanks(['123','456']);
  assert.equal(requests.filter(p=>typeof p==='string'&&p.startsWith('/players/rank?')).length,1);
});

test('leaderboard renders a dedicated current-rank column in both layouts',()=>{
  assert.match(html, /<th class="l" title="Rank from the player's latest ranked match">Current rank<\/th>/);
  assert.match(html, /<\/button><\/td><td class="rank-api-badge" data-label="Current rank">\$\{rankBadgeHtml\(rankAccount\(r\.p\)\)\}/);
  assert.match(html, /\.rank-table \.rank-entry>\.rank-api-badge\{grid-column:2;grid-row:2/);
});

test('matches show historical badges and the unranked symbol when no badge was reported',()=>{
  context.rankAssets=[{tier:0,name:'Obscurus',images:{small:'https://example.com/unranked.png'}},
    {tier:4,name:'Mystic',images:{large_subrank3:'https://example.com/mystic.png'}}];
  const badge=context.matchPlayerBadgeHtml({match_mode:4,ranked_display_badge:43});
  assert.match(badge,/Mystic III/);
  assert.match(badge,/mystic\.png/);
  assert.match(badge,/Your displayed rank after this match/);
  for(const value of [0,null,undefined,'']){
    const unranked=context.matchPlayerBadgeHtml({match_mode:4,ranked_display_badge:value});
    assert.match(unranked,/Unranked/);
    assert.match(unranked,/unranked\.png/);
    assert.match(unranked,/No displayed rank reported/);
  }
  for(const value of [40,47,120,'bad'])
    assert.equal(context.matchPlayerBadgeHtml({match_mode:4,ranked_display_badge:value}),'—');
  assert.equal(context.matchPlayerBadgeHtml({match_mode:1,ranked_display_badge:43}),'—');
  assert.equal(context.matchPlayerBadgeHtml({match_mode:1}),'—');
  assert.doesNotMatch(context.matchPlayerBadgeHtml({match_mode:4}),/Current rank/);
});

test('ranked progress uses per-match reported delta, never claims hidden MMR',()=>{
  assert.match(context.matchRankDeltaHtml({match_mode:4,ranked_delta:120}),/class="match-rank-delta positive"[^>]*>\+120<\/span>/);
  assert.match(context.matchRankDeltaHtml({match_mode:4,ranked_delta:-80}),/class="match-rank-delta negative"[^>]*>-80<\/span>/);
  assert.match(context.matchRankDeltaHtml({match_mode:4,ranked_delta:0}),/>0<\/span>/);
  assert.match(context.matchRankDeltaHtml({match_mode:4,ranked_delta:120}),/not hidden MMR/);
  for(const delta of [null,undefined,'',1.5,'invalid'])
    assert.equal(context.matchRankDeltaHtml({match_mode:4,ranked_delta:delta}),'—');
  assert.equal(context.matchRankDeltaHtml({match_mode:1,ranked_delta:120}),'—');
});

test('matches use historical lobby averages, not the current player rank',async()=>{
  context.activeTab='matches';
  context.players=[{id:'123',matches:[{match_id:1,match_mode:4},{match_id:2,match_mode:1},{match_id:3,match_mode:4}]}];
  await context.refreshMatchAvgBadges();
  const calls=requests.filter(p=>typeof p==='object'&&p.options.include_player_info==='false');
  assert.equal(calls.length,1);
  assert.deepEqual([...calls[0].ids],['1','3']);
  assert.equal(calls[0].options.include_info,'true');
  assert.equal(calls[0].options.include_player_info,'false');
  assert.match(context.matchAvgBadgeHtml({match_id:1,match_mode:4}),/Mystic|Rank 4/);
  assert.match(context.matchAvgBadgeHtml({match_id:1,match_mode:4}),/Average lobby rank when this match was played/);
  assert.match(context.matchAvgBadgeHtml({match_id:2,match_mode:1}),/Loading current ranks|No current displayed ranks/);
  assert.match(context.matchAvgBadgeHtml({match_id:3,match_mode:4}),/unavailable/);
  await context.refreshMatchAvgBadges();
  assert.equal(requests.filter(p=>typeof p==='object'&&p.options.include_player_info==='false').length,1);
});

test('normal matches show a clearly labeled current-roster estimate with rank coverage',async()=>{
  context.players=[{id:'123',matches:[{match_id:2,match_mode:1}]}];
  await context.refreshNormalMatchRanks();
  const calls=requests.filter(p=>typeof p==='object'&&p.options.include_player_info==='true');
  assert.equal(calls.at(-1).options.only_filtered_players,'false');
  assert.equal(calls.at(-1).options.include_info,'false');
  assert.deepEqual([...calls.at(-1).ids],['2']);
  assert.match(context.matchAvgBadgeHtml({match_id:2,match_mode:1}),/Current ranks unavailable for 12 match players/);
  assert.match(context.matchAvgBadgeHtml({match_id:2,match_mode:4}),/Historical lobby average rank unavailable/);
  context.normalMatchRanks.set('2',{badge:43,count:8,rosterSize:12});
  const estimate=context.matchAvgBadgeHtml({match_id:2,match_mode:1});
  assert.doesNotMatch(estimate,/≈/);
  assert.match(estimate,/Mystic III<\/span> <small>\(8\/12\)<\/small>/);
  assert.match(estimate,/not their ranks when this match was played/);
  assert.match(estimate,/Mystic III|Rank 4 III/);
});

test('avg-rank filtering loads all matching matches, not just the currently visible page',async()=>{
  context.matchHistoryFilters.rank='4';
  context.normalMatchRanks.clear();context.matchAvgBadges.clear();
  const normalIds=Array.from({length:23},(_,i)=>i+2).filter(id=>id!==3);
  context.players=[{id:'123',matches:[{match_id:1,match_mode:4},{match_id:3,match_mode:4},
    ...normalIds.map(match_id=>({match_id,match_mode:1}))]}];
  const before=requests.length;
  await context.refreshMatchAvgBadges();
  assert.deepEqual([...requests.slice(before).filter(x=>typeof x==='object'&&x.options.include_player_info==='false')[0].ids],['1','3']);
  assert.deepEqual([...requests.slice(before).filter(x=>typeof x==='object'&&x.options.include_player_info==='true')[0].ids],normalIds.map(String));
  context.players=[{id:'123',matches:[{match_id:2,match_mode:1}]}];
  context.matchHistoryFilters.rank='all';
});

test('normal lobby averages valid rank subdivisions and excludes unranked players',async()=>{
  context.normalMatchRanks.clear();
  const fetch=context.apiFetch;
  context.apiFetch=async path=>{
    if(!path.startsWith('/players/rank?'))return fetch(path);
    return Array.from({length:12},(_,i)=>({account_id:1000+i,rank:i>=10?0:i<5?1:2,
      subrank:i<5?6:1}));
  };
  try{
    await context.refreshNormalMatchRanks();
    const rank=context.normalMatchRanks.get('2');
    assert.equal(rank.count,10);
    assert.equal(rank.rosterSize,12);
    assert.equal(rank.badge,21); // 5 × Initiate VI + 5 × Seeker I rounds to Seeker I.
    assert.match(context.matchAvgBadgeHtml({match_id:2,match_mode:1}),/\(10\/12\)/);
    assert.match(context.rankBadgeHtml('1000'),/Initiate VI|Rank 1 VI/);
    assert.match(context.rankBadgeHtml('1010'),/Unranked/);
  }finally{context.apiFetch=fetch;}
});

test('all twelve explicitly unranked players show Unranked, not a missing average',async()=>{
  context.normalMatchRanks.clear();context.playerRanks.clear();
  const fetch=context.apiFetch;
  context.apiFetch=async path=>path.startsWith('/players/rank?')
    ?Array.from({length:12},(_,i)=>({account_id:1000+i,rank:0,subrank:0}))
    :fetch(path);
  try{
    await context.refreshNormalMatchRanks();
    assert.equal(context.normalMatchRanks.get('2').unrankedCount,12);
    const html=context.matchAvgBadgeHtml({match_id:2,match_mode:1});
    assert.match(html,/Unranked/);
    assert.match(html,/All match players currently unranked/);
    assert.match(html,/Unranked<\/span> <small>\(0\/12\)<\/small>/);
    assert.doesNotMatch(html,/—/);
  }finally{context.apiFetch=fetch;}
});

test('missing rank responses are not mistaken for unranked players',async()=>{
  context.normalMatchRanks.clear();context.playerRanks.clear();
  const fetch=context.apiFetch;
  context.apiFetch=async path=>path.startsWith('/players/rank?')
    ?[{account_id:1000,rank:0,subrank:0}]:fetch(path);
  try{
    await context.refreshNormalMatchRanks();
    assert.equal(context.normalMatchRanks.get('2').unrankedCount,1);
    assert.match(context.matchAvgBadgeHtml({match_id:2,match_mode:1}),/Current ranks unavailable for 11 match players/);
  }finally{context.apiFetch=fetch;}
});
