const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function matchTimelineHtml('), html.indexOf('async function refreshTeamShare('));
const model = require('../backend/statlocker_placement_core.js');
const context = {
  matchBreakdowns: new Map(), matchBreakdownErrors: new Map(), matchBreakdownPending: new Set(),
  steamNames: new Map(), matchNamesPending: new Set(), matchNamesErrors: new Map(),
  BreadlockPlacement: model, heroMeta: {}, openMatchIds: new Set(), matchTimelineMetrics: new Map(),
  MATCH_TIMELINE_METRICS: [['player_damage','Hero damage'],['kills','Kills'],['deaths','Deaths'],['net_worth','Souls'],['boss_damage','Objective damage'],['assists','Assists'],['creep_kills','Creep kills'],['teammate_healing','Teammate healing'],['self_healing','Self healing'],['player_damage_taken','Damage taken']],
  placementFinalStats: p => p.final_stats || p.stats?.at(-1) || null,
  chemText: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  f1: n => Number(n).toFixed(1), fk: n => String(n),
  soulsK: n => n == null ? '—' : (n / 1000).toFixed(1) + 'K',
  placementOrdinal: n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'),
  gn: (obj, ...keys) => { for (const key of keys) if (obj?.[key] != null && Number.isFinite(+obj[key])) return +obj[key]; return null; },
  heroImage: () => 'icon', indHeroIcon: id => `<span class="hico">${id==='all'?'★':`<img src="${context.heroMeta[id]?.images?.icon_image_small_webp||'fallback'}" alt="">`}</span>`,
  visibleMatches: p => p.matches, gf: (obj, key) => Number(obj?.[key] || 0),
  matchMetric: (m,key) => m._detail?.final_stats?.[key] ?? null,
  isWin: () => true, matchDate: () => 'Today', placementForMatch: () => 1,
  prestigeForMatch: () => '-',
  players: [], matchPages: new Map(), MATCHES_PAGE_SIZE: 20,
  matchHistoryFilters:{hero:'all',result:'all',patch:'all'}, matchPatchDays:null,matchPatchPending:false,matchPatchError:'',
  activeTab:'matches',apiFetch:async()=>[],renderMain:()=>{},
  matchAvgBadgeHtml: m => `<span class="api-rank">Avg ${m.match_id}</span>`,
  matchPlayerBadgeHtml: m => m.ranked_display_badge ? `<span class="api-rank">Player ${m.ranked_display_badge}</span>` : '—',
  matchRankDeltaHtml: m => m.ranked_delta == null ? '—' : `<span class="match-rank-delta">${m.ranked_delta}</span>`,
};
vm.createContext(context);
vm.runInContext(source, context);

test('expanded roster shows all 12, scored component stacks and death deduction', () => {
  const players = Array.from({length: 12}, (_, i) => ({heroId: i + 1, hero: i === 0 ? '<Player>' : `Hero ${i + 1}`, team: i < 6 ? 0 : 1,
    'Early Game Damage': 100, 'Late Game Damage': 200, 'Early Game Assists': 1, 'Late Game Assists': 2,
    'Lane Creep Kills': 20, 'Damage Absorbed': 50, 'Other Player Total Healing': 10,
    'Teammate Barriers Provided': 5, 'Healing Prevented': 3, 'Death Score': 2,
    timeline: [], farmSouls: 100, bossDamage: 10, killEvents: [{time: 50}]}));
  const result = players.map((p, i) => ({heroId:p.heroId, hero:p.hero, rank:i + 1, score:1000-i,
    estimatedKillPoints:300, estimatedObjectivePoints:10, estimatedFarmBonus:0}));
  context.matchBreakdowns.set('42', {match:{players}, result, row:{players:players.map((p, i) => ({hero_id:p.heroId,account_id:p.heroId,kills:1,
    stats:[{deaths:2,assists:i===0?9:3,player_damage:i===0?900:300,net_worth:i===0?2000:1000,
      boss_damage:i===11?400:10,self_healing:i===11?250:20,teammate_healing:i===11?100:10,creep_kills:20}]}))}});
  result[4].score = 1700; // Team 0 leader appears ahead of the 1st-place hero.
  result[6].score = 3000; // Team 1 leader stays after every Team 0 player.
  const rendered = context.matchBreakdownHtml('42', 1);
  assert.equal((rendered.match(/class="l match-score"/g) || []).length, 12);
  assert.match(rendered, /&lt;Player&gt;/);
  assert.equal((rendered.match(/class="match-penalty-track" role="img"/g) || []).length, 12);
  assert.match(rendered, /aria-label="Death penalty: 270\.0 points, subtracted from positive points"/);
  assert.match(rendered, /class="match-penalty-head"><span>Deaths ◀<\/span><span>−270\.0 pts<\/span>/);
  assert.match(rendered, /class="match-penalty-fill" style="width:[\d.]+%" title="Deaths: −270\.0 points"/);
  assert.doesNotMatch(rendered, /<small>−270\.0 death pts<\/small>/);
  assert.match(rendered, /Hero damage: \+23\.0 points/);
  assert.match(rendered, /match-selected/);
  assert.doesNotMatch(rendered, /Experimental 1–12 estimate|Hover for point values/);
  assert.match(rendered, /class="match-username" title="Username unavailable">Username unavailable<\/span>/);
  assert.match(rendered, /<th class="l">Steam username · hero icon<\/th><th class="l">Estimated score breakdown<\/th><th class="r">K<\/th>/);
  assert.match(rendered, /<th class="r">A<\/th><th class="r" title="\(Kills \+ assists\) \/ deaths; zero deaths use 1">KDA<\/th>/);
  assert.match(rendered, /<th class="r" title="Hero damage">DMG<\/th><th class="r">Souls<\/th><th class="r" title="Boss\/structure damage">OBJ<\/th><th class="r" title="Self healing \+ ally healing">HEAL<\/th>/);
  // Must outrank the generic .st td.r text color, not just add a class to the cells.
  assert.match(html, /\.st\.match-roster td\.r\.match-high\{color:var\(--acc3\);font-weight:800\}/);
  assert.doesNotMatch(rendered, /<th class="r">(?:Creeps|Denies|Lvl|Dmg taken|Boss dmg|Ally heal)<\/th>/);
  const rows = [...rendered.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(m => m[1]).filter(row => row.includes('class="match-username"'));
  assert.equal(rows.length, 12);
  assert.match(rows[0], /<td class="r match-high" title="Match high \(ties included\)">1<\/td>/); // tied kills
  assert.match(rows[1], /<td class="r match-high" title="Match high \(ties included\)">1<\/td>/);
  assert.match(rows.find(row => row.includes('&lt;Player&gt;')), /<td class="r match-high" title="Match high \(ties included\)">1<\/td><td class="r match-high" title="Match low \(ties included\)">2<\/td><td class="r match-high" title="Match high \(ties included\)">9<\/td><td class="r match-high" title="Match high \(ties included\)">5\.0<\/td>\s*<td class="r match-high" title="Match high \(ties included\)">900<\/td><td class="r match-high" title="Match high \(ties included\)">2000<\/td>/);
  assert.match(rows.find(row => row.includes('Hero 12')), /<td class="r match-high" title="Match high \(ties included\)">400<\/td><td class="r match-high" title="Match high \(ties included\)">350<\/td>/);
  assert.equal((rendered.match(/<th class="l">Estimated score breakdown<\/th>/g) || []).length, 1);
  assert.doesNotMatch(rendered, /Team [01] ·|<th class="l">Team<\/th>|ID 1/);
  assert.match(rendered, /<tbody class="match-team-group match-team-0"[^>]*>/);
  assert.match(rendered, /<tbody class="match-team-group match-team-1"[^>]*>/);
  assert.equal((rendered.match(/class="match-username"/g) || []).length, 12);
  assert.ok(rendered.indexOf('Hero 5') < rendered.indexOf('&lt;Player&gt;'));
  assert.ok(rendered.indexOf('&lt;Player&gt;') < rendered.indexOf('Hero 7'));
  assert.match(rendered, /Refresh missing Steam usernames/);
  assert.doesNotMatch(rendered, /Show stat timeline|match-timeline-toggle/);
  assert.match(context.matchBreakdownHtml('42', 1, '1'), /value="player_damage" selected/);
  assert.match(context.matchBreakdownHtml('42', 1, '1'), /value="kills">Kills<\/option>/);
  assert.match(context.matchBreakdownHtml('42', 1, '1'), /value="deaths">Deaths<\/option>/);
  assert.match(context.matchBreakdownHtml('42', 1, '1'), /<canvas data-timeline-id="42" data-timeline-player="1" data-timeline-hero="1"/);
  context.matchTimelineMetrics.set(JSON.stringify(['1','42']), 'kills');
  assert.match(context.matchBreakdownHtml('42', 1, '1'), /value="kills" selected/);
  context.steamNames.set('1', '<Steam & Name>');
  assert.match(context.matchBreakdownHtml('42', 1), /class="match-username" title="&lt;Steam &amp; Name&gt;">&lt;Steam &amp; Name&gt;<\/span>/);
  context.steamNames.clear();
  const rawPlayers=context.matchBreakdowns.get('42').row.players;
  rawPlayers[0].stats[0].deaths=0;
  assert.match(context.matchBreakdownHtml('42', 1), /<td class="r match-high" title="Match low \(ties included\)">0<\/td><td class="r match-high" title="Match high \(ties included\)">9<\/td><td class="r match-high" title="Match high \(ties included\)">10\.0<\/td>/);
  rawPlayers[1].kills=null;
  const missingRow=[...context.matchBreakdownHtml('42', 1).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)]
    .find(([,row])=>row.includes('title="Hero 2"'))?.[1]||'';
  assert.match(missingRow, /<td class="r">—<\/td><td class="r">2<\/td><td class="r">3<\/td><td class="r">—<\/td>/);
  players[0]['Death Score'] = 100;
  const heavyPenalty = context.matchBreakdownHtml('42', 1);
  assert.match(heavyPenalty, /class="match-penalty-fill" style="width:100%" title="Deaths: −13500\.0 points"/);
  assert.ok([...heavyPenalty.matchAll(/(?:match-penalty-fill|match-score-segment)[^>]*style="width:([\d.]+)%/g)]
    .every(([,width]) => +width <= 100));
  assert.doesNotMatch(rendered, /NaN|undefined/);
});

test('timeline charts use real match timestamps, omit missing samples and isolate shared matches', () => {
  const chartSource = html.slice(html.indexOf('function mountMatchTimelines('), html.indexOf('function mountCharts('));
  const canvases = ['1','2','3','4'].map(player => ({dataset:{timelineId:'42',timelinePlayer:player,timelineHero:'1'},parentElement:{innerHTML:''}}));
  const created = [];
  const graphContext = {
    document:{querySelectorAll:()=>canvases},matchBreakdowns:new Map([['42',{result:[{heroId:1,rank:1},{heroId:2,rank:7}],match:{duration:120,players:[
      {heroId:1,team:0,killEvents:[{time:35},{time:90}]},{heroId:2,team:1,killEvents:[]}
    ]},row:{players:[
      {hero_id:1,team:'Team0',account_id:1,stats_time_stamp_s:[0,60,120],stats_net_worth:[0,300,null],stats_player_damage:[0,120,350],stats_deaths:[0,1,2]},
      {hero_id:2,team:'Team1',account_id:2,stats:[{time_stamp_s:0,net_worth:0},{time_stamp_s:90,net_worth:400}]}
    ]}}]]),matchTimelineMetrics:new Map([[JSON.stringify(['1','42']),'net_worth'],[JSON.stringify(['2','42']),'kills'],[JSON.stringify(['4','42']),'deaths']]),matchTimelineIncluded:new Map(),
    matchOpenKey:(p,id)=>JSON.stringify([String(p),String(id)]),steamNames:new Map([['1','<Username>']]),heroMeta:{2:{name:'Hero 2'}},
    charts:{},Chart:class{constructor(canvas,config){created.push({canvas,config})}},
    TICK:'#aaa',GRID:'#333',fk:String,dbg:()=>{},MATCH_TIMELINE_METRICS:context.MATCH_TIMELINE_METRICS
  };
  vm.createContext(graphContext);vm.runInContext(chartSource,graphContext);
  graphContext.mountMatchTimelines();
  assert.equal(created.length,4);
  assert.equal(created[0].config.data.datasets.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].config.data.datasets[0].data)),[{x:0,y:0},{x:1,y:300}]);
  assert.deepEqual(JSON.parse(JSON.stringify(created[0].config.data.datasets[1].data)),[{x:0,y:0},{x:1.5,y:400}]);
  assert.equal(created[0].config.data.datasets[0].label,'<Username>');
  assert.equal(created[0].config.data.datasets[0].borderWidth,3);
  assert.equal(created[1].config.data.datasets.length,2);
  assert.deepEqual(JSON.parse(JSON.stringify(created[1].config.data.datasets[0].data)),
    [{x:0,y:0},{x:35/60,y:1},{x:1.5,y:2},{x:2,y:2}]);
  assert.deepEqual(JSON.parse(JSON.stringify(created[1].config.data.datasets[1].data)),[{x:0,y:0},{x:2,y:0}]);
  assert.equal(created[1].config.data.datasets[0].stepped,'after');
  assert.equal(created[1].config.options.scales.y.title.text,'Kills');
  assert.equal(created[2].config.options.scales.y.title.text,'Hero damage');
  assert.deepEqual(JSON.parse(JSON.stringify(created[2].config.data.datasets[0].data)),
    [{x:0,y:0},{x:1,y:120},{x:2,y:350}]);
  assert.equal(created[3].config.options.scales.y.title.text,'Deaths');
  assert.deepEqual(JSON.parse(JSON.stringify(created[3].config.data.datasets[0].data)),
    [{x:0,y:0},{x:1,y:1},{x:2,y:2}]);
  assert.equal(created[3].config.data.datasets.length,1); // Missing death samples are not treated as zero.
  assert.equal(Object.keys(graphContext.charts).length,4);
});

test('timeline legend follows team/placement order and first click solos, later clicks include', () => {
  const chartSource = html.slice(html.indexOf('function mountMatchTimelines('), html.indexOf('function mountCharts('));
  const key=JSON.stringify(['alice','42']),created=[];
  const graphContext={
    document:{querySelectorAll:()=>[{dataset:{timelineId:'42',timelinePlayer:'alice',timelineHero:'1'},parentElement:{innerHTML:''}}]},
    matchBreakdowns:new Map([['42',{result:[{heroId:1,rank:2},{heroId:2,rank:7},{heroId:3,rank:1}],
      match:{players:[{heroId:1,team:0},{heroId:2,team:1},{heroId:3,team:0}]},
      row:{players:[2,1,3].map(hero_id=>({hero_id,account_id:hero_id,stats_time_stamp_s:[0,60],stats_player_damage:[0,hero_id*100]}))}}]]),
    matchTimelineMetrics:new Map(),matchTimelineIncluded:new Map(),matchOpenKey:(p,id)=>JSON.stringify([String(p),String(id)]),
    steamNames:new Map(),heroMeta:{},charts:{},Chart:class{
      constructor(canvas,config){this.data=config.data;this.options=config.options;this.visibility=[];this.setDatasetVisibility=(i,on)=>{this.visibility[i]=on};this.update=()=>{};created.push(this)}
    },TICK:'#aaa',GRID:'#333',fk:String,dbg:()=>{},MATCH_TIMELINE_METRICS:context.MATCH_TIMELINE_METRICS
  };
  vm.createContext(graphContext);vm.runInContext(chartSource,graphContext);
  graphContext.mountMatchTimelines();
  const chart=created[0],click=index=>chart.options.plugins.legend.onClick(null,{datasetIndex:index},{chart});
  assert.deepEqual([...chart.data.datasets.map(d=>d.heroId)],['3','1','2']);
  assert.deepEqual([...chart.data.datasets.map(d=>d.hidden)],[false,false,false]);
  click(1); // First click solos hero 1, regardless of its index in the sorted legend.
  assert.deepEqual(chart.visibility,[false,true,false]);
  click(2);
  assert.deepEqual(chart.visibility,[false,true,true]);
  graphContext.mountMatchTimelines(); // Changing stat or rerendering keeps the inclusion set.
  assert.deepEqual([...created[1].data.datasets.map(d=>d.hidden)],[true,false,false]);
  click(1);
  assert.deepEqual(chart.visibility,[false,false,true]);
  assert.deepEqual([...graphContext.matchTimelineIncluded.get(key)],['2']);
  click(2); // Removing the last included player restores everyone.
  assert.equal(graphContext.matchTimelineIncluded.has(key),false);
  assert.deepEqual(chart.visibility,[true,true,true]);
  graphContext.mountMatchTimelines();
  assert.deepEqual([...created[2].data.datasets.map(d=>d.hidden)],[false,false,false]);
  click(0); // The next click solos again, as it does from the initial state.
  assert.deepEqual(chart.visibility,[true,false,false]);
});

test('match history filters apply hero, result, and major patch after shared scope', () => {
  const savedWin=context.isWin;
  context.isWin=m=>m.win;
  context.heroMeta={1:{name:'Alpha',images:{icon_image_small_webp:'https://example.com/alpha.webp'}},2:{name:'Bravo'}};
  context.matchPatchDays=[200,100];
  const a={id:'1',label:'Alice',color:'#fff',matches:[
    {match_id:1,hero_id:1,start_time:205,win:true},{match_id:2,hero_id:1,start_time:200,win:false},
    {match_id:3,hero_id:2,start_time:150,win:true},{match_id:4,hero_id:1,start_time:99,win:true}]};
  const b={id:'2',label:'Bob',color:'#fff',matches:[{match_id:5,hero_id:1,start_time:210,win:true}]};
  const controls=context.matchHistoryFiltersHtml([a,b]);
  assert.match(controls,/All heroes/);
  assert.match(controls,/Alpha/);
  assert.match(controls,/data-match-filter-hero="1"[^>]*><span class="hico"><img src="https:\/\/example.com\/alpha.webp"/);
  assert.match(controls,/All results/);
  assert.match(controls,/Before Jan 1, 1970/);
  assert.equal(context.matchPatchFor(a.matches[0]),'200');
  assert.equal(context.matchPatchFor(a.matches[1]),'200'); // Boundary is inclusive.
  assert.equal(context.matchPatchFor(a.matches[2]),'100');
  assert.equal(context.matchPatchFor(a.matches[3]),'before');
  Object.assign(context.matchHistoryFilters,{hero:'1',result:'win',patch:'200'});
  assert.deepEqual(context.matchHistoryMatches(a).map(m=>m.match_id),[1]);
  assert.deepEqual(context.matchHistoryMatches(b).map(m=>m.match_id),[5]);
  context.matchPages.set('1',1);
  const rendered=context.tabMatches([a,b]);
  assert.match(rendered,/Alice — 1 matches loaded/);
  assert.match(rendered,/Showing 1–1 of 1/);
  assert.equal((rendered.match(/class="match-toggle"/g)||[]).length,2);
  assert.match(rendered,/value="200" selected/);
  const limited=context.matchHistoryFiltersHtml([{...a,matches:[a.matches[2]]}]);
  assert.match(limited,/data-match-filter-hero="1" aria-current="true"/); // Active choice stays visible even outside this period.
  assert.match(limited,/value="200" selected/);
  context.matchHistoryFilters.patch='before';
  assert.deepEqual(context.matchHistoryMatches(a).map(m=>m.match_id),[4]);
  Object.assign(context.matchHistoryFilters,{hero:'all',result:'all',patch:'all'});
  context.matchPatchDays=null;context.heroMeta={};context.isWin=savedWin;
});

test('patch dates load once through the shared request path and retry on failure', async () => {
  let calls=0,renders=0;
  context.renderMain=()=>{renders++};
  context.apiFetch=async(path,options)=>{
    calls++;assert.equal(path,'/patches/big-days');assert.equal(options.priority,0);
    if(calls===1)throw Error('temporarily unavailable');
    return ['2026-09-29T20:25:11Z','2026-01-22T22:56:33Z'];
  };
  await context.loadMatchPatches();
  assert.match(context.matchPatchError,/temporarily unavailable/);
  assert.equal(context.matchPatchDays,null);
  assert.match(context.matchHistoryFiltersHtml([]),/Retry patches/);
  await context.loadMatchPatches(); // Failure isn't silently retried on every render.
  assert.equal(calls,1);
  context.matchPatchError='';
  await context.loadMatchPatches();
  assert.equal(calls,2);
  assert.equal(context.matchPatchDays.length,2);
  assert.ok(context.matchPatchDays[0]>context.matchPatchDays[1]);
  await context.loadMatchPatches();assert.equal(calls,2);
  assert.equal(renders,2);
  context.matchPatchDays=null;context.matchPatchError='';
});

test('matches paginate independently by player, with bounded rows and controls', () => {
  const a = {id:'1',label:'Alice',color:'#fff',matches:Array.from({length:43}, (_, i) => ({match_id:i + 1,hero_id:1}))};
  const b = {id:'2',label:'Bob',color:'#fff',matches:Array.from({length:6}, (_, i) => ({match_id:i === 0 ? 21 : i + 100,hero_id:2}))};
  context.matchPages.set('1', 1);
  const html = context.tabMatches([a,b]);
  assert.match(html, /Showing 21–40 of 43 · Page 2 of 3/);
  assert.match(html, /Showing 1–6 of 6 · Page 1 of 1/);
  assert.equal((html.match(/class="match-toggle"/g) || []).length, 26);
  assert.match(html, /data-match-id="21"/);
  assert.doesNotMatch(html, /data-match-id="1"(?:\s|>)/);
  context.matchPages.set('1', 100);
  assert.equal(context.matchPageFor(a,43), 2);
  assert.equal(context.matchPages.get('1'), 2);
});

test('match list puts result near the front and displays objective and both healing values', () => {
  const match={match_id:42,hero_id:1,game_mode:1,match_duration_s:1200,net_worth:12000,
    last_hits:40,denies:8,hero_level:20,
    _detail:{final_stats:{boss_damage:345,self_healing:123,teammate_healing:0}}};
  const rendered=context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches:[match]}]);
  const headings=[...rendered.matchAll(/<th class="[lr]"[^>]*>(.*?)<\/th>/g)].map(m=>m[1]);
  assert.deepEqual(headings.slice(0,7),['Hero','Result','Date / Time','YOUR RANK','RANK Δ','AVG RANK','Est. place']);
  assert.deepEqual(headings.slice(0,9),['Hero','Result','Date / Time','YOUR RANK','RANK Δ','AVG RANK','Est. place','Prestige','K']);
  assert.deepEqual(headings.slice(13,16),['Objective damage','Self healing','Teammate healing']);
  assert.ok(!headings.includes('Mode'));
  assert.ok(!headings.some(h=>['Last Hits','Denies','Lvl'].includes(h)));
  assert.match(rendered, /<td class="r">345<\/td>\s*<td class="r">123<\/td>\s*<td class="r">0<\/td>/);
  context.openMatchIds.add(JSON.stringify(['1','42']));
  assert.match(context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches:[match]}]), /<td colspan="19">/);
  context.openMatchIds.clear();
  delete match._detail;
  assert.match(context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches:[match]}]), /<td class="r">—<\/td>\s*<td class="r">—<\/td>\s*<td class="r">—<\/td>/);
});

test('match list omits mode but only fills rank columns for ranked matches', () => {
  const matches=[
    {match_id:1,hero_id:1,game_mode:1,match_mode:4,ranked_display_badge:43,ranked_delta:120},
    {match_id:2,hero_id:1,game_mode:1,match_mode:1},
  ];
  const rendered=context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches}]);
  const ranks=[...rendered.matchAll(/<td class="l">(.*?)<\/td>\s*<td class="r">(.*?)<\/td>\s*<td class="l">(<span class="api-rank">Avg 1<\/span>|—)<\/td>/g)];
  assert.deepEqual(ranks.map(match=>[match[1],match[2],match[3]]),[['<span class="api-rank">Player 43</span>','<span class="match-rank-delta">120</span>','<span class="api-rank">Avg 1</span>'],['—','—','—']]);
  assert.doesNotMatch(rendered,/match-mode|<th class="l">Mode<\/th>/);
});

test('mobile match cards keep all stats and expanded roster available without horizontal tables', () => {
  const match={match_id:42,hero_id:1,match_duration_s:1200};
  context.openMatchIds.add(context.matchOpenKey('1',42));
  const rendered=context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches:[match]}]);
  assert.match(rendered, /class="matches-scroll"[^]*?class="st matches-table"/);
  assert.match(rendered, /class="match-entry"[^]*?class="match-toggle"[^]*?class="match-hero-name"/);
  assert.match(rendered, /class="match-expanded" id="match-roster-1-42"/);
  assert.match(html, /\.matches-table \.match-entry>td:nth-child\(4\)::before\{content:'YOUR RANK'\}/);
  assert.match(html, /\.matches-table \.match-entry>td:nth-child\(5\)::before\{content:'RANK Δ'\}/);
  assert.match(html, /\.matches-table \.match-entry>td:nth-child\(19\)::before\{content:'Duration'\}/);
  assert.match(html, /\.match-roster tbody tr>td:nth-child\(11\)::before\{content:'Healing'\}/);
  assert.match(html, /\.matches-scroll,\.match-roster-scroll\{overflow:visible\}/);
  context.openMatchIds.clear();
});

test('opening a shared match affects only that player row and uses distinct detail IDs', () => {
  const a = {id:'1',label:'Alice',color:'#fff',matches:[{match_id:42,hero_id:1}]};
  const b = {id:'2',label:'Bob',color:'#fff',matches:[{match_id:42,hero_id:2}]};
  context.matchPages.clear();
  context.openMatchIds.clear();
  context.openMatchIds.add(context.matchOpenKey(a.id,42));
  const html = context.tabMatches([a,b]);
  assert.equal((html.match(/class="match-expanded"/g) || []).length, 1);
  assert.match(html, /id="match-roster-1-42"/);
  assert.match(html, /data-match-player="2" aria-expanded="false" aria-controls="match-roster-2-42"/);
  context.openMatchIds.add(context.matchOpenKey(b.id,42));
  const both = context.tabMatches([a,b]);
  assert.equal((both.match(/class="match-expanded"/g) || []).length, 2);
  assert.match(both, /id="match-roster-2-42"/);
  context.openMatchIds.clear();
});

test('Steam names load in a batch from account IDs and can be refreshed', async () => {
  const calls = [], context = {
    matchBreakdowns:new Map([['55',{row:{players:[{account_id:123},{account_id:456}]}}]]),
    steamNames:new Map(),matchNamesLoaded:new Set(),matchNamesPending:new Set(),matchNamesErrors:new Map(),
    loadGeneration:0,activeTab:'matches',renderMain:()=>{},URLSearchParams,
    apiFetch:async (path,options)=>{calls.push({path,options});return [{account_id:123,personaname:'<Sam>'}];}
  };
  vm.createContext(context);
  vm.runInContext(html.slice(html.indexOf('async function loadMatchNames('),html.indexOf('function matchBreakdownHtml(')),context);
  await context.loadMatchNames('55');
  assert.equal(context.steamNames.get('123'), '<Sam>');
  assert.equal(calls.length,1);
  assert.match(calls[0].path,/account_ids=123%2C456/);
  await context.loadMatchNames('55');
  assert.equal(calls.length,1);
  await context.loadMatchNames('55',true);
  assert.equal(calls.length,2);
  assert.match(calls[1].path,/refresh=true/);
  assert.match(calls[1].path,/account_ids=456/);
});

test('open match shows missing metadata status and retry', () => {
  context.matchBreakdownErrors.set('43', 'Unavailable <now>');
  assert.match(context.matchBreakdownHtml('43', 1), /Unavailable &lt;now&gt;.*Retry/);
});
