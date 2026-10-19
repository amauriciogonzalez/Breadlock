const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function rankingComparison('), html.indexOf('function rankingExplanation('));
const context = {
  f1: n => n == null ? '—' : n.toFixed(1),
  CHEM_STATS: [['Combat', 'Damage and fighting output', '#ff9678', [['Kills', null, n => n.toFixed(1), 1]]], ['Economy', 'Souls and farming', '#f0b429', []]],
  scalePerformanceScore: n => Math.max(0, Math.min(100, 50 + 2.5 * (n - 50))),
  f2: n => n == null ? '—' : n.toFixed(2),
  coreWeightText: n => n == null ? '—' : Number.isInteger(n) ? String(n) : n.toFixed(1),
  chemText: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  leaderboardMode: 'overall',
};
vm.createContext(context);
vm.runInContext(source, context);

function player(id, label, score, metricScore) {
  return {
    p: { id, label, color: '#abcdef' }, tier: id === '1' ? 'S' : 'A',
    score, performance: score, winStanding: score, winRate: score,
    n: 20, metricPerformance: score, metricCorePerformance: score,
    scoreWeights: { metric: 70, placement: 20, win: 10 }, placementScore: score,
    placement: { average: 5, count: 20, selected: 20 }, supportBonus: 0,
    categoryDetails: [{ name: 'Combat', rawScore: metricScore, effectiveWeight: 100,
      metrics: [{ label: 'Kills', score: metricScore, mean: 8, count: 20, direction: 1 }] }],
  };
}

test('comparison uses existing leaderboard scores and shows the actual component gap', () => {
  const result = context.rankingComparison(player('1', 'Alice', 60, 55), player('2', 'Bob', 50, 48));
  assert.match(result, /chem-score-card/);
  assert.match(result, /width:42\.0000%;background:#ff9678/);
  assert.match(result, /width:12\.0000%;background:#ff7eb6/);
  assert.match(result, /width:6\.0000%;background:var\(--teal\)/);
  assert.match(result, /10\.00<\/strong><span>Overall score gap/);
  assert.match(result, /\+7\.00 stat pts \+ \+2\.00 place pts \+ \+1\.00 win pts = \+10\.00 pts/);
  assert.match(result, /chem-category-head[^]*?Combat/);
  assert.match(result, /chem-metric-title[^]*?Kills/);
  assert.match(result, /selecting two names does not recalculate them/);
});

test('comparison handles missing data and escapes player labels', () => {
  const a = player('1', '<Alice>', null, 50);
  a.performance = null;
  a.winStanding = null;
  a.placementScore = null;
  a.categoryDetails = [];
  const result = context.rankingComparison(a, player('2', 'Bob', 50, 50));
  assert.match(result, /&lt;Alice&gt;/);
  assert.match(result, /No comparable gap/);
  assert.match(result, /missing components cause remaining weights to be rescaled/);
  assert.doesNotMatch(result, /NaN/);
});

test('combined segments include categories, applied support, placement and wins and sum to the final score', () => {
  const a = player('1', 'Alice', 50.4, 55);
  a.categoryDetails[0].effectiveWeight = 50;
  a.categoryDetails.push({ name: 'Economy', rawScore: 45, effectiveWeight: 50, metrics: [] });
  Object.assign(a, { metricCorePerformance: 50, metricPerformance: 52, supportBonus: 2,
    placementScore: 40, winStanding: 60 });
  const result = context.rankingComparison(a, player('2', 'Bob', 50, 48));
  const firstTrack = result.match(/<div class="chem-score-track"[^>]*>(.*?)<\/div>/)?.[1];
  assert.ok(firstTrack);
  const widths = [...firstTrack.matchAll(/width:([\d.]+)%;background:([^";]+)/g)];
  assert.equal(widths.length, 5);
  assert.deepEqual(widths.map(m => m[2]), ['#ff9678', '#f0b429', '#c084fc', '#ff7eb6', 'var(--teal)']);
  assert.ok(Math.abs(widths.reduce((sum, m) => sum + Number(m[1]), 0) - a.score) < 1e-9);
  assert.match(result, /Support bonus: 1\.40 \/ 0\.00 pts/);
});

test('different placement coverage no longer changes the stat category share', () => {
  const a = player('1', 'TragicSensei', 49.825, 49.9);
  const b = player('2', 'Yamson', 49.3, 49.6);
  Object.assign(a, { metricCorePerformance: 49.75, metricPerformance: 49.75,
    placementScore: 50, winStanding: 50 });
  Object.assign(b, { metricCorePerformance: 49, metricPerformance: 49,
    placementScore: 50, winStanding: 50 });
  a.placement.count = 97;
  a.placement.selected = 100;
  b.placement.count = 82;
  b.placement.selected = 100;
  const result = context.rankingComparison(a, b);
  const combat = result.match(/Combat: ([\d.]+) \/ ([\d.]+) pts/);
  assert.ok(combat);
  assert.ok(Number(combat[1]) > Number(combat[2]));
  assert.match(result, /width:34\.8250%;background:#ff9678/);
});

test('support segment uses only applied capped points and win-only scores fill the track', () => {
  const capped = player('1', 'Alice', 100, 70);
  Object.assign(capped, { metricCorePerformance: 98, metricPerformance: 100, supportBonus: 5,
    scoreWeights: { metric: 100, placement: 0, win: 0 }, placementScore: null, winStanding: null });
  const winOnly = player('2', 'Bob', 40, 50);
  Object.assign(winOnly, { metricPerformance: null, metricCorePerformance: null,
    scoreWeights: { metric: 0, placement: 0, win: 100 }, placementScore: null, winStanding: 40 });
  winOnly.categoryDetails = [];
  const result = context.rankingComparison(capped, winOnly);
  const tracks = [...result.matchAll(/<div class="chem-score-track"[^>]*>(.*?)<\/div>/g)].map(m => m[1]);
  assert.match(tracks[0], /width:98\.0000%;background:#ff9678/);
  assert.match(tracks[0], /width:2\.0000%;background:#c084fc/);
  assert.match(tracks[1], /width:40\.0000%;background:var\(--teal\)/);
  assert.doesNotMatch(tracks[1], /background:#ff9678/);
});

test('Best Heroes uses the original candidate pool and shows missing metrics as unavailable', () => {
  context.leaderboardMode = 'heroes';
  const a = player('1', 'Alice', 60, 55);
  a.categoryDetails = [];
  a.metricPerformance = null;
  a.metricCorePerformance = null;
  a.scoreWeights = { metric: 0, placement: 20 / 30 * 100, win: 10 / 30 * 100 };
  const result = context.rankingComparison(a, player('2', 'Bob', 50, 48));
  assert.match(result, /Best Heroes candidate-hero peer pool/);
  assert.match(result, /Peer scores — \/ 48\.0/);
  assert.match(result, /chem-category-head[^]*?Combat/);
  context.leaderboardMode = 'overall';
});
