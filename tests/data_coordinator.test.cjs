const assert = require('node:assert/strict');
const { test } = require('node:test');
const DataCoordinator = require('../backend/data_coordinator.js');

test('requests share in-flight work and reuse cached responses until the TTL expires', async () => {
  let offset = 0;
  let calls = 0;
  const coordinator = new DataCoordinator({
    now: () => Date.now() + offset,
    spacingMs: 0,
    fetchImpl: async () => {
      calls++;
      return { ok: true, json: async () => ({ version: calls }) };
    },
  });
  const options = { ttl: 100 };
  const [first, second] = await Promise.all([
    coordinator.request('/players/1', options),
    coordinator.request('/players/1', options),
  ]);
  assert.deepEqual(first, { version: 1 });
  assert.deepEqual(second, first);
  assert.deepEqual(await coordinator.request('/players/1', options), first);
  assert.equal(calls, 1);

  offset += 100;
  assert.deepEqual(await coordinator.request('/players/1', options), { version: 2 });
  assert.equal(calls, 2);
});

test('stale data is returned on request failure only when enabled', async () => {
  let offset = 0;
  let fail = false;
  const coordinator = new DataCoordinator({
    now: () => Date.now() + offset,
    spacingMs: 0,
    fetchImpl: async () => {
      if (fail) return { ok: false, status: 404, headers: { get: () => null } };
      return { ok: true, json: async () => ['saved'] };
    },
  });
  await coordinator.request('/players/1', { ttl: 100 });
  offset += 100;
  fail = true;
  await assert.rejects(coordinator.request('/players/1', { ttl: 100 }), /HTTP 404/);
  assert.deepEqual(
    await coordinator.request('/players/1', { ttl: 100, staleOnError: true }),
    ['saved'],
  );
});

test('metadata caches individual matches and fetches only missing IDs', async () => {
  const paths = [];
  const coordinator = new DataCoordinator({
    spacingMs: 0,
    fetchImpl: async url => {
      const path = new URL(url);
      paths.push(path.search);
      const ids = path.searchParams.get('match_ids').split(',');
      return { ok: true, json: async () => ids.map(id => ({ match_id: id })) };
    },
  });
  const options = { include_info: 'true' };
  assert.deepEqual(await coordinator.metadata([1, 2, 1], options), [
    { match_id: '1' }, { match_id: '2' },
  ]);
  assert.deepEqual(await coordinator.metadata([2, 3], options), [
    { match_id: '2' }, { match_id: '3' },
  ]);
  assert.equal(paths.length, 2);
  assert.equal(new URLSearchParams(paths[0]).get('match_ids'), '1,2');
  assert.equal(new URLSearchParams(paths[1]).get('match_ids'), '3');
});

test('pruning keeps compact projected match rows longer than bulky responses', async () => {
  const coordinator = new DataCoordinator();
  const entries = [
    ...Array.from({ length: 2600 }, (_, i) => ({ key: `match:account_ids=1&extra_player_columns=stats.player_damage&only_filtered_players=true:${i}`, time: i })),
    ...Array.from({ length: 800 }, (_, i) => ({ key: `match:include_info=true:${i}`, time: i })),
  ];
  const removed = [];
  let finished;
  const done = new Promise(resolve => { finished = resolve; });
  const store = {
    delete: key => removed.push(key),
    openCursor(){
      const request = {};
      let i = 0;
      const advance = () => {
        const entry = entries[i++];
        request.onsuccess({ target: { result: entry ? {
          key: entry.key, value: { time: entry.time },
          continue: () => setImmediate(advance),
        } : null } });
        if(!entry)finished();
      };
      setImmediate(advance);
      return request;
    },
  };
  coordinator.prune({ transaction: () => ({ objectStore: () => store }) });
  await done;
  assert.equal(removed.filter(key => key.includes('only_filtered_players=true')).length, 100);
  assert.equal(removed.filter(key => !key.includes('only_filtered_players=true')).length, 100);
});

test('metadata 429 cools only its lane; player histories can still load', async () => {
  const paths = [];
  const coordinator = new DataCoordinator({
    delay: () => new Promise(() => {}),
    fetchImpl: async url => {
      const path = new URL(url).pathname;
      paths.push(path);
      if (path.includes('/matches/metadata')) return {
        ok: false, status: 429, headers: { get: () => null },
      };
      return { ok: true, json: async () => ['history'] };
    },
  });
  void coordinator.schedule('/matches/metadata?match_ids=1');
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(await coordinator.request('/players/1/match-history'), ['history']);
  assert.deepEqual(paths, ['/v1/matches/metadata', '/v1/players/1/match-history']);
  assert.ok(coordinator.blockedUntil.metadata > coordinator.now());
  assert.equal(coordinator.blockedUntil.other, 0);
});

test('upstream 504 respects Retry-After and reports the failing endpoint', async () => {
  let notice = '';
  const coordinator = new DataCoordinator({
    delay: () => new Promise(() => {}),
    fetchImpl: async () => ({ ok: false, status: 504, headers: { get: key => key === 'Retry-After' ? '120' : null } }),
  });
  coordinator.onStatus = message => { notice = message; };
  void coordinator.schedule('/matches/metadata?match_ids=1');
  await new Promise(resolve => setImmediate(resolve));
  assert.match(notice, /HTTP 504 at \/matches\/metadata; retrying in 120s/);
  assert.ok(coordinator.blockedUntil.metadata - coordinator.now() > 119000);
  assert.equal(coordinator.blockedUntil.other, 0);
});

test('overlapping placement batches still obey start spacing and concurrency limits', async () => {
  const starts = [];
  let active = 0, maxActive = 0;
  const coordinator = new DataCoordinator({
    spacingMs: 30,
    fetchImpl: async url => {
      starts.push(Date.now());
      maxActive = Math.max(maxActive, ++active);
      await new Promise(resolve => setTimeout(resolve, 85));
      active--;
      const id = new URL(url).searchParams.get('match_ids');
      return { ok: true, json: async () => [{ match_id: id }] };
    },
  });
  await Promise.all([1, 2, 3].map(id => coordinator.metadata([id], { include_info: 'true' })));
  assert.equal(starts.length, 3);
  assert.ok(starts[1] - starts[0] >= 22);
  assert.ok(starts[2] - starts[1] >= 22);
  assert.ok(maxActive <= 2);
});
