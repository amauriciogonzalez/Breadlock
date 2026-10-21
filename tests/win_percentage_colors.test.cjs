const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const pctColorSource = html.match(/function pctColor\(v\)\{[^}]+\}/)?.[0];

test('win percentage colors turn red below 50, orange at 50, green above 50', () => {
  assert.ok(pctColorSource);
  const pctColor = vm.runInNewContext(`(${pctColorSource})`);
  assert.equal(pctColor(49.9), 'var(--red)');
  assert.equal(pctColor(50), 'var(--acc)');
  assert.equal(pctColor(50.1), 'var(--grn)');
});

test('overview and hero leaderboards use the same win percentage colors', () => {
  const overview = html.slice(html.indexOf('function tabOverview('), html.indexOf('function rankingComparison('));
  const heroes = html.slice(html.indexOf('function tabHeroes('));
  assert.match(overview, /data-label="Win% · 10%"[^\n]*pctColor\(r\.winRate\)/);
  assert.equal((heroes.match(/pctColor\(hr\.wr\)/g) || []).length, 2);
});

test('leaderboard values display no more than one decimal place', () => {
  const overview = html.slice(html.indexOf('function tabOverview('), html.indexOf('function rankingComparison('));
  const heroes = html.slice(html.indexOf('function tabHeroes('), html.indexOf('function matchBreakdownHtml('));
  assert.match(overview, /data-label="KDA"[^\n]*f1\(r\.kda\)/);
  for (const [label, key] of [['Kills/game', 'kills'], ['Deaths/game', 'deaths'], ['Assists/game', 'assists']]) {
    assert.ok(overview.includes(`data-label="${label}">\${f1(s.${key})}`));
  }
  assert.doesNotMatch(overview, /f2\(/);
  assert.equal((heroes.match(/f1\(hr\.wr\)/g) || []).length, 2);
  assert.equal((heroes.match(/f1\(hr\.kda\)/g) || []).length, 2);
  assert.doesNotMatch(heroes, /f2\(hr\.kda\)|hr\.wr\.toFixed\(0\)/);
});
