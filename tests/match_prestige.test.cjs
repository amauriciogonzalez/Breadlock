const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const source = html.slice(html.indexOf('function placementForMatch('), html.indexOf('function placementForMatches('));
const ranks = { _teams: {} };
// Interleave teams in the overall leaderboard: first on a team need not be lobby first.
for (let i = 1; i <= 12; i++) {
  ranks[i] = i;
  ranks._teams[i] = i % 2 === 0 ? 0 : 1;
}
const context = { placementRanks: new Map([['42', ranks]]), isWin: m => m.won };
vm.createContext(context);
vm.runInContext(source, context);

test('prestige uses estimated order within the winning or losing team', () => {
  const award = (hero_id, won) => context.prestigeForMatch({ match_id: 42, hero_id, won });
  assert.equal(award(1, true), 'MVP');
  assert.equal(award(2, true), 'MVP');
  assert.equal(award(3, true), 'Key Player');
  assert.equal(award(4, true), 'Key Player');
  assert.equal(award(1, false), 'Key Player');
  assert.equal(award(2, false), 'Key Player');
  assert.equal(award(3, false), '-');
  assert.equal(award(5, true), '-');
  assert.equal(award(12, false), '-');
});

test('prestige is not awarded without a complete estimated team', () => {
  assert.equal(context.prestigeForMatch({match_id: 99, hero_id: 1, won: true}), '-');
  assert.equal(context.prestigeForMatch({match_id: 42, hero_id: 99, won: true}), '-');
  const incomplete = {...ranks, _teams: {...ranks._teams}};
  delete incomplete._teams[12];
  context.placementRanks.set('42', incomplete);
  assert.equal(context.prestigeForMatch({match_id: 42, hero_id: 2, won: true}), '-');
});
