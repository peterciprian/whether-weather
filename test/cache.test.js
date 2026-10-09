import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SwrCache } from '../lib/cache.js';
import { createForecastService } from '../lib/forecast.js';

function sharedStore() {
  const entries = new Map();
  const writes = [];
  return {
    entries, writes,
    async get(key) { return entries.get(key) ?? null; },
    async set(key, value, options) {
      entries.set(key, structuredClone(value));
      writes.push({ key, options });
    },
  };
}

test('fresh entries survive a new cache instance; warm reads stay in memory', async (t) => {
  t.mock.method(Date, 'now', () => 100_000);
  const shared = sharedStore();
  const gets = t.mock.method(shared, 'get');
  const first = new SwrCache({ shared });
  await first.get('weather', { ttl: 60_000, maxStale: 600_000, fetcher: async () => ({ temp: 20 }) });
  assert.equal(shared.writes[0].options.ttl, 660);
  const second = new SwrCache({ shared });
  const fetcher = t.mock.fn(async () => { throw new Error('Should not call upstream'); });
  const result = await second.get('weather', { ttl: 60_000, maxStale: 600_000, fetcher });
  assert.deepEqual(result, { value: { temp: 20 }, fetchedAt: 100_000, stale: false });
  const readCount = gets.mock.callCount();
  await second.get('weather', { ttl: 60_000, fetcher });
  assert.equal(gets.mock.callCount(), readCount);
  assert.equal(fetcher.mock.callCount(), 0);
});

test('stale shared data returns immediately and refreshes in the background', async (t) => {
  t.mock.method(Date, 'now', () => 100_000);
  const shared = sharedStore();
  shared.entries.set('weather', { at: 98_000, value: 10 });
  const background = [];
  const cache = new SwrCache({ shared, background: (p) => background.push(p) });
  let finish;
  const result = await cache.get('weather', {
    ttl: 1000, maxStale: 5000, fetcher: () => new Promise((r) => { finish = r; }),
  });
  assert.equal(result.stale, true);
  assert.equal(result.value, 10);
  assert.equal(background.length, 1);
  finish(20);
  await background[0];
  await Promise.all(background);
  assert.deepEqual(shared.entries.get('weather'), { at: 100_000, value: 20 });
});

test('concurrent cold misses coalesce shared reads and upstream requests', async () => {
  const shared = sharedStore();
  let release;
  let reads = 0;
  shared.get = () => { reads++; return new Promise((r) => { release = r; }); };
  let calls = 0;
  const cache = new SwrCache({ shared });
  const opts = { ttl: 60_000, fetcher: async () => { calls++; return 20; } };
  const requests = [cache.get('weather', opts), cache.get('weather', opts)];
  release(null);
  await Promise.all(requests);
  assert.equal(reads, 1);
  assert.equal(calls, 1);
});

test('expired shared entries cannot be served as stale after upstream failure', async (t) => {
  t.mock.method(Date, 'now', () => 100_000);
  const shared = sharedStore();
  shared.entries.set('weather', { at: 90_000, value: 10 });
  const cache = new SwrCache({ shared });
  await assert.rejects(cache.get('weather', {
    ttl: 1000, maxStale: 5000, fetcher: async () => { throw new Error('upstream failed'); },
  }), /upstream failed/);
  assert.equal(await cache.read('weather', { ttl: 1000, maxStale: 5000 }), null);
});

test('shared cache failures are logged and weather still loads', async (t) => {
  const logs = t.mock.method(console, 'error', () => {});
  const shared = {
    async get() { throw new Error('read unavailable'); },
    async set() { throw new Error('write unavailable'); },
  };
  const pending = [];
  const cache = new SwrCache({ shared, background: (p) => pending.push(p) });
  const result = await cache.get('weather', { ttl: 60_000, fetcher: async () => 20 });
  await Promise.all(pending);
  assert.equal(result.value, 20);
  assert.equal(logs.mock.callCount(), 2);
});

test('cold HTML snapshot hydrates shared data without fetching weather', async () => {
  const shared = sharedStore();
  const now = Date.now();
  const value = { tz: 'Europe/Budapest', days: [{ date: '2026-10-09', tmax: 20 }], hours: [] };
  shared.entries.set('geo:s:hu:szeged', {
    at: now, value: [{ lat: 46.25, lon: 20.15, name: 'Szeged', detail: 'Hungary', tz: value.tz }],
  });
  shared.entries.set('fc:open-meteo:46.25:20.15', { at: now, value });
  const cache = new SwrCache({ shared });
  const { createGeo } = await import('../lib/geo.js');
  const service = createForecastService({
    providers: [{ id: 'open-meteo', name: 'Open-Meteo', ttlMin: 15 }],
    env: {}, cache, geo: createGeo({ cache }),
    fetcher: async () => { throw new Error('Snapshot must not call upstream'); },
  });
  const snapshot = await service.snapshot({ lat: null, lon: null, q: 'Szeged', lang: 'hu' });
  assert.equal(snapshot.complete, true);
  assert.equal(snapshot.place.name, 'Szeged');
  assert.deepEqual(snapshot.data['open-meteo'].days, value.days);
});
