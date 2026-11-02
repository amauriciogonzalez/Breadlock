const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const source = html.slice(html.indexOf('function assignRankingTiers('), html.indexOf('function tabCombat('));
const assignRankingTiers = vm.runInNewContext(`(${source.trim()})`);
const tiers = scores => Array.from(assignRankingTiers(scores.map(score => ({ score }))), r => r.tier).join('');

test('screenshot scores isolate the top two, but Def does not qualify as a singleton', () => {
  assert.equal(tiers([70.4, 66.2, 56.3, 52.8, 50.1, 49.9, 48.7, 46.9, 46.4, 35.1, 33.9]), 'SABBCCCDDFF');
  assert.equal(tiers([70.3, 66.2, 56.1, 52.8, 50, 49.9, 48.4, 46.7, 46.7, 35, 34.4]), 'SABBCCCDDFF');
});

test('ties are never separated and singleton tiers need a four-point adjacent gap', () => {
  assert.equal(tiers([70, 70, 50, 50, 30, 30]), 'SSAABB');
  assert.equal(tiers([70, 50, 30]), 'SAB');
  assert.equal(tiers([70, 50, 30, 10]), 'SABC');
  assert.equal(tiers([85, 70, 69, 68, 67, 66]), 'SAAAAA');
  assert.equal(tiers([90, 89, 70, 50, 49, 48]), 'SSABBB');
  assert.equal(tiers([57, 55, 54, 53, 52]), 'SSSSS');
  assert.equal(tiers([58, 55, 54, 53, 52]), 'SSSSS');
  assert.equal(tiers([59, 55, 54, 53, 52]), 'SAAAA');
});

test('six qualifying singletons or six separated pairs can use all six tiers', () => {
  assert.equal(tiers([90, 85, 80, 75, 70, 65]), 'SABCDF');
  assert.equal(tiers([90, 89, 78, 77, 66, 65, 54, 53, 42, 41, 30, 29]), 'SSAABBCCDDFF');
  assert.equal(tiers([99, 98, 87, 86, 75, 74, 63, 62, 51, 50, 30]), 'SSAABBCCDDF');
});

test('close scores are not split merely to fill tiers', () => {
  assert.equal(tiers(Array(11).fill(50)), 'S'.repeat(11));
  assert.equal(tiers([50, 49.9, 49.8, 49.7, 49.6, 49.5]), 'S'.repeat(6));
});

test('unscored players remain ungraded', () => {
  const rows = [{ score: 60 }, { score: null }, { score: 50 }, { score: 40 }, { score: 30 }];
  assert.deepEqual(Array.from(assignRankingTiers(rows), r => r.tier), ['S', null, 'A', 'B', 'C']);
});
