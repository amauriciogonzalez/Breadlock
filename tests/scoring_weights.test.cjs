const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const definition = html.slice(html.indexOf('const CHEM_STATS=['), html.indexOf('function chemObservations('));

const stats = vm.runInNewContext(`${definition}\nCHEM_STATS`, {
  f1: () => {}, f2: () => {}, fk: () => {},
});
const weightsFor = name => Object.fromEntries(stats.find(([group]) => group === name)[3]
  .map(([label, , , , weight]) => [label, weight]));

const coreWeights = vm.runInNewContext(`${html.slice(html.indexOf('const CHEM_WEIGHTS='),html.indexOf('function weightedMetricScore('))}\nCHEM_WEIGHTS`);

test('Overview and Chemistry share 100% whole-number core weights; support remains a bonus', () => {
  assert.deepEqual({...coreWeights}, {
    Combat: 40, Economy: 15, 'Objectives & farming': 20,
    Aim: 5, Support: 0, Survivability: 20,
  });
  assert.equal(Object.values(coreWeights).reduce((sum, weight) => sum + weight, 0), 100);
  assert.doesNotMatch(html, /Core category weights: Combat 40%, Economy 15%, Objectives & farming 20%, Aim 5%, Survivability 20%/);
});

test('shared leaderboard and Chemistry economy weights prioritize souls/min over denies', () => {
  const weights = weightsFor('Economy');
  assert.equal(weights['Souls/min'], 60);
  assert.equal(weights['Denies/game'], 5);
  assert.equal(Object.values(weights).reduce((sum, weight) => sum + weight, 0), 100);
});

test('shared Survivability weights emphasize fewer deaths without scoring damage taken', () => {
  const weights = weightsFor('Survivability');
  assert.equal(weights['Deaths/game'], 65);
  assert.equal(weights['Damage mitigated/game'], 20);
  assert.equal(weights['Self healing/game'], 15);
  assert.equal(weights['Damage taken/game'], 0);
  assert.equal(Object.values(weights).reduce((sum, weight) => sum + weight, 0), 100);
});

test('shared leaderboard and Chemistry combat weights limit KDA overlap', () => {
  const weights = weightsFor('Combat');
  assert.equal(weights['KDA/game'], 5);
  assert.equal(weights['Hero damage/min'], 35);
  assert.equal(weights['Kills/game'], 25);
  assert.equal(weights['Assists/game'], 25);
  assert.equal(weights['Hero damage/game'], 10);
  assert.equal(Object.values(weights).reduce((sum, weight) => sum + weight, 0), 100);
});
