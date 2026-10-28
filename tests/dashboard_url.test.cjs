const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync(require('node:path').join(__dirname, '..', 'index.html'), 'utf8');
const helpers = html.slice(html.indexOf('function dashboardUrlState('), html.indexOf('let individualId='));
const tabs = [...html.matchAll(/class="tab(?: on)?" data-t="([^"]+)"/g)].map(m => m[1]);

function context(href = 'https://example.com/app?other=keep#section') {
  const changes = [];
  const state = {
    URL, URLSearchParams,
    document: {querySelectorAll: () => tabs.map(t => ({dataset: {t}}))},
    window: {location: {href, search: new URL(href).search}},
    history: {pushState: (_state, _title, url) => {
      state.window.location.href = String(url);
      changes.push(String(url));
    }},
    players: [], scopeMode: 'normal', scopeCount: 0, scopeUnit: 'matches', activeTab: 'overview'
  };
  vm.createContext(state);
  vm.runInContext(helpers, state);
  return {state, changes};
}

test('dashboard URL restores valid ordered player IDs and filters, dropping invalid entries', () => {
  const {state} = context('https://example.com/app?players=123,abc,456,123,123456789012345678901&mode=ranked&count=90&unit=days&tab=matches');
  const saved = state.dashboardUrlState(state.window.location.search);
  assert.deepEqual([...saved.ids], ['123', '456']);
  assert.equal(saved.mode, 'ranked');
  assert.equal(saved.count, '90');
  assert.equal(saved.unit, 'days');
  assert.equal(saved.tab, 'matches');
  const fallback = state.dashboardUrlState('?mode=invalid&count=-1&unit=weeks&tab=not-a-tab');
  assert.deepEqual([...fallback.ids], []);
  assert.equal(fallback.mode, 'normal');
  assert.equal(fallback.count, '0');
  assert.equal(fallback.unit, 'matches');
  assert.equal(fallback.tab, 'overview');
});

test('dashboard URL tracks roster changes and filters without losing unrelated URL parts', () => {
  const {state, changes} = context();
  state.players = [{id: '123'}, {id: '456'}];
  state.scopeMode = 'standard';
  state.scopeCount = 30;
  state.scopeUnit = 'days';
  state.activeTab = 'heroes';
  state.syncDashboardUrl();
  const url = new URL(state.window.location.href);
  assert.equal(url.searchParams.get('players'), '123,456');
  assert.equal(url.searchParams.get('mode'), 'standard');
  assert.equal(url.searchParams.get('count'), '30');
  assert.equal(url.searchParams.get('unit'), 'days');
  assert.equal(url.searchParams.get('tab'), 'heroes');
  assert.equal(url.searchParams.get('other'), 'keep');
  assert.equal(url.hash, '#section');
  state.syncDashboardUrl();
  assert.equal(changes.length, 1);
  state.players = [];
  state.syncDashboardUrl();
  assert.equal(new URL(state.window.location.href).searchParams.has('players'), false);
});
