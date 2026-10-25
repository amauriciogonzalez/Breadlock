const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function rankAccount('), html.indexOf('async function addPlayer('));
const requests = [];
const context = {
  playerRanks:new Map(), rankPending:new Set(), rankAssets:[], rankAssetsPromise:null,
  matchAvgBadges:new Map(), matchAvgPending:new Set(), MATCHES_PAGE_SIZE:20,
  loadGeneration:0,activeTab:'overview',players:[], renders:0,
  renderMain(){this.renders++;}, dbg(){},
  visibleMatches:p=>p.matches, matchPageFor:()=>0,
  BreadlockData:{metadata:async(ids,options)=>{
    requests.push({ids,options});return [{match_id:'1',average_badge:43},{match_id:'3',average_badge:null}];
  }},
  chemText: x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
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

test('matches use historical lobby averages, not the current player rank',async()=>{
  context.activeTab='matches';
  context.players=[{id:'123',matches:[{match_id:1,match_mode:4},{match_id:2,match_mode:1},{match_id:3,match_mode:4}]}];
  await context.refreshMatchAvgBadges();
  const calls=requests.filter(p=>typeof p==='object');
  assert.equal(calls.length,1);
  assert.deepEqual([...calls[0].ids],['1','3']);
  assert.equal(calls[0].options.include_info,'true');
  assert.equal(calls[0].options.include_player_info,'false');
  assert.match(context.matchAvgBadgeHtml({match_id:1,match_mode:4}),/Mystic|Rank 4/);
  assert.match(context.matchAvgBadgeHtml({match_id:1,match_mode:4}),/Average lobby rank when this match was played/);
  assert.equal(context.matchAvgBadgeHtml({match_id:2,match_mode:1}),'—');
  assert.match(context.matchAvgBadgeHtml({match_id:3,match_mode:4}),/unavailable/);
  await context.refreshMatchAvgBadges();
  assert.equal(requests.filter(p=>typeof p==='object').length,1);
});
