const assert = require('node:assert/strict');
const { test } = require('node:test');
const { install } = require('../backend/snapshot_adapter.js');

test('snapshot serves saved history and projected metadata without an API call', async () => {
  const calls = [], live = [];
  const manifest = { version: 1, generatedAt: '2026-01-01T00:00:00Z',
    accounts: { '42': { file: 'history.json', checkedAt: 1 } },
    matches: { '7': 'chunk.json' }, savedMatches: 1, uniqueHistoryMatches: 1 };
  const fetchImpl = async url => {
    calls.push(url);
    return { ok: true, json: async () => url.includes('manifest') ? manifest :
      url.includes('history') ? [{ match_id: 7 }] : [{ match_id: 7, players: [] }] };
  };
  const coordinator = {
    request: async path => { live.push(path); return ['live']; },
    metadata: async ids => { live.push(ids); return ['live']; },
  };
  const adapter = install(coordinator, { fetchImpl, status: () => {} });
  await adapter.ready;
  assert.deepEqual(await coordinator.request('/players/42/match-history?only_stored_history=true'),
    [{ match_id: 7 }]);
  assert.deepEqual(await coordinator.metadata(['7'], {
    only_filtered_players: 'false', include_player_death_details: 'true',
  }), [{ match_id: 7, players: [] }]);
  assert.deepEqual(live, []);
  assert.equal(calls.length, 3);
  assert.deepEqual(await coordinator.request('/players/99/match-history?only_stored_history=true'),
    ['live']);
  assert.deepEqual(live, ['/players/99/match-history?only_stored_history=true']);
});

test('unsaved example matches automatically fall back to the paced metadata coordinator', async () => {
  const fetched = [];
  const manifest = { version: 1, generatedAt: '2026-01-01T00:00:00Z',
    accounts: { '42': { file: 'history.json', checkedAt: 1 } },
    matches: { '7': 'chunk.json' }, savedMatches: 1, uniqueHistoryMatches: 2 };
  const coordinator = {
    request: async () => { throw Error('Example history should be saved'); },
    metadata: async (ids, options, controls) => {
      fetched.push({ ids, options, controls });
      return ids.map(match_id => ({ match_id, source: 'api' }));
    },
  };
  const adapter = install(coordinator, { fetchImpl: async url => ({
    ok: true, json: async () => url.includes('manifest') ? manifest :
      url.includes('history') ? [{ match_id: 7 }, { match_id: 8 }] :
        [{ match_id: 7, source: 'snapshot' }],
  }) });
  await adapter.ready;
  assert.equal((await coordinator.request('/players/42/match-history?only_stored_history=true')).length, 2);
  const options = { only_filtered_players: 'false', include_player_death_details: 'true' };
  const controls = { priority: 1 };
  assert.deepEqual(await coordinator.metadata([7, 8], options, controls), [
    { match_id: 7, source: 'snapshot' }, { match_id: '8', source: 'api' },
  ]);
  assert.deepEqual(fetched, [{ ids: ['8'], options, controls }]);
});
