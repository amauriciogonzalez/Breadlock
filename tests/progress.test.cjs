const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('// ---- PROGRESS ----'), html.indexOf('// ---- CHARTS ----'));
const context = {
  gn: (m, key) => m[key] ?? null,
  ratio: (n, d) => n != null && d > 0 ? n / d : null,
  isWin: m => m.won,
  metrics: m => ({ dpm: m.dpm ?? null, boss: m.boss ?? null, creep: m.creep ?? null, allyHeal: m.allyHeal ?? null }),
  placementForMatch: m => m.place ?? null,
  chemText: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  IND_RANKS: ['Obscurus','Initiate','Seeker','Acolyte','Sentinel','Mystic','Ritualist','Emissary','Oracle','Phantom','Ascendant','Eternus'],
  rankAssets: [], TICK: '#8892aa', charts: {}, Image: class { set src(value) { this.url = value; } },
  visibleMatches: p => p.matches.filter(m => !p.cutoff || m.start_time >= p.cutoff),
};
vm.createContext(context);
vm.runInContext(source, context);
const stats = vm.runInContext('PROGRESS_STATS', context);
const series = (p, key) => Array.from(context.progressSeries(p, stats.find(s => s.key === key)));

test('Progress tab is between Individual and Matches and wired to chart mounting', () => {
  assert.match(html, /data-t="individual"[^\n]*Individual<\/button>\s*<button[^\n]*data-t="progress"[^\n]*Progress<\/button>\s*<button[^\n]*data-t="matches"/);
  assert.match(html, /activeTab==='progress'\)html\+=tabProgress\(good\)/);
  assert.match(html, /mk\('progress-'\+stat\.key,'scatter'/);
  assert.equal(vm.runInContext('progressWindow', context), 100);
  assert.equal(vm.runInContext('rankProgressWindow', context), 0);
  assert.match(context.tabProgress([{ matches: [] }]), /value="100" selected>100 matches/);
  assert.match(context.tabProgress([{ matches: [] }]), /id="rank-progress-window"[^]*?value="0" selected>No averaging/);
});

test('each player uses chronological, non-overlapping ten-match averages and a partial last block', () => {
  vm.runInContext('progressWindow=10', context);
  const p = { cutoff: 2, matches: [
    ...Array.from({ length: 23 }, (_, i) => ({ start_time: 24 - i, player_kills: 24 - i })),
    { start_time: 1, player_kills: 100 },
  ] };
  const points = series(p, 'kills');
  assert.deepEqual(points.map(v => v.x), [10, 20, 23]);
  assert.deepEqual(points.map(v => v.start), [1, 11, 21]);
  assert.deepEqual(points.map(v => v.y), [6.5, 16.5, 23]);
  assert.equal(context.tabProgress([p]).includes('progress-kills'), true);
  assert.match(html, /text:stat\.key==='rank'\?'Ranked matches played':'Matches played'/);
  assert.match(html, /Matches #\$\{items\[0\]\.raw\.start\}–\$\{items\[0\]\.parsed\.x\}/);
  assert.doesNotMatch(html.slice(html.indexOf("if(activeTab==='progress'){", html.indexOf('// ---- CHARTS ----')), html.indexOf("else if(activeTab==='combat'){", html.indexOf('// ---- CHARTS ----'))), /toLocaleDateString|toLocaleString/);
});

test('average block size can be changed or disabled for individual stats', () => {
  const p = { matches: Array.from({ length: 57 }, (_, i) => ({ start_time: i + 1, player_kills: i + 1 })) };
  assert.deepEqual(Array.from(vm.runInContext('PROGRESS_WINDOWS', context)), [0, 10, 25, 50, 100, 250]);
  vm.runInContext('progressWindow=25', context);
  assert.deepEqual(series(p, 'kills').map(v => [v.start, v.x, v.y]), [
    [1, 25, 13], [26, 50, 38], [51, 57, 54]
  ]);
  assert.match(context.tabProgress([p]), /value="25" selected>25 matches/);
  vm.runInContext('progressWindow=0', context);
  const unaveraged = series(p, 'kills');
  assert.equal(unaveraged.length, 57);
  assert.deepEqual([unaveraged[0].start, unaveraged[0].x, unaveraged[0].y], [1, 1, 1]);
  assert.deepEqual([unaveraged[56].start, unaveraged[56].x, unaveraged[56].y], [57, 57, 57]);
  assert.match(context.tabProgress([p]), /value="0" selected>No averaging/);
  assert.match(context.tabProgress([p]), /No averaging: each visible match has its own point/);
  assert.match(html, /progressWindow=Number\(e\.target\.value\);renderMain\(\)/);
  vm.runInContext('progressWindow=10', context);
});

test('one global player legend controls every Progress subplot and its axis data', () => {
  const a = { id: '1', label: 'Alice', color: '#123456', matches: [{ start_time: 1, player_kills: 1 }] };
  const b = { id: '2', label: 'Bob', color: '#654321', matches: [{ start_time: 1, player_kills: 2 }] };
  let legend = context.tabProgress([a, b]);
  assert.match(legend, /aria-label="Players shown in all Progress graphs"/);
  assert.match(legend, /data-progress-player="1" aria-pressed="true"/);
  assert.match(legend, /data-progress-player="2" aria-pressed="true"/);
  vm.runInContext("progressHiddenIds.add('2')", context);
  legend = context.tabProgress([a, b]);
  assert.match(legend, /data-progress-player="2" aria-pressed="false"/);
  assert.match(html, /visible=good\.filter\(p=>!progressHiddenIds\.has\(String\(p\.id\)\)\)/);
  assert.match(html, /players\.filter\(p=>!p\.loading&&!p\.error\)\.map\(p=>\(\{/);
  assert.match(html, /plugins:\{legend:\{display:true,labels:/);
  assert.match(html, /onClick:\(_,item\)=>\{/);
  assert.match(html, /hidden:progressHiddenIds\.has\(String\(p\.id\)\)\|\|progressLocalHidden\.get\(stat\.key\)\?\.has\(String\(p\.id\)\)\|\|false/);
  assert.match(html, /Show all globally/);
  vm.runInContext("progressHiddenIds.add('1')", context);
  assert.match(context.tabProgress([a, b]), /id="progress-kills"/);
  assert.match(html, /progressHiddenIds\.clear\(\);\s*el\.querySelectorAll/);
  vm.runInContext('progressHiddenIds.clear()', context);
});

test('legend toggles update the existing chart and fit axes without rebuilding the page', () => {
  const chart = {
    canvas: { id: 'progress-kills' },
    data: { datasets: [
      { playerId: '1', data: [{ x: 10, y: 2 }, { x: 20, y: 4 }] },
      { playerId: '2', data: [{ x: 10, y: 8 }, { x: 40, y: 12 }] },
    ] },
    options: { scales: { x: {}, y: {} } },
    visibility: [true, true], updates: 0,
    setDatasetVisibility(i, visible) { this.visibility[i] = visible; },
    isDatasetVisible(i) { return this.visibility[i]; },
    update() { this.updates++; },
  };
  vm.runInContext("progressHiddenIds.add('2')", context);
  context.syncProgressChart(chart);
  assert.deepEqual(chart.visibility, [true, false]);
  assert.deepEqual(chart.options.scales.x, { min: 10, max: 20 });
  assert.deepEqual(chart.options.scales.y, { min: 2, max: 4 });
  vm.runInContext("progressHiddenIds.clear();progressLocalHidden.set('kills',new Set(['1']))", context);
  context.syncProgressChart(chart);
  assert.deepEqual(chart.visibility, [false, true]);
  assert.deepEqual(chart.options.scales.x, { min: 10, max: 40 });
  assert.deepEqual(chart.options.scales.y, { min: 8, max: 12 });
  assert.equal(chart.updates, 2);
  assert.match(html, /syncProgressChart\(legend\.chart\)/);
  assert.doesNotMatch(html.slice(html.indexOf("if(activeTab==='progress'){"), html.indexOf("if(activeTab==='chemistry'){", html.indexOf("if(activeTab==='progress'){"))), /renderMain\(\);\s*\n\s*\[\.\.\.el\.querySelectorAll/);
  vm.runInContext('progressLocalHidden.clear()', context);
});

test('additional stats use complete KDA totals and exclude unavailable details and placements', () => {
  const keys = stats.map(s => s.key);
  for (const key of ['kda', 'objective', 'placement', 'creepDamage', 'denies', 'allyHeal']) {
    assert.ok(keys.includes(key), key);
    assert.ok(context.tabProgress([{ matches: [{ start_time: 1 }] }]).includes(stats.find(s => s.key === key).title));
  }
  vm.runInContext('progressWindow=10', context);
  const matches = [
    { start_time: 1, player_kills: 10, player_assists: 2, player_deaths: 0, match_duration_s: 600, boss: 100, place: 4, creep: 2000, denies: 3, allyHeal: 200 },
    { start_time: 2, player_kills: 0, player_assists: 2, player_deaths: 2, match_duration_s: 600, creep: 1000, denies: 1 },
  ];
  const p = { matches };
  assert.deepEqual(series(p, 'kda').map(v => v.y), [7]); // (10 + 2 + 0 + 2) / 2, not mean of per-match ratios
  assert.deepEqual(series(p, 'objective').map(v => v.y), [10]);
  assert.deepEqual(series(p, 'placement').map(v => v.y), [4]);
  assert.deepEqual(series(p, 'creepDamage').map(v => v.y), [1500]);
  assert.ok(!keys.includes('lastHits'));
  assert.deepEqual(series({ matches: [{ start_time: 1 }] }, 'creepDamage').map(v => v.y), [null]);
  assert.deepEqual(series(p, 'denies').map(v => v.y), [2]);
  assert.deepEqual(series(p, 'allyHeal').map(v => v.y), [200]);
  assert.deepEqual(series({ matches: [{ start_time: 1 }] }, 'placement').map(v => v.y), [null]);
  assert.deepEqual(series({ matches: [{ start_time: 1, match_duration_s: 600 }] }, 'objective').map(v => v.y), [null]);
});

test('rank section has independent season and block controls, averaging only ranked badges', () => {
  const start = Date.parse('2026-07-30T00:00:00Z') / 1000;
  const p = { matches: [
    { start_time: start + 5, game_mode: 1, match_mode: 4, ranked_display_badge: 36 },
    { start_time: start - 1, game_mode: 1, match_mode: 4, ranked_display_badge: 16 },
    { start_time: start + 1, game_mode: 1, match_mode: 1 },
    { start_time: start + 4, game_mode: 1, match_mode: 4, ranked_display_badge: 120 },
    { start_time: start + 3, game_mode: 1, match_mode: 4 },
    { start_time: start + 2, game_mode: 1, match_mode: 4, ranked_display_badge: 21 },
  ] };
  assert.equal(stats[0].key, 'rank');
  assert.equal(vm.runInContext('rankProgressSeason', context), 'beta1');
  vm.runInContext('rankProgressWindow=1;progressWindow=100', context);
  assert.deepEqual(series(p, 'rank').map(v => [v.start, v.x, v.y]),
    [[1, 1, 7], [2, 2, null], [3, 3, null], [4, 4, 18]]);
  vm.runInContext('rankProgressWindow=2', context);
  assert.deepEqual(series(p, 'rank').map(v => [v.start, v.x, v.y]), [[1, 2, 7], [3, 4, 18]]);
  vm.runInContext('rankProgressWindow=0', context);
  assert.deepEqual(series(p, 'rank').map(v => [v.start, v.x, v.y]),
    [[1, 1, 7], [2, 2, null], [3, 3, null], [4, 4, 18]]);
  p.cutoff = start + 4; // Global Period must not affect the season chart.
  assert.deepEqual(series(p, 'rank').map(v => v.y), [7, null, null, 18]);
  assert.equal(context.rankLabel(36), 'Acolyte VI');
  assert.equal(context.rankAxisLabel(18), 'Acolyte VI');
  const rendered = context.tabProgress([p]);
  assert.match(rendered, /class="progress-rank-section"[^]*?id="progress-rank"[^]*?Individual Stats[^]*?id="progress-window"/);
  assert.match(rendered, /id="rank-progress-season"[^]*?Beta Season 1/);
  assert.match(rendered, /id="rank-progress-window"[^]*?No averaging/);
  assert.match(rendered, /No averaging: each ranked match has its own point/);
  assert.match(rendered, /independently of the global Mode and Period filters/);
  assert.match(html, /rankProgressWindow=Number\(e\.target\.value\);renderMain\(\)/);
  assert.match(html, /rankProgressSeason=e\.target\.value;renderMain\(\)/);
  assert.match(html, /text:stat\.key==='rank'\?'Ranked matches played':'Matches played'/);
  assert.match(html, /`Ranked matches #\$\{items\[0\]\.raw\.start\}–\$\{items\[0\]\.parsed\.x\}`/);
  assert.match(html, /`Ranked match #\$\{items\[0\]\.parsed\.x\}`/);
  vm.runInContext('rankProgressWindow=10', context);
});

test('rank progression is a line with rank symbols next to its y-axis labels', () => {
  assert.doesNotMatch(html.slice(html.indexOf("if(activeTab==='progress'){", html.indexOf('// ---- CHARTS ----')), html.indexOf("else if(activeTab==='combat'){", html.indexOf('// ---- CHARTS ----'))), /stepped:/);
  assert.match(html, /showLine:true,spanGaps:false/);
  context.rankAssets.push({ tier: 3, images: { small: 'https://example.test/acolyte.png', large_subrank1: 'https://example.test/acolyte-i.png' } });
  assert.equal(context.rankSymbolUrl(13), 'https://example.test/acolyte-i.png');
  const draws = [];
  const chart = { scales: { y: { right: 160, options: { ticks: { padding: 3 } }, ticks: [{ value: 13 }], getPixelForTick: () => 40 } },
    ctx: { save() {}, restore() {}, font: '', measureText: () => ({ width: 80 }),
      fillText: (...args) => draws.push(['fallback', ...args]), drawImage: (...args) => draws.push(['image', ...args]) },
    redraws: 0, draw() { this.redraws++; } };
  context.charts['progress-rank'] = chart;
  const plugin = vm.runInContext('progressRankSymbols', context);
  plugin.afterDraw(chart);
  assert.equal(draws[0][0], 'fallback');
  const icon = vm.runInContext("progressRankImages.get('https://example.test/acolyte-i.png')", context);
  icon.image.onload();
  assert.equal(chart.redraws, 1);
  plugin.afterDraw(chart);
  assert.equal(draws[1][0], 'image');
  assert.match(html, /if\(activeTab==='progress'\)void loadRankAssets\(\)/);
  assert.match(html, /\.progress-rank-section\{margin-bottom:32px;padding-bottom:26px/);
  assert.match(html, /\.progress-rank-section>\.slbl,\.progress-individual-section>\.slbl\{margin:0 0 14px\}/);
});

test('axes use the actual extremes across all players and ignore unavailable points', () => {
  const bounds = datasets => JSON.parse(JSON.stringify(context.progressBounds(datasets)));
  assert.deepEqual(bounds([
    { data: [{ x: 10, y: 20 }, { x: 30, y: 50 }] },
    { data: [{ x: 5, y: 60 }, { x: 70, y: null }] },
    { hidden: true, data: [{ x: 100, y: 1000 }] }
  ]), { x: { min: 5, max: 30 }, y: { min: 20, max: 60 } });
  assert.deepEqual(bounds([{ data: [{ x: 100, y: 42 }] }]),
    { x: { min: 99, max: 101 }, y: { min: 41, max: 43 } });
  assert.equal(bounds([{ data: [{ x: 10, y: null }] }]), null);
  assert.equal(bounds([{ hidden: true, data: [{ x: 10, y: 20 }] }]), null);
  assert.match(html, /\.\.\.bounds\.x/);
  assert.match(html, /\.\.\.bounds\.y/);
});

test('missing damage is excluded from a block average and empty blocks remain gaps', () => {
  vm.runInContext('progressWindow=10', context);
  const p = { matches: Array.from({ length: 21 }, (_, i) => ({
    start_time: i + 1, dpm: i === 0 ? 100 : i === 2 ? 300 : i === 20 ? 500 : undefined,
  })) };
  assert.deepEqual(series(p, 'damage').map(v => v.y), [200, null, 500]);
  assert.deepEqual(series({ matches: [] }, 'damage'), []);
});
