const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('const RANK_METRIC_WEIGHT='), html.indexOf('function rankingStats('));
const context = {};
vm.createContext(context);
vm.runInContext(source, context);

test('Overview gives stats 70%, estimated place 20%, and win standing 10%', () => {
  const result = context.rankScoreParts(60, 40, 50);
  assert.deepEqual({ ...result.weights }, { metric: 70, placement: 20, win: 10 });
  assert.equal(result.score, 55);
});

test('placement confidence affects its score, not the stat weight', () => {
  const full = context.rankScoreParts(60, 70, 50);
  const sparse = context.rankScoreParts(60, 50 + (70 - 50) * 0.2, 50);
  assert.equal(full.weights.metric, 70);
  assert.equal(sparse.weights.metric, 70);
  assert.equal(full.weights.placement, 20);
  assert.equal(sparse.weights.placement, 20);
  assert.ok(full.score > sparse.score);
});

test('unavailable components are excluded and remaining weights rescaled', () => {
  const withoutPlace = context.rankScoreParts(60, null, 50);
  assert.ok(Math.abs(withoutPlace.weights.metric - 87.5) < 1e-9);
  assert.ok(Math.abs(withoutPlace.weights.win - 12.5) < 1e-9);
  assert.equal(withoutPlace.weights.placement, 0);
  assert.equal(withoutPlace.score, 58.75);
  assert.equal(context.rankScoreParts(null, null, 45).score, 45);
  assert.equal(context.rankScoreParts(null, null, null).score, null);
});
