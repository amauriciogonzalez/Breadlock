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
