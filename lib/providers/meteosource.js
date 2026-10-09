import { normalizeDay, hourlyFromLocal } from '../aggregate.js';
import { meteosourceIcon } from '../icons.js';

const kmh = (ms) => (typeof ms === 'number' ? ms * 3.6 : null);
const maxOf = (v) => {
  const n = v.filter((x) => typeof x === 'number');
  return n.length ? Math.max(...n) : null;
};

export default {
  id: 'meteosource',
  name: 'Meteosource',
  url: 'https://www.meteosource.com/',
  keyEnv: 'METEOSOURCE_KEY',
  usesTz: false,
  // Free tier: 400 calls/day.
  ttlMin: 60,
  buildUrl({ lat, lon, key }) {
    const u = new URL('https://www.meteosource.com/api/v1/free/point');
    u.search = new URLSearchParams({
      lat, lon, sections: 'daily,hourly', timezone: 'auto', language: 'en', units: 'metric', key,
    });
    return u;
  },
  parse(j, opts = {}) {
    const points = (j.hourly?.data ?? []).map((h) => ({
      k: String(h.date).slice(0, 13),
      temp: h.temperature,
      pop: h.probability?.precipitation,
      precip: h.precipitation?.total,
      wind: kmh(h.wind?.speed),
      windDir: h.wind?.angle,
      gust: kmh(h.wind?.gusts ?? h.wind?.gust),
      cloud: h.cloud_cover?.total,
      icon: meteosourceIcon(h.icon, h.weather),
    }));
    return {
      tz: j.timezone,
      hours: hourlyFromLocal(points, j.timezone || 'UTC', opts),
      days: (j.daily?.data ?? []).map((d) => {
        const a = d.all_day ?? {};
        // The free daily wind is a period average; use the strongest part of the day to approximate the max.
        const wind = maxOf([a.wind, d.morning?.wind, d.afternoon?.wind, d.evening?.wind].map((w) => kmh(w?.speed)));
        return normalizeDay({
          date: String(d.day).slice(0, 10),
          tmin: a.temperature_min,
          tmax: a.temperature_max,
          pop: d.probability?.precipitation ?? a.precipitation?.probability ?? null,
          precip: a.precipitation?.total,
          wind,
          windDir: a.wind?.angle,
          gust: kmh(a.wind?.gusts ?? a.wind?.gust),
          rad: null,
          cloud: a.cloud_cover?.total,
          icon: meteosourceIcon(d.icon, d.weather),
        });
      }),
    };
  },
};
