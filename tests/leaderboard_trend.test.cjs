const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('const RANK_TREND_MATCH_OPTIONS='), html.indexOf('function assignRankingTiers('));
const calls = [];
const context = {
  gn: (m, key) => m[key],
  f1: n => n == null ? '—' : n.toFixed(1),
  chemText: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]),
  CHEM_STATS: [['Combat'], ['Support']],
  soulsK: n => n == null ? '—' : (n / 1000).toFixed(1) + 'K',
  placementForMatch: m => m.place ?? null,
  rankTrendMatches: 10,
  rankPlayers: (items, peers) => {
    calls.push({ items, peers });
    return items.map(({ p, heroId, matches }) => ({
      p, heroId, score: matches.reduce((sum, m) => sum + m.value, 0) / matches.length,
      metricPerformance: 50, winStanding: 50, placementScore: 50,
      placement: { count: 10 }, performanceCoverage: { details: 10 },
    }));
  },
};
vm.createContext(context);
vm.runInContext(source, context);
const matches = (count, heroId = 1) => Array.from({ length: count }, (_, i) => ({
  start_time: i + 1, value: i + 1, hero_id: heroId,
}));

test('score trend compares the latest ten with the preceding ten using fixed peers', () => {
  const p = { id: 1 }, peers = [p, { id: 2 }];
  const trend = context.rankingScoreTrends([{ p, matches: matches(25) }], peers).get(p);
  assert.equal(trend.recent, 20.5);
  assert.equal(trend.older, 10.5);
  assert.equal(trend.delta, 10);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].peers, peers);
  assert.equal(calls[1].peers, peers);
  assert.equal(calls[0].items[0].matches.length, 10);
  assert.equal(calls[1].items[0].matches.length, 10);
  assert.match(context.scoreTrendHtml(trend, 0, { id: 1, label: 'Alice' }), /rank-score-trend up strong[^]*?aria-expanded="false"[^]*?↑<\/button>/);
  assert.match(context.scoreTrendHtml({ recent: 44, older: 48, delta: -4 }, 0, { id: 1, label: 'Alice' }), /rank-score-trend down medium[^]*?↓<\/button>/);
  assert.match(context.scoreTrendHtml({ recent: 48.4, older: 48, delta: .4 }, 0, { id: 1, label: 'Alice' }), /rank-score-trend flat soft[^]*?→<\/button>/);
});

test('arrow colors use explicit point-magnitude bands', () => {
  const arrow = delta => context.scoreTrendHtml({ recent: 50 + delta, older: 50, delta }, 0, { id: 1, label: 'Alice' });
  assert.match(arrow(-1), /rank-score-trend down soft/);
  assert.match(arrow(-2.9), /rank-score-trend down soft/);
  assert.match(arrow(-3), /rank-score-trend down medium/);
  assert.match(arrow(-6), /rank-score-trend down strong/);
  assert.match(arrow(1), /rank-score-trend up soft/);
  assert.match(arrow(5.9), /rank-score-trend up medium/);
  assert.match(arrow(6), /rank-score-trend up strong/);
  assert.match(html, /\.rank-score-trend\.down\.medium\{color:#ffae60\}/);
  assert.match(html, /\.rank-score-trend\.up\.strong\{color:#23ca76\}/);
});

test('configurable window uses two equal match groups and proportional coverage requirements', () => {
  assert.match(html, /id="rank-trend-window"/);
  assert.match(source, /RANK_TREND_MATCH_OPTIONS=\[5,10,15,20,30\]/);
  assert.match(html, /RANK_TREND_MATCH_OPTIONS\.map\(n=>/);
  assert.match(html, /rankTrendMatches=Number\(e\.target\.value\);renderMain\(\)/);
  const p = { id: 6 }, ranked = [{ p, matches: matches(40) }], peers = [p];
  const original = context.rankPlayers;
  context.rankPlayers = items => items.map(({ p, matches: ms }) => ({
    p, score: ms.length, metricPerformance: 50, winStanding: 50, placementScore: 50,
    placement: { count: ms.length }, performanceCoverage: { details: ms.length },
  }));
  try {
    const five = context.rankingScoreTrends(ranked, peers, 5).get(p);
    assert.equal(five.matches, 5);
    assert.deepEqual([...five.recentMatches].map(m => m.start_time), [40, 39, 38, 37, 36]);
    assert.deepEqual([...five.olderMatches].map(m => m.start_time), [35, 34, 33, 32, 31]);
    assert.equal(context.rankingScoreTrends(ranked, peers, 20).get(p).matches, 20);
    assert.equal(context.rankingScoreTrends([{ p, matches: matches(39) }], peers, 20).get(p), undefined);
    assert.match(context.scoreTrendHtml(null), /need 20 matches/);
    context.rankTrendMatches = 5;
    assert.match(context.scoreTrendHtml(null), /need 10 matches/);
    context.rankPlayers = items => items.map(({ p }) => ({ p, score: 50, metricPerformance: 50,
      winStanding: 50, placementScore: 50, placement: { count: 5 }, performanceCoverage: { details: 3 },
    }));
    assert.equal(context.rankingScoreTrends(ranked, peers, 5).get(p), undefined);
  } finally {
    context.rankPlayers = original;
    context.rankTrendMatches = 10;
  }
});

test('missing a full pair of windows leaves trend unavailable', () => {
  const p = { id: 3 };
  assert.equal(context.rankingScoreTrends([{ p, matches: matches(19) }], [p]).get(p), undefined);
  assert.match(context.scoreTrendHtml(null), /trend unavailable/i);
});

test('best-hero trend retains the selected hero in both windows', () => {
  const p = { id: 4 }, peers = [{ p, heroId: 7, matches: matches(20, 7) }];
  const result = context.rankingScoreTrends([{ p, heroId: 7, matches: matches(20, 7) }], peers);
  assert.ok(result.has(p));
  assert.equal(calls.at(-1).items[0].heroId, 7);
  assert.equal(calls.at(-2).items[0].heroId, 7);
});

test('trend detail shows exact weighted changes and both ten-match histories', () => {
  const row = (name, metric, place, win, winRate) => ({
    p: { label: '<Alice>' }, metricPerformance: metric, placementScore: place, winStanding: win,
    scoreWeights: { metric: 70, placement: 20, win: 10 }, supportBonus: 1,
    placement: { average: 5, count: 10 }, winRate, counts: { winRate: 10 },
    categoryDetails: [{ name: 'Combat', rawScore: metric, metrics: [{ label: 'Kills', score: metric, mean: 10 }] }],
  });
  const result = context.rankingTrendExplanation({
    olderRow: row('old', 50, 50, 50, 40), recentRow: row('recent', 60, 40, 60, 60),
    older: 50, recent: 56, delta: 6,
    olderMatches: matches(10), recentMatches: matches(10),
  });
  assert.match(result, /\+6\.0 score points/);
  assert.match(result, /\+7\.0 pts/);
  assert.match(result, /−2\.0 pts/);
  assert.match(result, /\+1\.0 pts/);
  assert.match(result, /Stat performance[^]*?rank-trend-factor-fill previous" style="width:50%"[^]*?35\.0[^]*?rank-trend-factor-fill recent up" style="width:60%"[^]*?42\.0/);
  assert.match(result, /Estimated placement[^]*?rank-trend-factor-fill recent down" style="width:40%"[^]*?8\.0/);
  assert.match(result, /Bars: 0–70\.0 possible score pts/);
  assert.doesNotMatch(result, /rank-trend-delta-track/);
  assert.match(result, /rank-trend-scores[^]*?rank-trend-score-fill previous[^]*?width:50%[^]*?rank-trend-score-fill recent up[^]*?width:56%/);
  assert.match(result, /rank-trend-category-row[^]*?rank-bar-fill old[^]*?width:50%[^]*?rank-trend-category-row[^]*?rank-bar-fill new up[^]*?width:60%/);
  assert.match(result, /class="rank-trend-cat-toggle"[^]*?aria-expanded="false" aria-controls="rank-trend-cat-panel-0-0"/);
  assert.match(result, /id="rank-trend-cat-panel-0-0" class="rank-trend-metrics" hidden[^]*?Kills[^]*?rank-bar-fill new up[^]*?width:60%/);
  assert.doesNotMatch(result, /Largest metric shifts/);
  assert.match(html, /\.rank-trend-category \.rank-bar-fill\{display:block\}/);
  assert.match(result, /Previous 10 games · oldest → newest<\/h4><strong>Win rate 40\.0%<\/strong>/);
  assert.match(result, /Latest 10 games · oldest → newest<\/h4><strong>Win rate 60\.0%<\/strong>/);
  assert.equal((result.match(/role="listitem"/g) || []).length, 20);
  assert.match(result, /&lt;Alice&gt;/);
});

test('trend panel labels, game strips, and coverage follow the chosen window', () => {
  const row = { p: { id: 1, label: 'Alice' }, metricPerformance: 50, placementScore: 50,
    winStanding: 50, scoreWeights: { metric: 70, placement: 20, win: 10 },
    placement: { average: 5, count: 5 }, supportBonus: 0, winRate: 60,
    counts: { winRate: 4 }, categoryDetails: [{ name: 'Combat', rawScore: 50,
      metrics: [{ label: 'Kills', score: 50, count: 4, mean: 5 }] }] };
  const markup = context.rankingTrendExplanation({ olderRow: row, recentRow: row, matches: 5,
    older: 50, recent: 50, delta: 0, olderMatches: matches(5), recentMatches: matches(5) });
  assert.match(markup, /last 5 vs previous 5 matches/);
  assert.match(markup, /coverage 5\/5 → 5\/5/);
  assert.match(markup, /coverage 4\/5 → 4\/5/);
  assert.match(markup, /Previous 5 games[^]*?Win rate 60\.0% · 4\/5 results/);
  assert.match(markup, /Latest 5 games/);
  assert.equal((markup.match(/role="listitem"/g) || []).length, 10);
  assert.match(context.scoreTrendHtml({ matches: 5, recent: 50, older: 49, delta: 1 }, 0, { id: 1, label: 'Alice' }), /last 5 matches/);
});

test('trend categories are independent full-width accordions, not a stretching card grid', () => {
  const row = (label, score) => ({ p: { id: 1, label: 'Alice' }, metricPerformance: score,
    placementScore: null, winStanding: 50, scoreWeights: { metric: 87.5, placement: 0, win: 12.5 },
    supportBonus: 0, placement: { average: null, count: 0 }, winRate: 50,
    categoryDetails: ['Combat', 'Support'].map(name => ({ name, rawScore: score,
      metrics: [{ label, score, mean: 5, count: 10 }] })) });
  const markup = context.rankingTrendExplanation({ olderRow: row('old', 50), recentRow: row('new', 55),
    older: 50, recent: 55, delta: 5, olderMatches: matches(10), recentMatches: matches(10) }, 3);
  assert.equal((markup.match(/class="rank-trend-category"/g) || []).length, 2);
  assert.match(markup, /rank-trend-cat-panel-3-0/);
  assert.match(markup, /rank-trend-cat-panel-3-1/);
  assert.match(markup, /class="rank-trend-category-scores"/);
  assert.match(html, /\.rank-trend-categories\{display:flex;flex-direction:column;/);
  assert.match(html, /\.rank-trend-metrics\{display:grid;grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
});

test('category drilldown keeps metrics with data in only one window', () => {
  const base = { p: { id: 1, label: 'Alice' }, metricPerformance: 50, placementScore: null,
    winStanding: 50, scoreWeights: { metric: 87.5, placement: 0, win: 12.5 },
    supportBonus: 0, placement: { average: null, count: 0 }, winRate: 50 };
  const olderRow = { ...base, categoryDetails: [{ name: 'Combat', rawScore: 50, metrics: [] }] };
  const recentRow = { ...base, categoryDetails: [{ name: 'Combat', rawScore: 60,
    metrics: [{ label: 'Kills', score: 60, mean: 8, count: 10 }] }] };
  const result = context.rankingTrendExplanation({ olderRow, recentRow, older: 50, recent: 55,
    delta: 5, olderMatches: matches(10), recentMatches: matches(10) }, 2);
  assert.match(result, /aria-controls="rank-trend-cat-panel-2-0"/);
  assert.match(result, /Kills[^]*?Previous[^]*?peer score —[^]*?Latest[^]*?peer score 60\.0/);
});

test('missing score components or sparse detail coverage suppresses the arrow', () => {
  context.rankPlayers = items => items.map(({ p }) => ({ p, score: 55, metricPerformance: 55,
    winStanding: 50, placementScore: 50, placement: { count: 10 },
    performanceCoverage: { details: 7 },
  }));
  const p = { id: 5 };
  assert.equal(context.rankingScoreTrends([{ p, matches: matches(20) }], [p]).get(p), undefined);
});
