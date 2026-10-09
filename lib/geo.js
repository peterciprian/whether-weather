import { fetchJson } from './http.js';

const DAY = 86_400_000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createGeo({ cache }) {
  // Nominatim usage policy: max 1 request/second, results must be cached.
  let chain = Promise.resolve();
  const throttled = (fn) => {
    const p = chain.then(fn);
    chain = p.catch(() => {}).then(() => sleep(1100));
    return p;
  };

  const searchKey = (q, lang) => `geo:s:${lang}:${q.trim().toLowerCase()}`;
  const reverseKey = (lat, lon, lang) => `geo:r:${lang}:${lat}:${lon}`;

  async function fetchSearch(q, lang) {
    const u = new URL('https://geocoding-api.open-meteo.com/v1/search');
    u.search = new URLSearchParams({ name: q.trim(), count: '6', language: lang, format: 'json' });
    const j = await fetchJson(u, { timeout: 5000 });
    return (j.results ?? []).map((r) => ({
      name: r.name,
      detail: [r.admin1, r.country].filter(Boolean).join(', '),
      lat: r.latitude,
      lon: r.longitude,
      tz: r.timezone || null,
    }));
  }

  async function fetchReverse(lat, lon, lang) {
    const u = new URL('https://nominatim.openstreetmap.org/reverse');
    u.search = new URLSearchParams({ lat, lon, format: 'jsonv2', zoom: '10', 'accept-language': lang });
    const j = await throttled(() => fetchJson(u, { timeout: 5000 }));
    const a = j.address ?? {};
    const name = a.city || a.town || a.village || a.municipality || a.county || a.state || null;
    if (!name) return null;
    return { name, detail: [a.state !== name ? a.state : null, a.country].filter(Boolean).join(', ') };
  }

  return {
    search(q, lang) {
      return cache
        .get(searchKey(q, lang), { ttl: 7 * DAY, maxStale: 30 * DAY, fetcher: () => fetchSearch(q, lang) })
        .then((r) => r.value);
    },
    peekSearch(q, lang) {
      return cache.peek(searchKey(q, lang), 7 * DAY)?.value ?? null;
    },
    reverse(lat, lon, lang) {
      return cache
        .get(reverseKey(lat, lon, lang), { ttl: 30 * DAY, maxStale: 30 * DAY, fetcher: () => fetchReverse(lat, lon, lang) })
        .then((r) => r.value);
    },
    peekReverse(lat, lon, lang) {
      return cache.peek(reverseKey(lat, lon, lang), 30 * DAY)?.value ?? null;
    },
  };
}
