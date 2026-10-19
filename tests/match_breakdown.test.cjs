const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function matchBreakdownHtml('), html.indexOf('async function refreshTeamShare('));
const model = require('../backend/statlocker_placement_core.js');
const context = {
  matchBreakdowns: new Map(), matchBreakdownErrors: new Map(), matchBreakdownPending: new Set(),
  steamNames: new Map(), matchNamesPending: new Set(), matchNamesErrors: new Map(),
  BreadlockPlacement: model, heroMeta: {}, openMatchIds: new Set(),
  placementFinalStats: p => p.final_stats || p.stats?.at(-1) || null,
  chemText: value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  f1: n => Number(n).toFixed(1), fk: n => String(n),
  placementOrdinal: n => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th'),
  gn: (obj, ...keys) => { for (const key of keys) if (obj?.[key] != null && Number.isFinite(+obj[key])) return +obj[key]; return null; },
  heroImage: () => 'icon', visibleMatches: p => p.matches, gf: (obj, key) => Number(obj?.[key] || 0),
  matchMetric: (m,key) => m._detail?.final_stats?.[key] ?? null,
  isWin: () => true, matchDate: () => 'Today', placementForMatch: () => 1,
  players: [], matchPages: new Map(), MATCHES_PAGE_SIZE: 20,
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
  assert.deepEqual(headings.slice(0,5),['Hero','Result','Date / Time','Mode','Est. place']);
  assert.deepEqual(headings.slice(10,13),['Objective damage','Self healing','Teammate healing']);
  assert.ok(!headings.some(h=>['Last Hits','Denies','Lvl'].includes(h)));
  assert.match(rendered, /<td class="r">345<\/td>\s*<td class="r">123<\/td>\s*<td class="r">0<\/td>/);
  context.openMatchIds.add(JSON.stringify(['1','42']));
  assert.match(context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches:[match]}]), /<td colspan="16">/);
  context.openMatchIds.clear();
  delete match._detail;
  assert.match(context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches:[match]}]), /<td class="r">—<\/td>\s*<td class="r">—<\/td>\s*<td class="r">—<\/td>/);
});

test('mobile match cards keep all stats and expanded roster available without horizontal tables', () => {
  const match={match_id:42,hero_id:1,match_duration_s:1200};
  context.openMatchIds.add(context.matchOpenKey('1',42));
  const rendered=context.tabMatches([{id:'1',label:'Alice',color:'#fff',matches:[match]}]);
  assert.match(rendered, /class="matches-scroll"[^]*?class="st matches-table"/);
  assert.match(rendered, /class="match-entry"[^]*?class="match-toggle"[^]*?class="match-hero-name"/);
  assert.match(rendered, /class="match-expanded" id="match-roster-1-42"/);
  assert.match(html, /\.matches-table \.match-entry>td:nth-child\(16\)::before\{content:'Duration'\}/);
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
