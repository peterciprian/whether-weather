import { fetchJson } from './http.js';
import { hourWindow } from './aggregate.js';

const MIN = 60_000;
const MAX_STALE = 6 * 60 * MIN;

export const round2 = (v) => Math.round(v * 100) / 100;

export class NotFoundError extends Error {}

/** Only today's remaining and tomorrow's hours are shown; cached results may contain older hours. */
export function trimHours(hours, tz) {
  if (!hours?.length) return undefined;
  const { from, to } = hourWindow(tz || 'UTC', { days: 2 });
  return hours.filter((h) => h.k >= from && h.k <= to);
}

/**
 * Orchestrates provider requests. Each provider result is cached (stale-while-revalidate) per
 * ~1 km grid cell, and concurrent requests for the same cell share one upstream call.
 */
export function createForecastService({ providers, env = process.env, cache, geo, fetcher = fetchJson }) {
  const enabledIds = env.PROVIDERS ? env.PROVIDERS.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const active = providers.filter(
    (p) => (!p.keyEnv || env[p.keyEnv]) && (!enabledIds || enabledIds.includes(p.id)),
  );
  const providerList = providers
    .filter((p) => !enabledIds || enabledIds.includes(p.id))
    .map((p) => ({ id: p.id, name: p.name, url: p.url, configured: active.includes(p) }));
  const openMeteo = active.find((p) => p.id === 'open-meteo');

  const keyOf = (p, loc, tz) => `fc:${p.id}:${loc.lat}:${loc.lon}${p.usesTz ? `:${tz}` : ''}`;
  const ttlOf = (p) => p.ttlMin * MIN;

  function getProvider(p, loc, tz) {
    return cache.get(keyOf(p, loc, tz), {
      ttl: ttlOf(p),
      maxStale: MAX_STALE,
      errorTtl: MIN,
      fetcher: async () => {
        const key = p.keyEnv ? env[p.keyEnv] : undefined;
        const json = await fetcher(p.buildUrl({ lat: loc.lat, lon: loc.lon, tz, key }));
        return p.parse(json, { tz });
      },
    });
  }

  function resolveTz(loc, tzHint) {
    if (tzHint) return Promise.resolve(tzHint);
    if (loc.tz) return Promise.resolve(loc.tz);
    if (openMeteo) return getProvider(openMeteo, loc, null).then((r) => r.value.tz || 'UTC', () => 'UTC');
    return Promise.resolve('UTC');
  }

  async function resolveLocation({ lat, lon, q, lang }) {
    if (lat !== null && lon !== null) return { lat: round2(lat), lon: round2(lon), name: q || null, detail: null };
    const results = await geo.search(q, lang);
    if (!results.length) throw new NotFoundError('location not found');
    const r = results[0];
    return { lat: round2(r.lat), lon: round2(r.lon), name: r.name, detail: r.detail, tz: r.tz };
  }

  /** Runs all providers, calling emit() for each event as soon as it is available. */
  async function run(loc, { tz: tzHint = null, lang = 'hu' } = {}, emit = () => {}) {
    const tzP = resolveTz(loc, tzHint);
    const placeP = loc.name
      ? Promise.resolve(emit({ type: 'place', name: loc.name, detail: loc.detail || null }))
      : geo.reverse(loc.lat, loc.lon, lang).then((pl) => pl && emit({ type: 'place', ...pl }), () => {});
    const locP = tzP.then((tz) => emit({ type: 'location', lat: loc.lat, lon: loc.lon, tz }));
    const tasks = active.map((p) =>
      (p.usesTz ? tzP : Promise.resolve(null))
        .then((tz) => getProvider(p, loc, tz).then((r) => ({ r, tz })))
        .then(
          ({ r, tz }) => emit({
            type: 'provider', id: p.id, days: r.value.days, hours: trimHours(r.value.hours, r.value.tz || tz),
            fetchedAt: r.fetchedAt, stale: r.stale,
          }),
          (e) => emit({ type: 'provider-error', id: p.id, message: e?.message || 'error' }),
        ),
    );
    await Promise.all([placeP, locP, ...tasks]);
  }

  /** Synchronous snapshot of what is already cached, used to embed data straight into the HTML. */
  function snapshot({ lat, lon, q, lang }) {
    let loc;
    if (lat !== null && lon !== null) loc = { lat: round2(lat), lon: round2(lon), name: q || null, detail: null };
    else {
      const r = geo.peekSearch(q, lang)?.[0];
      if (!r) return null;
      loc = { lat: round2(r.lat), lon: round2(r.lon), name: r.name, detail: r.detail, tz: r.tz };
    }
    const tz = loc.tz || (openMeteo && cache.peek(keyOf(openMeteo, loc, null), Infinity)?.value.tz);
    if (!tz) return null;
    const place = loc.name ? { name: loc.name, detail: loc.detail } : geo.peekReverse(loc.lat, loc.lon, lang);
    const data = {};
    let complete = !!place;
    for (const p of active) {
      const hit = cache.peek(keyOf(p, loc, tz), ttlOf(p));
      if (hit) data[p.id] = { days: hit.value.days, hours: trimHours(hit.value.hours, tz), fetchedAt: hit.fetchedAt, stale: !hit.fresh };
      if (!hit?.fresh) complete = false;
    }
    return { lat: loc.lat, lon: loc.lon, tz, place, data, complete, providers: providerList };
  }

  return { providers: providerList, active, resolveLocation, run, snapshot };
}
