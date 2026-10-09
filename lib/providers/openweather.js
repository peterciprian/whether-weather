import { aggregateIntervals, hourlyFromIntervals } from '../aggregate.js';
import { openweatherIcon } from '../icons.js';

const kmh = (ms) => (typeof ms === 'number' ? ms * 3.6 : null);

export default {
  id: 'openweather',
  name: 'OpenWeather',
  url: 'https://openweathermap.org/',
  keyEnv: 'OPENWEATHER_KEY',
  usesTz: true,
  ttlMin: 30,
  buildUrl({ lat, lon, key }) {
    const u = new URL('https://api.openweathermap.org/data/2.5/forecast');
    u.search = new URLSearchParams({ lat, lon, appid: key, units: 'metric' });
    return u;
  },
  parse(j, { tz, now } = {}) {
    // 5 day / 3 hour forecast: each item represents the 3 h block around its timestamp.
    const intervals = (j.list ?? []).map((it) => ({
      start: (it.dt - 5400) * 1000,
      hours: 3,
      temp: it.main?.temp,
      tmin: it.main?.temp_min,
      tmax: it.main?.temp_max,
      pop: typeof it.pop === 'number' ? it.pop * 100 : null,
      precip: (it.rain?.['3h'] ?? 0) + (it.snow?.['3h'] ?? 0),
      wind: kmh(it.wind?.speed),
      windDir: it.wind?.deg,
      gust: kmh(it.wind?.gust),
      cloud: it.clouds?.all,
      icon: openweatherIcon(it.weather?.[0]?.id),
    }));
    return { days: aggregateIntervals(intervals, tz), hours: hourlyFromIntervals(intervals, tz, { now }) };
  },
};
